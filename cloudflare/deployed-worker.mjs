// cloudflare/worker.ts
import { DurableObject } from "cloudflare:workers";

// node_modules/@noble/hashes/_u64.js
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE ? l : h, isLE);
  view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
}

// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
var aopts = (value, label) => {
  aobject(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function checkOpts(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);

// src/domain.ts
function canonical(x) {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object")
    return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}";
  return JSON.stringify(x);
}
var digest = (x) => bytesToHex(sha256(new TextEncoder().encode(typeof x === "string" ? x : canonical(x))));
var DomainError = class extends Error {
  constructor(code, detail = code) {
    super(detail);
    this.code = code;
    this.detail = detail;
  }
  code;
  detail;
};
function need(ok, code, detail = code) {
  if (!ok) throw new DomainError(code, detail);
}
function scenario(id, tenant, kind = "outage", seed = 7) {
  need(
    [
      "outage",
      "healthy",
      "last-slot",
      "incompatible",
      "no-responder",
      "no-space",
      "stale",
      "uncertain"
    ].includes(kind),
    "UNKNOWN_SCENARIO"
  );
  const rooms = [
    ["north", "North cold room", 18, 0, ["leaf", "fruit"], 0, false],
    ["east", "East reserve", 12, 2, ["leaf", "fruit"], 4, true],
    ["west", "West reserve", 10, 2, ["fruit"], 8, true]
  ].map((r) => ({
    id: r[0],
    name: r[1],
    capacity: r[2],
    background: r[3],
    classes: r[4],
    distance: r[5],
    observation: {
      id: `obs-${r[0]}-0`,
      at: 0,
      temp: r[6] ? 40 : 120,
      healthy: r[6],
      source: "SYNTHETIC",
      ttl: 30
    }
  }));
  if (kind === "healthy")
    rooms[0].observation = { ...rooms[0].observation, healthy: true, temp: 40 };
  if (kind === "last-slot") {
    rooms[1].capacity = 8;
    rooms[2].classes = [];
  }
  if (kind === "incompatible") {
    rooms[1].classes = ["fruit"];
  }
  if (kind === "no-space") {
    rooms[1].capacity = 2;
    rooms[2].capacity = 2;
  }
  const batches = [
    {
      id: "leaf-01",
      name: "Leafy greens",
      quantity: 6,
      unit: "crate",
      slotsPerUnit: 1,
      class: "leaf",
      origin: "north",
      deadline: 90,
      locations: { north: 6 }
    },
    {
      id: "fruit-02",
      name: "Tomatoes",
      quantity: 6,
      unit: "crate",
      slotsPerUnit: 1,
      class: "fruit",
      origin: "north",
      deadline: 120,
      locations: { north: 6 }
    }
  ];
  return {
    schema: 1,
    id,
    tenant,
    scenario: kind,
    seed,
    clock: kind === "stale" ? 31 : 0,
    version: 0,
    status: "OPEN",
    notes: kind === "healthy" ? "False alarm drill. Compressor is running and current synthetic room observations are healthy. Six crates of greens. Tomato count looks like 6, confirm the inventory." : "North compressor stopped. Six crates of greens. Tomato count looks like 6, confirm before moving. East reading from this drill.",
    uncertain: true,
    rooms,
    batches,
    responders: kind === "no-responder" ? [] : ["Amina", "Idris"],
    vehicles: [
      { id: "van-01", slots: 8, duration: 5 },
      { id: "van-02", slots: 8, duration: 5 }
    ],
    plans: [],
    work: [],
    events: []
  };
}
function occupancy(s, room2) {
  return s.rooms.find((r) => r.id === room2).background + s.batches.reduce((n, b) => n + (b.locations[room2] || 0) * b.slotsPerUnit, 0);
}
function reserved(s, room2) {
  return s.work.filter(
    (w) => w.transfer.destination === room2 && ["RESERVED", "DISPATCHED", "ARRIVAL_REPORTED"].includes(w.state)
  ).reduce(
    (n, w) => n + w.transfer.quantity * s.batches.find((b) => b.id === w.transfer.batch).slotsPerUnit,
    0
  );
}
function record(s, kind, data, actionId) {
  const e = {
    seq: s.events.length + 1,
    priorVersion: s.version,
    at: s.clock,
    actionId,
    kind,
    data: structuredClone(data),
    previousHash: s.events.at(-1)?.hash || "0".repeat(64)
  };
  e.hash = digest(e);
  s.events.push(e);
  s.version++;
}
function room(s, id) {
  const r = s.rooms.find((r2) => r2.id === id);
  need(r, "ROOM_NOT_FOUND");
  return r;
}
function fresh(s, r) {
  need(
    s.clock - r.observation.at <= r.observation.ttl && r.observation.at <= s.clock,
    "STALE_OBSERVATION",
    `${r.name} needs a fresh simulated reading.`
  );
}
function proposeGreedy(s) {
  need(!s.uncertain, "NEEDS_REVIEW", "Confirm inventory before generating a plan.");
  const free = Object.fromEntries(
    s.rooms.map((r) => [r.id, r.capacity - occupancy(s, r.id) - reserved(s, r.id)])
  );
  const transfers = [];
  for (const b of s.batches) {
    if (room(s, b.origin).observation.healthy) continue;
    let left = (b.locations[b.origin] || 0) - s.work.filter((w) => w.transfer.batch === b.id && w.state === "RESERVED").reduce((n, w) => n + w.transfer.quantity, 0);
    for (const r of [...s.rooms].sort((a, b2) => a.distance - b2.distance)) {
      if (left <= 0) break;
      if (r.id === b.origin || !r.observation.healthy || !r.classes.includes(b.class) || s.clock - r.observation.at > r.observation.ttl)
        continue;
      const qty = Math.min(left, Math.floor(free[r.id] / b.slotsPerUnit));
      if (qty > 0 && s.responders.length && s.vehicles.length) {
        transfers.push({
          batch: b.id,
          quantity: qty,
          destination: r.id,
          responder: s.responders[(transfers.length + s.seed) % s.responders.length],
          vehicle: s.vehicles[(transfers.length + s.seed) % s.vehicles.length].id
        });
        free[r.id] -= qty * b.slotsPerUnit;
        left -= qty;
      }
    }
  }
  return transfers;
}
function transition(s, kind, p, actionId) {
  need(s.status !== "RECONCILED", "INCIDENT_CLOSED");
  if (kind === "facts") {
    need(p.confirmed === true, "NEEDS_REVIEW");
    need(
      p.quantities && s.batches.every((b) => p.quantities[b.id] === b.quantity),
      "INVENTORY_CONFLICT",
      "Counts differ from initial stock. Resolve the source inventory in a new drill."
    );
    s.uncertain = false;
    s.status = "FACTS_REVIEWED";
    record(s, "FACTS_CONFIRMED", { quantities: p.quantities }, actionId);
  } else if (kind === "observe") {
    const r = room(s, p.room);
    need(Number.isInteger(p.temp) && typeof p.healthy === "boolean", "INVALID_OBSERVATION");
    r.observation = {
      id: `obs-${r.id}-${s.version + 1}`,
      at: s.clock,
      temp: p.temp,
      healthy: p.healthy,
      source: "SYNTHETIC",
      ttl: 30
    };
    if (!p.healthy && s.work.some(
      (w) => w.transfer.destination === r.id && ["DISPATCHED", "ARRIVAL_REPORTED"].includes(w.state)
    ))
      s.status = "NEEDS_HUMAN";
    record(s, "OBSERVED", { room: r.id, observation: r.observation }, actionId);
  } else if (kind === "clock") {
    need(Number.isInteger(p.minutes) && p.minutes > 0 && p.minutes <= 1440, "INVALID_CLOCK");
    s.clock += p.minutes;
    record(s, "CLOCK_ADVANCED", { minutes: p.minutes }, actionId);
  } else if (kind === "plan") {
    need(!s.uncertain, "NEEDS_REVIEW");
    const ts = p.transfers ?? proposeGreedy(s);
    need(Array.isArray(ts) && ts.length <= 30, "INVALID_PLAN");
    for (const t of ts) {
      need(
        t && Object.keys(t).sort().join(",") === "batch,destination,quantity,responder,vehicle",
        "INVALID_TRANSFER"
      );
      need(Number.isInteger(t.quantity) && t.quantity > 0, "INVALID_QUANTITY");
      need(
        s.batches.some((b) => b.id === t.batch),
        "BATCH_NOT_FOUND"
      );
      room(s, t.destination);
      need(s.responders.includes(t.responder), "RESPONDER_UNAVAILABLE");
      need(
        s.vehicles.some((v) => v.id === t.vehicle),
        "VEHICLE_UNAVAILABLE"
      );
    }
    if (p.replacesPlanId) {
      const old = s.plans.find((x) => x.id === p.replacesPlanId);
      need(old, "PLAN_NOT_FOUND");
      need(
        !s.work.some(
          (w) => w.planId === old.id && ["RESERVED", "DISPATCHED", "ARRIVAL_REPORTED"].includes(w.state)
        ),
        "ACTIVE_PLAN_WORK",
        "Resolve or cancel existing work before replacing its plan."
      );
      old.approved = false;
      s.status = "FACTS_REVIEWED";
    }
    const plan = {
      ...p.replacesPlanId ? { replacesPlanId: p.replacesPlanId } : {},
      id: `plan-${s.plans.length + 1}`,
      revision: s.plans.length + 1,
      transfers: structuredClone(ts),
      digest: digest(ts),
      approved: false,
      observationRefs: s.rooms.map((r) => r.observation.id)
    };
    s.plans.push(plan);
    record(s, "PLAN_PROPOSED", plan, actionId);
    return plan;
  } else if (kind === "approve") {
    const plan = s.plans.find((x) => x.id === p.planId);
    need(plan, "PLAN_NOT_FOUND");
    need(p.digest === plan.digest, "REVISION_MISMATCH");
    need(!s.uncertain, "NEEDS_REVIEW");
    plan.approved = true;
    s.status = "PLAN_APPROVED";
    record(s, "PLAN_APPROVED", { planId: plan.id, digest: plan.digest }, actionId);
  } else if (kind === "reserve") {
    const plan = s.plans.find((x) => x.id === p.planId);
    need(plan?.approved, "APPROVAL_REQUIRED");
    need(p.digest === plan.digest && digest(plan.transfers) === plan.digest, "REVISION_MISMATCH");
    need(!s.work.some((w) => w.planId === plan.id && w.state !== "CANCELLED"), "ALREADY_RESERVED");
    for (const t of plan.transfers) {
      const b = s.batches.find((b2) => b2.id === t.batch);
      const r = room(s, t.destination);
      fresh(s, r);
      fresh(s, room(s, b.origin));
      need(r.observation.healthy, "DESTINATION_WARM");
      need(!room(s, b.origin).observation.healthy, "HEALTHY_NO_ACTION");
      need(r.id !== b.origin, "SAME_DESTINATION");
      need(r.classes.includes(b.class), "INCOMPATIBLE_STOCK");
      const held = s.work.filter((w2) => w2.transfer.batch === b.id && w2.state === "RESERVED").reduce((n, w2) => n + w2.transfer.quantity, 0);
      need((b.locations[b.origin] || 0) - held >= t.quantity, "INSUFFICIENT_STOCK");
      need(
        occupancy(s, r.id) + reserved(s, r.id) + t.quantity * b.slotsPerUnit <= r.capacity,
        "CAPACITY_EXCEEDED"
      );
      need(
        t.quantity * b.slotsPerUnit <= s.vehicles.find((v) => v.id === t.vehicle).slots,
        "VEHICLE_CAPACITY"
      );
      const w = {
        id: `work-${s.work.length + 1}`,
        planId: plan.id,
        transfer: structuredClone(t),
        state: "RESERVED",
        expires: s.clock + 20,
        fence: 1
      };
      s.work.push(w);
      record(s, "RESERVED", w, actionId);
    }
    s.status = "RESERVED";
  } else if (["dispatch", "report", "arrival", "cancel"].includes(kind)) {
    const w = s.work.find((w2) => w2.id === p.workId);
    need(w, "WORK_NOT_FOUND");
    need(p.fence === w.fence, "STALE_WORKER");
    const plan = s.plans.find((x) => x.id === w.planId);
    need(plan.approved && plan.digest === digest(plan.transfers), "REVISION_MISMATCH");
    const b = s.batches.find((b2) => b2.id === w.transfer.batch);
    const dest = room(s, w.transfer.destination);
    if (kind === "cancel") {
      need(w.state === "RESERVED", "CANNOT_RELEASE_IN_TRANSIT");
      w.state = "CANCELLED";
      w.fence++;
      record(s, "CANCELLED", { workId: w.id }, actionId);
    }
    if (kind === "dispatch") {
      need(w.state === "RESERVED", "INVALID_WORK_STATE");
      need(s.clock < w.expires, "RESERVATION_EXPIRED");
      fresh(s, dest);
      fresh(s, room(s, b.origin));
      need(dest.observation.healthy, "DESTINATION_WARM");
      need(s.responders.includes(w.transfer.responder), "RESPONDER_UNAVAILABLE");
      need(
        !s.work.some(
          (x) => ["DISPATCHED", "ARRIVAL_REPORTED"].includes(x.state) && (x.transfer.vehicle === w.transfer.vehicle || x.transfer.responder === w.transfer.responder)
        ),
        "RESOURCE_BUSY"
      );
      need(
        s.clock + s.vehicles.find((v) => v.id === w.transfer.vehicle).duration <= b.deadline,
        "HANDLING_DEADLINE"
      );
      need((b.locations[b.origin] || 0) >= w.transfer.quantity, "INSUFFICIENT_STOCK");
      b.locations[b.origin] -= w.transfer.quantity;
      b.locations[`transit:${w.id}`] = w.transfer.quantity;
      w.state = "DISPATCHED";
      w.departedAt = s.clock;
      s.status = "IN_PROGRESS";
      record(s, "DISPATCHED", { workId: w.id, planDigest: plan.digest, fence: w.fence }, actionId);
    }
    if (kind === "report") {
      need(w.state === "DISPATCHED", "INVALID_WORK_STATE");
      need(p.actor === w.transfer.responder, "ACTOR_MISMATCH");
      w.state = "ARRIVAL_REPORTED";
      w.reportedAt = s.clock;
      record(s, "ARRIVAL_REPORTED", { workId: w.id, actor: p.actor }, actionId);
    }
    if (kind === "arrival") {
      need(w.state === "ARRIVAL_REPORTED", "ARRIVAL_REPORT_REQUIRED");
      need(p.authority === "simulator", "SIMULATOR_AUTHORITY_REQUIRED");
      need(
        s.clock >= w.departedAt + s.vehicles.find((v) => v.id === w.transfer.vehicle).duration,
        "NOT_ARRIVED"
      );
      fresh(s, dest);
      need(dest.observation.healthy, "DESTINATION_WARM_IN_TRANSIT");
      need(s.clock <= b.deadline, "HANDLING_DEADLINE");
      need(b.locations[`transit:${w.id}`] === w.transfer.quantity, "CUSTODY_CONFLICT");
      delete b.locations[`transit:${w.id}`];
      b.locations[dest.id] = (b.locations[dest.id] || 0) + w.transfer.quantity;
      w.state = "ARRIVAL_CONFIRMED";
      w.arrivalReceipt = `sim-${actionId}`;
      record(
        s,
        "ARRIVAL_CONFIRMED",
        {
          workId: w.id,
          authority: "simulator",
          receipt: w.arrivalReceipt,
          quantity: w.transfer.quantity
        },
        actionId
      );
    }
  } else if (kind === "reconcile") {
    need(!s.uncertain, "NEEDS_REVIEW");
    need(
      s.work.every((w) => ["ARRIVAL_CONFIRMED", "CANCELLED"].includes(w.state)),
      "UNRESOLVED_WORK"
    );
    need(
      s.batches.every(
        (b) => Object.entries(b.locations).every(([l, q]) => q === 0 || s.rooms.some((r) => r.id === l))
      ),
      "UNKNOWN_CUSTODY"
    );
    need(
      s.batches.every(
        (b) => Object.entries(b.locations).every(([l, q]) => q === 0 || room(s, l).observation.healthy)
      ),
      "AT_RISK_STOCK"
    );
    need(
      s.batches.every((b) => Object.values(b.locations).reduce((a, b2) => a + b2, 0) === b.quantity),
      "QUANTITY_MISMATCH"
    );
    s.status = "RECONCILED";
    record(
      s,
      "RECONCILED",
      { quantities: Object.fromEntries(s.batches.map((b) => [b.id, b.quantity])) },
      actionId
    );
  } else throw new DomainError("UNKNOWN_ACTION");
  assertInvariants(s);
  return { status: s.status, version: s.version };
}
function assertInvariants(s) {
  for (const r of s.rooms)
    need(occupancy(s, r.id) + reserved(s, r.id) <= r.capacity, "INVARIANT_CAPACITY");
  for (const b of s.batches) {
    need(
      Object.values(b.locations).every((q) => Number.isInteger(q) && q >= 0),
      "INVARIANT_QUANTITY"
    );
    need(
      Object.values(b.locations).reduce((a, b2) => a + b2, 0) === b.quantity,
      "INVARIANT_CONSERVATION"
    );
  }
}
function evidence(initial, final) {
  const artifacts = {
    "initial.json": canonical(initial),
    "events.json": canonical(final.events),
    "final.json": canonical(final),
    "limitations.json": canonical({
      mode: "SYNTHETIC_SIMULATOR",
      model: "UNAVAILABLE",
      physicalValidation: false,
      hashTrust: "Integrity only. A party able to rewrite the complete bundle can recompute hashes."
    })
  };
  return {
    manifest: {
      schema: 1,
      encoding: "UTF-8",
      canonical: "sorted-key compact JSON, integer values, no trailing newline",
      algorithm: "SHA-256",
      files: Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [k, digest(v)]))
    },
    artifacts
  };
}

// cloudflare/store.ts
var kinds = ["facts", "observe", "clock", "plan", "approve", "reserve", "dispatch", "report", "arrival", "cancel", "reconcile"];
var WorkspaceStore = class {
  constructor(storage) {
    this.storage = storage;
    storage.sql.exec("CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), tenant TEXT NOT NULL, expires INTEGER NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, initial TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL, created INTEGER NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, incident TEXT NOT NULL, kind TEXT NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS leases (incident TEXT PRIMARY KEY, fence INTEGER NOT NULL, expires INTEGER NOT NULL)");
  }
  storage;
  rows(q, ...args) {
    return this.storage.sql.exec(q, ...args).toArray();
  }
  initialize(tenant, now = Date.now()) {
    return this.storage.transactionSync(() => {
      need(!this.rows("SELECT id FROM meta").length, "SESSION_ALREADY_CREATED");
      const expiry = now + 7 * 864e5;
      this.storage.sql.exec("INSERT INTO meta VALUES(1,?,?)", tenant, expiry);
      return expiry;
    });
  }
  session(now = Date.now()) {
    const m = this.rows("SELECT tenant,expires FROM meta WHERE id=1")[0];
    need(m && m.expires > now, "SESSION_REQUIRED");
    return m;
  }
  incident(id) {
    const r = this.rows("SELECT initial,state,version FROM incidents WHERE id=?", id)[0];
    need(r, "NOT_FOUND");
    return r;
  }
  count(table) {
    return this.rows(`SELECT count(*) AS n FROM ${table}`)[0].n;
  }
  request(method, path, body = {}) {
    try {
      const data = this.storage.transactionSync(() => this.run(method, path, body));
      return { ok: true, data: JSON.parse(JSON.stringify(data)), status: method === "POST" && path === "/incidents" ? 201 : 200 };
    } catch (e) {
      if (e instanceof DomainError) return { ok: false, code: e.code, detail: e.detail, status: e.code === "SESSION_REQUIRED" ? 401 : e.code === "NOT_FOUND" ? 404 : 409 };
      throw e;
    }
  }
  run(method, path, body) {
    const meta = this.session();
    const parts = path.split("/").filter(Boolean);
    if (method === "GET" && path === "/incidents") return this.rows("SELECT state FROM incidents ORDER BY created").map((r) => JSON.parse(r.state));
    if (method === "POST" && path === "/incidents") {
      need(this.count("incidents") < 100, "DRILL_QUOTA", "This reviewer workspace is limited to 100 synthetic drills.");
      need(typeof body.scenario === "string" && Number.isInteger(body.seed) && Number(body.seed) >= 0 && Number(body.seed) < 1e5, "INVALID_SCENARIO_INPUT");
      const id2 = crypto.randomUUID(), s2 = scenario(id2, meta.tenant, body.scenario, Number(body.seed));
      this.storage.sql.exec("INSERT INTO incidents VALUES(?,?,?,?,?)", id2, JSON.stringify(s2), JSON.stringify(s2), s2.version, Date.now());
      return s2;
    }
    if (method === "POST" && path === "/session/close") {
      this.storage.sql.exec("UPDATE meta SET expires=0 WHERE id=1");
      return { closed: true };
    }
    const id = parts[0] === "incidents" ? parts[1] : body.incidentId;
    need(typeof id === "string", "INCIDENT_REQUIRED");
    const row = this.incident(id);
    const s = JSON.parse(row.state);
    need(s.tenant === meta.tenant, "SCOPE_MISMATCH");
    if (method === "GET" && parts.length === 2 && parts[0] === "incidents") return s;
    if (method === "GET" && parts.length === 3 && parts[2] === "evidence") return evidence(JSON.parse(row.initial), s);
    if (method === "POST" && parts[2] === "actions") {
      need(typeof body.kind === "string" && kinds.includes(body.kind), "UNKNOWN_ACTION");
      need(this.count("tokens") < 15e3, "ACTION_QUOTA");
      const actionId = crypto.randomUUID();
      this.storage.sql.exec("INSERT INTO tokens VALUES(?,?,?)", actionId, id, body.kind);
      return { actionId };
    }
    need(method === "POST", "ROUTE_NOT_FOUND");
    const route = parts.at(-1);
    const kind = parts[0] === "plans" ? { approve: "approve", reserve: "reserve" }[route] : parts[0] === "work-orders" ? { dispatch: "dispatch", "arrival-report": "report", arrival: "arrival", cancel: "cancel" }[route] : { facts: "facts", observations: "observe", clock: "clock", plans: "plan", reconcile: "reconcile" }[route];
    need(kind, "ROUTE_NOT_FOUND");
    need(typeof body.actionId === "string" && Number.isInteger(body.expectedVersion), "ACTION_AND_VERSION_REQUIRED");
    need(body.payload !== null && typeof body.payload === "object" && !Array.isArray(body.payload), "INVALID_PAYLOAD");
    const p = { ...body.payload, ...parts[0] === "plans" ? { planId: parts[1] } : {}, ...parts[0] === "work-orders" ? { workId: parts[1] } : {} };
    need(kind !== "arrival" || !("authority" in p), "SIMULATOR_AUTHORITY_REQUIRED", "Arrival authority is assigned only by the server-side simulator.");
    const token = this.rows("SELECT incident,kind FROM tokens WHERE id=?", body.actionId)[0];
    need(token?.incident === id && token.kind === kind, "INVALID_ACTION_ID");
    const hash = digest({ id, kind, p });
    const previous = this.rows("SELECT hash,result FROM receipts WHERE id=?", body.actionId)[0];
    if (previous) {
      need(previous.hash === hash, "ACTION_PAYLOAD_CONFLICT");
      return JSON.parse(previous.result);
    }
    need(row.version === body.expectedVersion, "VERSION_CONFLICT");
    need(s.events.length < 500, "EVENT_QUOTA");
    if (kind === "arrival") {
      const lease = this.rows("SELECT fence FROM leases WHERE incident=?", id)[0];
      const fence = (lease?.fence || 0) + 1;
      this.storage.sql.exec("INSERT INTO leases VALUES(?,?,?) ON CONFLICT(incident) DO UPDATE SET fence=excluded.fence,expires=excluded.expires", id, fence, Date.now() + 1e4);
      const result2 = transition(s, kind, { ...p, authority: "simulator" }, body.actionId);
      const receipt2 = { actionId: body.actionId, kind, result: result2, version: s.version, workerFence: fence, capturedAt: (/* @__PURE__ */ new Date()).toISOString(), mode: "CLOUDFLARE_SYNTHETIC_SIMULATOR" };
      this.commit(id, s, body.actionId, hash, receipt2);
      return receipt2;
    }
    const result = transition(s, kind, p, body.actionId);
    const receipt = { actionId: body.actionId, kind, result, version: s.version, capturedAt: (/* @__PURE__ */ new Date()).toISOString(), mode: "CLOUDFLARE_SYNTHETIC_SIMULATOR" };
    this.commit(id, s, body.actionId, hash, receipt);
    return receipt;
  }
  commit(id, s, actionId, hash, receipt) {
    this.storage.sql.exec("UPDATE incidents SET state=?,version=? WHERE id=?", JSON.stringify(s), s.version, id);
    this.storage.sql.exec("INSERT INTO receipts VALUES(?,?,?)", actionId, hash, JSON.stringify(receipt));
  }
  expire(now = Date.now()) {
    this.storage.transactionSync(() => {
      const m = this.rows("SELECT expires FROM meta WHERE id=1")[0];
      if (m && m.expires <= now) {
        for (const table of ["incidents", "tokens", "receipts", "leases"]) this.storage.sql.exec(`DELETE FROM ${table}`);
        this.storage.sql.exec("UPDATE meta SET expires=0 WHERE id=1");
      }
    });
  }
};

// cloudflare/worker.ts
var ColdspanWorkspace = class extends DurableObject {
  store;
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new WorkspaceStore(ctx.storage);
  }
  async initialize(tenant) {
    const expiry = this.store.initialize(tenant);
    await this.ctx.storage.setAlarm(expiry);
    return { expiresAt: expiry };
  }
  request(method, path, body) {
    return JSON.stringify(this.store.request(method, path, JSON.parse(body)));
  }
  alarm() {
    this.store.expire();
  }
};
var ColdspanRequestGate = class extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS limits (bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)");
  }
  async allow(bucket, limit) {
    const now = Date.now();
    const allowed = this.ctx.storage.transactionSync(() => {
      const r = this.ctx.storage.sql.exec("SELECT window,count FROM limits WHERE bucket=?", bucket).toArray()[0];
      const window = Math.floor(now / 6e4);
      const count = r?.window === window ? r.count + 1 : 1;
      this.ctx.storage.sql.exec("INSERT INTO limits VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET window=excluded.window,count=excluded.count", bucket, window, count);
      return count <= limit;
    });
    await this.ctx.storage.setAlarm(now + 12e4);
    return allowed;
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
};
function response(data, status = 200, origin) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {} } });
}
async function readBody(request) {
  need(request.headers.get("content-type")?.split(";")[0].trim() === "application/json", "JSON_REQUIRED");
  const reader = request.body?.getReader();
  need(reader, "BODY_REQUIRED");
  let count = 0;
  const chunks = [];
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
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DomainError("INVALID_JSON");
  }
  need(body && typeof body === "object" && !Array.isArray(body), "INVALID_BODY");
  return body;
}
var worker_default = { async fetch(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = origin === env.ALLOWED_ORIGIN ? origin : void 0;
  if (origin && !allowed) return response({ code: "ORIGIN_REJECTED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...allowed ? { "Access-Control-Allow-Origin": allowed, "Vary": "Origin" } : {}, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Coldspan-Intent", "Access-Control-Max-Age": "600" } });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api(?=\/|$)/, "");
  if (request.method === "GET" && path === "/health") return response({ status: "ok", storage: "CLOUDFLARE_DURABLE_OBJECT_SQLITE", mode: "SYNTHETIC_SIMULATOR", model: "UNAVAILABLE", build: env.BUILD_ID }, 200, allowed);
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
    const r = JSON.parse(await workspace.request(request.method, path, JSON.stringify(body)));
    return r.ok ? response(r.data, r.status, allowed) : response({ code: r.code, detail: r.detail }, r.status, allowed);
  } catch (e) {
    if (e instanceof DomainError) return response({ code: e.code, detail: e.detail }, e.code === "SESSION_REQUIRED" ? 401 : e.code === "RATE_LIMITED" ? 429 : 409, allowed);
    console.error(JSON.stringify({ code: "INTERNAL_ERROR", build: env.BUILD_ID }));
    return response({ code: "INTERNAL_ERROR" }, 500, allowed);
  }
} };
export {
  ColdspanRequestGate,
  ColdspanWorkspace,
  worker_default as default
};

