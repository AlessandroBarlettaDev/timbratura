import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export function createCognito(scope: Construct) {
  // User Pool di Cognito (database utenti)
  const userPool = new cognito.UserPool(scope, 'TimbratureUserPool', {
    selfSignUpEnabled: false,               // utenti creati dal manager
    signInAliases: { email: true },         // utente può fare login usando l’email
    autoVerify: { email: true },            // verifica automatica dell’email
  });

  // Client per il User Pool (applicazione per farli loggare)
  const userPoolClient = new cognito.UserPoolClient(scope, 'TimbratureUserPoolClient', {
    userPool,
    authFlows: {
      userPassword: true,   
    },
  });

  return { userPool, userPoolClient };
}
