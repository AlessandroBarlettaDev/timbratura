import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

// Configurazione di Cognito per la gestione degli utenti e dei gruppi
export class CognitoConfig extends Construct {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolClient: cognito.UserPoolClient;
    public readonly managerGroup: cognito.CfnUserPoolGroup;
    public readonly employeeGroup: cognito.CfnUserPoolGroup;

    constructor(scope: Construct, id: string, appUrl?: string) {
        super(scope, id);

        const loginUrl = appUrl ? `${appUrl}/login` : '/login';

        // Crea User Pool con attributi personalizzati
        this.userPool = new cognito.UserPool(this, 'UserPool', {
            userPoolName: 'TimbraturaUserPool',
            selfSignUpEnabled: false,
            signInAliases: { email: true },
            autoVerify: { email: true },
            email: cognito.UserPoolEmail.withCognito(),
            userInvitation: {
                emailSubject: 'Benvenuto! Completa la registrazione al portale Timbratura',
                emailBody: `
                    <p>Ciao,</p>
                    <p>il tuo account sul portale <strong>Timbratura</strong> è stato creato.</p>
                    <p>Accedi con le seguenti credenziali:</p>
                    <p>
                        <strong>Email:</strong> {username}<br>
                        <strong>Password temporanea:</strong> {####}
                    </p>
                    <p>Clicca sul seguente link per accedere:<br>
                    <a href="${loginUrl}">${loginUrl}</a></p>
                    <p>Al primo accesso ti verrà chiesto di impostare una nuova password
                    e registrare il tuo dispositivo biometrico.</p>
                    <p>Se non hai richiesto la registrazione, ignora questa email.</p>
                    <p>Grazie,<br>Il team di Timbratura</p>
                `,
            },
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
                userSrp: true,
                user: true,  // abilita USER_AUTH flow per i passkey nativi Cognito
            },
        });

        // Configura WebAuthn — relyingPartyId = dominio CloudFront (senza schema)
        // Usa l'escape hatch CDK perché webAuthnRelyingPartyId non è ancora nel L2
        if (appUrl) {
            const cfnPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
            cfnPool.webAuthnRelyingPartyId   = cdk.Fn.select(2, cdk.Fn.split('/', appUrl));
            cfnPool.webAuthnUserVerification = 'required';
        }

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
