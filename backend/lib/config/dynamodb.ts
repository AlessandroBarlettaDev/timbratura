import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

export class DynamoDbConfig extends Construct {
  // Tabella che memorizza le credenziali biometriche (WebAuthn) degli utenti
  public readonly webAuthnTable: dynamodb.Table;

  // Tabella che memorizza le stazioni di timbratura
  public readonly stazioniTable: dynamodb.Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.webAuthnTable = new dynamodb.Table(this, 'WebAuthnCredentials', {
      tableName: 'WebAuthnCredentials',

      // credentialId è la chiave primaria — usata per cercare la credenziale
      // durante la verifica della timbratura (lookup O(1))
      partitionKey: { name: 'credentialId', type: dynamodb.AttributeType.STRING },

      // Elimina la tabella quando lo stack viene distrutto (comodo in sviluppo)
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Indice secondario su userId — per trovare le credenziali di un utente
    // (es. durante il setup: "l'utente ha già registrato un dispositivo?")
    this.webAuthnTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'WebAuthnTableName', {
      value: this.webAuthnTable.tableName,
    });

    this.stazioniTable = new dynamodb.Table(this, 'Stazioni', {
      tableName: 'Stazioni',

      // stationId è la chiave primaria — UUID generato alla creazione
      partitionKey: { name: 'stationId', type: dynamodb.AttributeType.STRING },

      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Indice su codice — per trovare la stazione durante il login (lookup per codice stazione)
    this.stazioniTable.addGlobalSecondaryIndex({
      indexName: 'codice-index',
      partitionKey: { name: 'codice', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'StazioniTableName', {
      value: this.stazioniTable.tableName,
    });
  }
}