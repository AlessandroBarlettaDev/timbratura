import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export function createApi(
    scope: Construct,
    userPool: cognito.UserPool) {
   
    // Esempio di creazione di una funzione Lambda e un'API Gateway
    const handler = new lambda.Function(scope, 'TimbratureHandler', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline(`
        exports.handler = async () => {
            return {
            statusCode: 200,
            body: JSON.stringify({ message: "API timbrature attiva 🚀" })
            };
        };
        `),
    });

    // Creazione dell'API Gateway (RestApi)
    const api = new apigateway.RestApi(scope, 'TimbratureApi');

    // Autorizzatore per API Gateway
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(scope, 'TimbratureAuthorizer', {
        cognitoUserPools: [userPool],
    });

    // Aggiunta di una risorsa protetta all'API
    const secure = api.root.addResource('secure');

    // Aggiunta del metodo GET alla risorsa protetta, con integrazione Lambda e autorizzazione Cognito
    secure.addMethod('GET', new apigateway.LambdaIntegration(handler), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    return api;
}