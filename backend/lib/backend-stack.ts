import * as cdk from 'aws-cdk-lib/core';
import { CognitoConfig } from './config/cognito';
import { ApiConfig } from './config/api';
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

    // Lambda per gestione utenti
    // NodejsFunction compila e bundla automaticamente il TypeScript con esbuild
    const usersHandler = new NodejsFunction(this, 'UsersHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambda/users-handler.ts'),
      handler: 'handler',
      environment: {
        USER_POOL_ID: cognito.userPool.userPoolId,
      },
    });

    // Permessi IAM: tutte le operazioni CRUD sugli utenti Cognito
    cognito.userPool.grant(usersHandler,
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:ListUsers',
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:AdminDeleteUser',
    );

    // Lambda trigger — personalizza l'email di benvenuto inviata da Cognito
    const customMessageHandler = new NodejsFunction(this, 'CustomMessageHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambda/custom-message.ts'),
      handler: 'handler',
    });
    cognito.userPool.addTrigger(UserPoolOperation.CUSTOM_MESSAGE, customMessageHandler);

    // API Gateway
    const api = new ApiConfig(this, 'Api', { userPool: cognito.userPool });

    // Rotte protette /users
    api.addUsersRoutes(usersHandler);
  }
}
