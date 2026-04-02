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

  // Aggiunge le rotte /stazioni — alcune protette da Cognito (manager), altre pubbliche o con JWT custom
  public addStazioniRoutes(handler: lambda.IFunction) {
    const cognitoOpts = {
      authorizer:     this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };
    // Nessun authorizer — il login è pubblico, le rotte /me verificano il JWT dentro la Lambda
    const noAuth = { authorizationType: apigateway.AuthorizationType.NONE };

    const stazioni = this.api.root.addResource('stazioni');
    stazioni.addMethod('POST', new apigateway.LambdaIntegration(handler), cognitoOpts); // Crea stazione (manager)
    stazioni.addMethod('GET',  new apigateway.LambdaIntegration(handler), cognitoOpts); // Lista stazioni (manager)

    stazioni.addResource('login').addMethod('POST', new apigateway.LambdaIntegration(handler), noAuth); // Login stazione

    const me = stazioni.addResource('me');
    me.addResource('qr').addMethod('GET',           new apigateway.LambdaIntegration(handler), noAuth); // QR corrente
    me.addResource('position').addMethod('POST',    new apigateway.LambdaIntegration(handler), noAuth); // Aggiorna posizione

    const stazioneId = stazioni.addResource('{id}');
    stazioneId.addMethod('DELETE', new apigateway.LambdaIntegration(handler), cognitoOpts); // Elimina stazione (manager)
  }

  // Aggiunge le rotte /biometric protette per la registrazione WebAuthn
  public addBiometricRoutes(handler: lambda.IFunction) {
    const opts = {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const biometric    = this.api.root.addResource('biometric');
    const registration = biometric.addResource('registration');
    registration.addResource('start').addMethod('POST',    new apigateway.LambdaIntegration(handler), opts); // Genera challenge
    registration.addResource('complete').addMethod('POST', new apigateway.LambdaIntegration(handler), opts); // Verifica e salva
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

    const passwordChanged = users.addResource('password-changed');
    passwordChanged.addMethod('POST', new apigateway.LambdaIntegration(handler), opts); // Segna password cambiata

    const biometricsRegistered = users.addResource('biometrics-registered');
    biometricsRegistered.addMethod('POST', new apigateway.LambdaIntegration(handler), opts); // Segna biometria registrata

    const user = users.addResource('{id}');
    user.addMethod('GET',    new apigateway.LambdaIntegration(handler), opts); // Dettaglio dipendente
    user.addMethod('PUT',    new apigateway.LambdaIntegration(handler), opts); // Modifica dipendente
    user.addMethod('DELETE', new apigateway.LambdaIntegration(handler), opts); // Elimina dipendente
  }
}
