import { digest, type State } from './domain';
export const INTAKE_PROMPT_VERSION = 'coldspan-notes-v1';
export type CandidateFact = { batchId: string; quantity: number; unit: 'crate'; sourceId: string; quote: string; confidence: 'supported' | 'uncertain' };
export type Candidate = { facts: CandidateFact[]; questions: string[] };
export type Review = { status: 'NEEDS_REVIEW'; reason: string; candidate: Candidate | null; issues: string[]; canApply: boolean };
export const sourceFor = (state: State) => ({ id: 'incident-notes', text: state.notes, hash: digest(state.notes) });
const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === keys.sort().join(',');
const reject = (reason: string): Review => ({ status: 'NEEDS_REVIEW', reason, candidate: null, issues: [reason], canApply: false });
export function validateIntake(raw: unknown, state: State): Review {
  if (!object(raw) || !exactKeys(raw, ['facts', 'questions']) || !Array.isArray(raw.facts) || raw.facts.length > 8 || !Array.isArray(raw.questions) || raw.questions.length > 8 || !raw.questions.every(q => typeof q === 'string' && q.length > 0 && q.length <= 300)) return reject('INVALID_TYPED_OUTPUT');
  const facts: CandidateFact[] = [], issues: string[] = [];
  const source = sourceFor(state);
  for (const entry of raw.facts) {
    if (!object(entry) || !exactKeys(entry, ['batchId', 'quantity', 'unit', 'sourceId', 'quote', 'confidence']) || typeof entry.batchId !== 'string' || !Number.isSafeInteger(entry.quantity) || Number(entry.quantity) < 0 || Number(entry.quantity) > 100_000 || entry.unit !== 'crate' || entry.sourceId !== source.id || typeof entry.quote !== 'string' || entry.quote.length < 3 || entry.quote.length > 500 || !['supported', 'uncertain'].includes(String(entry.confidence))) return reject('INVALID_TYPED_OUTPUT');
    const batch = state.batches.find(batch => batch.id === entry.batchId);
    if (!batch || !source.text.includes(entry.quote) || source.text.indexOf(entry.quote) !== source.text.lastIndexOf(entry.quote)) return reject('UNSUPPORTED_SOURCE_BINDING');
    const quote = entry.quote.toLowerCase();
    if (/\b(not|never|ignore|example|previously|instead)\b|-\d/.test(quote)) return reject('NEGATED_OR_NONCURRENT_QUOTE');
    const aliases = batch.class === 'leaf' ? ['leafy greens', 'greens', 'leaf-01'] : batch.class === 'fruit' ? ['tomato', 'tomatoes', 'fruit-02'] : [batch.name.toLowerCase(), batch.id];
    if (!aliases.some(alias => new RegExp('\\b' + alias + '\\b', 'i').test(quote))) return reject('UNSUPPORTED_BATCH_BINDING');
    if (/\b(kg|kilograms?|pounds?|litres?|boxes?)\b|\d[.,]\d/.test(quote)) return reject('UNSUPPORTED_UNIT_OR_FRACTION');
    const numbers = [...quote.matchAll(/\b(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/g)].map(match => words[match[0]] ?? Number(match[0]));
    if (!numbers.length || numbers.some(quantity => quantity !== entry.quantity)) return reject('QUANTITY_NOT_GROUNDED');
    if (!/\bcrates?\b/.test(quote)) issues.push('UNIT_REQUIRES_CONFIRMATION');
    const confidence = /\b(looks? like|maybe|about|roughly|uncertain|estimate|confirm|not sure|possibly)\b|\?/.test(quote) ? 'uncertain' : entry.confidence as CandidateFact['confidence'];
    if (confidence === 'uncertain') issues.push('UNCERTAINTY_REQUIRES_CONFIRMATION');
    if (facts.some(fact => fact.batchId === entry.batchId && fact.quantity !== entry.quantity)) return reject('CONFLICTING_FACTS');
    facts.push({ batchId: entry.batchId, quantity: Number(entry.quantity), unit: 'crate', sourceId: source.id, quote: entry.quote, confidence });
  }
  const complete = state.batches.every(batch => facts.some(fact => fact.batchId === batch.id));
  if (!complete) issues.push('MISSING_BATCH_FACTS');
  return { status: 'NEEDS_REVIEW', reason: 'HUMAN_CONFIRMATION_REQUIRED', candidate: { facts, questions: raw.questions as string[] }, issues: [...new Set(issues)], canApply: complete };
}
export function fixtureCandidate(state: State): Candidate {
  const fragments = ['Six crates of greens', 'Tomato count looks like 6, confirm'];
  return { facts: fragments.flatMap((quote, i) => state.notes.includes(quote) ? [{ batchId: i === 0 ? 'leaf-01' : 'fruit-02', quantity: 6, unit: 'crate' as const, sourceId: 'incident-notes', quote, confidence: i === 0 ? 'supported' as const : 'uncertain' as const }] : []), questions: ['Confirm the inventory and units before approving any movement.'] };
}
export const candidateJsonSchema = {
  type: 'object', additionalProperties: false, required: ['facts', 'questions'],
  properties: {
    facts: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['batchId', 'quantity', 'unit', 'sourceId', 'quote', 'confidence'], properties: { batchId: { type: 'string' }, quantity: { type: 'integer', minimum: 0, maximum: 100000 }, unit: { type: 'string', enum: ['crate'] }, sourceId: { type: 'string', enum: ['incident-notes'] }, quote: { type: 'string', minLength: 3, maxLength: 500 }, confidence: { type: 'string', enum: ['supported', 'uncertain'] } } } },
    questions: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 300 } },
  },
};
