import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { scenario } from '../src/domain';
import { interpretWithMeta } from '../cloudflare/meta';
import { scoreModelCase, type ModelCase } from '../src/model-evaluation';
// This standalone runner calls Meta directly. It never mutates a workspace or runs in routine CI.
const args = process.argv.slice(2);
const live = args.includes('--live');
const limit = Number(process.env.COLDSPAN_EVAL_MAX_CALLS ?? '1');
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Evaluation limit must be 1 to 3 calls');
const cases = JSON.parse(readFileSync('tests/model-cases.json', 'utf8')) as ModelCase[];
const selected = cases.slice(0, limit);
const config = { apiKey: process.env.MODEL_API_KEY, enabled: live ? 'true' : 'false', model: 'muse-spark-1.3' };
if (live && !config.apiKey) throw Error('MODEL_API_KEY is required in the process environment');
const results = [];
for (const entry of selected) {
  if (!live) { results.push({ id: entry.id, status: 'NOT_RUN', pass: false }); continue; }
  const state = scenario('model-evaluation', 'synthetic'); state.notes = entry.notes;
  const provider = await interpretWithMeta(state, config);
  results.push({ id: entry.id, status: provider.status, reason: provider.reason, latencyMs: provider.latencyMs, usage: provider.usage, ...scoreModelCase(entry, provider.raw, state) });
  // No automatic retry. A timeout may already have incurred usage.
  if (provider.status !== 'COMPLETED') break;
}
const report = { kind: live ? 'LIVE_META_EVALUATION' : 'EVALUATION_PLAN', checkedAt: new Date().toISOString(), model: config.model, maxCalls: limit, attemptedCalls: live ? results.length : 0, passed: results.filter(r => r.pass).length, total: selected.length, results, monetaryCost: null, limitation: 'Small labeled sample only. Usage is provider-reported. No physical outcomes measured. Direct runner does not use the deployed Worker daily quota.' };
mkdirSync('ops-output', { recursive: true });
writeFileSync('ops-output/model-evaluation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (live && (results.length !== selected.length || results.some(r => !r.pass))) process.exitCode = 1;
