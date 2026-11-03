import { DomainError, type State } from '../src/domain';
import { fixtureCandidate } from '../src/intake';
import { interpretWithMeta, modelCapability, type ModelConfig, type ProviderResult } from './meta';
import type { WorkspaceStore } from './store';
export async function runInterpretation(store: WorkspaceStore, body: Record<string, unknown>, config: ModelConfig, admit: () => Promise<boolean>, provider: typeof interpretWithMeta = interpretWithMeta) {
  const state = () => {
    if (typeof body.incidentId !== 'string') throw new DomainError('INCIDENT_REQUIRED');
    const result = store.request('GET', '/incidents/' + body.incidentId);
    if (!result.ok) throw new DomainError(result.code, result.detail);
    return result.data as State;
  };
  const initial = state(), start = store.intakes.begin(initial, body);
  if (!start.fresh) return start.record;
  let result: ProviderResult;
  if (start.record.mode === 'FIXTURE_REPLAY') {
    result = { status: 'COMPLETED', reason: 'ILLUSTRATIVE_FIXTURE_NOT_MODEL_EXECUTION', raw: fixtureCandidate(initial), model: null, usage: null, latencyMs: 0 };
  } else {
    const capability = modelCapability(config);
    if (capability.status === 'UNAVAILABLE') {
      result = { status: 'UNAVAILABLE', reason: capability.reason, raw: null, model: null, usage: null, latencyMs: 0 };
    } else if (!await admit()) {
      result = { status: 'UNAVAILABLE', reason: 'GLOBAL_MODEL_CALL_LIMIT', raw: null, model: null, usage: null, latencyMs: 0 };
    } else if (state().version !== initial.version) {
      result = { status: 'FAILED', reason: 'INCIDENT_CHANGED_BEFORE_PROVIDER_CALL', raw: null, model: null, usage: null, latencyMs: 0 };
    } else {
      result = await provider(initial, config);
    }
  }
  return store.intakes.complete(start.record.actionId, state(), result);
}
