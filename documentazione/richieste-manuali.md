# Sistema di Richieste Manuali

## Il problema

Un sistema di timbratura digitale deve gestire le eccezioni. I dipendenti possono dimenticare di timbrare, avere problemi tecnici con il dispositivo, trovarsi in aree senza GPS o biometria non funzionante. Bloccare il lavoro per un problema tecnico non è accettabile — serve un meccanismo di recupero.

Il sistema prevede due tipi di richiesta manuale:

- **Richiesta di timbratura**: il dipendente richiede l'inserimento di una timbratura mancante o la correzione di una errata
- **Richiesta di reset biometria**: il dipendente richiede che le sue credenziali biometriche vengano cancellate (cambio dispositivo, dispositivo smarrito)

## Macchina a stati

Ogni richiesta attraversa stati ben definiti:

```
                  ┌─────────────┐
                  │   pendente  │
                  └──────┬──────┘
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
      ┌───────────────┐    ┌────────────────┐
      │   approvata   │    │    rifiutata   │
      └───────────────┘    └────────────────┘
```

Una volta approvata o rifiutata, la richiesta non può più essere modificata (`stato !== 'pendente'` → 409 Conflict). Questo garantisce l'immutabilità della storia.

## Flusso della richiesta di timbratura

### Creazione (dipendente)

```
POST /requests
{
  "data": "2026-05-05",
  "tipo": "entrata",
  "ora": "09:00",
  "nota": "Ho dimenticato di timbrare all'ingresso",
  "tipoRichiesta": "timbratura"
}
```

Il backend ricava `userId` dal JWT Cognito — non dal body della richiesta. Questo impedisce che un dipendente crei richieste a nome di altri.

La richiesta viene salvata in DynamoDB con stato `"pendente"`. Il manager la vede nella sua dashboard nella sezione "Richieste".

### Approvazione (manager)

Quando il manager apre una richiesta, il sistema carica in anteprima le timbrature già esistenti per quell'utente in quel giorno. Il manager può vedere il contesto completo prima di decidere.

```
POST /requests/{id}/approve
```

Il backend esegue due verifiche di coerenza temporale prima di salvare:

**Verifica backward** — controlla l'ultima timbratura *prima* dell'orario richiesto:
```typescript
// ultima timbratura prima delle 09:00 del 5 maggio
const ultima = await query({
  KeyConditionExpression: 'userId = :uid AND timestamp < :ts',
  ScanIndexForward: false,
  Limit: 1
});
const tipoAtteso = (!ultima || ultima.tipo === 'uscita') ? 'entrata' : 'uscita';
if (item.tipo !== tipoAtteso) return 409 // tipo incoerente
```

**Verifica forward** — controlla la prima timbratura *dopo* l'orario richiesto:
```typescript
// prima timbratura dopo le 09:00 del 5 maggio
const successiva = await query({
  KeyConditionExpression: 'userId = :uid AND timestamp > :ts',
  ScanIndexForward: true,
  Limit: 1
});
if (successiva) {
  const tipoSuccessivoAtteso = item.tipo === 'entrata' ? 'uscita' : 'entrata';
  if (successiva.tipo !== tipoSuccessivoAtteso) return 409 // tipo incoerente
}
```

Solo se entrambe le verifiche passano, la timbratura viene inserita. La sequenza risultante è sempre entrata→uscita→entrata→uscita.

L'ora viene convertita da ora locale italiana a UTC prima di salvare:
```typescript
const timestamp = oraLocaleToIsoUtc("2026-05-05", "09:00");
// → "2026-05-05T07:00:00.000Z" (UTC+1 invernale)
```

La timbratura risultante ha `stazioneDescrizione: "Manuale"` per indicarne l'origine non automatica.

### Rifiuto (manager)

```
POST /requests/{id}/reject
{ "motivo": "La presenza quel giorno è già documentata dalle timbrature esistenti" }
```

Il motivo è obbligatorio: il dipendente deve sapere perché la richiesta è stata respinta. Il backend lo salva nel campo `motivoRifiuto` della richiesta.

## Flusso della richiesta di reset biometria

Quando un dipendente cambia dispositivo o smarrisce il telefono, le sue credenziali biometriche diventano inutilizzabili (la chiave privata è nell'enclave del vecchio dispositivo, irrecuperabile). Per poter timbrare di nuovo, deve registrare il nuovo dispositivo. Ma il sistema permette la registrazione solo una volta — occorre prima cancellare quelle esistenti.

Il dipendente invia una richiesta:
```
POST /requests
{
  "nota": "Ho cambiato telefono, devo registrare il nuovo dispositivo",
  "tipoRichiesta": "reset_biometria"
}
```

Alla approvazione, il backend:
1. Recupera tutte le credenziali WebAuthn del dipendente (query su `userId-index`)
2. Le cancella da DynamoDB
3. Imposta `custom:biometrics_reg = "false"` su Cognito
4. Al prossimo login, l'`onboardingGuard` reindirizza il dipendente a `/first-access` per la ri-registrazione

## Struttura dei dati in DynamoDB

```
requestId:     UUID (PK)
userId:        cognito:username del dipendente
nomeUtente:    "Mario Rossi" (denormalizzato per visualizzazione)
tipoRichiesta: "timbratura" | "reset_biometria"
stato:         "pendente" | "approvata" | "rifiutata"
nota:          testo libero del dipendente
createdAt:     ISO timestamp

--- solo per richieste di timbratura ---
data:          "2026-05-05"
tipo:          "entrata" | "uscita"
ora:           "09:00"

--- popolati all'approvazione/rifiuto ---
approvataDa:   cognito:username del manager
approvataAt:   ISO timestamp
motivoRifiuto: testo (solo se rifiutata)
```

## Due GSI per due pattern d'accesso

La tabella Requests ha due Global Secondary Index:

**`userId-index`** (PK: userId, SK: createdAt): il dipendente vede le proprie richieste ordinate dalla più recente, senza scansionare l'intera tabella.

**`stato-index`** (PK: stato, SK: createdAt): il manager vede tutte le richieste con stato `"pendente"`, ordinate per data di creazione. Quando una richiesta viene approvata o rifiutata, esce automaticamente da questa view perché il suo stato cambia.

## Interazione con le timbrature esistenti nel modale

Quando il manager apre una richiesta di timbratura, il frontend carica automaticamente le timbrature esistenti per quell'utente in quel mese e filtra quelle del giorno specifico. Il manager vede:

```
Richiesta: Mario Rossi — entrata — 09:00 — 5 maggio

Timbrature esistenti quel giorno:
  11:30  uscita   Sede Principale
  13:15  entrata  Sede Principale
  17:45  uscita   Sede Principale

Altre richieste pendenti per lo stesso giorno:
  (nessuna)
```

Questo permette al manager di valutare se la richiesta ha senso nel contesto delle timbrature già presenti, prima di approvare o rifiutare.
