import { DurableObject } from "cloudflare:workers";
import { digest, DomainError, need } from "../src/domain";
import { WorkspaceStore } from "./store";
import { runInterpretation } from './intake-service';
import { modelCapability, type ModelConfig } from './meta';
import { admitDailyModelCall, expireRateCounters } from './model-budget';
const modelConfig = (env: Cloudflare.Env): ModelConfig => ({ apiKey: env.MODEL_API_KEY, enabled: env.MODEL_CALLS_ENABLED, model: env.MODEL_NAME });
export class ColdspanWorkspace extends DurableObject<Cloudflare.Env> {
  private store: WorkspaceStore;
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.store = new WorkspaceStore(ctx.storage);
  }
  async initialize(tenant: string) {
    const expiry = this.store.initialize(tenant);
    await this.ctx.storage.setAlarm(expiry);
    return { expiresAt: expiry };
  }
  request(method: string, path: string, body: string) {
    return JSON.stringify(this.store.request(method, path, JSON.parse(body)));
  }
  async interpret(body: string) {
    try {
      const record = await runInterpretation(this.store, JSON.parse(body), modelConfig(this.env), () => this.env.REQUEST_GATES.getByName('coldspan-global-model-budget-v1').admitModelCall());
      return JSON.stringify({ ok: true, data: record, status: 200 });
    } catch (error) {
      if (error instanceof DomainError) return JSON.stringify({ ok: false, code: error.code, detail: error.detail, status: ['SESSION_REQUIRED', 'SESSION_EXPIRED'].includes(error.code) ? 401 : error.code === 'NOT_FOUND' ? 404 : 409 });
      throw error;
    }
  }
  alarm() {
    this.store.expire();
  }
}
export class ColdspanRequestGate extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS limits (bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)");
  }
  async allow(bucket: string, limit: number) {
    const now = Date.now();
    const allowed = this.ctx.storage.transactionSync(() => {
      const r = this.ctx.storage.sql.exec<{ window: number; count: number }>("SELECT window,count FROM limits WHERE bucket=?", bucket).toArray()[0];
      const window = Math.floor(now / 6e4);
      const count = r?.window === window ? r.count + 1 : 1;
      this.ctx.storage.sql.exec("INSERT INTO limits VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET window=excluded.window,count=excluded.count", bucket, window, count);
      return count <= limit;
    });
    await this.ctx.storage.setAlarm(now + 12e4);
    return allowed;
  }
  async alarm() {
    expireRateCounters(this.ctx.storage);
  }
  async admitModelCall() {
    const now = Date.now(), day = Math.floor(now / 86_400_000);
    const allowed = admitDailyModelCall(this.ctx.storage, now);
    await this.ctx.storage.setAlarm((day + 1) * 86_400_000 + 1000);
    return allowed;
  }
}
function response(data: unknown, status = 200, origin?: string) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {} } });
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  need(request.headers.get("content-type")?.split(";")[0].trim() === "application/json", "JSON_REQUIRED");
  const reader = request.body?.getReader();
  need(reader, "BODY_REQUIRED");
  let count = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > 16384) {
      await reader.cancel();
      throw new DomainError("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DomainError("INVALID_JSON");
  }
  need(body && typeof body === "object" && !Array.isArray(body), "INVALID_BODY");
  return body as Record<string, unknown>;
}
const worker_default = { async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  const allowed = origin === env.ALLOWED_ORIGIN ? origin : void 0;
  if (origin && !allowed) return response({ code: "ORIGIN_REJECTED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...allowed ? { "Access-Control-Allow-Origin": allowed, "Vary": "Origin" } : {}, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Coldspan-Intent", "Access-Control-Max-Age": "600" } });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api(?=\/|$)/, "");
  if (request.method === "GET" && path === "/health") return response({ status: "ok", storage: "CLOUDFLARE_DURABLE_OBJECT_SQLITE", mode: "SYNTHETIC_SIMULATOR", model: "UNAVAILABLE", build: env.BUILD_ID }, 200, allowed);
  if (request.method === 'GET' && path === '/capabilities') return response({ model: modelCapability(modelConfig(env)), mode: 'SYNTHETIC_SIMULATOR', fixtureReplay: true }, 200, allowed);
  if (!["GET", "POST"].includes(request.method)) return response({ code: "METHOD_NOT_ALLOWED" }, 405, allowed);
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unreported";
    const gate = env.REQUEST_GATES.getByName(digest(ip));
    need(await gate.allow(path === "/session" ? "sessions" : "requests", path === "/session" ? 20 : 1e3), "RATE_LIMITED");
    if (request.method === "POST") need(request.headers.get("X-Coldspan-Intent") === "operator", "INTENT_REQUIRED");
    if (request.method === "POST" && path === "/session") {
      const token = "cs_" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) => v.toString(16).padStart(2, "0")).join("");
      const tenant = digest(token);
      const session = await env.WORKSPACES.getByName(tenant).initialize(tenant);
      return response({ token, tenant, expiresAt: session.expiresAt, mode: "CLOUDFLARE_SYNTHETIC_SIMULATOR", model: "UNAVAILABLE" }, 201, allowed);
    }
    const match = request.headers.get("Authorization")?.match(/^Bearer (cs_[a-f0-9]{64})$/);
    need(match, "SESSION_REQUIRED");
    const workspace = env.WORKSPACES.getByName(digest(match[1]));
    const body = request.method === "POST" ? await readBody(request) : {};
    if (request.method === 'POST' && /^\/incidents\/[^/]+\/intake$/.test(path)) need(body.incidentId === path.split('/')[2], 'SCOPE_MISMATCH');
    const r = JSON.parse(await (request.method === 'POST' && /^\/incidents\/[^/]+\/intake$/.test(path) ? workspace.interpret(JSON.stringify(body)) : workspace.request(request.method, path, JSON.stringify(body))));
    return r.ok ? response(r.data, r.status, allowed) : response({ code: r.code, detail: r.detail }, r.status, allowed);
  } catch (e) {
    if (e instanceof DomainError) return response({ code: e.code, detail: e.detail }, e.code === "SESSION_REQUIRED" ? 401 : e.code === "RATE_LIMITED" ? 429 : 409, allowed);
    console.error(JSON.stringify({ code: "INTERNAL_ERROR", build: env.BUILD_ID }));
    return response({ code: "INTERNAL_ERROR" }, 500, allowed);
  }
} };
export default worker_default;

