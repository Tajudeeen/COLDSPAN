import { canonical, digest, need, type State, type evidence } from '../src/domain';
import { INTAKE_PROMPT_VERSION, sourceFor, validateIntake, type Review } from '../src/intake';
import type { ProviderResult } from './meta';
import type { SqlValue, StoragePort } from './store';
export type IntakeRecord = {
  actionId: string; version: number; incidentId: string; mode: 'FIXTURE_REPLAY' | 'META';
  source: ReturnType<typeof sourceFor>; promptVersion: string; createdAt: string;
  status: 'PENDING' | 'NEEDS_REVIEW' | 'UNAVAILABLE' | 'FAILED' | 'UNKNOWN_OUTCOME';
  reason: string; provider: ProviderResult | null; review: Review | null;
  humanReview?: { actionId: string; quantities: Record<string, number>; version: number };
};
export class IntakeStore {
  constructor(private storage: StoragePort) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS interpretations (id TEXT PRIMARY KEY, incident TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL)');
  }
  private rows<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) { return this.storage.sql.exec<T>(query, ...bindings).toArray(); }
  list(id: string): IntakeRecord[] { return this.rows<{ result: string }>('SELECT result FROM interpretations WHERE incident=? ORDER BY rowid', id).map(row => JSON.parse(row.result)); }
  begin(state: State, body: Record<string, unknown>): { fresh: boolean; record: IntakeRecord } {
    return this.storage.transactionSync(() => {
      need(body.incidentId === state.id && typeof body.actionId === 'string' && typeof body.expectedVersion === 'number' && Number.isInteger(body.expectedVersion), 'ACTION_AND_VERSION_REQUIRED');
      const payload = body.payload;
      need(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).join(',') === 'mode', 'INVALID_INTAKE_INPUT');
      const mode = (payload as Record<string, unknown>).mode;
      need(mode === 'fixture' || mode === 'meta', 'INVALID_INTAKE_MODE');
      const token = this.rows<{ incident: string; kind: string }>('SELECT incident,kind FROM tokens WHERE id=?', body.actionId)[0];
      need(token?.incident === state.id && token.kind === 'intake', 'INVALID_ACTION_ID');
      const hash = digest({ incidentId: state.id, source: sourceFor(state), mode });
      const old = this.rows<{ hash: string; result: string }>('SELECT hash,result FROM interpretations WHERE id=?', body.actionId)[0];
      if (old) {
        need(old.hash === hash, 'ACTION_PAYLOAD_CONFLICT');
        const record: IntakeRecord = JSON.parse(old.result);
        if (record.status === 'PENDING' && Date.now() - Date.parse(record.createdAt) > 120_000) {
          record.status = 'UNKNOWN_OUTCOME'; record.reason = 'INTAKE_OUTCOME_UNKNOWN_NO_AUTOMATIC_RETRY';
          this.write(record);
        }
        return { fresh: false, record };
      }
      need(state.uncertain && state.status !== 'RECONCILED', 'INTAKE_REVIEW_CLOSED');
      need(state.version === body.expectedVersion, 'VERSION_CONFLICT');
      need(this.rows<{ n: number }>('SELECT count(*) AS n FROM interpretations WHERE incident=?', state.id)[0].n < 10, 'INTAKE_QUOTA');
      const record: IntakeRecord = { actionId: body.actionId, version: state.version, incidentId: state.id, mode: mode === 'fixture' ? 'FIXTURE_REPLAY' : 'META', source: sourceFor(state), promptVersion: INTAKE_PROMPT_VERSION, createdAt: new Date().toISOString(), status: 'PENDING', reason: 'INTAKE_IN_PROGRESS', provider: null, review: null };
      this.storage.sql.exec('INSERT INTO interpretations VALUES(?,?,?,?)', record.actionId, state.id, hash, JSON.stringify(record));
      return { fresh: true, record };
    });
  }
  complete(actionId: string, state: State, provider: ProviderResult): IntakeRecord {
    return this.storage.transactionSync(() => {
      const row = this.rows<{ result: string }>('SELECT result FROM interpretations WHERE id=?', actionId)[0];
      need(row, 'INTAKE_NOT_FOUND');
      const record: IntakeRecord = JSON.parse(row.result);
      if (record.status !== 'PENDING') return record;
      record.provider = provider;
      record.status = provider.status === 'COMPLETED' ? 'NEEDS_REVIEW' : provider.status;
      record.reason = provider.reason;
      if (provider.status === 'COMPLETED') {
        record.review = validateIntake(provider.raw, state);
        record.reason = record.review.reason;
        if (record.version !== state.version) {
          record.review.canApply = false; record.review.issues.push('INCIDENT_CHANGED_DURING_INTERPRETATION'); record.reason = 'INCIDENT_CHANGED_DURING_INTERPRETATION';
        }
      }
      this.write(record);
      return record;
    });
  }
  // Called only inside the same transaction as facts confirmation and its receipt.
  bindHumanReview(state: State, payload: Record<string, unknown>, actionId: string) {
    if (payload.intakeId === undefined) return;
    need(typeof payload.intakeId === 'string', 'INVALID_INTAKE_REFERENCE');
    const row = this.rows<{ result: string }>('SELECT result FROM interpretations WHERE id=? AND incident=?', payload.intakeId, state.id)[0];
    need(row, 'INTAKE_NOT_FOUND');
    const record: IntakeRecord = JSON.parse(row.result);
    need(record.status === 'NEEDS_REVIEW' && record.review?.canApply && record.review.candidate && record.version === state.version && payload.intakeDigest === digest(record.review.candidate), 'INTAKE_REVIEW_MISMATCH');
    const quantities = payload.quantities as Record<string, number>;
    need(quantities && state.batches.every(batch => record.review!.candidate!.facts.some(fact => fact.batchId === batch.id && fact.quantity === quantities[batch.id])), 'INTAKE_QUANTITY_MISMATCH');
    record.humanReview = { actionId, quantities, version: state.version };
    this.write(record);
  }
  private write(record: IntakeRecord) { this.storage.sql.exec('UPDATE interpretations SET result=? WHERE id=?', JSON.stringify(record), record.actionId); }
  addEvidence(bundle: ReturnType<typeof evidence>, incidentId: string) {
    const records = this.list(incidentId);
    if (records.length) {
      bundle.manifest.schema = 2;
      bundle.artifacts['interpretations.json'] = canonical(records);
      bundle.manifest.files['interpretations.json'] = digest(bundle.artifacts['interpretations.json']);
    }
    return bundle;
  }
}
