jest.mock('@aws-sdk/client-dynamodb', () => {
  process.env.JWT_SECRET            = 'secret-test';
  process.env.STAZIONI_TABLE_NAME   = 'stazioni-test';
  process.env.TIMBRATURE_TABLE_NAME = 'timbrature-test';

  return {
    DynamoDBClient:    jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
    PutItemCommand:    jest.fn((i: any) => i),
    GetItemCommand:    jest.fn((i: any) => i),
    QueryCommand:      jest.fn((i: any) => i),
    ScanCommand:       jest.fn((i: any) => i),
    DeleteItemCommand: jest.fn((i: any) => i),
  };
});

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall:   jest.fn((obj: any) => obj),
  unmarshall: jest.fn((obj: any) => obj),
}));

jest.mock('bcryptjs', () => ({
  hash:    jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { generaJwt, verificaJwtStazione } from '../lib/lambda/stations-handler';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as crypto from 'crypto';

function makeEvent(authHeader?: string): APIGatewayProxyEvent {
  return { headers: authHeader ? { Authorization: authHeader } : {} } as any;
}

// ── generaJwt ────────────────────────────────────────────────────────────────

describe('generaJwt', () => {
  it('produce un token in formato header.body.signature', () => {
    const token = generaJwt({ stationId: 'st-1', codice: 'STZ-ABC123' });
    expect(token.split('.')).toHaveLength(3);
  });

  it('il payload decodificato contiene stationId e codice', () => {
    const token   = generaJwt({ stationId: 'st-1', codice: 'STZ-ABC123' });
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload.stationId).toBe('st-1');
    expect(payload.codice).toBe('STZ-ABC123');
  });

  it('il token scade in ~24h (exp - iat = 86400)', () => {
    const token   = generaJwt({ stationId: 'st-1', codice: 'STZ-ABC123' });
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload.exp - payload.iat).toBe(86400);
  });

  it("header dichiara alg HS256", () => {
    const token  = generaJwt({ stationId: 'st-1', codice: 'STZ-ABC123' });
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
  });
});

// ── verificaJwtStazione ───────────────────────────────────────────────────────

describe('verificaJwtStazione', () => {
  it('accetta il proprio token e restituisce i dati della stazione', () => {
    const token  = generaJwt({ stationId: 'st-1', codice: 'STZ-ABC123' });
    const result = verificaJwtStazione(makeEvent(`Bearer ${token}`));
    expect(result).toEqual({ stationId: 'st-1', codice: 'STZ-ABC123' });
  });

  it('rifiuta un token con firma manipolata', () => {
    const token    = generaJwt({ stationId: 'st-1', codice: 'STZ-ABC123' });
    const [h, b]   = token.split('.');
    const tampered = `${h}.${b}.firmaFalsa`;
    expect(verificaJwtStazione(makeEvent(`Bearer ${tampered}`))).toBeNull();
  });

  it('rifiuta un token scaduto', () => {
    const secret = 'secret-test';
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now    = Math.floor(Date.now() / 1000);
    const body   = Buffer.from(JSON.stringify({ stationId: 'st-1', codice: 'X', iat: now - 200000, exp: now - 100000 })).toString('base64url');
    const sign   = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    expect(verificaJwtStazione(makeEvent(`Bearer ${header}.${body}.${sign}`))).toBeNull();
  });

  it('rifiuta header Authorization assente', () => {
    expect(verificaJwtStazione(makeEvent())).toBeNull();
  });

  it('rifiuta header senza prefisso Bearer', () => {
    const token = generaJwt({ stationId: 'st-1', codice: 'STZ-ABC123' });
    expect(verificaJwtStazione(makeEvent(token))).toBeNull();
  });

  it('rifiuta token malformato (meno di 3 parti)', () => {
    expect(verificaJwtStazione(makeEvent('Bearer solo.dueparti'))).toBeNull();
  });
});
