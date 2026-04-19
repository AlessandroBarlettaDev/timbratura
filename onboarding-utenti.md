# Onboarding Utenti — Riferimento Tecnico

Ogni nuovo dipendente o manager attraversa un flusso obbligatorio in due fasi prima di poter accedere alla dashboard: cambio password e registrazione biometrica. Il sistema lo impone tramite attributi Cognito e guard Angular, non tramite logica applicativa nel backend.

---

## Panoramica

```
Manager crea utente
  → Cognito invia email con credenziali temporanee
  → Utente fa login → /first-access (password cambiata? biometria registrata?)
  → Cambia password
  → Registra Face ID / Touch ID sul proprio dispositivo
  → Accede a /dashboard-employee o /dashboard-manager
```

I due attributi custom Cognito che pilotano il flusso:

| Attributo | Valori | Significato |
|---|---|---|
| `custom:password_changed` | `"false"` / `"true"` | Utente ha cambiato la password temporanea |
| `custom:biometrics_reg` | `"false"` / `"true"` | Utente ha registrato almeno un dispositivo biometrico |

Entrambi partono a `"false"` alla creazione dell'utente.

---

## 1. Creazione utente (manager)

`POST /users` — richiede JWT Cognito, solo manager.

Il backend chiama `AdminCreateUserCommand` con:

- `email`, `given_name`, `family_name` (obbligatori)
- `birthdate`, `custom:codice_fiscale` (opzionali)
- `custom:password_changed = "false"`
- `custom:biometrics_reg = "false"`
- Una password temporanea autogenerata: `Tmp_<random8char>!A1`

Subito dopo, `AdminAddUserToGroupCommand` aggiunge l'utente al gruppo `manager` o `employee` in base al campo `ruolo` nel body.

**Cognito invia automaticamente l'email di benvenuto** con il template `userInvitation` configurato in CDK, che include email, password temporanea e link diretto al login.

```
Oggetto: Benvenuto! Completa la registrazione al portale Timbratura

Ciao,
il tuo account sul portale Timbratura è stato creato.

Email: {username}
Password temporanea: {####}

[link al login]

Al primo accesso ti verrà chiesto di impostare una nuova password
e registrare il tuo dispositivo biometrico.
```

| File | Funzione |
|---|---|
| [backend/lib/lambda/users-handler.ts](backend/lib/lambda/users-handler.ts) | `createEmployee()` |
| [backend/lib/config/cognito.ts](backend/lib/config/cognito.ts) | template `userInvitation` |

---

## 2. Login e redirect a /first-access

L'utente accede con email + password temporanea. Amplify gestisce il flusso Cognito standard (incluso il caso `NEW_PASSWORD_REQUIRED` se Cognito forza il cambio).

Dopo il login, `onboardingGuard` controlla i due attributi:

```typescript
// auth.guard.ts — onboardingGuard
if (!auth.passwordChanged() || !auth.biometricsReg()) {
  router.navigate(['/first-access']);
  return false;
}
```

Finché uno dei due attributi è `"false"`, qualsiasi navigazione verso `/dashboard-employee` o `/dashboard-manager` viene bloccata e reindirizzata a `/first-access`.

---

## 3. /first-access — cambio password

Il componente `FirstAccess` gestisce il cambio password tramite Amplify. Quando l'utente salva la nuova password:

1. Amplify chiama `updatePassword()` su Cognito
2. Il frontend chiama `POST /users/password-changed`
3. Il backend imposta `custom:password_changed = "true"` su Cognito tramite `AdminUpdateUserAttributesCommand`

La pagina mostra subito dopo il form per la biometria, o lo mostra direttamente se la password era già stata cambiata in una sessione precedente.

---

## 4. /first-access — registrazione biometrica

Avviene tramite WebAuthn. Il dispositivo deve supportare un autenticatore platform (Face ID, Touch ID, Windows Hello). Chiavi USB esterne non sono accettate.

```
1. Frontend chiama POST /biometric/registration/start  (richiede JWT Cognito)
   → Backend genera challenge WebAuthn e la salva in DynamoDB (TTL 5 min)
   → Ritorna le options al browser

2. Browser chiama startRegistration({ optionsJSON: options })
   → Il sistema operativo mostra il prompt biometrico (Face ID, Touch ID...)
   → L'utente si autentica
   → Il dispositivo genera una coppia di chiavi e firma la challenge

3. Frontend chiama POST /biometric/registration/complete
   → Backend verifica la firma con verifyRegistrationResponse()
   → Salva la chiave pubblica in DynamoDB (WebAuthnCredentials)
   → Se l'utente aveva già un dispositivo registrato, viene sostituito

4. Frontend chiama POST /users/biometrics-registered
   → Backend imposta custom:biometrics_reg = "true" su Cognito

5. Frontend chiama fetchAuthSession({ forceRefresh: true })
   → Aggiorna il token Cognito con i nuovi custom claims
   → Naviga a /dashboard-manager o /dashboard-employee in base al gruppo
```

Il `forceRefresh` al punto 5 è necessario: i custom attributes Cognito sono inclusi nel token JWT, che altrimenti conterrebbe ancora `biometrics_reg = "false"` fino alla scadenza naturale.

| File | Funzione |
|---|---|
| [frontend/src/app/components/first-access/first-access.ts](frontend/src/app/components/first-access/first-access.ts) | `registerBiometrics()`, `navigateToDashboard()` |
| [backend/lib/lambda/biometric-handler.ts](backend/lib/lambda/biometric-handler.ts) | `startRegistration()`, `completeRegistration()` |
| [backend/lib/lambda/users-handler.ts](backend/lib/lambda/users-handler.ts) | `markBiometricsRegistered()`, `markPasswordChanged()` |

---

## 5. Accesso alla dashboard

`onboardingGuard` legge i due attributi dal token Cognito aggiornato:

- `custom:password_changed = "true"` ✓
- `custom:biometrics_reg = "true"` ✓

Solo con entrambi a `"true"` l'utente accede alla dashboard. Il guard controlla ad ogni navigazione — non solo al primo accesso.

---

## Reset da parte del manager

### Reset password

`POST /users/{id}/reset-password` — solo manager.

1. `AdminResetUserPasswordCommand` → Cognito invia email con nuova password temporanea
2. Backend imposta `custom:password_changed = "false"`
3. Al prossimo login l'`onboardingGuard` rimanda l'utente a `/first-access`

### Reset biometrica

`POST /users/{id}/reset-biometrics` — solo manager.

1. Query su DynamoDB `userId-index` per trovare tutte le credenziali dell'utente
2. `DeleteItemCommand` su ogni credenziale trovata
3. Backend imposta `custom:biometrics_reg = "false"`
4. Al prossimo login l'`onboardingGuard` rimanda l'utente a `/first-access` per la re-registrazione

### Eliminazione utente

`DELETE /users/{id}` — solo manager.

1. `AdminDeleteUserCommand` rimuove l'utente da Cognito
2. Query + delete su DynamoDB per rimuovere tutte le credenziali biometriche associate

La cancellazione è pulita: nessun orfano rimane in DynamoDB.

---

## Attributi Cognito — schema completo

| Attributo | Tipo | Mutabile | Uso |
|---|---|---|---|
| `email` | standard | no | Username e identificativo |
| `given_name` | standard | sì | Nome visualizzato |
| `family_name` | standard | sì | Cognome |
| `birthdate` | standard | sì | Data di nascita |
| `custom:codice_fiscale` | custom | sì | Codice fiscale |
| `custom:password_changed` | custom | sì | Flag onboarding: password |
| `custom:biometrics_reg` | custom | sì | Flag onboarding: biometria |
| `custom:role` | custom | sì | (non usato attivamente — il ruolo è determinato dal gruppo Cognito) |
| `custom:data_assunzione` | custom | sì | Data assunzione |
| `custom:termine_contratto` | custom | sì | Fine contratto |
