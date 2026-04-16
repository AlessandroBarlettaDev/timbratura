import * as cdk from 'aws-cdk-lib/core';
import { CognitoConfig } from './config/cognito';
import { ApiConfig } from './config/api';
import { DynamoDbConfig } from './config/dynamodb';
import { HostingConfig } from './config/hosting';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

export interface BackendStackProps extends cdk.StackProps {
  deployEnv?: string;
}

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: BackendStackProps) {
    super(scope, id, props);

    const suffix = props?.deployEnv ? `-${props.deployEnv}` : '';

    // Hosting S3 + CloudFront — creato prima di Cognito per passare l'appUrl al template email
    const hosting = new HostingConfig(this, 'Hosting');
    const appUrl  = hosting.appUrl;

    // Cognito — riceve appUrl per costruire il link nel template email di benvenuto
    const cognito = new CognitoConfig(this, 'CognitoConfig', appUrl, suffix);

    // DynamoDB
    const dynamo = new DynamoDbConfig(this, 'DynamoDbConfig', suffix);

    // Lambda per gestione utenti
    const usersHandler = new NodejsFunction(this, 'UsersHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/users-handler.ts'),
      handler: 'handler',
      environment: {
        USER_POOL_ID:        cognito.userPool.userPoolId,
        WEBAUTHN_TABLE_NAME: dynamo.webAuthnTable.tableName,
        AUDIT_TABLE_NAME:    dynamo.auditLogTable.tableName,
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
    dynamo.auditLogTable.grantWriteData(usersHandler);


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

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET env var è obbligatoria per il deploy');

    // Lambda per la gestione delle stazioni di timbratura
    const stazioniHandler = new NodejsFunction(this, 'StazioniHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/stations-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        STAZIONI_TABLE_NAME:   dynamo.stazioniTable.tableName,
        TIMBRATURE_TABLE_NAME: dynamo.timbratureTable.tableName,
        AUDIT_TABLE_NAME:      dynamo.auditLogTable.tableName,
        JWT_SECRET: jwtSecret,
        APP_URL:    appUrl,
      },
    });
    dynamo.stazioniTable.grantReadWriteData(stazioniHandler);
    dynamo.timbratureTable.grantReadData(stazioniHandler);
    dynamo.auditLogTable.grantWriteData(stazioniHandler);

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

    // Lambda per la gestione dei contratti di lavoro
    const contractsHandler = new NodejsFunction(this, 'ContractsHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/contracts-handler.ts'),
      handler: 'handler',
      environment: {
        CONTRACTS_TABLE_NAME: dynamo.contractsTable.tableName,
        USER_POOL_ID:         cognito.userPool.userPoolId,
        AUDIT_TABLE_NAME:     dynamo.auditLogTable.tableName,
      },
    });
    dynamo.contractsTable.grantReadWriteData(contractsHandler);
    dynamo.auditLogTable.grantWriteData(contractsHandler);
    cognito.userPool.grant(contractsHandler, 'cognito-idp:AdminGetUser');

    // Lambda per le richieste di timbratura manuale
    const requestsHandler = new NodejsFunction(this, 'RequestsHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/requests-handler.ts'),
      handler: 'handler',
      environment: {
        REQUESTS_TABLE_NAME:   dynamo.requestsTable.tableName,
        TIMBRATURE_TABLE_NAME: dynamo.timbratureTable.tableName,
        USER_POOL_ID:          cognito.userPool.userPoolId,
        AUDIT_TABLE_NAME:      dynamo.auditLogTable.tableName,
      },
    });
    dynamo.requestsTable.grantReadWriteData(requestsHandler);
    dynamo.timbratureTable.grantReadWriteData(requestsHandler);
    dynamo.auditLogTable.grantWriteData(requestsHandler);
    cognito.userPool.grant(requestsHandler, 'cognito-idp:AdminGetUser');

    // Lambda per la consultazione dell'audit trail
    const auditHandler = new NodejsFunction(this, 'AuditHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry:   path.join(__dirname, 'lambda/audit-handler.ts'),
      handler: 'handler',
      environment: {
        AUDIT_TABLE_NAME: dynamo.auditLogTable.tableName,
      },
    });
    dynamo.auditLogTable.grantReadData(auditHandler);

    // API Gateway
    const api = new ApiConfig(this, 'Api', { userPool: cognito.userPool, appUrl });

    api.addUsersRoutes(usersHandler);
    api.addBiometricRoutes(biometricHandler);
    api.addStazioniRoutes(stazioniHandler);
    api.addTimbratureRoutes(timbratureHandler);
    api.addRequestsRoutes(requestsHandler);
    api.addContractsRoutes(contractsHandler);
    api.addAuditRoutes(auditHandler);
  }
}
