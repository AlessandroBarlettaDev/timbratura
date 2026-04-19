import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDeleteUserCommand,
  AdminResetUserPasswordCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getJwtClaims, isManagerClaims } from './auth';

function cognitoErrorToHttp(err: any): { status: number; message: string } {
  switch (err.name) {
    case 'UsernameExistsException':  return { status: 409, message: 'Email già registrata' };
    case 'UserNotFoundException':    return { status: 404, message: 'Utente non trovato' };
    case 'InvalidPasswordException': return { status: 400, message: 'Password non valida: deve contenere almeno 8 caratteri, una maiuscola, un numero e un simbolo' };
    case 'InvalidParameterException':return { status: 400, message: `Parametro non valido: ${err.message}` };
    case 'NotAuthorizedException':   return { status: 403, message: 'Operazione non autorizzata' };
    case 'TooManyRequestsException': return { status: 429, message: 'Troppe richieste. Riprova tra qualche secondo.' };
    case 'LimitExceededException':   return { status: 429, message: 'Limite operazioni raggiunto. Riprova più tardi.' };
    default:                         return { status: 500, message: `Errore interno: ${err.message}` };
  }
}

const cognitoClient = new CognitoIdentityProviderClient({});
const dynamoClient  = new DynamoDBClient({});
const USER_POOL_ID    = process.env.USER_POOL_ID!;
const WEBAUTHN_TABLE  = process.env.WEBAUTHN_TABLE_NAME!;

// Punto di ingresso — API Gateway chiama questa funzione per ogni richiesta su /users
export const handler = async (event: APIGatewayProxyEvent) => {
  const claims = getJwtClaims(event);

  // Rotte accessibili a qualsiasi utente autenticato (non solo manager)
  if (event.httpMethod === 'POST' && event.resource === '/users/password-changed') {
    return await markPasswordChanged(claims);
  }
  if (event.httpMethod === 'POST' && event.resource === '/users/biometrics-registered') {
    return await markBiometricsRegistered(claims);
  }

  const userId          = event.pathParameters?.id;
  const currentUsername = claims?.['cognito:username'];

  // Self-access: il dipendente può leggere il proprio profilo
  if (event.httpMethod === 'GET' && userId && userId === currentUsername) {
    return await getEmployee(userId);
  }

  if (!isManagerClaims(claims)) return json(403, 'Accesso negato');

  // POST /users/{id}/reset-password — manager invia password temporanea via email
  if (event.httpMethod === 'POST' && event.resource === '/users/{id}/reset-password' && userId) {
    return await resetPassword(userId, claims);
  }

  // POST /users/{id}/reset-biometrics — manager resetta direttamente le credenziali biometriche
  if (event.httpMethod === 'POST' && event.resource === '/users/{id}/reset-biometrics' && userId) {
    return await resetBiometrics(userId, claims);
  }

  switch (event.httpMethod) {
    case 'POST':   return await createEmployee(event, claims);
    case 'GET':    return userId ? await getEmployee(userId) : await listEmployees();
    case 'PUT':    return userId ? await updateEmployee(userId, event, claims) : json(400, 'Id mancante');
    case 'DELETE': return userId ? await deleteEmployee(userId, claims) : json(400, 'Id mancante');
    default:       return json(405, 'Metodo non supportato');
  }
};

// --- POST /users — crea un nuovo dipendente ---
async function createEmployee(event: APIGatewayProxyEvent, claims: any) {
  if (!event.body) return json(400, 'Body mancante');

  const raw = JSON.parse(event.body);
  const email           = raw.email?.trim().toLowerCase();
  const nome            = raw.nome;
  const cognome         = raw.cognome;
  const birthdate       = raw.birthdate;
  const codice_fiscale  = raw.codice_fiscale?.trim().toUpperCase();
  const ruolo           = raw.ruolo;

  if (!email || !nome || !cognome) {
    return json(400, 'Campi obbligatori mancanti: email, nome, cognome');
  }

  const groupName = ruolo === 'manager' ? 'manager' : 'employee';

  const tempPassword = `Tmp_${Math.random().toString(36).slice(2, 10)}!A1`;

  try {
    await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId:        USER_POOL_ID,
      Username:          email,
      TemporaryPassword: tempPassword,
      // Cognito invia l'email con il template userInvitation definito in cognito.ts
      UserAttributes: [
        { Name: 'email',                    Value: email },
        { Name: 'given_name',               Value: nome },
        { Name: 'family_name',              Value: cognome },
        { Name: 'email_verified',           Value: 'true' },
        { Name: 'birthdate',                Value: birthdate         ?? '' },
        { Name: 'custom:codice_fiscale',    Value: codice_fiscale    ?? '' },
        { Name: 'custom:password_changed',  Value: 'false' },
        { Name: 'custom:biometrics_reg',    Value: 'false' },
      ],
    }));

    // Assegna il gruppo — operazione separata richiesta da Cognito
    await cognitoClient.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      GroupName: groupName,
    }));

    return json(201, { message: 'Dipendente creato' });

  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// --- GET /users — lista tutti i dipendenti ---
async function listEmployees() {
  try {
    const result = await cognitoClient.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID }));
    const utenti = (result.Users ?? []).map(u => attrsToObject(u.Attributes ?? [], u.Username!));
    return json(200, utenti);
  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// --- GET /users/{id} — dettaglio singolo dipendente ---
async function getEmployee(userId: string) {
  try {
    const result = await cognitoClient.send(new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,
    }));
    return json(200, attrsToObject(result.UserAttributes ?? [], result.Username!));
  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// --- PUT /users/{id} — modifica attributi di un dipendente ---
async function updateEmployee(userId: string, event: APIGatewayProxyEvent, claims: any) {
  if (!event.body) return json(400, 'Body mancante');

  const raw = JSON.parse(event.body);
  const nome              = raw.nome;
  const cognome           = raw.cognome;
  const birthdate         = raw.birthdate;
  const codice_fiscale    = raw.codice_fiscale?.trim().toUpperCase();

  try {
    await cognitoClient.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,
      UserAttributes: [
        { Name: 'given_name',               Value: nome              ?? '' },
        { Name: 'family_name',              Value: cognome           ?? '' },
        { Name: 'birthdate',                Value: birthdate         ?? '' },
        { Name: 'custom:codice_fiscale',    Value: codice_fiscale    ?? '' },
      ],
    }));
    return json(200, { message: 'Dipendente aggiornato' });
  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// --- POST /users/{id}/reset-password — manager invia password temporanea via email ---
async function resetPassword(userId: string, claims: any) {
  try {
    // Cognito invia automaticamente email con password temporanea e forza il cambio al prossimo login
    await cognitoClient.send(new AdminResetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username:   userId,
    }));
    // Resetta il flag custom — al prossimo login l'onboardingGuard forza il cambio password
    await cognitoClient.send(new AdminUpdateUserAttributesCommand({
      UserPoolId:     USER_POOL_ID,
      Username:       userId,
      UserAttributes: [{ Name: 'custom:password_changed', Value: 'false' }],
    }));
    return json(200, { message: 'Password temporanea inviata per email' });
  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// --- POST /users/{id}/reset-biometrics — manager resetta direttamente le credenziali biometriche ---
async function resetBiometrics(userId: string, claims: any) {
  try {
    // 1. Cancella tutte le credenziali WebAuthn dell'utente
    const result = await dynamoClient.send(new QueryCommand({
      TableName: WEBAUTHN_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: marshall({ ':uid': userId }),
    }));
    const credentials = (result.Items ?? []).map(i => unmarshall(i));
    await Promise.all(credentials.map(c =>
      dynamoClient.send(new DeleteItemCommand({
        TableName: WEBAUTHN_TABLE,
        Key: marshall({ credentialId: c.credentialId }),
      }))
    ));

    // 2. Resetta il flag — al prossimo login l'utente viene rimandato a /first-access
    await cognitoClient.send(new AdminUpdateUserAttributesCommand({
      UserPoolId:     USER_POOL_ID,
      Username:       userId,
      UserAttributes: [{ Name: 'custom:biometrics_reg', Value: 'false' }],
    }));

    return json(200, { message: 'Biometria resettata' });
  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// --- POST /users/biometrics-registered — segna la biometria come registrata per l'utente corrente ---
async function markBiometricsRegistered(claims: any) {
  const username = claims['cognito:username'];
  if (!username) return json(401, 'Non autenticato');

  try {
    await cognitoClient.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      UserAttributes: [{ Name: 'custom:biometrics_reg', Value: 'true' }],
    }));
    return json(200, { message: 'Biometria registrata' });
  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// --- POST /users/password-changed — segna la password come cambiata per l'utente corrente ---
async function markPasswordChanged(claims: any) {
  const username = claims['cognito:username'];
  if (!username) return json(401, 'Non autenticato');

  try {
    await cognitoClient.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      UserAttributes: [{ Name: 'custom:password_changed', Value: 'true' }],
    }));
    return json(200, { message: 'Password aggiornata' });
  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// --- DELETE /users/{id} — elimina un dipendente e i suoi dispositivi biometrici ---
async function deleteEmployee(userId: string, claims: any) {
  try {
    // 1. Elimina l'utente da Cognito
    await cognitoClient.send(new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,
    }));

    // 2. Cerca tutti i dispositivi biometrici registrati per questo utente
    const result = await dynamoClient.send(new QueryCommand({
      TableName: WEBAUTHN_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: marshall({ ':uid': userId }),
    }));

    // 3. Elimina ogni credenziale trovata
    const credentials = (result.Items ?? []).map(i => unmarshall(i));
    await Promise.all(credentials.map(c =>
      dynamoClient.send(new DeleteItemCommand({
        TableName: WEBAUTHN_TABLE,
        Key: marshall({ credentialId: c.credentialId }),
      }))
    ));

    return json(200, { message: 'Dipendente eliminato' });
  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// Converte l'array di attributi Cognito [{Name:'email', Value:'x'}] in un oggetto {email:'x'}
function attrsToObject(attrs: { Name?: string; Value?: string }[], username: string) {
  const obj: Record<string, string> = { id: username };
  for (const attr of attrs) {
    if (attr.Name && attr.Value !== undefined) {
      obj[attr.Name.replace('custom:', '')] = attr.Value;
    }
  }
  return obj;
}

// Helper: costruisce la risposta HTTP in formato atteso da API Gateway
function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
  };
}