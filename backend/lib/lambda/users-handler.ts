import { APIGatewayProxyEvent } from 'aws-lambda';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand, MessageActionType } from '@aws-sdk/client-cognito-identity-provider';
import { getJwtClaims, isManagerClaims } from './auth';
import { cognitoErrorToHttp } from './errors';

const cognitoClient = new CognitoIdentityProviderClient({});

// Punto di ingresso della Lambda — chiamato da API Gateway per ogni richiesta su /users
export const handler = async (event: APIGatewayProxyEvent) => {
  const claims = getJwtClaims(event);

  switch (event.httpMethod) {
    case 'POST':
      return isManagerClaims(claims) ? await createEmployee(event) : json(403, 'Accesso negato');
    default:
      return json(405, 'Metodo non supportato');
  }
};

// --- POST /users — crea un nuovo dipendente ---
async function createEmployee(event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const { email, nome, cognome, birthdate, codice_fiscale, data_assunzione, termine_contratto } = JSON.parse(event.body);

  if (!email || !nome || !cognome) {
    return json(400, 'Campi obbligatori mancanti: email, nome, cognome');
  }

  const userPoolId = process.env.USER_POOL_ID!;
  const tempPassword = `Tmp_${Math.random().toString(36).slice(2, 10)}!A1`;

  // La password temporanea viene loggata su CloudWatch come fallback
  // in caso l'invio email non sia ancora configurato
  console.log(`[NUOVO UTENTE] email: ${email} | password temporanea: ${tempPassword}`);

  try {
    // Crea l'utente con tutti gli attributi in una sola chiamata
    await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
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

    // Assegna il ruolo — operazione separata richiesta da Cognito
    await cognitoClient.send(new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: email,
      GroupName: 'employee',
    }));

    return json(201, { message: 'Dipendente creato' });

  } catch (err: any) {
    const { status, message } = cognitoErrorToHttp(err);
    return json(status, message);
  }
}

// Helper: costruisce la risposta HTTP in formato atteso da API Gateway
function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
  };
}