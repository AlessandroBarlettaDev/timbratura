import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { getJwtClaims } from './auth';
import { v4 as uuidv4 } from 'uuid';

const dynamo     = new DynamoDBClient({});
const TABLE_NAME = process.env.WEBAUTHN_TABLE_NAME!;

const RP_ID     = process.env.RP_ID     ?? 'localhost';
const RP_NAME   = process.env.RP_NAME   ?? 'Timbratura';
const RP_ORIGIN = process.env.RP_ORIGIN ?? 'http://localhost:4200';

// Punto di ingresso — routing interno per le rotte /biometric/*
export const handler = async (event: APIGatewayProxyEvent) => {
  const { resource, httpMethod } = event;

  // --- Rotte di registrazione (richiedono JWT Cognito) ---
  if (resource === '/biometric/registration/start' && httpMethod === 'POST') {
    const claims = getJwtClaims(event);
    const userId = claims['cognito:username'];
    if (!userId) return json(401, 'Non autenticato');
    return await startRegistration(userId);
  }
  if (resource === '/biometric/registration/complete' && httpMethod === 'POST') {
    const claims = getJwtClaims(event);
    const userId = claims['cognito:username'];
    if (!userId) return json(401, 'Non autenticato');
    return await completeRegistration(userId, event);
  }

  // --- Rotte di autenticazione (pubbliche — la verifica biometrica è la prova d'identità) ---
  if (resource === '/biometric/authentication/start'    && httpMethod === 'POST') return await startAuthentication();
  if (resource === '/biometric/authentication/complete' && httpMethod === 'POST') return await completeAuthentication(event);

  return json(404, 'Rotta non trovata');
};

// --- POST /biometric/registration/start ---
async function startRegistration(userId: string) {
  const existing = await getCredentialsByUser(userId);
  const excludeCredentials = existing.map((c: any) => ({
    id:         c.credentialId,
    type:       'public-key' as const,
    transports: c.transports ?? [],
  }));

  const options = await generateRegistrationOptions({
    rpName:                  RP_NAME,
    rpID:                    RP_ID,
    userID:                  new TextEncoder().encode(userId),
    userName:                userId,
    attestationType:         'none',
    excludeCredentials,
    authenticatorSelection: {
      // 'platform' = usa solo l'autenticatore integrato (Face ID, Touch ID, Windows Hello)
      // esclude chiavi di sicurezza esterne e altri dispositivi
      authenticatorAttachment: 'platform',
      residentKey:             'required',   // necessario per discoverable credentials (no username)
      userVerification:        'required',   // forza la verifica biometrica/PIN
    },
  });

  // Salva la challenge temporanea (TTL 5 minuti)
  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({
      credentialId: `challenge#${userId}`,
      userId,
      challenge:  options.challenge,
      expiresAt:  Math.floor(Date.now() / 1000) + 300,
      type:       'challenge',
    }),
  }));

  return json(200, options);
}

// --- POST /biometric/registration/complete ---
async function completeRegistration(userId: string, event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const body           = JSON.parse(event.body);
  const challengeRecord = await getItem(`challenge#${userId}`);
  if (!challengeRecord) return json(400, 'Nessuna challenge attiva — riavvia la registrazione');

  const { challenge, expiresAt } = challengeRecord;
  if (Date.now() / 1000 > expiresAt) return json(400, 'Challenge scaduta — riavvia la registrazione');

  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response:          body,
      expectedChallenge: challenge,
      expectedOrigin:    RP_ORIGIN,
      expectedRPID:      RP_ID,
    });

    if (!verified || !registrationInfo) return json(400, 'Verifica biometrica fallita');

    const { credential } = registrationInfo;

    await dynamo.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        credentialId: credential.id,
        userId,
        publicKey:    Buffer.from(credential.publicKey).toString('base64'),
        counter:      credential.counter,
        transports:   body.response.transports ?? [],
        createdAt:    new Date().toISOString(),
        type:         'credential',
      }),
    }));

    return json(200, { message: 'Dispositivo biometrico registrato con successo' });

  } catch (err: any) {
    console.error('[biometric] errore registrazione:', err.message);
    return json(500, `Errore durante la verifica: ${err.message}`);
  }
}

// --- POST /biometric/authentication/start ---
// Genera una challenge per autenticare il dipendente alla timbratura.
// Non richiede JWT — è pubblica perché la biometria è la prova d'identità.
async function startAuthentication() {
  const options = await generateAuthenticationOptions({
    rpID:             RP_ID,
    allowCredentials: [],               // lista vuota = discoverable credential (passkey)
    userVerification: 'required',       // forza biometrica/PIN sul dispositivo
  });

  // Salva la challenge con un sessionId — il client lo includerà nella chiamata a /timbrature
  const sessionId = uuidv4();
  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({
      credentialId: `authSession#${sessionId}`,
      challenge:    options.challenge,
      expiresAt:    Math.floor(Date.now() / 1000) + 300,  // 5 minuti
      type:         'authSession',
    }),
  }));

  return json(200, { options, sessionId });
}

// --- POST /biometric/authentication/complete ---
// Verifica l'assertion biometrica, ritorna userId e credentialId per la timbratura.
// Chiamato internamente da timbrature-handler tramite invocazione Lambda diretta,
// ma esposto anche come endpoint per poter essere testato indipendentemente.
export async function verifyAssertion(assertion: any, sessionId: string): Promise<string> {
  // Recupera la challenge salvata dalla sessione
  const sessionRecord = await getItem(`authSession#${sessionId}`);
  if (!sessionRecord) throw new Error('Sessione non trovata o scaduta');
  if (Date.now() / 1000 > sessionRecord.expiresAt) throw new Error('Challenge scaduta');

  // Recupera la credenziale pubblica dell'utente
  const credentialId = assertion.id;
  const credRecord    = await getItem(credentialId);
  if (!credRecord) throw new Error('Credenziale non trovata');

  const { verified, authenticationInfo } = await verifyAuthenticationResponse({
    response:          assertion,
    expectedChallenge: sessionRecord.challenge,
    expectedOrigin:    RP_ORIGIN,
    expectedRPID:      RP_ID,
    credential: {
      id:        credRecord.credentialId,
      publicKey: Buffer.from(credRecord.publicKey, 'base64'),
      counter:   credRecord.counter,
    },
  });

  if (!verified) throw new Error('Verifica biometrica fallita');

  // Aggiorna il counter per prevenire attacchi replay
  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({ ...credRecord, counter: authenticationInfo.newCounter }),
  }));

  return credRecord.userId;
}

async function completeAuthentication(event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');
  const { assertion, sessionId } = JSON.parse(event.body);
  try {
    const userId = await verifyAssertion(assertion, sessionId);
    return json(200, { userId });
  } catch (err: any) {
    return json(401, err.message);
  }
}

// --- Helpers ---
async function getCredentialsByUser(userId: string) {
  const result = await dynamo.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'userId-index',
    KeyConditionExpression:    'userId = :uid',
    FilterExpression:          '#t = :type',
    ExpressionAttributeNames:  { '#t': 'type' },
    ExpressionAttributeValues: marshall({ ':uid': userId, ':type': 'credential' }),
  }));
  return (result.Items ?? []).map((i: any) => unmarshall(i));
}

async function getItem(credentialId: string) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key:       marshall({ credentialId }),
  }));
  return result.Item ? unmarshall(result.Item) : null;
}

function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
  };
}
