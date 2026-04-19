import * as crypto from 'crypto';

jest.mock('@aws-sdk/client-dynamodb', () => {
  // Le env var vengono impostate qui perché il factory viene hoistato prima degli import:
  // i moduli Lambda leggono queste variabili a livello di modulo (const X = process.env.X).
  process.env.JWT_SECRET            = 'secret-test';
  process.env.TIMBRATURE_TABLE_NAME = 'timbrature-test';
  process.env.STAZIONI_TABLE_NAME   = 'stazioni-test';
  process.env.USER_POOL_ID          = 'eu-west-1_test';

  return {
    DynamoDBClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({ Items: [] }) })),
    PutItemCommand:    jest.fn((i: any) => i),
    QueryCommand:      jest.fn((i: any) => i),
    ScanCommand:       jest.fn((i: any) => i),
    DeleteItemCommand: jest.fn((i: any) => i),
  };
});

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall:   jest.fn((obj: any) => obj),
  unmarshall: jest.fn((obj: any) => obj),
}));

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({ UserAttributes: [] }) })),
  AdminGetUserCommand: jest.fn((i: any) => i),
}));

jest.mock('../lib/lambda/biometric-handler', () => ({
  verifyAssertion: jest.fn().mockResolvedValue('user-test'),
}));

import { haversineMeters, calcolaTipo, handler } from '../lib/lambda/timbrature-handler';

// ── haversineMeters ──────────────────────────────────────────────────────────

describe('haversineMeters', () => {
  it('restituisce 0 per lo stesso punto', () => {
    expect(haversineMeters(45.4641, 9.1919, 45.4641, 9.1919)).toBe(0);
  });

  it('restituisce < 200 m per punti vicini (~100 m)', () => {
    // 0.0009° di latitudine ≈ 100 m
    const dist = haversineMeters(45.4641, 9.1919, 45.4650, 9.1919);
    expect(dist).toBeGreaterThan(50);
    expect(dist).toBeLessThan(200);
  });

  it('restituisce > 200 m per punti lontani (~1 km)', () => {
    // Duomo di Milano → Castello Sforzesco
    const dist = haversineMeters(45.4641, 9.1919, 45.4706, 9.1793);
    expect(dist).toBeGreaterThan(200);
    expect(dist).toBeLessThan(2000);
  });

  it('è simmetrico: d(A,B) === d(B,A)', () => {
    const d1 = haversineMeters(45.4641, 9.1919, 45.4706, 9.1793);
    const d2 = haversineMeters(45.4706, 9.1793, 45.4641, 9.1919);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});

// ── calcolaTipo ──────────────────────────────────────────────────────────────

describe('calcolaTipo', () => {
  it('entrata quando non ci sono timbrature precedenti', () => {
    expect(calcolaTipo(null)).toBe('entrata');
  });

  it('entrata quando l\'ultima era un\'uscita', () => {
    expect(calcolaTipo({ tipo: 'uscita', timestamp: new Date().toISOString() })).toBe('entrata');
  });

  it('uscita quando l\'ultima entrata è recente (turno in corso)', () => {
    const unOraFa = new Date(Date.now() - 3_600_000).toISOString();
    expect(calcolaTipo({ tipo: 'entrata', timestamp: unOraFa })).toBe('uscita');
  });

  it('uscita anche per turni notturni entro le 20 ore', () => {
    const dieciOreFa = new Date(Date.now() - 10 * 3_600_000).toISOString();
    expect(calcolaTipo({ tipo: 'entrata', timestamp: dieciOreFa })).toBe('uscita');
  });

  it('entrata quando l\'ultima entrata è > 20h fa (uscita dimenticata)', () => {
    const ventunOreFa = new Date(Date.now() - 21 * 3_600_000).toISOString();
    expect(calcolaTipo({ tipo: 'entrata', timestamp: ventunOreFa })).toBe('entrata');
  });
});

// ── Validazione QR (via handler) ─────────────────────────────────────────────

describe('handler – validazione QR', () => {
  const JWT_SECRET = 'secret-test';

  function makeEvent(body: object) {
    return {
      httpMethod:  'POST',
      resource:    '/timbrature/anteprima',
      body:        JSON.stringify(body),
      requestContext: {},
      queryStringParameters: null,
      pathParameters: null,
      headers: {},
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
      stageVariables: null,
      path: '/timbrature/anteprima',
      isBase64Encoded: false,
    } as any;
  }

  it('restituisce 400 quando il body è assente', async () => {
    const res = await handler({ ...makeEvent({}), body: null } as any);
    expect(res.statusCode).toBe(400);
  });

  it('restituisce 410 quando il QR è scaduto', async () => {
    const expiresAt = String(Math.floor(Date.now() / 1000) - 10);
    const res = await handler(makeEvent({
      stationId: 'station-1', qrToken: 'qualsiasi', expiresAt,
      assertion: {}, sessionId: 'sess-1',
    }));
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.body).message).toMatch(/QR scaduto/);
  });

  it('restituisce 401 quando il token QR non è valido', async () => {
    const expiresAt = String(Math.floor(Date.now() / 1000) + 300);
    const res = await handler(makeEvent({
      stationId: 'station-1', qrToken: 'token-sbagliato', expiresAt,
      assertion: {}, sessionId: 'sess-1',
    }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).message).toMatch(/QR non valido/);
  });

  it('accetta un token QR corretto (HMAC-SHA256)', async () => {
    const expiresAt = String(Math.floor(Date.now() / 1000) + 300);
    const qrToken   = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`station-1:${expiresAt}`)
      .digest('hex');

    const res = await handler(makeEvent({
      stationId: 'station-1', qrToken, expiresAt,
      assertion: {}, sessionId: 'sess-1',
    }));
    // 403 = GPS validation (stazione non trovata in DynamoDB mockato) — conferma che il QR è passato
    expect(res.statusCode).not.toBe(410);
    expect(res.statusCode).not.toBe(401);
  });
});
