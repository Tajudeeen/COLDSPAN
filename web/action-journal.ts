import { uncertainError } from './remote-api';
export const PENDING_KEY = 'coldspan.cloud-pending.v1';
export const PENDING_PREFIX = 'coldspan.cloud-pending.v2.';
export interface PendingRequest { route: string; body: { actionId: string; expectedVersion: number; incidentId: string; payload: unknown } }
type JournalReader = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export const pendingKey = (request: PendingRequest) => PENDING_PREFIX + request.body.actionId;
export function loadPending(storage: JournalReader): PendingRequest | null {
  const old = storage.getItem(PENDING_KEY);
  if (old) {
    const request: PendingRequest = JSON.parse(old);
    storage.setItem(pendingKey(request), old);
    storage.removeItem(PENDING_KEY);
  }
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PENDING_PREFIX)) return JSON.parse(storage.getItem(key)!);
  }
  return null;
}
export async function commitPending(api: (path: string, body: unknown) => Promise<any>, storage: Pick<Storage, 'setItem' | 'removeItem'>, request: PendingRequest) {
  const key = pendingKey(request);
  storage.setItem(key, JSON.stringify(request));
  try {
    const receipt = await api(request.route, request.body);
    if (receipt?.status === 'PENDING') throw new Error('INTAKE_IN_PROGRESS: Recover the same request to check its outcome.');
    if (receipt?.actionId !== request.body.actionId || !Number.isInteger(receipt?.version)) throw new Error('INVALID_ACTION_RECEIPT');
    storage.removeItem(key);
    return receipt;
  } catch (error) {
    if (!uncertainError(error)) storage.removeItem(key);
    throw error;
  }
}
