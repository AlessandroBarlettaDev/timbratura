import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand, AdminUpdateUserAttributesCommand } from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuidv4 } from 'uuid';
import { DateTime } from 'luxon';
import { getJwtClaims, isManagerClaims } from './auth';

const dynamo           = new DynamoDBClient({});
const cognito          = new CognitoIdentityProviderClient({});
const REQUESTS_TABLE   = process.env.REQUESTS_TABLE_NAME!;
const TIMBRATURE_TABLE = process.env.TIMBRATURE_TABLE_NAME!;
const WEBAUTHN_TABLE   = process.env.WEBAUTHN_TABLE_NAME!;
const USER_POOL_ID     = process.env.USER_POOL_ID!;

// Converte data (YYYY-MM-DD) e ora (HH:MM) locali italiane (Europe/Rome) in un timestamp ISO UTC.
export function oraLocaleToIsoUtc(data: string, ora: string): string {
  return DateTime.fromISO(`${data}T${ora}:00`, { zone: 'Europe/Rome' }).toUTC().toISO()!;
}

export const handler = async (event: APIGatewayProxyEvent) => {
  const claims = getJwtClaims(event);
  if (!claims) return json(401, 'Non autenticato');

  const { httpMethod, resource } = event;
  const requestId = event.pathParameters?.id;

  if (httpMethod === 'POST' && resource === '/requests')           return await creaRequest(event, claims);
  if (httpMethod === 'GET'  && resource === '/requests/me')        return await getMieRequests(claims);

  if (!isManagerClaims(claims)) return json(403, 'Accesso negato');

  if (httpMethod === 'GET'  && resource === '/requests')                            return await getRequestsPendenti();
  if (httpMethod === 'POST' && resource === '/requests/{id}/approve' && requestId)  return await approvaRequest(requestId, claims);
  if (httpMethod === 'POST' && resource === '/requests/{id}/reject'  && requestId)  return await rifiutaRequest(requestId, event, claims);

  return json(404, 'Rotta non trovata');
};

// --- POST /requests — il dipendente crea una richiesta ---
// tipoRichiesta = 'timbratura' (default) | 'reset_biometria'
async function creaRequest(event: APIGatewayProxyEvent, claims: any) {
  if (!event.body) return json(400, 'Body mancante');
  let parsedBody: any;
  try { parsedBody = JSON.parse(event.body); }
  catch { return json(400, 'JSON non valido'); }
  const { data, tipo, ora, nota, tipoRichiesta } = parsedBody;

  const isResetBiometria = tipoRichiesta === 'reset_biometria';

  if (isResetBiometria) {
    if (!nota?.trim()) return json(400, 'La nota è obbligatoria');
  } else {
    if (!data || !tipo || !ora || !nota?.trim())
      return json(400, 'Tutti i campi sono obbligatori: data, tipo, ora, nota');
    if (!['entrata', 'uscita'].includes(tipo))
      return json(400, 'Tipo non valido: deve essere entrata o uscita');
  }

  const userId = claims['cognito:username'];
  let nomeUtente = '';
  try {
    const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const attrs = Object.fromEntries((user.UserAttributes ?? []).map(a => [a.Name, a.Value]));
    nomeUtente = `${attrs['given_name'] ?? ''} ${attrs['family_name'] ?? ''}`.trim();
  } catch {}

  const item: Record<string, any> = {
    requestId:     uuidv4(),
    userId,
    nomeUtente,
    nota:          nota.trim(),
    stato:         'pendente',
    tipoRichiesta: tipoRichiesta ?? 'timbratura',
    createdAt:     new Date().toISOString(),
  };
  if (!isResetBiometria) {
    item.data = data;
    item.tipo = tipo;
    item.ora  = ora;
  }

  await dynamo.send(new PutItemCommand({ TableName: REQUESTS_TABLE, Item: marshall(item) }));
  return json(201, { message: 'Richiesta inviata' });
}

// --- GET /requests/me — il dipendente vede le proprie richieste ---
async function getMieRequests(claims: any) {
  const userId = claims['cognito:username'];
  const result = await dynamo.send(new QueryCommand({
    TableName:              REQUESTS_TABLE,
    IndexName:              'userId-index',
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: marshall({ ':uid': userId }),
    ScanIndexForward: false,
  }));
  return json(200, (result.Items ?? []).map(i => unmarshall(i)));
}

// --- GET /requests — il manager vede tutte le richieste pendenti ---
async function getRequestsPendenti() {
  const result = await dynamo.send(new QueryCommand({
    TableName:              REQUESTS_TABLE,
    IndexName:              'stato-index',
    KeyConditionExpression: 'stato = :s',
    ExpressionAttributeValues: marshall({ ':s': 'pendente' }),
    ScanIndexForward: false,
  }));
  return json(200, (result.Items ?? []).map(i => unmarshall(i)));
}

// --- POST /requests/{id}/approve — il manager approva e inserisce la timbratura ---
async function approvaRequest(requestId: string, claims: any) {
  const item = await getItem(requestId);
  if (!item) return json(404, 'Richiesta non trovata');
  if (item.stato !== 'pendente') return json(409, 'Richiesta già processata');

  // ── Branch: reset biometria ──────────────────────────────────────────────
  if (item.tipoRichiesta === 'reset_biometria') {
    // 1. Cancella tutte le credenziali WebAuthn del dipendente
    const credsResult = await dynamo.send(new QueryCommand({
      TableName:              WEBAUTHN_TABLE,
      IndexName:              'userId-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: marshall({ ':uid': item.userId }),
    }));
    const credentials = (credsResult.Items ?? []).map(i => unmarshall(i));
    await Promise.all(credentials.map(c =>
      dynamo.send(new DeleteItemCommand({
        TableName: WEBAUTHN_TABLE,
        Key:       marshall({ credentialId: c.credentialId }),
      }))
    ));

    // 2. Resetta il flag biometria — al prossimo login l'utente viene rimandato a /first-access
    await cognito.send(new AdminUpdateUserAttributesCommand({
      UserPoolId:     USER_POOL_ID,
      Username:       item.userId,
      UserAttributes: [{ Name: 'custom:biometrics_reg', Value: 'false' }],
    }));

    // 3. Aggiorna stato richiesta
    await dynamo.send(new UpdateItemCommand({
      TableName: REQUESTS_TABLE,
      Key: marshall({ requestId }),
      UpdateExpression: 'SET stato = :s, approvataDa = :m, approvataAt = :t',
      ExpressionAttributeValues: marshall({
        ':s': 'approvata',
        ':m': claims['cognito:username'],
        ':t': new Date().toISOString(),
      }),
    }));

    return json(200, { message: 'Biometria resettata' });
  }

  // ── Branch: timbratura manuale ───────────────────────────────────────────

  // Calcola il timestamp UTC della timbratura richiesta (usato sia per la query che per il salvataggio)
  const timestamp = oraLocaleToIsoUtc(item.data, item.ora);

  // Verifica che il tipo sia coerente con l'ultima timbratura PRIMA dell'orario richiesto.
  // Usa il timestamp calcolato come limite superiore per gestire correttamente le timbrature
  // inserite nel passato quando esistono già eventi successivi nello stesso giorno.
  const ultimaResult = await dynamo.send(new QueryCommand({
    TableName:              TIMBRATURE_TABLE,
    KeyConditionExpression: 'userId = :uid AND #ts < :ts',
    ExpressionAttributeNames:  { '#ts': 'timestamp' },
    ExpressionAttributeValues: marshall({ ':uid': item.userId, ':ts': timestamp }),
    ScanIndexForward: false,
    Limit: 1,
  }));
  const ultima = ultimaResult.Items?.[0] ? unmarshall(ultimaResult.Items[0]) : null;
  const tipoAtteso = (!ultima || ultima.tipo === 'uscita') ? 'entrata' : 'uscita';
  if (item.tipo !== tipoAtteso)
    return json(409, `Tipo non coerente: prima di questo orario l'ultima timbratura è una ${ultima?.tipo ?? '—'}, quindi la successiva deve essere una ${tipoAtteso}`);

  // Verifica anche la timbratura immediatamente successiva all'orario richiesto
  const successivaResult = await dynamo.send(new QueryCommand({
    TableName:              TIMBRATURE_TABLE,
    KeyConditionExpression: 'userId = :uid AND #ts > :ts',
    ExpressionAttributeNames:  { '#ts': 'timestamp' },
    ExpressionAttributeValues: marshall({ ':uid': item.userId, ':ts': timestamp }),
    ScanIndexForward: true,
    Limit: 1,
  }));
  const successiva = successivaResult.Items?.[0] ? unmarshall(successivaResult.Items[0]) : null;
  if (successiva) {
    const tipoSuccessivoAtteso = item.tipo === 'entrata' ? 'uscita' : 'entrata';
    if (successiva.tipo !== tipoSuccessivoAtteso)
      return json(409, `Tipo non coerente: la timbratura successiva a questo orario è una ${successiva.tipo}, quindi questa deve essere ${tipoSuccessivoAtteso}`);
  }

  // Recupera nome e cognome per salvarlo nella timbratura (evita join successivi)
  let nome = '', cognome = '';
  try {
    const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: item.userId }));
    const attrs = Object.fromEntries((user.UserAttributes ?? []).map((a: any) => [a.Name, a.Value]));
    nome    = attrs['given_name']  ?? '';
    cognome = attrs['family_name'] ?? '';
  } catch {}
  await dynamo.send(new PutItemCommand({
    TableName: TIMBRATURE_TABLE,
    Item: marshall({
      userId:              item.userId,
      nome,
      cognome,
      timestamp,
      data:                item.data,
      tipo:                item.tipo,
      stazioneDescrizione: 'Manuale',
    }),
  }));

  await dynamo.send(new UpdateItemCommand({
    TableName: REQUESTS_TABLE,
    Key: marshall({ requestId }),
    UpdateExpression: 'SET stato = :s, approvataDa = :m, approvataAt = :t',
    ExpressionAttributeValues: marshall({
      ':s': 'approvata',
      ':m': claims['cognito:username'],
      ':t': new Date().toISOString(),
    }),
  }));

  return json(200, { message: 'Richiesta approvata' });
}

// --- POST /requests/{id}/reject — il manager rifiuta con motivo obbligatorio ---
async function rifiutaRequest(requestId: string, event: APIGatewayProxyEvent, claims: any) {
  if (!event.body) return json(400, 'Body mancante');
  let parsedBody: any;
  try { parsedBody = JSON.parse(event.body); }
  catch { return json(400, 'JSON non valido'); }
  const { motivo } = parsedBody;
  if (!motivo?.trim()) return json(400, 'Il motivo del rifiuto è obbligatorio');

  const item = await getItem(requestId);
  if (!item) return json(404, 'Richiesta non trovata');
  if (item.stato !== 'pendente') return json(409, 'Richiesta già processata');

  await dynamo.send(new UpdateItemCommand({
    TableName: REQUESTS_TABLE,
    Key: marshall({ requestId }),
    UpdateExpression: 'SET stato = :s, motivoRifiuto = :m',
    ExpressionAttributeValues: marshall({
      ':s': 'rifiutata',
      ':m': motivo.trim(),
    }),
  }));

  return json(200, { message: 'Richiesta rifiutata' });
}

// --- Funzione di utilità per recuperare una richiesta per ID ---
async function getItem(requestId: string) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: REQUESTS_TABLE,
    Key:       marshall({ requestId }),
  }));
  return result.Item ? unmarshall(result.Item) : null;
}

function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
  };
}
