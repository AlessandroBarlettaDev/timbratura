import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

// Configurazione di Cognito per la gestione degli utenti e dei gruppi
export class CognitoConfig extends Construct {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolClient: cognito.UserPoolClient;
    public readonly managerGroup: cognito.CfnUserPoolGroup;
    public readonly employeeGroup: cognito.CfnUserPoolGroup;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        // Crea User Pool con attributi personalizzati
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

        // Crea User Pool Client con flussi di autenticazione abilitati per password e SRP (SRP = Server Side Password Verification) (necessario per l'autenticazione lato frontend)
        this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
            userPool: this.userPool,
            authFlows: {
                adminUserPassword: true,
                custom: true,
                userPassword: true,
                userSrp: true
            }
        });

        // Crea gruppi per manager e dipendenti
        this.managerGroup = new cognito.CfnUserPoolGroup(this, 'ManagerGroup', {
            groupName: 'manager',
            userPoolId: this.userPool.userPoolId,
            description: 'Manager users'
        });
        // Il gruppo "employee" è stato creato per i dipendenti, ma al momento non viene utilizzato direttamente nel codice. 
        // Le verifiche dei ruoli e dei permessi vengono gestite principalmente tramite l'attributo personalizzato "role" degli utenti. 
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
