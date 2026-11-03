import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, SESSION_KEY, createRemoteApi } from '../web/remote-api';
import { CURRENT_KEY, loadWorkspace, restartExpiredReview } from '../web/workspace';
import { pendingKey, type PendingRequest } from '../web/action-journal';
import { scenario } from '../src/domain';
function memory() {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const session = { tenant: 'review', expiresAt: Date.now() + 100_000, mode: 'SYNTHETIC_SIMULATOR', model: 'UNAVAILABLE' };
const pending: PendingRequest = { route: '/incidents/old/clock', body: { actionId: 'unknown-receipt', expectedVersion: 3, incidentId: 'old', payload: { minutes: 5 } } };
test('workspace reload restores the selected earlier drill rather than the newest', async () => {
  const storage = memory(); storage.setItem(SESSION_KEY, 'existing-key'); storage.setItem(CURRENT_KEY, 'older');
  const state = scenario('older', 'review');
  const api = async (path: string) => path === '/session' ? session : path === '/drills' ? [ { id: 'newer', scenario: 'healthy', version: 0, status: 'OPEN' }, { id: 'older', scenario: 'outage', version: 0, status: 'OPEN' } ] : state;
  const loaded = await loadWorkspace(api, storage);
  assert.equal(loaded.incident?.id, 'older');
  assert.equal(loaded.drills.length, 2);
});
test('expired access never triggers automatic replacement', async () => {
  const storage = memory(); storage.setItem(SESSION_KEY, 'existing-key'); let created = 0;
  await assert.rejects(loadWorkspace(async (_path, body) => { if (body) created++; throw new ApiError('SESSION_EXPIRED', 401); }, storage), /SESSION_EXPIRED/);
  assert.equal(created, 0); assert.equal(storage.getItem(SESSION_KEY), 'existing-key');
});
test('missing key with an unresolved action does not create an unrelated review', async () => {
  const storage = memory(); storage.setItem(pendingKey(pending), JSON.stringify(pending)); let calls = 0;
  await assert.rejects(loadWorkspace(async () => { calls++; }, storage), /SESSION_KEY_MISSING/);
  assert.equal(calls, 0); assert.equal(storage.getItem(pendingKey(pending)), JSON.stringify(pending));
});
test('starting after confirmed expiry preserves pending identities in an archive', async () => {
  const storage = memory(); storage.setItem(SESSION_KEY, 'expired-key'); storage.setItem(CURRENT_KEY, 'old'); storage.setItem(pendingKey(pending), JSON.stringify(pending));
  let replaced = false;
  const api = async (path: string, body?: unknown) => {
    if (path === '/session' && body) { replaced = true; storage.setItem(SESSION_KEY, 'new-key'); return {}; }
    if (path === '/session' && !replaced) throw new ApiError('SESSION_EXPIRED', 401);
    return path === '/session' ? session : [];
  };
  const loaded = await restartExpiredReview(api, storage, 'expired-key');
  assert.equal(loaded.incident, null); assert.equal(storage.getItem(pendingKey(pending)), null);
  const archiveKey = Array.from({ length: storage.length }, (_, i) => storage.key(i)).find(key => key?.startsWith('coldspan.expired-review.'))!;
  const archive = JSON.parse(storage.getItem(archiveKey)!);
  assert.equal(archive.reason, 'SESSION_EXPIRED');
  assert.deepEqual(JSON.parse(archive.entries[0].value), pending);
  assert(!storage.getItem(archiveKey)!.includes('expired-key'));
});
test('a session changed by another tab cannot be archived or replaced', async () => {
  const storage = memory(); storage.setItem(SESSION_KEY, 'newer-key'); storage.setItem(pendingKey(pending), JSON.stringify(pending));
  await assert.rejects(restartExpiredReview(async () => { throw new Error('must not call'); }, storage, 'expired-key'), /WORKSPACE_CHANGED/);
  assert.equal(storage.getItem(pendingKey(pending)), JSON.stringify(pending));
});
test('a still-active review cannot be reset through the expiry action', async () => {
  const storage = memory(); storage.setItem(SESSION_KEY, 'live-key');
  await assert.rejects(restartExpiredReview(async () => session, storage, 'live-key'), /REVIEW_STILL_ACTIVE/);
  assert.equal(storage.getItem(SESSION_KEY), 'live-key');
});
test('an in-flight session creation cannot overwrite a newer access key', async () => {
  const storage = memory();
  const api = createRemoteApi(storage, async () => {
    storage.setItem(SESSION_KEY, 'cs_' + 'b'.repeat(64));
    return Response.json({ token: 'cs_' + 'a'.repeat(64) });
  });
  await api('/session', {});
  assert.equal(storage.getItem(SESSION_KEY), 'cs_' + 'b'.repeat(64));
});
test('a transient bootstrap failure leaves the existing key available for retry', async () => {
  const storage = memory(); storage.setItem(SESSION_KEY, 'existing-key'); let failed = true;
  const api = async (path: string) => { if (path === '/session') return session; if (failed) throw new TypeError('offline'); return []; };
  await assert.rejects(loadWorkspace(api, storage), /offline/);
  assert.equal(storage.getItem(SESSION_KEY), 'existing-key');
  failed = false;
  assert.equal((await loadWorkspace(api, storage)).incident, null);
});
