import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { getJwtClaims } from './auth';

const dynamo = new DynamoDBClient({});
const TABLE_NAME = process.env.WEBAUTHN_TABLE_NAME!;

// Dominio dell'app — in produzione andrà cambiato con il dominio reale
const RP_ID     = process.env.RP_ID     ?? 'localhost';
const RP_NAME   = process.env.RP_NAME   ?? 'Timbratura';
const RP_ORIGIN = process.env.RP_ORIGIN ?? 'http://localhost:4200';

// Punto di ingresso — routing interno per le rotte /biometric/*
export const handler = async (event: APIGatewayProxyEvent) => {
  const claims = getJwtClaims(event);
  const userId = claims['cognito:username'];

  if (!userId) return json(401, 'Non autenticato');

  switch (event.resource) {
    case '/biometric/registration/start':    return await startRegistration(userId);
    case '/biometric/registration/complete': return await completeRegistration(userId, event);
    default: return json(404, 'Rotta non trovata');
  }
};

// --- POST /biometric/registration/start ---
// Genera le opzioni di registrazione e una challenge temporanea da salvare su DynamoDB
async function startRegistration(userId: string) {
  // Recupera le credenziali già registrate per questo utente (per evitare duplicati)
  const existing = await getCredentialsByUser(userId);
  const excludeCredentials = existing.map((c: any) => ({
    id:        c.credentialId,
    type:      'public-key' as const,
    transports: c.transports ?? [],
  }));

  // Genera la challenge — SimpleWebAuthn si occupa di tutto il formato FIDO2
  const options = await generateRegistrationOptions({
    rpName:                  RP_NAME,
    rpID:                    RP_ID,
    userID:                  new TextEncoder().encode(userId),
    userName:                userId,
    attestationType:         'none',          // 'none' = più semplice, sufficiente per la tesi
    excludeCredentials,
    authenticatorSelection: {
      residentKey:       'preferred',
      userVerification:  'preferred',         // attiva biometria/PIN sul dispositivo
    },
  });

  // Salviamo la challenge su DynamoDB per poterla verificare al passo successivo
  // TTL di 5 minuti: se l'utente non completa la registrazione entro quel tempo, scade
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({
      credentialId: `challenge#${userId}`,   // chiave temporanea, sarà sostituita dalla credenziale reale
      userId,
      challenge:  options.challenge,
      expiresAt,
      type: 'challenge',
    }),
  }));

  return json(200, options);
}

// --- POST /biometric/registration/complete ---
// Verifica la risposta del browser e salva la credenziale definitiva
async function completeRegistration(userId: string, event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const body = JSON.parse(event.body);

  // Recupera la challenge salvata in precedenza
  const challengeRecord = await getItem(`challenge#${userId}`);
  if (!challengeRecord) return json(400, 'Nessuna challenge attiva — riavvia la registrazione');

  const { challenge, expiresAt } = challengeRecord;
  if (Date.now() / 1000 > expiresAt) return json(400, 'Challenge scaduta — riavvia la registrazione');

  try {
    // Verifica crittografica della risposta WebAuthn
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response:           body,
      expectedChallenge:  challenge,
      expectedOrigin:     RP_ORIGIN,
      expectedRPID:       RP_ID,
    });

    if (!verified || !registrationInfo) return json(400, 'Verifica biometrica fallita');

    const { credential } = registrationInfo;

    // Salva la credenziale definitiva su DynamoDB
    await dynamo.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        credentialId: Buffer.from(credential.id).toString('base64url'),
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
    console.error('[biometric] errore verifica:', err.message);
    return json(500, `Errore durante la verifica: ${err.message}`);
  }
}

// Cerca tutte le credenziali di un utente tramite l'indice userId-index
async function getCredentialsByUser(userId: string) {
  const result = await dynamo.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'userId-index',
    KeyConditionExpression: 'userId = :uid',
    FilterExpression: '#t = :type',
    ExpressionAttributeNames:  { '#t': 'type' },
    ExpressionAttributeValues: marshall({ ':uid': userId, ':type': 'credential' }),
  }));
  return (result.Items ?? []).map((i: any) => unmarshall(i));
}

// Recupera un singolo record tramite credentialId (PK)
async function getItem(credentialId: string) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ credentialId }),
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