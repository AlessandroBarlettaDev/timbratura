import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDeleteUserCommand,
  ListUsersCommand,
  MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';
import { getJwtClaims, isManagerClaims } from './auth';
import { cognitoErrorToHttp } from './errors';

const cognitoClient = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

// Punto di ingresso — API Gateway chiama questa funzione per ogni richiesta su /users
export const handler = async (event: APIGatewayProxyEvent) => {
  const claims = getJwtClaims(event);

  if (!isManagerClaims(claims)) return json(403, 'Accesso negato');

  const userId = event.pathParameters?.id;

  switch (event.httpMethod) {
    case 'POST':   return await createEmployee(event);
    case 'GET':    return userId ? await getEmployee(userId) : await listEmployees();
    case 'PUT':    return userId ? await updateEmployee(userId, event) : json(400, 'Id mancante');
    case 'DELETE': return userId ? await deleteEmployee(userId) : json(400, 'Id mancante');
    default:       return json(405, 'Metodo non supportato');
  }
};

// --- POST /users — crea un nuovo dipendente ---
async function createEmployee(event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const { email, nome, cognome, birthdate, codice_fiscale, data_assunzione, termine_contratto } = JSON.parse(event.body);

  if (!email || !nome || !cognome) {
    return json(400, 'Campi obbligatori mancanti: email, nome, cognome');
  }

  const tempPassword = `Tmp_${Math.random().toString(36).slice(2, 10)}!A1`;
  console.log(`[NUOVO UTENTE] email: ${email} | password temporanea: ${tempPassword}`);

  try {
    await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      TemporaryPassword: tempPassword,
      MessageAction: MessageActionType.SUPPRESS,
      UserAttributes: [
        { Name: 'email',                    Value: email },
        { Name: 'given_name',               Value: nome },
        { Name: 'family_name',              Value: cognome },
        { Name: 'email_verified',           Value: 'true' },
        { Name: 'birthdate',                Value: birthdate         ?? '' },
        { Name: 'custom:codice_fiscale',    Value: codice_fiscale    ?? '' },
        { Name: 'custom:data_assunzione',   Value: data_assunzione   ?? '' },
        { Name: 'custom:termine_contratto', Value: termine_contratto ?? '' },
        { Name: 'custom:password_changed',  Value: 'false' },
        { Name: 'custom:biometrics_reg',    Value: 'false' },
      ],
    }));

    // Assegna il gruppo — operazione separata richiesta da Cognito
    await cognitoClient.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      GroupName: 'employee',
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
async function updateEmployee(userId: string, event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const { nome, cognome, birthdate, codice_fiscale, data_assunzione, termine_contratto } = JSON.parse(event.body);

  try {
    await cognitoClient.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,
      UserAttributes: [
        { Name: 'given_name',               Value: nome              ?? '' },
        { Name: 'family_name',              Value: cognome           ?? '' },
        { Name: 'birthdate',                Value: birthdate         ?? '' },
        { Name: 'custom:codice_fiscale',    Value: codice_fiscale    ?? '' },
        { Name: 'custom:data_assunzione',   Value: data_assunzione   ?? '' },
        { Name: 'custom:termine_contratto', Value: termine_contratto ?? '' },
      ],
    }));
    return json(200, { message: 'Dipendente aggiornato' });
  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// --- DELETE /users/{id} — elimina un dipendente ---
async function deleteEmployee(userId: string) {
  try {
    await cognitoClient.send(new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,
    }));
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