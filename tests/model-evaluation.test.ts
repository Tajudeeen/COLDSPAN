import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from '../src/domain';
import { scoreModelCase, type ModelCase } from '../src/model-evaluation';
const entry: ModelCase = { id: 'test', notes: '6 crates of greens.', expected: { facts: [{ batchId: 'leaf-01', quantity: 6, confidence: 'supported' }], mustAsk: true } };
const state = scenario('eval', 'synthetic'); state.notes = entry.notes;
const fact = { batchId: 'leaf-01', quantity: 6, confidence: 'supported', unit: 'crate', sourceId: 'incident-notes', quote: entry.notes };
test('model evaluator rejects vacuous success, wrong quantities, unsupported quotes and missing questions', () => {
  for (const raw of [{ facts: [], questions: ['Count?'] }, { facts: [{ ...fact, quantity: 7 }], questions: ['Count?'] }, { facts: [{ ...fact, quote: 'invented' }], questions: ['Count?'] }, { facts: [fact], questions: [] }]) assert.equal(scoreModelCase(entry, raw, state).pass, false);
  assert.equal(scoreModelCase(entry, { facts: [fact], questions: ['Count tomatoes?'] }, state).pass, true);
});
test('uncertainty is evaluated after deterministic normalization', () => {
  const uncertain = { ...entry, notes: 'Maybe 6 crates of greens.', expected: { ...entry.expected, facts: [{ ...entry.expected.facts[0], confidence: 'uncertain' as const }] } };
  const s = scenario('eval', 'synthetic'); s.notes = uncertain.notes;
  assert.equal(scoreModelCase(uncertain, { facts: [{ ...fact, quote: uncertain.notes }], questions: ['Confirm?'] }, s).pass, true);
});
