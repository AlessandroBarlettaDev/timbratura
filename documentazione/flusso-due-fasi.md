# Il Flusso a Due Fasi: Anteprima e Conferma

## Perché non salvare tutto in una chiamata sola?

La domanda è legittima: perché dividere la timbratura in `/anteprima` e `/conferma` invece di fare tutto in una singola chiamata?

La risposta sta in un requisito funzionale preciso: **il dipendente deve poter correggere il tipo** (entrata/uscita) prima che la timbratura venga salvata.

Il sistema calcola automaticamente il tipo basandosi sull'ultima timbratura dell'utente. Questo calcolo funziona bene nella maggior parte dei casi, ma può sbagliare in scenari particolari — tipicamente i turni notturni a cavallo della mezzanotte. Un dipendente che entra alle 22:00 e finisce alle 06:00 del giorno dopo potrebbe vedere il sistema proporre "entrata" alla fine del turno, se l'uscita dimenticata del giorno prima non è stata registrata.

Per gestire questi casi, il sistema mostra al dipendente un riepilogo ("Stai timbrando: **uscita** — 06:14 — Sede Principale") con la possibilità di invertire il tipo. Solo dopo la conferma esplicita la timbratura viene salvata definitivamente.

## Il pending-entry pattern

Questo comportamento introduce un problema architetturale: tra la verifica (QR, biometria, GPS) e il salvataggio definitivo c'è un intervento umano che può durare qualche secondo o qualche minuto. Come si mantiene lo stato di questa operazione intermedia in un sistema stateless?

La soluzione è il **pending-entry pattern**: dopo le verifiche, il backend salva una riga temporanea in DynamoDB con una chiave sintetica.

```
Tabella Timbrature:
  PK: "pending#a3f9c2d8e1b4..."   ← non è un vero userId
  SK: "2026-05-05T07:58:32.000Z"
  realUserId: "mario-rossi-uuid"
  nome: "Mario"
  cognome: "Rossi"
  tipo: "uscita"                  ← tipo calcolato
  stationId: "uuid-stazione"
  stazioneDescrizione: "Sede Principale"
  data: "2026-05-05"
  expiresAt: 1746432512           ← adesso + 300 secondi (TTL DynamoDB)
```

Il `confirmToken` (`a3f9c2d8e1b4...`) viene restituito al frontend. È l'unica chiave per accedere a questa riga temporanea — senza di esso non è possibile completare la timbratura.

## Sequenza completa

```
Frontend                           Backend (Lambda)                DynamoDB
   │                                      │                            │
   ├── POST /timbrature/anteprima ────────►│                            │
   │   { stationId, qrToken, expiresAt,   │                            │
   │     assertion, sessionId, lat, lng } │ 1. verifica QR             │
   │                                      │ 2. verifica GPS            │
   │                                      │ 3. verifica biometria      │
   │                                      │ 4. rate limiting           │
   │                                      │ 5. calcola tipo            │
   │                                      ├── PutItem (pending) ───────►│
   │◄── { tipo, confirmToken, nome } ─────┤                            │
   │                                      │                            │
   │  [dipendente vede il riepilogo]      │                            │
   │  [eventualmente cambia il tipo]      │                            │
   │                                      │                            │
   ├── POST /timbrature/conferma ─────────►│                            │
   │   { confirmToken, tipoOverride? }    ├── Query (pending#token) ───►│
   │                                      │◄── pending-entry ──────────┤
   │                                      │ 6. verifica scadenza       │
   │                                      │ 7. valida tipoOverride     │
   │                                      ├── PutItem (definitiva) ────►│
   │                                      ├── DeleteItem (pending) ────►│
   │◄── { tipo, durataMinuti } ───────────┤                            │
```

## Garanzie del pattern

**Idempotenza**: il `confirmToken` è monouso. Una volta che `/conferma` viene chiamato con successo, la pending-entry viene cancellata. Una seconda chiamata con lo stesso token riceve 404 ("Sessione scaduta o non trovata").

**Scadenza automatica**: se il dipendente abbandona dopo l'anteprima senza confermare, la pending-entry viene cancellata automaticamente da DynamoDB dopo 5 minuti tramite il meccanismo TTL. Non rimane nulla di permanente nel database.

**Filtro nelle query**: la pending-entry ha PK `pending#<token>` invece del `userId` reale. Tutte le query che leggono le timbrature filtrano esplicitamente:
```typescript
.filter(t => !t.userId.startsWith('pending#'))
```
Questo garantisce che le entry temporanee non inquinino le statistiche o i report.

**Validazione del tipo override**: se il frontend invia `tipoOverride`, il backend non si fida ciecamente ma ri-verifica che la sequenza risultante sia coerente con la storia dell'utente. Questo impedisce che un override malevolo o erroneo produca due entrate consecutive.

## Analogia con le transazioni distribuite

Il pending-entry pattern è concettualmente simile a una **transazione a due fasi (2PC — Two-Phase Commit)** usata nei sistemi distribuiti per garantire la consistenza tra più nodi:

- **Fase 1 (prepare)**: ogni nodo verifica che la transazione sia fattibile e si riserva le risorse → nel sistema: verifica QR, biometria, GPS e crea la pending-entry
- **Fase 2 (commit)**: solo se tutti i nodi hanno confermato la fattibilità, la transazione viene completata → nel sistema: il dipendente conferma e la timbratura viene salvata definitivamente

La differenza è che nel sistema di timbratura l'intervento umano (la conferma) sostituisce il coordinatore automatico del 2PC. La pending-entry con TTL gioca il ruolo del "prepare lock" che scade automaticamente se il commit non arriva entro il timeout.

## Confronto con approccio a fase singola

| | Una chiamata sola | Due fasi (anteprima + conferma) |
|---|---|---|
| Correzione tipo | Impossibile dopo il salvataggio | Possibile prima della conferma |
| UX | Il dipendente vede il risultato dopo il fatto | Il dipendente conferma prima |
| Rollback in caso di errore | Richiede cancellazione esplicita | Pending-entry scade automaticamente |
| Complessità implementativa | Minore | Maggiore (due endpoint, TTL) |
| Rischio dati inconsistenti | Minore | Gestito da TTL e idempotenza |
