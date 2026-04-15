# Timbratura

Sistema di gestione presenze con autenticazione biometrica (WebAuthn/FIDO2), sviluppato su infrastruttura AWS serverless e frontend Angular 21.

---

## Indice

1. [Panoramica](#1-panoramica)
2. [Architettura](#2-architettura)
3. [Struttura del progetto](#3-struttura-del-progetto)
4. [Ruoli e autorizzazioni](#4-ruoli-e-autorizzazioni)
5. [Flussi principali](#5-flussi-principali)
   - [5.1 Creazione utente](#51-creazione-utente-manager)
   - [5.2 Primo accesso dipendente](#52-primo-accesso-dipendente)
   - [5.3 Login dipendente](#53-login-dipendente)
   - [5.4 Login stazione](#54-login-stazione)
   - [5.5 Generazione QR](#55-stazione--generazione-qr)
   - [5.6 Timbratura](#56-timbratura-dipendente)
   - [5.7 Dashboard Manager](#57-dashboard-manager)
   - [5.8 Dashboard Employee](#58-dashboard-employee)
   - [5.9 Richieste di timbratura manuale](#59-richieste-di-timbratura-manuale)
6. [Sicurezza](#6-sicurezza)
7. [Struttura DynamoDB](#7-struttura-dynamodb)
8. [Rotte API](#8-rotte-api)
9. [Cognito User Pool](#9-cognito-user-pool)
10. [Deploy e comandi utili](#10-deploy-e-comandi-utili)
11. [Note tecniche](#11-note-tecniche)
12. [Sviluppi futuri](#12-sviluppi-futuri)

---

## 1. Panoramica

**Timbratura** è un sistema cloud per la gestione delle presenze aziendali. I dipendenti timbrano entrata e uscita scansionando un QR code esposto dalla stazione aziendale e autenticandosi con il proprio dispositivo biometrico (impronta digitale, Face ID, Windows Hello) — senza inserire credenziali.

**Caratteristiche principali:**

- Autenticazione biometrica tramite standard **WebAuthn/FIDO2** — nessuna password da ricordare per la timbratura
- QR code firmati crittograficamente (HMAC-SHA256) con scadenza automatica ogni 3 minuti
- Validazione della posizione GPS — il dipendente deve trovarsi entro 200 metri dalla stazione
- Rate limiting — impossibile timbrare due volte entro 60 secondi
- Visualizzazione timbrature per turno (entrata + uscita abbinate con durata calcolata)
- Statistiche per periodo: ore lavorate, giorni lavorati, media giornaliera — con export Excel
- Richieste di timbratura manuale con flusso di approvazione manager
- Dashboard manager con presenze in tempo reale e badge contatore richieste pendenti
- Infrastruttura completamente serverless su AWS — nessun server da gestire

---

## 2. Architettura

```
┌──────────────────────────────────────────────────────────────────┐
│                            AWS Cloud                             │
│                                                                  │
│  ┌──────────┐    ┌───────────────┐    ┌─────────────┐            │
│  │CloudFront│───▶│  S3 (hosting) │    │   Cognito   │            │
│  │  (CDN)   │    │  Angular SPA  │    │  (auth)     │            │
│  └──────────┘    └───────────────┘    └─────────────┘            │
│        │                                     │                   │
│        ▼                                     ▼                   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                      API Gateway (REST)                       │  │
│  │  /users  /biometric  /timbrature  /stazioni  /requests        │  │
│  │  /contracts                                                   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│        │                                                            │
│        ▼                                                            │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐ ┌──────────┐        │
│  │Users │ │Biom. │ │Timbr.│ │Staz. │ │Reques.│ │Contracts │        │
│  │Lmbd. │ │Lmbd. │ │Lmbd. │ │Lmbd. │ │ Lmbd. │ │  Lmbd.  │        │
│  └──────┘ └──────┘ └──────┘ └──────┘ └───────┘ └──────────┘        │
│       │       │        │        │         │           │            │
│       └───────┴────────┴────────┴─────────┴───────────┘            │
│                                   │                               │
│                                   ▼                               │
│              ┌────────────────────────────────────────┐           │
│              │               DynamoDB                 │           │
│              │  WebAuthn │ Timbrature │ Stazioni       │           │
│              │  Requests │ Contracts                  │           │
│              └────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

| Servizio | Ruolo |
|---|---|
| **CloudFront + S3** | Hosting e distribuzione globale del frontend Angular |
| **Cognito** | Gestione identità — registrazione, login, token JWT, WebAuthn nativo |
| **API Gateway** | Unico punto di ingresso REST — autorizzazione Cognito o JWT custom |
| **Lambda (×6)** | Logica applicativa serverless — users, biometric, timbrature, stazioni, requests, contracts |
| **DynamoDB (×5)** | Persistenza — credenziali biometriche, timbrature, stazioni, richieste manuali, contratti |

---

## 3. Struttura del progetto

```
timbratura/
├── backend/                    # Infrastruttura e logica serverless
│   ├── bin/                    # Entry point CDK
│   ├── lib/
│   │   ├── backend-stack.ts    # Stack CDK principale
│   │   ├── config/             # Costrutti CDK (Cognito, DynamoDB, API, Hosting)
│   │   └── lambda/             # Handler Lambda
│   │       ├── auth.ts                # Utility JWT Cognito
│   │       ├── biometric-handler.ts   # WebAuthn registrazione + autenticazione
│   │       ├── timbrature-handler.ts  # Timbrature + dashboard
│   │       ├── stations-handler.ts    # Stazioni + QR
│   │       ├── users-handler.ts       # Gestione utenti Cognito
│   │       ├── requests-handler.ts    # Richieste di timbratura manuale
│   │       └── contracts-handler.ts   # Gestione contratti dipendenti
│   └── package.json
│
├── frontend/                   # Applicazione Angular 21
│   └── src/app/
│       ├── components/
│       │   ├── login/              # Login dipendenti e stazioni
│       │   ├── first-access/       # Cambio password + registrazione biometrica
│       │   ├── dashboard-manager/  # Dashboard manager
│       │   ├── dashboard-employee/ # Dashboard dipendente
│       │   ├── station/            # Schermata stazione con QR
│       │   └── timbratura/         # Flusso timbratura (QR scan)
│       ├── services/               # API, Auth, StationAuth
│       └── guards/                 # authGuard, onboardingGuard
│
└── deploy.sh                   # Script deploy completo o solo frontend
```

---

## 4. Ruoli e autorizzazioni

| Ruolo | Chi | Accesso |
|---|---|---|
| `manager` | Responsabile HR / capo reparto | Dashboard manager, CRUD utenti e stazioni, visualizzazione timbrature di tutti i dipendenti, gestione richieste manuali |
| `employee` | Dipendente | Dashboard personale, proprie timbrature, statistiche, export Excel, invio richieste di timbratura manuale |
| Stazione | Dispositivo tablet/PC | Schermata QR — autenticata da JWT custom (24h), non da Cognito |
| (anonimo) | Browser del dipendente | Solo pagina `/timbratura` — accesso garantito da biometria + QR valido |

---

## 5. Flussi principali

### 5.1 Creazione utente (Manager)

1. Il manager compila il form nella dashboard (nome, cognome, email, ruolo, dati contrattuali)
2. Il backend genera una password temporanea e crea l'utente su Cognito con `AdminCreateUser`
3. Cognito invia automaticamente l'email di benvenuto con credenziali e link al portale
4. L'utente viene assegnato al gruppo `employee` o `manager`

### 5.2 Primo accesso dipendente

Al primo login il sistema guida il dipendente in due step obbligatori prima di accedere alla dashboard:

**Step 1 — Cambio password (inline nel login)**
Cognito marca ogni utente creato da admin con `FORCE_CHANGE_PASSWORD`. Al login Amplify intercetta la challenge e il frontend mostra il form di cambio password direttamente nella pagina di login (senza navigare via, per non perdere lo stato della sessione). Al completamento il flag `custom:password_changed` viene impostato su Cognito e il dipendente viene reindirizzato a `/first-access`.

**Step 2 — Registrazione biometrica (`/first-access`)**
Il dipendente registra il proprio dispositivo biometrico (Touch ID, Face ID, Windows Hello) tramite il protocollo WebAuthn. La chiave pubblica viene salvata in DynamoDB. Da questo momento il dispositivo è l'unica credenziale necessaria per timbrare. Al completamento il flag `custom:biometrics_reg` viene impostato su Cognito.

Il sistema non permette l'accesso alla dashboard finché entrambi i flag non sono attivi (`onboardingGuard`).

### 5.3 Login dipendente

**Con email + password** — flusso standard Amplify/Cognito con reindirizzamento automatico in base al ruolo. Il browser può salvare le credenziali nel portachiavi del dispositivo (iCloud Keychain, Google Password Manager, ecc.) per accessi successivi con biometria nativa. La biometria custom (`@simplewebauthn`) è usata esclusivamente nel flusso di timbratura.

### 5.4 Login stazione

La stazione (tablet o PC fisso) accede con codice stazione e password. Il backend risponde con un JWT custom valido 24 ore. Tutte le chiamate successive della stazione includono questo token nell'header `Authorization`.

### 5.5 Stazione — generazione QR

```
Ogni 3 minuti:
  1. expiresAt = ora attuale + 180 secondi
  2. qrToken = HMAC-SHA256(stationId:expiresAt)  ← firmato con il secret server
  3. Aggiorna lastSeen della stazione in DynamoDB
  4. Conta presenti (ultima timbratura per dipendente = 'entrata')
  5. Restituisce qrUrl, expiresAt, presenti, coordinate GPS stazione
```

Il frontend converte l'URL in immagine QR, mostra il countdown e aggiorna la posizione GPS della stazione. Il QR scaduto non può essere usato — il backend verifica `expiresAt` e la firma HMAC prima di procedere.

### 5.6 Timbratura dipendente

Il dipendente scansiona il QR con il proprio telefono:

```
1. Browser legge stationId, qrToken, expiresAt dall'URL
2. Verifica locale: QR non scaduto
3. POST /biometric/authentication/start → riceve challenge WebAuthn
4. Browser chiede biometrica al dispositivo
5. POST /timbrature/anteprima:
      - Verifica firma HMAC del QR
      - Verifica assertion biometrica → identifica il dipendente
      - Verifica posizione GPS (entro 200m dalla stazione)
      - Calcola tipo: entrata/uscita in base all'ultima timbratura di oggi
      - Salva stazioneDescrizione nel record per evitare join futuri
      - Salva pending-entry (TTL 5 min)
      - Risponde con: tipo, nome, cognome
6. Dipendente vede l'anteprima e conferma
7. POST /timbrature/conferma → timbratura salvata definitivamente
8. Schermata di conferma con esito (successo o errore) e pulsante:
      - Se loggato → vai alla dashboard (manager o employee)
      - Se non loggato → torna al login
```

Il flusso in due fasi (anteprima → conferma) permette al dipendente di verificare i dati prima che vengano registrati. Il tipo (entrata/uscita) è calcolato solo sulle timbrature **del giorno corrente** — ogni giorno riparte da zero indipendentemente dal giorno precedente.

### 5.7 Dashboard Manager

Quattro sezioni accessibili dalla sidebar:

- **Dashboard** — riepilogo odierno: presenti per stazione, badge attiva/inattiva (stazione inattiva se non ha generato QR negli ultimi 6 minuti), lista timbrature del giorno
- **Utenti** — lista con badge presenza in tempo reale; dettaglio utente con sezioni collassabili (Dettagli e Contratto, default chiuse); anagrafica completa; gestione contratto con CRUD (tipo, date, ore settimanali, retribuzione lorda/netta, CCNL, ferie, permessi ROL, ecc.); timbrature visualizzate per turno (entrata + uscita abbinate con durata), statistiche per periodo (ore lavorate, giorni lavorati, media giornaliera); modifica, eliminazione; export Excel con 4 sezioni: anagrafica, dati contrattuali, analisi del periodo (ore attese vs lavorate, straordinari, stima stipendio) e tabella turni con colonna ore decimali
- **Stazioni** — lista con stato, dettaglio (coordinate GPS, ultima attività), creazione (codice auto-generato `STZ-XXXXXX`), eliminazione
- **Richieste** — lista richieste di timbratura manuale pendenti con badge contatore in sidebar; approvazione con modale di contesto (mostra le timbrature già presenti per quel giorno); rifiuto con motivo obbligatorio

### 5.8 Dashboard Employee

Pagina unica a scroll con sezioni collassabili:

- **Dettagli utente** — (default chiuso) anagrafica, stato biometria, presenza odierna
- **Il mio contratto** — (default chiuso) visualizzazione in sola lettura del contratto attivo: tipo, date, ore settimanali, retribuzione, CCNL, ferie, permessi ROL; messaggio se nessun contratto registrato
- **Le mie richieste** — storico richieste inviate con stato (In attesa / Approvata / Rifiutata) e motivo del rifiuto; modale per inviare nuove richieste
- **Le mie timbrature** — storico visualizzato per turno: ogni riga mostra Data / Entrata / Uscita / Durata / Sede; navigazione per mese/anno o anno intero; statistiche per periodo (ore lavorate, giorni lavorati, media giornaliera); export Excel con 4 sezioni: anagrafica, dati contrattuali, analisi del periodo (ore attese vs lavorate, straordinari, stima stipendio) e tabella turni con colonna ore decimali

### 5.9 Richieste di timbratura manuale

Gestisce il caso in cui un dipendente dimentica di timbrare entrata o uscita.

**Flusso dipendente:**
1. Apre il modale "Nuova richiesta" nella propria dashboard
2. Seleziona tipo (entrata/uscita), data, ora e inserisce una nota obbligatoria
3. La richiesta viene salvata con stato `pendente`

**Flusso manager:**
1. Vede il badge con il contatore delle richieste pendenti nella sidebar
2. Apre la sezione "Richieste" e seleziona una richiesta
3. Il modale di approvazione mostra le timbrature già presenti per quel giorno (contesto), la nota del dipendente, e un warning se esistono altre richieste pendenti dello stesso utente per lo stesso giorno (con suggerimento di approvare prima quella con l'ora più bassa)
4. **Approva** → il backend verifica che il tipo sia coerente con la sequenza esistente, converte l'ora locale italiana in UTC e inserisce la timbratura in DynamoDB con `stazioneDescrizione: 'Manuale'`
5. **Rifiuta** → inserisce il motivo, visibile al dipendente nella propria dashboard

---

## 6. Sicurezza

| Meccanismo | Dove | Dettaglio |
|---|---|---|
| **WebAuthn/FIDO2** | Timbratura | Autenticatore platform (Touch ID, Face ID, Windows Hello) — nessuna chiave esterna accettata |
| **HMAC-SHA256** | QR code | Il token del QR è firmato con il secret server — non falsificabile senza la chiave |
| **JWT Cognito** | API protette | Verificato da API Gateway prima di invocare la Lambda |
| **JWT custom** | Stazioni | Firmato HMAC-SHA256, verificato dentro la Lambda — scade ogni 24h |
| **GPS validation** | Timbratura | Il dipendente deve trovarsi entro 200m dalla stazione (obbligatorio se la stazione ha coordinate) |
| **Rate limiting** | Timbratura | Blocco doppia timbratura entro 60 secondi |
| **Sequenza entrata/uscita** | Timbratura + Richieste | Il tipo (entrata/uscita) è calcolato automaticamente — non è sceglibile dall'utente durante la timbratura QR; nelle richieste manuali il backend valida la coerenza al momento dell'approvazione |
| **Pending-entry TTL** | Timbratura | La conferma deve avvenire entro 5 minuti, altrimenti il token scade |
| **CORS** | API Gateway | Ristretto al dominio CloudFront |
| **Gruppi Cognito** | Autorizzazione | `manager` e `employee` — verificati nei claim JWT ad ogni richiesta |

---

## 7. Struttura DynamoDB

### WebAuthnCredentials

PK: `credentialId` — GSI: `userId-index` su `userId`

| Campo | Tipo | Descrizione |
|---|---|---|
| `credentialId` | PK | ID chiave dispositivo — o `challenge#<userId>` / `authSession#<sessionId>` per record temporanei |
| `userId` | GSI | Username Cognito del proprietario |
| `publicKey` | String | Chiave pubblica Base64 — usata per verificare le firme biometriche |
| `counter` | Number | Contatore anti-replay, aggiornato ad ogni uso |
| `transports` | List | Canali supportati (internal, usb, ble, ecc.) |
| `type` | String | `credential` / `challenge` / `authSession` |
| `expiresAt` | Number | TTL Unix — 5 minuti (solo record temporanei) |
| `createdAt` | String | ISO 8601 |

### Timbrature

PK: `userId` — SK: `timestamp` — GSI: `data-index` su `data`

| Campo | Tipo | Descrizione |
|---|---|---|
| `userId` | PK | Username Cognito — o `pending#<token>` durante l'anteprima |
| `timestamp` | SK | ISO 8601 UTC |
| `tipo` | String | `entrata` / `uscita` |
| `stationId` | String | ID stazione utilizzata |
| `stazioneDescrizione` | String | Nome leggibile della stazione — salvato al momento della timbratura per evitare join; `'Manuale'` per le timbrature approvate da richiesta |
| `data` | String | YYYY-MM-DD (per query per giorno tramite GSI) |
| `nome` / `cognome` | String | Salvati al momento della timbratura per evitare join |
| `realUserId` | String | Solo nei pending-entry: userId reale |
| `expiresAt` | Number | TTL Unix — 5 minuti (solo pending-entry) |

### Stazioni

PK: `stationId` — GSI: `codice-index` su `codice`

| Campo | Tipo | Descrizione |
|---|---|---|
| `stationId` | PK | UUID generato alla creazione |
| `codice` | GSI | Formato `STZ-XXXXXX` (6 hex maiuscoli) — usato per il login |
| `descrizione` | String | Nome display della stazione |
| `passwordHash` | String | bcrypt hash (salt=8) |
| `lat` / `lng` | Number\|null | Coordinate GPS — aggiornate automaticamente dalla stazione |
| `lastSeen` | String\|null | Ultimo QR generato — usato per calcolare lo stato attivo/inattivo (inattiva dopo 6 minuti) |
| `createdAt` | String | ISO 8601 |

### Requests

PK: `requestId` — GSI: `userId-index` su `userId` + `createdAt` — GSI: `stato-index` su `stato` + `createdAt`

| Campo | Tipo | Descrizione |
|---|---|---|
| `requestId` | PK | UUID generato alla creazione |
| `userId` | GSI | Username Cognito del richiedente |
| `nomeUtente` | String | Nome e cognome — salvati per evitare join nella vista manager |
| `data` | String | YYYY-MM-DD della timbratura richiesta |
| `tipo` | String | `entrata` / `uscita` |
| `ora` | String | HH:MM — ora locale italiana inserita dal dipendente |
| `nota` | String | Motivazione obbligatoria |
| `stato` | GSI | `pendente` / `approvata` / `rifiutata` |
| `createdAt` | String | ISO 8601 |
| `approvataDa` | String | Username Cognito del manager — solo se approvata |
| `approvataAt` | String | ISO 8601 — solo se approvata |
| `motivoRifiuto` | String | Motivo del rifiuto — solo se rifiutata |

### Contracts

PK: `contractId` — GSI: `userId-index` su `userId` (SK: `dataInizio`, ordine decrescente)

| Campo | Tipo | Descrizione |
|---|---|---|
| `contractId` | PK | UUID generato alla creazione |
| `userId` | GSI | Username Cognito del dipendente |
| `tipoContratto` | String | `indeterminato` / `determinato` / `apprendistato` / `stagionale` / `parttime` / `consulenza` |
| `dataInizio` | String | YYYY-MM-DD — usato come SK nel GSI per ordinamento |
| `dataFine` | String\|null | YYYY-MM-DD — assente o null per contratti a tempo indeterminato |
| `oreSett` | Number\|null | Ore settimanali contrattuali — usate per calcolo straordinari nell'export |
| `giorniSett` | Number\|null | Giorni settimanali (default 5) — usati per calcolo ore attese giornaliere |
| `retribuzioneLorda` | Number\|null | Lordo mensile in € |
| `retribuzioneNetta` | Number\|null | Netto mensile in € |
| `livello` | String\|null | Livello contrattuale (es. B2, Primo livello) |
| `mansione` | String\|null | Mansione svolta |
| `ccnl` | String\|null | Contratto collettivo applicato |
| `giorniFerie` | Number\|null | Giorni di ferie annuali spettanti |
| `permessiOre` | Number\|null | Ore di permesso/ROL annuali |
| `periodoDiProva` | Number\|null | Durata periodo di prova in mesi |
| `note` | String\|null | Note libere |
| `createdAt` | String | ISO 8601 |
| `updatedAt` | String | ISO 8601 |

---

## 8. Rotte API

| Rotta | Metodo | Protezione | Descrizione |
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
| `/timbrature` | GET | Cognito (manager) | Timbrature di un dipendente per periodo |
| `/timbrature/anteprima` | POST | Pubblica | Verifica QR + biometria, calcola tipo, salva pending |
| `/timbrature/conferma` | POST | Pubblica | Conferma e salva definitivamente |
| `/timbrature/me` | GET | Cognito | Timbrature del dipendente loggato per periodo |
| `/timbrature/dashboard` | GET | Cognito (manager) | Riepilogo odierno per stazione |
| `/stazioni` | POST | Cognito (manager) | Crea stazione |
| `/stazioni` | GET | Cognito (manager) | Lista stazioni |
| `/stazioni/{id}` | GET | Cognito (manager) | Dettaglio stazione |
| `/stazioni/{id}` | DELETE | Cognito (manager) | Elimina stazione |
| `/stazioni/login` | POST | Pubblica | Login stazione con codice + password |
| `/stazioni/me/qr` | GET | JWT custom stazione | Genera/rinnova QR |
| `/stazioni/me/position` | POST | JWT custom stazione | Aggiorna posizione GPS |
| `/requests` | POST | Cognito | Crea richiesta di timbratura manuale (employee) |
| `/requests` | GET | Cognito (manager) | Lista richieste pendenti |
| `/requests/me` | GET | Cognito | Richieste del dipendente loggato |
| `/requests/{id}/approve` | POST | Cognito (manager) | Approva richiesta e inserisce la timbratura |
| `/requests/{id}/reject` | POST | Cognito (manager) | Rifiuta richiesta con motivo obbligatorio |
| `/contracts` | POST | Cognito (manager) | Crea contratto per un dipendente |
| `/contracts` | GET | Cognito (manager) | Lista contratti di un dipendente (`?userId=`) |
| `/contracts/me` | GET | Cognito | Contratti del dipendente loggato |
| `/contracts/{id}` | PUT | Cognito (manager) | Modifica contratto |
| `/contracts/{id}` | DELETE | Cognito (manager) | Elimina contratto |

---

## 9. Cognito User Pool

**Attributi standard:** `email` (required, immutabile), `given_name`, `family_name`, `birthdate`

**Attributi custom:** `codice_fiscale`, `role`, `password_changed`, `biometrics_reg`

**Auth flows:** `USER_SRP`, `USER_PASSWORD`, `ADMIN_USER_PASSWORD`, `CUSTOM`, `USER_AUTH`

**WebAuthn:** `RelyingPartyId` = dominio CloudFront, `userVerification: required`

**Gruppi:** `manager`, `employee`

**Email — invito:** template `userInvitation` con `{username}` e `{####}` (password temporanea). Link diretto alla pagina di login.

**Email — recupero password:** template `userVerification` con codice OTP `{####}` valido 10 minuti.

**Limite:** `COGNITO_DEFAULT` — 50 email/giorno. Per produzione richiedere SES production access.

---

## 10. Deploy e comandi utili

```bash
./deploy.sh                  # deploy completo (infrastruttura + frontend) su prod
./deploy.sh frontend         # solo frontend su prod (~30 secondi)
./deploy.sh --dev            # deploy completo su dev
./deploy.sh --dev frontend   # solo frontend su dev
./deploy.sh --dev backend    # solo backend (CDK) su dev
```

**Backend**
```bash
cd backend
npm run build                           # compila TypeScript
./node_modules/.bin/cdk diff            # mostra differenze rispetto allo stack deployato
./node_modules/.bin/cdk synth           # genera il template CloudFormation senza deployare
```

**Frontend**
```bash
cd frontend
ng serve            # server di sviluppo su http://localhost:4200
ng build            # build di produzione in dist/
```

---

## 11. Note tecniche

**Perché WebAuthn custom invece di Cognito nativo per la timbratura?**
Cognito WebAuthn nativo richiede che l'utente sia già identificato (username obbligatorio) prima di avviare la challenge. La timbratura deve invece identificare il dipendente *dalla* biometria, senza che inserisca nulla. Il flusso custom con `@simplewebauthn` e discoverable credentials (passkey con `residentKey: required`) permette questa identificazione automatica.

**Struttura a due fasi della timbratura (anteprima → conferma)**
La timbratura non viene salvata immediatamente dopo la verifica biometrica ma in una pending-entry temporanea. Il dipendente vede il riepilogo (tipo, nome, cognome) e conferma esplicitamente. Questo previene errori involontari e permette di mostrare all'utente cosa sta per registrare.

**Tipo entrata/uscita calcolato per giorno corrente**
Il sistema determina se la prossima timbratura è un'entrata o un'uscita guardando solo le timbrature del giorno corrente. Ogni giorno riparte da zero — un'entrata non chiusa del giorno precedente non influenza il giorno successivo. Le timbrature dimenticate si gestiscono tramite le richieste manuali.

**Visualizzazione per turni**
Le timbrature non vengono mostrate come eventi singoli ma abbinate in turni (entrata + uscita) con durata calcolata. Più turni nello stesso giorno (es. pausa pranzo) generano righe separate. Un'entrata senza uscita mostra il turno come aperto.

**Conversione ora locale nelle richieste manuali**
L'ora inserita dal dipendente nella richiesta è locale italiana (Europe/Rome). Al momento dell'approvazione il backend la converte in UTC usando l'offset reale del fuso (gestisce automaticamente ora solare/legale) prima di salvare il timestamp in DynamoDB, garantendo coerenza con le timbrature normali.

**GPS obbligatorio**
Se la stazione ha coordinate GPS configurate, il dipendente deve avere il GPS attivo e trovarsi entro 200 metri. Se la stazione non ha coordinate (non ancora configurate), la validazione è disabilitata. Le coordinate della stazione vengono aggiornate automaticamente dal dispositivo stazione ad ogni rinnovo QR.

---

## 12. Sviluppi futuri

### Gestione assenze
Ferie, permessi, malattia, festività — oggi un giorno senza timbrature è semplicemente vuoto.

### Notifiche
Avvisi automatici: richiesta approvata/rifiutata via email al dipendente; entrata non registrata oltre l'orario previsto; uscita dimenticata a fine turno.

### Storico richieste per il manager
Le richieste scompaiono dalla lista pendenti una volta gestite. Aggiungere una vista storico (approvate + rifiutate) filtrabile per dipendente e periodo.

### Export avanzati
- Export PDF firmato digitalmente delle timbrature (valore legale)
- Export per cedolini paga (formato UNIEMENS o similare)
- Scheduling automatico degli export con invio email mensile
- L'export Excel attuale include anagrafica, dati contrattuali, analisi del periodo (ore attese/lavorate, straordinari, stima stipendio) e tabella turni con ore decimali; i festivi non sono ancora dedotti dal conteggio giorni lavorativi attesi

### Audit trail completo
Tabella DynamoDB separata AuditLog che traccia:
- Chi ha creato/modificato/eliminato un utente
- Chi ha approvato/rifiutato una richiesta
- Cambiamenti di ruolo
- Accessi falliti (tentativi di brute force)
- Modifiche alle stazioni

### Modalità offline per la stazione
La stazione dovrebbe poter funzionare anche senza connessione Internet, salvando i QR generati localmente e sincronizzando quando torna online (con timestamp verificati crittograficamente).

### Turni notturni
La logica attuale determina entrata/uscita guardando solo le timbrature del giorno corrente — ogni giorno riparte da zero. Questo causa problemi con turni a cavallo della mezzanotte (es. entrata alle 22:00, uscita alle 06:00 del giorno dopo). Servirebbe una logica che consideri l'ultimo stato indipendentemente dalla data.

### Webhook per eventi
Notifiche push verso endpoint configurati dal cliente quando:
- Una timbratura viene registrata
- Una richiesta manuale viene approvata/rifiutata
- Un dipendente supera X ore di straordinario

### Produzione
- Migrare l'invio email da `COGNITO_DEFAULT` (50/giorno) a **SES production** per volumi elevati
- Configurare un dominio personalizzato per CloudFront e API Gateway
- Restringere ulteriormente i permessi IAM delle Lambda (principio del minimo privilegio)
- Abilitare DynamoDB Point-in-Time Recovery (PITR) per backup continuo
- Aggiungere log di audit (IP, user agent) ad ogni timbratura e approvazione
