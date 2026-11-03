import { DatabaseSync } from 'node:sqlite';
import type { SqlPort, SqlValue, StoragePort } from '../cloudflare/store';
export function sqliteStorage(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  let failReceipt = false;
  const sql: SqlPort = {
    exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) {
      if (failReceipt && query.startsWith('INSERT INTO receipts')) throw new Error('INJECTED_RECEIPT_FAILURE');
      const rows = db.prepare(query).all(...bindings);
      return { toArray: () => rows as T[] };
    },
  };
  const storage: StoragePort = {
    sql,
    transactionSync<T>(callback: () => T) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = callback(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, storage, failReceipt: (enabled: boolean) => { failReceipt = enabled; } };
}
