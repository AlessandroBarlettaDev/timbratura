import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';



export class CognitoConfig extends Construct {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolClient: cognito.UserPoolClient;
    public readonly managerGroup: cognito.CfnUserPoolGroup;
    public readonly employeeGroup: cognito.CfnUserPoolGroup;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        this.userPool = new cognito.UserPool(this, 'UserPool', {
            userPoolName: 'TimbraturaUserPool',
            selfSignUpEnabled: false,
            signInAliases: { email: true },
            autoVerify: { email: true },
            email: cognito.UserPoolEmail.withCognito(),
            standardAttributes: {
                email: { required: true, mutable: false },
                givenName: { required: true, mutable: true },
                familyName: { required: true, mutable: true },
                birthdate: { required: false, mutable: true }
            },
            customAttributes: {
                codice_fiscale: new cognito.StringAttribute({ mutable: true }),
                role: new cognito.StringAttribute({ mutable: true }),
                data_assunzione: new cognito.StringAttribute({ mutable: true }),
                termine_contratto: new cognito.StringAttribute({ mutable: true }),
                password_changed: new cognito.StringAttribute({ mutable: true }),
                biometrics_reg: new cognito.StringAttribute({ mutable: true }),
            }
        });

        this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
            userPool: this.userPool,
            authFlows: {
                adminUserPassword: true,
                custom: true,
                userPassword: true,
                userSrp: true
            }
        });

        // Crea gruppi
        this.managerGroup = new cognito.CfnUserPoolGroup(this, 'ManagerGroup', {
            groupName: 'manager',
            userPoolId: this.userPool.userPoolId,
            description: 'Manager users'
        });
        this.employeeGroup = new cognito.CfnUserPoolGroup(this, 'EmployeeGroup', {
            groupName: 'employee',
            userPoolId: this.userPool.userPoolId,
            description: 'Employee users'
        });

        new cdk.CfnOutput(this, 'UserPoolId', {
            value: this.userPool.userPoolId
        });
        new cdk.CfnOutput(this, 'ClientId', {
            value: this.userPoolClient.userPoolClientId
        });
    }
}
