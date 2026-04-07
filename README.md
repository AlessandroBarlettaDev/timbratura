# Timbratura

Sistema di gestione presenze con autenticazione biometrica (WebAuthn), basato su AWS CDK + Angular 21.

## Struttura del progetto

```
timbratura/
├── backend/    # AWS CDK (TypeScript) — Lambda, API Gateway, Cognito, DynamoDB
├── frontend/   # Angular 21 — SPA con autenticazione Amplify e WebAuthn
└── deploy.sh   # Script di deploy completo
```

## Deploy

```bash
./deploy.sh
```

## Comandi utili

**Backend**
```bash
cd backend
npm run build       # compila TypeScript
npx cdk diff        # mostra differenze rispetto allo stack deployato
npx cdk synth       # genera il template CloudFormation senza deployare
```

**Frontend**
```bash
cd frontend
ng serve            # avvia il server di sviluppo su http://localhost:4200
ng build            # build di produzione in dist/
```

---

## Architettura AWS

| Servizio | Uso |
|---|---|
| **Cognito** | Autenticazione utenti (email + password + passkey WebAuthn native) |
| **API Gateway** | REST API — endpoint protetti da authorizer Cognito, JWT custom o pubblici |
| **Lambda** | Logica backend (users, biometric, timbrature, stazioni) |
| **DynamoDB** | Credenziali WebAuthn, timbrature, stazioni |
| **S3 + CloudFront** | Hosting frontend Angular |

---

## Rotte API

| Rotta | Metodo | Protezione | Uso |
|---|---|---|---|
| `/users` | POST | Cognito (manager) | Crea dipendente |
| `/users` | GET | Cognito (manager) | Lista dipendenti |
| `/users/password-changed` | POST | Cognito | Marca password cambiata |
| `/users/biometrics-registered` | POST | Cognito | Marca biometria registrata |
| `/users/{id}` | GET | Cognito (manager o self) | Dettaglio dipendente |
| `/users/{id}` | PUT | Cognito (manager) | Modifica dipendente |
| `/users/{id}` | DELETE | Cognito (manager) | Elimina dipendente |
| `/biometric/registration/start` | POST | Cognito | Genera challenge registrazione WebAuthn |
| `/biometric/registration/complete` | POST | Cognito | Verifica e salva credenziale |
| `/biometric/authentication/start` | POST | Pubblica | Genera challenge autenticazione WebAuthn |
| `/biometric/authentication/complete` | POST | Pubblica | Verifica assertion, ritorna userId |
| `/timbrature` | POST | Pubblica | Timbratura one-shot (QR + biometria) |
| `/timbrature` | GET | Cognito (manager) | Timbrature di un dipendente |
| `/timbrature/anteprima` | POST | Pubblica | Verifica QR + biometria, calcola tipo |
| `/timbrature/conferma` | POST | Pubblica | Conferma e salva definitivamente |
| `/timbrature/me` | GET | Cognito | Timbrature del dipendente loggato |
| `/timbrature/dashboard` | GET | Cognito (manager) | Riepilogo odierno per stazione |
| `/stazioni` | POST | Cognito (manager) | Crea stazione |
| `/stazioni` | GET | Cognito (manager) | Lista stazioni |
| `/stazioni/{id}` | GET | Cognito (manager) | Dettaglio stazione |
| `/stazioni/{id}` | DELETE | Cognito (manager) | Elimina stazione |
| `/stazioni/login` | POST | Pubblica | Login stazione con codice + password |
| `/stazioni/me/qr` | GET | JWT custom stazione | Genera/rinnova QR |
| `/stazioni/me/position` | POST | JWT custom stazione | Aggiorna posizione GPS |

---

## Struttura DynamoDB

### WebAuthnCredentials

PK: `credentialId` — GSI: `userId-index` su `userId`

| Campo          | Tipo         | Descrizione |
|----------------|--------------|-------------|
| `credentialId` | PK String    | ID chiave dispositivo — oppure `challenge#<userId>` / `authSession#<sessionId>` per record temporanei |
| `userId`       | String (GSI) | Username Cognito del proprietario |
| `publicKey`    | String       | Chiave pubblica Base64 |
| `counter`      | Number       | Contatore anti-replay, aggiornato ad ogni uso |
| `transports`   | List         | Canali supportati (usb, ble, internal, ecc.) |
| `type`         | String       | `credential` / `challenge` / `authSession` |
| `challenge`    | String       | WebAuthn challenge (solo nei record temporanei) |
| `expiresAt`    | Number       | TTL Unix — 5 minuti (solo nei record temporanei) |
| `createdAt`    | String       | ISO 8601 |

### Timbrature

PK: `userId` — SK: `timestamp` — GSI: `data-index` su `data` (SK: `timestamp`)

| Campo | Tipo | Descrizione |
|---|---|---|
| `userId` | PK String | Username Cognito — oppure `pending#<confirmToken>` durante l'anteprima |
| `timestamp` | SK String | ISO 8601 |
| `tipo` | String | `entrata` / `uscita` |
| `stationId` | String | ID stazione utilizzata |
| `data` | String | YYYY-MM-DD (usato dal GSI per query per giorno) |
| `nome` | String | Nome dipendente (copiato da Cognito al momento della timbratura) |
| `cognome` | String | Cognome dipendente |
| `realUserId` | String | Presente solo nei pending-entry: userId reale da usare al momento della conferma |
| `expiresAt` | Number | TTL Unix — 5 minuti (solo nei pending-entry) |

### Stazioni

PK: `stationId` — GSI: `codice-index` su `codice`

| Campo | Tipo | Descrizione |
|---|---|---|
| `stationId` | PK String | UUID generato alla creazione |
| `codice` | String (GSI) | Formato `STZ-XXXXXX` (6 hex maiuscoli) |
| `descrizione` | String | Nome display |
| `passwordHash` | String | bcrypt hash (salt=8) |
| `lat` / `lng` | Number\|null | Posizione GPS (opzionale) |
| `lastSeen` | String\|null | ISO 8601 dell'ultimo QR richiesto (usato per calcolare isActive) |
| `createdAt` | String | ISO 8601 |

---

## Cognito User Pool

**Attributi standard:** `email` (required, immutabile), `given_name`, `family_name`, `birthdate`

**Attributi custom:** `codice_fiscale`, `role`, `data_assunzione`, `termine_contratto`, `password_changed`, `biometrics_reg`

**Auth flows abilitati:** `USER_SRP`, `USER_PASSWORD`, `ADMIN_USER_PASSWORD`, `CUSTOM`, `USER_AUTH`

**WebAuthn:** `RelyingPartyId` = dominio CloudFront (senza schema), `userVerification: required`

**Gruppi:** `manager`, `employee`

**Email:** `COGNITO_DEFAULT` (limite 50 email/giorno) — template `userInvitation` con `{username}` e `{####}`

---

## Flussi principali

### 1. Creazione utente (Manager)

1. Il manager compila il form e chiama `POST /users`
2. La Lambda genera una password temporanea (`Tmp_<random>!A1`) e crea l'utente con `AdminCreateUser`
3. Cognito invia automaticamente l'email di benvenuto con il template `userInvitation` (include email, password temporanea e link al login)
4. L'utente viene assegnato al gruppo `employee` o `manager`

### 2. Primo accesso dipendente

**Step 1 — Cambio password**
- Cognito marca ogni utente creato da admin con `FORCE_CHANGE_PASSWORD`
- Al primo login Amplify riceve la challenge `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED`
- Il frontend mostra il form inline senza navigare (altrimenti Amplify perde lo stato della challenge Cognito)
- Al completamento chiama `POST /users/password-changed` → `custom:password_changed = true`

**Step 2 — Registrazione biometrica**
- Il dipendente registra il dispositivo (Touch ID, Face ID, Windows Hello) tramite WebAuthn custom
- Solo autenticatori **platform** (integrati nel dispositivo) — chiavi esterne escluse
- La credenziale pubblica viene salvata in DynamoDB con `residentKey: required` (discoverable credential — non serve username per autenticarsi)
- Al completamento chiama `POST /users/biometrics-registered` → `custom:biometrics_reg = true`

Il guard `onboardingGuard` blocca l'accesso alle dashboard finché entrambi i flag non sono `true`.

### 3. Login dipendente

**Con email + password**
```
Frontend → Amplify signIn(email, password) → Cognito
         ← isSignedIn=true, token JWT
→ checkCurrentSession() → legge gruppi, passwordChanged, biometricsReg dai claim
→ navigateAfterLogin() → /dashboard-manager o /dashboard-employee
```
Se `password_change_required` → mostra form cambio password inline (step='change_password')

**Con biometria (passkey Cognito native)**
```
Frontend → Amplify signIn(email, {authFlowType: 'USER_AUTH', preferredChallenge: 'WEB_AUTHN'})
         ← browser mostra prompt biometrico nativo
         ← isSignedIn=true, token JWT
→ checkCurrentSession() → navigateAfterLogin()
```
Nota: questo flusso richiede l'email — usa le passkey WebAuthn **native di Cognito** (diverso dal WebAuthn custom usato per la timbratura).

### 4. Login stazione

```
Stazione → POST /stazioni/login {codice, password}
         ← JWT custom (payload: stationId, codice, exp=+24h)
→ Salvato in localStorage tramite StationAuthService
→ Tutte le chiamate successive includono: Authorization: Bearer <jwt>
```
Il JWT viene verificato direttamente dentro la Lambda (non da API Gateway) per le rotte `/stazioni/me/*`.

La stazione è considerata **attiva** se `lastSeen` è entro 6 minuti dall'ultimo controllo.

### 5. Stazione — generazione QR

```
Ogni 3 minuti:
Stazione → GET /stazioni/me/qr (JWT custom)
         ← { qrUrl, expiresAt, presenti }

Backend:
  1. expiresAt = now + 180s
  2. qrToken = HMAC-SHA256(stationId:expiresAt)
  3. Aggiorna lastSeen in DynamoDB
  4. Conta presenti (ultima timbratura per userId = 'entrata', filtrata per stazione)
  5. qrUrl = APP_URL/timbratura?s=<stationId>&t=<qrToken>&exp=<expiresAt>

Frontend:
  - Converte qrUrl in immagine PNG (libreria qrcode)
  - Mostra countdown secondi rimasti
  - Mostra orario corrente e ora scadenza QR
  - Aggiorna posizione GPS ad ogni rinnovo
```

### 6. Timbratura dipendente

Il dipendente scansiona il QR della stazione dal proprio telefono:

```
Frontend                          Backend                        DynamoDB
   |                                 |                               |
   | [legge da URL: stationId, qrToken, expiresAt]                  |
   | [verifica expiresAt > now lato client]                         |
   |                                 |                               |
   |-- POST /biometric/authentication/start -----------------------> |
   |<-- { options, sessionId } ------|                               |
   |                                 |                               |
   | [browser mostra prompt biometrico]                             |
   |                                 |                               |
   |-- POST /timbrature/anteprima (assertion+sessionId+stationId+qrToken+lat?+lng?) -->
   |                                 |-- verifica HMAC qrToken ---  |
   |                                 |-- verifyAssertion() → userId  |
   |                                 |-- AdminGetUser → nome/cognome |
   |                                 |-- calcola tipo (entrata/uscita)|
   |                                 |-- salva pending-entry (TTL 5m)->
   |<-- { tipo, nome, cognome, confirmToken }                        |
   |                                 |                               |
   | [dipendente vede anteprima e conferma]                         |
   |                                 |                               |
   |-- POST /timbrature/conferma (confirmToken) ------------------>  |
   |                                 |-- legge pending-entry ------> |
   |                                 |-- salva timbratura definitiva->|
   |                                 |-- elimina pending-entry -----> |
   |<-- { tipo, durataMinuti? } -----|                               |
   |                                 |                               |
   | [redirect /dashboard-employee]  |                               |
```

La posizione GPS del telefono viene inviata opzionalmente nell'anteprima (timeout 8s, maxAge 30s).

Il tipo viene calcolato automaticamente: `entrata` se nessuna timbratura oggi o se l'ultima è `uscita`; `uscita` altrimenti.

### 7. Dashboard Manager

**Sezioni:**
- **Dashboard**: timbrature odierne aggregate per stazione — contatore presenti, badge attiva/inattiva, lista timbrature del giorno con nome/cognome/ora
- **Utenti**: lista dipendenti, dettaglio con tutti gli attributi Cognito e badge stato onboarding, form modifica, eliminazione (rimuove anche le credenziali biometriche da DynamoDB)
- **Stazioni**: lista stazioni con stato, dettaglio, creazione (con codice auto-generato `STZ-XXXXXX`), eliminazione

In ogni dettaglio utente: tabella timbrature con selettore anno/mese, navigazione periodo, export Excel (CSV con BOM UTF-8, separatore `;`).

Il manager può aprire il proprio profilo dalla sidebar (come se fosse un utente selezionato).

### 8. Dashboard Employee

- **Profilo**: caricato da `GET /users/{userId}` — mostra nome, cognome, email, CF, data assunzione, fine contratto, stato presenza odierna (in base all'ultima timbratura di oggi)
- **Timbrature**: tabella con selettore anno/mese, navigazione periodo, export Excel — caricata da `GET /timbrature/me?mese=YYYY-MM`

---

## Ruoli e autorizzazioni

| Ruolo | Accesso |
|---|---|
| `manager` | Dashboard manager, CRUD utenti e stazioni, visualizzazione timbrature di tutti |
| `employee` | Dashboard employee, visualizzazione proprie timbrature |
| (nessuno) | `/timbratura` — pubblica, autenticata solo da biometria + QR |
| Stazione | `/stazioni/me/*` — autenticata da JWT custom (non Cognito) |

---

## Note email Cognito

L'email di benvenuto viene inviata da Cognito tramite il template `userInvitation` configurato nel pool — **senza Lambda trigger**. Il trigger `CustomMessage` deve essere assente, altrimenti sovrascrive il template e Cognito usa l'email di default.

Usa `COGNITO_DEFAULT` come mittente — limite 50 email/giorno. Per produzione con volumi maggiori: richiedere SES production access dal pannello AWS SES → Account dashboard → "Request production access".
