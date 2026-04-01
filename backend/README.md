# Backend – Timbratura (AWS CDK)

Infrastruttura AWS del progetto Timbratura, definita con CDK TypeScript.

## Comandi utili

* `npm run build`   compila TypeScript in JS
* `npm run watch`   ricompila automaticamente al salvataggio
* `npx cdk deploy`  deploya lo stack sull'account/regione AWS configurato
* `npx cdk diff`    mostra le differenze rispetto allo stack deployato
* `npx cdk synth`   genera il template CloudFormation senza deployare

---

## Problemi noti e soluzioni

### Email di benvenuto non recapitata

**Problema**
Quando viene creato un nuovo utente tramite `AdminCreateUser`, Cognito deve inviare un'email con la password temporanea. L'email non arrivava.

**Causa**
Il template personalizzato (Lambda trigger `CustomMessage_AdminCreateUser`) restituiva un `emailMessage` senza il placeholder `{####}`, richiesto obbligatoriamente da Cognito per inserire la password temporanea. Cognito scartava il messaggio silenziosamente e inviava l'email di default.

In una fase successiva, il pool era configurato in modalità `DEVELOPER` (SES). SES in sandbox mode permette di inviare email **solo verso indirizzi verificati**. Le email verso indirizzi non verificati vengono scartate silenziosamente senza errori.

**Soluzioni**

1. **Usare `COGNITO_DEFAULT`** *(scelta attuale)*  
   Cognito gestisce l'invio direttamente, senza SES e senza restrizioni sandbox. Limite: 50 email/giorno, sufficiente per sviluppo e tesi.  
   Configurazione CDK: `email: cognito.UserPoolEmail.withCognito()`

2. **Verificare ogni indirizzo destinatario in SES** *(solo per test)*  
   ```bash
   aws sesv2 create-email-identity --email-identity destinatario@esempio.it --region eu-west-1
   ```
   AWS invia un link di verifica. Non scalabile per produzione.

3. **Richiedere SES production access** *(soluzione produzione)*  
   Dal pannello SES → Account dashboard → "Request production access".  
   Rimuove il limite sandbox e permette l'invio verso qualsiasi indirizzo.  
   Richiede approvazione AWS (1–2 giorni lavorativi).
