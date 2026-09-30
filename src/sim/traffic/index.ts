// sim/traffic: cars and trucks both ways (docs/milestones/M1.md, traffic-1).
//
// - Vehicles are movers (kind `vehicle`) that live on the traffic corridor (./corridor.ts): one
//   straight coordinate u along the main road, a corridor direction (+1 toward growing u) and a
//   lane rank per direction. Each tick the mover's road position is written from those.
// - Intelligent-Driver-Model car-following in each lane (./idm.ts). The leader is the nearest
//   vehicle ahead in the lane, a rider in the lane (a stopped rider or a crash makes cars brake),
//   or the corridor's dead end.
// - Population: deterministic, in a window of ±400 m around the sim anchors (the player slots and
//   the event's rivals; the leader is one of them). A vehicle never spawns inside reaction range
//   of an anchor (fastest anchor top speed plus fastest cruise speed, times 2 s: about 125 m at
//   M1 speeds). Vehicles that leave the window are recycled to its front. Rolls come from
//   world.rng.traffic only.
// - Density per direction is a tuning slider, so oncoming traffic can go to zero.
// - Contacts: a first contact with a `normal` vehicle wobbles the rider; a contact while still
//   unstable, or any contact with a `big` one (trucks), crashes the rider (a `crash` event for
//   tumble-1). A close pass with no contact fires `nearMiss`.
// Every number below is a [default] starting value, to be tuned on the phone.
import { clamp, nextFloat, type TuningParamDecl } from '../../core';
import type { SimConfig, SimTrafficTypeDef } from '../types';
import { addMover, emit, systemState, type Mover, type SimSystem, type World } from '../world';
import { buildCorridor, fromCorridor, lanesAt, linkOf, toCorridor, type Corridor } from './corridor';
import { idmAccel } from './idm';

export { buildCorridor, pickLink, toCorridor, trafficMayEnter } from './corridor';
export type { Corridor } from './corridor';
export { IDM, idmAccel } from './idm';

export const TRAFFIC_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'traffic.densitySame',
    group: 'traffic',
    label: 'Traffic, your way',
    default: 1,
    min: 0,
    max: 3,
    step: 0.1,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'traffic.densityOncoming',
    group: 'traffic',
    label: 'Oncoming traffic',
    default: 1,
    min: 0,
    max: 3,
    step: 0.1,
    unit: '×',
    affectsSim: true,
  },
];

/** [default] starting values (docs/milestones/M1.md, "Starting numbers", and this lane). */
export const TRAFFIC = {
  /** Population window around each sim anchor, m. */
  windowM: 400,
  /** Extra distance past the window before a vehicle is recycled, m. */
  despawnMarginM: 50,
  /** One vehicle per this many metres of lane at density 1. */
  baseSpacingM: 120,
  /** The fairness rule: vehicles spawn only beyond closing speed × this. */
  reactionS: 2,
  /** Cap on live vehicles per direction. */
  maxPerDirection: 14,
  /** New vehicles added per direction per population pass. */
  maxAddsPerPass: 2,
  populateEveryTicks: 10,
  /** How far ahead car-following looks, m (the threat draw distance). */
  lookaheadM: 200,
  /** Minimum bumper gap at spawn, m. */
  spawnGapM: 40,
  /** Spawns keep this far from the corridor's ends, m. */
  endMarginM: 12,
  /** Candidate spawn slots are this far apart, m. */
  slotStepM: 20,
  /** Rare seeded lane changes: chance per second, where a second lane exists. */
  laneChangePerS: 0.02,
  laneChangeMps: 1.5,
  laneChangeClearM: 12,
  laneChangeCooldownS: 8,
  /** The rider's contact box. */
  riderLengthM: 2.0,
  riderWidthM: 0.8,
  /** Speed kept after a wobble, and after a crash. */
  wobbleScrub: 0.6,
  crashScrub: 0.3,
  wobbleKickRad: 0.25,
  /** How long a wobble leaves the rider unstable (scaled time), s. */
  unstableS: 1.5,
  /** A pass this close (side to side, box to box) with no contact is a near miss, m. */
  nearMissM: 1.0,
  nearMissMinMps: 8,
  /** Riders higher than this above the road pass over traffic, m. */
  maxContactH: 1.2,
};

/** Category defaults until the region's mix weights reach SimConfig (see the lane report). */
const CATEGORY: Readonly<Record<string, { weight: number; laneChanges: boolean } | undefined>> = {
  car: { weight: 5, laneChanges: true },
  truck: { weight: 2, laneChanges: false },
  rv: { weight: 1.5, laneChanges: false },
  oddity: { weight: 0.5, laneChanges: false },
};

/** Traffic's plain state. Per-vehicle arrays are indexed by vehicle slot; per-rider by entity id. */
export interface TrafficState {
  corridor: Corridor;
  /** Indices into config.trafficTypes of the road vehicles traffic spawns. */
  types: number[];
  /** Reaction range, m. */
  reactionM: number;
  id: number[];
  type: number[];
  u: number[];
  cd: number[];
  /** Corridor direction, +1 or -1. */
  dir: number[];
  rank: number[];
  /** Personal cruise speed, m/s. */
  v0: number[];
  spawnTick: number[];
  /** Where the vehicle last (re)spawned, u. */
  spawnU: number[];
  /** 1 when the slider dropped the target: the vehicle drives on but is not recycled. */
  retired: number[];
  laneCooldownS: number[];
  /** Vehicle entity id each rider is touching, or -1. */
  contactWith: number[];
  unstableS: number[];
  /** Per rider, per vehicle slot: the vehicle's position ahead of the rider last tick (0 = unknown). */
  lastRel: number[][];
  spawns: number;
  recycles: number;
}

export function trafficState(world: World): TrafficState {
  return systemState<TrafficState>(world, 'traffic', () => ({
    corridor: { edges: [], o: [], off: [], len: [], length: 0, routeDir: 1 },
    types: [],
    reactionM: 0,
    id: [],
    type: [],
    u: [],
    cd: [],
    dir: [],
    rank: [],
    v0: [],
    spawnTick: [],
    spawnU: [],
    retired: [],
    laneCooldownS: [],
    contactWith: [],
    unstableS: [],
    lastRel: [],
    spawns: 0,
    recycles: 0,
  }));
}

/** What render and the snapshot need to know about a vehicle entity, or null for other kinds. */
export function vehicleInfo(
  world: World,
  config: SimConfig,
  entityId: number,
): { contentId: string; lengthM: number; widthM: number; hazard: 'normal' | 'big' } | null {
  const st = trafficState(world);
  const k = st.id.indexOf(entityId);
  const t = k < 0 ? undefined : config.trafficTypes[st.type[k] ?? -1];
  return t ? { contentId: t.contentId, lengthM: t.lengthM, widthM: t.widthM, hazard: t.hazard } : null;
}

// ---- helpers -----------------------------------------------------------------------------

function typeOf(config: SimConfig, st: TrafficState, k: number): SimTrafficTypeDef {
  const t = config.trafficTypes[st.type[k] ?? -1];
  if (!t) throw new Error(`traffic: vehicle slot ${k} has no type`);
  return t;
}

function isAnchor(config: SimConfig, m: Mover): boolean {
  const role = config.riders[m.riderIndex]?.role;
  return m.kind === 'rider' && (role === 'player' || role === 'rival');
}

/** Corridor u of every sim anchor on the corridor. */
function anchorUs(world: World, config: SimConfig, st: TrafficState): number[] {
  const out: number[] = [];
  for (const m of world.movers) {
    if (!isAnchor(config, m)) continue;
    const p = toCorridor(st.corridor, m.pos);
    if (p) out.push(p.u);
  }
  return out;
}

function nearestAnchor(anchors: readonly number[], u: number): number {
  let best = Infinity;
  for (const a of anchors) best = Math.min(best, Math.abs(u - a));
  return best;
}

/** Length of the union of the anchor windows, inside the corridor's spawnable span. */
function windowLength(anchors: readonly number[], c: Corridor): number {
  const lo = TRAFFIC.endMarginM;
  const hi = c.length - TRAFFIC.endMarginM;
  const spans = anchors
    .map((a) => [Math.max(lo, a - TRAFFIC.windowM), Math.min(hi, a + TRAFFIC.windowM)] as const)
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  let total = 0;
  let curA = -Infinity;
  let curB = -Infinity;
  for (const [a, b] of spans) {
    if (a > curB) {
      if (curB > curA) total += curB - curA;
      curA = a;
      curB = b;
    } else if (b > curB) {
      curB = b;
    }
  }
  if (curB > curA) total += curB - curA;
  return total;
}

function densityFor(world: World, st: TrafficState, dir: number): number {
  const id = dir === st.corridor.routeDir ? 'traffic.densitySame' : 'traffic.densityOncoming';
  return clamp(world.params[id] ?? 1, 0, 10);
}

function targetCount(world: World, st: TrafficState, anchors: readonly number[], dir: number): number {
  const k = densityFor(world, st, dir);
  if (k <= 0) return 0;
  const n = Math.floor((windowLength(anchors, st.corridor) * k) / TRAFFIC.baseSpacingM);
  return Math.min(TRAFFIC.maxPerDirection, n);
}

function rollType(world: World, config: SimConfig, st: TrafficState): number {
  let total = 0;
  for (const i of st.types) total += CATEGORY[config.trafficTypes[i]?.category ?? '']?.weight ?? 0;
  let r = nextFloat(world.rng.traffic) * total;
  for (const i of st.types) {
    r -= CATEGORY[config.trafficTypes[i]?.category ?? '']?.weight ?? 0;
    if (r < 0) return i;
  }
  return st.types[st.types.length - 1] ?? 0;
}

/** Whether a vehicle of `length` fits at u in lane (dir, rank) with `gap` metres of bumper room. */
function laneClear(
  config: SimConfig,
  st: TrafficState,
  u: number,
  dir: number,
  rank: number,
  length: number,
  gap: number,
  skip = -1,
): boolean {
  for (let k = 0; k < st.id.length; k++) {
    if (k === skip || st.dir[k] !== dir || st.rank[k] !== rank) continue;
    const need = (length + typeOf(config, st, k).lengthM) / 2 + gap;
    if (Math.abs((st.u[k] ?? 0) - u) < need) return false;
  }
  return true;
}

/** The fairness rule, as one predicate: a spawn at u is allowed only beyond reaction range. */
export function spawnAllowed(anchors: readonly number[], u: number, reactionM: number): boolean {
  return nearestAnchor(anchors, u) >= reactionM;
}

/**
 * Puts vehicle slot `k` (new when k = -1) of type `type` at (u, dir, rank). Used by population
 * and by scripted scenarios; the fairness rule is checked by the caller.
 */
export function placeVehicle(
  world: World,
  config: SimConfig,
  spec: { type: number; u: number; dir: 1 | -1; rank?: number; v0?: number; speed?: number },
  k = -1,
): number {
  const st = trafficState(world);
  const t = config.trafficTypes[spec.type];
  if (!t) throw new Error(`traffic: no traffic type ${spec.type}`);
  const lanes = lanesAt(config.road, st.corridor, spec.u, spec.dir);
  const rank = Math.min(spec.rank ?? 0, Math.max(0, lanes.length - 1));
  const cd = lanes[rank]?.cd ?? 0;
  let slot = k;
  if (slot < 0) {
    const mover = addMover(world, 'vehicle', { edge: 0, s: 0, d: 0, dir: 1 });
    slot = st.id.length;
    st.id.push(mover.id);
    for (const rel of st.lastRel) rel?.push(0);
  } else {
    for (const rel of st.lastRel) if (rel) rel[slot] = 0;
  }
  const v0 = spec.v0 ?? t.cruiseMps;
  st.type[slot] = spec.type;
  st.u[slot] = spec.u;
  st.cd[slot] = cd;
  st.dir[slot] = spec.dir;
  st.rank[slot] = rank;
  st.v0[slot] = v0;
  st.spawnTick[slot] = world.tick;
  st.spawnU[slot] = spec.u;
  st.retired[slot] = 0;
  st.laneCooldownS[slot] = TRAFFIC.laneChangeCooldownS;
  const mover = world.movers[st.id[slot] ?? -1];
  if (mover) {
    mover.mode = 'Road';
    mover.speed = spec.speed ?? v0;
    mover.h = 0;
    mover.yaw = 0;
    fromCorridor(st.corridor, spec.u, cd, spec.dir, mover.pos);
  }
  // Forget any contact with the slot's previous self.
  for (let r = 0; r < st.contactWith.length; r++)
    if (st.contactWith[r] === st.id[slot]) st.contactWith[r] = -1;
  return slot;
}

/**
 * Tries to (re)spawn a vehicle heading `dir`: candidate slots from the front of the anchors'
 * windows backward, each checked against the corridor ends, the fairness rule and lane room.
 */
function trySpawn(
  world: World,
  config: SimConfig,
  st: TrafficState,
  anchors: readonly number[],
  dir: 1 | -1,
  k: number,
): boolean {
  const c = st.corridor;
  const type = rollType(world, config, st);
  const t = config.trafficTypes[type];
  if (!t) return false;
  const v0 = t.cruiseMps * (0.9 + 0.2 * nextFloat(world.rng.traffic));
  const jitter = nextFloat(world.rng.traffic) * TRAFFIC.slotStepM;
  const laneRoll = nextFloat(world.rng.traffic);
  const spacing = TRAFFIC.baseSpacingM / Math.max(0.1, densityFor(world, st, dir));
  const gap = Math.max(TRAFFIC.spawnGapM, 0.6 * spacing);
  // "Ahead" follows the route's direction; the window's front is ahead of the leading anchor.
  const rd = c.routeDir;
  let front = -Infinity;
  let back = Infinity;
  for (const a of anchors) {
    front = Math.max(front, rd * a);
    back = Math.min(back, rd * a);
  }
  for (
    let ahead = front + TRAFFIC.windowM - jitter;
    ahead >= back - TRAFFIC.windowM;
    ahead -= TRAFFIC.slotStepM
  ) {
    const u = rd * ahead;
    if (u < TRAFFIC.endMarginM || u > c.length - TRAFFIC.endMarginM) continue;
    if (nearestAnchor(anchors, u) > TRAFFIC.windowM) continue;
    if (!spawnAllowed(anchors, u, st.reactionM)) continue;
    const lanes = lanesAt(config.road, c, u, dir);
    if (lanes.length === 0) continue;
    const rank = Math.min(lanes.length - 1, Math.floor(laneRoll * lanes.length));
    if (!laneClear(config, st, u, dir, rank, t.lengthM, gap, k)) continue;
    const slot = placeVehicle(world, config, { type, u, dir, rank, v0 }, k);
    st.spawns++;
    if (k >= 0) st.recycles++;
    return slot >= 0;
  }
  return false;
}

function atCorridorEnd(st: TrafficState, k: number): boolean {
  const u = st.u[k] ?? 0;
  const end = (st.dir[k] ?? 1) === 1 ? st.corridor.length : 0;
  return Math.abs(end - u) < 6;
}

/** Recycles vehicles that left the window, retires extras, and tops each direction up. */
function populate(world: World, config: SimConfig, st: TrafficState): void {
  const anchors = anchorUs(world, config, st);
  if (anchors.length === 0 || st.types.length === 0) return;
  const limit = TRAFFIC.windowM + TRAFFIC.despawnMarginM;
  const gone = (k: number) => nearestAnchor(anchors, st.u[k] ?? 0) > limit || atCorridorEnd(st, k);
  for (const dir of [1, -1] as const) {
    const target = targetCount(world, st, anchors, dir);
    let active = 0;
    for (let k = 0; k < st.id.length; k++) if (st.dir[k] === dir && st.retired[k] === 0) active++;
    let excess = active - target;
    for (let k = 0; k < st.id.length; k++) {
      if (st.dir[k] !== dir || st.retired[k] !== 0 || !gone(k)) continue;
      if (excess > 0) {
        st.retired[k] = 1;
        excess--;
        active--;
      } else {
        trySpawn(world, config, st, anchors, dir, k);
      }
    }
    // Top up: reuse a retired vehicle that is out of sight first, then add new ones.
    let adds = 0;
    for (let k = 0; k < st.id.length && active < target; k++) {
      if (st.retired[k] !== 1 || !gone(k)) continue;
      if (!trySpawn(world, config, st, anchors, dir, k)) break;
      active++;
    }
    while (active < target && adds < TRAFFIC.maxAddsPerPass) {
      if (!trySpawn(world, config, st, anchors, dir, -1)) break;
      active++;
      adds++;
    }
  }
}

/** Rare seeded lane changes, where the vehicle's direction has a second lane with room. */
function laneChanges(world: World, config: SimConfig, st: TrafficState, dt: number): void {
  const chance = TRAFFIC.laneChangePerS * dt;
  for (let k = 0; k < st.id.length; k++) {
    st.laneCooldownS[k] = Math.max(0, (st.laneCooldownS[k] ?? 0) - dt);
    const t = typeOf(config, st, k);
    if (!CATEGORY[t.category]?.laneChanges || (st.laneCooldownS[k] ?? 0) > 0) continue;
    const dir = st.dir[k] ?? 1;
    const lanes = lanesAt(config.road, st.corridor, st.u[k] ?? 0, dir);
    if (lanes.length < 2) continue;
    if (nextFloat(world.rng.traffic) >= chance) continue;
    const rank = st.rank[k] ?? 0;
    const to =
      rank === 0
        ? 1
        : rank === lanes.length - 1
          ? rank - 1
          : nextFloat(world.rng.traffic) < 0.5
            ? rank - 1
            : rank + 1;
    if (!laneClear(config, st, st.u[k] ?? 0, dir, to, t.lengthM, TRAFFIC.laneChangeClearM, k)) continue;
    st.rank[k] = to;
    st.laneCooldownS[k] = TRAFFIC.laneChangeCooldownS;
  }
}

interface RiderView {
  id: number;
  u: number;
  cd: number;
  dir: number;
  speed: number;
  /** 1 when it can touch traffic (on the road, not flying). */
  touchable: boolean;
}

function riderViews(world: World, st: TrafficState): RiderView[] {
  const out: RiderView[] = [];
  for (const m of world.movers) {
    if (m.kind !== 'rider' || m.h > TRAFFIC.maxContactH) continue;
    const p = toCorridor(st.corridor, m.pos);
    if (!p) continue;
    out.push({ id: m.id, u: p.u, cd: p.cd, dir: p.dir, speed: m.speed, touchable: m.mode === 'Road' });
  }
  return out;
}

/** Car-following, then the no-overlap guarantee, then lane-keeping and the mover sync. */
function move(
  world: World,
  config: SimConfig,
  st: TrafficState,
  riders: readonly RiderView[],
  dt: number,
): void {
  const n = st.id.length;
  const c = st.corridor;
  const speeds = st.id.map((id) => world.movers[id]?.speed ?? 0);
  const accel: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = typeOf(config, st, k);
    const dir = st.dir[k] ?? 1;
    const u = st.u[k] ?? 0;
    const cd = st.cd[k] ?? 0;
    let gap = Infinity;
    let vLead = 0;
    const consider = (g: number, v: number) => {
      if (g < gap && g < TRAFFIC.lookaheadM) {
        gap = g;
        vLead = v;
      }
    };
    for (let j = 0; j < n; j++) {
      if (j === k || st.dir[j] !== dir) continue;
      const tj = typeOf(config, st, j);
      const sameLane =
        st.rank[j] === st.rank[k] || Math.abs((st.cd[j] ?? 0) - cd) < (t.widthM + tj.widthM) / 2;
      const ahead = dir * ((st.u[j] ?? 0) - u);
      if (!sameLane || ahead <= 0) continue;
      consider(ahead - (t.lengthM + tj.lengthM) / 2, speeds[j] ?? 0);
    }
    for (const r of riders) {
      if (Math.abs(r.cd - cd) >= (t.widthM + TRAFFIC.riderWidthM) / 2 + 0.3) continue;
      const ahead = dir * (r.u - u);
      if (ahead <= 0) continue;
      const along = r.touchable ? (r.dir === dir ? r.speed : -r.speed) : 0;
      if (along < -1) continue; // riding head-on at it: the car does not dodge, the rider must.
      consider(ahead - (t.lengthM + TRAFFIC.riderLengthM) / 2, Math.max(0, along));
    }
    // The dead end of the corridor is a stopped obstacle.
    consider(dir * ((dir === 1 ? c.length : 0) - u) - t.lengthM / 2, 0);
    accel.push(idmAccel(speeds[k] ?? 0, st.v0[k] ?? 0, gap, vLead));
  }
  const nextV: number[] = [];
  for (let k = 0; k < n; k++) {
    const v = Math.max(0, (speeds[k] ?? 0) + (accel[k] ?? 0) * dt);
    nextV.push(v);
    st.u[k] = (st.u[k] ?? 0) + (st.dir[k] ?? 1) * v * dt;
  }
  // No two vehicles ever overlap in a lane: walk each lane front to back.
  const order = st.id.map((_id, k) => k);
  order.sort(
    (a, b) =>
      (st.dir[a] ?? 0) - (st.dir[b] ?? 0) ||
      (st.rank[a] ?? 0) - (st.rank[b] ?? 0) ||
      (st.dir[a] ?? 1) * ((st.u[b] ?? 0) - (st.u[a] ?? 0)) ||
      a - b,
  );
  for (let i = 1; i < order.length; i++) {
    const f = order[i - 1] ?? 0;
    const b = order[i] ?? 0;
    if (st.dir[f] !== st.dir[b] || st.rank[f] !== st.rank[b]) continue;
    const dir = st.dir[b] ?? 1;
    const room = (typeOf(config, st, f).lengthM + typeOf(config, st, b).lengthM) / 2 + 0.3;
    if (dir * ((st.u[f] ?? 0) - (st.u[b] ?? 0)) < room) {
      st.u[b] = (st.u[f] ?? 0) - dir * room;
      nextV[b] = Math.min(nextV[b] ?? 0, nextV[f] ?? 0);
    }
  }
  for (let k = 0; k < n; k++) {
    const dir = st.dir[k] ?? 1;
    let u = st.u[k] ?? 0;
    if (u < 0 || u > c.length) {
      u = clamp(u, 0, c.length);
      nextV[k] = 0;
    }
    st.u[k] = u;
    const lanes = lanesAt(config.road, c, u, dir);
    const target = lanes[Math.min(st.rank[k] ?? 0, lanes.length - 1)]?.cd ?? st.cd[k] ?? 0;
    const cd = st.cd[k] ?? 0;
    const step = TRAFFIC.laneChangeMps * dt;
    const nextCd = cd + clamp(target - cd, -step, step);
    st.cd[k] = nextCd;
    const mover = world.movers[st.id[k] ?? -1];
    if (!mover) continue;
    const v = nextV[k] ?? 0;
    mover.speed = v;
    mover.mode = 'Road';
    mover.h = 0;
    mover.yaw = dt > 0 ? clamp((((nextCd - cd) / dt) * dir) / Math.max(v, 3), -0.3, 0.3) : 0;
    fromCorridor(c, u, nextCd, dir, mover.pos);
  }
}

/** Writes a rider's corridor position back to its road position, inside the drivable width. */
function putRider(world: World, config: SimConfig, st: TrafficState, r: RiderView): boolean {
  const m = world.movers[r.id];
  if (!m) return false;
  const i = linkOf(st.corridor, m.pos.edge);
  const edge = config.road.edges[m.pos.edge];
  const o = st.corridor.o[i] ?? 1;
  let lo = (edge?.dMin ?? -5) + 0.5;
  let hi = (edge?.dMax ?? 5) - 0.5;
  if (o === -1) [lo, hi] = [-hi, -lo];
  const cd = clamp(r.cd, lo, hi);
  const pinned = cd !== r.cd;
  fromCorridor(st.corridor, r.u, cd, r.dir, m.pos);
  r.cd = cd;
  return !pinned;
}

/** Wobbles, crashes and near misses between riders and vehicles. */
function contacts(world: World, config: SimConfig, st: TrafficState, riders: RiderView[], dt: number): void {
  const T = TRAFFIC;
  for (const r of riders) {
    st.unstableS[r.id] = Math.max(0, (st.unstableS[r.id] ?? 0) - dt);
    st.lastRel[r.id] ??= st.id.map(() => 0);
    const rel = st.lastRel[r.id] ?? [];
    const m = world.movers[r.id];
    if (!m) continue;
    for (let k = 0; k < st.id.length; k++) {
      const vid = st.id[k] ?? -1;
      const t = typeOf(config, st, k);
      const du = (st.u[k] ?? 0) - r.u;
      const dcd = (st.cd[k] ?? 0) - r.cd;
      const overU = (t.lengthM + T.riderLengthM) / 2 - Math.abs(du);
      const overD = (t.widthM + T.riderWidthM) / 2 - Math.abs(dcd);
      const ahead = r.dir * du;
      const prev = rel[k] ?? 0;
      rel[k] = ahead === 0 ? -1e-9 : ahead;
      if (!r.touchable) continue;
      if (st.contactWith[r.id] === vid && (overU < -1 || overD < -0.5)) st.contactWith[r.id] = -1;
      if (overU > 0 && overD > 0) {
        if (st.contactWith[r.id] !== vid) {
          st.contactWith[r.id] = vid;
          const crash = t.hazard === 'big' || (st.unstableS[r.id] ?? 0) > 0;
          const data = {
            cause: 'traffic',
            hazard: t.hazard,
            vehicle: t.contentId,
            contact: crash ? 'crash' : 'wobble',
          };
          if (crash) {
            m.speed *= T.crashScrub;
            emit(world, 'crash', r.id, data, { target: vid });
          } else {
            m.speed *= T.wobbleScrub;
            const away = dcd > 0 ? -1 : 1;
            m.yaw = clamp(m.yaw + away * r.dir * T.wobbleKickRad, -1.2, 1.2);
            st.unstableS[r.id] = T.unstableS;
          }
        }
        // Push the rider out of the vehicle's box: sideways for a head-on or a side swipe,
        // backward (and down to its speed) for a rear-end.
        const vDir = st.dir[k] ?? 1;
        const lateral = vDir !== r.dir || overD < overU;
        let resolved = false;
        if (lateral) {
          r.cd += (dcd > 0 ? -1 : 1) * (overD + 0.02);
          resolved = putRider(world, config, st, r);
        }
        if (!resolved) {
          r.u -= (du > 0 ? 1 : -1) * (overU + 0.02);
          putRider(world, config, st, r);
          // Into its tail: slow to its speed. Hit from behind: shoved up to its speed.
          const vSpeed = world.movers[vid]?.speed ?? 0;
          if (vDir === r.dir) m.speed = du > 0 ? Math.min(m.speed, vSpeed) : Math.max(m.speed, vSpeed);
        }
        config.road.advance(m.pos);
        rel[k] = r.dir * ((st.u[k] ?? 0) - r.u) || -1e-9;
        continue;
      }
      // Near miss: the rider passed the vehicle (it went from ahead to behind) close, untouched.
      if (
        prev > 0 &&
        ahead <= 0 &&
        prev < 20 &&
        ahead > -20 &&
        st.contactWith[r.id] !== vid &&
        m.speed >= T.nearMissMinMps
      ) {
        const clearance = -overD;
        if (clearance > 0 && clearance <= T.nearMissM) {
          emit(
            world,
            'nearMiss',
            r.id,
            { clearanceM: clearance, oncoming: (st.dir[k] ?? 1) !== r.dir, vehicle: t.contentId },
            { target: vid },
          );
        }
      }
    }
  }
}

export const trafficSystem: SimSystem = {
  name: 'traffic',
  init(world: World, config: SimConfig) {
    const st = trafficState(world);
    st.corridor = buildCorridor(config);
    st.types = config.trafficTypes.flatMap((t, i) => (CATEGORY[t.category] ? [i] : []));
    let topSpeed = 0;
    for (const m of world.movers) {
      if (isAnchor(config, m))
        topSpeed = Math.max(topSpeed, config.riders[m.riderIndex]?.bike.topSpeedMps ?? 0);
    }
    let cruise = 0;
    for (const i of st.types) cruise = Math.max(cruise, config.trafficTypes[i]?.cruiseMps ?? 0);
    st.reactionM = (topSpeed + cruise) * TRAFFIC.reactionS;
    for (const m of world.movers) {
      if (m.kind !== 'rider') continue;
      st.contactWith[m.id] = -1;
      st.unstableS[m.id] = 0;
      st.lastRel[m.id] = [];
    }
    // The first fill: every direction up to its target, from the front of the windows back.
    for (let pass = 0; pass < TRAFFIC.maxPerDirection; pass++) populate(world, config, st);
  },
  step(world: World, config: SimConfig) {
    const st = trafficState(world);
    if (st.types.length === 0 && st.id.length === 0) return;
    const dt = world.timeScale / 60;
    if (world.tick % TRAFFIC.populateEveryTicks === 0) populate(world, config, st);
    laneChanges(world, config, st, dt);
    move(world, config, st, riderViews(world, st), dt);
    contacts(world, config, st, riderViews(world, st), dt);
  },
};
