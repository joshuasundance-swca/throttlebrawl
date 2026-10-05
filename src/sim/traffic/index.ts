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
// - Density is a master tuning slider (`traffic.density`, W-P) times one slider per direction, so
//   the whole road or just oncoming traffic can go to zero; oncoming density
//   can also ease in over the start of a race (M2 traffic-3, off by default). The region's
//   `traffic.mix` weights pick the vehicle types (SimTrafficTypeDef.weight).
// - Traffic areas (W-R; interview, 2026-10-02: "DISTINCT KEYS"): where a road tag that is a
//   traffic area (a Keys district such as `key-fishing`) covers a spawn slot, that area's own mix
//   (SimTrafficTypeDef.areaWeights) picks the type instead, from the same one roll. A vehicle keeps
//   its type as it drives on; recycled, it is picked again where it reappears.
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
// - A rider down in the lane (W-Q, the pitch deck's item 11, "fill the dead air after a crash:
//   traffic swerves around you"): a vehicle coming up on a rider who is down (tumbling or on foot)
//   in its path edges inward round them, over the centre line if need be, when no oncoming vehicle
//   is within TRAFFIC.swerveOncomingClearM of the spot; otherwise it stops behind them as before.
// - Multi-lane roads (W-R; interview, 2026-10-02: "multi-lane highways (4-6 lanes, lane
//   splitting)"): a direction's traffic scales with its lanes (each lane past the first adds
//   `traffic.extraLaneDensity` of a lane's cars, 0.6 by default, so a three-lane highway carries
//   about 2.2 times a two-lane road's cars, under the hard cap), every lane gets cars, and where a
//   lane ends (the corridor's lane map) its cars merge inward one lane at a
//   time when the next lane has room, braking for the lane's end until they can; nothing spawns in or
//   changes into a lane that ends within TRAFFIC.mergeLookM. A road with one lane each way is
//   exactly as before. A near miss whose rider had another vehicle just as close on the other side
//   (threading between two cars, or between a car and an oncoming one) carries `split`.
// - Kerb riders yield (playtest 3, T4.1; ./kerb-yield.ts): a bicycle, scooter or e-bike steps out
//   of the way of a rider closing on it (onto the verge, else hugging the road's edge), slows while it
//   does, and goes back to its kerb line afterwards; a rider that still clips a light one only
//   wobbles (data.kerb) and the cyclist topples for a moment. Behind `traffic.kerbYield` and
//   `traffic.kerbSoft`. Playtest 4 (P4-3): the golf cart takes the verge too where there is room,
//   outer edge inside the smashables' line, but is not light: it keeps the old contact rules (a
//   solid rear-end is still a crash).
// Every number below is a [default] starting value, to be tuned on the phone.
import { clamp, cos, nextFloat, sin, TAU, type TuningParamDecl } from '../../core';
import { sRateFactor, type RoadPos } from '../../road';
import { driftOf } from '../riders/drift';
import { hoodLaunchContact, wheelieCrashReason } from '../riders/wheelie';
import { MOVING_DECKS_KEY, type SimConfig, type SimMovingDecks, type SimTrafficTypeDef } from '../types';
import { addMover, emit, systemState, type Mover, type SimSystem, type World } from '../world';
import {
  buildCorridor,
  buildLaneMap,
  extraLaneMetres,
  fromCorridor,
  laneCountOnMap,
  laneEndOnMap,
  laneRunBoundary,
  lanesAt,
  linkAt,
  linkOf,
  riderOnCorridor,
  toCorridor,
  type Corridor,
  type LaneMap,
} from './corridor';
import { IDM, idmAccel } from './idm';
import {
  bestSpot,
  holdsReturn,
  KERB_YIELD,
  KERB_YIELD_TUNING,
  softContact,
  takesVerge,
  threatens,
  vergeOffsetFor,
  type DodgeSpots,
  type KerbBody,
} from './kerb-yield';

export { buildCorridor, buildLaneMap, pickLink, toCorridor, trafficMayEnter } from './corridor';
export type { Corridor, LaneMap } from './corridor';
export { IDM, idmAccel } from './idm';

export const TRAFFIC_TUNING: readonly TuningParamDecl[] = [
  {
    // W-P "fill the world" (maintainer, 2026-10-01b: "more cars both ways"): one slider for the
    // whole road, multiplying both direction sliders below. 0 empties the road. [default]
    id: 'traffic.density',
    group: 'traffic',
    label: 'Traffic density',
    default: 1,
    min: 0,
    max: 3,
    step: 0.1,
    unit: '×',
    affectsSim: true,
    system: true,
  },
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
    // Drift room (playtest 4, "more room for error in heavy traffic"): no vehicle spawns in or this
    // far (m) before or after a bend of 75 m radius or tighter, where a drift starts and slides; the
    // road there is as clear as a spawn can leave it (cars already on the road still drive in).
    // 0 is off, the old density everywhere. [default]
    id: 'traffic.driftBendClearM',
    group: 'traffic',
    label: 'No new traffic near tight bends',
    default: 40,
    min: 0,
    max: 120,
    step: 5,
    unit: 'm',
    affectsSim: true,
  },
  {
    // Drift room, likewise: a vehicle with a drifting rider within DRIFT_ROOM_LOOK_M (55 m) edges this
    // far (m) toward its kerb, as far as its road allows, and back when the slide is over. 0 is off.
    // [default]
    id: 'traffic.driftRoomM',
    group: 'traffic',
    label: 'Traffic keeps clear of a drift',
    default: 1,
    min: 0,
    max: 2,
    step: 0.1,
    unit: 'm',
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
  {
    // Multi-lane roads (W-R): each lane past the first each way carries this share of a lane's cars.
    // 1 fills every lane like a two-lane road's; 0.6 keeps the phone's sim step in hand on the
    // six-lane freeway (about 40 live vehicles at most, not 50). 0 adds no cars for extra lanes.
    // [default]
    id: 'traffic.extraLaneDensity',
    group: 'traffic',
    label: 'Traffic, extra highway lanes',
    default: 0.6,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  ...KERB_YIELD_TUNING,
];

/** [default] starting values (docs/milestones/M1.md, "Starting numbers", and this lane). */
export const TRAFFIC = {
  /** Population window around each sim anchor, m. */
  windowM: 400,
  /** Extra distance past the window before a vehicle is recycled, m. */
  despawnMarginM: 50,
  /**
   * One vehicle per this many metres of lane at density 1. W-P tried 80 (half as many cars again,
   * the maintainer's "more cars both ways", 2026-10-01b) and CI's balance checks failed: the
   * rivals, the cop and the test bot do not cope with it yet (the cop busted nobody in 16 seeds,
   * the bot stalled on a real road). So the default stays and `traffic.density` turns it up.
   */
  baseSpacingM: 120,
  /** The fairness rule: vehicles spawn only beyond closing speed × this. */
  reactionS: 2,
  /** Cap on live vehicles per direction at `traffic.density` 1; the slider scales it (W-P). */
  maxPerDirection: 14,
  /** The cap never goes past this, whatever the slider, for the phone's sake (W-P). */
  maxPerDirectionHard: 32,
  /** New vehicles added per direction per population pass. */
  maxAddsPerPass: 2,
  populateEveryTicks: 10,
  /** How far ahead car-following looks, m (the threat draw distance). */
  lookaheadM: 200,
  /** Minimum bumper gap at spawn, m. */
  spawnGapM: 40,
  /**
   * A spawn keeps its box this far clear, end to end, of any rider in its path (W-R): a cop waiting
   * on the shoulder is no anchor, so the fairness rule never kept a kerb rider from appearing on top
   * of him and shoving him along the shoulder.
   */
  spawnRiderClearM: 15,
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
  /**
   * Within this much of touching in corridor terms, a contact is measured on the vehicle's rigid,
   * drawn box instead (rigidOffset): the two differ by at most about a metre on the tightest bends, m.
   */
  rigidNearM: 1.5,
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
  /** A swerve round a downed rider waits while an oncoming vehicle is this close to the spot, m (W-Q). */
  swerveOncomingClearM: 120,
  /** A rider slower than this at the side of the lane is edged round, not queued behind, m/s. */
  sideRiderMps: 2,
  /** One full weave, side to side and back, s (W-P). */
  weavePeriodS: 3.2,
  /** A convoy's extra bumper room on top of the car-following gap at its cruise speed, m. */
  convoyExtraGapM: 2,
  /** A car starts merging out of a lane that ends this far ahead, m (W-R). */
  mergeLookM: 250,
  /** Bumper room a merge needs in the lane it moves into, m (W-R). */
  mergeClearM: 8,
  /** A merging car is in its new lane once its centre is this close to the lane's, m (W-R). */
  mergeDoneM: 0.3,
  /**
   * A near miss is a lane split when another vehicle is within nearMissM on the rider's other side
   * and alongside it: its box within this much of the rider's along the road, m (W-R).
   */
  splitAlongM: 1.5,
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

/**
 * kerbCd, looking ahead (W-R multi-lane roads): where the outermost lane ends within
 * TRAFFIC.mergeLookM, the kerb beyond that end, with the rank kept until the lane goes, so a kerb
 * rider is in at the narrower kerb in good time. Exactly kerbCd where no lane ends ahead.
 */
function kerbAhead(
  config: SimConfig,
  st: TrafficState,
  u: number,
  dir: number,
  halfW: number,
): { cd: number; rank: number; lo: number; hi: number } | null {
  const c = st.corridor;
  const kerb = kerbCd(config.road, c, u, dir, halfW);
  if (!kerb) return null;
  const end = laneEndAhead(st, u, dir, kerb.rank, TRAFFIC.mergeLookM);
  const beyond = end > 0 && end < Infinity ? kerbCd(config.road, c, u + dir * (end + 1), dir, halfW) : null;
  return beyond ? { ...beyond, rank: kerb.rank } : kerb;
}

/**
 * The ground beside the road on the `out` side at u, in corridor terms (T4.1): where the drivable
 * road ends (`edgeCd`, the outermost lane's outer edge, shoulder included) and how wide the verge
 * band past it is (0 where the road's own edge is the edge).
 */
function kerbGround(
  config: SimConfig,
  st: TrafficState,
  u: number,
  out: number,
): { edgeCd: number; vergeW: number } {
  const c = st.corridor;
  const i = linkAt(c, u < 0 ? 0 : u > c.length ? c.length : u);
  const o = c.o[i] ?? 1;
  const off = c.off[i] ?? 0;
  const len = c.len[i] ?? 0;
  const s = clamp(o === 1 ? u - off : off + len - u, 0, len);
  const v = config.road.vergeAt(c.edges[i] ?? 0, s, out * o < 0 ? 'left' : 'right');
  return { edgeCd: v.dInner * o, vergeW: v.widthM };
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
 * A type's weight in a traffic area (W-R; interview, 2026-10-02: each key its own traffic): its
 * `areaWeights` entry for that area tag, 0 when it has none; with no area, its region weight.
 */
function areaWeightOf(t: SimTrafficTypeDef | undefined, area: string | null): number {
  if (area === null) return weightOf(t);
  const w = t?.areaWeights?.[area] ?? 0;
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/** The traffic area tags of a config: every key of any type's `areaWeights` (cached per config). */
const AREA_TAGS = new WeakMap<SimConfig, ReadonlySet<string>>();
function areaTags(config: SimConfig): ReadonlySet<string> {
  let tags = AREA_TAGS.get(config);
  if (!tags) {
    const out = new Set<string>();
    for (const t of config.trafficTypes) for (const k of Object.keys(t.areaWeights ?? {})) out.add(k);
    tags = out;
    AREA_TAGS.set(config, tags);
  }
  return tags;
}

/**
 * The traffic area at corridor u (W-R): the first tag of the road under u, in the road's tag
 * order, that is an area tag and covers that s on either side; null outside every area, or when
 * the race has no areas.
 */
export function trafficAreaAt(config: SimConfig, c: Corridor, u: number): string | null {
  const areas = areaTags(config);
  if (areas.size === 0 || c.edges.length === 0) return null;
  const i = linkAt(c, u < 0 ? 0 : u > c.length ? c.length : u);
  const o = c.o[i] ?? 1;
  const off = c.off[i] ?? 0;
  const len = c.len[i] ?? 0;
  const s = o === 1 ? u - off : off + len - u;
  const edge = config.road.edges[c.edges[i] ?? -1];
  for (const t of edge?.tags ?? []) {
    if (areas.has(t.tag) && s >= t.s0 && s <= t.s1) return t.tag;
  }
  return null;
}

/**
 * The pick weight during a race, for a vehicle heading `dir` in traffic area `area` (null: the
 * region's mix): oddities scale by the `traffic.oddities` slider, and a ROLLING oddity (a mobile
 * home with no truck, slower than any car) comes only the other way, so nobody is stuck behind it
 * at 20 mph for minutes (the bot and the rivals do not overtake a slow vehicle). [default]
 */
function rollWeight(
  world: World,
  t: SimTrafficTypeDef | undefined,
  dir: number,
  routeDir: number,
  area: string | null = null,
): number {
  const w = areaWeightOf(t, area);
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
  /** Where the corridor's lane count each way changes (W-R multi-lane roads). */
  laneMap: LaneMap;
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
  /**
   * Kerb riders yielding (T4.1), by vehicle slot: the world time the dodge holds to (0 once the
   * kerb rider is back on its line), the cross-road spot it dodges to, and how long it still lies
   * toppled, s. Reset when the slot is recycled.
   */
  yieldUntilS: number[];
  yieldCd: number[];
  toppleS: number[];
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
    laneMap: { u0: [], plus: [], minus: [] },
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
    yieldUntilS: [],
    yieldCd: [],
    toppleS: [],
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
): { contentId: string; lengthM: number; widthM: number; hazard: 'normal' | 'big'; kerb: boolean } | null {
  const st = trafficState(world);
  const k = st.id.indexOf(entityId);
  const t = k < 0 ? undefined : config.trafficTypes[st.type[k] ?? -1];
  return t
    ? { contentId: t.contentId, lengthM: t.lengthM, widthM: t.widthM, hazard: t.hazard, kerb: isKerb(t) }
    : null;
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

/** A direction's density: the master `traffic.density` slider times that direction's own slider. */
function densityFor(world: World, st: TrafficState, dir: number): number {
  const all = clamp(world.params['traffic.density'] ?? 1, 0, 10);
  if (dir === st.corridor.routeDir) return all * clamp(world.params['traffic.densitySame'] ?? 1, 0, 10);
  return all * clamp(world.params['traffic.densityOncoming'] ?? 1, 0, 10) * oncomingEase(world, st.clockS);
}

/**
 * The live-vehicle cap per direction: the base cap, scaled up (never down) by the master slider and
 * by `laneFactor`, the windows' average lanes that way (1 on a road with one lane each way; W-R), and
 * never past the hard cap.
 */
export function capPerDirection(world: World, laneFactor = 1): number {
  const all = clamp(world.params['traffic.density'] ?? 1, 0, 10);
  return Math.min(
    TRAFFIC.maxPerDirectionHard,
    Math.round(TRAFFIC.maxPerDirection * Math.max(1, all) * laneFactor),
  );
}

/**
 * Lane-metres past one lane that way inside the anchor windows (W-R): the union of the windows, as
 * windowLength takes it, against the lane map. 0 on a road with one lane each way.
 */
function extraLaneLength(st: TrafficState, anchors: readonly number[], dir: number): number {
  const m = st.laneMap;
  if (!(dir === 1 ? m.plus : m.minus).some((n) => n > 1)) return 0;
  const c = st.corridor;
  const lo = c.lo + TRAFFIC.endMarginM;
  const hi = c.hi - TRAFFIC.endMarginM;
  const spans = anchors
    .map((a) => [Math.max(lo, a - TRAFFIC.windowM), Math.min(hi, a + TRAFFIC.windowM)] as const)
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  let extra = 0;
  let curA = -Infinity;
  let curB = -Infinity;
  for (const [a, b] of spans) {
    if (a > curB) {
      if (curB > curA) extra += extraLaneMetres(m, curA, curB, dir);
      curA = a;
      curB = b;
    } else if (b > curB) {
      curB = b;
    }
  }
  if (curB > curA) extra += extraLaneMetres(m, curA, curB, dir);
  return extra;
}

function targetCount(world: World, st: TrafficState, anchors: readonly number[], dir: number): number {
  const k = densityFor(world, st, dir);
  if (k <= 0) return 0;
  const length = windowLength(anchors, st.corridor);
  // The extra lanes of a multi-lane stretch (W-R) add their metres, each at
  // `traffic.extraLaneDensity` of a lane's cars (1: as many per lane as a two-lane road).
  const laneShare = clamp(world.params['traffic.extraLaneDensity'] ?? 0.6, 0, 1);
  const extra = laneShare > 0 ? extraLaneLength(st, anchors, dir) * laneShare : 0;
  const n = Math.floor(((length + extra) * k) / TRAFFIC.baseSpacingM);
  return Math.min(capPerDirection(world, extra > 0 && length > 0 ? (length + extra) / length : 1), n);
}

/** How far ahead vehicle-lane `rank` heading `dir` ends from u, within `range` (W-R); see laneEndOnMap. */
export function laneEndAhead(
  st: Pick<TrafficState, 'laneMap'>,
  u: number,
  dir: number,
  rank: number,
  range: number,
): number {
  return laneEndOnMap(st.laneMap, u, dir, rank, range);
}

/**
 * The type a roll `r01` in [0, 1) picks for a vehicle heading `dir` in traffic area `area` (W-R:
 * the area's own mix; null, or an area whose weights all come to 0 that way, is the region's mix).
 */
function pickType(
  world: World,
  config: SimConfig,
  st: TrafficState,
  dir: number,
  r01: number,
  area: string | null,
): number {
  const rd = st.corridor.routeDir;
  let total = 0;
  for (const i of st.types) total += rollWeight(world, config.trafficTypes[i], dir, rd, area);
  if (!(total > 0) && area !== null) return pickType(world, config, st, dir, r01, null);
  let r = r01 * total;
  let last = st.types[st.types.length - 1] ?? 0;
  for (const i of st.types) {
    const w = rollWeight(world, config.trafficTypes[i], dir, rd, area);
    r -= w;
    if (r < 0) return i;
    if (w > 0) last = i;
  }
  return last;
}

/**
 * Whether a vehicle of type `t` fits at u in lane (dir, rank) with `gap` metres of bumper room.
 * A vehicle is in the lane by its rank, or by its body: one whose lane change has just begun takes
 * its new rank at once but slides out of the old lane over several ticks, and until its body is
 * clear of the lane (side to side, with TRAFFIC.swerveClearM to spare) nothing spawns or changes
 * into the lane beside it. (The #302 prep, W-S: comparing ranks only, a hatchback spawned at d 10.00
 * on top of a shuttle at d 9.81 that had just started out of that lane, on the SF freeway.)
 * Exported for tests.
 */
export function laneClear(
  config: SimConfig,
  st: TrafficState,
  u: number,
  dir: number,
  rank: number,
  t: Pick<SimTrafficTypeDef, 'lengthM' | 'widthM'>,
  gap: number,
  skip = -1,
): boolean {
  const lane = lanesAt(config.road, st.corridor, u, dir)[rank];
  for (let k = 0; k < st.id.length; k++) {
    if (k === skip || st.dir[k] !== dir) continue;
    const tk = typeOf(config, st, k);
    if (st.rank[k] !== rank) {
      if (!lane) continue;
      const side = (t.widthM + tk.widthM) / 2 + TRAFFIC.swerveClearM;
      if (Math.abs((st.cd[k] ?? 0) - lane.cd) >= side) continue;
    }
    const need = (t.lengthM + tk.lengthM) / 2 + gap;
    if (Math.abs((st.u[k] ?? 0) - u) < need) return false;
  }
  return true;
}

/**
 * Whether a vehicle of type `t` placed at (u, cd) keeps clear of every rider (W-R): no rider whose
 * box would overlap it side to side is within TRAFFIC.spawnRiderClearM of its box, end to end.
 */
function riderClear(riders: readonly RiderView[], t: SimTrafficTypeDef, u: number, cd: number): boolean {
  for (const r of riders) {
    if (Math.abs(r.cd - cd) >= (t.widthM + TRAFFIC.riderWidthM) / 2 + TRAFFIC.swerveClearM) continue;
    if (Math.abs(r.u - u) < (t.lengthM + TRAFFIC.riderLengthM) / 2 + TRAFFIC.spawnRiderClearM) return false;
  }
  return true;
}

/** Where a vehicle of type `t` stands across the road at u in lane (dir, rank): placeVehicle's rule. */
function spawnCd(
  config: SimConfig,
  c: Corridor,
  t: SimTrafficTypeDef,
  u: number,
  dir: number,
  laneCd: number,
): number {
  if (isKerb(t)) {
    const kerb = kerbCd(config.road, c, u, dir, t.widthM / 2);
    if (kerb) return kerb.cd;
  }
  return isParked(t) ? parkedCd(laneCd) : laneCd;
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
    // A kerb rider keeps the outermost lane's rank and rides at its kerb (W-P), or at the narrower
    // kerb beyond where that lane ends soon (W-R).
    const kerb = kerbAhead(config, st, spec.u, spec.dir, t.widthM / 2);
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
  st.yieldUntilS[slot] = 0;
  st.yieldCd[slot] = cd;
  st.toppleS[slot] = 0;
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

/** A bend this tight (1/m, a 75 m radius) is a drift bend: the drift's corner with some margin. */
export const DRIFT_BEND_KAPPA = 1 / 75;
/** How finely the corridor is sampled for drift bends, m. */
const BEND_STEP_M = 5;
/** A rider slips at least this much (rad) to count as drifting for the traffic's room. */
const DRIFT_SLIP_MIN = 0.05;
/** Traffic edges aside for a drifting rider within this far of it along the road, m (`traffic.driftRoomM`). */
const DRIFT_ROOM_LOOK_M = 55;
const bendMasks = new WeakMap<TrafficState, Uint8Array>();

/** Per BEND_STEP_M of the corridor: 1 where the road bends at DRIFT_BEND_KAPPA or tighter. */
function bendMask(config: SimConfig, st: TrafficState): Uint8Array {
  let mask = bendMasks.get(st);
  if (mask) return mask;
  const c = st.corridor;
  mask = new Uint8Array(Math.ceil(c.length / BEND_STEP_M) + 1);
  const at: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  for (let i = 0; i < mask.length; i++) {
    fromCorridor(c, i * BEND_STEP_M, 0, 1, at);
    mask[i] = Math.abs(config.road.kappaAt(at.edge, at.s)) >= DRIFT_BEND_KAPPA ? 1 : 0;
  }
  bendMasks.set(st, mask);
  return mask;
}

/** Whether corridor u is in, or within `traffic.driftBendClearM` of, a drift bend. */
function nearTightBend(world: World, config: SimConfig, st: TrafficState, u: number): boolean {
  const clear = world.params['traffic.driftBendClearM'] ?? 0;
  if (!(clear > 0)) return false;
  const mask = bendMask(config, st);
  const lo = Math.max(0, Math.floor((u - clear) / BEND_STEP_M));
  const hi = Math.min(mask.length - 1, Math.ceil((u + clear) / BEND_STEP_M));
  for (let i = lo; i <= hi; i++) if (mask[i] === 1) return true;
  return false;
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
  // The rolls come first, in their old order. The type is picked per candidate slot from the one
  // type roll, by the traffic area at that slot (W-R: each key its own traffic); without areas
  // every slot picks the same type, as before.
  const typeRoll = nextFloat(world.rng.traffic);
  const speedRoll = 0.9 + 0.2 * nextFloat(world.rng.traffic);
  const regionType = pickType(world, config, st, dir, typeRoll, null);
  if (!config.trafficTypes[regionType]) return false;
  const hasAreas = areaTags(config).size > 0;
  let riders: RiderView[] | null = null;
  let placed: number[] | null = null;
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
    if (nearTightBend(world, config, st, u)) continue;
    const lanes = lanesAt(config.road, c, u, dir);
    if (lanes.length === 0) continue;
    const area = hasAreas ? trafficAreaAt(config, c, u) : null;
    const type = area === null ? regionType : pickType(world, config, st, dir, typeRoll, area);
    const t = config.trafficTypes[type];
    if (!t) continue;
    placed ??= riderUs(world, config, st);
    if (riderAt(placed, u, t.lengthM)) continue;
    // A parked oddity always takes the innermost lane: the fast lane, where there are two.
    let rank = isParked(t) ? 0 : Math.min(lanes.length - 1, Math.floor(laneRoll * lanes.length));
    // Never into a lane that ends soon (W-R): the next lane in, until one goes on.
    while (rank > 0 && laneEndAhead(st, u, dir, rank, TRAFFIC.mergeLookM) < Infinity) rank--;
    if (!laneClear(config, st, u, dir, rank, t, gap, k)) continue;
    riders ??= riderViews(world, config, st);
    if (!riderClear(riders, t, u, spawnCd(config, c, t, u, dir, lanes[rank]?.cd ?? 0))) continue;
    const v0 = t.cruiseMps * speedRoll;
    const slot = placeVehicle(world, config, { type, u, dir, rank, v0 }, k);
    st.spawns++;
    if (k >= 0) st.recycles++;
    if ((t.behaviour?.convoy ?? 1) > 1) addConvoy(world, config, st, anchors, slot);
    return slot >= 0;
  }
  return false;
}

/**
 * Corridor u of every rider on a corridor road, or over one's asphalt from another road (run W-U
 * fixes' re-check): riderAt's input, read once per spawn attempt.
 */
function riderUs(world: World, config: SimConfig, st: TrafficState): number[] {
  const out: number[] = [];
  for (const m of world.movers) {
    if (m.kind !== 'rider') continue;
    const p = riderOnCorridor(config.road, st.corridor, m.pos, TRAFFIC.maxContactH);
    if (p) out.push(p.u);
  }
  return out;
}

/**
 * Whether any rider (the fairness rule's anchors are only the racers: a cop parked in his lot is
 * not one) is within half a vehicle plus RIDER_SPAWN_CLEAR_M of u along the corridor. A beach
 * cruiser once spawned on the shoulder right on top of the parked cop (W-Q, batch seed 39).
 */
function riderAt(placed: readonly number[], u: number, lengthM: number): boolean {
  for (const p of placed) if (Math.abs(p - u) < lengthM / 2 + RIDER_SPAWN_CLEAR_M) return true;
  return false;
}
/** Room kept between a spawning vehicle's end and any rider, m. */
const RIDER_SPAWN_CLEAR_M = 6;

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
  const riders = riderViews(world, config, st);
  for (let i = 0; i < extra && room > 0; i++) {
    u -= dir * step;
    if (u < c.lo + TRAFFIC.endMarginM || u > c.hi - TRAFFIC.endMarginM) return;
    if (!spawnAllowed(anchors, u, st.reactionM)) return;
    if (!laneClear(config, st, u, dir, rank, t, IDM.minGapM)) return;
    const laneCd = lanesAt(config.road, c, u, dir)[rank]?.cd ?? 0;
    if (!riderClear(riders, t, u, spawnCd(config, c, t, u, dir, laneCd))) return;
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
  let riders: RiderView[] | null = null;
  for (let i = 0; ; i++) {
    const along = TRAFFIC.endMarginM + i * TRAFFIC.slotStepM;
    if (along > c.hi - c.lo - TRAFFIC.endMarginM) return false;
    const u = dir === 1 ? c.lo + along : c.hi - along;
    if (nearestAnchor(anchors, u) <= clear) continue;
    if (lanesAt(config.road, c, u, dir).length === 0) continue;
    if (!laneClear(config, st, u, dir, 0, t, TRAFFIC.spawnGapM, k)) continue;
    riders ??= riderViews(world, config, st);
    const laneCd = lanesAt(config.road, c, u, dir)[0]?.cd ?? 0;
    if (!riderClear(riders, t, u, spawnCd(config, c, t, u, dir, laneCd))) continue;
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
    // A lane that ends ahead (W-R): merge inward, one lane at a time, as soon as the next lane has
    // room; no roll, no cooldown, any category. Until then it brakes for the lane's end (move()).
    if (!isParked(t) && !isKerb(t)) {
      const rank = st.rank[k] ?? 0;
      const u = st.u[k] ?? 0;
      const dir = st.dir[k] ?? 1;
      if (rank > 0 && laneEndAhead(st, u, dir, rank, TRAFFIC.mergeLookM) < Infinity) {
        if (laneClear(config, st, u, dir, rank - 1, t, TRAFFIC.mergeClearM, k)) {
          st.rank[k] = rank - 1;
          st.laneCooldownS[k] = TRAFFIC.laneChangeCooldownS;
        }
        continue;
      }
    }
    if (parked.length > 0 && !isParked(t) && !isKerb(t)) {
      const dir = st.dir[k] ?? 1;
      const lanes = lanesAt(config.road, st.corridor, st.u[k] ?? 0, dir);
      const rank = st.rank[k] ?? 0;
      const laneCd = lanes[Math.min(rank, lanes.length - 1)]?.cd ?? st.cd[k] ?? 0;
      if (lanes.length >= 2 && parkedAhead(config, st, k, rank, parked, laneCd) >= 0) {
        const to = rank + 1 < lanes.length ? rank + 1 : rank - 1;
        if (laneClear(config, st, st.u[k] ?? 0, dir, to, t, TRAFFIC.laneChangeClearM, k)) {
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
    if (!laneClear(config, st, st.u[k] ?? 0, dir, to, t, TRAFFIC.laneChangeClearM, k)) continue;
    // Never into a lane that ends soon (W-R).
    if (laneEndAhead(st, st.u[k] ?? 0, dir, to, TRAFFIC.mergeLookM) < Infinity) continue;
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
  /** Down: in the crash tumble or on foot (W-Q: traffic swerves round them). */
  down: boolean;
  /** Sliding in a drift (or easing out of one): traffic gives it room (drift room). */
  drifting: boolean;
  /**
   * On another road (a branch) whose asphalt here is a corridor road's (run W-U fixes' re-check):
   * its view is that point's corridor position, and contact moves it on its own road.
   */
  over: boolean;
}

/**
 * Every rider traffic can meet: on a corridor road, or on another road over a corridor road's
 * asphalt (a branch's end bent across the main road, a split's or a merge's overlapping
 * connectors), where it rides among that road's cars and so must touch them.
 */
function riderViews(world: World, config: SimConfig, st: TrafficState): RiderView[] {
  const out: RiderView[] = [];
  for (const m of world.movers) {
    if (m.kind !== 'rider' || m.h > TRAFFIC.maxContactH) continue;
    const p = riderOnCorridor(config.road, st.corridor, m.pos, TRAFFIC.maxContactH);
    if (!p) continue;
    out.push({
      id: m.id,
      u: p.u,
      cd: p.cd,
      dir: p.dir,
      speed: m.speed,
      touchable: m.mode === 'Road',
      down: m.mode === 'Tumble' || m.mode === 'OnFoot',
      drifting: Math.abs(driftOf(world, m)) > DRIFT_SLIP_MIN,
      over: p.over,
    });
  }
  return out;
}

/**
 * Kerb riders yield (playtest 3, T4.1; docs/architecture.md, "Traffic"). Each tick, before
 * car-following, every kerb slot in ascending order is checked against every rider view in ascending
 * id order. While a rider threatens a kerb rider (./kerb-yield.ts `threatens`), and for
 * KERB_YIELD.holdS after the last one has passed, the kerb rider dodges to the best spot (`bestSpot`:
 * the verge for any kerb type with room for it (P4-3), the road's edge, or where it is) at KERB_YIELD.mps, slowed to
 * KERB_YIELD.speedScale of its cruise speed (move() reads `yieldUntilS`). Afterwards it returns to
 * its kerb line at KERB_YIELD.returnMps, waiting while a rider within KERB_YIELD.returnBehindM behind
 * it is still in its band. A toppled one (contacts()) counts its lying time down here. With
 * `traffic.kerbYield` absent or 0 nothing is checked and no state changes.
 */
function updateKerbYield(
  world: World,
  config: SimConfig,
  st: TrafficState,
  riders: readonly RiderView[],
  dt: number,
): void {
  const n = st.id.length;
  for (let k = 0; k < n; k++) {
    const left = st.toppleS[k] ?? 0;
    if (left > 0) st.toppleS[k] = left - dt > 1e-6 ? left - dt : 0;
  }
  const look = world.params['traffic.kerbYield'] ?? 0;
  if (look <= 0 || riders.length === 0) return;
  for (let k = 0; k < n; k++) {
    const t = typeOf(config, st, k);
    if (!isKerb(t) || (st.toppleS[k] ?? 0) > 0) continue;
    const dir = st.dir[k] ?? 1;
    const u = st.u[k] ?? 0;
    const halfW = t.widthM / 2;
    const kerb = kerbAhead(config, st, u, dir, halfW);
    if (!kerb) continue;
    const cd = st.cd[k] ?? 0;
    const body: KerbBody = {
      u,
      cd,
      homeCd: kerb.cd,
      dir,
      speed: world.movers[st.id[k] ?? -1]?.speed ?? 0,
      lengthM: t.lengthM,
      widthM: t.widthM,
    };
    const threats: number[] = [];
    let waiting = false;
    for (const r of riders) {
      if (threatens(body, r, TRAFFIC.riderLengthM, TRAFFIC.riderWidthM, look)) threats.push(r.cd);
      else if (holdsReturn(body, r, TRAFFIC.riderWidthM)) waiting = true;
    }
    if (threats.length > 0) {
      const out = kerb.cd < 0 ? -1 : 1;
      const ground = kerbGround(config, st, u, out);
      const spots: DodgeSpots = {
        verge: takesVerge(t, ground.vergeW) ? ground.edgeCd + out * vergeOffsetFor(t.widthM) : null,
        hug: ground.edgeCd - out * (halfW + KERB_YIELD.hugM),
        stay: cd,
      };
      st.yieldCd[k] = bestSpot(spots, threats, t.widthM, TRAFFIC.riderWidthM);
      st.yieldUntilS[k] = st.clockS + KERB_YIELD.holdS;
    } else if (waiting && (st.yieldUntilS[k] ?? 0) > 0 && st.clockS >= (st.yieldUntilS[k] ?? 0)) {
      st.yieldUntilS[k] = st.clockS + 2 * dt;
    }
  }
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
  updateKerbYield(world, config, st, riders, dt);
  const accel: number[] = [];
  const dodge: boolean[] = [];
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
    // The end of its lane (W-R), until it has merged out of it: a stopped obstacle. A merge takes a
    // moment to slide across, so until the car is in its new lane the end of the one it is leaving
    // (one further out) counts too.
    if (!isParked(t) && !isKerb(t)) {
      const rank = st.rank[k] ?? 0;
      let end = laneEndAhead(st, u, dir, rank, TRAFFIC.lookaheadM);
      if (laneCountOnMap(st.laneMap, u, dir) > rank + 1) {
        const own = lanesAt(config.road, c, u, dir)[rank];
        if (own && Math.abs(cd - own.cd) > TRAFFIC.mergeDoneM) {
          end = Math.min(end, laneEndAhead(st, u, dir, rank + 1, TRAFFIC.lookaheadM));
        }
      }
      if (end < Infinity) consider(end - t.lengthM / 2, 0);
    }
    // A dodging kerb rider (T4.1) slows down while it does.
    const dodging = isKerb(t) && st.clockS < (st.yieldUntilS[k] ?? 0);
    dodge.push(dodging);
    accel.push(idmAccel(speeds[k] ?? 0, (st.v0[k] ?? 0) * (dodging ? KERB_YIELD.speedScale : 1), gap, vLead));
  }
  const nextV: number[] = [];
  for (let k = 0; k < n; k++) {
    // A toppled kerb rider (T4.1) lies still.
    let v = (st.toppleS[k] ?? 0) > 0 ? 0 : Math.max(0, (speeds[k] ?? 0) + (accel[k] ?? 0) * dt);
    if (dodge[k]) {
      // Slowing for the rider takes KERB_YIELD.brakeMps2, not IDM's ever softer approach to a lower
      // cruise speed: about 0.4 s from a bicycle's cruise to 0.6 of it.
      const slow = (st.v0[k] ?? 0) * KERB_YIELD.speedScale;
      v = Math.min(v, Math.max(slow, (speeds[k] ?? 0) - KERB_YIELD.brakeMps2 * dt));
    }
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
    const tk = typeOf(config, st, k);
    // A road vehicle never rides a stretch with no lane its way (playtest 3, T10.6: an oncoming car
    // that could not stop for the end of its lane rolled into Lombard Street's one-way block and sat
    // there head-on with the cars coming down, for good). It is held at the lane's end, stopped.
    if (!isKerb(tk) && !isParked(tk)) {
      const edge = laneRunBoundary(st.laneMap, u, dir);
      if (edge !== null) {
        u = edge;
        nextV[k] = 0;
      }
    }
    st.u[k] = u;
    const lanes = lanesAt(config.road, c, u, dir);
    const kerb = isKerb(tk) ? kerbAhead(config, st, u, dir, tk.widthM / 2) : null;
    // A kerb rider keeps the outermost lane's rank as lanes come and go along the road.
    if (kerb) st.rank[k] = kerb.rank;
    // Past where its lane ended (W-R: a merge it could not make): it is in the lane that goes on.
    else if (lanes.length > 0 && (st.rank[k] ?? 0) > lanes.length - 1) st.rank[k] = lanes.length - 1;
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
    // A kerb rider that is toppled lies where it is; one that is dodging (T4.1) goes to its spot,
    // and afterwards back to its line, slowly.
    let returning = false;
    if (kerb) {
      const until = st.yieldUntilS[k] ?? 0;
      if ((st.toppleS[k] ?? 0) > 0) {
        target = st.cd[k] ?? target;
      } else if (until > 0) {
        if (st.clockS < until) {
          target = st.yieldCd[k] ?? target;
          rate = KERB_YIELD.mps;
        } else {
          returning = true;
          rate = KERB_YIELD.returnMps;
        }
      }
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
    // A rider stopped at the outer side of the lane (a cop waiting on the shoulder by a speed trap,
    // a rider pulled over): edge inward round them instead of queuing behind them for good (W-P:
    // a camper van waited 40 s behind a speed-trap cop and walled the road). A rider stopped in the
    // middle of the lane (a crash) still stops the traffic behind it (M1 traffic-1).
    if (!isParked(tk)) {
      const r = sideRiderAhead(st, k, riders, tk, target, laneCd, ownLane?.width ?? 2 * TRAFFIC.riderWidthM);
      if (r) {
        const out = laneCd < 0 ? -1 : 1;
        const round = r.cd - out * ((tk.widthM + TRAFFIC.riderWidthM) / 2 + TRAFFIC.swerveClearM);
        target = out > 0 ? Math.min(target, round) : Math.max(target, round);
        rate = TRAFFIC.swerveMps;
      }
      // A rider down in its path (W-Q): round them on the inside, when the oncoming side is clear.
      const down = downRiderAhead(st, k, riders, tk, target);
      if (down && oncomingClear(st, k, down)) {
        const out = laneCd < 0 ? -1 : 1;
        const round = down.cd - out * ((tk.widthM + TRAFFIC.riderWidthM) / 2 + TRAFFIC.swerveClearM);
        target = out > 0 ? Math.min(target, round) : Math.max(target, round);
        rate = TRAFFIC.swerveMps;
      }
    }
    // A drifting rider swings wide: a vehicle near one edges toward its kerb, inside its road.
    const roomM = world.params['traffic.driftRoomM'] ?? 0;
    if (
      roomM > 0 &&
      !isParked(tk) &&
      !kerb &&
      riders.some((r) => r.drifting && Math.abs(r.u - u) < DRIFT_ROOM_LOOK_M)
    ) {
      const out = laneCd < 0 ? -1 : 1;
      const limit = Math.abs(kerbGround(config, st, u, out).edgeCd) - tk.widthM / 2 - 0.1;
      const want = Math.min(Math.abs(laneCd) + roomM, limit);
      if (want > Math.abs(target)) target = out * want;
      rate = TRAFFIC.swerveMps;
    }
    const cd = st.cd[k] ?? 0;
    const step = rate * dt;
    const nextCd = cd + clamp(target - cd, -step, step);
    st.cd[k] = nextCd;
    // Back on its line: the dodge is over.
    if (returning && Math.abs(nextCd - target) <= 0.05) st.yieldUntilS[k] = 0;
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

/**
 * The nearest rider stopped (under TRAFFIC.sideRiderMps) that vehicle k is coming up on (from
 * TRAFFIC.swerveLookM behind it until k's tail is past it), mostly outside k's lane on the outer
 * side, that k would still touch at `kCd`; null when there is none.
 */
function sideRiderAhead(
  st: TrafficState,
  k: number,
  riders: readonly RiderView[],
  tk: SimTrafficTypeDef,
  kCd: number,
  laneCd: number,
  laneWidth: number,
): RiderView | null {
  const dir = st.dir[k] ?? 1;
  const u = st.u[k] ?? 0;
  const out = laneCd < 0 ? -1 : 1;
  let best: RiderView | null = null;
  let bestAhead = Infinity;
  for (const r of riders) {
    if (r.speed >= TRAFFIC.sideRiderMps) continue;
    // From swerveLookM behind it until k's tail is past it.
    const ahead = dir * (r.u - u);
    if (ahead > TRAFFIC.swerveLookM || ahead < -(tk.lengthM + TRAFFIC.riderLengthM) / 2 - 1) continue;
    // Mostly outside the lane: its middle past the lane's edge less half a rider.
    if (out * (r.cd - laneCd) <= laneWidth / 2 - TRAFFIC.riderWidthM / 2) continue;
    if (Math.abs(r.cd - kCd) >= (tk.widthM + TRAFFIC.riderWidthM) / 2 + TRAFFIC.swerveClearM) continue;
    if (ahead < bestAhead) {
      bestAhead = ahead;
      best = r;
    }
  }
  return best;
}

/**
 * The nearest rider down (tumbling or on foot, under TRAFFIC.sideRiderMps) that vehicle k is coming
 * up on (from TRAFFIC.swerveLookM behind it until k's tail is past it) and would touch at `kCd`;
 * null when there is none (W-Q).
 */
function downRiderAhead(
  st: TrafficState,
  k: number,
  riders: readonly RiderView[],
  tk: SimTrafficTypeDef,
  kCd: number,
): RiderView | null {
  const dir = st.dir[k] ?? 1;
  const u = st.u[k] ?? 0;
  let best: RiderView | null = null;
  let bestAhead = Infinity;
  for (const r of riders) {
    if (!r.down || r.speed >= TRAFFIC.sideRiderMps) continue;
    const ahead = dir * (r.u - u);
    if (ahead > TRAFFIC.swerveLookM || ahead < -(tk.lengthM + TRAFFIC.riderLengthM) / 2 - 1) continue;
    if (Math.abs(r.cd - kCd) >= (tk.widthM + TRAFFIC.riderWidthM) / 2 + TRAFFIC.swerveClearM) continue;
    if (ahead < bestAhead) {
      bestAhead = ahead;
      best = r;
    }
  }
  return best;
}

/**
 * Whether no oncoming vehicle is between vehicle k and TRAFFIC.swerveOncomingClearM past the downed
 * rider, so k may round them over the centre line (W-Q).
 */
function oncomingClear(st: TrafficState, k: number, r: RiderView): boolean {
  const dir = st.dir[k] ?? 1;
  const u = st.u[k] ?? 0;
  for (let j = 0; j < st.id.length; j++) {
    if (j === k || st.dir[j] === dir || (st.retired[j] ?? 0) !== 0) continue;
    const at = dir * ((st.u[j] ?? 0) - u);
    if (at > -5 && at < dir * (r.u - u) + TRAFFIC.swerveOncomingClearM) return false;
  }
  return true;
}

/**
 * Lane splitting (W-R; interview, 2026-10-02: "lane splitting"): the slot of a vehicle other than k
 * on the rider's other side from k, within nearMissM of it box to box and alongside it (its box
 * within TRAFFIC.splitAlongM of the rider's along the road), either way it is heading; else -1.
 */
function splitPartner(config: SimConfig, st: TrafficState, r: RiderView, k: number): number {
  const T = TRAFFIC;
  const side = (st.cd[k] ?? 0) - r.cd > 0 ? 1 : -1;
  for (let j = 0; j < st.id.length; j++) {
    if (j === k) continue;
    const dcd = (st.cd[j] ?? 0) - r.cd;
    if (dcd * side >= 0) continue;
    const tj = typeOf(config, st, j);
    const gap = (dcd < 0 ? -dcd : dcd) - (tj.widthM + T.riderWidthM) / 2;
    if (gap <= 0 || gap > T.nearMissM) continue;
    const du = (st.u[j] ?? 0) - r.u;
    if ((du < 0 ? -du : du) > (tj.lengthM + T.riderLengthM) / 2 + T.splitAlongM) continue;
    return j;
  }
  return -1;
}

/** Writes a rider's corridor position back to its road position, inside the drivable width. */
function putRider(world: World, config: SimConfig, st: TrafficState, r: RiderView): boolean {
  const m = world.movers[r.id];
  if (!m) return false;
  if (r.over) return putRiderOver(config, st, m, r);
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
 * putRider for a rider on another road over a corridor road (RiderView.over): the move from where
 * it is to its view's corridor position, as a world offset, made on its own road (s along, d
 * across), its d kept inside that road's drivable width. Then its view is read again.
 */
function putRiderOver(config: SimConfig, st: TrafficState, m: Mover, r: RiderView): boolean {
  const road = config.road;
  const pos = m.pos;
  const to = { edge: 0, s: 0, d: 0, dir: 1 as 1 | -1 };
  fromCorridor(st.corridor, r.u, r.cd, r.dir, to);
  const a = road.toWorld(pos.edge, pos.s, pos.d, 0);
  const b = road.toWorld(to.edge, to.s, to.d, 0);
  const f = road.frameAt(pos.edge, pos.s);
  const ox = b.x - a.x;
  const oz = b.z - a.z;
  const edge = road.edges[pos.edge];
  const d = pos.d - ox * f.tz + oz * f.tx;
  const lo = (edge?.dMin ?? -5) + 0.5;
  const hi = (edge?.dMax ?? 5) - 0.5;
  pos.s += (ox * f.tx + oz * f.tz) * sRateFactor(f.kappa, pos.d);
  pos.d = clamp(d, lo, hi);
  const p = riderOnCorridor(road, st.corridor, pos, TRAFFIC.maxContactH);
  if (p) {
    r.u = p.u;
    r.cd = p.cd;
  }
  return pos.d === d;
}

/**
 * A light kerb rider a rider has clipped topples (T4.1): it lies still for KERB_YIELD.toppleS, moved
 * outward by the overlap `overD` plus KERB_YIELD.topplePushM, kept inside the verge (or the road's
 * edge where there is no verge). Contacts skip it while it lies there.
 */
function toppleKerbRider(world: World, config: SimConfig, st: TrafficState, k: number, overD: number): void {
  const t = typeOf(config, st, k);
  const cd = st.cd[k] ?? 0;
  const out = cd < 0 ? -1 : 1;
  const ground = kerbGround(config, st, st.u[k] ?? 0, out);
  const reach = ground.edgeCd + out * ground.vergeW - out * (t.widthM / 2 + KERB_YIELD.toppleInsetM);
  const target = cd + out * (overD + KERB_YIELD.topplePushM);
  // Never pulled inward by the clamp: a kerb rider already past the verge's edge stays put.
  const next = out > 0 ? Math.max(cd, Math.min(target, reach)) : Math.min(cd, Math.max(target, reach));
  st.cd[k] = next;
  st.toppleS[k] = KERB_YIELD.toppleS;
  // Once it rides on, it goes back to its kerb line at the return pace.
  st.yieldUntilS[k] = st.clockS + 1e-6;
  const mover = world.movers[st.id[k] ?? -1];
  if (!mover) return;
  mover.speed = 0;
  fromCorridor(st.corridor, st.u[k] ?? 0, next, st.dir[k] ?? 1, mover.pos);
}

/** A crash's `wheelieReason` (sim/riders/wheelie.ts `wheelieCrashReason`), or nothing when it has none. */
function wheelieReasonData(reason: string | undefined): { wheelieReason?: string } {
  return reason === undefined ? {} : { wheelieReason: reason };
}

/**
 * Where the vehicle is from the rider as its drawn body sees it (playtest 4, the maintainer,
 * 2026-10-05: "you need to give trucks a wider berth"): the vehicle is a rigid box, along its own
 * heading (the road's tangent at its middle, turned by its yaw), as the render draws it, and the
 * rider's middle is measured in that box's frame, in metres. Corridor coordinates bend with the road
 * and stretch with the offset across it, so on a bend a 16 m log truck's corridor box reached up to
 * half a metre past the truck drawn there: riders crashed into air beside and behind it. Returned in
 * corridor signs (+du: the vehicle is further along u; +dcd: further across), null when either mover
 * is missing. Plain + - * / and the core trig: the sim's determinism rules.
 */
function rigidOffset(
  config: SimConfig,
  v: Mover | undefined,
  rider: Mover,
  dirC: number,
): { du: number; dcd: number } | null {
  if (!v) return null;
  const road = config.road;
  const f = road.frameAt(v.pos.edge, v.pos.s);
  const tx = f.tx * v.pos.dir;
  const tz = f.tz * v.pos.dir;
  const c = cos(v.yaw);
  const sn = sin(v.yaw);
  // Its heading (as tumble/contacts.ts builds a vehicle's box), turned to point along +u.
  const ux = (c * tx - sn * tz) * dirC;
  const uz = (c * tz + sn * tx) * dirC;
  const a = road.toWorld(v.pos.edge, v.pos.s, v.pos.d, 0);
  const b = road.toWorld(rider.pos.edge, rider.pos.s, rider.pos.d, 0);
  const ox = a.x - b.x;
  const oz = a.z - b.z;
  // +cd is +u turned a quarter to its right: (x, z) to (-z, x), as +d is to the tangent.
  return { du: ox * ux + oz * uz, dcd: -ox * uz + oz * ux };
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
 * Playtest 3: a vehicle with its ramp down (a live moving deck, SimMovingDeck) is the riders' to
 * meet, by the deck rules, so traffic skips it; and a first contact a wheelie turns into a hood
 * launch (sim/riders/wheelie.ts) is neither a crash nor a wobble, and a crash a wheelie did not turn
 * into a launch says why in one word (`data.wheelieReason`, P4-2). With `traffic.kerbSoft`, a first
 * contact with a light kerb rider (T4.1) is always a wobble with `data.kerb`, and at
 * KERB_YIELD.toppleMinMps closing or more the cyclist topples (toppleKerbRider) and is skipped
 * until it has lain still for KERB_YIELD.toppleS.
 */
function contacts(world: World, config: SimConfig, st: TrafficState, riders: RiderView[], dt: number): void {
  const T = TRAFFIC;
  const solidMps = world.params['traffic.solidHitMps'] ?? T.solidHitMps;
  const closingMin = world.params['traffic.nearMissClosingMps'] ?? T.nearMissClosingMps;
  const decks = (world.systems[MOVING_DECKS_KEY] as SimMovingDecks | undefined)?.live ?? [];
  const kerbSoft = (world.params['traffic.kerbSoft'] ?? 0) > 0;
  for (const r of riders) {
    st.unstableS[r.id] = Math.max(0, (st.unstableS[r.id] ?? 0) - dt);
    st.lastRel[r.id] ??= st.id.map(() => 0);
    const rel = st.lastRel[r.id] ?? [];
    const m = world.movers[r.id];
    if (!m) continue;
    for (let k = 0; k < st.id.length; k++) {
      const vid = st.id[k] ?? -1;
      const t = typeOf(config, st, k);
      let du = (st.u[k] ?? 0) - r.u;
      let dcd = (st.cd[k] ?? 0) - r.cd;
      if (
        Math.abs(du) < (t.lengthM + T.riderLengthM) / 2 + T.rigidNearM &&
        Math.abs(dcd) < (t.widthM + T.riderWidthM) / 2 + T.rigidNearM
      ) {
        const rigid = rigidOffset(config, world.movers[vid], m, st.dir[k] ?? 1);
        if (rigid) {
          du = rigid.du;
          dcd = rigid.dcd;
        }
      }
      const overU = (t.lengthM + T.riderLengthM) / 2 - Math.abs(du);
      const overD = (t.widthM + T.riderWidthM) / 2 - Math.abs(dcd);
      const ahead = r.dir * du;
      const prev = rel[k] ?? 0;
      rel[k] = ahead === 0 ? -1e-9 : ahead;
      if (!r.touchable || isDeckVehicle(decks, vid)) continue;
      // A toppled kerb rider (T4.1) lies on the ground: riders pass it by, and it can't be hit again.
      if ((st.toppleS[k] ?? 0) > 0) continue;
      if (st.contactWith[r.id] === vid && (overU < -1 || overD < -0.5)) st.contactWith[r.id] = -1;
      if (overU > 0 && overD > 0) {
        const vDir = st.dir[k] ?? 1;
        const vSpeed = world.movers[vid]?.speed ?? 0;
        // The vehicle's velocity along the rider's direction, and how fast they came together.
        const vAlong = vDir === r.dir ? vSpeed : -vSpeed;
        let solid = false;
        let soft = false;
        if (st.contactWith[r.id] !== vid) {
          st.contactWith[r.id] = vid;
          // Side by side last tick (their boxes overlapped along the road): it came in from the side.
          const halfLen = (t.lengthM + T.riderLengthM) / 2;
          const endOn = prev === 0 ? overU < overD : Math.abs(prev) >= halfLen;
          const front = du * r.dir > 0;
          const closing = Math.abs(m.speed - vAlong);
          const graze = endOn && overD < T.grazeM;
          const oncoming = vDir !== r.dir;
          const hood = {
            rider: r.id,
            vehicle: vid,
            type: t,
            endOn,
            graze,
            front,
            oncoming,
            closingMps: closing,
          };
          if (hoodLaunchContact(world, config, hood)) continue;
          const hit = graze ? 'graze' : endOn ? (front ? 'frontal' : 'rear') : 'side';
          if (kerbSoft && isKerb(t) && softContact(t)) {
            // Soft contact (T4.1): the rider only wobbles, even when it is still unstable from an
            // earlier wobble, and a hard enough clip topples the cyclist. A toppled cyclist is moved
            // clear, so the rider is neither pushed out of its box nor slowed to its speed; a slow
            // brush (a scooter against a cop standing at the kerb) is resolved as any nudge is.
            soft = closing >= KERB_YIELD.toppleMinMps;
            m.speed *= KERB_YIELD.bumpScrub;
            const away = dcd > 0 ? -1 : 1;
            m.yaw = clamp(m.yaw + away * r.dir * KERB_YIELD.bumpKickRad, -1.2, 1.2);
            st.unstableS[r.id] = T.unstableS;
            emit(
              world,
              'wobble',
              r.id,
              {
                cause: 'traffic',
                hazard: t.hazard,
                vehicle: t.contentId,
                contact: 'wobble',
                hit,
                impactMps: closing,
                kerb: true,
                ...(soft ? { toppleS: KERB_YIELD.toppleS } : {}),
              },
              { target: vid },
            );
            if (soft) toppleKerbRider(world, config, st, k, overD);
          } else {
            solid = endOn && !graze && closing >= solidMps;
            const crash = solid || t.hazard === 'big' || (st.unstableS[r.id] ?? 0) > 0;
            const data = {
              cause: 'traffic',
              hazard: t.hazard,
              vehicle: t.contentId,
              contact: crash ? 'crash' : 'wobble',
              hit,
              impactMps: closing,
              // A rider in a wheelie who crashed instead of launching is told why, in one word.
              ...(crash ? wheelieReasonData(wheelieCrashReason(world, hood)) : {}),
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
        }
        if (soft) {
          rel[k] = r.dir * ((st.u[k] ?? 0) - r.u) || -1e-9;
          continue;
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
          // Threading between this vehicle and another just as close on the other side (W-R).
          const split = splitPartner(config, st, r, k) >= 0;
          emit(
            world,
            'nearMiss',
            r.id,
            {
              clearanceM: clearance,
              oncoming: (st.dir[k] ?? 1) !== r.dir,
              vehicle: t.contentId,
              closingMps: closing,
              ...(split ? { split: true } : {}),
            },
            { target: vid },
          );
        }
      }
    }
  }
}

/** Whether a vehicle has a live moving deck this tick (playtest 3's moving ramp trucks). */
function isDeckVehicle(decks: readonly { vehicle: number }[], vid: number): boolean {
  for (const d of decks) if (d.vehicle === vid) return true;
  return false;
}

export const trafficSystem: SimSystem = {
  name: 'traffic',
  init(world: World, config: SimConfig) {
    const st = trafficState(world);
    st.corridor = buildCorridor(config);
    st.laneMap = buildLaneMap(config.road, st.corridor);
    // Road vehicles the region mix gives a weight; a weight of 0 means it never spawns.
    // A type in no region mix but in an area's (W-R) spawns too, only in that area.
    const areas = areaTags(config);
    const inAnyMix = (t: SimTrafficTypeDef) =>
      weightOf(t) > 0 || [...areas].some((a) => areaWeightOf(t, a) > 0);
    st.types = config.trafficTypes.flatMap((t, i) => (CATEGORY[t.category] && inAnyMix(t) ? [i] : []));
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
    const cap = capPerDirection(world);
    for (let pass = 0; pass < cap; pass++) populate(world, config, st);
  },
  step(world: World, config: SimConfig) {
    const st = trafficState(world);
    if (st.types.length === 0 && st.id.length === 0) return;
    const dt = world.timeScale / 60;
    st.clockS += dt;
    if (world.tick % TRAFFIC.populateEveryTicks === 0) populate(world, config, st);
    laneChanges(world, config, st, dt);
    move(world, config, st, riderViews(world, config, st), dt);
    for (let k = 0; k < st.id.length; k++) {
      const u = st.u[k] ?? 0;
      if ((st.dir[k] === 1 && u >= st.corridor.hi) || (st.dir[k] === -1 && u <= st.corridor.lo))
        leaveRoad(world, config, st, k);
    }
    contacts(world, config, st, riderViews(world, config, st), dt);
  },
};
