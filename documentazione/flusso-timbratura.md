# Flusso Completo della Timbratura

## Attori coinvolti

Il processo di timbratura coinvolge tre attori distinti con ruoli e sistemi di autenticazione separati:

- **Stazione**: dispositivo fisso (tablet o PC) collocato all'ingresso della sede, autenticato con JWT custom valido 24 ore. Mostra il QR sullo schermo e lo rigenera ogni 3 minuti.
- **Dipendente**: usa il proprio smartphone personale dotato di sensore biometrico. Non deve avere nessuna app installata — il flusso avviene nel browser.
- **Backend**: sei funzioni AWS Lambda stateless che non condividono stato tra loro. Ogni informazione intermedia viene salvata su DynamoDB.

---

## Fase 0 — Autenticazione della stazione

La stazione si autentica una volta sola, tipicamente all'avvio del dispositivo:

```
POST /stazioni/login
{ "codice": "STZ-4A7F2B", "password": "..." }

→ 200 OK
{
  "token": "<JWT HS256, scadenza 24h>",
  "stazione": { "stationId", "descrizione", "codice" }
}
```

Il backend verifica il codice e la password (hash bcrypt in DynamoDB), poi genera un JWT firmato con algoritmo HS256 e chiave simmetrica `JWT_SECRET`. Il token viene salvato nel `localStorage` del browser della stazione e allegato automaticamente dall'interceptor HTTP a tutte le chiamate verso `/stazioni/me/*`.

Il token dura 24 ore. La stazione non ha meccanismo di rinnovo automatico — alla scadenza deve rifare il login.

---

## Fase 1 — Generazione e rotazione del QR

La stazione chiama `/stazioni/me/qr` ogni **3 minuti** tramite un `setInterval`:

```
GET /stazioni/me/qr
Authorization: Bearer <jwt-stazione>

→ 200 OK
{
  "qrUrl":            "https://app.example.com/timbratura?s=<stationId>&t=<qrToken>&exp=<expiresAt>",
  "expiresAt":        1746482400,     ← Unix timestamp: adesso + 3 minuti
  "presenti":         3,              ← dipendenti attualmente in sede
  "lat":              45.4654,        ← coordinate aggiornate della stazione
  "lng":              9.1866,
  "ultimaTimbratura": { ... }         ← per mostrare la notifica sull'ultimo accesso
}
```

Il `qrToken` incorporato nell'URL è un HMAC-SHA256 calcolato su `stationId:expiresAt` con la chiave segreta del backend:

```
qrToken = HMAC-SHA256(JWT_SECRET, "stationId:expiresAt")
```

Non viene salvato da nessuna parte — è verificabile al volo ricalcolando l'HMAC. Questo approccio (stateless token) garantisce tre proprietà simultaneamente:

- **Integrità**: senza la chiave segreta è impossibile forgiare un token valido
- **Autenticità della stazione**: `stationId` è parte del messaggio firmato — un QR di una stazione non è valido per un'altra
- **Freschezza**: `expiresAt` è parte del messaggio firmato e viene controllato esplicitamente

---

## Fase 2 — Scansione del QR e validazione preliminare

Il dipendente inquadra il QR con la fotocamera. Il browser apre il componente `TimbratureComponent` che estrae i tre parametri dall'URL:

```
s   → stationId
t   → qrToken
exp → expiresAt (Unix timestamp)
```

Prima di fare qualsiasi chiamata al backend, il frontend verifica che il QR non sia già scaduto:

```typescript
if (Math.floor(Date.now() / 1000) > this.expiresAt) {
  this.errore = 'QR scaduto — chiedi alla stazione di aggiornarlo';
  return;
}
```

Questa verifica lato client non sostituisce quella server-side, ma evita di fare una chiamata inutile in caso di QR già scaduto (situazione comune se il dipendente ha scansionato il QR e poi aspettato troppo).

---

## Fase 3 — Avvio autenticazione biometrica

Il frontend chiama un endpoint pubblico (nessun token richiesto) per ottenere la challenge WebAuthn:

```
POST /biometric/authentication/start

→ 200 OK
{
  "options": {
    "challenge":        "<base64url — 32 byte random>",
    "rpId":             "xyz.cloudfront.net",
    "allowCredentials": [],           ← lista vuota: il browser sceglie la credenziale
    "userVerification": "required",   ← biometria obbligatoria
    "timeout":          60000
  },
  "sessionId": "<uuid>"
}
```

Il backend:
1. Genera una challenge casuale (32 byte)
2. La salva in DynamoDB con chiave `authSession#<sessionId>` e TTL 5 minuti
3. Restituisce le options + il sessionId

Il `sessionId` collega questa challenge alla successiva chiamata `/anteprima`. Senza di esso, il backend non saprebbe quale challenge verificare.

---

## Fase 4 — Biometria sul dispositivo

Le `options` vengono passate alla libreria `@simplewebauthn/browser`:

```typescript
const assertion = await startAuthentication({ optionsJSON: options });
```

Il sistema operativo presenta all'utente il meccanismo di sblocco configurato (Face ID, impronta digitale, PIN di sistema). In caso di autenticazione positiva, la libreria produce un oggetto `assertion` firmato con la chiave privata dell'utente che risiede nell'enclave sicura del dispositivo — la chiave privata non lascia mai il dispositivo.

In parallelo alla biometria, il frontend richiede la posizione GPS con timeout di 8 secondi. L'acquisizione non è bloccante: se il GPS non risponde entro il timeout, il flusso prosegue senza coordinate.

---

## Fase 5 — Anteprima: verifica e calcolo del tipo

```
POST /timbrature/anteprima
{
  "stationId":  "uuid-stazione",
  "qrToken":    "a3f9c2d8...",
  "expiresAt":  1746482400,
  "assertion":  { ...webauthn assertion... },
  "sessionId":  "uuid-sessione",
  "lat":        45.4654,    ← opzionale
  "lng":        9.1866      ← opzionale
}

→ 200 OK
{ "tipo": "uscita", "confirmToken": "b7e2a1...", "nome": "Mario", "cognome": "Rossi" }
```

Il backend esegue cinque verifiche in sequenza, ciascuna delle quali può interrompere il flusso:

### Verifica 1 — QR non scaduto
```typescript
if (Math.floor(Date.now() / 1000) > parseInt(expiresAt))
  return 410 'QR scaduto — chiedi alla stazione di aggiornarlo'
```
La verifica è ridondante rispetto al controllo client-side, ma necessaria: il server non si fida del tempo del client.

### Verifica 2 — QR autentico
```typescript
const expected = HMAC-SHA256(JWT_SECRET, `${stationId}:${expiresAt}`)
if (qrToken !== expected)
  return 401 'QR non valido'
```

### Verifica 3 — Posizione geografica
Il backend recupera le coordinate della stazione da DynamoDB. Se la stazione ha lat/lng, calcola la distanza con la formula di Haversine. Se il dipendente è a più di 200 metri → 403. Se la stazione non ha coordinate, la validazione GPS è disabilitata per quella stazione.

### Verifica 4 — Biometria
Il backend recupera la challenge dal `sessionId`, verifica la firma dell'assertion con la chiave pubblica registrata dell'utente (libreria `@simplewebauthn/server`), controlla che il counter WebAuthn sia crescente (anti-replay). In caso di successo restituisce il `userId` del dipendente.

### Verifica 5 — Rate limiting
```typescript
if (ultima && (Date.now() - new Date(ultima.timestamp).getTime()) < 60_000)
  return 429 'Hai già timbrato di recente. Attendi almeno 60 secondi.'
```

### Calcolo del tipo
Superate le cinque verifiche, il backend calcola il tipo basandosi sull'ultima timbratura:

| Condizione | Tipo calcolato |
|---|---|
| Nessuna timbratura precedente | entrata |
| Ultima era uscita | entrata |
| Ultima entrata < 20 ore fa | uscita (turno in corso) |
| Ultima entrata ≥ 20 ore fa | entrata (uscita dimenticata) |

### Salvataggio della pending-entry

```
DynamoDB — Tabella Timbrature:
  PK:          "pending#b7e2a1..."    ← prefisso distinto dai veri userId
  SK:          "2026-05-05T07:58:32.000Z"
  realUserId:  "mario-rossi-uuid"
  nome:        "Mario"
  cognome:     "Rossi"
  tipo:        "uscita"
  stationId:   "uuid-stazione"
  stazioneDescrizione: "Sede Principale"
  data:        "2026-05-05"           ← data in ora locale italiana (Luxon)
  expiresAt:   1746432812             ← adesso + 300 secondi (TTL DynamoDB)
```

Il `confirmToken` nel PK è l'unica chiave per completare la timbratura. La pending-entry viene cancellata automaticamente da DynamoDB dopo 5 minuti se non confermata.

---

## Fase 6 — Riepilogo e conferma del dipendente

Il frontend mostra il riepilogo al dipendente:

```
Ciao Mario Rossi
Stai timbrando: USCITA
Sede Principale — 07:58

[Cambia tipo]   [Conferma]
```

Il pulsante "Cambia tipo" è disponibile per gestire casi eccezionali (turni notturni mal classificati). Se il dipendente lo preme, il frontend invia `tipoOverride` nella chiamata successiva.

---

## Fase 7 — Conferma e salvataggio definitivo

```
POST /timbrature/conferma
{
  "confirmToken":  "b7e2a1...",
  "tipoOverride":  "entrata"   ← opzionale
}

→ 200 OK
{
  "tipo":          "entrata",
  "timestamp":     "2026-05-05T07:58:45.000Z",
  "nome":          "Mario",
  "cognome":       "Rossi",
  "durataMinuti":  null     ← popolato solo per uscita (durata del turno)
}
```

Il backend:

1. Recupera la pending-entry da DynamoDB (`userId = pending#<confirmToken>`)
2. Verifica che non sia scaduta (`expiresAt`)
3. Se c'è `tipoOverride`, ri-verifica la coerenza della sequenza (stessa logica di anteprima) — non si fida del frontend
4. Salva la timbratura definitiva con il `realUserId`
5. Cancella la pending-entry
6. Se è un'uscita, calcola `durataMinuti` cercando l'ultima entrata alla stessa stazione

La timbratura definitiva in DynamoDB:
```
PK:                  "mario-rossi-uuid"
SK:                  "2026-05-05T07:58:45.000Z"   ← timestamp UTC
data:                "2026-05-05"                  ← data locale Italy
tipo:                "entrata"
nome:                "Mario"
cognome:             "Rossi"
stationId:           "uuid-stazione"
stazioneDescrizione: "Sede Principale"
```

---

## Fase 8 — Aggiornamento della stazione

Al successivo refresh del QR (entro 3 minuti), la stazione riceve il contatore `presenti` aggiornato e l'`ultimaTimbratura` dell'ultimo dipendente che ha timbrato. La stazione mostra una notifica temporanea (5 secondi) con il nome e il tipo dell'ultima timbratura.

---

## Schema di sequenza

```
STAZIONE              DIPENDENTE              BACKEND
    │                      │                     │
    ├── ogni 3 min ──────────────── GET /stazioni/me/qr ──►│
    │◄───────────────────────────── { qrUrl, expiresAt } ──┤
    │  mostra QR             │                     │
    │                        │                     │
    │        [scansiona QR]  │                     │
    │                        ├── POST /biometric/auth/start►│
    │                        │◄── { options, sessionId } ──┤
    │                        │                     │
    │                [Face ID / impronta]           │
    │                [GPS acquisito]                │
    │                        │                     │
    │                        ├── POST /timbrature/anteprima►│
    │                        │   stationId, qrToken,       │ ① QR valido?
    │                        │   assertion, sessionId,     │ ② GPS ≤ 200m?
    │                        │   lat, lng                  │ ③ biometria OK?
    │                        │                     │ ④ rate limit OK?
    │                        │                     │ ⑤ calcola tipo
    │                        │                     │ salva pending-entry
    │                        │◄── { tipo, confirmToken } ──┤
    │                        │                     │
    │              [mostra riepilogo]               │
    │              [eventuale toggle tipo]          │
    │                        │                     │
    │                        ├── POST /timbrature/conferma►│
    │                        │   confirmToken,             │ valida tipo override
    │                        │   tipoOverride?             │ salva definitiva
    │                        │                             │ cancella pending
    │                        │◄── { tipo, durataMinuti } ──┤
    │                        │                     │
    │              [mostra esito]                   │
    │                        │                     │
    ├── refresh QR ─────────────────────────────────►│
    │◄────────────────────── { presenti aggiornati }─┤
```

---

## Garanzie di sicurezza

Il processo è progettato con difese in profondità: nessun singolo elemento, se compromesso, è sufficiente a completare una timbratura fraudolenta.

| Minaccia | Contromisura |
|---|---|
| QR catturato e riusato | `expiresAt` + HMAC: il QR scade in 3 minuti |
| QR di un'altra stazione | `stationId` è parte del messaggio firmato nell'HMAC |
| Timbratura da posizione remota | Validazione GPS lato server con Haversine |
| Identità falsa | Firma WebAuthn con chiave privata nell'enclave del dispositivo |
| Replay dell'assertion biometrica | Counter WebAuthn crescente + challenge monouso con TTL |
| Doppia timbratura rapida | Rate limiting 60 secondi |
| Override tipo fraudolento | Ri-verifica coerenza sequenza in `/conferma` |
| Pending-entry abbandonate | TTL DynamoDB: cancellazione automatica dopo 5 minuti |
