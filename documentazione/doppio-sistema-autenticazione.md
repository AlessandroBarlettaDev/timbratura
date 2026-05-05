# Doppio Sistema di Autenticazione

## Il problema

Il sistema ha due tipi di attori fondamentalmente diversi:

- **Dipendenti e manager**: persone fisiche con email, che effettuano login interattivo, cambiano password, registrano biometria
- **Stazioni**: dispositivi hardware (tablet/PC) collocati fisicamente in azienda, che non hanno email, non fanno MFA, rimangono connessi 24 ore su 24

Usare lo stesso sistema di autenticazione per entrambi sarebbe tecnicamente possibile, ma architetturalmente scorretto. I due attori hanno cicli di vita, requisiti di sicurezza e modalità d'uso radicalmente diversi.

## Soluzione: due sistemi separati

### AWS Cognito per dipendenti e manager

Cognito è un servizio di identity management che gestisce:
- creazione account (solo il manager può creare utenti — self-signup disabilitato)
- login con email + password
- emissione di token JWT firmati con chiave asimmetrica (RS256)
- gestione attributi custom (`password_changed`, `biometrics_reg`)
- gruppi (`manager`, `employee`) inclusi nel token per il controllo degli accessi
- reset password tramite email con codice OTP

Il token Cognito viene verificato da **API Gateway** prima che la richiesta raggiunga la Lambda, quindi le Lambda protette da Cognito non devono implementare alcuna logica di autenticazione — si fidano dei claims già verificati.

```typescript
// auth.ts — estrae i claims già verificati da API Gateway
export function getJwtClaims(event: APIGatewayProxyEvent) {
  return event.requestContext.authorizer?.claims ?? null;
}

export function isManagerClaims(claims: any): boolean {
  const groups = claims['cognito:groups'] ?? '';
  return groups.includes('manager');
}
```

### JWT custom HS256 per le stazioni

Le stazioni si autenticano con una chiamata pubblica (nessun token richiesto):

```
POST /stazioni/login
{ "codice": "STZ-4A7F2B", "password": "..." }
→ { "token": "<JWT HS256 24h>", "stazione": { stationId, descrizione, codice } }
```

Il backend verifica codice e password (hash bcrypt in DynamoDB), poi genera un JWT firmato con algoritmo HS256 e chiave simmetrica `JWT_SECRET`:

```typescript
const token = jwt.sign(
  { stationId, codice },
  JWT_SECRET,
  { expiresIn: '24h' }
);
```

Questo token viene salvato nel `localStorage` della stazione e usato per le chiamate successive (`GET /stazioni/me/qr`, `POST /stazioni/me/position`). La verifica avviene interamente dentro la Lambda, non da API Gateway:

```typescript
// stations-handler.ts
const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
const stationId = decoded.stationId;
```

### Perché non Cognito per le stazioni?

| Requisito | Dipendenti/Manager | Stazioni |
|---|---|---|
| Identità con email | Sì | No — non hanno email |
| Login interattivo | Sì | No — login automatico all'avvio |
| MFA | Possibile | Non applicabile |
| Reset password via email | Sì | No — reset manuale dal manager |
| Scadenza sessione | Token JWT ~1 ora | Token 24h, rinnovo automatico |
| Ciclo di vita | Dipende dall'impiegato | Dipende dalla vita del dispositivo |

Creare un utente Cognito per ogni stazione significherebbe simulare un comportamento umano su un account non umano, aggiungendo complessità inutile e limitazioni (Cognito forza il cambio password al primo login, gestisce MFA, invia email — nulla di questo ha senso per un dispositivo fisso).

Il JWT custom con HS256 è più semplice, più diretto e perfettamente adeguato al caso d'uso: la stazione ha un segreto (la password) e riceve un token temporaneo valido 24 ore. La firma HMAC garantisce che nessuno possa forgiare un token senza conoscere `JWT_SECRET`.

## Come l'interceptor HTTP sceglie il token

Nel frontend Angular, ogni chiamata HTTP viene intercettata da `AuthInterceptor`. La logica è:

```typescript
// auth-interceptor.ts
if (url.includes('/stazioni/me/')) {
  // chiamata dalla stazione → usa JWT custom da localStorage
  const token = this.stationAuth.getToken();
  return next(req.clone({
    setHeaders: { Authorization: `Bearer ${token}` }
  }));
} else {
  // qualsiasi altra chiamata → usa token Cognito (asincrono)
  const token = await this.authService.getToken();
  return next(req.clone({
    setHeaders: { Authorization: `Bearer ${token}` }
  }));
}
```

Il pattern `/stazioni/me/` identifica le chiamate che provengono dalla stazione (QR refresh, aggiornamento posizione GPS). Tutto il resto usa il token Cognito dell'utente loggato.

## Rotte pubbliche

Alcune rotte non richiedono nessun token, perché devono essere accessibili da chiunque abbia il link QR:

| Rotta | Motivo |
|---|---|
| `POST /stazioni/login` | La stazione non ha ancora il token |
| `POST /biometric/authentication/start` | Il dipendente non è loggato sul proprio profilo |
| `POST /timbrature/anteprima` | Accessibile via QR senza login |
| `POST /timbrature/conferma` | Stessa sessione di anteprima |

Queste rotte sono "pubbliche" ma non "aperte": ciascuna ha la propria forma di verifica incorporata (HMAC per il QR, firma WebAuthn per la biometria, confirmToken per la conferma).

## Schema riassuntivo

```
Richiesta HTTP
     │
     ▼
API Gateway
     │
     ├─ rotta protetta Cognito → verifica JWT Cognito → Lambda
     │                           (manager/employee)
     │
     ├─ rotta stazione (JWT custom) → Lambda → verifica JWT interno
     │   /stazioni/me/qr
     │   /stazioni/me/position
     │
     └─ rotta pubblica → Lambda → verifica incorporata
         /stazioni/login       (bcrypt password)
         /biometric/auth/start (nessuna — genera challenge)
         /timbrature/anteprima (HMAC QR + WebAuthn)
         /timbrature/conferma  (confirmToken)
```
