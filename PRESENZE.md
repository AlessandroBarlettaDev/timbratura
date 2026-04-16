# Presenze

**Periodo:** 12 marzo – 18 aprile 2026
**Totale:** 27 giorni × 6 ore = **162 ore**

| Giorno     | Ore | Attività |
|------------|-----|----------|
| Gio 12 Mar | 6 | Presentazione del tirocinio, configurazione account AWS e strumenti di sviluppo (Node.js, AWS CLI, Angular CLI) |
| Ven 13 Mar | 6 | Lettura requisiti del progetto, analisi del sistema di timbratura, studio architettura AWS serverless |

| Lun 16 Mar | 6 | Studio AWS CDK: stack, construct, deploy; primi esempi con Lambda e API Gateway |
| Mar 17 Mar | 6 | Approfondimento AWS Cognito: user pool, attributi custom, flusso di autenticazione |
| Mer 18 Mar | 6 | Studio DynamoDB: modellazione NoSQL, chiavi composte, GSI, pattern di query |
| Gio 19 Mar | 6 | Studio Angular 21: standalone components, routing, signals; setup progetto locale |
| Ven 20 Mar | 6 | Studio protocollo WebAuthn/FIDO2 e libreria SimpleWebAuthn per autenticazione biometrica |

| Lun 23 Mar | 6 | Progettazione architettura di sistema: diagramma componenti, flussi principali, decisioni tecniche |
| Mar 24 Mar | 6 | Modellazione schema DynamoDB: definizione tabelle, chiavi primarie e GSI per ogni entità |
| Mer 25 Mar | 6 | Definizione API REST: endpoint, payload request/response, autorizzazione con Cognito JWT |
| Gio 26 Mar | 6 | Prototipazione meccanismo QR dinamico per stazioni di timbratura; analisi flusso HMAC |
| Ven 27 Mar | 6 | Setup iniziale monorepo con AWS CDK, Cognito e DynamoDB — `ecd6046` |

| Lun 30 Mar | 6 | Scaffold backend CDK e progetto Angular, configurazione TypeScript e dipendenze npm — `a50c162` |
| Mar 31 Mar | 6 | Componenti frontend (dashboard, login, servizi API, auth-interceptor); UI dashboard manager con CRUD utenti — `2e6abf4`, `234e2ea` |
| Mer 01 Apr | 6 | Custom message Cognito, pagina profilo manager, gestione avanzata attributi utente — `b95400c` |
| Gio 02 Apr | 6 | Integrazione WebAuthn: registrazione credenziali biometriche, gestione stazioni di timbratura, login JWT stazione; fix UI e interceptor — `ac37672`, `f32a4ea` |
| Ven 03 Apr | 6 | Deploy frontend su CloudFront e backend timbrature su Lambda; flusso creazione utenti e aggiornamenti handler — `dc0e1ba`, `3edbb68`, `b109f3f` |

| Lun 06 Apr | 6 | Rifinitura flussi timbratura (anteprima/conferma con confirmToken e TTL), aggiornamento script di deployment — `bb6ece7` |
| Mar 07 Apr | 6 | Ottimizzazioni handler backend, aggiornamenti UI frontend, rideploy stack — `b98c36c` |
| Mer 08 Apr | 6 | Test del flusso completo di timbratura (QR → biometria → anteprima → conferma); analisi edge case GPS |
| Gio 09 Apr | 6 | Debug validazione WebAuthn su dispositivi diversi; test gestione richieste manuali e transizioni di stato |
| Ven 10 Apr | 6 | Implementazione richieste timbratura manuale, gestione turni, statistiche presenze e info sede — `335c55d` |

| Lun 13 Apr | 6 | Separazione ambienti dev/prod con CDK: stack separati, distribuzioni CloudFront, tabelle DynamoDB con suffisso — `bf597a5` |
| Mar 14 Apr | 6 | Studio e prototipazione modulo gestione contratti/orari: schema tabella Contracts, handler Lambda e endpoint API |
| Mer 15 Apr | 6 | Fix discrepanze README, rimozione pulsante biometrico da login, allineamento outputs CloudFormation dev/prod — `f833349`, `97f21bf`, `04fe3be`, `3088b76` |
| Gio 16 Apr | 6 | Implementazione reset password via email (manager) e reset biometria con approvazione manager: nuova rotta `POST /users/{id}/reset-password`, branch `reset_biometria` in `approvaRequest`, aggiornamento IAM, API service e UI dashboard manager/dipendente |
| Ven 17 Apr | 6 | Test, revisione finale del progetto e documentazione |

---

**Giorni con commit:** 11
**Giorni senza commit:** 16
**Commit totali:** 18
