export const API_URL = 'https://coldspan-api.tajudeenowoeteniyan.workers.dev/api';
export const SESSION_KEY = 'coldspan.cloud-session.v1';
export class ApiError extends Error {
  constructor(public code: string, public status: number, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}
export const uncertainError = (error: unknown) => !(error instanceof ApiError) || error.status >= 500 || error.status === 408;
export function createRemoteApi(storage: Pick<Storage, 'getItem' | 'setItem'>, transport: typeof fetch = fetch, base = API_URL) {
  return async (path: string, body?: unknown): Promise<any> => {
    const token = storage.getItem(SESSION_KEY);
    if (path !== '/session' && !token) throw new ApiError('SESSION_REQUIRED', 401);
    const response = await transport(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Coldspan-Intent': 'operator' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json();
    if (!response.ok) throw new ApiError(data.code || 'REQUEST_FAILED', response.status, data.detail);
    if (path === '/session') {
      if (typeof data.token !== 'string' || !/^cs_[a-f0-9]{64}$/.test(data.token)) throw new Error('INVALID_SESSION_RESPONSE');
      if (storage.getItem(SESSION_KEY) === token) storage.setItem(SESSION_KEY, data.token);
    }
    return data;
  };
}
export const remoteApi = (path: string, body?: unknown) => createRemoteApi(localStorage, fetch, import.meta.env?.DEV ? '/api' : API_URL)(path, body);
export async function downloadEvidence(id: string) {
  const data = await remoteApi(`/incidents/${id}/evidence`);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'coldspan-evidence.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
