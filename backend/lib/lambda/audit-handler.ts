import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getJwtClaims, isManagerClaims } from './auth';

const dynamo        = new DynamoDBClient({});
const AUDIT_TABLE   = process.env.AUDIT_TABLE_NAME!;

// Punto di ingresso — routing per le rotte /audit/*
export const handler = async (event: APIGatewayProxyEvent) => {
  const { resource, httpMethod, queryStringParameters } = event;

  try {
    // Tutte le rotte di audit richiedono autenticazione e ruolo manager
    const claims = getJwtClaims(event);
    if (!claims) return json(401, 'Non autenticato');
    if (!isManagerClaims(claims)) return json(403, 'Solo manager possono accedere all\'audit trail');

    // GET /audit — lista generica con filtri opzionali
    if (httpMethod === 'GET' && resource === '/audit') {
      return await getAuditTrail(queryStringParameters);
    }

    // GET /audit/actor/{actor} — filtrato per attore
    if (httpMethod === 'GET' && resource.startsWith('/audit/actor/')) {
      const actor = resource.split('/').pop();
      if (!actor) return json(400, 'Actor mancante');
      return await getAuditByActor(actor, queryStringParameters);
    }

    // GET /audit/entity/{entityType}/{entityId} — filtrato per entità
    if (httpMethod === 'GET' && resource.startsWith('/audit/entity/')) {
      const parts = resource.split('/');
      const entityType = parts[2];
      const entityId = parts[3];
      if (!entityType || !entityId) return json(400, 'Entity type o ID mancante');
      return await getAuditByEntity(entityType, entityId, queryStringParameters);
    }

    return json(404, 'Rotta non trovata');
  } catch (err: any) {
    console.error('[audit-handler] error:', err);
    return json(500, 'Errore interno');
  }
};

// --- GET /audit — lista generica
async function getAuditTrail(params?: Record<string, string>) {
  const fromDate = params?.from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
  const toDate   = params?.to   ?? new Date().toISOString().slice(0, 10);
  const limit    = Math.min(parseInt(params?.limit ?? '50'), 100);
  const lastKey  = params?.lastKey ? JSON.parse(Buffer.from(params.lastKey, 'base64').toString()) : undefined;

  // Scan con FilterExpression per range di date
  const result = await dynamo.send(new ScanCommand({
    TableName: AUDIT_TABLE,
    FilterExpression: '#ts BETWEEN :from AND :to',
    ExpressionAttributeNames:  { '#ts': 'timestamp' },
    ExpressionAttributeValues: marshall({
      ':from': new Date(fromDate).toISOString().split('T')[0],
      ':to':   new Date(toDate).toISOString().split('T')[0],
    }),
    Limit: limit,
    ExclusiveStartKey: lastKey,
  }));

  const items = (result.Items ?? []).map(i => unmarshall(i));
  const nextKey = result.LastEvaluatedKey 
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : null;

  return json(200, {
    records: items,
    count: items.length,
    nextKey,
    from: fromDate,
    to: toDate,
  });
}

// --- GET /audit/actor/{actor} — query per attore
async function getAuditByActor(actor: string, params?: Record<string, string>) {
  const limit   = Math.min(parseInt(params?.limit ?? '50'), 100);
  const lastKey = params?.lastKey ? JSON.parse(Buffer.from(params.lastKey, 'base64').toString()) : undefined;

  const result = await dynamo.send(new QueryCommand({
    TableName: AUDIT_TABLE,
    IndexName: 'actor-index',
    KeyConditionExpression: 'actor = :actor',
    ExpressionAttributeValues: marshall({ ':actor': actor }),
    ScanIndexForward: false,
    Limit: limit,
    ExclusiveStartKey: lastKey,
  }));

  const items = (result.Items ?? []).map(i => unmarshall(i));
  const nextKey = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : null;

  return json(200, {
    actor,
    records: items,
    count: items.length,
    nextKey,
  });
}

// --- GET /audit/entity/{entityType}/{entityId} — query per entità
async function getAuditByEntity(entityType: string, entityId: string, params?: Record<string, string>) {
  const limit   = Math.min(parseInt(params?.limit ?? '50'), 100);
  const lastKey = params?.lastKey ? JSON.parse(Buffer.from(params.lastKey, 'base64').toString()) : undefined;

  // Nota: entityId è memorizzato come parte di 'details', non come PK separate.
  // Per ora facciamo scan con filter; se performance diventa critica, aggiungere GSI
  const result = await dynamo.send(new ScanCommand({
    TableName: AUDIT_TABLE,
    FilterExpression: 'entityType = :et AND entityId = :eid',
    ExpressionAttributeValues: marshall({
      ':et': entityType,
      ':eid': entityId,
    }),
    Limit: limit,
    ExclusiveStartKey: lastKey,
  }));

  const items = (result.Items ?? []).map(i => unmarshall(i));
  const nextKey = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : null;

  return json(200, {
    entityType,
    entityId,
    records: items,
    count: items.length,
    nextKey,
  });
}

// Helper per formattare la risposta JSON
function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
  };
}
