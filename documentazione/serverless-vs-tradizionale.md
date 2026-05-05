# Serverless vs Architettura Tradizionale

## Il modello tradizionale

Nell'approccio classico un'applicazione web viene eseguita su uno o più server sempre attivi. Il server rimane in ascolto 24 ore su 24 in attesa di richieste, anche nei periodi in cui non arriva nessun traffico. Il team deve stimare in anticipo quanta capacità servirà (CPU, RAM, disco), acquistare o affittare le macchine di conseguenza, aggiornarle, monitorarle e sostituirle in caso di guasto.

Esempi tipici: un server Node.js/Express, un server Spring Boot, un server Django — tutti processi che rimangono vivi in memoria tra una richiesta e l'altra.

## Il modello serverless

Nel modello serverless il codice applicativo viene impacchettato in **funzioni** (nel caso di AWS: Lambda). Ogni funzione:

- viene eseguita **solo quando arriva una richiesta**
- si avvia in millisecondi, elabora la richiesta, e si ferma
- non mantiene stato tra un'invocazione e l'altra (**stateless**)
- scala automaticamente: se arrivano 1000 richieste contemporanee, AWS avvia 1000 istanze della funzione in parallelo

Il termine "serverless" non significa che i server non esistano — esistono, ma sono gestiti interamente dal cloud provider. Lo sviluppatore non li vede, non li configura e non li paga quando sono fermi.

## Perché è stato scelto per questo progetto

Un sistema di timbratura ha un profilo di traffico **fortemente irregolare**:

- picco di richieste alle 08:00–09:00 (entrate) e alle 17:00–18:00 (uscite)
- traffico quasi nullo nelle ore centrali della giornata e di notte
- picchi occasionali durante eventi aziendali o chiusure straordinarie

Con un server tradizionale bisognerebbe dimensionarlo per il picco massimo, pagandolo anche nelle ore di silenzio. Con Lambda si paga solo per le invocazioni effettive, in incrementi di 1 ms.

Le motivazioni specifiche della scelta:

| Criterio | Server tradizionale | AWS Lambda |
|---|---|---|
| Gestione infrastruttura | Richiede configurazione, patching, monitoring | Zero — gestita da AWS |
| Scaling | Manuale o con autoscaling configurato | Automatico, immediato |
| Costo a riposo | Server sempre acceso = costo fisso | Zero invocazioni = zero costo |
| Disponibilità | Dipende dalla configurazione HA | 99.95% SLA garantito da AWS |
| Deployment | Richiede CI/CD su macchine | `cdk deploy` aggiorna il codice in secondi |

## Limiti del modello serverless

### Cold start

Quando una funzione Lambda non viene invocata da un po', AWS dealloca il container. Alla prima richiesta successiva deve riavviarlo — questo introduce una latenza aggiuntiva chiamata **cold start**, tipicamente tra 200 ms e 1 secondo per Node.js.

Nel contesto di questo sistema il cold start è accettabile: le timbrature non sono operazioni in tempo reale critico, e i picchi di traffico (tutti i dipendenti che entrano alle 09:00) mantengono le Lambda "calde" durante le ore di punta.

### Statelessness obbligatoria

Una Lambda non può tenere nulla in memoria tra una chiamata e l'altra. Ogni informazione deve essere letta e scritta su uno storage esterno (DynamoDB, S3). Questo ha influenzato alcune scelte progettuali:

- la **pending-entry** (fase anteprima della timbratura) viene salvata su DynamoDB invece che in memoria
- il **token JWT** della stazione viene verificato ricostruendo l'HMAC ogni volta, senza cache
- le **challenge WebAuthn** vengono salvate su DynamoDB con TTL, non in sessione

### Limite di durata

Una Lambda può girare al massimo 15 minuti. Non è un vincolo rilevante per questo sistema (ogni richiesta si completa in poche centinaia di millisecondi), ma escluderebbe scenari come elaborazioni batch lunghe.

### Concorrenza e limiti di account

AWS impone un limite di concorrenza per account (default 1000 Lambda simultanee). Per un sistema aziendale di piccole-medie dimensioni questo limite non viene mai raggiunto, ma andrebbe considerato in un contesto enterprise.

## Struttura delle sei Lambda del progetto

Il backend è suddiviso in sei funzioni, ciascuna responsabile di un dominio:

```
users-handler       → gestione dipendenti e manager (CRUD, reset password/biometria)
biometric-handler   → registrazione e autenticazione WebAuthn
stations-handler    → gestione stazioni, login, generazione QR
timbrature-handler  → flusso di timbratura (anteprima + conferma + lettura)
requests-handler    → richieste manuali (creazione, approvazione, rifiuto)
contracts-handler   → gestione contratti di lavoro
```

Ogni Lambda è indipendente: un errore in `contracts-handler` non impatta la disponibilità di `timbrature-handler`. Questo approccio, ispirato ai principi dei microservizi, migliora l'isolamento dei guasti e permette di aggiornare un singolo handler senza ridistribuire l'intero backend.

## Infrastructure as Code con AWS CDK

L'intera infrastruttura è definita in TypeScript tramite AWS CDK, lo stesso linguaggio del codice applicativo. Un singolo comando (`cdk deploy`) crea o aggiorna tutte le risorse AWS:

```
BackendStack
├── S3 + CloudFront        (hosting frontend Angular)
├── Cognito User Pool      (autenticazione manager/employee)
├── DynamoDB (5 tabelle)   (dati applicativi)
├── API Gateway            (routing HTTP → Lambda)
└── Lambda (6 funzioni)    (logica applicativa)
```

L'approccio Infrastructure as Code garantisce che l'ambiente di sviluppo e quello di produzione siano identici, eliminando la classe di bug "funziona in locale, non in produzione" legata a differenze di configurazione.
