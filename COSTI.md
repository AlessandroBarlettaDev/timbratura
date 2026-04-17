# Stima costi AWS — Sistema di Timbratura

**Regione:** eu-west-1 (Irlanda)  
**Aggiornato:** aprile 2026  
**Prezzi di riferimento:** [AWS Pricing Calculator](https://calculator.aws)

---

## Architettura

Il sistema è interamente **serverless**: non ci sono server sempre accesi. I costi si pagano solo per le risorse effettivamente utilizzate. L'infrastruttura comprende:

- **API Gateway** — gateway HTTP per tutte le chiamate frontend/stazioni
- **Lambda** — 7 funzioni che eseguono la logica applicativa
- **DynamoDB** — 6 tabelle NoSQL (modalità PAY_PER_REQUEST)
- **Cognito** — autenticazione e gestione utenti
- **S3 + CloudFront** — hosting del frontend Angular
- **Due ambienti separati** — `prod` (produzione) e `dev` (sviluppo/test)

---

## Ipotesi di utilizzo (scenario realistico)

| Parametro | Valore stimato |
|---|---|
| Dipendenti attivi | 20 |
| Timbrature al giorno | ~40 (entrata + uscita per dipendente) |
| Timbrature al mese | ~880 |
| Accessi alla dashboard al giorno | ~30 |
| Chiamate API totali al mese | ~15.000 |
| Dati totali in DynamoDB | < 100 MB |

---

## Costi per servizio

### DynamoDB — PAY_PER_REQUEST

Non viene pre-allocata nessuna capacità. Si paga solo per le operazioni effettuate.

#### Ambiente di produzione

| Voce | Quantità/mese | Prezzo unitario | Costo |
|---|---|---|---|
| Write Request Units | ~5.000 | $1.42 / milione | $0.01 |
| Read Request Units | ~50.000 | $0.28 / milione | $0.01 |
| Storage | < 100 MB | $0.28 / GB (primi 25 GB gratis) | $0.00 |
| **Totale prod** | | | **~$0.02/mese** |

#### Ambiente di sviluppo (dev)

L'ambiente dev esegue lo stesso codice di prod, inclusa la scrittura dell'**audit trail**. Durante lo sviluppo ogni chiamata di test genera una voce su DynamoDB: con sessioni intensive di debug/test il numero di scritture può essere **10–50× superiore** a quello di produzione.

| Scenario | WRU extra/mese | Costo aggiuntivo |
|---|---|---|
| Sviluppo leggero (poche sessioni) | ~10.000 | ~$0.01 |
| Sviluppo intensivo (test frequenti) | ~100.000 | ~$0.14 |

> **Mitigazione applicata:** la variabile d'ambiente `AUDIT_ENABLED` permette di disabilitare la scrittura dell'audit in dev, azzerando questo overhead. Vedi sezione [Ottimizzazioni](#ottimizzazioni).

> Con un numero maggiore di dipendenti (es. 200) i costi di prod scalano linearmente: ~$0.20/mese.

---

### AWS Lambda

| Voce | Valore | Free tier | Costo |
|---|---|---|---|
| Invocazioni/mese | ~15.000 | 1.000.000 gratis | $0.00 |
| Durata media per invocazione | 300 ms, 128 MB | 400.000 GB-sec gratis | $0.00 |
| **Totale Lambda** | | | **$0.00/mese** |

Il free tier Lambda è **permanente** (non scade dopo 12 mesi). Con 15.000 invocazioni/mese si usa meno del 2% del limite gratuito.

---

### API Gateway (REST)

| Periodo | Invocazioni/mese | Costo |
|---|---|---|
| Primi 12 mesi | ~15.000 | $0.00 (1M/mese gratis) |
| Dal 13° mese | ~15.000 | $0.05 ($3.50 / milione) |

---

### Amazon Cognito

| Voce | Valore | Free tier | Costo |
|---|---|---|---|
| Utenti attivi al mese (MAU) | 20 | 50.000 MAU gratis — permanente | $0.00 |
| **Totale Cognito** | | | **$0.00/mese** |

Il free tier Cognito copre fino a 50.000 utenti attivi al mese senza scadenza. Per un'azienda fino a quella soglia il costo è sempre zero.

---

### S3 + CloudFront (hosting frontend)

| Voce | Valore | Free tier | Costo |
|---|---|---|---|
| Storage S3 (bundle Angular) | ~2 MB | 5 GB gratis (12 mesi) | $0.00 |
| Traffico CloudFront | ~500 MB/mese | 1 TB/mese gratis (12 mesi) | $0.00 |
| Dal 13° mese — traffico | ~500 MB/mese | — | $0.004 ($0.0085/GB) |
| **Totale hosting** | | | **~$0.00–0.01/mese** |

---

## Riepilogo

### Primo anno (free tier attivo)

| Servizio | Prod | Dev (audit ON) | Dev (audit OFF) |
|---|---|---|---|
| DynamoDB | ~$0.02 | ~$0.05–0.16 | ~$0.00 |
| Lambda | $0.00 | $0.00 | $0.00 |
| API Gateway | $0.00 | $0.00 | $0.00 |
| Cognito | $0.00 | $0.00 | $0.00 |
| S3 + CloudFront | $0.00 | $0.00 | $0.00 |
| **Totale mensile** | **~$0.02** | **~$0.07–0.18** | **~$0.02** |
| **Totale annuo** | **~$0.24** | **~$0.84–2.16** | **~$0.24** |

### Dal secondo anno in poi

| Servizio | Prod | Dev (audit OFF) |
|---|---|---|
| DynamoDB | ~$0.02 | ~$0.00 |
| Lambda | $0.00 | $0.00 |
| API Gateway | ~$0.05 | ~$0.00 |
| Cognito | $0.00 | $0.00 |
| S3 + CloudFront | ~$0.01 | $0.00 |
| **Totale mensile** | **~$0.08** | **~$0.00** |
| **Totale annuo** | **~$1.00** | **~$0.00** |

---

## Scalabilità

Il modello PAY_PER_REQUEST garantisce che i costi crescano proporzionalmente all'utilizzo reale. La tabella seguente mostra la stima al crescere dell'organizzazione:

| Dipendenti | Timbrature/mese | Costo DynamoDB | Costo totale stimato |
|---|---|---|---|
| 20 | ~880 | ~$0.02 | ~$0.08/mese |
| 100 | ~4.400 | ~$0.08 | ~$0.15/mese |
| 500 | ~22.000 | ~$0.35 | ~$0.45/mese |
| 2.000 | ~88.000 | ~$1.40 | ~$1.60/mese |

Anche a 2.000 dipendenti il costo mensile rimane sotto i **$2.00**, grazie alla natura serverless dell'architettura.

---

## Ottimizzazioni

### Audit disabilitato in dev

Durante lo sviluppo ogni chiamata di test (login, timbratura, modifica utente, ecc.) genera una scrittura sulla tabella `AuditLog`. Con sessioni intensive di debug questo può produrre decine di migliaia di WRU/mese extra, superando il free tier.

**Soluzione implementata:** la variabile d'ambiente `AUDIT_ENABLED` è impostata automaticamente da CDK in base all'ambiente di deploy:

```typescript
// backend-stack.ts — calcolato una volta sola e passato a tutte le Lambda
const auditEnabled = props?.deployEnv ? 'false' : 'true';
```

| Ambiente | `AUDIT_ENABLED` | Scritture audit |
|---|---|---|
| Produzione (`./deploy.sh`) | `true` | abilitate |
| Sviluppo (`./deploy.sh dev`) | `false` | soppresse |

La funzione `writeAudit()` in `audit.ts` controlla il flag come prima istruzione:

```typescript
if (process.env.AUDIT_ENABLED === 'false') return;
```

Non serve nessuna modifica manuale: il comportamento corretto è garantito dal deploy script.

---

## Note

- I prezzi si riferiscono alla regione **eu-west-1** e possono variare nel tempo. Verificare sempre sul sito AWS.
- **Il deploy CDK non ha costi rilevanti**: CloudFormation è gratuito, i bundle Lambda (~35 MB a deploy) vengono caricati su S3 e rientrano ampiamente nel free tier. Costo stimato per deploy: < $0.001.
- Non sono inclusi eventuali costi di **Route 53** (DNS): circa $0.50/mese per una hosted zone, se si usa un dominio personalizzato.
- Non è incluso il costo del **dominio** (acquistato separatamente presso un registrar).
