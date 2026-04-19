# Infrastruttura e Deployment — Riferimento Tecnico

Il backend è interamente su AWS, gestito con CDK in TypeScript. Un singolo stack (`BackendStack`) include hosting, autenticazione, database, API e Lambda. Il deployment è automatizzato da `deploy.sh`.

---

## Stack AWS

```
BackendStack
├── CloudFront + S3          (hosting frontend Angular)
├── Cognito User Pool        (autenticazione manager/employee)
├── DynamoDB (5 tabelle)     (dati applicativi)
├── API Gateway (RestApi)    (routing HTTP → Lambda)
└── Lambda (6 funzioni)      (logica applicativa)
```

Regione: `eu-west-1` (fissa, hardcoded in `deploy.sh`).

---

## Hosting — CloudFront + S3

Il frontend Angular è servito da CloudFront con S3 come origine privata (OAC — Origin Access Control). I file S3 non sono pubblici.

**Configurazione rilevante:**

- `ViewerProtocolPolicy.REDIRECT_TO_HTTPS` — HTTP viene rediretto automaticamente
- `CachePolicy.CACHING_OPTIMIZED` — caching aggressivo per asset statici
- Errori 403 e 404 di S3 vengono trasformati in `200 + index.html` — necessario per il routing lato client di Angular (se navighi direttamente a `/dashboard-employee`, S3 restituirebbe 403 perché il file non esiste)
- Ogni deploy invalida `/*` su CloudFront automaticamente (tramite `BucketDeployment`)

**Output CloudFormation:**

| Key | Contenuto |
|---|---|
| `AppUrl` | URL pubblico HTTPS della distribuzione CloudFront |
| `FrontendBucketName` | Nome bucket S3 |
| `CloudFrontDistributionId` | ID distribuzione (per invalidazioni manuali) |

| File | Classe |
|---|---|
| [backend/lib/config/hosting.ts](backend/lib/config/hosting.ts) | `HostingConfig` |

---

## Cognito User Pool

Gestisce l'autenticazione di manager ed employee. La registrazione autonoma è disabilitata (`selfSignUpEnabled: false`) — solo un manager può creare account.

**Configurazione:**

- Sign-in tramite email (non username)
- Email auto-verificata alla creazione (`email_verified: true`)
- Due gruppi: `manager`, `employee`
- Flussi di autenticazione abilitati: `USER_SRP_AUTH`, `USER_PASSWORD_AUTH`, `USER_AUTH` (per passkey native Cognito)
- `webAuthnRelyingPartyId` configurato sul dominio CloudFront (escape hatch CDK, proprietà non ancora nel L2)

**Template email automatici:**

- `userInvitation` — inviato alla creazione dell'account, contiene email + password temporanea + link al login
- `userVerification` — inviato per il reset password, contiene codice OTP valido 10 minuti

**Output CloudFormation:**

| Key | Contenuto |
|---|---|
| `UserPoolId` | ID del User Pool (necessario per Amplify e Lambda) |
| `ClientId` | ID del client Amplify (necessario per il frontend) |

| File | Classe |
|---|---|
| [backend/lib/config/cognito.ts](backend/lib/config/cognito.ts) | `CognitoConfig` |

---

## DynamoDB — Schema tabelle

Tutte le tabelle usano `BillingMode.PAY_PER_REQUEST` (on-demand) e `RemovalPolicy.DESTROY` (eliminate con lo stack).

### WebAuthnCredentials

Credenziali biometriche WebAuthn e challenge temporanee.

| Campo | Tipo | Ruolo |
|---|---|---|
| `credentialId` | PK (String) | ID univoco credenziale / chiave logica per challenge |
| `userId` | GSI (`userId-index`) | Recupero credenziali per utente |
| `publicKey` | String (base64) | Chiave pubblica del dispositivo |
| `counter` | Number | Anti-replay: incrementato ad ogni autenticazione |
| `transports` | List | Metodi di trasporto WebAuthn |
| `type` | String | `"credential"` / `"challenge"` / `"authSession"` |
| `expiresAt` | Number (epoch) | TTL — usato per challenge e sessioni (5 min) |

Pattern di accesso per `credentialId`:
- `challenge#<userId>` — challenge di registrazione
- `authSession#<sessionId>` — challenge di autenticazione alla timbratura
- `<credentialId>` — chiave pubblica del dispositivo (nessun TTL)

### Stazioni

| Campo | Tipo | Ruolo |
|---|---|---|
| `stationId` | PK (String) | UUID della stazione |
| `codice` | GSI (`codice-index`) | Lookup al login per codice stazione |
| `password` | String (hash bcrypt) | Credenziale di accesso |
| `nome` | String | Nome visualizzato |
| `lat`, `lng`, `radius` | Number | Geofence per validazione GPS |

### Timbrature

| Campo | Tipo | Ruolo |
|---|---|---|
| `userId` | PK (String) | Tutte le timbrature di un dipendente insieme |
| `timestamp` | SK (String, ISO) | Ordine cronologico; query per intervallo con `begins_with` |
| `data` | GSI (`data-index`, PK) | Manager: tutte le timbrature di un giorno |
| `tipo` | String | `"entrata"` / `"uscita"` |
| `stationId` | String | Stazione in cui è avvenuta la timbratura |

Pattern di accesso:
- Dipendente: `userId = X AND timestamp begins_with "2025-04"` → timbrature del mese
- Manager: `data = "2025-04-19"` (via GSI) → tutte le timbrature del giorno

### Requests

Richieste di timbratura manuale o reset biometria.

| Campo | Tipo | Ruolo |
|---|---|---|
| `requestId` | PK (String) | UUID richiesta |
| `userId` | GSI (`userId-index`, PK) | Richieste del dipendente, ordinate per data |
| `createdAt` | SK del GSI (String) | Ordine cronologico |
| `stato` | GSI (`stato-index`, PK) | Manager: tutte le richieste `"pending"` |
| `tipo` | String | `"timbratura"` / `"reset-biometria"` |

### Contracts

| Campo | Tipo | Ruolo |
|---|---|---|
| `contractId` | PK (String) | UUID contratto |
| `userId` | GSI (`userId-index`, PK) | Contratti del dipendente |
| `dataInizio` | SK del GSI (String) | Ordinamento cronologico |

| File | Classe |
|---|---|
| [backend/lib/config/dynamodb.ts](backend/lib/config/dynamodb.ts) | `DynamoDbConfig` |

---

## API Gateway

RestApi con CORS ristretto all'URL CloudFront (`appUrl`). Headers consentiti: `Content-Type`, `Authorization`, `X-Amz-Date`, `X-Api-Key`.

Il Cognito authorizer valida il JWT su ogni richiesta protetta prima che raggiunga il Lambda — il codice Lambda non gestisce autenticazione su quelle rotte.

**Mappa rotte e authorizer:**

| Rotta | Metodo | Auth | Lambda |
|---|---|---|---|
| `/users` | POST, GET | Cognito | UsersHandler |
| `/users/{id}` | GET, PUT, DELETE | Cognito | UsersHandler |
| `/users/{id}/reset-password` | POST | Cognito | UsersHandler |
| `/users/{id}/reset-biometrics` | POST | Cognito | UsersHandler |
| `/users/password-changed` | POST | Cognito | UsersHandler |
| `/users/biometrics-registered` | POST | Cognito | UsersHandler |
| `/biometric/registration/start` | POST | Cognito | BiometricHandler |
| `/biometric/registration/complete` | POST | Cognito | BiometricHandler |
| `/biometric/authentication/start` | POST | Nessuno | BiometricHandler |
| `/biometric/authentication/complete` | POST | Nessuno | BiometricHandler |
| `/stazioni` | POST, GET | Cognito | StazioniHandler |
| `/stazioni/login` | POST | Nessuno | StazioniHandler |
| `/stazioni/me/qr` | GET | Nessuno (JWT custom interno) | StazioniHandler |
| `/stazioni/me/position` | POST | Nessuno (JWT custom interno) | StazioniHandler |
| `/stazioni/{id}` | GET, DELETE | Cognito | StazioniHandler |
| `/timbrature` | POST | Nessuno | TimbratureHandler |
| `/timbrature` | GET | Cognito | TimbratureHandler |
| `/timbrature/anteprima` | POST | Nessuno | TimbratureHandler |
| `/timbrature/conferma` | POST | Nessuno | TimbratureHandler |
| `/timbrature/me` | GET | Cognito | TimbratureHandler |
| `/timbrature/dashboard` | GET | Cognito | TimbratureHandler |
| `/requests` | POST, GET | Cognito | RequestsHandler |
| `/requests/me` | GET | Cognito | RequestsHandler |
| `/requests/{id}/approve` | POST | Cognito | RequestsHandler |
| `/requests/{id}/reject` | POST | Cognito | RequestsHandler |
| `/contracts` | POST, GET | Cognito | ContractsHandler |
| `/contracts/me` | GET | Cognito | ContractsHandler |
| `/contracts/{id}` | GET, PUT, DELETE | Cognito | ContractsHandler |

| File | Classe |
|---|---|
| [backend/lib/config/api.ts](backend/lib/config/api.ts) | `ApiConfig` |

---

## Lambda — variabili d'ambiente

| Lambda | Variabili d'ambiente |
|---|---|
| UsersHandler | `USER_POOL_ID`, `WEBAUTHN_TABLE_NAME` |
| BiometricHandler | `WEBAUTHN_TABLE_NAME`, `RP_NAME`, `RP_ID`, `RP_ORIGIN` |
| StazioniHandler | `STAZIONI_TABLE_NAME`, `TIMBRATURE_TABLE_NAME`, `JWT_SECRET`, `APP_URL` |
| TimbratureHandler | `TIMBRATURE_TABLE_NAME`, `WEBAUTHN_TABLE_NAME`, `STAZIONI_TABLE_NAME`, `USER_POOL_ID`, `JWT_SECRET`, `RP_ID`, `RP_ORIGIN` |
| ContractsHandler | `CONTRACTS_TABLE_NAME`, `USER_POOL_ID` |
| RequestsHandler | `REQUESTS_TABLE_NAME`, `TIMBRATURE_TABLE_NAME`, `WEBAUTHN_TABLE_NAME`, `USER_POOL_ID` |

`JWT_SECRET` è l'unica variabile che deve essere fornita esternamente — tutte le altre vengono popolate automaticamente da CDK durante la sintesi dello stack (valori derivati dagli output delle altre risorse).

`RP_ID` e `RP_ORIGIN` sono derivati dall'URL CloudFront: `RP_ORIGIN = appUrl`, `RP_ID = dominio estratto dall'URL` (es. `xyz.cloudfront.net`).

---

## Deployment

### Prerequisiti

- AWS CLI configurato (profilo `timbrature-app` o variabile `AWS_PROFILE`)
- Node.js e Angular CLI installati
- `JWT_SECRET` esportato nell'ambiente (obbligatorio; se non impostato, lo script tenta di leggerlo automaticamente dalla Lambda già deployata)

### Comandi

```bash
./deploy.sh                  # deploy completo produzione (infra + frontend)
./deploy.sh frontend         # solo frontend produzione (~30s)
./deploy.sh backend          # solo infrastruttura CDK produzione
./deploy.sh --dev            # deploy completo ambiente dev
./deploy.sh --dev frontend   # solo frontend dev
./deploy.sh --dev backend    # solo infrastruttura dev
./deploy.sh --dev hotswap    # solo Lambda dev, bypassa CloudFormation (~15s)
```

Stack names: `BackendStack` (prod) / `BackendStack-dev` (dev).

### Flusso deploy completo

Il frontend Angular deve essere buildato **prima** di CDK, perché `BucketDeployment` referenzia `frontend/dist/` già durante la sintesi dello stack (`cdk synth`). Se `dist/` non esiste, CDK fallisce con `CannotFindAsset` prima ancora di contattare AWS.

```
1. Installa node_modules backend (se mancanti)

2. Legge outputs dello stack esistente da CloudFormation
   → scrive frontend/src/app/environments/environment.ts
      con UserPoolId, UserPoolClientId, ApiUrl correnti
   (al primo deploy lo stack non esiste → usa environment.ts attuale)

3. Build Angular → dist/frontend/browser/

4. CDK deploy → aggiorna infrastruttura + carica dist/ su S3 via BucketDeployment

5. Confronta environment.ts prima/dopo il deploy:
   → se cambiato (tipicamente al primo deploy, quando UserPoolId e ApiUrl sono nuovi):
       ribuild Angular con i valori definitivi
       re-sync S3 manualmente
       invalida cache CloudFront
   → se invariato: il frontend caricato al punto 4 è già corretto, nessun ribuild
```

### Modalità hotswap (solo dev)

Bypassa CloudFormation e aggiorna il codice delle Lambda direttamente via SDK (~15s invece di ~4-9 min). Usare **solo** per modifiche al codice Lambda, non per cambiamenti all'infrastruttura (nuove tabelle, rotte API, permessi IAM) — in quel caso serve il deploy CDK completo.

Non disponibile in produzione.

### Auto-fetch JWT_SECRET

Se `JWT_SECRET` non è impostato nell'ambiente, `deploy.sh` tenta di leggerlo automaticamente dalla Lambda `Timbrature` già deployata su AWS. Funziona per i deploy successivi al primo; il primo deploy richiede che sia impostato manualmente.

| File | |
|---|---|
| [deploy.sh](deploy.sh) | Script di deployment |
| [backend/lib/backend-stack.ts](backend/lib/backend-stack.ts) | Definizione stack CDK |
