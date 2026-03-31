import * as cdk from 'aws-cdk-lib/core';
import { CognitoConfig } from './config/cognito';
import { ApiConfig } from './config/api';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
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

    // Permessi IAM: la Lambda può creare utenti e assegnarli a gruppi su Cognito
    cognito.userPool.grant(usersHandler, 'cognito-idp:AdminCreateUser', 'cognito-idp:AdminAddUserToGroup');

    // API Gateway
    const api = new ApiConfig(this, 'Api', { userPool: cognito.userPool });

    // Rotte protette /users
    api.addUsersRoutes(usersHandler);
  }
}
