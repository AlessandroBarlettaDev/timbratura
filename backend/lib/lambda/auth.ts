import { APIGatewayProxyEvent } from 'aws-lambda';

// Estrae i claims JWT dall'evento API Gateway REST
export function getJwtClaims(event: APIGatewayProxyEvent): any {
  return event.requestContext.authorizer?.claims || {};
}

// Funzioni di utility per autenticazione/ruoli
export function isManagerClaims(claims: any): boolean {
  return claims['cognito:groups']?.includes('manager');
}
export function isEmployeeClaims(claims: any): boolean {
  return claims['cognito:groups']?.includes('employee');
}
