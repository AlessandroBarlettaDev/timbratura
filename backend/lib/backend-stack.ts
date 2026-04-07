import * as cdk from 'aws-cdk-lib/core';
import { CognitoConfig } from './config/cognito';
import { ApiConfig } from './config/api';
import { DynamoDbConfig } from './config/dynamodb';
import { HostingConfig } from './config/hosting';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Hosting S3 + CloudFront — creato prima di Cognito per passare l'appUrl al template email
    const hosting = new HostingConfig(this, 'Hosting');
    const appUrl  = hosting.appUrl;

    // Cognito — riceve appUrl per costruire il link nel template email di benvenuto
    const cognito = new CognitoConfig(this, 'CognitoConfig', appUrl);

    // DynamoDB
    const dynamo = new DynamoDbConfig(this, 'DynamoDbConfig');

    // Lambda per gestione utenti
    const usersHandler = new NodejsFunction(this, 'UsersHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/users-handler.ts'),
      handler: 'handler',
      environment: {
        USER_POOL_ID:        cognito.userPool.userPoolId,
        WEBAUTHN_TABLE_NAME: dynamo.webAuthnTable.tableName,
      },
    });

    // Permessi IAM: CRUD su Cognito + lettura/scrittura su DynamoDB per cancellare i dispositivi
    cognito.userPool.grant(usersHandler,
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:ListUsers',
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:AdminDeleteUser',
    );
    dynamo.webAuthnTable.grantReadWriteData(usersHandler);


    // Lambda per la registrazione biometrica (WebAuthn custom)
    const rpId = cdk.Fn.select(2, cdk.Fn.split('/', appUrl));
    const biometricHandler = new NodejsFunction(this, 'BiometricHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/biometric-handler.ts'),
      handler: 'handler',
      environment: {
        WEBAUTHN_TABLE_NAME: dynamo.webAuthnTable.tableName,
        RP_NAME:             'Timbratura',
        RP_ID:               rpId,
        RP_ORIGIN:           appUrl,
      },
    });
    dynamo.webAuthnTable.grantReadWriteData(biometricHandler);

    const jwtSecret = process.env.JWT_SECRET ?? 'timbratura-stazioni-secret-changeme';

    // Lambda per la gestione delle stazioni di timbratura
    const stazioniHandler = new NodejsFunction(this, 'StazioniHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/stations-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        STAZIONI_TABLE_NAME:   dynamo.stazioniTable.tableName,
        TIMBRATURE_TABLE_NAME: dynamo.timbratureTable.tableName,
        JWT_SECRET: jwtSecret,
        APP_URL:    appUrl,
      },
    });
    dynamo.stazioniTable.grantReadWriteData(stazioniHandler);
    dynamo.timbratureTable.grantReadData(stazioniHandler);

    // Lambda per la registrazione delle timbrature (entrate/uscite)
    const timbratureHandler = new NodejsFunction(this, 'TimbratureHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/timbrature-handler.ts'),
      handler: 'handler',
      environment: {
        TIMBRATURE_TABLE_NAME: dynamo.timbratureTable.tableName,
        WEBAUTHN_TABLE_NAME:   dynamo.webAuthnTable.tableName,
        STAZIONI_TABLE_NAME:   dynamo.stazioniTable.tableName,
        USER_POOL_ID:          cognito.userPool.userPoolId,
        JWT_SECRET:            jwtSecret,
        RP_ID:                 rpId,
        RP_ORIGIN:             appUrl,
      },
    });
    dynamo.timbratureTable.grantReadWriteData(timbratureHandler);
    dynamo.webAuthnTable.grantReadWriteData(timbratureHandler);
    dynamo.stazioniTable.grantReadData(timbratureHandler);
    // Permesso per leggere nome/cognome del dipendente da Cognito al momento della timbratura
    cognito.userPool.grant(timbratureHandler, 'cognito-idp:AdminGetUser');

    // API Gateway
    const api = new ApiConfig(this, 'Api', { userPool: cognito.userPool, appUrl });

    api.addUsersRoutes(usersHandler);
    api.addBiometricRoutes(biometricHandler);
    api.addStazioniRoutes(stazioniHandler);
    api.addTimbratureRoutes(timbratureHandler);
  }
}
