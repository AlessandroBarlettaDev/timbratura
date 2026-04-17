import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

export class DynamoDbConfig extends Construct {
  // Tabella che memorizza le credenziali biometriche (WebAuthn) degli utenti
  public readonly webAuthnTable: dynamodb.Table;

  // Tabella che memorizza le stazioni di timbratura
  public readonly stazioniTable: dynamodb.Table;

  // Tabella che memorizza le timbrature (entrate/uscite) dei dipendenti
  public readonly timbratureTable: dynamodb.Table;

  // Tabella che memorizza le richieste di timbratura manuale
  public readonly requestsTable: dynamodb.Table;

  // Tabella che memorizza i contratti di lavoro dei dipendenti
  public readonly contractsTable: dynamodb.Table;

  // Tabella che memorizza l'audit trail delle operazioni sensibili
  public readonly auditLogTable: dynamodb.Table;

  constructor(scope: Construct, id: string, suffix: string = '') {
    super(scope, id);

    // Creazione della tabella per le credenziali WebAuthn
    this.webAuthnTable = new dynamodb.Table(this, 'WebAuthnCredentials', {
      tableName:    `WebAuthnCredentials${suffix}`,
      partitionKey: { name: 'credentialId', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.webAuthnTable.addGlobalSecondaryIndex({
      indexName:    'userId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });
    new cdk.CfnOutput(this, 'WebAuthnTableName', { value: this.webAuthnTable.tableName });

    // Creazione della tabella per le stazioni di timbratura
    this.stazioniTable = new dynamodb.Table(this, 'Stazioni', {
      tableName: `Stazioni${suffix}`,

      // stationId è la chiave primaria — UUID generato alla creazione
      partitionKey: { name: 'stationId', type: dynamodb.AttributeType.STRING },

      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
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

    this.timbratureTable = new dynamodb.Table(this, 'Timbrature', {
      tableName: `Timbrature${suffix}`,

      // PK: userId — tutte le timbrature di un dipendente sono raggruppate insieme
      // SK: timestamp ISO — permette query per intervallo di date con begins_with
      partitionKey: { name: 'userId',    type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'timestamp', type: dynamodb.AttributeType.STRING },

      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI su data (YYYY-MM-DD) — il manager usa questo indice per leggere tutte
    // le timbrature di un giorno specifico, indipendentemente dall'utente
    this.timbratureTable.addGlobalSecondaryIndex({
      indexName:    'data-index',
      partitionKey: { name: 'data',      type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'TimbratureTableName', {
      value: this.timbratureTable.tableName,
    });

    this.requestsTable = new dynamodb.Table(this, 'Requests', {
      tableName:    `Requests${suffix}`,
      partitionKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI su userId — il dipendente recupera le proprie richieste
    this.requestsTable.addGlobalSecondaryIndex({
      indexName:    'userId-index',
      partitionKey: { name: 'userId',    type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI su stato — il manager recupera tutte le richieste pendenti
    this.requestsTable.addGlobalSecondaryIndex({
      indexName:    'stato-index',
      partitionKey: { name: 'stato',     type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'RequestsTableName', { value: this.requestsTable.tableName });

    this.contractsTable = new dynamodb.Table(this, 'Contracts', {
      tableName:    `Contracts${suffix}`,
      partitionKey: { name: 'contractId', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI su userId — recupera tutti i contratti di un dipendente ordinati per data di inizio
    this.contractsTable.addGlobalSecondaryIndex({
      indexName:    'userId-index',
      partitionKey: { name: 'userId',     type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'dataInizio', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'ContractsTableName', { value: this.contractsTable.tableName });

    // Audit log: PK time-sortable (ISO#hex), TTL 5 anni, due GSI per query per attore o per entità
    this.auditLogTable = new dynamodb.Table(this, 'AuditLog', {
      tableName:    `AuditLog${suffix}`,
      partitionKey: { name: 'auditId', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expiresAt',
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI su actor — recupera tutte le azioni eseguite da un utente specifico
    this.auditLogTable.addGlobalSecondaryIndex({
      indexName:    'actor-index',
      partitionKey: { name: 'actor',   type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'auditId', type: dynamodb.AttributeType.STRING },
    });

    // GSI su entity — recupera tutta la storia di una specifica entità (es. tutti gli eventi su user X)
    this.auditLogTable.addGlobalSecondaryIndex({
      indexName:    'entity-index',
      partitionKey: { name: 'entityType', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'auditId',    type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'AuditLogTableName', { value: this.auditLogTable.tableName });
  }
}