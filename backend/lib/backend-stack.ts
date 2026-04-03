import * as cdk from 'aws-cdk-lib/core';
import { CognitoConfig } from './config/cognito';
import { ApiConfig } from './config/api';
import { DynamoDbConfig } from './config/dynamodb';
import { HostingConfig } from './config/hosting';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { UserPoolOperation } from 'aws-cdk-lib/aws-cognito';
import * as path from 'path';

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito
    const cognito = new CognitoConfig(this, 'CognitoConfig');

    // DynamoDB
    const dynamo = new DynamoDbConfig(this, 'DynamoDbConfig');

    // Hosting S3 + CloudFront — deve essere creato prima dei Lambda
    // perché l'URL CloudFront viene passato come variabile d'ambiente
    const hosting = new HostingConfig(this, 'Hosting');
    const appUrl  = hosting.appUrl;
    // RP_ID è solo il dominio senza schema (es. "abc.cloudfront.net")
    const rpId    = cdk.Fn.select(2, cdk.Fn.split('/', appUrl));

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

    // Lambda trigger — personalizza l'email di benvenuto inviata da Cognito
    const customMessageHandler = new NodejsFunction(this, 'CustomMessageHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/custom-message.ts'),
      handler: 'handler',
    });
    cognito.userPool.addTrigger(UserPoolOperation.CUSTOM_MESSAGE, customMessageHandler);

    // Lambda per la registrazione biometrica (WebAuthn)
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

    // Lambda per la gestione delle stazioni di timbratura
    const stazioniHandler = new NodejsFunction(this, 'StazioniHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/stations-handler.ts'),
      handler: 'handler',
      environment: {
        STAZIONI_TABLE_NAME: dynamo.stazioniTable.tableName,
        // Chiave segreta per firmare i JWT delle stazioni e i token QR
        // In produzione usare AWS Secrets Manager
        JWT_SECRET: 'timbratura-stazioni-secret-changeme',
        APP_URL:    appUrl,
      },
    });
    dynamo.stazioniTable.grantReadWriteData(stazioniHandler);

    // Lambda per la registrazione delle timbrature (entrate/uscite)
    const timbratureHandler = new NodejsFunction(this, 'TimbratureHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/timbrature-handler.ts'),
      handler: 'handler',
      environment: {
        TIMBRATURE_TABLE_NAME: dynamo.timbratureTable.tableName,
        WEBAUTHN_TABLE_NAME:   dynamo.webAuthnTable.tableName,
        JWT_SECRET:            'timbratura-stazioni-secret-changeme',
        RP_ID:                 rpId,
        RP_ORIGIN:             appUrl,
      },
    });
    dynamo.timbratureTable.grantReadWriteData(timbratureHandler);
    dynamo.webAuthnTable.grantReadWriteData(timbratureHandler);

    // API Gateway
    const api = new ApiConfig(this, 'Api', { userPool: cognito.userPool });

    api.addUsersRoutes(usersHandler);
    api.addBiometricRoutes(biometricHandler);
    api.addStazioniRoutes(stazioniHandler);
    api.addTimbratureRoutes(timbratureHandler);
  }
}
