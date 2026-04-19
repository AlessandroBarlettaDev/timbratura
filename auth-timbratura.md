# Autenticazione e Timbratura — Riferimento Tecnico

Il sistema gestisce tre identità distinte con meccanismi di autenticazione separati e indipendenti.

---

## Panoramica

| Attore | Meccanismo | Dove vive il token |
|---|---|---|
| Stazione | JWT custom HMAC-SHA256, TTL 24h | `localStorage` (`station_token`) |
| Manager / Employee | AWS Cognito + Amplify | Memoria Amplify (ID token) |
| QR code | HMAC stateless, TTL 3 min | Parametri URL (`s`, `t`, `exp`) |
| Biometria (timbratura) | WebAuthn passkey + session challenge | DynamoDB, TTL 5 min |

---

## 1. Autenticazione Stazione

Le stazioni accedono alle rotte `/stazioni/me/*` tramite un JWT custom generato dal backend, senza Cognito.

**Flusso di login:**

1. La stazione chiama `POST /stazioni/login` (rotta pubblica, nessun authorizer)
2. Il backend verifica `codice + password` della stazione nel database
3. Se valide, genera un JWT firmato HMAC-SHA256 con scadenza 24h
4. Il frontend salva il token in `localStorage` (`station_token`)

Alle richieste successive, il token viene letto da `localStorage` e incluso nell'header `Authorization`. Il backend lo verifica con `verificaJwtStazione()` ad ogni chiamata.

| File | Funzioni rilevanti |
|---|---|
| [backend/lib/lambda/stations-handler.ts](backend/lib/lambda/stations-handler.ts) | `loginStazione()`, `generaJwt()`, `verificaJwtStazione()` |
| [frontend/src/app/services/station-auth.service.ts](frontend/src/app/services/station-auth.service.ts) | `login()`, `getToken()`, `isLoggedIn()` |

---

## 2. QR Code

Il QR code è un token crittografico a brevissima durata generato dalla stazione autenticata. Non richiede stato lato server.

### Generazione — `GET /stazioni/me/qr`

1. Il backend calcola `expiresAt = now + 180s`
2. Calcola `qrToken = HMAC(stationId:expiresAt)` con la stessa chiave segreta usata per i JWT stazione
3. Il token **non viene salvato** in DynamoDB — può essere verificato ricalcolandolo
4. Ritorna al frontend un URL nella forma:
   ```
   /timbratura?s=<stationId>&t=<qrToken>&exp=<expiresAt>
   ```
5. Il frontend genera il QR code da questo URL e lo mostra a schermo

### Validazione — in anteprima e one-shot

Il backend riceve i parametri `s`, `t`, `exp` e:

1. Ricalcola `expectedToken = HMAC(s:exp)`
2. Confronta con `t` ricevuto
3. Se non corrisponde → 400 (QR non valido o manomesso)
4. Se `expiresAt < now` → 410 (QR scaduto)

Il meccanismo è stateless: nessuna riga in DB, nessun lookup. La validità è garantita dal segreto condiviso.

| File | Elementi |
|---|---|
| [backend/lib/lambda/stations-handler.ts](backend/lib/lambda/stations-handler.ts) | `getQr()`, costante `QR_TTL_SECS` |
| [backend/lib/lambda/timbrature-handler.ts](backend/lib/lambda/timbrature-handler.ts) | validazione `expectedToken` in anteprima e one-shot |

---

## 3. Autenticazione Biometrica (WebAuthn)

WebAuthn è uno standard W3C che permette di autenticarsi con la biometria del dispositivo (Face ID, Touch ID, Windows Hello) senza mai trasmettere una password. Il dispositivo possiede una coppia di chiavi asimmetriche: la chiave privata non lascia mai il dispositivo, il server conosce solo quella pubblica.

In questo sistema, WebAuthn serve a **identificare il dipendente che timbra**, senza che debba inserire credenziali.

### 3a. Registrazione del dispositivo (una volta sola)

Avviene da dipendente autenticato con Cognito. Registra la chiave pubblica del dispositivo nel sistema.

```
POST /biometric/registration/start   (richiede JWT Cognito)

  → generateRegistrationOptions():
      authenticatorAttachment: 'platform'  — solo biometria integrata (no chiavi USB)
      residentKey: 'required'              — crea una passkey discoverable (no username richiesto)
      userVerification: 'required'         — forza biometrica/PIN

  → salva in DynamoDB:
      { credentialId: "challenge#<userId>", challenge: "...", expiresAt: now+300 }

  → invia le options al browser
```

Il browser passa le `options` all'API WebAuthn del sistema operativo. Il dispositivo mostra Face ID / Touch ID. Se l'utente si autentica, il dispositivo genera una coppia di chiavi e firma la challenge con la chiave privata.

```
POST /biometric/registration/complete  (richiede JWT Cognito)

  → recupera "challenge#<userId>" da DynamoDB
  → verifyRegistrationResponse(): controlla firma e origine
  → elimina le credenziali precedenti dello stesso utente
  → salva la nuova chiave pubblica:
      { credentialId: "<id>", userId: "<userId>", publicKey: "...", counter: 0 }
```

**Cosa rimane in DynamoDB:** chiave pubblica + counter. La chiave privata non transita mai.

### 3b. Autenticazione alla timbratura (ogni timbratura)

La rotta è pubblica — la biometria è la prova d'identità, non serve un JWT preliminare.

```
POST /biometric/authentication/start   (rotta pubblica)

  → generateAuthenticationOptions():
      allowCredentials: []   — lista vuota = passkey discoverable, il browser sa già quale account usare

  → genera sessionId (UUID)
  → salva in DynamoDB:
      { credentialId: "authSession#<sessionId>", challenge: "...", expiresAt: now+300 }

  → ritorna { options, sessionId }
```

Il browser mostra Face ID / Touch ID. Il dispositivo firma la challenge con la chiave privata, producendo un'`assertion` — una firma crittografica unica per quella challenge, non riutilizzabile.

```
[Il frontend raccoglie assertion + sessionId e li include nel body di /timbrature/anteprima]

verifyAssertion(assertion, sessionId):

  1. recupera "authSession#<sessionId>" da DynamoDB  → ottiene la challenge originale
  2. dall'assertion estrae credentialId del dispositivo
  3. recupera la chiave pubblica salvata in fase di registrazione
  4. verifyAuthenticationResponse():
       - verifica che la firma corrisponda alla challenge
       - verifica che il counter sia aumentato (protezione anti-replay)
  5. aggiorna il counter in DynamoDB
  6. elimina "authSession#<sessionId>"
  7. ritorna userId del dipendente
```

**Perché il sessionId:** `startAuthentication` è pubblica, chiunque può chiamarla. Il `sessionId` è l'ancora che collega la challenge generata all'assertion ricevuta in seguito — senza di esso il backend non saprebbe quale challenge confrontare.

**Protezione anti-replay con il counter:** ogni firma incrementa il counter di 1. Il backend salva l'ultimo valore visto. Una firma vecchia catturata e rirpodotta avrebbe un counter identico o inferiore → verifica fallita.

### Schema DynamoDB (tabella WebAuthn)

| `credentialId` (PK) | Contenuto | TTL |
|---|---|---|
| `challenge#<userId>` | Challenge di registrazione | 5 min |
| `authSession#<sessionId>` | Challenge di autenticazione | 5 min |
| `<credentialId>` | Chiave pubblica del dispositivo + counter | nessuno |

| File | Funzioni |
|---|---|
| [backend/lib/lambda/biometric-handler.ts](backend/lib/lambda/biometric-handler.ts) | `startRegistration()`, `completeRegistration()`, `startAuthentication()`, `verifyAssertion()` |
| [backend/lib/lambda/timbrature-handler.ts](backend/lib/lambda/timbrature-handler.ts) | chiama `verifyAssertion()` in anteprima e one-shot |

---

## 4. Autenticazione Utenti (Cognito)

Manager ed employee si autenticano tramite AWS Cognito. API Gateway applica automaticamente il Cognito authorizer sulle rotte protette, senza codice custom nel lambda.

**Flusso:**

1. Il frontend chiama `signIn()` via Amplify
2. Amplify conserva l'ID token in memoria
3. Ogni richiesta include l'ID token nell'header `Authorization`
4. API Gateway valida il token e rifiuta le richieste non autenticate prima che raggiungano il lambda
5. Il lambda legge i claims: `cognito:groups`, `cognito:username`, `email`, ecc.

**Rotte e authorizer** — [backend/lib/config/api.ts](backend/lib/config/api.ts):

| Rotte | Authorizer |
|---|---|
| users, requests, contracts, timbrature protette | `AuthorizationType.COGNITO` |
| login stazione, rotte biometriche, timbratura pubblica | `AuthorizationType.NONE` |

| File | Funzioni |
|---|---|
| [backend/lib/lambda/auth.ts](backend/lib/lambda/auth.ts) | `getJwtClaims()`, `isManagerClaims()`, `isEmployeeClaims()` |
| [frontend/src/app/services/user-auth.service.ts](frontend/src/app/services/user-auth.service.ts) | `loginWithAmplify()`, `checkCurrentSession()`, `getToken()` |

---

## 5. Interceptor HTTP

L'interceptor Angular seleziona automaticamente il token corretto in base all'URL, prima che la richiesta parta.

| URL della richiesta | Token aggiunto all'header `Authorization` |
|---|---|
| Contiene `/stazioni/me/` | JWT stazione da `localStorage` |
| Qualsiasi altra rotta | ID token Cognito da Amplify |

Le rotte biometriche e di timbratura pubblica non ricevono token — l'interceptor le lascia passare senza header.

**Riferimento:** [frontend/src/app/services/auth-interceptor.ts](frontend/src/app/services/auth-interceptor.ts)

---

## 6. Flusso di Timbratura

La timbratura richiede tre validazioni indipendenti: QR (provenienza dalla stazione giusta), GPS (posizione fisica), biometria (identità del dipendente). Solo se tutte e tre passano la timbratura viene registrata.

### Modalità A — 2 step (consigliata)

Separa validazione e salvataggio. Permette di mostrare un'anteprima al dipendente prima di confermare.

```
POST /timbrature/anteprima
  body: { s, t, exp, gps, assertion, sessionId }

  ├── Valida QR: ricalcola HMAC(s:exp) e confronta con t, controlla scadenza
  ├── Valida GPS: verifica che le coordinate siano dentro il geofence della stazione
  ├── Valida biometria: verifyAssertion(assertion, sessionId) → ottiene userId
  ├── Determina tipo: entrata o uscita in base all'ultima timbratura del dipendente
  └── Salva pending entry in DynamoDB:
        { pk: "pending#<confirmToken>", userId, stationId, tipo, ... TTL: now+300 }

  → ritorna { confirmToken, tipo, dipendente, orario }

POST /timbrature/conferma
  body: { confirmToken }

  ├── Legge il pending entry da DynamoDB
  ├── Verifica che non sia scaduto
  ├── Salva la timbratura definitiva
  └── Elimina il pending entry
```

### Modalità B — One-shot

Validazione e salvataggio in un'unica chiamata. Nessuna anteprima.

```
POST /timbrature
  body: { s, t, exp, gps, assertion, sessionId }

  └── stesse validazioni + salvataggio immediato in un unico step
```

| File | Funzioni |
|---|---|
| [backend/lib/lambda/timbrature-handler.ts](backend/lib/lambda/timbrature-handler.ts) | `anteprimaTimbratura()`, `confermaTimbratura()`, `registraTimbratura()` |
