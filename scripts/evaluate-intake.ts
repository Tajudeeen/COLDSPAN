import { readFileSync, writeFileSync } from 'node:fs';
import { scenario } from '../src/domain';
import { validateIntake } from '../src/intake';
const cases = JSON.parse(readFileSync('tests/intake-corpus.json', 'utf8'));
const results = cases.map((entry: any) => {
  const state = scenario('evaluation', 'synthetic'); state.notes = entry.notes;
  const observed = validateIntake(entry.candidate, state);
  return { id: entry.id, expected: { reason: entry.reason, canApply: entry.canApply }, observed: { reason: observed.reason, canApply: observed.canApply, issues: observed.issues }, pass: observed.reason === entry.reason && observed.canApply === entry.canApply && entry.issues.every((issue: string) => observed.issues.includes(issue)) };
});
const report = { checkedAt: new Date().toISOString(), kind: 'CANDIDATE_VALIDATION_FIXTURES', providerCalls: 0, total: results.length, passed: results.filter((result: any) => result.pass).length, results, limitations: 'Hand-authored candidate outputs test local validation. No live model accuracy, token cost, extraction benefit or physical outcome is measured.' };
writeFileSync('evidence/intake-boundary-evaluation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ kind: report.kind, passed: report.passed, total: report.total, providerCalls: 0 }));
if (report.passed !== report.total) process.exitCode = 1;
