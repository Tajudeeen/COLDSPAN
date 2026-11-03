import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, type Reply, type StoragePort } from '../cloudflare/store';
import { scenario, type State } from '../src/domain';
import { sqliteStorage } from './sqlite';

const value = (reply: Reply): any => { assert.equal(reply.ok, true, JSON.stringify(reply)); return reply.ok ? reply.data : null; };
function fixture(kind = 'outage', filename = ':memory:') {
  const db = sqliteStorage(filename);
  const store = new WorkspaceStore(db.storage);
  store.initialize('test-tenant');
  const initial = scenario('incident', 'test-tenant', kind, 7);
  db.storage.sql.exec('INSERT INTO incidents VALUES(?,?,?,?,?)', initial.id, JSON.stringify(initial), JSON.stringify(initial), initial.version, 1);
  const get = (): State => value(store.request('GET', '/incidents/incident'));
  const prepare = (kind: string, route: string, payload: unknown = {}) => ({ route, body: { actionId: value(store.request('POST', '/incidents/incident/actions', { kind })).actionId, expectedVersion: get().version, incidentId: 'incident', payload } });
  const act = (kind: string, route: string, payload: unknown = {}) => { const request = prepare(kind, route, payload); return { ...request, receipt: value(store.request('POST', request.route, request.body)) }; };
  const ready = () => {
    act('facts', '/incidents/incident/facts', { confirmed: true, quantities: { 'leaf-01': 6, 'fruit-02': 6 } });
    act('plan', '/incidents/incident/plans');
    const plan = get().plans.at(-1)!;
    act('approve', `/plans/${plan.id}/approve`, { digest: plan.digest });
    return plan;
  };
  return { ...db, store, get, prepare, act, ready };
}

test('drill summaries are bounded records and retain the original full-state route', () => {
  const f = fixture();
  f.ready();
  const list = value(f.store.request('GET', '/drills'));
  assert.deepEqual(list, [{ id: 'incident', scenario: 'outage', seed: 7, status: f.get().status, version: f.get().version, clock: 0, createdAt: 1 }]);
  assert(!('events' in list[0]));
  assert.equal(value(f.store.request('GET', '/incidents'))[0].id, 'incident');
  assert.equal(value(f.store.request('GET', '/session')).tenant, 'test-tenant');
  f.db.close();
});
test('failed receipt insertion rolls back state and the action can recover exactly', () => {
  const f = fixture(); const before = f.get();
  const request = f.prepare('facts', '/incidents/incident/facts', { confirmed: true, quantities: { 'leaf-01': 6, 'fruit-02': 6 } });
  f.failReceipt(true);
  assert.throws(() => f.store.request('POST', request.route, request.body), /INJECTED_RECEIPT_FAILURE/);
  assert.deepEqual(f.get(), before);
  f.failReceipt(false);
  const receipt = value(f.store.request('POST', request.route, request.body));
  assert.deepEqual(value(f.store.request('POST', request.route, request.body)), receipt);
  assert.equal(f.get().version, before.version + 1);
  assert.equal(f.get().events.length, 1);
  f.db.close();
});
test('competing reservation versions cannot commit twice', () => {
  const f = fixture(); const plan = f.ready();
  const a = f.prepare('reserve', `/plans/${plan.id}/reserve`, { digest: plan.digest });
  const b = f.prepare('reserve', `/plans/${plan.id}/reserve`, { digest: plan.digest });
  value(f.store.request('POST', a.route, a.body));
  assert.equal(f.store.request('POST', b.route, b.body).ok, false);
  const rejected = f.store.request('POST', b.route, b.body);
  assert(!rejected.ok && rejected.code === 'VERSION_CONFLICT');
  assert.equal(f.get().work.length, 3);
  f.db.close();
});
test('exact receipt survives disk SQLite restart and refuses changed payload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coldspan-sqlite-'));
  try {
    const filename = join(dir, 'review.sqlite'); const f = fixture('outage', filename);
    const first = f.act('facts', '/incidents/incident/facts', { confirmed: true, quantities: { 'leaf-01': 6, 'fruit-02': 6 } });
    f.db.close();
    const next = sqliteStorage(filename); const reopened = new WorkspaceStore(next.storage);
    assert.deepEqual(value(reopened.request('POST', first.route, first.body)), first.receipt);
    const altered = reopened.request('POST', first.route, { ...first.body, payload: { changed: true } });
    assert(!altered.ok && altered.code === 'ACTION_PAYLOAD_CONFLICT');
    next.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('an expired session is explicit and its cleanup removes operational data', () => {
  const f = fixture(); const now = Date.now();
  f.db.prepare('UPDATE meta SET expires=?').run(now - 1);
  const expired = f.store.request('GET', '/session');
  assert(!expired.ok && expired.code === 'SESSION_EXPIRED' && expired.status === 401);
  f.store.expire(now);
  for (const table of ['incidents', 'tokens', 'receipts', 'leases']) assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
  f.db.close();
});
test('drill list and evidence stay isolated between workspaces', () => {
  const a = fixture(); const b = sqliteStorage(); const other = new WorkspaceStore(b.storage); other.initialize('other-tenant');
  assert.deepEqual(value(other.request('GET', '/drills')), []);
  const forbidden = other.request('GET', '/incidents/incident/evidence');
  assert(!forbidden.ok && forbidden.status === 404);
  a.db.close(); b.db.close();
});

const recovered = readFileSync(new URL('../cloudflare/deployed-worker.mjs', import.meta.url), 'utf8');
const portable = recovered.slice(0, recovered.lastIndexOf('// cloudflare/worker.ts')).replace('import { DurableObject } from "cloudflare:workers";', '') + '\nexport { WorkspaceStore };';
const OldStore = (await import('data:text/javascript;base64,' + Buffer.from(portable).toString('base64'))).WorkspaceStore as new (storage: StoragePort) => Pick<WorkspaceStore, 'initialize' | 'request'>;
const withoutCaptureTime = (value: unknown) => JSON.parse(JSON.stringify(value, (key, entry) => key === 'capturedAt' ? undefined : entry));
for (const kind of ['outage', 'healthy', 'last-slot', 'incompatible', 'no-responder', 'no-space', 'stale', 'uncertain']) {
  test(`typed store preserves the recovered backend behavior: ${kind}`, () => {
    const left = sqliteStorage(), right = sqliteStorage();
    const current = new WorkspaceStore(left.storage), old = new OldStore(right.storage);
    const initial = scenario('parity-incident', 'parity-tenant', kind, 7);
    for (const [store, storage] of [[current, left.storage], [old, right.storage]] as const) {
      store.initialize('parity-tenant');
      storage.sql.exec('INSERT INTO incidents VALUES(?,?,?,?,?)', initial.id, JSON.stringify(initial), JSON.stringify(initial), 0, 1);
    }
    let seq = 0;
    const both = (action: string, route: string, payload: unknown = {}) => {
      const actionId = 'parity-' + ++seq;
      for (const storage of [left.storage, right.storage]) storage.sql.exec('INSERT INTO tokens VALUES(?,?,?)', actionId, initial.id, action);
      const state: State = value(current.request('GET', '/incidents/' + initial.id));
      const body = { actionId, expectedVersion: state.version, incidentId: initial.id, payload };
      const result = current.request('POST', route, body);
      assert.deepEqual(withoutCaptureTime(result), withoutCaptureTime(old.request('POST', route, body)));
      assert.deepEqual(value(current.request('GET', '/incidents/' + initial.id)), value(old.request('GET', '/incidents/' + initial.id)));
      return result;
    };
    both('facts', '/incidents/parity-incident/facts', { confirmed: true, quantities: { 'leaf-01': 6, 'fruit-02': 6 } });
    both('plan', '/incidents/parity-incident/plans');
    const state: State = value(current.request('GET', '/incidents/' + initial.id)); const plan = state.plans.at(-1)!;
    both('approve', `/plans/${plan.id}/approve`, { digest: plan.digest });
    if (plan.transfers.length) {
      const reserved = both('reserve', `/plans/${plan.id}/reserve`, { digest: plan.digest });
      if (reserved.ok) for (const work of (value(current.request('GET', '/incidents/' + initial.id)) as State).work) {
        both('dispatch', `/work-orders/${work.id}/dispatch`, { fence: work.fence });
        both('clock', '/incidents/parity-incident/clock', { minutes: 5 });
        both('report', `/work-orders/${work.id}/arrival-report`, { fence: work.fence, actor: work.transfer.responder });
        both('arrival', `/work-orders/${work.id}/arrival`, { fence: work.fence });
      }
    }
    both('reconcile', '/incidents/parity-incident/reconcile');
    left.db.close(); right.db.close();
  });
}
