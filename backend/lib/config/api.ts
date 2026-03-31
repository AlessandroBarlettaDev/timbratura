import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

// Proprietà per la configurazione dell'API
interface ApiConfigProps {
  userPool: cognito.IUserPool;
}

export class ApiConfig extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: ApiConfigProps) {
    super(scope, id);
    this.api = this.createApi();
    this.authorizer = this.createAuthorizer(props.userPool);
  }

  // Crea la RestApi con CORS
  private createApi(): apigateway.RestApi {
    return new apigateway.RestApi(this, 'TimbraturaApi', {
      restApiName: 'Timbratura Service',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // TODO: restringere in prod
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });
  }

  // Crea l'authorizer Cognito — valida il JWT su ogni richiesta protetta
  private createAuthorizer(userPool: cognito.IUserPool): apigateway.CognitoUserPoolsAuthorizer {
    return new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
    });
  }

  // Aggiunge tutte le rotte /users protette, collegate alla stessa lambda
  public addUsersRoutes(handler: lambda.IFunction) {
    const opts = {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const users = this.api.root.addResource('users');
    users.addMethod('POST', new apigateway.LambdaIntegration(handler), opts); // Crea dipendente
    users.addMethod('GET',  new apigateway.LambdaIntegration(handler), opts); // Lista dipendenti

    const user = users.addResource('{id}');
    user.addMethod('GET',    new apigateway.LambdaIntegration(handler), opts); // Dettaglio dipendente
    user.addMethod('PUT',    new apigateway.LambdaIntegration(handler), opts); // Modifica dipendente
    user.addMethod('DELETE', new apigateway.LambdaIntegration(handler), opts); // Elimina dipendente
  }
}
