import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest, canonical, scenario, type State } from '../src/domain';
import { fixtureCandidate, validateIntake } from '../src/intake';
import { WorkspaceStore, type Reply } from '../cloudflare/store';
import { runInterpretation } from '../cloudflare/intake-service';
import { interpretWithMeta, type ModelConfig } from '../cloudflare/meta';
import { admitDailyModelCall, expireRateCounters } from '../cloudflare/model-budget';
import { sqliteStorage } from './sqlite';
const unavailable: ModelConfig = { enabled: 'false', model: 'muse-spark-1.3' };
const enabled: ModelConfig = { enabled: 'true', model: 'muse-spark-1.3', apiKey: 'test-only-placeholder' };
const value = (reply: Reply): any => { assert(reply.ok, JSON.stringify(reply)); return reply.ok ? reply.data : null; };
function reviewFixture(kind = 'healthy') {
  const database = sqliteStorage(), store = new WorkspaceStore(database.storage); store.initialize('review');
  const state: State = value(store.request('POST', '/incidents', { scenario: kind, seed: 7 }));
  const get = (): State => value(store.request('GET', '/incidents/' + state.id));
  const prepare = (kind: string, payload: unknown = {}) => ({ incidentId: state.id, actionId: value(store.request('POST', `/incidents/${state.id}/actions`, { kind })).actionId, expectedVersion: get().version, payload });
  const act = (kind: string, suffix: string, payload: unknown = {}) => value(store.request('POST', `/incidents/${state.id}/${suffix}`, prepare(kind, payload)));
  return { ...database, store, state, get, prepare, act };
}
const noBudget = async () => { throw new Error('must not admit a provider call'); };
test('fixture interpretation cannot confirm facts or move stock', async () => {
  const f = reviewFixture(); const before = f.get();
  const request = f.prepare('intake', { mode: 'fixture' });
  const record = await runInterpretation(f.store, request, unavailable, noBudget);
  assert.equal(record.mode, 'FIXTURE_REPLAY'); assert.equal(record.status, 'NEEDS_REVIEW');
  assert.equal(record.review?.canApply, true); assert(record.review?.issues.includes('UNCERTAINTY_REQUIRES_CONFIRMATION'));
  assert.deepEqual(f.get(), before);
  assert.deepEqual(await runInterpretation(f.store, request, unavailable, noBudget), record);
  await assert.rejects(runInterpretation(f.store, { ...request, payload: { mode: 'meta' } }, unavailable, noBudget), /ACTION_PAYLOAD_CONFLICT/);
  f.db.close();
});
test('unavailable model records a refusal without spending a provider admission', async () => {
  const f = reviewFixture();
  const record = await runInterpretation(f.store, f.prepare('intake', { mode: 'meta' }), unavailable, noBudget);
  assert.equal(record.status, 'UNAVAILABLE'); assert.equal(record.reason, 'MODEL_API_KEY_MISSING');
  assert.equal(record.provider?.usage, null); assert.equal(f.get().uncertain, true);
  f.db.close();
});
test('provider timeout outcome is persisted and replay never calls it twice', async () => {
  const f = reviewFixture(); let calls = 0, admissions = 0;
  const request = f.prepare('intake', { mode: 'meta' });
  const provider: typeof interpretWithMeta = async () => { calls++; return { status: 'UNKNOWN_OUTCOME', reason: 'MODEL_TRANSPORT_OUTCOME_UNKNOWN', raw: null, model: enabled.model, usage: null, latencyMs: 15000 }; };
  const first = await runInterpretation(f.store, request, enabled, async () => { admissions++; return true; }, provider);
  assert.deepEqual(await runInterpretation(f.store, request, enabled, noBudget, provider), first);
  assert.equal(calls, 1); assert.equal(admissions, 1); assert.equal(f.get().version, 0);
  f.db.close();
});
test('parallel retries share a pending record instead of duplicate provider work', async () => {
  const f = reviewFixture(); let calls = 0; let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const request = f.prepare('intake', { mode: 'meta' });
  const provider: typeof interpretWithMeta = async () => { calls++; await waiting; return { status: 'COMPLETED', reason: 'TEST_PROVIDER', raw: fixtureCandidate(f.state), model: enabled.model, usage: { inputTokens: 10, outputTokens: 20 }, latencyMs: 1 }; };
  const original = runInterpretation(f.store, request, enabled, async () => true, provider);
  const duplicate = await runInterpretation(f.store, request, enabled, noBudget, provider);
  assert.equal(duplicate.status, 'PENDING'); finish();
  assert.equal((await original).status, 'NEEDS_REVIEW'); assert.equal(calls, 1);
  f.db.close();
});
test('changed incident versions make a delayed interpretation unusable', async () => {
  const f = reviewFixture();
  const provider: typeof interpretWithMeta = async () => { f.act('clock', 'clock', { minutes: 1 }); return { status: 'COMPLETED', reason: 'TEST_PROVIDER', raw: fixtureCandidate(f.state), model: enabled.model, usage: null, latencyMs: 1 }; };
  const record = await runInterpretation(f.store, f.prepare('intake', { mode: 'meta' }), enabled, async () => true, provider);
  assert.equal(record.review?.canApply, false); assert.equal(record.reason, 'INCIDENT_CHANGED_DURING_INTERPRETATION');
  f.db.close();
});
test('a stranded pending operation becomes unknown without a replacement provider call', async () => {
  const f = reviewFixture(); const request = f.prepare('intake', { mode: 'meta' });
  const started = f.store.intakes.begin(f.get(), request); const record = started.record;
  record.createdAt = new Date(Date.now() - 121000).toISOString();
  f.db.prepare('UPDATE interpretations SET result=? WHERE id=?').run(JSON.stringify(record), record.actionId);
  const recovered = await runInterpretation(f.store, request, enabled, noBudget);
  assert.equal(recovered.status, 'UNKNOWN_OUTCOME'); assert.equal(recovered.reason, 'INTAKE_OUTCOME_UNKNOWN_NO_AUTOMATIC_RETRY');
  f.db.close();
});
test('receipt failure rolls back the linked human-review annotation with the facts', async () => {
  const f = reviewFixture(); const record = await runInterpretation(f.store, f.prepare('intake', { mode: 'fixture' }), unavailable, noBudget);
  const payload = { confirmed: true, quantities: { 'leaf-01': 6, 'fruit-02': 6 }, intakeId: record.actionId, intakeDigest: digest(record.review!.candidate) };
  const request = f.prepare('facts', payload); f.failReceipt(true);
  assert.throws(() => f.store.request('POST', `/incidents/${f.state.id}/facts`, request), /INJECTED_RECEIPT_FAILURE/);
  assert.equal(f.get().uncertain, true); assert(!f.store.intakes.list(f.state.id)[0].humanReview);
  f.failReceipt(false); value(f.store.request('POST', `/incidents/${f.state.id}/facts`, request));
  assert.equal(f.store.intakes.list(f.state.id)[0].humanReview?.actionId, request.actionId);
  f.db.close();
});
test('global model admission retains spent attempts and resets only at the UTC day boundary', () => {
  const f = sqliteStorage(); f.db.exec('CREATE TABLE limits(bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)');
  const now = Date.UTC(2026, 10, 3, 12);
  assert.equal(admitDailyModelCall(f.storage, now), true); assert.equal(admitDailyModelCall(f.storage, now + 1000), true); assert.equal(admitDailyModelCall(f.storage, now + 2000), true);
  assert.equal(admitDailyModelCall(f.storage, now + 60_000), false);
  const tomorrow = Date.UTC(2026, 10, 4);
  assert.equal(admitDailyModelCall(f.storage, tomorrow), true);
  expireRateCounters(f.storage, tomorrow + 1000);
  assert.equal(admitDailyModelCall(f.storage, tomorrow + 2000), true); assert.equal(admitDailyModelCall(f.storage, tomorrow + 3000), true); assert.equal(admitDailyModelCall(f.storage, tomorrow + 4000), false);
  f.db.close();
});
test('schema-two evidence passes independent replay and rejects rehashed interpretation tampering', async () => {
  const f = reviewFixture(); const record = await runInterpretation(f.store, f.prepare('intake', { mode: 'fixture' }), unavailable, noBudget);
  f.act('facts', 'facts', { confirmed: true, quantities: { 'leaf-01': 6, 'fruit-02': 6 }, intakeId: record.actionId, intakeDigest: digest(record.review!.candidate) });
  f.act('plan', 'plans'); f.act('reconcile', 'reconcile');
  const bundle = value(f.store.request('GET', `/incidents/${f.state.id}/evidence`));
  assert.equal(bundle.manifest.schema, 2);
  const dir = mkdtempSync(join(tmpdir(), 'coldspan-intake-'));
  const check = (input: unknown) => { const filename = join(dir, 'evidence.json'); writeFileSync(filename, JSON.stringify(input)); return spawnSync('python3', ['verifier/check.py', filename], { encoding: 'utf8' }); };
  try {
    assert.equal(check(bundle).status, 0);
    for (const mutate of [
      (record: any) => { record.review.candidate.facts[0].quantity = 99; },
      (record: any) => { record.humanReview.actionId = 'invented-review'; },
      (record: any) => { record.provider.model = 'muse-spark-1.3'; },
      (record: any) => { record.review.candidate.facts[0].batchId = 'fruit-02'; },
      (record: any) => { record.review.candidate.facts[1].confidence = 'supported'; },
    ]) {
      const changed = structuredClone(bundle), records = JSON.parse(changed.artifacts['interpretations.json']); mutate(records[0]);
      changed.artifacts['interpretations.json'] = canonical(records); changed.manifest.files['interpretations.json'] = digest(changed.artifacts['interpretations.json']);
      assert.equal(check(changed).status, 1);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); f.db.close(); }
});
test('provider adapter follows the bounded schema contract and never exposes its key in records', async () => {
  const state = scenario('test', 'review');
  const result = await interpretWithMeta(state, enabled, async (url, options) => {
    assert.equal(String(url), 'https://api.meta.ai/v1/chat/completions');
    const request = JSON.parse(String(options?.body)); assert.equal(request.max_completion_tokens, 1024); assert.equal(request.response_format.type, 'json_schema'); assert(!request.tools);
    return Response.json({ model: enabled.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixtureCandidate(state)) } }], usage: { prompt_tokens: 30, completion_tokens: 40 } });
  });
  assert.equal(result.status, 'COMPLETED'); assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 40 }); assert(!JSON.stringify(result).includes(enabled.apiKey!));
});
for (const [status, reason] of [[401, 'MODEL_ACCESS_DENIED'], [429, 'MODEL_RATE_LIMITED'], [503, 'MODEL_HTTP_503']] as const) test(`provider HTTP ${status} is a recorded failure without automatic retries`, async () => {
  let calls = 0;
  const result = await interpretWithMeta(scenario('test', 'review'), enabled, async () => { calls++; return new Response('provider body is not retained', { status }); });
  assert.equal(result.reason, reason); assert.equal(calls, 1); assert.equal(result.raw, null);
});
test('disabled provider access makes zero transport calls', async () => {
  let calls = 0;
  const result = await interpretWithMeta(scenario('test', 'review'), unavailable, async () => { calls++; throw new Error('must not call'); });
  assert.equal(result.status, 'UNAVAILABLE'); assert.equal(calls, 0);
});
for (const data of [{ model: enabled.model, choices: [{ finish_reason: 'length', message: { content: '{}' } }] }, { model: enabled.model, choices: [{ finish_reason: 'stop', message: { refusal: 'declined', content: '{}' } }] }, { model: 'another-model', choices: [] }]) test('incomplete, refused or mismatched provider envelopes cannot yield a candidate', async () => {
  const result = await interpretWithMeta(scenario('test', 'review'), enabled, async () => Response.json(data));
  assert.equal(result.status, 'FAILED'); assert.equal(result.raw, null);
});
const corpus = JSON.parse(readFileSync(new URL('./intake-corpus.json', import.meta.url), 'utf8'));
for (const entry of corpus) test(`frozen intake boundary: ${entry.id}`, () => {
  const state = scenario('test', 'review'); state.notes = entry.notes;
  const result = validateIntake(entry.candidate, state);
  assert.equal(result.reason, entry.reason); assert.equal(result.canApply, entry.canApply);
  for (const issue of entry.issues ?? []) assert(result.issues.includes(issue));
});
