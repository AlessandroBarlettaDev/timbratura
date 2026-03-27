import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { createCognito } from './auth/cognito';
import { createApi } from './api/timbrature-api';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Creazione di Cognito User Pool e Client
    const { userPool } = createCognito(this);

    // Creazione dell'API Gateway con integrazione Lambda e autorizzazione Cognito
    createApi(this, userPool);
  }
}