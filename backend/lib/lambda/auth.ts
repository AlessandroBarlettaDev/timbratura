import { APIGatewayProxyEvent } from 'aws-lambda';

// Estrae i claims JWT dall'evento API Gateway REST
export function getJwtClaims(event: APIGatewayProxyEvent): any {
  return event.requestContext.authorizer?.claims || {};
}

// Funzioni di utility per autenticazione/ruoli
export function isManagerClaims(claims: any): boolean {   // Controlla se i claims JWT includono il gruppo "manager"
  return claims['cognito:groups']?.includes('manager');   // Utilizzato per autorizzare l'accesso a funzionalità riservate ai manager, come la gestione delle richieste di timbratura.
}
export function isEmployeeClaims(claims: any): boolean {  // Controlla se i claims JWT includono il gruppo "employee"
  return claims['cognito:groups']?.includes('employee');  // Utilizzato per autorizzare l'accesso a funzionalità riservate ai dipendenti, come la timbratura e la visualizzazione delle proprie timbrature.
}
