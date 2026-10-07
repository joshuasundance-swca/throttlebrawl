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
// - Contacts (playtest 1, playtest 4): one rule (./contact-rule.ts) for every geometry: a contact
//   closing at `traffic.solidHitMps` or faster, along its normal from both bodies' velocities,
//   crashes the rider (a `crash` event for the tumble; end on, inelastically), and anything slower
//   wobbles (a `wobble` event), whatever the vehicle. Both carry data.cause `traffic`, `hit` and
//   `impactMps` (the closing speed), and target the vehicle. A close, fast pass with no contact fires
//   `nearMiss`. The full rule is on contacts() below. Heights (the hitbox audit's contract,
//   docs/content-packs.md, "Heights and hitboxes"): each vehicle is as tall as its type
//   (vehicleHeightM), and a rider, in the air or not, passes over it only above that; landing on
//   its roof or flying into it below the top is a contact like any other (`data.air`), and the
//   rider meets it with its own box (riderHitbox: the lawnmower, the parking trike).
// - Back on the bike (playtest 4): a rider who has just remounted or respawned is a ghost to
//   traffic for a moment (startTrafficGhost), so a restart behind stopped traffic is never a crash.
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
import { clamp, nextFloat, secondsToTicks, TAU, type TuningParamDecl } from '../../core';
import type { RoadPos } from '../../road';
import { driftOf } from '../riders/drift';
import type { SimConfig, SimTrafficTypeDef } from '../types';
import {
  addMover,
  riderHitbox,
  systemState,
  vehicleHeightM,
  type Mover,
  type SimSystem,
  type World,
} from '../world';
import { GRAZE_M, TRAFFIC_HIT_DEFAULT_MPS, TRAFFIC_HIT_KEY } from './contact-rule';
import {
  buildCorridor,
  buildLaneMap,
  extraLaneMetres,
  fromCorridor,
  laneEndOnMap,
  lanesAt,
  linkAt,
  riderOnCorridor,
  toCorridor,
  type Corridor,
  type LaneMap,
} from './corridor';
import { IDM } from './idm';
import { KERB_YIELD_TUNING } from './kerb-yield';
import { lateSteps } from '../late';

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
    // Hairpin yield (playtest 4, the Gorge's first turns: the field, carried wide round the Crown
    // Point loop, met the oncoming car in it head on): a vehicle waits short of a bend of 75 m radius
    // or tighter while a rider is in it or within this far (m) beyond it, coming its way, and drives
    // on once they are through. 0 (and a race whose tuning leaves it out) is off. [default]
    id: 'traffic.hairpinYieldM',
    group: 'traffic',
    label: 'Traffic waits at a hairpin for riders',
    default: 250,
    min: 0,
    max: 400,
    step: 10,
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
    // Playtest 1: a frontal or rear hit at least this fast throws the rider off. Playtest 4 (the
    // maintainer, 2026-10-05: "low speeds should wobble not crash"): the one line for every contact
    // with a vehicle, by the closing speed along the contact (./contact-rule.ts). [default]
    id: TRAFFIC_HIT_KEY,
    group: 'traffic',
    label: 'Car hit: wipeout closing speed',
    default: TRAFFIC_HIT_DEFAULT_MPS,
    min: 0,
    max: 40,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // Playtest 4 (the maintainer, 2026-10-05: "I've respawned behind stuck traffic and crashed
    // repeatedly ... maybe clip through if that happens"): after a remount or a respawn the rider is
    // a ghost to traffic for at least this long, and on until clear of every vehicle, capped at
    // TRAFFIC.ghostCapS. 0 turns it off. [default]
    id: 'traffic.respawnGhostS',
    group: 'traffic',
    label: 'Back on the bike: ride through traffic for',
    default: 1.5,
    min: 0,
    max: 4,
    step: 0.25,
    unit: 's',
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
  /** Fallback for `traffic.solidHitMps`: a contact closing at least this fast crashes the rider. */
  solidHitMps: TRAFFIC_HIT_DEFAULT_MPS,
  /**
   * An end-on contact overlapping sideways by less than this is a graze, m: it meets the corner, so
   * its closing speed is taken across the road, like a side brush's.
   */
  grazeM: GRAZE_M,
  /**
   * The ghost after a remount or a respawn (playtest 4): it lasts `traffic.respawnGhostS`, then on
   * while the rider's box is within ghostClearM of any vehicle's, never past ghostCapS in all, s/m.
   */
  ghostCapS: 4,
  ghostClearM: 0.25,
  /** Fallback for `traffic.respawnGhostS`, s. */
  respawnGhostS: 1.5,
  /** With the ease-in on, oncoming density starts at this fraction of its slider value. */
  oncomingEaseFrom: 0.25,
  /**
   * A rider on another road is over a corridor road's asphalt when that road's surface is within
   * this of its own (riderOnCorridor); and the driving reads (car following, kerb yields, spawn
   * clearance) see only riders no higher than this above the road, m. Contacts do not use it: a
   * rider meets a vehicle below the vehicle's own height (vehicleHeightM; the hitbox audit found the
   * flat 1.2 m let a jump pass through a 3.3 m truck).
   */
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
export function kerbAhead(
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
export const CATEGORY: Readonly<Record<string, { weight: number; laneChanges: boolean } | undefined>> = {
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
export function parkedCd(laneCd: number): number {
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
   * By rider entity id: the vehicle entity id a wheelie's hood or trunk launch threw it off (-1 for
   * none). The launch starts below that car's roof, so the rider flies clear of that one car until it
   * is back on the road.
   */
  launchedOff: number[];
  /**
   * Kerb riders yielding (T4.1), by vehicle slot: the world time the dodge holds to (0 once the
   * kerb rider is back on its line), the cross-road spot it dodges to, and how long it still lies
   * toppled, s. Reset when the slot is recycled.
   */
  yieldUntilS: number[];
  yieldCd: number[];
  toppleS: number[];
  /**
   * By rider entity id: seconds a traffic wobble leaves it shaky. Since playtest 4's one rule it no
   * longer lowers the crash line (a second slow touch wobbles again); kept as the wobble's record.
   */
  unstableS: number[];
  /**
   * By vehicle slot: how fast it moved across the road last tick (corridor d per second): a lane
   * change, a swerve, a weave. A contact's closing speed across the road reads it (playtest 4).
   */
  cdMps: number[];
  /**
   * By rider entity id, the ghost after a remount or a respawn (playtest 4; startTrafficGhost): the
   * scaled ticks of its minimum left, and of its hard cap left. Ghosting while the cap is above 0.
   */
  ghostT: number[];
  ghostCapT: number[];
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
    launchedOff: [],
    yieldUntilS: [],
    yieldCd: [],
    toppleS: [],
    unstableS: [],
    cdMps: [],
    ghostT: [],
    ghostCapT: [],
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
): {
  contentId: string;
  lengthM: number;
  widthM: number;
  /** How tall it stands (vehicleHeightM), m. */
  heightM: number;
  hazard: 'normal' | 'big';
  kerb: boolean;
} | null {
  const st = trafficState(world);
  const k = st.id.indexOf(entityId);
  const t = k < 0 ? undefined : config.trafficTypes[st.type[k] ?? -1];
  return t
    ? {
        contentId: t.contentId,
        lengthM: t.lengthM,
        widthM: t.widthM,
        heightM: vehicleHeightM(t),
        hazard: t.hazard,
        kerb: isKerb(t),
      }
    : null;
}

// ---- helpers -----------------------------------------------------------------------------

export function typeOf(config: SimConfig, st: TrafficState, k: number): SimTrafficTypeDef {
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
export function anchorUs(world: World, config: SimConfig, st: TrafficState): number[] {
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

export function nearestAnchor(anchors: readonly number[], u: number): number {
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

export function targetCount(world: World, st: TrafficState, anchors: readonly number[], dir: number): number {
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
export function riderClear(
  riders: readonly RiderView[],
  t: SimTrafficTypeDef,
  u: number,
  cd: number,
): boolean {
  for (const r of riders) {
    if (Math.abs(r.cd - cd) >= (t.widthM + TRAFFIC.riderWidthM) / 2 + TRAFFIC.swerveClearM) continue;
    if (Math.abs(r.u - u) < (t.lengthM + TRAFFIC.riderLengthM) / 2 + TRAFFIC.spawnRiderClearM) return false;
  }
  return true;
}

/** Where a vehicle of type `t` stands across the road at u in lane (dir, rank): placeVehicle's rule. */
export function spawnCd(
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
  st.cdMps[slot] = 0;
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
  for (let r = 0; r < st.contactWith.length; r++) {
    if (st.contactWith[r] === st.id[slot]) st.contactWith[r] = -1;
    if (st.launchedOff[r] === st.id[slot]) st.launchedOff[r] = -1;
  }
  return slot;
}

/** A bend this tight (1/m, a 75 m radius) is a drift bend: the drift's corner with some margin. */
export const DRIFT_BEND_KAPPA = 1 / 75;
/** How finely the corridor is sampled for drift bends, m. */
const BEND_STEP_M = 5;
/** A rider slips at least this much (rad) to count as drifting for the traffic's room. */
const DRIFT_SLIP_MIN = 0.05;
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
 * Where a waiting vehicle stops: this far short of the drift bend's mouth (m), clear of a rider
 * carried wide out of the bend into its lane, who steers back across it within about 50 m. [default]
 */
export const HAIRPIN_WAIT_M = 60;

/**
 * Hairpin yield (`traffic.hairpinYieldM`): how far ahead of corridor u, travelling `dir`, the next
 * drift bend (DRIFT_BEND_KAPPA, the corridor's bend mask) begins, when a rider is in that bend or
 * within the key's reach beyond it, riding toward u; else Infinity (also with the key off, and in
 * a bend already: a vehicle in one drives on through). Riders going the vehicle's way never count,
 * nor do riders slower than `minMps`. Pure + - * / over the corridor and the rider views.
 */
export function hairpinMouth(
  world: World,
  config: SimConfig,
  st: TrafficState,
  riders: readonly RiderView[],
  u: number,
  dir: number,
  minMps: number,
): number {
  const reach = world.params['traffic.hairpinYieldM'] ?? 0;
  if (!(reach > 0) || riders.length === 0) return Infinity;
  const c = st.corridor;
  const mask = bendMask(config, st);
  const bendAt = (a: number): boolean | null => {
    const x = u + dir * a;
    if (x < 0 || x > c.length) return null;
    return mask[Math.round(x / BEND_STEP_M)] === 1;
  };
  let mouth = -1;
  for (let a = 0; a <= TRAFFIC.lookaheadM; a += BEND_STEP_M) {
    const at = bendAt(a);
    if (at === null) return Infinity;
    if (at) {
      mouth = a;
      break;
    }
  }
  if (mouth <= 0) return Infinity;
  let far = mouth;
  while (bendAt(far + BEND_STEP_M) === true) far += BEND_STEP_M;
  for (const r of riders) {
    if (r.dir === dir || r.speed < minMps) continue;
    const ahead = dir * (r.u - u);
    if (ahead >= mouth && ahead <= far + reach) return mouth;
  }
  return Infinity;
}

/**
 * A spawn slot a vehicle could not wait in time at (hairpin yield): riders are coming round the
 * hairpin ahead of it, and it would start past its wait line or inside its comfortable stopping
 * distance of it. Every rider counts here, standing still or not (one may set off at any moment, and
 * a spawn that cannot wait is never a vehicle stuck at a wait line).
 */
function hairpinSpawnBlocked(
  world: World,
  config: SimConfig,
  st: TrafficState,
  riders: readonly RiderView[],
  u: number,
  dir: number,
  v0: number,
): boolean {
  const mouth = hairpinMouth(world, config, st, riders, u, dir, 0);
  return mouth < HAIRPIN_WAIT_M + (v0 * v0) / (2 * IDM.comfortDecelMps2);
}

/**
 * Tries to (re)spawn a vehicle heading `dir`: candidate slots from the front of the anchors'
 * windows backward, each checked against the corridor ends, the fairness rule and lane room.
 */
export function trySpawn(
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
    if (!isParked(t) && hairpinSpawnBlocked(world, config, st, riders, u, dir, v0)) continue;
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

/** Recycles vehicles that left the window, retires extras, and tops each direction up. */
export function populate(world: World, config: SimConfig, st: TrafficState): void {
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

export interface RiderView {
  id: number;
  u: number;
  cd: number;
  dir: number;
  speed: number;
  /** On the bike on the road (not flying): what car following and the near miss read. */
  touchable: boolean;
  /** In the air on the bike: it meets a vehicle only below the vehicle's height. */
  airborne: boolean;
  /** Its height above the road, m. */
  h: number;
  /** Its contact box (riderHitbox), m. */
  lengthM: number;
  widthM: number;
  /** Down: in the crash tumble or on foot (W-Q: traffic swerves round them). */
  down: boolean;
  /** Sliding in a drift (or easing out of one): traffic gives it room (drift room). */
  drifting: boolean;
  /**
   * On another road (a branch) whose asphalt here is a corridor road's (run W-U fixes' re-check):
   * its view is that point's corridor position, and contact moves it on its own road.
   */
  over: boolean;
  /** Back on the bike moments ago: traffic passes through it and it through traffic (playtest 4). */
  ghost: boolean;
}

/**
 * Every rider traffic can meet: on a corridor road, or on another road over a corridor road's
 * asphalt (a branch's end bent across the main road, a split's or a merge's overlapping
 * connectors), where it rides among that road's cars and so must touch them. The driving reads see
 * riders up to TRAFFIC.maxContactH above the road; contacts pass `reach` Infinity, so a rider is
 * measured against each vehicle's own height however high it flies.
 */
export function riderViews(
  world: World,
  config: SimConfig,
  st: TrafficState,
  reach: number = TRAFFIC.maxContactH,
): RiderView[] {
  const out: RiderView[] = [];
  for (const m of world.movers) {
    if (m.kind !== 'rider' || m.h > reach) continue;
    const p = riderOnCorridor(config.road, st.corridor, m.pos, TRAFFIC.maxContactH);
    if (!p) continue;
    const box = riderHitbox(config, m.riderIndex);
    out.push({
      id: m.id,
      u: p.u,
      cd: p.cd,
      dir: p.dir,
      speed: m.speed,
      touchable: m.mode === 'Road',
      airborne: m.mode === 'Airborne',
      h: m.h,
      lengthM: box.lengthM,
      widthM: box.widthM,
      down: m.mode === 'Tumble' || m.mode === 'OnFoot',
      drifting: Math.abs(driftOf(world, m)) > DRIFT_SLIP_MIN,
      over: p.over,
      ghost: (st.ghostCapT[m.id] ?? 0) > 0,
    });
  }
  return out;
}

/**
 * Makes a rider a ghost to traffic (playtest 4; the maintainer, 2026-10-05: "maybe clip through if
 * that happens"): sim/tumble calls it the moment a rider is back on the bike, at a remount or a
 * splash respawn. For `traffic.respawnGhostS`, and on while its box is still within
 * TRAFFIC.ghostClearM of any vehicle's (never past TRAFFIC.ghostCapS in all), the rider and traffic
 * pass through each other: no crash, no wobble, no push, no near miss (cars still brake for it, as
 * for any rider in their lane). Rivals, cops, walls and the road's edge meet it as ever. A world with
 * no traffic system is left alone.
 */
export function startTrafficGhost(world: World, riderId: number): void {
  const st = world.systems['traffic'] as TrafficState | undefined;
  if (!st) return;
  const s = world.params['traffic.respawnGhostS'] ?? TRAFFIC.respawnGhostS;
  if (!(s > 0)) return;
  st.ghostT[riderId] = secondsToTicks(s);
  st.ghostCapT[riderId] = secondsToTicks(Math.max(s, TRAFFIC.ghostCapS));
  st.contactWith[riderId] = -1;
}

/** Whether a rider is a ghost to traffic now (startTrafficGhost), for the snapshot. Never writes. */
export function trafficGhost(world: World, riderId: number): boolean {
  const st = world.systems['traffic'] as TrafficState | undefined;
  return (st?.ghostCapT[riderId] ?? 0) > 0;
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
      st.launchedOff[m.id] = -1;
      st.unstableS[m.id] = 0;
      st.ghostT[m.id] = 0;
      st.ghostCapT[m.id] = 0;
      st.lastRel[m.id] = [];
    }
    // The first fill: every direction up to its target, from the front of the windows back.
    const cap = capPerDirection(world);
    for (let pass = 0; pass < cap; pass++) populate(world, config, st);
  },
  // The step is in ./step.ts, a lazy chunk the race waits for (src/sim/late.ts).
  step: (world, config) => lateSteps().trafficStep(world, config),
};
