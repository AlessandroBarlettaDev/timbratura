# WebAuthn e FIDO2

## Il problema delle password

Le password hanno tre vulnerabilità strutturali. Possono essere **rubate** (phishing, data breach, keylogger). Possono essere **indovinate** (attacchi a dizionario, brute force). Possono essere **condivise** — in un sistema di timbratura, un dipendente potrebbe dare la password a un collega per farlo timbrare al suo posto.

I sistemi biometrici tradizionali (lettori di impronte dedicati) risolvono il problema della condivisione, ma richiedono hardware specifico e centralizzano i dati biometrici sul server, creando un target ad alto valore per gli attaccanti.

WebAuthn risolve tutti e tre i problemi senza richiedere hardware aggiuntivo e senza mai trasmettere o conservare dati biometrici sul server.

## Lo standard WebAuthn

WebAuthn (Web Authentication API) è uno standard W3C, parte della specifica FIDO2, che definisce un'API per l'autenticazione crittografica nelle applicazioni web. È supportato nativamente da tutti i browser moderni e da tutti i sistemi operativi (iOS, Android, Windows, macOS).

Il principio fondamentale è la **crittografia a chiave pubblica**:
- ogni credenziale è una coppia di chiavi asimmetrica (es. ES256 — ECDSA con curva P-256)
- la **chiave privata** è generata e conservata nel dispositivo, protetta dall'enclave sicura hardware, e **non lascia mai il dispositivo**
- la **chiave pubblica** viene inviata al server durante la registrazione e salvata nel database

L'autenticazione avviene tramite firma digitale: il server invia una sfida casuale, il dispositivo la firma con la chiave privata (previa verifica biometrica dell'utente), il server verifica la firma con la chiave pubblica. Chiunque non abbia accesso fisico al dispositivo non può produrre una firma valida.

## Fase 1 — Registrazione (attestation)

La registrazione avviene una volta sola, durante l'onboarding del dipendente.

```
1. Frontend → POST /biometric/registration/start  (richiede JWT Cognito)

   Backend:
   - genera una challenge casuale (32 byte random)
   - la salva in DynamoDB con TTL 5 minuti
   - costruisce le RegistrationOptions WebAuthn:
     {
       challenge: <base64url>,
       rp: { name: "Timbratura", id: "xyz.cloudfront.net" },
       user: { id: userId, name: email, displayName: "Mario Rossi" },
       pubKeyCredParams: [{ type: "public-key", alg: -7 }],  // ES256
       authenticatorSelection: {
         authenticatorAttachment: "platform",  // solo biometria del dispositivo
         userVerification: "required"          // biometria obbligatoria
       }
     }

2. Browser chiama startRegistration({ optionsJSON })
   - il SO mostra il prompt biometrico (Face ID, Touch ID, Windows Hello)
   - l'utente si autentica
   - il dispositivo genera la coppia di chiavi nell'enclave sicura
   - firma la challenge con la chiave privata
   - produce un oggetto RegistrationResponse

3. Frontend → POST /biometric/registration/complete { registrationResponse }

   Backend (libreria @simplewebauthn/server):
   - recupera la challenge da DynamoDB tramite userId
   - verifica la firma della RegistrationResponse
   - verifica che il rpId corrisponda al dominio corretto (anti-phishing)
   - salva in DynamoDB:
     { credentialId, userId, publicKey (base64), counter: 0, transports }
   - cancella la challenge
```

Il parametro `authenticatorAttachment: "platform"` limita la registrazione ai soli autenticatori integrati nel dispositivo (Face ID, impronta digitale, Windows Hello). Dispositivi esterni come chiavi USB FIDO sono esclusi — scelta fatta per garantire che la biometria sia sempre quella della persona fisicamente presente.

## Fase 2 — Autenticazione (assertion)

L'autenticazione avviene ad ogni timbratura.

```
1. Frontend → POST /biometric/authentication/start  (pubblico, senza JWT)

   Backend:
   - cerca le credenziali dell'utente... ma non conosce ancora l'userId!
   - genera una challenge casuale
   - la salva in DynamoDB con chiave "authSession#<sessionId>", TTL 5 min
   - restituisce:
     {
       options: {
         challenge: <base64url>,
         rpId: "xyz.cloudfront.net",
         allowCredentials: [],  // lista vuota = il browser sceglie
         userVerification: "required"
       },
       sessionId: "<uuid>"
     }

2. Browser chiama startAuthentication({ optionsJSON })
   - il SO mostra il prompt biometrico
   - l'utente si autentica con Face ID / impronta
   - il dispositivo firma la challenge con la chiave privata
   - produce un AuthenticationResponse contenente:
     { credentialId, authenticatorData, clientDataJSON, signature, userHandle }

3. L'assertion viene inviata a /timbrature/anteprima insieme al sessionId

   Backend (verifyAssertion):
   - recupera la challenge dal sessionId in DynamoDB
   - usa credentialId per trovare la chiave pubblica del dispositivo
   - verifica la firma con verifyAuthenticationResponse()
   - controlla il counter: deve essere > del counter salvato (anti-replay)
   - aggiorna il counter in DynamoDB
   - restituisce l'userId del proprietario della credenziale
```

### Il counter anti-replay

Ogni autenticatore WebAuthn mantiene un contatore che incrementa di 1 ad ogni utilizzo. Il server salva l'ultimo counter visto. Se arriva un'assertion con counter ≤ del valore salvato, il server la rifiuta: significa che l'assertion è stata catturata e riprodotta (replay attack), oppure che la chiave privata è stata clonata.

Nel contesto della timbratura, questo garantisce che anche se qualcuno intercettasse il traffico di rete durante una timbratura, non potrebbe riprodurre la stessa assertion per timbrare una seconda volta.

## Perché la chiave privata non lascia il dispositivo

La chiave privata è generata e conservata nell'**enclave sicura** del dispositivo (Secure Enclave su iOS/macOS, Trusted Execution Environment su Android, TPM su Windows). Si tratta di un processore dedicato fisicamente separato dalla CPU principale, con la propria memoria cifrata.

L'enclave espone solo un'interfaccia per firmare dati: nessun software, nemmeno il sistema operativo, può estrarre la chiave privata. L'unico modo per usarla è presentare la biometria corretta, che sblocca l'operazione di firma internamente all'enclave.

Questo ha due conseguenze rilevanti per il sistema di timbratura:

1. **Non esistono dati biometrici sul server**: il server conserva solo la chiave pubblica, che è matematicamente inutile per ricostruire la chiave privata o i dati biometrici dell'utente.

2. **La timbratura è legata al dispositivo fisico**: anche conoscendo la chiave pubblica, non è possibile produrre una firma valida senza il dispositivo e senza la biometria del titolare.

## Differenza tra attestation e assertion

| | Attestation (registrazione) | Assertion (autenticazione) |
|---|---|---|
| Quando | Una volta sola, all'onboarding | Ad ogni timbratura |
| Produce | Chiave pubblica + prova del dispositivo | Firma della challenge |
| Obiettivo | "Questo dispositivo esiste ed è autentico" | "Questo utente era presente ora" |
| Dati salvati | Chiave pubblica, credentialId, counter=0 | Aggiornamento counter |

## Ruolo nella prevenzione delle frodi

In un sistema con badge o PIN, un dipendente potrebbe dare il badge a un collega per farlo timbrare al suo posto — pratica che esiste e che i sistemi tradizionali faticano a rilevare.

Con WebAuthn questo è strutturalmente impossibile:
- la firma richiede la chiave privata, che è nell'enclave del dispositivo del titolare
- l'enclave richiede la biometria del titolare per sbloccarsi
- nessuna di queste due cose è trasferibile a un'altra persona

L'unico scenario di frode residuo è che il dipendente presti fisicamente il proprio dispositivo sbloccato a un collega, ma in quel caso il sistema ha fatto la propria parte — la frode è interamente responsabilità dell'utente.
