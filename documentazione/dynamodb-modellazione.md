# DynamoDB — Modellazione NoSQL

## Database relazionali vs NoSQL

Nei database relazionali (PostgreSQL, MySQL) i dati sono organizzati in tabelle con righe e colonne, collegate tra loro tramite chiavi esterne. Le query usano SQL e possono unire più tabelle con JOIN. Lo schema è fisso e deve essere definito prima di inserire dati.

DynamoDB è un database NoSQL key-value e document store. Non supporta JOIN, non ha uno schema fisso per le righe, e le query devono necessariamente usare la chiave primaria o un indice secondario. In compenso offre latenza a singola cifra in millisecondi indipendentemente dalla dimensione della tabella, scaling automatico e nessuna gestione di connessioni persistenti — caratteristica cruciale in un ambiente serverless dove ogni Lambda è stateless.

La regola fondamentale di DynamoDB è: **il modello d'accesso guida il design dello schema**. Prima si decide come i dati verranno letti, poi si progetta la struttura della tabella di conseguenza. L'approccio opposto — progettare lo schema e adattare le query dopo — porta a scan full-table che non scalano.

## Struttura di base: PK e SK

Ogni tabella DynamoDB ha una **chiave primaria** composta da:
- **Partition Key (PK)**: determina su quale partizione fisica viene salvato il dato. Tutte le righe con la stessa PK sono sullo stesso nodo e possono essere recuperate con una singola query efficiente.
- **Sort Key (SK)** (opzionale): all'interno di una partizione, le righe sono ordinate per SK. Permette query per intervallo (`begins_with`, `between`, `<`, `>`).

## Le cinque tabelle del progetto

### 1. Timbrature

Questa è la tabella più importante e con il design più ragionato.

```
PK: userId      (es. "mario-rossi-uuid")
SK: timestamp   (es. "2026-05-05T07:58:32.000Z")
```

**Perché questa scelta?**

Il pattern di accesso principale è: *"dammi tutte le timbrature di Mario Rossi del mese di maggio 2026"*. Con userId come PK, tutte le timbrature di Mario sono sullo stesso nodo. La SK timestamp in formato ISO permette di usare `begins_with("2026-05")` per filtrare il mese — una query efficiente O(log n) senza scan.

```
Query DynamoDB:
  KeyConditionExpression: userId = :uid AND begins_with(timestamp, :mese)
  → restituisce solo le righe di quell'utente in quel mese
  → nessun full scan, costo proporzionale ai risultati
```

**GSI data-index**: per il dashboard del manager che deve vedere *"tutte le timbrature di oggi"* indipendentemente dall'utente, esiste un Global Secondary Index sulla colonna `data` (formato YYYY-MM-DD, già in ora locale italiana).

```
GSI query:
  IndexName: data-index
  KeyConditionExpression: data = :oggi
  → restituisce tutte le timbrature del giorno, di tutti gli utenti
```

Il campo `data` è separato dal `timestamp` perché il timestamp è in UTC mentre `data` è in ora locale italiana (calcolata con Luxon). Questa distinzione è necessaria per gestire correttamente le timbrature notturne a cavallo della mezzanotte.

**Pending-entry**: le timbrature in attesa di conferma vengono salvate nella stessa tabella con PK `pending#<confirmToken>`. Il prefisso `pending#` le rende distinguibili dalle timbrature reali in tutte le query. Il campo `expiresAt` (Unix timestamp) è configurato come attributo TTL: DynamoDB le cancella automaticamente dopo 5 minuti.

### 2. WebAuthnCredentials

```
PK: credentialId   (es. "ABCdef123..." — ID univoco del dispositivo)
GSI userId-index: userId
```

Tre tipi di righe convivono nella stessa tabella, distinti dal campo `type`:
- `"credential"` — chiave pubblica del dispositivo registrato (nessun TTL)
- `"challenge"` — challenge di registrazione WebAuthn (TTL 5 minuti)
- `"authSession"` — challenge di autenticazione alla timbratura (TTL 5 minuti)

Il GSI su `userId` permette di trovare tutte le credenziali di un utente, necessario durante il reset biometrico.

### 3. Stazioni

```
PK: stationId   (UUID)
GSI codice-index: codice   (es. "STZ-4A7F2B")
```

Il GSI sul codice serve esclusivamente per il login della stazione: quando arriva `POST /stazioni/login` con il codice, si cerca la stazione per codice (non per ID, che non è noto al momento del login).

### 4. Requests (richieste manuali)

```
PK: requestId   (UUID)
GSI userId-index: userId + createdAt   → richieste di un dipendente ordinate per data
GSI stato-index: stato + createdAt     → richieste pendenti ordinate per data
```

Due GSI servono due pattern d'accesso distinti:
- **Dipendente**: "mostrami le mie richieste" → query su `userId-index`
- **Manager**: "mostrami tutte le richieste pendenti" → query su `stato-index` con `stato = "pendente"`

### 5. Contracts

```
PK: contractId   (UUID)
GSI userId-index: userId + dataInizio   (ordinati per data inizio, decrescente)
```

Il GSI con SK `dataInizio` e `ScanIndexForward: false` restituisce i contratti del dipendente dal più recente al più vecchio, senza dover riordinare lato applicazione.

## Confronto con approccio relazionale

In un database relazionale la stessa struttura sarebbe:

```sql
SELECT * FROM timbrature 
WHERE user_id = ? AND DATE_FORMAT(timestamp, '%Y-%m') = '2026-05'
ORDER BY timestamp DESC;
```

Questa query funziona ma richiede che la colonna `timestamp` sia indicizzata, e l'indice non può essere usato efficacemente con funzioni (`DATE_FORMAT`). Con milioni di righe degrada.

Con DynamoDB:
```
userId = "mario-rossi" AND timestamp begins_with "2026-05"
```
La query usa direttamente la struttura della chiave primaria: costo O(log n) indipendentemente dalla dimensione totale della tabella.

## Limiti di DynamoDB in questo contesto

**Nessun JOIN**: per mostrare il dashboard con timbrature + nome stazione, i dati denormalizzati (nome stazione, nome dipendente) vengono salvati direttamente nella riga della timbratura al momento della scrittura. Questo aumenta la ridondanza ma elimina la necessità di join successivi in lettura.

**Nessuna query flessibile**: non è possibile fare `WHERE ore_lavorate > 8` o aggregazioni complesse. Queste elaborazioni avvengono lato applicazione dopo aver recuperato i dati raw da DynamoDB.

**Nessuna transazione multi-tabella leggera**: operazioni che coinvolgono più tabelle (es. creare una timbratura e aggiornare il contatore presenti) devono usare DynamoDB Transactions, che hanno un costo maggiore.
