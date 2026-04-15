import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'crypto';

const dynamo = new DynamoDBClient({});

export type AuditAction =
  | 'USER_CREATE' | 'USER_UPDATE' | 'USER_DELETE'
  | 'REQUEST_APPROVE' | 'REQUEST_REJECT'
  | 'CONTRACT_CREATE' | 'CONTRACT_UPDATE' | 'CONTRACT_DELETE'
  | 'STATION_CREATE' | 'STATION_DELETE'
  | 'BIOMETRIC_REGISTER' | 'PASSWORD_CHANGE';

export interface AuditEntry {
  actor:      string;                                           // userId di chi esegue, o 'system'
  actorRole:  'manager' | 'employee' | 'system';
  action:     AuditAction;
  entityType: 'user' | 'request' | 'contract' | 'station';
  entityId:   string;
  details?:   Record<string, any>;                             // dati extra liberi (es. ruolo assegnato, tipo contratto)
}

// Scrive un record di audit in DynamoDB — best-effort: non blocca l'operazione principale in caso di errore.
// auditId è time-sortable (ISO timestamp + hex random) per permettere query per range senza GSI aggiuntivo.
// TTL di 5 anni per conformità art. 3 L. 689/81 (registri presenze).
export async function writeAudit(tableName: string, entry: AuditEntry): Promise<void> {
  const timestamp = new Date().toISOString();
  const auditId   = `${timestamp}#${crypto.randomBytes(4).toString('hex')}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 3600;

  try {
    await dynamo.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall({
        auditId,
        timestamp,
        actor:      entry.actor,
        actorRole:  entry.actorRole,
        action:     entry.action,
        entityType: entry.entityType,
        entityId:   entry.entityId,
        ...(entry.details ? { details: JSON.stringify(entry.details) } : {}),
        expiresAt,
      }, { removeUndefinedValues: true }),
    }));
  } catch (err) {
    console.error('[audit] write failed:', err);
  }
}
