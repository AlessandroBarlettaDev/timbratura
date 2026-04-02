import * as cdk from 'aws-cdk-lib/core';
import { CognitoConfig } from './config/cognito';
import { ApiConfig } from './config/api';
import { DynamoDbConfig } from './config/dynamodb';
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

    // Lambda per gestione utenti
    // NodejsFunction compila e bundla automaticamente il TypeScript con esbuild
    const usersHandler = new NodejsFunction(this, 'UsersHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambda/users-handler.ts'),
      handler: 'handler',
      environment: {
        USER_POOL_ID:       cognito.userPool.userPoolId,
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
      entry: path.join(__dirname, 'lambda/custom-message.ts'),
      handler: 'handler',
    });
    cognito.userPool.addTrigger(UserPoolOperation.CUSTOM_MESSAGE, customMessageHandler);

    // Lambda per la registrazione biometrica (WebAuthn)
    const biometricHandler = new NodejsFunction(this, 'BiometricHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambda/biometric-handler.ts'),
      handler: 'handler',
      environment: {
        WEBAUTHN_TABLE_NAME: dynamo.webAuthnTable.tableName,
        // In produzione impostare il dominio reale
        RP_ID:     'localhost',
        RP_NAME:   'Timbratura',
        RP_ORIGIN: 'http://localhost:4200',
      },
    });

    // Permessi IAM: lettura e scrittura sulla tabella DynamoDB
    dynamo.webAuthnTable.grantReadWriteData(biometricHandler);

    // Lambda per la gestione delle stazioni di timbratura
    const stazioniHandler = new NodejsFunction(this, 'StazioniHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambda/stations-handler.ts'),
      handler: 'handler',
      environment: {
        STAZIONI_TABLE_NAME: dynamo.stazioniTable.tableName,
        // Chiave segreta per firmare i JWT delle stazioni e i token QR
        // In produzione usare AWS Secrets Manager
        JWT_SECRET: 'timbratura-stazioni-secret-changeme',
        APP_URL:    'http://localhost:4200',
      },
    });

    // Permessi IAM: lettura e scrittura sulla tabella Stazioni
    dynamo.stazioniTable.grantReadWriteData(stazioniHandler);

    // API Gateway
    const api = new ApiConfig(this, 'Api', { userPool: cognito.userPool });

    // Rotte /users (manager via Cognito)
    api.addUsersRoutes(usersHandler);

    // Rotte /biometric (dipendenti via Cognito)
    api.addBiometricRoutes(biometricHandler);

    // Rotte /stazioni: CRUD manager via Cognito, login/qr/position stazione via JWT custom
    api.addStazioniRoutes(stazioniHandler);
  }
}
