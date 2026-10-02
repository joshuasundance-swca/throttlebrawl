// sim/traffic: cars and trucks both ways (docs/milestones/M1.md, traffic-1).
//
// - Vehicles are movers (kind `vehicle`) that live on the traffic corridor (./corridor.ts): one
//   straight coordinate u along the main road, a corridor direction (+1 toward growing u) and a
//   lane rank per direction. Each tick the mover's road position is written from those.
// - Intelligent-Driver-Model car-following in each lane (./idm.ts). The leader is the nearest
//   vehicle ahead in the lane, or a rider in the lane (a stopped rider or a crash makes cars
//   brake). The traffic road ends at the finish line (or at the last road traffic may use). A
//   vehicle that drives off its end is recycled into a window, or parked far outside every
//   window, so it never waits at the end as a wall, nor queues behind riders parked past the line.
// - Population: deterministic, in a window of ±400 m around the sim anchors (the player slots and
//   the event's rivals; the leader is one of them). A vehicle never spawns inside reaction range
//   of an anchor (fastest anchor top speed plus fastest cruise speed, times 2 s: about 125 m at
//   M1 speeds). Vehicles that leave the window are recycled to its front. Rolls come from
//   world.rng.traffic only.
// - Density per direction is a tuning slider, so oncoming traffic can go to zero; oncoming density
//   can also ease in over the start of a race (M2 traffic-3, off by default). The region's
//   `traffic.mix` weights pick the vehicle types (SimTrafficTypeDef.weight).
// - Contacts (playtest 1): a solid frontal or rear hit crashes the rider inelastically; a side
//   brush, a graze or a slow nudge wobbles (a `wobble` event), unless the rider is still unstable
//   or the vehicle is `big` (trucks), which crashes (a `crash` event for the tumble). Both carry
//   data.cause `traffic`, `hit` and `impactMps`, and target the vehicle. A close, fast pass with no
//   contact fires `nearMiss`. The full rule is on contacts() below.
// - Wasteland oddities (M3 traffic-4) are ordinary entries with category `oddity`, picked by the
//   same region weights (scaled by the `traffic.oddities` slider) and spawned under the same
//   fairness rule. A rolling one (a mobile home with no truck) is a slow vehicle that comes only
//   the other way (see rollWeight). A PARKED one
//   (cruiseMps 0: a boat left in the fast lane) stands still in the innermost lane, nudged
//   TRAFFIC.parkOutM toward the shoulder; vehicles behind it change lanes past it where their
//   direction has a second lane, and otherwise edge inward around it (TRAFFIC.swerve*), so it
//   never turns into a jam. It is never pushed by the no-overlap pass.
// - Regional behaviours (W-P, "fill the world", 2026-10-01), from the type's `behaviour` flags:
//   - `kerb`: a bicycle, e-bike, scooter or golf cart rides at the kerb: the middle of its
//     direction's shoulder where the shoulder is wide enough, else the outer edge of the outermost
//     lane (kerbCd). Vehicles behind it follow it only while their boxes would overlap side to
//     side, and then edge round it (or change lanes) the way they pass a parked oddity, so it
//     never jams the road. It never changes lanes.
//   - `weaveM`: a seeded side-to-side weave as it rides (e-scooters), inside the drivable road.
//   - `convoy`: it spawns as a convoy of 2 to N of its kind, nose to tail at the car-following
//     gap and the same cruise speed (an RV convoy), each one under the fairness rule.
//   - `laneChanges` overrides the category's default (a robotaxi never changes lanes).
// Every number below is a [default] starting value, to be tuned on the phone.
import { clamp, nextFloat, sin, TAU, type TuningParamDecl } from '../../core';
import type { SimConfig, SimTrafficTypeDef } from '../types';
import { addMover, emit, systemState, type Mover, type SimSystem, type World } from '../world';
import { buildCorridor, fromCorridor, lanesAt, linkAt, linkOf, toCorridor, type Corridor } from './corridor';
import { IDM, idmAccel } from './idm';

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
  {
    // M2 traffic-3: 0 is off. Playtest 1 found nothing unfair, so it ships off. [default]
    id: 'traffic.oncomingEaseInS',
    group: 'traffic',
    label: 'Oncoming ease-in',
    default: 0,
    min: 0,
    max: 120,
    step: 5,
    unit: 's',
    affectsSim: true,
  },
  {
    // M2 traffic-3: a pass slower than this is not a near miss (no farming parked cars). [default]
    id: 'traffic.nearMissClosingMps',
    group: 'traffic',
    label: 'Near miss: closing speed',
    default: 12,
    min: 0,
    max: 40,
    step: 1,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // M3 traffic-4 (head start): a scale on every `oddity` type's region weight; 0 turns the
    // parked boats and runaway mobile homes off. [default]
    id: 'traffic.oddities',
    group: 'traffic',
    label: 'Wasteland oddities',
    default: 1,
    min: 0,
    max: 5,
    step: 0.1,
    unit: '×',
    affectsSim: true,
  },
  {
    // Playtest 1: a frontal or rear hit at least this fast throws the rider off. [default]
    id: 'traffic.solidHitMps',
    group: 'traffic',
    label: 'Car hit: wipeout speed',
    default: 6,
    min: 0,
    max: 40,
    step: 0.5,
    unit: 'm/s',
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
  /** The rider must be moving at least this fast too, so standing by the road never scores. */
  nearMissMinMps: 8,
  /** Fallback for the `traffic.nearMissClosingMps` slider: the least closing speed of a near miss. */
  nearMissClosingMps: 12,
  /** Fallback for `traffic.solidHitMps`: an end-on hit at least this fast crashes the rider. */
  solidHitMps: 6,
  /** An end-on contact overlapping sideways by less than this is a graze (a wobble), m. */
  grazeM: 0.3,
  /** With the ease-in on, oncoming density starts at this fraction of its slider value. */
  oncomingEaseFrom: 0.25,
  /** Riders higher than this above the road pass over traffic, m. */
  maxContactH: 1.2,
  /** A parked oddity sits this far outward (toward the shoulder) of its lane's centre, m. */
  parkOutM: 1.2,
  /** Vehicles start to get round a parked oddity this far behind it, m. */
  swerveLookM: 90,
  /** Side-to-side room they leave it as they edge round, box to box, m. */
  swerveClearM: 0.3,
  /** How fast they edge sideways round it, m/s. */
  swerveMps: 2.2,
  /** A kerb rider keeps this far inside the drivable road's outer edge, m (W-P). */
  kerbInsetM: 0.25,
  /** A kerb rider takes the shoulder only when it is at least this much wider than the rider, m. */
  kerbShoulderSpareM: 0.2,
  /** One full weave, side to side and back, s (W-P). */
  weavePeriodS: 3.2,
  /** A convoy's extra bumper room on top of the car-following gap at its cruise speed, m. */
  convoyExtraGapM: 2,
};

/** A road vehicle that rides at the kerb (W-P): a bicycle, e-bike, scooter or golf cart. */
export function isKerb(t: SimTrafficTypeDef | undefined): boolean {
  return t?.behaviour?.kerb === true && !isParked(t);
}

/** Whether a road-vehicle type changes lanes: its own flag, else its category's default. */
function changesLanes(t: SimTrafficTypeDef): boolean {
  if (isKerb(t)) return false;
  return t.behaviour?.laneChanges ?? CATEGORY[t.category]?.laneChanges ?? false;
}

/**
 * Where a kerb rider of half width `halfW` rides at u, heading `dir`, in corridor terms: the
 * middle of its direction's shoulder when that is wide enough, else just inside the outer edge of
 * the outermost lane. Also returns the outermost lane's rank, the rank it keeps. Null with no lane.
 */
export function kerbCd(
  road: SimConfig['road'],
  c: Corridor,
  u: number,
  dir: number,
  halfW: number,
): { cd: number; rank: number; lo: number; hi: number } | null {
  const lanes = lanesAt(road, c, u, dir);
  const outer = lanes[lanes.length - 1];
  if (!outer) return null;
  const out = outer.cd < 0 ? -1 : 1;
  const shoulder = shoulderAt(road, c, u, dir, out);
  if (shoulder && shoulder.width >= 2 * halfW + TRAFFIC.kerbShoulderSpareM) {
    const room = Math.max(0, shoulder.width / 2 - halfW);
    return { cd: shoulder.cd, rank: lanes.length - 1, lo: shoulder.cd - room, hi: shoulder.cd + room };
  }
  const edge = outer.cd + (out * outer.width) / 2;
  const cd = edge - out * (halfW + TRAFFIC.kerbInsetM);
  // It may weave inward across its lane, never outward past the kerb.
  const inner = outer.cd - out * (outer.width / 2 - halfW);
  return { cd, rank: lanes.length - 1, lo: Math.min(cd, inner), hi: Math.max(cd, inner) };
}

/** The shoulder lane at u on the `out` side carrying `dir`, in corridor terms, or null. */
function shoulderAt(
  road: SimConfig['road'],
  c: Corridor,
  u: number,
  dir: number,
  out: number,
): { cd: number; width: number } | null {
  const i = linkAt(c, u < 0 ? 0 : u > c.length ? c.length : u);
  const o = c.o[i] ?? 1;
  const off = c.off[i] ?? 0;
  const len = c.len[i] ?? 0;
  const s = o === 1 ? u - off : off + len - u;
  let best: { cd: number; width: number } | null = null;
  for (const l of road.lanesAt(c.edges[i] ?? 0, s)) {
    if (l.kind !== 'shoulder' || l.direction * o !== dir) continue;
    const cd = l.dCenterM * o;
    if (cd * out <= 0) continue;
    if (!best || Math.abs(cd) > Math.abs(best.cd)) best = { cd, width: l.widthM };
  }
  return best;
}

/**
 * The road-vehicle categories. `weight` is the fallback when a type carries no region weight
 * (hand-built configs); buildSimConfig writes the region's `traffic.mix` weight (M2 traffic-3).
 */
const CATEGORY: Readonly<Record<string, { weight: number; laneChanges: boolean } | undefined>> = {
  car: { weight: 5, laneChanges: true },
  truck: { weight: 2, laneChanges: false },
  rv: { weight: 1.5, laneChanges: false },
  oddity: { weight: 0.5, laneChanges: false },
};

/** How often traffic picks a road-vehicle type: its region weight, else its category default. */
function weightOf(t: SimTrafficTypeDef | undefined): number {
  const w = t?.weight ?? CATEGORY[t?.category ?? '']?.weight ?? 0;
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/**
 * The pick weight during a race, for a vehicle heading `dir`: oddities scale by the
 * `traffic.oddities` slider, and a ROLLING oddity (a mobile home with no truck, slower than any
 * car) comes only the other way, so nobody is stuck behind it at 20 mph for minutes (the bot and
 * the rivals do not overtake a slow vehicle). [default]
 */
function rollWeight(world: World, t: SimTrafficTypeDef | undefined, dir: number, routeDir: number): number {
  const w = weightOf(t);
  if (t?.category !== 'oddity') return w;
  if (!isParked(t) && dir === routeDir) return 0;
  const k = world.params['traffic.oddities'] ?? 1;
  return Number.isFinite(k) && k > 0 ? w * k : 0;
}

/** A parked oddity: an `oddity` with no cruise speed, such as a boat left in the fast lane. */
export function isParked(t: SimTrafficTypeDef | undefined): boolean {
  return t?.category === 'oddity' && !(t.cruiseMps > 0);
}

/** Where a parked oddity stands across the road: its lane's centre, nudged toward the shoulder. */
function parkedCd(laneCd: number): number {
  return laneCd + (laneCd < 0 ? -1 : 1) * TRAFFIC.parkOutM;
}

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
  /** A weaver's seeded phase, radians (W-P); 0 for everyone else. */
  weavePhase: number[];
  /** Vehicle entity id each rider is touching, or -1. */
  contactWith: number[];
  unstableS: number[];
  /** Per rider, per vehicle slot: the vehicle's position ahead of the rider last tick (0 = unknown). */
  lastRel: number[][];
  spawns: number;
  recycles: number;
  /** Vehicles moved out of every window after driving off the end of the traffic road. */
  parks: number;
  /** World time since the race started (the sum of timeScale / 60), s: the ease-in's clock. */
  clockS: number;
}

export function trafficState(world: World): TrafficState {
  return systemState<TrafficState>(world, 'traffic', () => ({
    corridor: { edges: [], o: [], off: [], len: [], length: 0, routeDir: 1, lo: 0, hi: 0 },
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
    weavePhase: [],
    contactWith: [],
    unstableS: [],
    lastRel: [],
    spawns: 0,
    recycles: 0,
    parks: 0,
    clockS: 0,
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

/**
 * Corridor u of every sim anchor. An anchor off the corridor but on the route (on the shortcut,
 * say) counts at the corridor point with the same distance to the finish, so a vehicle never
 * spawns just past the junction it is about to rejoin from. Anchors off the route are ignored.
 */
function anchorUs(world: World, config: SimConfig, st: TrafficState): number[] {
  const out: number[] = [];
  const route = config.route;
  const ref = toCorridor(st.corridor, { edge: route.start.edge, s: route.start.s, d: 0, dir: 1 });
  const refDtf = route.distanceToFinish(route.start.edge, route.start.s);
  for (const m of world.movers) {
    if (!isAnchor(config, m)) continue;
    const p = toCorridor(st.corridor, m.pos);
    if (p) {
      out.push(p.u);
      continue;
    }
    const dtf = route.distanceToFinish(m.pos.edge, m.pos.s);
    if (ref && Number.isFinite(dtf) && Number.isFinite(refDtf)) {
      out.push(ref.u + st.corridor.routeDir * (refDtf - dtf));
    }
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
  const lo = c.lo + TRAFFIC.endMarginM;
  const hi = c.hi - TRAFFIC.endMarginM;
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

/**
 * The oncoming ease-in (M2 traffic-3): with `traffic.oncomingEaseInS` above 0, oncoming density
 * grows linearly from `oncomingEaseFrom` of its slider value at the start to all of it once that
 * much world time has passed. 1 when the ease-in is off.
 */
export function oncomingEase(world: World, clockS: number): number {
  const easeS = world.params['traffic.oncomingEaseInS'] ?? 0;
  if (!(easeS > 0)) return 1;
  const from = TRAFFIC.oncomingEaseFrom;
  return from + (1 - from) * clamp(clockS / easeS, 0, 1);
}

function densityFor(world: World, st: TrafficState, dir: number): number {
  if (dir === st.corridor.routeDir) return clamp(world.params['traffic.densitySame'] ?? 1, 0, 10);
  return clamp(world.params['traffic.densityOncoming'] ?? 1, 0, 10) * oncomingEase(world, st.clockS);
}

function targetCount(world: World, st: TrafficState, anchors: readonly number[], dir: number): number {
  const k = densityFor(world, st, dir);
  if (k <= 0) return 0;
  const n = Math.floor((windowLength(anchors, st.corridor) * k) / TRAFFIC.baseSpacingM);
  return Math.min(TRAFFIC.maxPerDirection, n);
}

function rollType(world: World, config: SimConfig, st: TrafficState, dir: number): number {
  const rd = st.corridor.routeDir;
  let total = 0;
  for (const i of st.types) total += rollWeight(world, config.trafficTypes[i], dir, rd);
  let r = nextFloat(world.rng.traffic) * total;
  for (const i of st.types) {
    r -= rollWeight(world, config.trafficTypes[i], dir, rd);
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
  let rank = Math.min(spec.rank ?? 0, Math.max(0, lanes.length - 1));
  const laneCd = lanes[rank]?.cd ?? 0;
  let cd = isParked(t) ? parkedCd(laneCd) : laneCd;
  if (isKerb(t)) {
    // A kerb rider keeps the outermost lane's rank and rides at its kerb (W-P).
    const kerb = kerbCd(config.road, st.corridor, spec.u, spec.dir, t.widthM / 2);
    if (kerb) {
      rank = kerb.rank;
      cd = kerb.cd;
    }
  }
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
  // A weaver starts its weave at a seeded point (W-P); nobody else rolls, so plain traffic keeps
  // its rolls.
  st.weavePhase[slot] = (t.behaviour?.weaveM ?? 0) > 0 ? nextFloat(world.rng.traffic) * TAU : 0;
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
  const type = rollType(world, config, st, dir);
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
    if (u < c.lo + TRAFFIC.endMarginM || u > c.hi - TRAFFIC.endMarginM) continue;
    if (nearestAnchor(anchors, u) > TRAFFIC.windowM) continue;
    if (!spawnAllowed(anchors, u, st.reactionM)) continue;
    const lanes = lanesAt(config.road, c, u, dir);
    if (lanes.length === 0) continue;
    // A parked oddity always takes the innermost lane: the fast lane, where there are two.
    const rank = isParked(t) ? 0 : Math.min(lanes.length - 1, Math.floor(laneRoll * lanes.length));
    if (!laneClear(config, st, u, dir, rank, t.lengthM, gap, k)) continue;
    const slot = placeVehicle(world, config, { type, u, dir, rank, v0 }, k);
    st.spawns++;
    if (k >= 0) st.recycles++;
    if ((t.behaviour?.convoy ?? 1) > 1) addConvoy(world, config, st, anchors, slot);
    return slot >= 0;
  }
  return false;
}

/**
 * The rest of a convoy (W-P): 1 to `convoy` - 1 more of the leader's kind (seeded), nose to tail
 * behind it in its lane at the car-following gap for its cruise speed, all at the leader's cruise
 * speed. Each one must pass the fairness rule and the lane-room check, and the direction's slider
 * target caps the convoy, so a convoy never crowds the road past its density.
 */
function addConvoy(
  world: World,
  config: SimConfig,
  st: TrafficState,
  anchors: readonly number[],
  lead: number,
): void {
  const t = typeOf(config, st, lead);
  const n = Math.max(1, Math.min(4, Math.floor(t.behaviour?.convoy ?? 1)));
  const extra = 1 + Math.floor(nextFloat(world.rng.traffic) * (n - 1));
  const dir = (st.dir[lead] ?? 1) === 1 ? 1 : -1;
  const v0 = st.v0[lead] ?? t.cruiseMps;
  const rank = st.rank[lead] ?? 0;
  const step = t.lengthM + IDM.minGapM + v0 * IDM.timeGapS + TRAFFIC.convoyExtraGapM;
  const c = st.corridor;
  let room = targetCount(world, st, anchors, dir);
  for (let k = 0; k < st.id.length; k++) if (st.dir[k] === dir && st.retired[k] === 0) room--;
  let u = st.u[lead] ?? 0;
  for (let i = 0; i < extra && room > 0; i++) {
    u -= dir * step;
    if (u < c.lo + TRAFFIC.endMarginM || u > c.hi - TRAFFIC.endMarginM) return;
    if (!spawnAllowed(anchors, u, st.reactionM)) return;
    if (!laneClear(config, st, u, dir, rank, t.lengthM, IDM.minGapM)) return;
    placeVehicle(world, config, { type: st.type[lead] ?? 0, u, dir, rank, v0 });
    st.spawns++;
    room--;
  }
}

function atCorridorEnd(st: TrafficState, k: number): boolean {
  const u = st.u[k] ?? 0;
  const end = (st.dir[k] ?? 1) === 1 ? st.corridor.hi : st.corridor.lo;
  return Math.abs(end - u) < 6;
}

/**
 * Moves vehicle k far out of every anchor's window, entering the traffic road from the end
 * behind it, so a vehicle that drove off the end of the traffic road never waits there as a
 * wall. Returns false when the whole road is inside the windows (it then waits at the end).
 */
function park(
  world: World,
  config: SimConfig,
  st: TrafficState,
  anchors: readonly number[],
  k: number,
): boolean {
  const c = st.corridor;
  const dir = (st.dir[k] ?? 1) === 1 ? 1 : -1;
  const t = typeOf(config, st, k);
  const clear = TRAFFIC.windowM + TRAFFIC.despawnMarginM + TRAFFIC.slotStepM;
  for (let i = 0; ; i++) {
    const along = TRAFFIC.endMarginM + i * TRAFFIC.slotStepM;
    if (along > c.hi - c.lo - TRAFFIC.endMarginM) return false;
    const u = dir === 1 ? c.lo + along : c.hi - along;
    if (nearestAnchor(anchors, u) <= clear) continue;
    if (lanesAt(config.road, c, u, dir).length === 0) continue;
    if (!laneClear(config, st, u, dir, 0, t.lengthM, TRAFFIC.spawnGapM, k)) continue;
    const retired = st.retired[k] ?? 0;
    placeVehicle(world, config, { type: st.type[k] ?? 0, u, dir, v0: st.v0[k] ?? t.cruiseMps }, k);
    st.retired[k] = retired;
    st.parks++;
    return true;
  }
}

/**
 * A vehicle that drove off the end of the traffic road: recycle it to a window while its
 * direction is not over its slider's target, else retire it; park whatever is not recycled.
 */
function leaveRoad(world: World, config: SimConfig, st: TrafficState, k: number): void {
  const anchors = anchorUs(world, config, st);
  const dir = (st.dir[k] ?? 1) === 1 ? 1 : -1;
  if (anchors.length > 0 && st.retired[k] === 0) {
    let active = 0;
    for (let j = 0; j < st.id.length; j++) if (st.dir[j] === dir && st.retired[j] === 0) active++;
    const target = targetCount(world, st, anchors, dir);
    if (active > target) st.retired[k] = 1;
    else if (trySpawn(world, config, st, anchors, dir, k)) return;
  }
  park(world, config, st, anchors, k);
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

/**
 * Slots of the vehicles others edge round rather than queue behind: the parked oddities and (W-P)
 * the kerb riders. The common case (none) costs one pass.
 */
function parkedSlots(config: SimConfig, st: TrafficState): number[] {
  const out: number[] = [];
  for (let k = 0; k < st.id.length; k++) {
    const t = config.trafficTypes[st.type[k] ?? -1];
    if (isParked(t) || isKerb(t)) out.push(k);
  }
  return out;
}

/**
 * The nearest parked oddity (or kerb rider) in lane `rank` that vehicle k is coming up on (from
 * TRAFFIC.swerveLookM behind it until k's tail is past its nose), or -1. A kerb rider counts only
 * for a vehicle that is not one itself, and only while k at `kCd` would not clear it side to side.
 */
function parkedAhead(
  config: SimConfig,
  st: TrafficState,
  k: number,
  rank: number,
  parked: readonly number[],
  kCd: number = st.cd[k] ?? 0,
): number {
  const dir = st.dir[k] ?? 1;
  const tk = typeOf(config, st, k);
  const lk = tk.lengthM;
  let best = -1;
  let bestAhead = Infinity;
  for (const j of parked) {
    if (j === k || st.dir[j] !== dir || st.rank[j] !== rank) continue;
    const tj = typeOf(config, st, j);
    if (isKerb(tj)) {
      if (isKerb(tk)) continue;
      if (Math.abs((st.cd[j] ?? 0) - kCd) >= (tk.widthM + tj.widthM) / 2 + TRAFFIC.swerveClearM) continue;
    }
    const ahead = dir * ((st.u[j] ?? 0) - (st.u[k] ?? 0));
    if (ahead > TRAFFIC.swerveLookM || ahead < -(lk + typeOf(config, st, j).lengthM) / 2 - 1) continue;
    if (ahead < bestAhead) {
      bestAhead = ahead;
      best = j;
    }
  }
  return best;
}

/**
 * Rare seeded lane changes, where the vehicle's direction has a second lane with room. A vehicle
 * coming up on a parked oddity in its lane changes out of it (no roll, any category) when the
 * next lane has room, and a random change never moves into a lane with one just ahead.
 */
function laneChanges(world: World, config: SimConfig, st: TrafficState, dt: number): void {
  const chance = TRAFFIC.laneChangePerS * dt;
  const parked = parkedSlots(config, st);
  for (let k = 0; k < st.id.length; k++) {
    st.laneCooldownS[k] = Math.max(0, (st.laneCooldownS[k] ?? 0) - dt);
    const t = typeOf(config, st, k);
    if (parked.length > 0 && !isParked(t) && !isKerb(t)) {
      const dir = st.dir[k] ?? 1;
      const lanes = lanesAt(config.road, st.corridor, st.u[k] ?? 0, dir);
      const rank = st.rank[k] ?? 0;
      const laneCd = lanes[Math.min(rank, lanes.length - 1)]?.cd ?? st.cd[k] ?? 0;
      if (lanes.length >= 2 && parkedAhead(config, st, k, rank, parked, laneCd) >= 0) {
        const to = rank + 1 < lanes.length ? rank + 1 : rank - 1;
        if (laneClear(config, st, st.u[k] ?? 0, dir, to, t.lengthM, TRAFFIC.laneChangeClearM, k)) {
          st.rank[k] = to;
          st.laneCooldownS[k] = TRAFFIC.laneChangeCooldownS;
        }
        continue;
      }
    }
    if (!changesLanes(t) || (st.laneCooldownS[k] ?? 0) > 0) continue;
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
    const toCd = lanes[to]?.cd ?? st.cd[k] ?? 0;
    if (parked.length > 0 && parkedAhead(config, st, k, to, parked, toCd) >= 0) continue;
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
  const parked = parkedSlots(config, st);
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
      // A parked oddity is in the way only while the boxes overlap side to side: edging round it
      // in the same lane (a one-lane road) clears it. So is a kerb rider (W-P), and for a kerb
      // rider so is everyone else: it filters past a queue at the kerb.
      const sideways = Math.abs((st.cd[j] ?? 0) - cd) < (t.widthM + tj.widthM) / 2;
      const loose = isParked(tj) || isKerb(tj) || isKerb(t);
      const sameLane = loose ? sideways : st.rank[j] === st.rank[k] || sideways;
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
    accel.push(idmAccel(speeds[k] ?? 0, st.v0[k] ?? 0, gap, vLead));
  }
  const nextV: number[] = [];
  for (let k = 0; k < n; k++) {
    const v = Math.max(0, (speeds[k] ?? 0) + (accel[k] ?? 0) * dt);
    nextV.push(v);
    st.u[k] = (st.u[k] ?? 0) + (st.dir[k] ?? 1) * v * dt;
  }
  // No two vehicles ever overlap in a lane: walk each lane front to back. Kerb riders (W-P) form a
  // file of their own at the kerb, beside their lane's cars (car-following keeps those apart).
  const lane = st.id.map((_id, k) => (st.rank[k] ?? 0) + (isKerb(typeOf(config, st, k)) ? 0.5 : 0));
  const order = st.id.map((_id, k) => k);
  order.sort(
    (a, b) =>
      (st.dir[a] ?? 0) - (st.dir[b] ?? 0) ||
      (lane[a] ?? 0) - (lane[b] ?? 0) ||
      (st.dir[a] ?? 1) * ((st.u[b] ?? 0) - (st.u[a] ?? 0)) ||
      a - b,
  );
  for (let i = 1; i < order.length; i++) {
    const f = order[i - 1] ?? 0;
    const b = order[i] ?? 0;
    if (st.dir[f] !== st.dir[b] || lane[f] !== lane[b]) continue;
    const tf = typeOf(config, st, f);
    const tb = typeOf(config, st, b);
    if (isParked(tf) || isParked(tb)) {
      // Side by side with a parked oddity is passing it, not overlapping; and nothing shoves one.
      if (Math.abs((st.cd[f] ?? 0) - (st.cd[b] ?? 0)) >= (tf.widthM + tb.widthM) / 2) continue;
      if (isParked(tb)) continue;
    }
    const dir = st.dir[b] ?? 1;
    const room = (tf.lengthM + tb.lengthM) / 2 + 0.3;
    if (dir * ((st.u[f] ?? 0) - (st.u[b] ?? 0)) < room) {
      st.u[b] = (st.u[f] ?? 0) - dir * room;
      nextV[b] = Math.min(nextV[b] ?? 0, nextV[f] ?? 0);
    }
  }
  for (let k = 0; k < n; k++) {
    const dir = st.dir[k] ?? 1;
    let u = st.u[k] ?? 0;
    if (u < c.lo || u > c.hi) {
      u = clamp(u, c.lo, c.hi);
      nextV[k] = 0;
    }
    st.u[k] = u;
    const lanes = lanesAt(config.road, c, u, dir);
    const tk = typeOf(config, st, k);
    const kerb = isKerb(tk) ? kerbCd(config.road, c, u, dir, tk.widthM / 2) : null;
    // A kerb rider keeps the outermost lane's rank as lanes come and go along the road.
    if (kerb) st.rank[k] = kerb.rank;
    const ownLane = lanes[Math.min(st.rank[k] ?? 0, lanes.length - 1)];
    const laneCd = ownLane?.cd ?? st.cd[k] ?? 0;
    let target = kerb ? kerb.cd : laneCd;
    let rate = TRAFFIC.laneChangeMps;
    const weaveM = tk.behaviour?.weaveM ?? 0;
    if (weaveM > 0 && !isParked(tk)) {
      // The weave (W-P): a seeded sine on the world clock, kept inside the kerb span or the lane.
      const swing = weaveM * sin((st.weavePhase[k] ?? 0) + (st.clockS * TAU) / TRAFFIC.weavePeriodS);
      const half = Math.max(0, (ownLane?.width ?? tk.widthM) / 2 - tk.widthM / 2);
      target = kerb
        ? clamp(target + swing, kerb.lo, kerb.hi)
        : clamp(target + swing, laneCd - half, laneCd + half);
    }
    if (parked.length > 0) {
      if (isParked(tk)) {
        target = parkedCd(laneCd);
      } else {
        // Edge inward round a parked oddity (one lane this way) or a kerb rider (W-P, any lane
        // count: a lane change may be blocked), then back once past it.
        const j = parkedAhead(config, st, k, st.rank[k] ?? 0, parked, target);
        const tj = config.trafficTypes[st.type[j] ?? -1];
        if (j >= 0 && tj && (lanes.length < 2 || isKerb(tj) || isKerb(tk))) {
          const out = laneCd < 0 ? -1 : 1;
          target = (st.cd[j] ?? 0) - out * ((tj.widthM + tk.widthM) / 2 + TRAFFIC.swerveClearM);
          rate = TRAFFIC.swerveMps;
        }
      }
    }
    const cd = st.cd[k] ?? 0;
    const step = rate * dt;
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

/**
 * Wobbles, crashes and near misses between riders and vehicles (M1 traffic-1, reshaped by
 * playtest 1, 2026-09-30: "hitting cars feels bouncy"). A first contact is classed by how the
 * boxes met:
 * - **end-on** (they were not side by side last tick, so the rider met the car's front or tail, or
 *   it met the rider's), overlapping sideways by at least `grazeM`, at a closing speed of at least
 *   `traffic.solidHitMps`: a solid hit (`hit` `frontal` or `rear`). The rider crashes (the tumble
 *   hand-off) and the collision is inelastic: the rider is left at the car's speed along the road
 *   (0 for a head-on), just touching it, never thrown back;
 * - otherwise a **side brush**, a **graze** (end-on but barely overlapping) or a slow **nudge**:
 *   a wobble with the speed scrub, pushed just clear of the car. It is still a crash when the rider
 *   is unstable from an earlier wobble, or the vehicle is `big` (M1's rules).
 * A close, fast pass with no contact fires `nearMiss`.
 */
function contacts(world: World, config: SimConfig, st: TrafficState, riders: RiderView[], dt: number): void {
  const T = TRAFFIC;
  const solidMps = world.params['traffic.solidHitMps'] ?? T.solidHitMps;
  const closingMin = world.params['traffic.nearMissClosingMps'] ?? T.nearMissClosingMps;
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
        const vDir = st.dir[k] ?? 1;
        const vSpeed = world.movers[vid]?.speed ?? 0;
        // The vehicle's velocity along the rider's direction, and how fast they came together.
        const vAlong = vDir === r.dir ? vSpeed : -vSpeed;
        let solid = false;
        if (st.contactWith[r.id] !== vid) {
          st.contactWith[r.id] = vid;
          // Side by side last tick (their boxes overlapped along the road): it came in from the side.
          const halfLen = (t.lengthM + T.riderLengthM) / 2;
          const endOn = prev === 0 ? overU < overD : Math.abs(prev) >= halfLen;
          const front = du * r.dir > 0;
          const closing = Math.abs(m.speed - vAlong);
          const graze = endOn && overD < T.grazeM;
          solid = endOn && !graze && closing >= solidMps;
          const crash = solid || t.hazard === 'big' || (st.unstableS[r.id] ?? 0) > 0;
          const hit = graze ? 'graze' : endOn ? (front ? 'frontal' : 'rear') : 'side';
          const data = {
            cause: 'traffic',
            hazard: t.hazard,
            vehicle: t.contentId,
            contact: crash ? 'crash' : 'wobble',
            hit,
            impactMps: closing,
          };
          if (solid) {
            // Inelastic: the rider ends at the vehicle's speed along the road, never bounced back.
            m.speed = Math.max(0, vAlong);
            emit(world, 'crash', r.id, data, { target: vid });
          } else if (crash) {
            m.speed *= T.crashScrub;
            emit(world, 'crash', r.id, data, { target: vid });
          } else {
            m.speed *= T.wobbleScrub;
            const away = dcd > 0 ? -1 : 1;
            m.yaw = clamp(m.yaw + away * r.dir * T.wobbleKickRad, -1.2, 1.2);
            st.unstableS[r.id] = T.unstableS;
            emit(world, 'wobble', r.id, data, { target: vid });
          }
        }
        // Push the rider just out of the vehicle's box: back along the road for a solid hit;
        // sideways for a head-on brush or a side swipe; backward (and down to its speed) for a nudge.
        const lateral = !solid && (vDir !== r.dir || overD < overU);
        let resolved = false;
        if (lateral) {
          r.cd += (dcd > 0 ? -1 : 1) * (overD + 0.02);
          resolved = putRider(world, config, st, r);
        }
        if (!resolved) {
          r.u -= (du > 0 ? 1 : -1) * (overU + 0.02);
          putRider(world, config, st, r);
          // Into its tail: slow to its speed. Hit from behind: shoved up to its speed.
          if (vDir === r.dir) m.speed = du > 0 ? Math.min(m.speed, vSpeed) : Math.max(m.speed, vSpeed);
        }
        config.road.advance(m.pos);
        rel[k] = r.dir * ((st.u[k] ?? 0) - r.u) || -1e-9;
        continue;
      }
      // Near miss (M2 traffic-3): the rider passed the vehicle (it went from ahead to behind),
      // within about 1 m sideways, untouched, at a closing speed of at least the slider's, so
      // crawling past a parked car never scores.
      if (
        prev > 0 &&
        ahead <= 0 &&
        prev < 20 &&
        ahead > -20 &&
        st.contactWith[r.id] !== vid &&
        m.speed >= T.nearMissMinMps
      ) {
        const clearance = -overD;
        const vSpeed = world.movers[vid]?.speed ?? 0;
        const closing = m.speed - ((st.dir[k] ?? 1) === r.dir ? vSpeed : -vSpeed);
        if (clearance > 0 && clearance <= T.nearMissM && closing >= closingMin) {
          emit(
            world,
            'nearMiss',
            r.id,
            {
              clearanceM: clearance,
              oncoming: (st.dir[k] ?? 1) !== r.dir,
              vehicle: t.contentId,
              closingMps: closing,
            },
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
    // Road vehicles the region mix gives a weight; a weight of 0 means it never spawns.
    st.types = config.trafficTypes.flatMap((t, i) => (CATEGORY[t.category] && weightOf(t) > 0 ? [i] : []));
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
    st.clockS += dt;
    if (world.tick % TRAFFIC.populateEveryTicks === 0) populate(world, config, st);
    laneChanges(world, config, st, dt);
    move(world, config, st, riderViews(world, st), dt);
    for (let k = 0; k < st.id.length; k++) {
      const u = st.u[k] ?? 0;
      if ((st.dir[k] === 1 && u >= st.corridor.hi) || (st.dir[k] === -1 && u <= st.corridor.lo))
        leaveRoad(world, config, st, k);
    }
    contacts(world, config, st, riderViews(world, st), dt);
  },
};
