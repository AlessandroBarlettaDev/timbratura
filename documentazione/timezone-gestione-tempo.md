# Gestione del Tempo e Timezone

## Il problema dell'ora legale

Salvare le ore "così come sono" sembra semplice, ma nasconde una trappola ben nota nei sistemi software: **il cambio dell'ora legale**.

In Italia, l'ora legale (CEST, UTC+2) è attiva da fine marzo a fine ottobre; l'ora solare (CET, UTC+1) è attiva il resto dell'anno. Due volte l'anno l'orologio viene spostato:

- **Ultima domenica di marzo** (passaggio all'ora legale): le lancette passano dalle 02:00 alle 03:00. L'ora 02:30 non esiste — quel giorno ha solo 23 ore.
- **Ultima domenica di ottobre** (passaggio all'ora solare): le lancette tornano dalle 03:00 alle 02:00. L'ora 02:30 esiste due volte — quel giorno ha 25 ore.

Se un sistema salva i timestamp in ora locale senza informazioni sul fuso orario, il secondo ottobre alle 02:30 è ambiguo: è la prima o la seconda volta? Due record con lo stesso timestamp locale potrebbero in realtà essere distanti un'ora. Ordinare o confrontare questi record produce risultati sbagliati.

## La soluzione: UTC + data locale separata

La soluzione adottata è standard nell'ingegneria del software:

**Il `timestamp` è sempre salvato in UTC** (Coordinated Universal Time). UTC non ha ora legale — è un fuso orario fisso. Due record UTC sono sempre ordinabili e confrontabili senza ambiguità.

**Il campo `data` (YYYY-MM-DD) è calcolato in ora locale italiana** al momento del salvataggio, usando la libreria Luxon con il fuso `Europe/Rome`. Questo campo serve per raggruppare le timbrature per giorno lavorativo.

```typescript
// timbrature-handler.ts
import { DateTime } from 'luxon';

const data = DateTime.now()
  .setZone('Europe/Rome')
  .toFormat('yyyy-MM-dd');  // "2026-05-05" in ora italiana
```

La separazione è necessaria perché il giorno lavorativo è un concetto locale, non UTC. Una timbratura alle 23:45 italiane:
- ha timestamp `"2026-05-05T21:45:00.000Z"` (UTC, il giorno prima in estate)
- ha `data = "2026-05-05"` (giorno corretto in ora italiana)

Il frontend usa il campo `data` per raggruppare le timbrature per giorno, non il timestamp:

```typescript
// dashboard-employee.ts — corretto
const giorno = t.data;   // usa il campo calcolato lato backend

// SBAGLIATO — darebbe problemi dopo le 22:00 in estate o 23:00 in inverno
const giorno = t.timestamp.slice(0, 10);  // taglia la data UTC
```

## Quando i due campi divergono

La divergenza tra `timestamp` UTC e `data` locale avviene nelle ultime ore della giornata:

| Ora italiana (CET, UTC+1) | Timestamp UTC | data locale |
|---|---|---|
| 2026-05-05 22:45 | 2026-05-05T21:45:00Z | 2026-05-05 ✓ |
| 2026-05-05 23:30 | 2026-05-05T22:30:00Z | 2026-05-05 ✓ |
| 2026-05-05 23:55 | 2026-05-05T22:55:00Z | 2026-05-05 ✓ |

In estate (CEST, UTC+2):

| Ora italiana (CEST, UTC+2) | Timestamp UTC | data locale |
|---|---|---|
| 2026-07-05 21:45 | 2026-07-05T19:45:00Z | 2026-07-05 ✓ |
| 2026-07-05 23:30 | 2026-07-05T21:30:00Z | 2026-07-05 ✓ |
| 2026-07-05 23:55 | 2026-07-05T21:55:00Z | 2026-07-05 ✓ |
| **2026-07-06 00:10** | **2026-07-05T22:10:00Z** | **2026-07-06 ✓** |

L'ultimo caso è quello critico: la timbratura è avvenuta il 6 luglio in Italia (00:10), ma il suo timestamp UTC comincia con `2026-07-05` (22:10 del giorno prima). Se il frontend usasse il timestamp per determinare il giorno, assegnerebbe la timbratura al 5 luglio — sbagliato.

## Luxon e la gestione dei fusi orari

Luxon è una libreria JavaScript per la gestione di date e orari, progettata come alternativa moderna a Moment.js. Nel backend viene usata per la conversione tra fusi orari:

```typescript
// Conversione ora locale → UTC (usata nelle richieste manuali)
export function oraLocaleToIsoUtc(data: string, ora: string): string {
  return DateTime.fromISO(`${data}T${ora}:00`, { zone: 'Europe/Rome' })
    .toUTC()
    .toISO()!;
}
```

Questa funzione è usata quando il manager approva una richiesta manuale: il dipendente ha indicato "entrata alle 09:00 del 5 maggio" in ora italiana, ma il timestamp salvato in DynamoDB deve essere UTC. Luxon gestisce correttamente anche il cambio ora legale: se la data cade nel periodo estivo, applica l'offset UTC+2; se cade nel periodo invernale, applica UTC+1.

## Il problema `presenteOra` nel frontend

Il widget "sei presente?" nella dashboard del dipendente mostra se l'ultima timbratura di oggi è un'entrata o un'uscita. Anche qui il calcolo di "oggi" deve essere in ora italiana:

```typescript
// SBAGLIATO: toISOString() usa UTC
const oggi = new Date().toISOString().slice(0, 10);

// CORRETTO: usa il fuso locale del browser (che per utenti italiani è Europe/Rome)
const oggi = new Date().toLocaleString('sv', { timeZone: 'Europe/Rome' }).slice(0, 10);
```

Il locale `sv` (svedese) è un trucco comune in JavaScript: il suo formato data predefinito è `YYYY-MM-DD`, identico a ISO 8601, ma rispetta il fuso orario specificato — a differenza di `toISOString()` che usa sempre UTC.

## Richieste manuali e validazione temporale

Quando un manager approva una richiesta di timbratura manuale (es. "entrata alle 09:00 del 5 maggio"), il backend deve verificare che il tipo sia coerente con le timbrature già esistenti. La query DynamoDB usa il timestamp UTC:

```typescript
const timestamp = oraLocaleToIsoUtc(item.data, item.ora);
// "2026-05-05T07:00:00.000Z" per le 09:00 italiane in inverno (UTC+1)

// query: ultima timbratura PRIMA di questo timestamp
KeyConditionExpression: 'userId = :uid AND timestamp < :ts'
```

Usare UTC nelle query DynamoDB garantisce che il confronto sia sempre corretto, indipendentemente dall'ora legale. Se si usasse l'ora locale nelle chiavi di DynamoDB, due record con timestamp locale identico (es. 02:30 durante il cambio ora) sarebbero indistinguibili.
