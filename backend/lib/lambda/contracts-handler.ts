import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'crypto';
import { getJwtClaims, isManagerClaims } from './auth';
import { writeAudit } from './audit';

const dynamo          = new DynamoDBClient({});
const cognito         = new CognitoIdentityProviderClient({});
const CONTRACTS_TABLE = process.env.CONTRACTS_TABLE_NAME!;
const USER_POOL_ID    = process.env.USER_POOL_ID!;
const AUDIT_TABLE     = process.env.AUDIT_TABLE_NAME!;

// Punto di ingresso
export const handler = async (event: APIGatewayProxyEvent) => {
  const { httpMethod, resource } = event;
  const claims = getJwtClaims(event);
  if (!claims) return json(401, 'Non autenticato');

  const contractId = event.pathParameters?.id;

  // GET /contracts/me — dipendente legge i propri contratti (ordinati per data desc)
  if (httpMethod === 'GET' && resource === '/contracts/me') {
    return await getMieiContratti(claims['cognito:username']);
  }

  // Rotte riservate ai manager
  if (!isManagerClaims(claims)) {
    // Il dipendente può leggere un singolo contratto se è il proprietario
    if (httpMethod === 'GET' && contractId) return await getContrattoOwnerOrManager(contractId, claims['cognito:username']);
    return json(403, 'Accesso negato');
  }

  // POST /contracts — crea contratto per un dipendente
  if (httpMethod === 'POST' && resource === '/contracts') return await createContratto(event, claims);

  // GET /contracts?userId=xxx — lista contratti di un dipendente (manager)
  if (httpMethod === 'GET' && resource === '/contracts') {
    const userId = event.queryStringParameters?.userId;
    if (!userId) return json(400, 'Parametro userId obbligatorio');
    return await getContrattiUtente(userId);
  }

  if (!contractId) return json(400, 'Id contratto mancante');

  // GET /contracts/{id} — dettaglio contratto (manager)
  if (httpMethod === 'GET')    return await getContratto(contractId);

  // PUT /contracts/{id} — modifica contratto (manager)
  if (httpMethod === 'PUT')    return await updateContratto(contractId, event, claims);

  // DELETE /contracts/{id} — elimina contratto (manager)
  if (httpMethod === 'DELETE') return await deleteContratto(contractId, claims);

  return json(404, 'Rotta non trovata');
};

// --- POST /contracts ---
async function createContratto(event: APIGatewayProxyEvent, claims: any) {
  if (!event.body) return json(400, 'Body mancante');

  const raw = JSON.parse(event.body);
  const {
    userId, dataInizio, dataFine, tipoContratto,
    oreSett, giorniSett, retribuzioneLorda, retribuzioneNetta,
    livello, mansione, ccnl, periodoDiProva, giorniFerie, permessiOre, note,
  } = raw;

  if (!userId || !dataInizio || !tipoContratto) {
    return json(400, 'Campi obbligatori mancanti: userId, dataInizio, tipoContratto');
  }

  // Verifica che l'utente esista in Cognito
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
  } catch {
    return json(404, 'Dipendente non trovato');
  }

  const contractId = crypto.randomUUID();
  const createdAt  = new Date().toISOString();

  const item: Record<string, any> = {
    contractId, userId, dataInizio, tipoContratto, createdAt,
    ...(dataFine           != null && { dataFine }),
    ...(oreSett            != null && { oreSett: Number(oreSett) }),
    ...(giorniSett         != null && { giorniSett: Number(giorniSett) }),
    ...(retribuzioneLorda  != null && { retribuzioneLorda: Number(retribuzioneLorda) }),
    ...(retribuzioneNetta  != null && { retribuzioneNetta: Number(retribuzioneNetta) }),
    ...(livello            != null && { livello }),
    ...(mansione           != null && { mansione }),
    ...(ccnl               != null && { ccnl }),
    ...(periodoDiProva     != null && { periodoDiProva: Number(periodoDiProva) }),
    ...(giorniFerie        != null && { giorniFerie: Number(giorniFerie) }),
    ...(permessiOre        != null && { permessiOre: Number(permessiOre) }),
    ...(note               != null && { note }),
  };

  await dynamo.send(new PutItemCommand({ TableName: CONTRACTS_TABLE, Item: marshall(item) }));

  await writeAudit(AUDIT_TABLE, {
    actor:      claims['cognito:username'],
    actorRole:  'manager',
    action:     'CONTRACT_CREATE',
    entityType: 'contract',
    entityId:   contractId,
    details:    { userId, tipoContratto, dataInizio },
  });

  return json(201, { contractId });
}

// --- GET /contracts?userId=xxx ---
async function getContrattiUtente(userId: string) {
  const result = await dynamo.send(new QueryCommand({
    TableName:              CONTRACTS_TABLE,
    IndexName:              'userId-index',
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: marshall({ ':uid': userId }),
    ScanIndexForward: false, // più recenti prima
  }));
  return json(200, (result.Items ?? []).map(i => unmarshall(i)));
}

// --- GET /contracts/me ---
async function getMieiContratti(userId: string) {
  return await getContrattiUtente(userId);
}

// --- GET /contracts/{id} (manager) ---
async function getContratto(contractId: string) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: CONTRACTS_TABLE,
    Key: marshall({ contractId }),
  }));
  if (!result.Item) return json(404, 'Contratto non trovato');
  return json(200, unmarshall(result.Item));
}

// --- GET /contracts/{id} (employee — solo se è il proprio contratto) ---
async function getContrattoOwnerOrManager(contractId: string, userId: string) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: CONTRACTS_TABLE,
    Key: marshall({ contractId }),
  }));
  if (!result.Item) return json(404, 'Contratto non trovato');
  const contratto = unmarshall(result.Item);
  if (contratto.userId !== userId) return json(403, 'Accesso negato');
  return json(200, contratto);
}

// --- PUT /contracts/{id} ---
async function updateContratto(contractId: string, event: APIGatewayProxyEvent, claims: any) {
  if (!event.body) return json(400, 'Body mancante');

  // Campi aggiornabili — contractId e userId non sono modificabili
  const aggiornabili = [
    'dataInizio', 'dataFine', 'tipoContratto',
    'oreSett', 'giorniSett', 'retribuzioneLorda', 'retribuzioneNetta',
    'livello', 'mansione', 'ccnl', 'periodoDiProva', 'giorniFerie', 'permessiOre', 'note',
  ];

  const raw = JSON.parse(event.body);

  const setExprs:  string[]                      = [];
  const exprNames: Record<string, string>        = {};
  const exprVals:  Record<string, any>           = {};

  for (const campo of aggiornabili) {
    if (raw[campo] === undefined) continue;
    const alias = `#${campo}`;
    const marker = `:${campo}`;
    setExprs.push(`${alias} = ${marker}`);
    exprNames[alias] = campo;
    // Campi numerici convertiti esplicitamente
    const numerici = ['oreSett', 'giorniSett', 'retribuzioneLorda', 'retribuzioneNetta', 'periodoDiProva', 'giorniFerie', 'permessiOre'];
    exprVals[marker] = numerici.includes(campo) ? Number(raw[campo]) : raw[campo];
  }

  if (setExprs.length === 0) return json(400, 'Nessun campo da aggiornare');

  await dynamo.send(new UpdateItemCommand({
    TableName:                 CONTRACTS_TABLE,
    Key:                       marshall({ contractId }),
    UpdateExpression:          `SET ${setExprs.join(', ')}`,
    ExpressionAttributeNames:  exprNames,
    ExpressionAttributeValues: marshall(exprVals),
    ConditionExpression:       'attribute_exists(contractId)',
  }));

  await writeAudit(AUDIT_TABLE, {
    actor:      claims['cognito:username'],
    actorRole:  'manager',
    action:     'CONTRACT_UPDATE',
    entityType: 'contract',
    entityId:   contractId,
  });

  return json(200, { message: 'Contratto aggiornato' });
}

// --- DELETE /contracts/{id} ---
async function deleteContratto(contractId: string, claims: any) {
  await dynamo.send(new DeleteItemCommand({
    TableName: CONTRACTS_TABLE,
    Key: marshall({ contractId }),
  }));

  await writeAudit(AUDIT_TABLE, {
    actor:      claims['cognito:username'],
    actorRole:  'manager',
    action:     'CONTRACT_DELETE',
    entityType: 'contract',
    entityId:   contractId,
  });

  return json(200, { message: 'Contratto eliminato' });
}

function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
  };
}
