import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import * as crypto from 'crypto';
import { getJwtClaims, isManagerClaims } from './auth';
import { verifyAssertion } from './biometric-handler';

const dynamo           = new DynamoDBClient({});
const cognito          = new CognitoIdentityProviderClient({});
const TIMBRATURE_TABLE = process.env.TIMBRATURE_TABLE_NAME!;
const STAZIONI_TABLE   = process.env.STAZIONI_TABLE_NAME!;
const USER_POOL_ID     = process.env.USER_POOL_ID!;
const JWT_SECRET       = process.env.JWT_SECRET!;

// Distanza massima consentita tra dipendente e stazione (in metri)
const MAX_DISTANCE_METERS = 200;

// Formula di Haversine — calcola la distanza in metri tra due coordinate GPS
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000; // raggio terrestre in metri
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Punto di ingresso
export const handler = async (event: APIGatewayProxyEvent) => {
  const { httpMethod, resource } = event;

  // POST /timbrature/anteprima — verifica QR + biometria, calcola tipo, non salva
  if (httpMethod === 'POST' && resource === '/timbrature/anteprima') return await anteprimaTimbratura(event);

  // POST /timbrature/conferma — salva la timbratura dopo conferma utente
  if (httpMethod === 'POST' && resource === '/timbrature/conferma') return await confermaTimbratura(event);

  // POST /timbrature — pubblica, identità provata da biometria + QR
  if (httpMethod === 'POST' && resource === '/timbrature') return await registraTimbratura(event);

  // Rotte protette da Cognito
  const claims = getJwtClaims(event);
  if (!claims) return json(401, 'Non autenticato');

  // GET /timbrature/dashboard — dati odierni aggregati per stazione (manager)
  if (httpMethod === 'GET' && resource === '/timbrature/dashboard') {
    if (!isManagerClaims(claims)) return json(403, 'Accesso negato');
    return await getDashboard();
  }

  // GET /timbrature/me — timbrature del dipendente loggato filtrate per mese
  if (httpMethod === 'GET' && resource === '/timbrature/me') {
    const userId = claims['cognito:username'];
    const mese   = event.queryStringParameters?.mese;
    return await getTimbratureUtente(userId, mese);
  }

  // GET /timbrature?userId=xxx&mese=YYYY-MM — timbrature di un dipendente (manager)
  if (httpMethod === 'GET' && resource === '/timbrature') {
    if (!isManagerClaims(claims)) return json(403, 'Accesso negato');
    const userId = event.queryStringParameters?.userId;
    const mese   = event.queryStringParameters?.mese;
    if (!userId) return json(400, 'Parametro userId obbligatorio');
    return await getTimbratureUtente(userId, mese);
  }

  return json(404, 'Rotta non trovata');
};

// --- POST /timbrature/anteprima ---
// Verifica QR + biometria, calcola tipo, salva pending-entry (TTL 5 min). Non salva ancora.
async function anteprimaTimbratura(event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const { stationId, qrToken, expiresAt, assertion, sessionId, lat, lng } = JSON.parse(event.body);
  if (!stationId || !qrToken || !expiresAt || !assertion || !sessionId)
    return json(400, 'Parametri mancanti');

  if (Math.floor(Date.now() / 1000) > parseInt(expiresAt))
    return json(410, 'QR scaduto — chiedi alla stazione di aggiornarlo');

  const expectedToken = crypto.createHmac('sha256', JWT_SECRET).update(`${stationId}:${expiresAt}`).digest('hex');
  if (qrToken !== expectedToken) return json(401, 'QR non valido');

  const { errore: erroreGps, descrizione: stazioneDescrizione } = await validaPosizioneGps(stationId, lat, lng);
  if (erroreGps) return json(403, erroreGps);

  let userId: string;
  try { userId = await verifyAssertion(assertion, sessionId); }
  catch (err: any) { return json(401, err.message); }

  let nome = '', cognome = '';
  try {
    const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const attrs = Object.fromEntries((user.UserAttributes ?? []).map(a => [a.Name, a.Value]));
    nome    = attrs['given_name']  ?? '';
    cognome = attrs['family_name'] ?? '';
  } catch {}

  const oggi        = new Date().toISOString().slice(0, 10);
  const ultima      = await getUltimaTimbratura(userId, oggi);

  // Rate limiting: blocca timbrature duplicate entro 60 secondi
  if (ultima && (Date.now() - new Date(ultima.timestamp).getTime()) < 60_000)
    return json(429, 'Hai già timbrato di recente. Attendi almeno 60 secondi.');

  const tipo        = (!ultima || ultima.tipo === 'uscita') ? 'entrata' : 'uscita';
  const confirmToken   = crypto.randomBytes(16).toString('hex');
  const pendingTimestamp = new Date().toISOString();

  // Salva pending-entry: PK = pending#<token>, SK = timestamp
  await dynamo.send(new PutItemCommand({
    TableName: TIMBRATURE_TABLE,
    Item: marshall({
      userId:    `pending#${confirmToken}`,
      timestamp: pendingTimestamp,
      realUserId: userId,
      nome, cognome, stationId, stazioneDescrizione, tipo,
      data:      oggi,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }),
  }));

  return json(200, { tipo, confirmToken, nome, cognome });
}

// --- POST /timbrature/conferma ---
// Legge la pending-entry, salva la timbratura definitiva con il realUserId, elimina la pending.
async function confermaTimbratura(event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const { confirmToken } = JSON.parse(event.body);
  if (!confirmToken) return json(400, 'confirmToken mancante');

  const queryResult = await dynamo.send(new QueryCommand({
    TableName:                 TIMBRATURE_TABLE,
    KeyConditionExpression:    'userId = :pk',
    ExpressionAttributeValues: marshall({ ':pk': `pending#${confirmToken}` }),
    Limit: 1,
  }));

  if (!queryResult.Items?.length) return json(404, 'Sessione scaduta o non trovata');
  const pending = unmarshall(queryResult.Items[0]);

  if (Math.floor(Date.now() / 1000) > (pending.expiresAt ?? 0))
    return json(410, 'Sessione scaduta — ricomincia dal QR');

  const timestamp = new Date().toISOString();

  await dynamo.send(new PutItemCommand({
    TableName: TIMBRATURE_TABLE,
    Item: marshall({
      userId:              pending.realUserId,
      nome:                pending.nome,
      cognome:             pending.cognome,
      timestamp,
      data:                pending.data,
      stationId:           pending.stationId,
      stazioneDescrizione: pending.stazioneDescrizione ?? '',
      tipo:                pending.tipo,
    }),
  }));

  // Elimina la pending-entry
  await dynamo.send(new DeleteItemCommand({
    TableName: TIMBRATURE_TABLE,
    Key: marshall({ userId: `pending#${confirmToken}`, timestamp: pending.timestamp }),
  }));

  return json(200, { tipo: pending.tipo, timestamp, nome: pending.nome, cognome: pending.cognome });
}

// --- POST /timbrature ---
// Verifica QR → verifica biometrica → recupera nome dipendente → determina tipo → salva
async function registraTimbratura(event: APIGatewayProxyEvent) {
  if (!event.body) return json(400, 'Body mancante');

  const { stationId, qrToken, expiresAt, assertion, sessionId, lat, lng } = JSON.parse(event.body);
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

  const { errore: erroreGps, descrizione: stazioneDescrizione } = await validaPosizioneGps(stationId, lat, lng);
  if (erroreGps) return json(403, erroreGps);

  let userId: string;
  try {
    userId = await verifyAssertion(assertion, sessionId);
  } catch (err: any) {
    return json(401, err.message);
  }

  // Recupera nome e cognome da Cognito — salvati nel record per evitare join successivi
  let nome = '', cognome = '';
  try {
    const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const attrs = Object.fromEntries((user.UserAttributes ?? []).map(a => [a.Name, a.Value]));
    nome    = attrs['given_name']  ?? '';
    cognome = attrs['family_name'] ?? '';
  } catch {
    // Se Cognito non risponde, la timbratura viene salvata comunque senza nome
  }

  const oggi   = new Date().toISOString().slice(0, 10);
  const ultima = await getUltimaTimbratura(userId, oggi);

  if (ultima && (Date.now() - new Date(ultima.timestamp).getTime()) < 60_000)
    return json(429, 'Hai già timbrato di recente. Attendi almeno 60 secondi.');

  const tipo   = (!ultima || ultima.tipo === 'uscita') ? 'entrata' : 'uscita';

  const timestamp = new Date().toISOString();
  await dynamo.send(new PutItemCommand({
    TableName: TIMBRATURE_TABLE,
    Item: marshall({ userId, nome, cognome, timestamp, data: oggi, stationId, stazioneDescrizione, tipo }),
  }));

  return json(200, { tipo, timestamp, userId, nome, cognome });
}

// --- GET /timbrature/dashboard ---
// Restituisce le timbrature di oggi aggregate per stazione, con il conteggio dei presenti.
async function getDashboard() {
  const oggi = new Date().toISOString().slice(0, 10);

  // 1. Tutte le timbrature di oggi
  const timRes = await dynamo.send(new QueryCommand({
    TableName:              TIMBRATURE_TABLE,
    IndexName:              'data-index',
    KeyConditionExpression: '#d = :data',
    ExpressionAttributeNames:  { '#d': 'data' },
    ExpressionAttributeValues: marshall({ ':data': oggi }),
    ScanIndexForward:          true,
  }));
  const timbratureOggi = (timRes.Items ?? []).map(i => unmarshall(i));

  // 2. Tutte le stazioni
  const staRes = await dynamo.send(new ScanCommand({ TableName: STAZIONI_TABLE }));
  const now    = Date.now();
  const stazioni = (staRes.Items ?? []).map(i => {
    const s = unmarshall(i);
    return {
      stationId:   s.stationId,
      descrizione: s.descrizione,
      codice:      s.codice,
      isActive:    s.lastSeen ? (now - new Date(s.lastSeen).getTime()) < 6 * 60 * 1000 : false,
    };
  });

  // 3. Calcola i presenti: per ogni userId, l'ultima timbratura di oggi determina la presenza
  //    Se l'ultima è "entrata" → l'utente è presente alla stazione di quella timbratura
  const ultimaPerUtente = new Map<string, any>();
  for (const t of timbratureOggi) {
    const attuale = ultimaPerUtente.get(t.userId);
    if (!attuale || t.timestamp > attuale.timestamp) {
      ultimaPerUtente.set(t.userId, t);
    }
  }
  // Conta i presenti per stationId
  const presentiPerStazione = new Map<string, number>();
  for (const t of ultimaPerUtente.values()) {
    if (t.tipo === 'entrata') {
      presentiPerStazione.set(t.stationId, (presentiPerStazione.get(t.stationId) ?? 0) + 1);
    }
  }

  // 4. Raggruppa le timbrature per stazione
  const timbraturePerStazione = new Map<string, any[]>();
  for (const t of timbratureOggi) {
    const lista = timbraturePerStazione.get(t.stationId) ?? [];
    lista.push(t);
    timbraturePerStazione.set(t.stationId, lista);
  }

  // 5. Costruisce la risposta: una entry per stazione (anche quelle senza timbrature oggi)
  const result = stazioni.map(s => ({
    ...s,
    presenti:    presentiPerStazione.get(s.stationId) ?? 0,
    timbrature:  (timbraturePerStazione.get(s.stationId) ?? [])
                   .sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp)),
  }));

  return json(200, result);
}

// --- GET /timbrature/me e GET /timbrature?userId=xxx ---
async function getTimbratureUtente(userId: string, mese?: string) {
  const meseTarget = mese ?? new Date().toISOString().slice(0, 7);

  const result = await dynamo.send(new QueryCommand({
    TableName:              TIMBRATURE_TABLE,
    KeyConditionExpression: 'userId = :uid AND begins_with(#ts, :mese)',
    ExpressionAttributeNames:  { '#ts': 'timestamp' },
    ExpressionAttributeValues: marshall({ ':uid': userId, ':mese': meseTarget }),
    ScanIndexForward:          false,
  }));

  return json(200, (result.Items ?? []).map(i => unmarshall(i)));
}

// Valida la distanza GPS tra dipendente e stazione.
// Ritorna { errore, descrizione }: errore è null se la validazione passa, descrizione è il nome leggibile della stazione.
async function validaPosizioneGps(stationId: string, lat?: number, lng?: number): Promise<{ errore: string | null; descrizione: string }> {
  if (lat == null || lng == null)
    return { errore: 'Posizione GPS non disponibile. Abilita la geolocalizzazione e riprova.', descrizione: '' };

  const result = await dynamo.send(new QueryCommand({
    TableName:                 STAZIONI_TABLE,
    KeyConditionExpression:    'stationId = :sid',
    ExpressionAttributeValues: marshall({ ':sid': stationId }),
    Limit: 1,
  }));
  if (!result.Items?.length) return { errore: 'Stazione non trovata.', descrizione: '' };
  const stazione = unmarshall(result.Items[0]);

  if (stazione.lat == null || stazione.lng == null)
    return { errore: 'La stazione non ha una posizione GPS configurata. Contatta il manager.', descrizione: stazione.descrizione ?? '' };

  const distanza = haversineMeters(lat, lng, stazione.lat, stazione.lng);
  if (distanza > MAX_DISTANCE_METERS)
    return { errore: `Sei troppo lontano dalla stazione (${Math.round(distanza)} m). Avvicinati entro ${MAX_DISTANCE_METERS} m.`, descrizione: stazione.descrizione ?? '' };

  return { errore: null, descrizione: stazione.descrizione ?? '' };
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

// Helper per formattare la risposta JSON
function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
  };
}
