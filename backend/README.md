# Backend – Timbratura (AWS CDK)

Infrastruttura AWS del progetto Timbratura, definita con CDK TypeScript.

## Comandi utili

* `npm run build`   compila TypeScript in JS
* `npm run watch`   ricompila automaticamente al salvataggio
* `npx cdk deploy`  deploya lo stack sull'account/regione AWS configurato
* `npx cdk diff`    mostra le differenze rispetto allo stack deployato
* `npx cdk synth`   genera il template CloudFormation senza deployare

---

## Flusso primo accesso (First Access)

Quando un manager crea un nuovo utente, Cognito genera una password temporanea e la invia via email. Al primo login, l'utente viene guidato attraverso due step obbligatori prima di accedere alla dashboard.

### Step 1 — Cambio password

Cognito marca ogni utente creato da admin con stato `FORCE_CHANGE_PASSWORD`. Quando l'utente tenta il login con la password temporanea, Cognito non completa l'autenticazione ma risponde con la challenge `NEW_PASSWORD_REQUIRED`.

Amplify traduce questa challenge in `nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'`. Il frontend intercetta il valore e reindirizza l'utente alla pagina `/first-access`.

L'utente inserisce la nuova password. Il frontend chiama `confirmSignIn({ challengeResponse: nuovaPassword })`, che completa la challenge e autentica l'utente definitivamente.

Al termine, il backend aggiorna l'attributo Cognito `custom:password_changed = 'true'` tramite l'endpoint `POST /users/password-changed`, che usa `AdminUpdateUserAttributes` con le credenziali IAM della Lambda (non le credenziali utente).

### Step 2 — Registrazione biometrica (WebAuthn)

Dopo il cambio password, l'utente deve registrare il proprio dispositivo biometrico. Questo dispositivo verrà poi usato per timbrare le presenze senza dover inserire credenziali.

Il protocollo utilizzato è **WebAuthn (FIDO2)**, lo standard W3C supportato nativamente dai browser moderni. Permette di usare Touch ID, Face ID, Windows Hello o chiavi hardware come autenticatori.

**Librerie utilizzate:**
- `@simplewebauthn/server` (backend) — genera le challenge e verifica le risposte crittograficamente
- `@simplewebauthn/browser` (frontend) — gestisce il dialogo con l'API WebAuthn del browser

**Flusso di registrazione:**

```
Frontend                          Backend                        DynamoDB
   |                                 |                               |
   |-- POST /biometric/registration/start -->                        |
   |                                 |-- genera challenge ---------->|
   |                                 |-- salva challenge temporanea->|
   |<-- restituisce options ----------|                               |
   |                                 |                               |
   | [browser mostra prompt biometrico: Touch ID / Face ID / ecc.]  |
   |                                 |                               |
   |-- POST /biometric/registration/complete (credential) --------> |
   |                                 |-- verifica firma crittografica|
   |                                 |-- salva credenziale ---------->|
   |<-- 200 OK --------------------- |                               |
   |                                 |                               |
   |-- POST /users/biometrics-registered -->                        |
   |                                 |-- custom:biometrics_reg=true  |
   |<-- 200 OK --------------------- |                               |
   |                                 |                               |
   | [reindirizza alla dashboard]    |                               |
```

**Dati salvati in DynamoDB (`WebAuthnCredentials`):**

| Campo | Tipo | Descrizione |
|---|---|---|
| `credentialId` | PK (String) | Identificatore univoco della chiave sul dispositivo |
| `userId` | String (GSI) | Email/username Cognito del proprietario |
| `publicKey` | String | Chiave pubblica in formato Base64, usata per verificare le firme |
| `counter` | Number | Contatore incrementale, protegge da attacchi di replay |
| `transports` | List | Canali di comunicazione supportati (usb, ble, internal, ecc.) |
| `createdAt` | String | Timestamp ISO della registrazione |

La tabella ha anche record temporanei di tipo `challenge#<userId>` che contengono la challenge attiva durante la registrazione, con un TTL di 5 minuti.

---

## Problemi noti e soluzioni

### Email di benvenuto non recapitata

**Problema**
Quando viene creato un nuovo utente tramite `AdminCreateUser`, Cognito deve inviare un'email con la password temporanea. L'email non arrivava.

**Causa**
Il template personalizzato (Lambda trigger `CustomMessage_AdminCreateUser`) restituiva un `emailMessage` senza il placeholder `{####}`, richiesto obbligatoriamente da Cognito per inserire la password temporanea. Cognito scartava il messaggio silenziosamente e inviava l'email di default.

In una fase successiva, il pool era configurato in modalità `DEVELOPER` (SES). SES in sandbox mode permette di inviare email **solo verso indirizzi verificati**. Le email verso indirizzi non verificati vengono scartate silenziosamente senza errori.

**Soluzioni**

1. **Usare `COGNITO_DEFAULT`** *(scelta attuale)*  
   Cognito gestisce l'invio direttamente, senza SES e senza restrizioni sandbox. Limite: 50 email/giorno, sufficiente per sviluppo e tesi.  
   Configurazione CDK: `email: cognito.UserPoolEmail.withCognito()`

2. **Verificare ogni indirizzo destinatario in SES** *(solo per test)*  
   ```bash
   aws sesv2 create-email-identity --email-identity destinatario@esempio.it --region eu-west-1
   ```
   AWS invia un link di verifica. Non scalabile per produzione.

3. **Richiedere SES production access** *(soluzione produzione)*  
   Dal pannello SES → Account dashboard → "Request production access".  
   Rimuove il limite sandbox e permette l'invio verso qualsiasi indirizzo.  
   Richiede approvazione AWS (1–2 giorni lavorativi).
