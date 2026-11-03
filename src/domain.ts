import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (x && typeof x === 'object')
    return (
      '{' +
      Object.keys(x)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((x as any)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(x);
}
export const digest = (x: unknown) => bytesToHex(sha256(new TextEncoder().encode(typeof x === 'string' ? x : canonical(x))));
export class DomainError extends Error {
  constructor(
    public code: string,
    public detail: string = code,
  ) {
    super(detail);
  }
}
export function need(ok: unknown, code: string, detail = code): asserts ok {
  if (!ok) throw new DomainError(code, detail);
}
export type Room = {
  id: string;
  name: string;
  capacity: number;
  background: number;
  classes: string[];
  distance: number;
  observation: {
    id: string;
    at: number;
    temp: number;
    healthy: boolean;
    source: 'SYNTHETIC';
    ttl: number;
  };
};
export type Batch = {
  id: string;
  name: string;
  quantity: number;
  unit: 'crate';
  slotsPerUnit: number;
  class: string;
  origin: string;
  deadline: number;
  locations: Record<string, number>;
};
export type Transfer = {
  batch: string;
  quantity: number;
  destination: string;
  responder: string;
  vehicle: string;
};
export type Plan = {
  id: string;
  revision: number;
  transfers: Transfer[];
  digest: string;
  approved: boolean;
  observationRefs: string[];
  replacesPlanId?: string;
};
export type Work = {
  id: string;
  planId: string;
  transfer: Transfer;
  state: 'RESERVED' | 'DISPATCHED' | 'ARRIVAL_REPORTED' | 'ARRIVAL_CONFIRMED' | 'CANCELLED';
  expires: number;
  fence: number;
  departedAt?: number;
  reportedAt?: number;
  arrivalReceipt?: string;
};
export type Event = {
  seq: number;
  priorVersion: number;
  at: number;
  actionId: string;
  kind: string;
  data: any;
  previousHash: string;
  hash: string;
};
export type State = {
  schema: 1;
  id: string;
  tenant: string;
  scenario: string;
  seed: number;
  clock: number;
  version: number;
  status: string;
  notes: string;
  uncertain: boolean;
  rooms: Room[];
  batches: Batch[];
  responders: string[];
  vehicles: { id: string; slots: number; duration: number }[];
  plans: Plan[];
  work: Work[];
  events: Event[];
};
export function scenario(id: string, tenant: string, kind = 'outage', seed = 7): State {
  need(
    [
      'outage',
      'healthy',
      'last-slot',
      'incompatible',
      'no-responder',
      'no-space',
      'stale',
      'uncertain',
    ].includes(kind),
    'UNKNOWN_SCENARIO',
  );
  const rooms: Room[] = [
    ['north', 'North cold room', 18, 0, ['leaf', 'fruit'], 0, false],
    ['east', 'East reserve', 12, 2, ['leaf', 'fruit'], 4, true],
    ['west', 'West reserve', 10, 2, ['fruit'], 8, true],
  ].map((r: any) => ({
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
      source: 'SYNTHETIC',
      ttl: 30,
    },
  }));
  if (kind === 'healthy')
    rooms[0].observation = { ...rooms[0].observation, healthy: true, temp: 40 };
  if (kind === 'last-slot') {
    rooms[1].capacity = 8;
    rooms[2].classes = [];
  }
  if (kind === 'incompatible') {
    rooms[1].classes = ['fruit'];
  }
  if (kind === 'no-space') {
    rooms[1].capacity = 2;
    rooms[2].capacity = 2;
  }
  const batches: Batch[] = [
    {
      id: 'leaf-01',
      name: 'Leafy greens',
      quantity: 6,
      unit: 'crate',
      slotsPerUnit: 1,
      class: 'leaf',
      origin: 'north',
      deadline: 90,
      locations: { north: 6 },
    },
    {
      id: 'fruit-02',
      name: 'Tomatoes',
      quantity: 6,
      unit: 'crate',
      slotsPerUnit: 1,
      class: 'fruit',
      origin: 'north',
      deadline: 120,
      locations: { north: 6 },
    },
  ];
  return {
    schema: 1,
    id,
    tenant,
    scenario: kind,
    seed,
    clock: kind === 'stale' ? 31 : 0,
    version: 0,
    status: 'OPEN',
    notes:
      kind === 'healthy'
        ? 'False alarm drill. Compressor is running and current synthetic room observations are healthy. Six crates of greens. Tomato count looks like 6, confirm the inventory.'
        : 'North compressor stopped. Six crates of greens. Tomato count looks like 6, confirm before moving. East reading from this drill.',
    uncertain: true,
    rooms,
    batches,
    responders: kind === 'no-responder' ? [] : ['Amina', 'Idris'],
    vehicles: [
      { id: 'van-01', slots: 8, duration: 5 },
      { id: 'van-02', slots: 8, duration: 5 },
    ],
    plans: [],
    work: [],
    events: [],
  };
}
export function occupancy(s: State, room: string) {
  return (
    s.rooms.find((r) => r.id === room)!.background +
    s.batches.reduce((n, b) => n + (b.locations[room] || 0) * b.slotsPerUnit, 0)
  );
}
export function reserved(s: State, room: string) {
  return s.work
    .filter(
      (w) =>
        w.transfer.destination === room &&
        ['RESERVED', 'DISPATCHED', 'ARRIVAL_REPORTED'].includes(w.state),
    )
    .reduce(
      (n, w) =>
        n + w.transfer.quantity * s.batches.find((b) => b.id === w.transfer.batch)!.slotsPerUnit,
      0,
    );
}
export function record(s: State, kind: string, data: any, actionId: string) {
  const e: any = {
    seq: s.events.length + 1,
    priorVersion: s.version,
    at: s.clock,
    actionId,
    kind,
    data: structuredClone(data),
    previousHash: s.events.at(-1)?.hash || '0'.repeat(64),
  };
  e.hash = digest(e);
  s.events.push(e);
  s.version++;
}
function room(s: State, id: string) {
  const r = s.rooms.find((r) => r.id === id);
  need(r, 'ROOM_NOT_FOUND');
  return r;
}
function fresh(s: State, r: Room) {
  need(
    s.clock - r.observation.at <= r.observation.ttl && r.observation.at <= s.clock,
    'STALE_OBSERVATION',
    `${r.name} needs a fresh simulated reading.`,
  );
}
export function proposeGreedy(s: State): Transfer[] {
  need(!s.uncertain, 'NEEDS_REVIEW', 'Confirm inventory before generating a plan.');
  const free = Object.fromEntries(
    s.rooms.map((r) => [r.id, r.capacity - occupancy(s, r.id) - reserved(s, r.id)]),
  );
  const transfers: Transfer[] = [];
  for (const b of s.batches) {
    if (room(s, b.origin).observation.healthy) continue;
    let left =
      (b.locations[b.origin] || 0) -
      s.work
        .filter((w) => w.transfer.batch === b.id && w.state === 'RESERVED')
        .reduce((n, w) => n + w.transfer.quantity, 0);
    for (const r of [...s.rooms].sort((a, b) => a.distance - b.distance)) {
      if (left <= 0) break;
      if (
        r.id === b.origin ||
        !r.observation.healthy ||
        !r.classes.includes(b.class) ||
        s.clock - r.observation.at > r.observation.ttl
      )
        continue;
      const qty = Math.min(left, Math.floor(free[r.id] / b.slotsPerUnit));
      if (qty > 0 && s.responders.length && s.vehicles.length) {
        transfers.push({
          batch: b.id,
          quantity: qty,
          destination: r.id,
          responder: s.responders[(transfers.length + s.seed) % s.responders.length],
          vehicle: s.vehicles[(transfers.length + s.seed) % s.vehicles.length].id,
        });
        free[r.id] -= qty * b.slotsPerUnit;
        left -= qty;
      }
    }
  }
  return transfers;
}
export function transition(s: State, kind: string, p: any, actionId: string): any {
  need(s.status !== 'RECONCILED', 'INCIDENT_CLOSED');
  if (kind === 'facts') {
    need(p.confirmed === true, 'NEEDS_REVIEW');
    need(
      p.quantities && s.batches.every((b) => p.quantities[b.id] === b.quantity),
      'INVENTORY_CONFLICT',
      'Counts differ from initial stock. Resolve the source inventory in a new drill.',
    );
    s.uncertain = false;
    s.status = 'FACTS_REVIEWED';
    record(s, 'FACTS_CONFIRMED', { quantities: p.quantities }, actionId);
  } else if (kind === 'observe') {
    const r = room(s, p.room);
    need(Number.isInteger(p.temp) && typeof p.healthy === 'boolean', 'INVALID_OBSERVATION');
    r.observation = {
      id: `obs-${r.id}-${s.version + 1}`,
      at: s.clock,
      temp: p.temp,
      healthy: p.healthy,
      source: 'SYNTHETIC',
      ttl: 30,
    };
    if (
      !p.healthy &&
      s.work.some(
        (w) =>
          w.transfer.destination === r.id && ['DISPATCHED', 'ARRIVAL_REPORTED'].includes(w.state),
      )
    )
      s.status = 'NEEDS_HUMAN';
    record(s, 'OBSERVED', { room: r.id, observation: r.observation }, actionId);
  } else if (kind === 'clock') {
    need(Number.isInteger(p.minutes) && p.minutes > 0 && p.minutes <= 1440, 'INVALID_CLOCK');
    s.clock += p.minutes;
    record(s, 'CLOCK_ADVANCED', { minutes: p.minutes }, actionId);
  } else if (kind === 'plan') {
    need(!s.uncertain, 'NEEDS_REVIEW');
    const ts = p.transfers ?? proposeGreedy(s);
    need(Array.isArray(ts) && ts.length <= 30, 'INVALID_PLAN');
    for (const t of ts) {
      need(
        t && Object.keys(t).sort().join(',') === 'batch,destination,quantity,responder,vehicle',
        'INVALID_TRANSFER',
      );
      need(Number.isInteger(t.quantity) && t.quantity > 0, 'INVALID_QUANTITY');
      need(
        s.batches.some((b) => b.id === t.batch),
        'BATCH_NOT_FOUND',
      );
      room(s, t.destination);
      need(s.responders.includes(t.responder), 'RESPONDER_UNAVAILABLE');
      need(
        s.vehicles.some((v) => v.id === t.vehicle),
        'VEHICLE_UNAVAILABLE',
      );
    }
    if (p.replacesPlanId) {
      const old = s.plans.find((x) => x.id === p.replacesPlanId);
      need(old, 'PLAN_NOT_FOUND');
      need(
        !s.work.some(
          (w) =>
            w.planId === old.id && ['RESERVED', 'DISPATCHED', 'ARRIVAL_REPORTED'].includes(w.state),
        ),
        'ACTIVE_PLAN_WORK',
        'Resolve or cancel existing work before replacing its plan.',
      );
      old.approved = false;
      s.status = 'FACTS_REVIEWED';
    }
    const plan: Plan = {
      ...(p.replacesPlanId ? { replacesPlanId: p.replacesPlanId } : {}),
      id: `plan-${s.plans.length + 1}`,
      revision: s.plans.length + 1,
      transfers: structuredClone(ts),
      digest: digest(ts),
      approved: false,
      observationRefs: s.rooms.map((r) => r.observation.id),
    };
    s.plans.push(plan);
    record(s, 'PLAN_PROPOSED', plan, actionId);
    return plan;
  } else if (kind === 'approve') {
    const plan = s.plans.find((x) => x.id === p.planId);
    need(plan, 'PLAN_NOT_FOUND');
    need(p.digest === plan.digest, 'REVISION_MISMATCH');
    need(!s.uncertain, 'NEEDS_REVIEW');
    plan.approved = true;
    s.status = 'PLAN_APPROVED';
    record(s, 'PLAN_APPROVED', { planId: plan.id, digest: plan.digest }, actionId);
  } else if (kind === 'reserve') {
    const plan = s.plans.find((x) => x.id === p.planId);
    need(plan?.approved, 'APPROVAL_REQUIRED');
    need(p.digest === plan.digest && digest(plan.transfers) === plan.digest, 'REVISION_MISMATCH');
    need(!s.work.some((w) => w.planId === plan.id && w.state !== 'CANCELLED'), 'ALREADY_RESERVED');
    for (const t of plan.transfers) {
      const b = s.batches.find((b) => b.id === t.batch)!;
      const r = room(s, t.destination);
      fresh(s, r);
      fresh(s, room(s, b.origin));
      need(r.observation.healthy, 'DESTINATION_WARM');
      need(!room(s, b.origin).observation.healthy, 'HEALTHY_NO_ACTION');
      need(r.id !== b.origin, 'SAME_DESTINATION');
      need(r.classes.includes(b.class), 'INCOMPATIBLE_STOCK');
      const held = s.work
        .filter((w) => w.transfer.batch === b.id && w.state === 'RESERVED')
        .reduce((n, w) => n + w.transfer.quantity, 0);
      need((b.locations[b.origin] || 0) - held >= t.quantity, 'INSUFFICIENT_STOCK');
      need(
        occupancy(s, r.id) + reserved(s, r.id) + t.quantity * b.slotsPerUnit <= r.capacity,
        'CAPACITY_EXCEEDED',
      );
      need(
        t.quantity * b.slotsPerUnit <= s.vehicles.find((v) => v.id === t.vehicle)!.slots,
        'VEHICLE_CAPACITY',
      );
      const w: Work = {
        id: `work-${s.work.length + 1}`,
        planId: plan.id,
        transfer: structuredClone(t),
        state: 'RESERVED',
        expires: s.clock + 20,
        fence: 1,
      };
      s.work.push(w);
      record(s, 'RESERVED', w, actionId);
    }
    s.status = 'RESERVED';
  } else if (['dispatch', 'report', 'arrival', 'cancel'].includes(kind)) {
    const w = s.work.find((w) => w.id === p.workId);
    need(w, 'WORK_NOT_FOUND');
    need(p.fence === w.fence, 'STALE_WORKER');
    const plan = s.plans.find((x) => x.id === w.planId)!;
    need(plan.approved && plan.digest === digest(plan.transfers), 'REVISION_MISMATCH');
    const b = s.batches.find((b) => b.id === w.transfer.batch)!;
    const dest = room(s, w.transfer.destination);
    if (kind === 'cancel') {
      need(w.state === 'RESERVED', 'CANNOT_RELEASE_IN_TRANSIT');
      w.state = 'CANCELLED';
      w.fence++;
      record(s, 'CANCELLED', { workId: w.id }, actionId);
    }
    if (kind === 'dispatch') {
      need(w.state === 'RESERVED', 'INVALID_WORK_STATE');
      need(s.clock < w.expires, 'RESERVATION_EXPIRED');
      fresh(s, dest);
      fresh(s, room(s, b.origin));
      need(dest.observation.healthy, 'DESTINATION_WARM');
      need(s.responders.includes(w.transfer.responder), 'RESPONDER_UNAVAILABLE');
      need(
        !s.work.some(
          (x) =>
            ['DISPATCHED', 'ARRIVAL_REPORTED'].includes(x.state) &&
            (x.transfer.vehicle === w.transfer.vehicle ||
              x.transfer.responder === w.transfer.responder),
        ),
        'RESOURCE_BUSY',
      );
      need(
        s.clock + s.vehicles.find((v) => v.id === w.transfer.vehicle)!.duration <= b.deadline,
        'HANDLING_DEADLINE',
      );
      need((b.locations[b.origin] || 0) >= w.transfer.quantity, 'INSUFFICIENT_STOCK');
      b.locations[b.origin] -= w.transfer.quantity;
      b.locations[`transit:${w.id}`] = w.transfer.quantity;
      w.state = 'DISPATCHED';
      w.departedAt = s.clock;
      s.status = 'IN_PROGRESS';
      record(s, 'DISPATCHED', { workId: w.id, planDigest: plan.digest, fence: w.fence }, actionId);
    }
    if (kind === 'report') {
      need(w.state === 'DISPATCHED', 'INVALID_WORK_STATE');
      need(p.actor === w.transfer.responder, 'ACTOR_MISMATCH');
      w.state = 'ARRIVAL_REPORTED';
      w.reportedAt = s.clock;
      record(s, 'ARRIVAL_REPORTED', { workId: w.id, actor: p.actor }, actionId);
    }
    if (kind === 'arrival') {
      need(w.state === 'ARRIVAL_REPORTED', 'ARRIVAL_REPORT_REQUIRED');
      need(p.authority === 'simulator', 'SIMULATOR_AUTHORITY_REQUIRED');
      need(
        s.clock >= w.departedAt! + s.vehicles.find((v) => v.id === w.transfer.vehicle)!.duration,
        'NOT_ARRIVED',
      );
      fresh(s, dest);
      need(dest.observation.healthy, 'DESTINATION_WARM_IN_TRANSIT');
      need(s.clock <= b.deadline, 'HANDLING_DEADLINE');
      need(b.locations[`transit:${w.id}`] === w.transfer.quantity, 'CUSTODY_CONFLICT');
      delete b.locations[`transit:${w.id}`];
      b.locations[dest.id] = (b.locations[dest.id] || 0) + w.transfer.quantity;
      w.state = 'ARRIVAL_CONFIRMED';
      w.arrivalReceipt = `sim-${actionId}`;
      record(
        s,
        'ARRIVAL_CONFIRMED',
        {
          workId: w.id,
          authority: 'simulator',
          receipt: w.arrivalReceipt,
          quantity: w.transfer.quantity,
        },
        actionId,
      );
    }
  } else if (kind === 'reconcile') {
    need(!s.uncertain, 'NEEDS_REVIEW');
    need(
      s.work.every((w) => ['ARRIVAL_CONFIRMED', 'CANCELLED'].includes(w.state)),
      'UNRESOLVED_WORK',
    );
    need(
      s.batches.every((b) =>
        Object.entries(b.locations).every(([l, q]) => q === 0 || s.rooms.some((r) => r.id === l)),
      ),
      'UNKNOWN_CUSTODY',
    );
    need(
      s.batches.every((b) =>
        Object.entries(b.locations).every(([l, q]) => q === 0 || room(s, l).observation.healthy),
      ),
      'AT_RISK_STOCK',
    );
    need(
      s.batches.every((b) => Object.values(b.locations).reduce((a, b) => a + b, 0) === b.quantity),
      'QUANTITY_MISMATCH',
    );
    s.status = 'RECONCILED';
    record(
      s,
      'RECONCILED',
      { quantities: Object.fromEntries(s.batches.map((b) => [b.id, b.quantity])) },
      actionId,
    );
  } else throw new DomainError('UNKNOWN_ACTION');
  assertInvariants(s);
  return { status: s.status, version: s.version };
}
export function assertInvariants(s: State) {
  for (const r of s.rooms)
    need(occupancy(s, r.id) + reserved(s, r.id) <= r.capacity, 'INVARIANT_CAPACITY');
  for (const b of s.batches) {
    need(
      Object.values(b.locations).every((q) => Number.isInteger(q) && q >= 0),
      'INVARIANT_QUANTITY',
    );
    need(
      Object.values(b.locations).reduce((a, b) => a + b, 0) === b.quantity,
      'INVARIANT_CONSERVATION',
    );
  }
}
export function evidence(initial: State, final: State) {
  const artifacts: Record<string, string> = {
    'initial.json': canonical(initial),
    'events.json': canonical(final.events),
    'final.json': canonical(final),
    'limitations.json': canonical({
      mode: 'SYNTHETIC_SIMULATOR',
      model: 'UNAVAILABLE',
      physicalValidation: false,
      hashTrust:
        'Integrity only. A party able to rewrite the complete bundle can recompute hashes.',
    }),
  };
  return {
    manifest: {
      schema: 1,
      encoding: 'UTF-8',
      canonical: 'sorted-key compact JSON, integer values, no trailing newline',
      algorithm: 'SHA-256',
      files: Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [k, digest(v)])),
    },
    artifacts,
  };
}
