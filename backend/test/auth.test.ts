import { getJwtClaims, isManagerClaims, isEmployeeClaims } from '../lib/lambda/auth';
import { APIGatewayProxyEvent } from 'aws-lambda';

function makeEvent(claims?: Record<string, any>): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: claims !== undefined ? { claims } : undefined,
    },
  } as any;
}

describe('getJwtClaims', () => {
  it('restituisce i claims quando presenti', () => {
    const claims = { sub: 'user-1', 'cognito:groups': ['manager'] };
    expect(getJwtClaims(makeEvent(claims))).toEqual(claims);
  });

  it('restituisce oggetto vuoto quando authorizer è assente', () => {
    const event = { requestContext: {} } as any;
    expect(getJwtClaims(event)).toEqual({});
  });

  it('restituisce oggetto vuoto quando authorizer non ha claims', () => {
    expect(getJwtClaims(makeEvent())).toEqual({});
  });
});

describe('isManagerClaims', () => {
  it('true quando il gruppo manager è presente', () => {
    expect(isManagerClaims({ 'cognito:groups': ['manager'] })).toBe(true);
  });

  it('true quando manager è tra più gruppi', () => {
    expect(isManagerClaims({ 'cognito:groups': ['employee', 'manager'] })).toBe(true);
  });

  it('false quando c\'è solo employee', () => {
    expect(isManagerClaims({ 'cognito:groups': ['employee'] })).toBe(false);
  });

  it('falsy quando cognito:groups è assente', () => {
    expect(isManagerClaims({})).toBeFalsy();
  });

  it('falsy con array vuoto', () => {
    expect(isManagerClaims({ 'cognito:groups': [] })).toBeFalsy();
  });
});

describe('isEmployeeClaims', () => {
  it('true quando il gruppo employee è presente', () => {
    expect(isEmployeeClaims({ 'cognito:groups': ['employee'] })).toBe(true);
  });

  it('false quando c\'è solo manager', () => {
    expect(isEmployeeClaims({ 'cognito:groups': ['manager'] })).toBe(false);
  });

  it('falsy quando cognito:groups è assente', () => {
    expect(isEmployeeClaims({})).toBeFalsy();
  });
});
