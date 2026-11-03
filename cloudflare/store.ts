import { digest, DomainError, evidence, need, scenario, transition, type State } from '../src/domain';
import { IntakeStore } from './intake-store';

export type SqlValue = string | number | null;
export interface SqlPort {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): { toArray(): T[] };
}
export interface StoragePort {
  sql: SqlPort;
  transactionSync<T>(callback: () => T): T;
}
type Meta = { tenant: string; expires: number };
type IncidentRow = { initial: string; state: string; version: number };
export type Reply = { ok: true; data: unknown; status: number } | { ok: false; code: string; detail: string; status: number };
export type DrillSummary = { id: string; scenario: string; seed: number; status: string; version: number; clock: number; createdAt: number };
const kinds = ['facts', 'observe', 'clock', 'plan', 'approve', 'reserve', 'dispatch', 'report', 'arrival', 'cancel', 'reconcile', 'intake'];
export class WorkspaceStore {
  readonly intakes: IntakeStore;
  constructor(private storage: StoragePort) {
    this.intakes = new IntakeStore(storage);
    storage.sql.exec('CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), tenant TEXT NOT NULL, expires INTEGER NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, initial TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL, created INTEGER NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, incident TEXT NOT NULL, kind TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS leases (incident TEXT PRIMARY KEY, fence INTEGER NOT NULL, expires INTEGER NOT NULL)');
  }
  private rows<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) {
    return this.storage.sql.exec<T>(query, ...bindings).toArray();
  }
  initialize(tenant: string, now = Date.now()) {
    return this.storage.transactionSync(() => {
      need(!this.rows('SELECT id FROM meta').length, 'SESSION_ALREADY_CREATED');
      const expiry = now + 7 * 86_400_000;
      this.storage.sql.exec('INSERT INTO meta VALUES(1,?,?)', tenant, expiry);
      return expiry;
    });
  }
  private session(now = Date.now()) {
    const meta = this.rows<Meta>('SELECT tenant,expires FROM meta WHERE id=1')[0];
    need(meta, 'SESSION_REQUIRED');
    need(meta.expires > now, 'SESSION_EXPIRED', 'This seven-day review has expired. Its access key cannot be renewed.');
    return meta;
  }
  private incident(id: string) {
    const row = this.rows<IncidentRow>('SELECT initial,state,version FROM incidents WHERE id=?', id)[0];
    need(row, 'NOT_FOUND');
    return row;
  }
  private count(table: string) {
    return this.rows<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)[0].n;
  }
  request(method: string, path: string, body: Record<string, unknown> = {}): Reply {
    try {
      const data = this.storage.transactionSync(() => this.run(method, path, body));
      return { ok: true, data: JSON.parse(JSON.stringify(data)), status: method === 'POST' && path === '/incidents' ? 201 : 200 };
    } catch (error) {
      if (error instanceof DomainError) return { ok: false, code: error.code, detail: error.detail, status: ['SESSION_REQUIRED', 'SESSION_EXPIRED'].includes(error.code) ? 401 : error.code === 'NOT_FOUND' ? 404 : 409 };
      throw error;
    }
  }
  private run(method: string, path: string, body: Record<string, unknown>): unknown {
    const meta = this.session();
    const parts = path.split('/').filter(Boolean);
    if (method === 'GET' && path === '/session') return { tenant: meta.tenant, expiresAt: meta.expires, mode: 'SYNTHETIC_SIMULATOR', model: 'UNAVAILABLE' };
    if (method === 'GET' && path === '/drills') {
      return this.rows<DrillSummary>(`SELECT id, created AS createdAt, json_extract(state,'$.scenario') AS scenario, json_extract(state,'$.seed') AS seed, json_extract(state,'$.status') AS status, version, json_extract(state,'$.clock') AS clock FROM incidents ORDER BY created DESC, id DESC`);
    }
    if (method === 'GET' && path === '/incidents') return this.rows<{ state: string }>('SELECT state FROM incidents ORDER BY created').map(row => JSON.parse(row.state));
    if (method === 'POST' && path === '/incidents') {
      need(this.count('incidents') < 100, 'DRILL_QUOTA', 'This reviewer workspace is limited to 100 synthetic drills.');
      need(typeof body.scenario === 'string' && typeof body.seed === 'number' && Number.isInteger(body.seed) && body.seed >= 0 && body.seed < 100_000, 'INVALID_SCENARIO_INPUT');
      const id = crypto.randomUUID(), state = scenario(id, meta.tenant, body.scenario, body.seed);
      if (body.sourceNotes !== undefined) {
        need(typeof body.sourceNotes === 'string' && body.sourceNotes.trim().length > 0 && body.sourceNotes.length <= 4000, 'INVALID_SOURCE_NOTES');
        state.notes = body.sourceNotes;
      }
      this.storage.sql.exec('INSERT INTO incidents VALUES(?,?,?,?,?)', id, JSON.stringify(state), JSON.stringify(state), state.version, Date.now());
      return state;
    }
    if (method === 'POST' && path === '/session/close') {
      this.storage.sql.exec('UPDATE meta SET expires=0 WHERE id=1');
      return { closed: true };
    }
    const id = parts[0] === 'incidents' ? parts[1] : body.incidentId;
    need(typeof id === 'string', 'INCIDENT_REQUIRED');
    const row = this.incident(id);
    const state: State = JSON.parse(row.state);
    need(state.tenant === meta.tenant, 'SCOPE_MISMATCH');
    if (method === 'GET' && parts.length === 2 && parts[0] === 'incidents') return state;
    if (method === 'GET' && parts.length === 3 && parts[0] === 'incidents' && parts[2] === 'evidence') return this.intakes.addEvidence(evidence(JSON.parse(row.initial), state), id);
    if (method === 'GET' && parts.length === 3 && parts[0] === 'incidents' && parts[2] === 'intake') return this.intakes.list(id);
    if (method === 'POST' && parts.length === 3 && parts[0] === 'incidents' && parts[2] === 'actions') {
      need(typeof body.kind === 'string' && kinds.includes(body.kind), 'UNKNOWN_ACTION');
      need(this.count('tokens') < 15_000, 'ACTION_QUOTA');
      const actionId = crypto.randomUUID();
      this.storage.sql.exec('INSERT INTO tokens VALUES(?,?,?)', actionId, id, body.kind);
      return { actionId };
    }
    need(method === 'POST', 'ROUTE_NOT_FOUND');
    const route = parts.at(-1)!;
    const planRoutes: Record<string, string> = { approve: 'approve', reserve: 'reserve' };
    const workRoutes: Record<string, string> = { dispatch: 'dispatch', 'arrival-report': 'report', arrival: 'arrival', cancel: 'cancel' };
    const incidentRoutes: Record<string, string> = { facts: 'facts', observations: 'observe', clock: 'clock', plans: 'plan', reconcile: 'reconcile' };
    const kind = parts[0] === 'plans' && parts.length === 3 ? planRoutes[route] : parts[0] === 'work-orders' && parts.length === 3 ? workRoutes[route] : parts[0] === 'incidents' && parts.length === 3 ? incidentRoutes[route] : undefined;
    need(kind, 'ROUTE_NOT_FOUND');
    need(typeof body.actionId === 'string' && typeof body.expectedVersion === 'number' && Number.isInteger(body.expectedVersion), 'ACTION_AND_VERSION_REQUIRED');
    need(body.payload !== null && typeof body.payload === 'object' && !Array.isArray(body.payload), 'INVALID_PAYLOAD');
    const payload: Record<string, unknown> = { ...body.payload, ...(parts[0] === 'plans' ? { planId: parts[1] } : {}), ...(parts[0] === 'work-orders' ? { workId: parts[1] } : {}) };
    need(kind !== 'arrival' || !('authority' in payload), 'SIMULATOR_AUTHORITY_REQUIRED', 'Arrival authority is assigned only by the server-side simulator.');
    const token = this.rows<{ incident: string; kind: string }>('SELECT incident,kind FROM tokens WHERE id=?', body.actionId)[0];
    need(token?.incident === id && token.kind === kind, 'INVALID_ACTION_ID');
    const hash = digest({ id, kind, p: payload });
    const previous = this.rows<{ hash: string; result: string }>('SELECT hash,result FROM receipts WHERE id=?', body.actionId)[0];
    if (previous) {
      need(previous.hash === hash, 'ACTION_PAYLOAD_CONFLICT');
      return JSON.parse(previous.result);
    }
    need(row.version === body.expectedVersion, 'VERSION_CONFLICT');
    need(state.events.length < 500, 'EVENT_QUOTA');
    let workerFence: number | undefined;
    if (kind === 'arrival') {
      const lease = this.rows<{ fence: number }>('SELECT fence FROM leases WHERE incident=?', id)[0];
      workerFence = (lease?.fence || 0) + 1;
      this.storage.sql.exec('INSERT INTO leases VALUES(?,?,?) ON CONFLICT(incident) DO UPDATE SET fence=excluded.fence,expires=excluded.expires', id, workerFence, Date.now() + 10_000);
    }
    if (kind === 'facts') this.intakes.bindHumanReview(state, payload, body.actionId);
    const result = transition(state, kind, kind === 'arrival' ? { ...payload, authority: 'simulator' } : payload, body.actionId);
    const receipt = { actionId: body.actionId, kind, result, version: state.version, ...(workerFence === undefined ? {} : { workerFence }), capturedAt: new Date().toISOString(), mode: 'CLOUDFLARE_SYNTHETIC_SIMULATOR' };
    this.storage.sql.exec('UPDATE incidents SET state=?,version=? WHERE id=?', JSON.stringify(state), state.version, id);
    this.storage.sql.exec('INSERT INTO receipts VALUES(?,?,?)', body.actionId, hash, JSON.stringify(receipt));
    return receipt;
  }
  expire(now = Date.now()) {
    this.storage.transactionSync(() => {
      const meta = this.rows<{ expires: number }>('SELECT expires FROM meta WHERE id=1')[0];
      if (meta && meta.expires <= now) {
        for (const table of ['incidents', 'tokens', 'receipts', 'leases', 'interpretations']) this.storage.sql.exec(`DELETE FROM ${table}`);
        this.storage.sql.exec('UPDATE meta SET expires=0 WHERE id=1');
      }
    });
  }
}
