# Sviluppi futuri

Funzionalità pianificate ma non ancora implementate. Ogni sezione descrive il problema corrente, l'approccio proposto e la complessità stimata.

---

## Gestione assenze

Oggi un giorno senza timbrature è semplicemente vuoto — il sistema non distingue tra assenza ingiustificata, ferie, malattia o festività. Questo gonfia le "ore mancanti" nell'export Excel e non permette al manager di capire lo stato reale della presenza.

**Modello dati — tabella `Assenze`**
```
PK: assenzaId (UUID)
GSI: userId-index → userId (PK) + dataInizio (SK)

Campi: userId, tipo, dataInizio, dataFine, ore (per permessi parziali),
       nota, stato (approvata/pendente/rifiutata), approvataDa, createdAt
```
I tipi previsti: `ferie` | `permesso` | `malattia` | `festività` | `altro`. Il range `dataInizio/dataFine` gestisce sia i giorni singoli che i periodi multi-giorno.

**Festività**
Tabella separata `Festività` con `data` + `descrizione`, configurata dal manager una volta all'anno (festività nazionali + locali). Non è per dipendente — vale globalmente per tutti.

**Flussi per tipo**

| Tipo | Chi crea | Approvazione |
|---|---|---|
| Ferie / Permesso / ROL | Dipendente richiede | Manager approva |
| Malattia | Manager inserisce | Automaticamente approvata |
| Festività | Manager configura calendario | N/A — globale |

**Impatto sull'export Excel**
Con le assenze, la sezione "Analisi periodo" diventa precisa:
```
Giorni lavorativi attesi:     23
  di cui festività:            1
  di cui ferie/permessi:       5
Giorni effettivamente dovuti: 17   ← attesi - giustificati
Ore contrattuali dovute:     136h  ← solo i giorni dovuti
Ore lavorate:                138h
Ore straordinarie:             2h  ← rispetto ai giorni dovuti
```
Senza questo, una settimana di ferie appare come 40h di assenza ingiustificata.

**Complessità per fase:** CRUD assenze e visualizzazione dashboard = semplice. Integrazione nel calcolo Excel = medio. Permessi parziali in ore con sovrapposizione sulle timbrature dello stesso giorno = complesso.

---

## Gestione turni (Scheduling)

La logica attuale determina entrata/uscita guardando l'ultima timbratura assoluta con una soglia di 20 ore (turno notturno coperto; uscita dimenticata da >20h = nuovo turno). Per aziende con turni a rotazione formalizzati (fabbrica, ospedale, sicurezza) sarebbe utile un sistema di turni esplicito:

- **Template turni:** definire finestre ricorrenti (es. Mattina 06:00–14:00, Pomeriggio 14:00–22:00, Notte 22:00–06:00)
- **Assegnazione dipendente:** ogni dipendente ha un turno attivo (o una rotazione settimanale/mensile)
- **Logica basata sul turno:** il sistema determina entrata/uscita in base alla finestra attiva del dipendente, indipendentemente dalla soglia temporale
- **Validazione orari:** avviso se si timbra fuori dalla finestra prevista (es. 2h prima dell'inizio turno)
- **Presenze previste vs reali:** il manager vede chi doveva essere presente ma non ha timbrato

Prerequisiti: due nuove tabelle DynamoDB (`ScheduleTemplates`, `ScheduleAssignments`), nuova Lambda `schedules-handler`, UI di gestione in dashboard manager, aggiornamento della logica anomalie in `timbrature-handler.ts`. Il piano di implementazione completo con modello dati, algoritmo di risoluzione a cascata e ordine di deploy è in [piano-sistema-orari.md](piano-sistema-orari.md).

---

## Chiusura automatica turno (uscita forzata)

Se un dipendente non timbra uscita entro 9 ore dall'entrata, il sistema può chiudere automaticamente il turno con un'**uscita forzata** al timestamp `entrata + 9h`, richiedendo una spiegazione obbligatoria.

**Approccio senza infrastruttura aggiuntiva (implementazione immediata)**
La forzatura avviene al momento della timbratura successiva — quando il dipendente scansiona il QR per una nuova entrata, il backend rileva il turno aperto da più di 9 ore, inserisce automaticamente l'`uscita_forzata` a `entrata + 9h`, e prima di confermare la nuova entrata mostra un modale obbligatorio dove il dipendente deve selezionare il motivo:

- *Straordinario autorizzato*
- *Riunione / imprevisto*
- *Emergenza*
- *Dimenticanza*
- *Altro* (con nota libera obbligatoria)

Se il dipendente timbra uscita normalmente dopo le 9 ore (senza che sia arrivata una nuova entrata), lo stesso modale appare prima della conferma e l'uscita viene salvata con il timestamp reale — non viene creata alcuna uscita forzata separata.

La spiegazione è salvata nel record della timbratura e visibile al manager nella vista timbrature del dipendente.

**Approccio con EventBridge (per chiusura realmente automatica)**
Una Lambda schedulata (EventBridge cron ogni 30 minuti) scansiona i turni aperti da più di 9 ore e inserisce l'`uscita_forzata` indipendentemente dall'attività del dipendente. Il dipendente viene notificato (email via SES o avviso in-app al prossimo login) e deve fornire la spiegazione entro 24 ore; in assenza di risposta il manager riceve un avviso. Richiede: EventBridge Rule, SES production access, gestione dello stato "spiegazione pendente".

**Soglia 9 ore**
Corrisponde a un turno di 8 ore + 1 ora di margine (pausa pranzo inclusa). Configurabile tramite la costante `USCITA_FORZATA_ORE` nel backend, indipendente da `TURNO_MAX_ORE` (20 ore, usata per la logica entrata/uscita). Con la **Gestione turni** questa soglia potrebbe essere derivata direttamente dalla finestra del turno assegnato al dipendente, eliminando la necessità di un valore fisso.

---

## Storico richieste per il manager

Le richieste scompaiono dalla lista pendenti una volta gestite. Aggiungere una vista storico (approvate + rifiutate) filtrabile per dipendente e periodo.

Non richiede modifiche al modello dati — `stato` è già salvato. Serve solo una nuova query sulla tabella `Requests` e una UI dedicata in dashboard manager.

---

## Notifiche via email

Avvisi automatici che oggi non esistono:
- Richiesta approvata/rifiutata → email al dipendente
- Entrata non registrata oltre l'orario previsto
- Uscita dimenticata a fine turno

Richiede migrazione a **SES production** (il sandbox Cognito è limitato a 50 email/giorno e solo verso indirizzi verificati). Le Lambda devono ricevere il permesso `ses:SendEmail` e avere il `FROM_ADDRESS` configurato come env var.

---

## Export avanzati

- **Export PDF firmato digitalmente** delle timbrature (valore legale per contenziosi)
- **Export per cedolini paga** in formato UNIEMENS o similare
- **Scheduling automatico**: Lambda schedulata con EventBridge che genera ed invia l'export mensile via email al manager senza intervento manuale

Nota: l'export Excel attuale include già anagrafica, dati contrattuali, analisi del periodo (ore attese/lavorate, straordinari, stima stipendio) e tabella turni con ore decimali. Il limite attuale è che i festivi non vengono ancora dedotti dal conteggio giorni lavorativi attesi — questo dipende dalla mancanza della **Gestione assenze** descritta sopra.

---

## Modalità offline per la stazione

Il flusso di timbratura richiede connettività per tre operazioni: verifica biometrica (chiave pubblica in DynamoDB), firma HMAC del QR (JWT_SECRET server-side), salvataggio della timbratura. Quattro approcci possibili:

**Opzione 1 — Batch prefetch (consigliata per offline breve)**
La stazione, mentre è online, chiama un endpoint `GET /stazioni/me/qr?batch=N` che restituisce N token pre-firmati, ciascuno con il proprio `expiresAt` progressivo. La stazione li usa in ordine offline. 500 token × 3 minuti = ~25 ore di copertura. La verifica backend non cambia. Rischio: se la stazione è compromessa, l'attaccante ottiene tutti i token ancora validi — rischio già implicito nell'architettura attuale con token singolo.

**Opzione 2 — Crittografia asimmetrica (consigliata per offline strutturale)**
Ogni stazione ha una coppia di chiavi generata al momento della creazione: la chiave privata rimane sul dispositivo e non esce mai, la pubblica viene registrata in DynamoDB. Offline, la stazione firma i QR autonomamente con la propria chiave privata. Il backend verifica con la chiave pubblica. La compromissione di una stazione non impatta le altre. Richiede: cambio del formato token QR, procedura di provisioning al setup, gestione revoca.

**Opzione 3 — Sincronizzazione postuma**
Non risolve il problema del QR — senza connessione la stazione non può mostrare un token valido. Utile solo per il caso in cui la connessione cada a metà di una timbratura già avviata.

**Opzione 4 — Secret derivato per stazione**
Secret per stazione derivato da un master secret tramite KDF: `HMAC(masterSecret, stationId)`. Isola la compromissione per stazione, ma il master secret rimane un singolo punto di fallimento. Aggiunge complessità rispetto all'Opzione 1 senza vantaggi concreti rispetto all'Opzione 2.

| Scenario | Scelta |
|---|---|
| Disconnessioni brevi (minuti/ore), ufficio o negozio | Opzione 1 — batch prefetch |
| Offline strutturale (cantiere, nave, zona senza rete) | Opzione 2 — asimmetrica |
| Non si vuole toccare il backend | SIM/4G come connessione di failover sul dispositivo stazione |

---

## Webhook per eventi

Notifiche push verso endpoint configurati dal cliente quando:
- Una timbratura viene registrata
- Una richiesta manuale viene approvata/rifiutata
- Un dipendente supera X ore di straordinario

Il backend chiama l'endpoint esterno in modo non bloccante (fire-and-forget con retry) dopo aver salvato l'evento. Il cliente configura l'URL e il segreto di firma HMAC per verificare l'autenticità del payload.

---

## Note per il deploy in produzione

Prima di aprire il sistema a utenti reali:

- Migrare l'invio email da `COGNITO_DEFAULT` (50 email/giorno, solo indirizzi verificati) a **SES production**
- Configurare un dominio personalizzato per CloudFront e API Gateway
- Restringere ulteriormente i permessi IAM delle Lambda (principio del minimo privilegio)
- Abilitare DynamoDB Point-in-Time Recovery (PITR) per backup continuo
- Aggiungere log di audit (user agent) ad ogni timbratura e approvazione — l'IP non è affidabile su rete mobile (CGNAT): la validazione geografica è già garantita dal GPS
