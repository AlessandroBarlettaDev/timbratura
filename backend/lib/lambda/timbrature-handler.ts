import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'crypto';
import { getJwtClaims, isManagerClaims } from './auth';
import { verifyAssertion } from './biometric-handler';

const dynamo           = new DynamoDBClient({});
const TIMBRATURE_TABLE = process.env.TIMBRATURE_TABLE_NAME!;
const JWT_SECRET       = process.env.JWT_SECRET!;

// Punto di ingresso — routing interno per le rotte /timbrature/*
export const handler = async (event: APIGatewayProxyEvent) => {
  const { httpMethod, resource } = event;

  // --- POST /timbrature — pubblica, l'identità è provata dalla biometria + QR ---
  if (httpMethod === 'POST' && resource === '/timbrature') return await registraTimbratura(event);

  // --- Rotte protette da Cognito ---
  const claims = getJwtClaims(event);
  if (!claims) return json(401, 'Non autenticato');

  // Il dipendente vede le proprie timbrature filtrate per mese (?mese=YYYY-MM)
  if (httpMethod === 'GET' && resource === '/timbrature/me') {
    const userId = claims['cognito:username'];
    const mese   = event.queryStringParameters?.mese;   // YYYY-MM
    return await getTimbratureUtente(userId, mese);
  }

  // Il manager vede le timbrature di un utente specifico filtrate per mese
  // GET /timbrature?userId=xxx&mese=YYYY-MM
  if (httpMethod === 'GET' && resource === '/timbrature') {
    if (!isManagerClaims(claims)) return json(403, 'Accesso negato');
    const userId = event.queryStringParameters?.userId;
    const mese   = event.queryStringParameters?.mese;
    if (!userId) return json(400, 'Parametro userId obbligatorio');
    return await getTimbratureUtente(userId, mese);
  }

  return json(404, 'Rotta non trovata');
};

// --- POST /timbrature ---
async function registraTimbratura(event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const { stationId, qrToken, expiresAt, assertion, sessionId } = JSON.parse(event.body);
  if (!stationId || !qrToken || !expiresAt || !assertion || !sessionId) {
    return json(400, 'Parametri mancanti');
  }

  if (Math.floor(Date.now() / 1000) > parseInt(expiresAt)) {
    return json(410, 'QR scaduto — chiedi alla stazione di aggiornarlo');
  }

  const expectedToken = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${stationId}:${expiresAt}`)
    .digest('hex');
  if (qrToken !== expectedToken) return json(401, 'QR non valido');

  let userId: string;
  try {
    userId = await verifyAssertion(assertion, sessionId);
  } catch (err: any) {
    return json(401, err.message);
  }

  const oggi   = new Date().toISOString().slice(0, 10);
  const ultima = await getUltimaTimbratura(userId, oggi);
  const tipo   = (!ultima || ultima.tipo === 'uscita') ? 'entrata' : 'uscita';

  const timestamp = new Date().toISOString();
  await dynamo.send(new PutItemCommand({
    TableName: TIMBRATURE_TABLE,
    Item: marshall({ userId, timestamp, data: oggi, stationId, tipo }),
  }));

  return json(200, { tipo, timestamp, userId });
}

// --- GET /timbrature/me e GET /timbrature?userId=xxx ---
// Restituisce le timbrature di un utente filtrate per mese (YYYY-MM).
// Se mese non è specificato, usa il mese corrente.
async function getTimbratureUtente(userId: string, mese?: string) {
  const meseTarget = mese ?? new Date().toISOString().slice(0, 7);  // YYYY-MM

  const result = await dynamo.send(new QueryCommand({
    TableName:              TIMBRATURE_TABLE,
    KeyConditionExpression: 'userId = :uid AND begins_with(#ts, :mese)',
    ExpressionAttributeNames:  { '#ts': 'timestamp' },
    ExpressionAttributeValues: marshall({ ':uid': userId, ':mese': meseTarget }),
    ScanIndexForward:          false,  // più recenti prima
  }));

  return json(200, (result.Items ?? []).map(i => unmarshall(i)));
}

// Recupera l'ultima timbratura di un utente per una data specifica
async function getUltimaTimbratura(userId: string, data: string) {
  const result = await dynamo.send(new QueryCommand({
    TableName:              TIMBRATURE_TABLE,
    KeyConditionExpression: 'userId = :uid AND begins_with(#ts, :data)',
    ExpressionAttributeNames:  { '#ts': 'timestamp' },
    ExpressionAttributeValues: marshall({ ':uid': userId, ':data': data }),
    ScanIndexForward: false,
    Limit:            1,
  }));

  return result.Items?.[0] ? unmarshall(result.Items[0]) : null;
}

function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
  };
}
