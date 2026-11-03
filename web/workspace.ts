import type { State } from '../src/domain';
import type { DrillSummary } from '../cloudflare/store';
import { ApiError, SESSION_KEY } from './remote-api';
import { PENDING_KEY, PENDING_PREFIX } from './action-journal';
export const CURRENT_KEY = 'coldspan.cloud-current.v1';
export type WorkspaceApi = (path: string, body?: unknown) => Promise<any>;
export type SessionInfo = { tenant: string; expiresAt: number; mode: string; model: string };
export type WorkspaceSnapshot = { session: SessionInfo; drills: DrillSummary[]; incident: State | null };
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const pendingEntries = (storage: BrowserStorage) => Array.from({ length: storage.length }, (_, i) => storage.key(i))
  .filter((key): key is string => !!key && (key === PENDING_KEY || key.startsWith(PENDING_PREFIX)))
  .map(key => ({ key, value: storage.getItem(key) }));

export async function loadWorkspace(api: WorkspaceApi, storage: BrowserStorage): Promise<WorkspaceSnapshot> {
  if (!storage.getItem(SESSION_KEY)) {
    if (pendingEntries(storage).length) throw new Error('SESSION_KEY_MISSING: Pending actions are retained. The original review access key is needed to recover their receipts.');
    await api('/session', {});
  }
  const token = storage.getItem(SESSION_KEY);
  const session: SessionInfo = await api('/session');
  if (typeof session?.tenant !== 'string' || !Number.isFinite(session.expiresAt)) throw new Error('INVALID_SESSION_RESPONSE');
  const drills: DrillSummary[] = await api('/drills');
  if (!Array.isArray(drills) || drills.length > 100 || !drills.every(drill => typeof drill.id === 'string' && typeof drill.scenario === 'string' && Number.isInteger(drill.version) && typeof drill.status === 'string')) throw new Error('INVALID_DRILL_LIST');
  const selected = drills.find(drill => drill.id === storage.getItem(CURRENT_KEY)) ?? drills[0];
  const incident: State | null = selected ? await api('/incidents/' + selected.id) : null;
  if (incident && (incident.schema !== 1 || incident.id !== selected.id || incident.tenant !== session.tenant)) throw new Error('WORKSPACE_CHANGED: Refresh the workspace before continuing.');
  if (storage.getItem(SESSION_KEY) !== token) throw new Error('WORKSPACE_CHANGED: Another tab changed the review session. Refresh before continuing.');
  if (incident) storage.setItem(CURRENT_KEY, incident.id);
  return { session, drills, incident };
}

export async function restartExpiredReview(api: WorkspaceApi, storage: BrowserStorage, expectedToken: string) {
  if (storage.getItem(SESSION_KEY) !== expectedToken) throw new Error('WORKSPACE_CHANGED: Refresh before starting another review.');
  try {
    await api('/session');
    throw new Error('REVIEW_STILL_ACTIVE: This review has not expired.');
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'SESSION_EXPIRED') throw error;
  }
  if (storage.getItem(SESSION_KEY) !== expectedToken) throw new Error('WORKSPACE_CHANGED: Refresh before starting another review.');
  const entries = pendingEntries(storage);
  if (entries.length) {
    storage.setItem('coldspan.expired-review.' + crypto.randomUUID(), JSON.stringify({ archivedAt: new Date().toISOString(), reason: 'SESSION_EXPIRED', incidentId: storage.getItem(CURRENT_KEY), entries }));
    for (const entry of entries) if (storage.getItem(entry.key) === entry.value) storage.removeItem(entry.key);
  }
  storage.removeItem(CURRENT_KEY);
  await api('/session', {});
  return loadWorkspace(api, storage);
}
