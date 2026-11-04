import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReadiness, SITE_ORIGIN } from '../scripts/check-readiness.mjs';
const fake = (build = 'wanted', mode = 'SYNTHETIC_SIMULATOR', cors = SITE_ORIGIN) => async url => new Response(JSON.stringify(url.endsWith('health') ? { status: 'ok', mode, build, storage: 'CLOUDFLARE_DURABLE_OBJECT_SQLITE' } : { mode, model: { status: 'UNAVAILABLE', reason: 'MODEL_API_KEY_MISSING' } }), { headers: { 'Access-Control-Allow-Origin': cors } });
test('monitor checks build, simulator mode and browser origin while preserving unavailable model state', async () => {
  const report = await checkReadiness(fake(), 'wanted');
  assert.equal(report.pass, true);
  assert.equal(report.checks[1].reason, 'MODEL_API_KEY_MISSING');
  for (const f of [fake('old'), fake('wanted', 'LIVE'), fake('wanted', 'SYNTHETIC_SIMULATOR', '*')]) assert.equal((await checkReadiness(f, 'wanted')).pass, false);
});
test('transport failures and malformed responses fail closed without exposing upstream data', async () => {
  for (const f of [async () => { throw Error('private diagnostic'); }, async () => new Response('secret not JSON')]) {
    const r = await checkReadiness(f);
    assert.equal(r.pass, false);
    assert.doesNotMatch(JSON.stringify(r), /private diagnostic|secret not JSON/);
  }
});
