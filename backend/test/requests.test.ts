jest.mock('@aws-sdk/client-dynamodb', () => {
  process.env.REQUESTS_TABLE_NAME   = 'requests-test';
  process.env.TIMBRATURE_TABLE_NAME = 'timbrature-test';
  process.env.WEBAUTHN_TABLE_NAME   = 'webauthn-test';
  process.env.USER_POOL_ID          = 'eu-west-1_test';

  return {
    DynamoDBClient:    jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
    PutItemCommand:    jest.fn((i: any) => i),
    GetItemCommand:    jest.fn((i: any) => i),
    QueryCommand:      jest.fn((i: any) => i),
    UpdateItemCommand: jest.fn((i: any) => i),
    DeleteItemCommand: jest.fn((i: any) => i),
  };
});

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall:   jest.fn((obj: any) => obj),
  unmarshall: jest.fn((obj: any) => obj),
}));

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient:    jest.fn(() => ({ send: jest.fn().mockResolvedValue({ UserAttributes: [] }) })),
  AdminGetUserCommand:              jest.fn((i: any) => i),
  AdminUpdateUserAttributesCommand: jest.fn((i: any) => i),
}));

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { handler, oraLocaleToIsoUtc } from '../lib/lambda/requests-handler';

// ── Helpers ───────────────────────────────────────────────────────────────────

const employeeClaims = { 'cognito:username': 'user-1', 'cognito:groups': ['employee'] };
const managerClaims  = { 'cognito:username': 'manager-1', 'cognito:groups': ['manager'] };

function makeEvent(overrides: Partial<{
  httpMethod: string;
  resource: string;
  body: string | null;
  pathParameters: Record<string, string> | null;
  claims: Record<string, any> | null;
}>): any {
  const { claims = employeeClaims, ...rest } = overrides;
  return {
    httpMethod:      'GET',
    resource:        '/requests',
    body:            null,
    pathParameters:  null,
    queryStringParameters: null,
    requestContext:  claims ? { authorizer: { claims } } : {},
    headers:         {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables:  null,
    path:            '/',
    isBase64Encoded: false,
    ...rest,
  };
}

let mockSend: jest.Mock;

beforeAll(() => {
  mockSend = (DynamoDBClient as jest.Mock).mock.results[0].value.send;
});

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

// ── oraLocaleToIsoUtc ─────────────────────────────────────────────────────────

describe('oraLocaleToIsoUtc', () => {
  it('restituisce una stringa ISO 8601 valida', () => {
    const result = oraLocaleToIsoUtc('2024-01-15', '14:00');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('date diverse producono timestamp diversi', () => {
    const t1 = oraLocaleToIsoUtc('2024-01-15', '09:00');
    const t2 = oraLocaleToIsoUtc('2024-01-16', '09:00');
    expect(new Date(t2).getTime() - new Date(t1).getTime()).toBe(86_400_000);
  });
});

// ── POST /requests ────────────────────────────────────────────────────────────

describe('POST /requests – validazione', () => {
  const post = (body: string | null) => handler(makeEvent({
    httpMethod: 'POST', resource: '/requests', body,
  }));

  it('restituisce 400 se il body è assente', async () => {
    const res = await post(null);
    expect(res.statusCode).toBe(400);
  });

  it('restituisce 400 se il body non è JSON valido', async () => {
    const res = await post('non-json');
    expect(res.statusCode).toBe(400);
  });

  it('restituisce 400 per reset_biometria senza nota', async () => {
    const res = await post(JSON.stringify({ tipoRichiesta: 'reset_biometria', nota: '   ' }));
    expect(res.statusCode).toBe(400);
  });

  it('restituisce 400 per timbratura senza campi obbligatori', async () => {
    const res = await post(JSON.stringify({ data: '2024-01-15', tipo: 'entrata' }));
    expect(res.statusCode).toBe(400);
  });

  it('restituisce 400 per tipo non valido', async () => {
    const res = await post(JSON.stringify({ data: '2024-01-15', tipo: 'pausa', ora: '09:00', nota: 'test' }));
    expect(res.statusCode).toBe(400);
  });

  it('restituisce 201 per timbratura valida', async () => {
    const res = await post(JSON.stringify({ data: '2024-01-15', tipo: 'entrata', ora: '09:00', nota: 'dimenticato' }));
    expect(res.statusCode).toBe(201);
  });

  it('restituisce 201 per reset_biometria valido', async () => {
    const res = await post(JSON.stringify({ tipoRichiesta: 'reset_biometria', nota: 'nuovo dispositivo' }));
    expect(res.statusCode).toBe(201);
  });
});

// ── GET /requests/me ──────────────────────────────────────────────────────────

describe('GET /requests/me', () => {
  it('restituisce 200 con le richieste dell\'utente', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ requestId: 'req-1', stato: 'pendente' }] });
    const res = await handler(makeEvent({ httpMethod: 'GET', resource: '/requests/me' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([{ requestId: 'req-1', stato: 'pendente' }]);
  });

  it('restituisce 200 con array vuoto se nessuna richiesta', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await handler(makeEvent({ httpMethod: 'GET', resource: '/requests/me' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });
});

// ── GET /requests (manager) ───────────────────────────────────────────────────

describe('GET /requests', () => {
  it('restituisce 403 se non è un manager', async () => {
    const res = await handler(makeEvent({ httpMethod: 'GET', resource: '/requests', claims: employeeClaims }));
    expect(res.statusCode).toBe(403);
  });

  it('restituisce 200 con le richieste pendenti se è un manager', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ requestId: 'req-1', stato: 'pendente' }] });
    const res = await handler(makeEvent({ httpMethod: 'GET', resource: '/requests', claims: managerClaims }));
    expect(res.statusCode).toBe(200);
  });
});

// ── POST /requests/{id}/approve ───────────────────────────────────────────────

describe('POST /requests/{id}/approve', () => {
  const approve = (requestId: string) => handler(makeEvent({
    httpMethod: 'POST', resource: '/requests/{id}/approve',
    pathParameters: { id: requestId }, claims: managerClaims,
  }));

  it('restituisce 404 se la richiesta non esiste', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const res = await approve('inesistente');
    expect(res.statusCode).toBe(404);
  });

  it('restituisce 409 se la richiesta è già processata', async () => {
    mockSend.mockResolvedValueOnce({ Item: { requestId: 'req-1', stato: 'approvata' } });
    const res = await approve('req-1');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toMatch(/già processata/);
  });

  it('approva reset_biometria e restituisce 200', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { requestId: 'req-1', stato: 'pendente', tipoRichiesta: 'reset_biometria', userId: 'user-1' } })
      .mockResolvedValueOnce({ Items: [] })   // query WebAuthn credentials
      .mockResolvedValueOnce({});             // update richiesta
    const res = await approve('req-1');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toMatch(/[Bb]iometria/);
  });

  it('approva timbratura manuale coerente e restituisce 200', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { requestId: 'req-1', stato: 'pendente', tipoRichiesta: 'timbratura', userId: 'user-1', data: '2024-01-15', ora: '09:00', tipo: 'entrata' } })
      .mockResolvedValueOnce({ Items: [] })   // nessuna timbratura precedente → atteso 'entrata'
      .mockResolvedValueOnce({})              // PutItem timbratura
      .mockResolvedValueOnce({});             // UpdateItem richiesta
    const res = await approve('req-1');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toMatch(/approvata/i);
  });

  it('restituisce 409 se il tipo non è coerente con l\'ultima timbratura', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { requestId: 'req-1', stato: 'pendente', tipoRichiesta: 'timbratura', userId: 'user-1', data: '2024-01-15', ora: '09:00', tipo: 'entrata' } })
      .mockResolvedValueOnce({ Items: [{ tipo: 'entrata', timestamp: '2024-01-15T07:00:00.000Z' }] }); // ultima era entrata → atteso 'uscita'
    const res = await approve('req-1');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toMatch(/[Tt]ipo non coerente/);
  });
});

// ── POST /requests/{id}/reject ────────────────────────────────────────────────

describe('POST /requests/{id}/reject', () => {
  const reject = (requestId: string, body: string | null) => handler(makeEvent({
    httpMethod: 'POST', resource: '/requests/{id}/reject',
    pathParameters: { id: requestId }, body, claims: managerClaims,
  }));

  it('restituisce 400 se il body è assente', async () => {
    const res = await reject('req-1', null);
    expect(res.statusCode).toBe(400);
  });

  it('restituisce 400 se il motivo è vuoto', async () => {
    const res = await reject('req-1', JSON.stringify({ motivo: '  ' }));
    expect(res.statusCode).toBe(400);
  });

  it('restituisce 404 se la richiesta non esiste', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const res = await reject('inesistente', JSON.stringify({ motivo: 'non approvabile' }));
    expect(res.statusCode).toBe(404);
  });

  it('restituisce 409 se la richiesta è già processata', async () => {
    mockSend.mockResolvedValueOnce({ Item: { requestId: 'req-1', stato: 'rifiutata' } });
    const res = await reject('req-1', JSON.stringify({ motivo: 'troppo tardi' }));
    expect(res.statusCode).toBe(409);
  });

  it('restituisce 200 per rifiuto valido', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { requestId: 'req-1', stato: 'pendente' } })
      .mockResolvedValueOnce({});
    const res = await reject('req-1', JSON.stringify({ motivo: 'non approvabile' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toMatch(/rifiutata/i);
  });
});
