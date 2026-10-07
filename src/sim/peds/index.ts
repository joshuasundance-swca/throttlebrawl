// sim/peds: roadside pedestrians (and the odd chicken) who dive clear, cartoonishly
// (docs/milestones/M1.md, traffic-2; docs/architecture.md, "Pedestrians and animals").
//
// - Spawns: at race start, from every `roadsideZone` feature on the route's allowed roads, one per
//   PEDS.perZoneM of zone length (at most PEDS.maxPerZone), off the drivable road on the zone's
//   side. Kinds are the `traffic-type` entries with category `pedestrian` or `animal`: a zone whose
//   `params.spawns` is `pedestrians` gets people plus the odd stray animal, `animals` gets
//   animals, anything else gets both. Rolls come from world.rng.peds only.
// - Some cross the road and back after a seeded wait; the rest loiter. Nobody crosses where a
//   rail or wall lines the road.
// - The threat check: a rider on a bike (or a sliding crash) comes within pedThreatRangeM(speed)
//   ahead, which grows with the rider's speed, and within PEDS.lateralM (plus both half widths)
//   across. The pedestrian then dives: a short scripted arc to the side (PEDS.diveDistM in
//   PEDS.diveS), away from the riders, preferring to land off the road, and emits `pedDive`.
//   They lie down a moment, get up, and walk off the road.
// - Contacts should never happen. If one does (a rider already on top of someone), the pedestrian
//   is knocked into a dive (`pedDive` with data.bumped) and nobody gets hurt; a `big` kind
//   crashes the rider instead (a `crash` event with data.cause `ped`, for tumble-1).
// - Animals (M3 traffic-4, head start): the region's `animals` list, picked by weight. They stand
//   only where render lays land (the roadside zones) and never on a bridge walkway: a zone stretch
//   with a rail on either side, or a `bridge` tag, gets people only (the fisherman stays). A kind
//   with no walking speed (the gator on a lawn chair) never crosses. A `big` kind (the gator) is
//   never lured into stepping out, and its reaction time scales by `peds.bigReactScale`: at 1 it
//   dives like everyone else; lower it and gators dive late enough to be hit, which crashes you.
// - Life that reacts to the player (W-P, "fill the world", maintainer 2026-10-01b: "pedestrians,
//   cyclists, joggers, dogs, life that reacts to the player"), all seeded and never on the road
//   except to cross it:
//   - a `strolls` kind (joggers, hikers, dog walkers) walks along the verge, back and forth
//     inside its roadside zone, at the off-road distance it spawned at; it never crosses;
//   - a close pass by a fast rider (outside the dive band) makes a person hop back from the kerb
//     (`pedReact` jumpBack) or, further out, maybe shake a fist or hold up a phone to film;
//     someone a rider scared into a dive or a hop does the same when back on their feet;
//   - a kerb rider (a bicycle or a scooter on the shoulder) makes people on the verge hop back,
//     never dive; on the road they still dive from it;
//   - a `chases` animal (a dog) runs after a passing rider for PEDS.chaseS along the verge, inside
//     its zone and never on a bridge walkway or the road, then trots back.
// - Gap acceptance (playtest 3, T4.2; `peds.gapAccept`, on by default): a crossing is cut into two
//   stages, the near kerb to the refuge on the centre line (the d where the drive lanes' direction
//   flips, or the median's middle; a one-way road has none, so one stage) and the refuge to the far
//   kerb. Before a pedestrian steps onto the road, and before it leaves the refuge, it checks the
//   stage: a rider fast enough to count (PEDS.threatMinMps), ahead within PEDS.gapLookM, in the
//   stage's lanes, who would arrive inside the stage's time plus PEDS.gapMarginS, blocks the step,
//   and it waits where it stands. Cars are not gated (they do not stop for people), big animals
//   are. A pedestrian already on the road when a rider turns up sooner than the rest of the stage
//   hurries (PEDS.hurryScale times its pace) to the nearer end of the stage; the dive stays the last
//   resort. The worst-moment gag is a fake-out: the lured pedestrian walks to PEDS.fakeOutM outside
//   the road edge, stops, and hops back as the rider passes (never onto the road).
// - Zone-local kinds (real-world C0.4): a `roadsideZone` with `params.kinds` (a list of traffic-type
//   ids, bare or with the pack, people or animals) spawns only those, weighted equally and whatever
//   the region's weights, from the zone's own seeded stream, so no other spawn moves.
// - Crowd zones (playtest 4, P4-16: a party street): `params.everyM` and `params.maxPeds` make a zone a
//   crowd, a person every everyM metres of kerb up to maxPeds (PEDS.crowdMinEveryM, PEDS.maxCrowd bound
//   them), where an ordinary zone is one per PEDS.perZoneM and at most PEDS.maxPerZone.
// Pedestrians move across the road (d) to cross it, and along it (s) only on the verge inside
// their zone. Every number below is a [default] starting value, to be tuned on the phone.
import {
  clamp,
  createRng,
  HALF_PI,
  nextFloat,
  streamSeed,
  type RngState,
  type TuningParamDecl,
} from '../../core';
import type { BakedFeature, RoadNetwork } from '../../road';
import type { SimConfig, SimTrafficTypeDef } from '../types';
import { roadsideClass } from '../roadside';
import { addMover, systemState, type SimSystem, type World } from '../world';
import { lateSteps } from '../late';

export const PEDS_TUNING: readonly TuningParamDecl[] = [
  {
    // M3 traffic-4 (head start): the chance a spawn in a `pedestrians` zone is an animal, when the
    // region lists any. [default]
    id: 'peds.strayAnimalChance',
    group: 'traffic',
    label: 'Animals by the road',
    default: 0.35,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: true,
    system: true,
  },
  {
    // M3 traffic-4 (head start): a scale on a big animal's reaction range. 1 = it dives as early as
    // anyone; lower = it dives late and can be hit (hitting something big crashes you). [default]
    id: 'peds.bigReactScale',
    group: 'traffic',
    label: 'Gators: reaction',
    default: 1,
    min: 0,
    max: 1.5,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    // T4.2 (playtest 3): pedestrians check for a gap before stepping onto the road and step back
    // instead of walking into a rider. 0 = the old crossers, who walked on regardless. [default]
    id: 'peds.gapAccept',
    group: 'traffic',
    label: 'Pedestrians wait for a gap',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
  },
];

/** [default] starting values. */
export const PEDS = {
  /** One pedestrian per this many metres of roadside zone. */
  perZoneM: 25,
  maxPerZone: 4,
  /**
   * Playtest 4 (P4-16, a party street): a crowd zone's own `params.everyM` and `params.maxPeds`
   * (metres of kerb per person, most people) are taken within these, so a bad number never floods
   * a road. A zone without them is as it was.
   */
  crowdMinEveryM: 3,
  maxCrowd: 16,
  /** Waiting pedestrians stand at least this far outside the drivable road, m (plus half width). */
  offRoadMarginM: 0.6,
  /** Chance a pedestrian (or an animal) is a road crosser. */
  crossChancePedestrian: 0.5,
  crossChanceAnimal: 0.8,
  /** Fallback for `peds.strayAnimalChance`: a `pedestrians` zone spawn is an animal instead. */
  strayAnimalChance: 0.35,
  /** Fallback for `peds.bigReactScale`. */
  bigReactScale: 1,
  /** Seeded wait before a crosser sets off, s (scaled time). */
  waitMinS: 2,
  waitMaxS: 12,
  /**
   * The worst-moment gag: a waiting crosser may instead step out as a rider comes, when the rider
   * is this far beyond its threat range, m (this chance per wait).
   */
  lureChance: 0.6,
  lureLeadMinM: 10,
  lureLeadMaxM: 50,
  /** The threat range: base + rider speed × reaction time, m. */
  threatBaseM: 6,
  threatReactS: 1.1,
  /** A rider this far past a pedestrian still threatens it, m. */
  threatBehindM: 1.5,
  /** Riders slower than this threaten nobody, m/s. */
  threatMinMps: 3,
  /** Side-to-side threat band beyond the two half widths, m. */
  lateralM: 1.6,
  /** The dive: sideways distance, duration (scaled time) and the arc's peak height. */
  diveDistM: 3.5,
  diveS: 0.5,
  diveHeightM: 0.8,
  /** Time lying down after a dive, s. */
  downS: 1.2,
  /** The default rider contact box; a rider whose file or bike gives one uses its own (riderHitbox). */
  riderLengthM: 2.0,
  riderWidthM: 0.8,
  /**
   * A pedestrian this far above a rider (mid-dive over it) passes over it, m. The other way round, a
   * rider passes over a pedestrian or an animal only above that one's height (its type's `heightM`,
   * vehicleHeightM; the hitbox audit's contract): it was this flat 1.5 m, over a 0.6 m alligator
   * and a 1.7 m tourist alike.
   */
  maxContactH: 1.5,
  /** A walker waits rather than step within this of a rider's box, m. */
  walkClearM: 0.4,
  /** W-P: a close pass is a rider at least this fast, its box beside the pedestrian's. */
  reactMinMps: 12,
  /** W-P: how far beyond the dive band a close pass still counts, m. */
  reactLateralM: 3,
  /** W-P: a close pass this far inside that is a hop back, m; further out, maybe a fist or a phone. */
  hopBandM: 1.5,
  /** W-P: the hop back from the kerb: distance, time (scaled) and height. */
  hopDistM: 0.7,
  hopS: 0.3,
  hopHeightM: 0.3,
  /** W-P: chance a close pass that is not a hop gets a fist or a phone. */
  passReactChance: 0.4,
  /** W-P: chance a person scared into a dive or a hop shakes a fist or films once back up. */
  scaredReactChance: 0.7,
  /** W-P: of those, the share that shake a fist (the rest film). */
  fistShare: 0.5,
  /** W-P: how long a fist or a phone stays up, s (scaled). */
  reactHoldS: 2.4,
  /** W-P: the least time before the same pedestrian reacts again, s. */
  reactCooldownS: 5,
  /** W-P: a dog's chase: how long it runs (scaled s), and the least rider speed that sets it off. */
  chaseS: 2,
  chaseMinMps: 6,
  /** W-P: a dog notices riders passing up to this far to the side, m. */
  chaseLateralM: 9,
  /** W-P: a dog trots back at this share of its running pace. */
  trotBack: 0.4,
  /** W-P: a stroller turns back this far inside its zone's ends, m. */
  strollEndM: 1,
  /** T4.2: slack on top of the time a crossing stage takes, s. */
  gapMarginS: 1,
  /** T4.2: a rider this far ahead (along the road) counts for a gap check, m. */
  gapLookM: 300,
  /** T4.2: a rider counts when its lane is within this of the stage's span, m (half a rider + 0.6). */
  gapLateralM: 1,
  /** T4.2: a pedestrian caught on the road walks at this times its pace to the nearer end of its stage. */
  hurryScale: 2.5,
  /** T4.2: the fake-out spot: this far outside the road edge (body edge), m. */
  fakeOutM: 0.15,
  /** T4.2: the longest a fake-out holds at the kerb, s (scaled). */
  fakeOutHoldS: 8,
};

/** Phase codes kept in PedsState.phase (plain numbers, so the state hashes and serializes). */
export const PED_PHASE = {
  loiter: 0,
  walk: 1,
  dive: 2,
  down: 3,
  react: 4,
  hop: 5,
  along: 6,
  fake: 7,
} as const;

/** The threat range for a rider at `speed` m/s: it grows with speed. */
export function pedThreatRangeM(speed: number): number {
  return PEDS.threatBaseM + Math.max(0, speed) * PEDS.threatReactS;
}

/**
 * The threat range a kind reacts at: pedThreatRangeM, except that a `big` kind's range scales by
 * `peds.bigReactScale` (so at 0 it never sees you coming).
 */
export function kindThreatRangeM(world: World, t: SimTrafficTypeDef, speed: number): number {
  if (roadsideClass(t) !== 'yields') return pedThreatRangeM(speed);
  const k = clamp(world.params['peds.bigReactScale'] ?? PEDS.bigReactScale, 0, 10);
  return k * pedThreatRangeM(speed);
}

/** Pedestrians' plain state, indexed by pedestrian slot. The mover holds the road position. */
export interface PedsState {
  id: number[];
  /** Index into config.trafficTypes. */
  type: number[];
  phase: number[];
  /** Seconds left in the current wait, dive or lie-down (scaled time). */
  timer: number[];
  /** 1 for a crosser. */
  crosses: number[];
  /** The two waiting spots (road d) a crosser walks between; a loiterer stays at homeD. */
  homeD: number[];
  farD: number[];
  /** Where the current walk ends. */
  targetD: number[];
  /** The current dive: from and to (road d). */
  fromD: number[];
  toD: number[];
  /** Rider entity id this pedestrian is touching, or -1. */
  touching: number[];
  /** 1 when this wait ends as a rider comes (PEDS.lureChance), not on the timer. */
  lure: number[];
  /** W-P: the roadside zone's span along the edge; strollers and chasers stay inside it. */
  zoneS0: number[];
  zoneS1: number[];
  /** W-P: where the current walk along the verge ends, and its pace, m/s. */
  targetS: number[];
  alongMps: number[];
  /** W-P: where a chaser trots back to after a chase. */
  homeS: number[];
  /** W-P: 1 while a dog is running after a rider (then it trots back). */
  chasing: number[];
  /** W-P: seconds before this pedestrian reacts again. */
  reactCooldownS: number[];
  /** W-P: the rider who scared this pedestrian into a dive or a hop (it reacts when up), or -1. */
  scaredBy: number[];
  /** W-P: the reaction showing now (REACT_CODE), 0 for none. */
  reactKind: number[];
  spawned: number;
  dives: number;
  /** Rider contacts (the acceptance says none), and car contacts (not expected either). */
  contacts: number;
  vehicleContacts: number;
  /** W-P: `pedReact` events so far. */
  reacts: number;
  /** T4.2: 1 while the walk is a gap-checked crossing (not a recovery walk off the road). */
  gated: number[];
  /** T4.2: 1 while the pedestrian hurries (PEDS.hurryScale times its pace). */
  hurry: number[];
}

export function pedsState(world: World): PedsState {
  return systemState<PedsState>(world, 'peds', () => ({
    id: [],
    type: [],
    phase: [],
    timer: [],
    crosses: [],
    homeD: [],
    farD: [],
    targetD: [],
    fromD: [],
    toD: [],
    touching: [],
    lure: [],
    zoneS0: [],
    zoneS1: [],
    targetS: [],
    alongMps: [],
    homeS: [],
    chasing: [],
    reactCooldownS: [],
    scaredBy: [],
    reactKind: [],
    spawned: 0,
    dives: 0,
    contacts: 0,
    vehicleContacts: 0,
    reacts: 0,
    gated: [],
    hurry: [],
  }));
}

// ---- helpers -----------------------------------------------------------------------------

function isPedType(t: SimTrafficTypeDef | undefined): boolean {
  return t?.category === 'pedestrian' || t?.category === 'animal';
}

/** What render and the snapshot need to know about a pedestrian entity, or null for other kinds. */
export function pedInfo(
  world: World,
  config: SimConfig,
  entityId: number,
): {
  contentId: string;
  category: 'pedestrian' | 'animal';
  lengthM: number;
  widthM: number;
  hazard: 'normal' | 'big';
} | null {
  const st = pedsState(world);
  const k = st.id.indexOf(entityId);
  const t = k < 0 ? undefined : config.trafficTypes[st.type[k] ?? -1];
  if (!t || (t.category !== 'pedestrian' && t.category !== 'animal')) return null;
  return {
    contentId: t.contentId,
    category: t.category,
    lengthM: t.lengthM,
    widthM: t.widthM,
    hazard: t.hazard,
  };
}

/**
 * A bridge walkway: a rail or wall on either side at s, or a `bridge` scenery tag over s. People
 * may stand there (the fisherman); animals never do.
 */
export function onBridgeWalkway(road: RoadNetwork, edge: number, s: number): boolean {
  if (road.barrierAt(edge, s, 'left') !== null || road.barrierAt(edge, s, 'right') !== null) return true;
  const tags = road.edges[edge]?.tags ?? [];
  return tags.some((t) => t.tag === 'bridge' && s >= t.s0 && s <= t.s1);
}

/** The drivable road's edges at (edge, s): the outer lane edges, lo < 0 < hi. */
export function roadEdges(road: RoadNetwork, edge: number, s: number): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const lane of road.lanesAt(edge, s)) {
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  return { lo, hi };
}

/** A waiting spot on `side` (+1 right, −1 left): at least `d` out, and clear of the road. */
export function offRoadD(
  road: RoadNetwork,
  edge: number,
  s: number,
  side: number,
  halfW: number,
  d = 0,
): number {
  const { lo, hi } = roadEdges(road, edge, s);
  const clear = (side > 0 ? hi : -lo) + PEDS.offRoadMarginM + halfW;
  return side * Math.max(Math.abs(d), clear);
}

export function rollWait(world: World, rng: RngState = world.rng.peds): number {
  return PEDS.waitMinS + nextFloat(rng) * (PEDS.waitMaxS - PEDS.waitMinS);
}

/**
 * Adds a pedestrian of type `type` at (edge, s, d). Used by the zone spawner and by scripted
 * scenarios. A crosser walks between homeD and farD (both default to the off-road spots nearest d
 * on each side); `timer` is its first wait.
 */
export function placePed(
  world: World,
  config: SimConfig,
  spec: {
    type: number;
    edge: number;
    s: number;
    d: number;
    crosses?: boolean;
    homeD?: number;
    farD?: number;
    timer?: number;
    lure?: boolean;
    /** W-P: the roadside zone's span along the edge (default: just s, so nobody strolls). */
    s0?: number;
    s1?: number;
    /** The stream a stroller's first direction is rolled from (default: the peds stream). */
    rng?: RngState;
  },
): number {
  const st = pedsState(world);
  const t = config.trafficTypes[spec.type];
  if (!isPedType(t)) throw new Error(`peds: traffic type ${spec.type} is not a pedestrian or animal`);
  const edgeLength = config.road.edges[spec.edge]?.length ?? spec.s;
  const half = (t?.widthM ?? 0.5) / 2;
  const side = spec.d < 0 ? -1 : 1;
  const mover = addMover(world, 'ped', { edge: spec.edge, s: spec.s, d: spec.d, dir: 1 });
  mover.yaw = -side * HALF_PI;
  st.id.push(mover.id);
  st.type.push(spec.type);
  st.phase.push(PED_PHASE.loiter);
  st.timer.push(spec.timer ?? 0);
  st.crosses.push(spec.crosses ? 1 : 0);
  st.homeD.push(spec.homeD ?? offRoadD(config.road, spec.edge, spec.s, side, half));
  st.farD.push(spec.farD ?? offRoadD(config.road, spec.edge, spec.s, -side, half));
  st.targetD.push(spec.d);
  st.fromD.push(spec.d);
  st.toD.push(spec.d);
  st.touching.push(-1);
  st.lure.push(spec.lure ? 1 : 0);
  const s0 = clamp(Math.min(spec.s0 ?? spec.s, spec.s), 0, edgeLength);
  const s1 = clamp(Math.max(spec.s1 ?? spec.s, spec.s), 0, edgeLength);
  st.zoneS0.push(s0);
  st.zoneS1.push(s1);
  st.targetS.push(spec.s);
  st.alongMps.push(0);
  st.homeS.push(spec.s);
  st.chasing.push(0);
  st.reactCooldownS.push(0);
  st.scaredBy.push(-1);
  st.reactKind.push(0);
  st.gated.push(0);
  st.hurry.push(0);
  st.spawned++;
  // A stroller (W-P) sets off along the verge at once, toward a seeded end of its zone.
  if (t && strolls(t) && s1 - s0 > 2 * PEDS.strollEndM) {
    const k = st.id.length - 1;
    startStroll(world, st, k, nextFloat(spec.rng ?? world.rng.peds) < 0.5 ? -1 : 1, t);
  }
  return mover.id;
}

/** W-P: a kind that walks along the verge rather than crossing (joggers, hikers, dog walkers). */
export function strolls(t: SimTrafficTypeDef | undefined): boolean {
  return t?.behaviour?.strolls === true && (t.cruiseMps ?? 0) > 0;
}

/** W-P: sets slot k walking along the verge toward its zone's end in direction `way` (±1 in s). */
export function startStroll(world: World, st: PedsState, k: number, way: number, t: SimTrafficTypeDef): void {
  const lo = (st.zoneS0[k] ?? 0) + PEDS.strollEndM;
  const hi = (st.zoneS1[k] ?? 0) - PEDS.strollEndM;
  const p = world.movers[st.id[k] ?? -1];
  if (!p || hi <= lo) {
    st.phase[k] = PED_PHASE.loiter;
    return;
  }
  st.phase[k] = PED_PHASE.along;
  st.chasing[k] = 0;
  st.alongMps[k] = t.cruiseMps;
  st.targetS[k] = way > 0 ? hi : lo;
  // Already at that end: the other one.
  if (Math.abs((st.targetS[k] ?? 0) - p.pos.s) < 1e-6) st.targetS[k] = way > 0 ? lo : hi;
}

/** A type's pick weight: its region weight (M2 traffic-3), else 1, so a pool without weights is even. */
function weightOf(t: SimTrafficTypeDef | undefined): number {
  const w = t?.weight ?? 1;
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/** One weighted pick from the pool, from one roll (so equal weights pick as M1's even pick did). */
function pick(world: World, config: SimConfig, pool: readonly number[]): number {
  let total = 0;
  for (const i of pool) total += weightOf(config.trafficTypes[i]);
  let r = nextFloat(world.rng.peds) * total;
  for (const i of pool) {
    r -= weightOf(config.trafficTypes[i]);
    if (r < 0) return i;
  }
  return pool[pool.length - 1] ?? -1;
}

/**
 * Real-world C0.4: the traffic types a zone's `params.kinds` names (pedestrians and animals only),
 * in the config's order, whatever the region's weights say; null when the zone names none that exist
 * (it then spawns as any other zone does). An id matches with or without its pack ("base:tourist").
 */
function zoneKinds(config: SimConfig, f: BakedFeature): readonly number[] | null {
  const raw = f.params?.['kinds'];
  if (!Array.isArray(raw)) return null;
  const want = new Set(raw.filter((k): k is string => typeof k === 'string'));
  const out: number[] = [];
  config.trafficTypes.forEach((t, i) => {
    if (!isPedType(t)) return;
    const bare = t.contentId.slice(t.contentId.indexOf(':') + 1);
    if (want.has(t.contentId) || want.has(bare)) out.push(i);
  });
  return out.length > 0 ? out : null;
}

/**
 * How many people one zone spawns: one per `PEDS.perZoneM` of its length, at most `PEDS.maxPerZone`; a
 * crowd zone (playtest 4, a party street) names its own `params.everyM` and `params.maxPeds`, kept
 * within `PEDS.crowdMinEveryM` and `PEDS.maxCrowd`. A value that is not a number is ignored.
 */
function zoneCount(f: BakedFeature, length: number): number {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const every = num(f.params?.['everyM']);
  const most = num(f.params?.['maxPeds']);
  const everyM = every === null ? PEDS.perZoneM : Math.max(PEDS.crowdMinEveryM, every);
  const cap = most === null ? PEDS.maxPerZone : Math.min(PEDS.maxCrowd, Math.floor(most));
  return Math.min(cap, Math.max(1, Math.floor(length / everyM)));
}

/** Spawns the pedestrians of one roadside zone. */
function spawnZone(
  world: World,
  config: SimConfig,
  edge: number,
  f: BakedFeature,
  people: readonly number[],
  animals: readonly number[],
  kinds: readonly number[] | null,
): void {
  const spawns = f.params?.['spawns'];
  const length = Math.max(0, f.s1 - f.s0);
  const n = zoneCount(f, length);
  const side = f.d0 + f.d1 < 0 ? -1 : 1;
  const edgeLength = config.road.edges[edge]?.length ?? 0;
  // A zone with its own kinds rolls from its own stream, so it never moves another zone's spawns.
  const own = kinds ? createRng(streamSeed(config.seed, `peds.zone:${edge}:${f.id}:${f.s0}`)) : null;
  for (let i = 0; i < n; i++) {
    const r = own ?? world.rng.peds;
    const s = clamp(f.s0 + ((i + 0.2 + 0.6 * nextFloat(r)) * length) / n, 0, edgeLength);
    const stray = clamp(world.params['peds.strayAnimalChance'] ?? PEDS.strayAnimalChance, 0, 1);
    let pool: readonly number[];
    let type: number;
    if (kinds) {
      // Only the named kinds, equally likely; a bridge walkway still takes people only.
      pool = onBridgeWalkway(config.road, edge, s)
        ? kinds.filter((k) => config.trafficTypes[k]?.category === 'pedestrian')
        : kinds;
      if (pool.length === 0) continue;
      type = pool[Math.min(pool.length - 1, Math.floor(nextFloat(r) * pool.length))] ?? -1;
    } else {
      if (spawns === 'animals') pool = animals;
      else if (spawns === 'pedestrians') pool = animals.length > 0 && nextFloat(r) < stray ? animals : people;
      else pool = [...people, ...animals];
      // A bridge walkway is no place for an animal: people only there (traffic-4).
      if (onBridgeWalkway(config.road, edge, s)) pool = people;
      else if (pool.length === 0) pool = people.length > 0 ? people : animals;
      if (pool.length === 0) continue;
      type = pick(world, config, pool);
    }
    const t = config.trafficTypes[type];
    if (!t) continue;
    const half = t.widthM / 2;
    const d = offRoadD(config.road, edge, s, side, half, f.d0 + nextFloat(r) * (f.d1 - f.d0));
    const railed =
      config.road.barrierAt(edge, s, 'left') !== null || config.road.barrierAt(edge, s, 'right') !== null;
    const chance = t.category === 'animal' ? PEDS.crossChanceAnimal : PEDS.crossChancePedestrian;
    // A kind with no walking speed (a gator on a lawn chair) stays put.
    // A stroller (W-P) walks the verge instead of crossing.
    const crosses = !railed && nextFloat(r) < chance && t.cruiseMps > 0 && !strolls(t);
    const far = offRoadD(config.road, edge, s, -side, half, 0) - side * nextFloat(r) * 1.5;
    const timer = rollWait(world, r);
    // A big kind is never lured out in front of a rider at the worst moment.
    const lure = nextFloat(r) < PEDS.lureChance && roadsideClass(t) === 'dodges';
    placePed(world, config, {
      type,
      edge,
      s,
      d,
      crosses,
      homeD: d,
      farD: far,
      timer,
      lure,
      s0: f.s0,
      s1: f.s1,
      rng: r,
    });
  }
}

export const pedsSystem: SimSystem = {
  name: 'peds',
  init(world: World, config: SimConfig) {
    pedsState(world);
    const people: number[] = [];
    const animals: number[] = [];
    config.trafficTypes.forEach((t, i) => {
      if (weightOf(t) <= 0) return; // the region lists it nowhere: never spawns
      if (t.category === 'pedestrian') people.push(i);
      else if (t.category === 'animal') animals.push(i);
    });
    for (const e of config.road.edges) {
      // Only the race route's roads: a network with longer routes carries zones past a shorter
      // route's finish, where nobody rides in this race.
      if (!config.route.allows(e.index)) continue;
      for (const f of config.road.featuresOf(e.index, 'roadsideZone')) {
        // A zone's own kinds spawn even where the region lists nobody (they are "zones only").
        const kinds = zoneKinds(config, f);
        if (!kinds && people.length + animals.length === 0) continue;
        spawnZone(world, config, e.index, f, people, animals, kinds);
      }
    }
  },
  // The step is in ./step.ts, a lazy chunk the race waits for (src/sim/late.ts).
  step: (world, config) => lateSteps().pedsStep(world, config),
};
