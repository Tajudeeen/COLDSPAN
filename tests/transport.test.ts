import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteApi, ApiError, SESSION_KEY } from '../web/remote-api';
import { commitPending, PENDING_KEY, pendingKey, loadPending } from '../web/action-journal';
const memory = () => {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const request = { route: '/incidents/demo/clock', body: { actionId: 'issued-id', expectedVersion: 3, incidentId: 'demo', payload: { minutes: 5 } } };
test('session metadata is read without expecting or replacing an access key', async () => {
  const storage = memory(); const token = 'cs_' + 'a'.repeat(64); storage.setItem(SESSION_KEY, token);
  const metadata = { tenant: 'review', expiresAt: Date.now() + 1000, mode: 'SYNTHETIC_SIMULATOR', model: 'UNAVAILABLE' };
  const api = createRemoteApi(storage, async (_url, options) => {
    assert.equal(options?.method, 'GET');
    return Response.json(metadata);
  });
  assert.deepEqual(await api('/session'), metadata);
  assert.equal(storage.getItem(SESSION_KEY), token);
});
test('remote transport attaches the review bearer and explicit mutation intent', async () => {
  const storage = memory();
  storage.setItem(SESSION_KEY, 'cs_' + 'a'.repeat(64));
  const api = createRemoteApi(storage, async (url, options) => {
    assert.match(String(url), /^https:\/\/coldspan-api\.tajudeenowoeteniyan\.workers\.dev\/api\//);
    assert.equal(options?.credentials, 'omit');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer cs_' + 'a'.repeat(64));
    assert.equal(headers.get('X-Coldspan-Intent'), 'operator');
    assert.equal(options?.body, JSON.stringify(request.body));
    return Response.json({ actionId: 'issued-id' });
  });
  await api(request.route, request.body);
});
test('a committed action with a lost response keeps its identity across journal reload', async () => {
  const storage = memory();
  let commits = 0;
  const receipts = new Map();
  const api = async (_path: string, body: any) => {
    if (!receipts.has(body.actionId)) {
      receipts.set(body.actionId, { actionId: body.actionId, version: 4 });
      commits++;
      throw new TypeError('Failed to fetch');
    }
    return receipts.get(body.actionId);
  };
  await assert.rejects(commitPending(api, storage, request));
  const recovered = JSON.parse(storage.getItem(pendingKey(request))!);
  assert.deepEqual(recovered, request);
  assert.deepEqual(await commitPending(api, storage, recovered), { actionId: 'issued-id', version: 4 });
  assert.equal(commits, 1);
  assert.equal(storage.getItem(pendingKey(request)), null);
});
for (const failure of [new ApiError('INTERNAL_ERROR', 500), new SyntaxError('Invalid response JSON'), new DOMException('Timed out', 'TimeoutError')]) {
  test(`uncertain outcome preserves pending identity: ${failure.name} ${failure.message}`, async () => {
    const storage = memory();
    await assert.rejects(commitPending(async () => { throw failure; }, storage, request));
    assert.deepEqual(JSON.parse(storage.getItem(pendingKey(request))!), request);
  });
}
test('a definitive version refusal clears the pending journal', async () => {
  const storage = memory();
  await assert.rejects(commitPending(async () => { throw new ApiError('VERSION_CONFLICT', 409); }, storage, request), /VERSION_CONFLICT/);
  assert.equal(storage.getItem(pendingKey(request)), null);
});
test('a malformed success cannot discard an unresolved action', async () => {
  const storage = memory();
  await assert.rejects(commitPending(async () => ({}), storage, request), /INVALID_ACTION_RECEIPT/);
  assert.deepEqual(JSON.parse(storage.getItem(pendingKey(request))!), request);
});

test('concurrent tabs cannot erase another unresolved action journal', async () => {
  const storage = memory();
  const other = { ...request, body: { ...request.body, actionId: 'another-issued-id' } };
  await assert.rejects(commitPending(async () => { throw new TypeError('Lost response'); }, storage, request));
  await assert.rejects(commitPending(async () => { throw new ApiError('VERSION_CONFLICT', 409); }, storage, other));
  assert.deepEqual(loadPending(storage), request);
  assert.equal(storage.getItem(pendingKey(other)), null);
  await commitPending(async () => ({ actionId: request.body.actionId, version: 4 }), storage, request);
  assert.equal(loadPending(storage), null);
});
test('legacy unresolved request is migrated without replacing its identity', () => {
  const storage = memory();
  storage.setItem(PENDING_KEY, JSON.stringify(request));
  assert.deepEqual(loadPending(storage), request);
  assert.equal(storage.getItem(PENDING_KEY), null);
  assert.deepEqual(JSON.parse(storage.getItem(pendingKey(request))!), request);
});
