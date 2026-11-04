import { validateIntake, type Candidate } from './intake';
import type { State } from './domain';
export type ModelCase = { id: string; notes: string; expected: { facts: Pick<Candidate['facts'][number], 'batchId' | 'quantity' | 'confidence'>[]; mustAsk: boolean } };
// Score semantic facts independently from the validator. An empty answer cannot pass a positive case.
export function scoreModelCase(entry: ModelCase, raw: unknown, state: State) {
  const review = validateIntake(raw, state);
  const actual = review.candidate?.facts ?? [];
  const key = (f: ModelCase['expected']['facts'][number]) => `${f.batchId}:${f.quantity}:${f.confidence}`;
  const expected = new Set(entry.expected.facts.map(key));
  const observed = new Set(actual.map(key));
  const matched = [...observed].filter(k => expected.has(k)).length;
  const precision = observed.size ? matched / observed.size : expected.size ? 0 : 1;
  const recall = expected.size ? matched / expected.size : observed.size ? 0 : 1;
  const asks = !!review.candidate?.questions.length;
  const pass = review.candidate !== null && precision === 1 && recall === 1 && (!entry.expected.mustAsk || asks);
  return { pass, precision, recall, asks, validationReason: review.reason, issues: review.issues };
}
