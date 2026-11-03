import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const base = 'https://coldspan-api.tajudeenowoeteniyan.workers.dev/api';
const origin = 'https://coldspan-preview.deeen-code.chatgpt.site';
async function call(path, body, token, requestOrigin = origin) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: requestOrigin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Coldspan-Intent': 'operator' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  return { status: response.status, data: await response.json() };
}
const checks = [];
async function check(name, run) { await run(); checks.push({ name, status: 'VERIFIED_HOSTED' }); console.log('PASS', name); }
const health = await call('/health'); assert.equal(health.data.status, 'ok');
const { data: reviewer } = await call('/session', {});
const { data: stranger } = await call('/session', {});
assert.match(reviewer.token, /^cs_[a-f0-9]{64}$/);
const api = async (path, body) => {
  const r = await call(path, body, reviewer.token);
  if (r.status >= 400) throw Object.assign(new Error(r.data.code), { code: r.data.code });
  return r.data;
};
if (process.argv.includes('--hold-redeploy')) {
  const incident = await api('/incidents', { scenario: 'healthy', seed: 9 });
  const action = await api(`/incidents/${incident.id}/actions`, { kind: 'facts' });
  const route = `/incidents/${incident.id}/facts`;
  const body = { actionId: action.actionId, expectedVersion: 0, incidentId: incident.id, payload: { confirmed: true, quantities: { 'leaf-01': 6, 'fruit-02': 6 } } };
  const receipt = await api(route, body);
  console.log('READY_REDEPLOY', health.data.build);
  const input = createInterface({ input: process.stdin });
  await new Promise(resolve => input.once('line', resolve));
  input.close();
  await check('pre-upgrade receipt and persisted state survive the typed backend deployment', async () => {
    assert.deepEqual(await api(route, body), receipt);
    assert.equal((await api(`/incidents/${incident.id}`)).version, 1);
  });
}
async function drill(scenario, withIntake = false) {
  let state = await api('/incidents', { scenario, seed: 7 });
  const id = state.id;
  const get = async () => state = await api(`/incidents/${id}`);
  const prepare = async (kind, route, payload = {}) => ({ route, body: { actionId: (await api(`/incidents/${id}/actions`, { kind })).actionId, expectedVersion: state.version, incidentId: id, payload } });
  const act = async (kind, route, payload = {}) => { const req = await prepare(kind, route, payload); const result = await api(req.route, req.body); await get(); return { req, result }; };
  let intake;
  if (withIntake) {
    const request = await prepare('intake', `/incidents/${id}/intake`, { mode: 'fixture' });
    intake = await api(request.route, request.body);
    assert.deepEqual(await api(request.route, request.body), intake);
    assert.equal(intake.mode, 'FIXTURE_REPLAY'); assert.equal(intake.provider.model, null); assert.equal(intake.provider.usage, null);
    await get(); assert.equal(state.uncertain, true); assert.equal(state.version, 0);
  }
  await act('facts', `/incidents/${id}/facts`, { confirmed: true, quantities: { 'leaf-01': 6, 'fruit-02': 6 }, ...(intake ? { intakeId: intake.actionId, intakeDigest: digest(intake.review.candidate) } : {}) });
  await act('plan', `/incidents/${id}/plans`);
  return { id, get, prepare, act, state: () => state };
}
let completed;
await check('complete outage, duplicate receipt and independent replay export', async () => {
  const d = await drill('outage', true);
  const p = d.state().plans.at(-1);
  await d.act('approve', `/plans/${p.id}/approve`, { digest: p.digest });
  await d.act('reserve', `/plans/${p.id}/reserve`, { digest: p.digest });
  for (const w of [...d.state().work]) {
    const { req, result } = await d.act('dispatch', `/work-orders/${w.id}/dispatch`, { fence: w.fence });
    assert.deepEqual(await api(req.route, req.body), result);
    await assert.rejects(api(req.route, { ...req.body, payload: { fence: w.fence, changed: true } }), /ACTION_PAYLOAD_CONFLICT/);
    await d.act('clock', `/incidents/${d.id}/clock`, { minutes: 5 });
    await d.act('report', `/work-orders/${w.id}/arrival-report`, { fence: w.fence, actor: w.transfer.responder });
    const forged = await d.prepare('arrival', `/work-orders/${w.id}/arrival`, { fence: w.fence, authority: 'simulator' });
    await assert.rejects(api(forged.route, forged.body), /SIMULATOR_AUTHORITY_REQUIRED/);
    await d.act('arrival', `/work-orders/${w.id}/arrival`, { fence: w.fence });
  }
  await d.act('reconcile', `/incidents/${d.id}/reconcile`);
  assert.equal(d.state().status, 'RECONCILED');
  assert.equal(d.state().batches.reduce((n, b) => n + Object.values(b.locations).reduce((a, q) => a + q, 0), 0), 12);
  completed = await api(`/incidents/${d.id}/evidence`);
  assert.equal(completed.manifest.schema, 2);
  const interpretations = JSON.parse(completed.artifacts['interpretations.json']);
  assert.equal(interpretations.length, 1); assert(interpretations[0].humanReview.actionId);
  await writeFile('evidence/cloudflare-hosted-completed.json', JSON.stringify(completed, null, 2));
  assert.equal((await call(`/incidents/${d.id}`, undefined, stranger.token)).status, 404);
});
await check('healthy control reconciles with no transfers', async () => {
  const d = await drill('healthy');
  assert.equal(d.state().plans.at(-1).transfers.length, 0);
  await d.act('reconcile', `/incidents/${d.id}/reconcile`);
  assert.equal(d.state().status, 'RECONCILED');
});
await check('concurrent reservation commits once and retains exact receipt', async () => {
  const d = await drill('outage'); const p = d.state().plans.at(-1);
  await d.act('approve', `/plans/${p.id}/approve`, { digest: p.digest });
  const a = await d.prepare('reserve', `/plans/${p.id}/reserve`, { digest: p.digest });
  const b = await d.prepare('reserve', `/plans/${p.id}/reserve`, { digest: p.digest });
  const results = await Promise.all([call(a.route, a.body, reviewer.token), call(b.route, b.body, reviewer.token)]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.find(r => r.status === 409).data.code, 'VERSION_CONFLICT');
  const win = results[0].status === 200 ? a : b;
  assert.deepEqual(await api(win.route, win.body), results.find(r => r.status === 200).data);
});
await check('disallowed origins and missing review credentials are refused', async () => {
  assert.equal((await call('/incidents')).status, 401);
  assert.equal((await call('/incidents', undefined, reviewer.token, 'https://untrusted.example')).status, 403);
});
await check('browser preflight permits only the declared origin and request headers', async () => {
  const response = await fetch(base + '/incidents', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-coldspan-intent' }, signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  const headers = response.headers.get('Access-Control-Allow-Headers').toLowerCase();
  for (const name of ['authorization', 'content-type', 'x-coldspan-intent']) assert(headers.includes(name));
});
await check('authenticated session metadata and compact drill history share the same scope', async () => {
  const session = await api('/session');
  assert.equal(session.tenant, reviewer.tenant);
  assert.equal(session.expiresAt, reviewer.expiresAt);
  assert(!('token' in session));
  const drills = await api('/drills');
  assert(drills.length >= 3);
  assert(drills.every(drill => Number.isInteger(drill.version) && !('events' in drill) && !('batches' in drill)));
  assert.deepEqual((await call('/drills', undefined, stranger.token)).data, []);
});
await check('expired review refuses session metadata and drill history', async () => {
  const fresh = (await call('/session', {})).data;
  assert.equal((await call('/session/close', {}, fresh.token)).status, 200);
  for (const path of ['/session', '/drills']) {
    const response = await call(path, undefined, fresh.token);
    assert.equal(response.status, 401); assert.equal(response.data.code, 'SESSION_EXPIRED');
  }
});
await check('Meta remains disabled and unavailable intake cannot authorize facts or movement', async () => {
  const capabilities = (await call('/capabilities')).data;
  assert.equal(capabilities.model.status, 'UNAVAILABLE'); assert.equal(capabilities.model.reason, 'MODEL_API_KEY_MISSING');
  const state = await api('/incidents', { scenario: 'outage', seed: 12, sourceNotes: 'Maybe six crates of greens. Tomato count needs confirmation.' });
  const { actionId } = await api(`/incidents/${state.id}/actions`, { kind: 'intake' });
  const body = { actionId, expectedVersion: 0, incidentId: state.id, payload: { mode: 'meta' } };
  const record = await api(`/incidents/${state.id}/intake`, body);
  assert.equal(record.status, 'UNAVAILABLE'); assert.equal(record.provider.usage, null);
  assert.deepEqual(await api(`/incidents/${state.id}/intake`, body), record);
  assert.equal((await api(`/incidents/${state.id}`)).uncertain, true);
  assert.equal((await api(`/incidents/${state.id}`)).work.length, 0);
  assert.equal((await call(`/incidents/${state.id}/intake`, undefined, stranger.token)).status, 404);
});
const currentHealth = await call('/health');
const expected = process.argv.indexOf('--expected-build');
if (expected >= 0) assert.equal(currentHealth.data.build, process.argv[expected + 1]);
await writeFile('evidence/cloudflare-live-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), build: currentHealth.data.build, checks, limitations: 'Synthetic workflow. No Meta execution, physical validation or real dispatch. Tokens are never saved in this report.' }, null, 2));
console.log(`COMPLETE ${checks.length}/${checks.length}`);
