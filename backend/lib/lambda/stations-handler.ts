import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getJwtClaims, isManagerClaims } from './auth';

const dynamo        = new DynamoDBClient({});
const TABLE_NAME       = process.env.STAZIONI_TABLE_NAME!;
const TIMBRATURE_TABLE = process.env.TIMBRATURE_TABLE_NAME!;
const JWT_SECRET       = process.env.JWT_SECRET!;
const APP_URL          = process.env.APP_URL ?? 'http://localhost:4200';
const QR_TTL_SECS   = 3 * 60;  // il QR scade dopo 3 minuti

// Punto di ingresso — routing interno per le rotte /stazioni/*
export const handler = async (event: APIGatewayProxyEvent) => {
  const { httpMethod, resource } = event;

  // --- Rotta pubblica: login stazione (nessun JWT richiesto) ---
  if (httpMethod === 'POST' && resource === '/stazioni/login') {
    return await loginStazione(event);
  }

  // --- Rotte per la stazione autenticata (JWT custom) ---
  if (resource === '/stazioni/me/qr' || resource === '/stazioni/me/position') {
    const stazione = verificaJwtStazione(event);
    if (!stazione) return json(401, 'Token non valido o scaduto');

    if (httpMethod === 'GET'  && resource === '/stazioni/me/qr')       return await getQr(stazione.stationId);
    if (httpMethod === 'POST' && resource === '/stazioni/me/position') return await updatePosition(stazione.stationId, event);
  }

  // --- Rotte riservate al manager (JWT Cognito) ---
  const claims = getJwtClaims(event);
  if (!isManagerClaims(claims)) return json(403, 'Accesso negato');

  if (httpMethod === 'POST'   && resource === '/stazioni')       return await createStazione(event, claims);
  if (httpMethod === 'GET'    && resource === '/stazioni')       return await listStazioni();
  if (httpMethod === 'GET'    && resource === '/stazioni/{id}')  return await getStazioneDettaglio(event.pathParameters?.id!);
  if (httpMethod === 'DELETE' && resource === '/stazioni/{id}')  return await deleteStazione(event.pathParameters?.id!, claims);

  return json(404, 'Rotta non trovata');
};

// --- POST /stazioni — crea una nuova stazione (manager) ---
// Il manager fornisce descrizione e password; il codice è generato automaticamente
async function createStazione(event: APIGatewayProxyEvent, claims: any) {
  if (!event.body) return json(400, 'Body mancante');

  const { descrizione, password } = JSON.parse(event.body);
  if (!descrizione || !password) return json(400, 'descrizione e password sono obbligatori');

  // Genera il codice automaticamente — formato STZ-XXXXXX (6 caratteri hex maiuscoli)
  const codice    = 'STZ-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const stationId = uuidv4();

  // Hash della password
  const passwordHash = await bcrypt.hash(password, 8);

  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({
      stationId,
      descrizione,
      codice,
      passwordHash,
      lat:       null,
      lng:       null,
      lastSeen:  null,
      createdAt: new Date().toISOString(),
    }),
  }));

  return json(201, { stationId, descrizione, codice });
}

// --- GET /stazioni — lista tutte le stazioni (manager) ---
async function listStazioni() {
  const result = await dynamo.send(new ScanCommand({ TableName: TABLE_NAME }));
  const now    = Date.now();

  const stazioni = (result.Items ?? []).map(item => {
    const s = unmarshall(item);
    // Una stazione è attiva se ha richiesto un QR negli ultimi 6 minuti (2× il TTL del QR)
    const isActive = s.lastSeen ? (now - new Date(s.lastSeen).getTime()) < 6 * 60 * 1000 : false;
    return {
      stationId:   s.stationId,
      descrizione: s.descrizione,
      codice:      s.codice,
      lat:         s.lat,
      lng:         s.lng,
      lastSeen:    s.lastSeen,
      isActive,
    };
  });

  return json(200, stazioni);
}

// --- GET /stazioni/{id} — dettaglio stazione con credenziali (manager) ---
async function getStazioneDettaglio(stationId: string) {
  const s = await getStazioneById(stationId);
  if (!s) return json(404, 'Stazione non trovata');

  const now      = Date.now();
  const isActive = s.lastSeen ? (now - new Date(s.lastSeen).getTime()) < 6 * 60 * 1000 : false;

  return json(200, {
    stationId:   s.stationId,
    descrizione: s.descrizione,
    codice:      s.codice,
    // la password non viene mai restituita — è salvata come hash bcrypt
    lat:         s.lat,
    lng:         s.lng,
    lastSeen:    s.lastSeen,
    createdAt:   s.createdAt,
    isActive,
  });
}

// --- DELETE /stazioni/{id} — elimina una stazione (manager) ---
async function deleteStazione(stationId: string, claims: any) {
  await dynamo.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ stationId }),
  }));

  return json(200, { message: 'Stazione eliminata' });
}

// --- POST /stazioni/login — autenticazione stazione con codice + password ---
async function loginStazione(event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const { codice, password } = JSON.parse(event.body);
  if (!codice || !password) return json(400, 'codice e password sono obbligatori');

  const stazione = await getStazioneByCodice(codice);
  if (!stazione || !stazione.passwordHash) return json(401, 'Credenziali non valide');

  const passwordOk = await bcrypt.compare(password, stazione.passwordHash);
  if (!passwordOk) return json(401, 'Credenziali non valide');

  const token = generaJwt({ stationId: stazione.stationId, codice: stazione.codice });

  return json(200, {
    token,
    stazione: { stationId: stazione.stationId, descrizione: stazione.descrizione, codice: stazione.codice },
  });
}

// --- GET /stazioni/me/qr — genera/rinnova il QR per la stazione autenticata ---
async function getQr(stationId: string) {
  const now       = Math.floor(Date.now() / 1000);
  const expiresAt = now + QR_TTL_SECS;

  // Il token del QR è un HMAC-SHA256 di stationId:expiresAt — verificabile senza salvarlo
  const qrToken = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${stationId}:${expiresAt}`)
    .digest('hex');

  // Aggiorna lastSeen — usato dal manager per sapere se la stazione è attiva
  const stazione = await getStazioneById(stationId);
  if (stazione) {
    await dynamo.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({ ...stazione, lastSeen: new Date().toISOString() }),
    }));
  }

  // Calcola presenti: ultima timbratura di oggi per ogni utente in questa stazione
  const oggi = new Date().toISOString().slice(0, 10);
  const timRes = await dynamo.send(new QueryCommand({
    TableName:                 TIMBRATURE_TABLE,
    IndexName:                 'data-index',
    KeyConditionExpression:    '#d = :data',
    FilterExpression:          'stationId = :sid',
    ExpressionAttributeNames:  { '#d': 'data' },
    ExpressionAttributeValues: marshall({ ':data': oggi, ':sid': stationId }),
    ScanIndexForward:          true,
  }));
  const timbratureOggi = (timRes.Items ?? []).map(i => unmarshall(i));

  const ultimaPerUtente = new Map<string, any>();
  for (const t of timbratureOggi) {
    const attuale = ultimaPerUtente.get(t.userId);
    if (!attuale || t.timestamp > attuale.timestamp) ultimaPerUtente.set(t.userId, t);
  }
  let presenti = 0;
  let ultimaTimbratura: any = null;
  let ultimoTimestamp = '';
  for (const t of ultimaPerUtente.values()) {
    if (t.tipo === 'entrata') presenti++;
  }
  // Trova l'ultima timbratura assoluta (qualsiasi tipo) per la notifica
  for (const t of timbratureOggi) {
    if (!ultimoTimestamp || t.timestamp > ultimoTimestamp) {
      ultimoTimestamp = t.timestamp;
      ultimaTimbratura = t;
    }
  }

  const qrUrl = `${APP_URL}/timbratura?s=${stationId}&t=${qrToken}&exp=${expiresAt}`;
  return json(200, {
    qrUrl,
    expiresAt,
    presenti,
    lat: stazione?.lat ?? null,
    lng: stazione?.lng ?? null,
    ultimaTimbratura: ultimaTimbratura ?? null,
  });
}

// --- POST /stazioni/me/position — aggiorna la posizione GPS della stazione ---
async function updatePosition(stationId: string, event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const { lat, lng } = JSON.parse(event.body);
  if (lat == null || lng == null) return json(400, 'lat e lng sono obbligatori');

  const stazione = await getStazioneById(stationId);
  if (!stazione) return json(404, 'Stazione non trovata');

  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({ ...stazione, lat, lng }),
  }));

  return json(200, { message: 'Posizione aggiornata' });
}

// --- Helpers ---

// Cerca una stazione tramite il codice (indice GSI)
async function getStazioneByCodice(codice: string) {
  const result = await dynamo.send(new QueryCommand({
    TableName:                 TABLE_NAME,
    IndexName:                 'codice-index',
    KeyConditionExpression:    'codice = :c',
    ExpressionAttributeValues: marshall({ ':c': codice }),
  }));
  return result.Items?.[0] ? unmarshall(result.Items[0]) : null;
}

// Cerca una stazione tramite lo stationId (PK)
async function getStazioneById(stationId: string) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key:       marshall({ stationId }),
  }));
  return result.Item ? unmarshall(result.Item) : null;
}

// Genera un JWT firmato con HMAC-SHA256 (crypto nativo Node, nessuna dipendenza esterna)
function generaJwt(payload: { stationId: string; codice: string }): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url');
  const sign    = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sign}`;
}

// Verifica il JWT della stazione estratto dall'header Authorization
function verificaJwtStazione(event: APIGatewayProxyEvent): { stationId: string; codice: string } | null {
  const auth = event.headers['Authorization'] ?? event.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) return null;

  try {
    const [header, body, sign] = auth.slice(7).split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sign !== expected) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return { stationId: payload.stationId, codice: payload.codice };
  } catch {
    return null;
  }
}

function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
  };
}
