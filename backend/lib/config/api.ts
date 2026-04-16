import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

// Proprietà per la configurazione dell'API
interface ApiConfigProps {
  userPool: cognito.IUserPool;
  appUrl:   string;
}

export class ApiConfig extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: ApiConfigProps) {
    super(scope, id);
    this.api = this.createApi(props.appUrl);
    this.authorizer = this.createAuthorizer(props.userPool);
  }

  // Crea la RestApi con CORS ristretto al dominio CloudFront
  private createApi(appUrl: string): apigateway.RestApi {
    return new apigateway.RestApi(this, 'TimbraturaApi', {
      restApiName: 'Timbratura Service',
      defaultCorsPreflightOptions: {
        allowOrigins: [appUrl],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key'],
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
    stazioneId.addMethod('GET',    new apigateway.LambdaIntegration(handler), cognitoOpts); // Dettaglio stazione (manager)
    stazioneId.addMethod('DELETE', new apigateway.LambdaIntegration(handler), cognitoOpts); // Elimina stazione (manager)
  }

  // Aggiunge le rotte /biometric — registrazione (Cognito) + autenticazione (pubblica)
  public addBiometricRoutes(handler: lambda.IFunction) {
    const cognitoOpts = { authorizer: this.authorizer, authorizationType: apigateway.AuthorizationType.COGNITO };
    const noAuth      = { authorizationType: apigateway.AuthorizationType.NONE };

    const biometric    = this.api.root.addResource('biometric');
    const registration = biometric.addResource('registration');
    registration.addResource('start').addMethod('POST',    new apigateway.LambdaIntegration(handler), cognitoOpts);
    registration.addResource('complete').addMethod('POST', new apigateway.LambdaIntegration(handler), cognitoOpts);

    const authentication = biometric.addResource('authentication');
    authentication.addResource('start').addMethod('POST',    new apigateway.LambdaIntegration(handler), noAuth);
    authentication.addResource('complete').addMethod('POST', new apigateway.LambdaIntegration(handler), noAuth);
  }

  // Aggiunge le rotte /timbrature
  public addTimbratureRoutes(handler: lambda.IFunction) {
    const cognitoOpts = {
      authorizer:        this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };
    const noAuth = { authorizationType: apigateway.AuthorizationType.NONE };

    const timbrature = this.api.root.addResource('timbrature');
    timbrature.addMethod('POST', new apigateway.LambdaIntegration(handler), noAuth);       // Registra timbratura (biometria + QR)
    timbrature.addMethod('GET',  new apigateway.LambdaIntegration(handler), cognitoOpts);  // Timbrature di un dipendente (manager)

    timbrature.addResource('anteprima').addMethod('POST', new apigateway.LambdaIntegration(handler), noAuth);  // Verifica QR+biometria, calcola tipo
    timbrature.addResource('conferma').addMethod('POST',  new apigateway.LambdaIntegration(handler), noAuth);  // Conferma e salva definitivamente

    timbrature.addResource('me')
      .addMethod('GET', new apigateway.LambdaIntegration(handler), cognitoOpts);           // Timbrature del dipendente loggato

    timbrature.addResource('dashboard')
      .addMethod('GET', new apigateway.LambdaIntegration(handler), cognitoOpts);           // Dashboard odierna aggregata per stazione (manager)
  }

  // Aggiunge le rotte /requests — dipendente (Cognito) e manager (Cognito)
  public addRequestsRoutes(handler: lambda.IFunction) {
    const cognitoOpts = { authorizer: this.authorizer, authorizationType: apigateway.AuthorizationType.COGNITO };

    const requests = this.api.root.addResource('requests');
    requests.addMethod('POST', new apigateway.LambdaIntegration(handler), cognitoOpts); // Crea richiesta (employee)
    requests.addMethod('GET',  new apigateway.LambdaIntegration(handler), cognitoOpts); // Lista pendenti (manager)

    requests.addResource('me').addMethod('GET', new apigateway.LambdaIntegration(handler), cognitoOpts); // Mie richieste (employee)

    const requestId = requests.addResource('{id}');
    requestId.addResource('approve').addMethod('POST', new apigateway.LambdaIntegration(handler), cognitoOpts); // Approva (manager)
    requestId.addResource('reject').addMethod('POST',  new apigateway.LambdaIntegration(handler), cognitoOpts); // Rifiuta (manager)
  }

  // Aggiunge le rotte /contracts — tutte protette da Cognito
  // Manager: CRUD completo + lista per userId
  // Employee: sola lettura dei propri contratti via /contracts/me
  public addContractsRoutes(handler: lambda.IFunction) {
    const cognitoOpts = { authorizer: this.authorizer, authorizationType: apigateway.AuthorizationType.COGNITO };

    const contracts = this.api.root.addResource('contracts');
    contracts.addMethod('POST', new apigateway.LambdaIntegration(handler), cognitoOpts); // Crea contratto (manager)
    contracts.addMethod('GET',  new apigateway.LambdaIntegration(handler), cognitoOpts); // Lista contratti per userId (manager)

    contracts.addResource('me')
      .addMethod('GET', new apigateway.LambdaIntegration(handler), cognitoOpts);         // Miei contratti (employee)

    const contractId = contracts.addResource('{id}');
    contractId.addMethod('GET',    new apigateway.LambdaIntegration(handler), cognitoOpts); // Dettaglio contratto
    contractId.addMethod('PUT',    new apigateway.LambdaIntegration(handler), cognitoOpts); // Modifica contratto (manager)
    contractId.addMethod('DELETE', new apigateway.LambdaIntegration(handler), cognitoOpts); // Elimina contratto (manager)
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

  // Aggiunge le rotte /audit — solo manager possono visualizzare l'audit trail
  public addAuditRoutes(handler: lambda.IFunction) {
    const cognitoOpts = { authorizer: this.authorizer, authorizationType: apigateway.AuthorizationType.COGNITO };

    const audit = this.api.root.addResource('audit');
    audit.addMethod('GET', new apigateway.LambdaIntegration(handler), cognitoOpts); // Lista generica con filtri

    const actor = audit.addResource('actor');
    const actorParam = actor.addResource('{actor}');
    actorParam.addMethod('GET', new apigateway.LambdaIntegration(handler), cognitoOpts); // Filtro per attore

    const entity = audit.addResource('entity');
    const entityType = entity.addResource('{entityType}');
    const entityId = entityType.addResource('{entityId}');
    entityId.addMethod('GET', new apigateway.LambdaIntegration(handler), cognitoOpts); // Filtro per entità
  }
}
