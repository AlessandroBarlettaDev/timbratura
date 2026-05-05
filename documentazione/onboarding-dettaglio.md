# Onboarding Utenti — Macchina a Stati

## Il problema dell'accesso condizionato

Un sistema che usa la biometria per l'autenticazione ha un requisito peculiare: prima che l'utente possa usare la biometria, deve registrarla. E prima di registrarla, deve avere un account attivo con una password personale (non la password temporanea assegnata dal manager).

Questo crea una sequenza obbligata di passaggi che il sistema deve imporre — non bastano le istruzioni nella email di benvenuto, perché un utente potrebbe saltarle o non completarle.

## La macchina a stati

L'onboarding è modellato come una macchina a stati con due variabili booleane salvate come attributi custom in AWS Cognito:

```
custom:password_changed   = "false" | "true"
custom:biometrics_reg     = "false" | "true"
```

Questi attributi sono inclusi nel JWT Cognito alla voce `cognito:custom`, e vengono letti dal frontend all'avvio. I quattro stati possibili:

```
Stato 0: password_changed=false, biometrics_reg=false
         → utente appena creato, deve fare tutto
         → reindirizzato a /first-access (step: cambio password)

Stato 1: password_changed=true, biometrics_reg=false
         → ha cambiato password, deve registrare biometria
         → reindirizzato a /first-access (step: registrazione biometrica)

Stato 2: password_changed=false, biometrics_reg=true
         → stato teoricamente impossibile (la registrazione richiede
           l'autenticazione Cognito, che richiede la password cambiata)
         → trattato come Stato 0 per sicurezza

Stato 3: password_changed=true, biometrics_reg=true
         → onboarding completato, accesso alla dashboard
```

## Il guard Angular

In Angular, le route guard sono funzioni eseguite prima di ogni navigazione. Il componente `onboardingGuard` verifica lo stato degli attributi e reindirizza se necessario:

```typescript
// auth.guard.ts
export const onboardingGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (!auth.passwordChanged() || !auth.biometricsReg()) {
    router.navigate(['/first-access']);
    return false;
  }
  return true;
};
```

Il guard è applicato a tutte le route protette (`/dashboard-employee`, `/dashboard-manager`). Ogni volta che il dipendente naviga verso queste pagine — non solo al primo accesso — il guard ri-verifica gli attributi. Questo garantisce che se un manager resetta la biometria o la password di un dipendente, la prossima navigazione lo reindirizzi automaticamente a completare il passaggio mancante.

## Fase 1 — Creazione utente (manager)

Il manager crea un nuovo account dalla dashboard:

```
POST /users
{
  "email": "mario.rossi@azienda.it",
  "nome": "Mario",
  "cognome": "Rossi",
  "ruolo": "employee"
}
```

Il backend chiama `AdminCreateUser` su Cognito con:
- password temporanea autogenerata nel formato `Tmp_<8char random>!A1`
- `custom:password_changed = "false"`
- `custom:biometrics_reg = "false"`
- `email_verified = true` (skip del processo di verifica email)

Immediatamente dopo, `AdminAddUserToGroup` aggiunge l'utente al gruppo `employee` o `manager`.

Cognito invia automaticamente l'email di benvenuto con il template configurato in CDK, che include email, password temporanea e link al login.

## Fase 2 — Cambio password

Al primo login, Amplify riconosce il flag Cognito `FORCE_CHANGE_PASSWORD` (implicito nelle utenze create con `AdminCreateUser`) e forza il cambio password prima di completare l'autenticazione. Il componente `FirstAccess` gestisce questo passaggio:

```typescript
async cambiaPassword(nuovaPassword: string) {
  // Amplify gestisce il challenge NEW_PASSWORD_REQUIRED
  await updatePassword({ oldPassword: this.tempPassword, newPassword: nuovaPassword });

  // notifica il backend per aggiornare l'attributo Cognito
  await this.apiService.markPasswordChanged().toPromise();

  // avanza al passo successivo: registrazione biometrica
  this.step = 'biometria';
}
```

`POST /users/password-changed` imposta `custom:password_changed = "true"` su Cognito tramite `AdminUpdateUserAttributes`. Il token JWT non viene aggiornato automaticamente — viene rigenerato solo al prossimo login o con `fetchAuthSession({ forceRefresh: true })`.

## Fase 3 — Registrazione biometrica

Completato il cambio password, il componente mostra il form per registrare la biometria. Il flusso WebAuthn è descritto in dettaglio in [webauthn-fido2.md](webauthn-fido2.md). Al termine:

1. La chiave pubblica è salvata in DynamoDB (`WebAuthnCredentials`)
2. `POST /users/biometrics-registered` imposta `custom:biometrics_reg = "true"`
3. Il frontend chiama `fetchAuthSession({ forceRefresh: true })` per aggiornare il JWT con i nuovi attributi
4. L'`onboardingGuard` ri-valuta — ora entrambi gli attributi sono `"true"` → redirect alla dashboard

Il `forceRefresh` al punto 3 è essenziale: senza di esso, il JWT in cache conterrebbe ancora `biometrics_reg = "false"` e il guard continuerei a bloccare la navigazione nonostante l'onboarding completato.

## Reset da parte del manager

Il manager può resettare password o biometria di un dipendente dalla sua dashboard. Entrambi i reset riportano il dipendente a uno stato intermedio dell'onboarding:

**Reset password** (`POST /users/{id}/reset-password`):
- Cognito invia email con nuova password temporanea
- Backend imposta `custom:password_changed = "false"`
- Al prossimo login: Amplify forza il cambio password (Stato 0 → Fase 2)

**Reset biometria** (`POST /users/{id}/reset-biometrics`):
- Cancella tutte le credenziali WebAuthn in DynamoDB
- Imposta `custom:biometrics_reg = "false"`
- Al prossimo tentativo di accedere alla dashboard: guard reindirizzia a `/first-access` (Stato 1 → Fase 3)

Il dipendente può anche richiedere il reset biometria autonomamente (es. cambio dispositivo) tramite il sistema di richieste manuali — in quel caso il reset avviene solo dopo l'approvazione del manager.

## Schema riassuntivo

```
Manager crea utente
    │
    ▼
Email automatica Cognito
(password temporanea + link login)
    │
    ▼
Dipendente fa login
    │
    ├─ Amplify: FORCE_CHANGE_PASSWORD
    │
    ▼
/first-access — Step 1: cambio password
    │  custom:password_changed → "true"
    ▼
/first-access — Step 2: registrazione biometrica
    │  chiave pubblica → DynamoDB
    │  custom:biometrics_reg → "true"
    │  fetchAuthSession(forceRefresh)
    ▼
/dashboard-employee o /dashboard-manager
```
