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
  PI,
  streamSeed,
  type RngState,
  type TuningParamDecl,
} from '../../core';
import type { BakedFeature, RoadNeighbour, RoadNetwork } from '../../road';
import type { SimConfig, SimTrafficTypeDef } from '../types';
import { roadsideClass } from '../roadside';
import { vehicleInfo } from '../traffic';
import { addMover, emit, systemState, type Mover, type SimSystem, type World } from '../world';

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
  /** The rider's contact box. */
  riderLengthM: 2.0,
  riderWidthM: 0.8,
  /** Riders higher than this above a pedestrian pass over, m. */
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

/** W-P: `pedReact` kinds, as numbers in PedsState.reactKind (0 none). */
const REACT_CODE = { jumpBack: 1, fist: 2, film: 3, chase: 4 } as const;
type ReactName = keyof typeof REACT_CODE;

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

function typeOf(config: SimConfig, st: PedsState, k: number): SimTrafficTypeDef {
  const t = config.trafficTypes[st.type[k] ?? -1];
  if (!t) throw new Error(`peds: pedestrian slot ${k} has no type`);
  return t;
}

/** The drivable road's edges at (edge, s): the outer lane edges, lo < 0 < hi. */
function roadEdges(road: RoadNetwork, edge: number, s: number): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const lane of road.lanesAt(edge, s)) {
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  return { lo, hi };
}

/** A waiting spot on `side` (+1 right, −1 left): at least `d` out, and clear of the road. */
function offRoadD(road: RoadNetwork, edge: number, s: number, side: number, halfW: number, d = 0): number {
  const { lo, hi } = roadEdges(road, edge, s);
  const clear = (side > 0 ? hi : -lo) + PEDS.offRoadMarginM + halfW;
  return side * Math.max(Math.abs(d), clear);
}

function onRoad(road: RoadNetwork, m: Mover, halfW: number): boolean {
  const { lo, hi } = roadEdges(road, m.pos.edge, m.pos.s);
  return m.pos.d + halfW > lo && m.pos.d - halfW < hi;
}

/** Riders who can threaten or touch a pedestrian: on the bike, or sliding in a crash. */
function isThreatRider(m: Mover): boolean {
  return m.kind === 'rider' && (m.mode === 'Road' || m.mode === 'Airborne' || m.mode === 'Tumble');
}

/** How far across an edge end a threat looks for pedestrians, m (beyond any threat range). */
const NEIGHBOUR_RANGE_M = 150;

/**
 * Something a pedestrian keeps clear of, found once per tick: a threatening rider, or a traffic
 * vehicle (cars do not stop for pedestrians, so pedestrians dive from them too), with its box and
 * its edge neighbours.
 */
interface Near {
  m: Mover;
  vehicle: boolean;
  /** W-P: a kerb rider (a bicycle or scooter on the shoulder): people on the verge hop, not dive. */
  kerb: boolean;
  lengthM: number;
  widthM: number;
  nb: readonly RoadNeighbour[];
}

function nearThreats(world: World, config: SimConfig): Near[] {
  const out: Near[] = [];
  const nb = (m: Mover, range = NEIGHBOUR_RANGE_M) => config.road.neighbours(m.pos.edge, m.pos.s, range);
  // With gap acceptance on, riders are looked for as far as the gap check looks (T4.2).
  const riderRange = gapAcceptOn(world) ? Math.max(NEIGHBOUR_RANGE_M, PEDS.gapLookM) : NEIGHBOUR_RANGE_M;
  for (const m of world.movers) {
    if (isThreatRider(m)) {
      out.push({
        m,
        vehicle: false,
        kerb: false,
        lengthM: PEDS.riderLengthM,
        widthM: PEDS.riderWidthM,
        nb: nb(m, riderRange),
      });
    } else if (m.kind === 'vehicle') {
      const info = vehicleInfo(world, config, m.id);
      if (info)
        out.push({
          m,
          vehicle: true,
          kerb: info.kerb,
          lengthM: info.lengthM,
          widthM: info.widthM,
          nb: nb(m),
        });
    }
  }
  return out;
}

interface Rel {
  /** Metres from the rider to the pedestrian along the road, in the rider's travel direction. */
  ahead: number;
  /** Pedestrian d − rider d, in the rider's edge frame. */
  dd: number;
  /** The rider's d in the pedestrian's edge frame. */
  riderD: number;
  /** −1 when the two edges run opposite ways (d flips between their frames). */
  sign: 1 | -1;
}

/** Where pedestrian `p` is from rider `near`, across one edge end at most; null when out of range. */
function relate(near: Near, p: Mover, range: number): Rel | null {
  const r = near.m;
  let ps = p.pos.s;
  let sign: 1 | -1 = 1;
  if (r.pos.edge !== p.pos.edge) {
    const n = near.nb.find((q) => q.edge === p.pos.edge);
    if (!n) return null;
    ps = n.sOffset + n.sSign * p.pos.s;
    sign = n.sSign;
  }
  const ahead = (ps - r.pos.s) * r.pos.dir;
  if (ahead > range || ahead < -range) return null;
  return { ahead, dd: sign * p.pos.d - r.pos.d, riderD: sign * r.pos.d, sign };
}

function rollWait(world: World, rng: RngState = world.rng.peds): number {
  return PEDS.waitMinS + nextFloat(rng) * (PEDS.waitMaxS - PEDS.waitMinS);
}

/** T4.2: whether pedestrians check for a gap (`peds.gapAccept`; absent means off). */
function gapAcceptOn(world: World): boolean {
  return (world.params['peds.gapAccept'] ?? 0) >= 0.5;
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
function strolls(t: SimTrafficTypeDef | undefined): boolean {
  return t?.behaviour?.strolls === true && (t.cruiseMps ?? 0) > 0;
}

/** W-P: a kind that runs after a passing rider (dogs). */
function chases(t: SimTrafficTypeDef | undefined): boolean {
  return t?.category === 'animal' && t.behaviour?.chases === true && (t.cruiseMps ?? 0) > 0;
}

/** W-P: sets slot k walking along the verge toward its zone's end in direction `way` (±1 in s). */
function startStroll(world: World, st: PedsState, k: number, way: number, t: SimTrafficTypeDef): void {
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

/** Starts a dive for slot k, away from the riders and cars near it, preferring to land off the road. */
function startDive(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  threat: Mover,
  bumped: boolean,
  threats: readonly Near[],
): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  const t = typeOf(config, st, k);
  const half = t.widthM / 2;
  const { lo, hi } = roadEdges(config.road, p.pos.edge, p.pos.s);
  // Keep clear of the threat, plus anyone coming who could reach the pedestrian: for each rider or
  // car, the window of time its box passes the pedestrian's s (straight on at its speed), and the
  // stretch of the dive the pedestrian covers in that window. A side scores the smallest
  // side-to-side clearance, box edge to box edge, over those stretches, so a dive that would cross
  // a rider's line as it arrives scores badly even when the landing spot is clear.
  const near: { d: number; halfW: number; t0: number; t1: number; vehicle: boolean }[] = [];
  for (const r of threats) {
    const rel = relate(r, p, pedThreatRangeM(r.m.speed) + 10);
    if (!rel) continue;
    const pass = (r.lengthM + t.lengthM) / 2 + 0.3;
    const v = r.m.speed;
    if (rel.ahead + pass < 0) continue;
    const t0 = v > 0.1 ? Math.max(0, (rel.ahead - pass) / v) : 0;
    const t1 = v > 0.1 ? (rel.ahead + pass) / v : Infinity;
    near.push({ d: rel.riderD, halfW: r.widthM / 2, t0, t1, vehicle: r.vehicle });
  }
  let best = 1;
  let bestScore = -Infinity;
  let bestClearsRiders = false;
  const from = p.pos.d;
  for (const side of [1, -1] as const) {
    const to = from + side * PEDS.diveDistM;
    const at = (time: number) => from + (to - from) * Math.min(1, time / PEDS.diveS);
    let score = Infinity;
    let riderScore = Infinity;
    for (const q of near) {
      const a = at(q.t0);
      const b = at(q.t1);
      const gap =
        q.d < Math.min(a, b) ? Math.min(a, b) - q.d : q.d > Math.max(a, b) ? q.d - Math.max(a, b) : 0;
      score = Math.min(score, gap - q.halfW - half);
      if (!q.vehicle) riderScore = Math.min(riderScore, gap - q.halfW - half);
    }
    if (!Number.isFinite(score)) score = 100;
    if (to - half >= hi || to + half <= lo) score += 0.75;
    // Tie-break: away from the road's centre line.
    if (side === (p.pos.d < 0 ? -1 : 1)) score += 1e-6;
    // Riders first (keys traffic, 2026-10-02): a car or a kerb scooter only knocks a pedestrian
    // over, but a rider must never touch one. So when a pedestrian is squeezed between them, a dive
    // that keeps clear of every rider beats one that does not, whatever the cars; otherwise the
    // score decides, as before.
    const clearsRiders = riderScore > 0;
    if (clearsRiders !== bestClearsRiders ? clearsRiders : score > bestScore) {
      bestScore = score;
      best = side;
      bestClearsRiders = clearsRiders;
    }
  }
  st.phase[k] = PED_PHASE.dive;
  st.timer[k] = PEDS.diveS;
  st.gated[k] = 0;
  st.hurry[k] = 0;
  st.fromD[k] = p.pos.d;
  st.toD[k] = p.pos.d + best * PEDS.diveDistM;
  st.dives++;
  st.chasing[k] = 0;
  st.reactKind[k] = 0;
  // A rider who sends someone diving gets a reaction once they are up (W-P).
  st.scaredBy[k] = threat.kind === 'rider' ? threat.id : -1;
  p.yaw = 0;
  emit(
    world,
    'pedDive',
    p.id,
    {
      side: best,
      kind: t.contentId,
      threatMps: threat.speed,
      rangeM: pedThreatRangeM(threat.speed),
      bumped,
    },
    { target: threat.id },
  );
}

/** Whether a rider's (or car's) box is within `pad` of a pedestrian at d. */
function boxNear(r: Near, p: Mover, t: SimTrafficTypeDef, d: number, pad: number): boolean {
  const gap = sideGap(r, p, t, d, pad);
  return gap !== null && gap < pad;
}

/**
 * Side-to-side clearance, box edge to box edge, between a rider's (or car's) box and a pedestrian
 * at d, when their boxes overlap along the road within `pad`; null when they don't.
 */
function sideGap(r: Near, p: Mover, t: SimTrafficTypeDef, d: number, pad: number): number | null {
  const rel = relate(r, p, 10);
  if (!rel) return null;
  if (Math.abs(rel.ahead) >= (r.lengthM + t.lengthM) / 2 + pad) return null;
  if (Math.abs(r.m.h - p.h) >= PEDS.maxContactH) return null;
  const dd = rel.dd + rel.sign * (d - p.pos.d);
  return Math.abs(dd) - (r.widthM + t.widthM) / 2;
}

/** Whether a rider is coming at p from just beyond its threat range (the worst-moment gag). */
function riderComing(config: SimConfig, p: Mover, threats: readonly Near[]): boolean {
  for (const near of threats) {
    // The gag plays for the players only: rivals and the cop are not lured into swerving.
    if (near.vehicle || near.m.speed < PEDS.threatMinMps) continue;
    if (config.riders[near.m.riderIndex]?.controller.kind !== 'player') continue;
    const range = pedThreatRangeM(near.m.speed);
    const rel = relate(near, p, range + PEDS.lureLeadMaxM);
    if (rel && rel.ahead >= range + PEDS.lureLeadMinM) return true;
  }
  return false;
}

// ---- T4.2: gap acceptance ----------------------------------------------------------------

/**
 * The refuge of a crossing at (edge, s): the centre line, where the drive lanes' direction flips (the
 * middle of the median when there is one). Null on a one-way road, or where the two directions'
 * lanes are not apart, so a crossing there is one stage.
 */
function refugeD(road: RoadNetwork, edge: number, s: number): number | null {
  const span = (dir: 1 | -1) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const lane of road.lanesAt(edge, s)) {
      if (lane.kind === 'shoulder' || lane.direction !== dir) continue;
      lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
      hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    }
    return { lo, hi };
  };
  const a = span(1);
  const b = span(-1);
  if (!Number.isFinite(a.lo) || !Number.isFinite(b.lo)) return null;
  if (a.hi <= b.lo) return (a.hi + b.lo) / 2;
  if (b.hi <= a.lo) return (b.hi + a.lo) / 2;
  return null;
}

/**
 * How soon the first rider who counts reaches pedestrian `p`, s, among riders whose lane lies within
 * PEDS.gapLateralM of [dLo, dHi]; Infinity when none does. A rider counts when it is fast enough
 * (PEDS.threatMinMps), ahead within PEDS.gapLookM, not yet past the pedestrian, and not far above it.
 * Cars do not count: they do not stop for people, and the dives from them stay.
 */
function riderArrivalS(
  p: Mover,
  t: SimTrafficTypeDef,
  threats: readonly Near[],
  dLo: number,
  dHi: number,
): number {
  return pressingRider(p, t, threats, dLo, dHi).arrival;
}

/** riderArrivalS, and the pressing rider's d in the pedestrian's frame (NaN when there is none). */
function pressingRider(
  p: Mover,
  t: SimTrafficTypeDef,
  threats: readonly Near[],
  dLo: number,
  dHi: number,
): { arrival: number; d: number } {
  let best = Infinity;
  let d = NaN;
  for (const near of threats) {
    if (near.vehicle) continue;
    const r = near.m;
    if (r.speed < PEDS.threatMinMps || r.h - p.h >= PEDS.maxContactH) continue;
    const rel = relate(near, p, PEDS.gapLookM);
    if (!rel) continue;
    const half = (near.lengthM + t.lengthM) / 2;
    if (rel.ahead <= -half) continue;
    if (rel.riderD < dLo - PEDS.gapLateralM || rel.riderD > dHi + PEDS.gapLateralM) continue;
    const arrival = Math.max(0, rel.ahead - half) / r.speed;
    if (arrival < best) {
      best = arrival;
      d = rel.riderD;
    }
  }
  return { arrival: best, d };
}

/** The end of the first stage of a crossing from `from` to `to`: the refuge if it lies between. */
function firstStageEnd(road: RoadNetwork, p: Mover, from: number, to: number): number {
  const refuge = refugeD(road, p.pos.edge, p.pos.s);
  if (refuge === null || Math.abs(from - refuge) < 1e-6) return to;
  return Math.sign(from - refuge) !== Math.sign(to - refuge) ? refuge : to;
}

/** Whether the first stage of a crossing from `from` to `to` is clear of riders, margin included. */
function gapClear(
  config: SimConfig,
  p: Mover,
  t: SimTrafficTypeDef,
  threats: readonly Near[],
  from: number,
  to: number,
): boolean {
  const end = firstStageEnd(config.road, p, from, to);
  const time = Math.abs(end - from) / t.cruiseMps + PEDS.gapMarginS;
  return riderArrivalS(p, t, threats, Math.min(from, end), Math.max(from, end)) >= time;
}

/**
 * One tick of a gap-checked crossing (slot k on the road, walking): the d to walk toward this tick,
 * or null to wait where it stands (at the refuge, until the next stage is clear). A pedestrian caught
 * by a rider sooner than the rest of its stage hurries to the nearer end of the stage: on, or back to
 * where the stage began (the crossing is dropped there; from the refuge it then waits for a gap).
 */
function gatedTarget(
  config: SimConfig,
  st: PedsState,
  k: number,
  p: Mover,
  t: SimTrafficTypeDef,
  threats: readonly Near[],
): number | null {
  const final = st.targetD[k] ?? p.pos.d;
  const from = st.fromD[k] ?? p.pos.d;
  const refuge = refugeD(config.road, p.pos.edge, p.pos.s);
  const crosses = refuge !== null && Math.sign(from - refuge) !== Math.sign(final - refuge);
  const mid = refuge ?? 0;
  if (crosses && Math.abs(p.pos.d - mid) < 1e-6) {
    // At the refuge: the next stage must be clear before it leaves.
    st.hurry[k] = 0;
    return gapClear(config, p, t, threats, mid, final) ? final : null;
  }
  const before = crosses && Math.sign(p.pos.d - mid) === Math.sign(from - mid);
  const end = before ? mid : final;
  if (st.hurry[k] !== 1) {
    const left = Math.abs(end - p.pos.d);
    const { arrival, d: riderD } = pressingRider(
      p,
      t,
      threats,
      Math.min(p.pos.d, end),
      Math.max(p.pos.d, end),
    );
    if (arrival < left / t.cruiseMps) {
      st.hurry[k] = 1;
      const fast = t.cruiseMps * PEDS.hurryScale;
      const start = before || !crosses ? from : mid;
      // The end that keeps clear of the rider's lane (the dive's side band) wins; failing that, the
      // end with more time to spare, like the dive's clearance score; the way on on a tie.
      const band = (PEDS.riderWidthM + t.widthM) / 2 + PEDS.lateralM;
      const clearOn = Math.abs(end - riderD) >= band;
      const clearBack = Math.abs(start - riderD) >= band;
      const back =
        clearOn !== clearBack
          ? clearBack
          : arrival - Math.abs(p.pos.d - start) / fast > arrival - left / fast;
      if (back) {
        st.gated[k] = 0;
        st.targetD[k] = start;
        return start;
      }
    }
  }
  return end;
}

/** The lured pedestrian walks to the kerb, `PEDS.fakeOutM` outside the road edge, and stops there. */
function startFakeOut(config: SimConfig, st: PedsState, k: number, p: Mover, t: SimTrafficTypeDef): void {
  const side = p.pos.d < 0 ? -1 : 1;
  const { lo, hi } = roadEdges(config.road, p.pos.edge, p.pos.s);
  const spot = (side > 0 ? hi : -lo) + PEDS.fakeOutM + t.widthM / 2;
  st.lure[k] = 0;
  st.phase[k] = PED_PHASE.fake;
  st.timer[k] = PEDS.fakeOutHoldS;
  st.targetD[k] = side * Math.min(spot, Math.abs(p.pos.d));
}

/**
 * The fake-out (the worst-moment gag): walk to the kerb, stop facing the road, and stay until no
 * rider is coming (or the hold runs out). The close pass hops it back as the rider goes by.
 */
function fakeOut(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  p: Mover,
  t: SimTrafficTypeDef,
  dt: number,
  threats: readonly Near[],
): void {
  const target = st.targetD[k] ?? p.pos.d;
  const step = clamp(target - p.pos.d, -t.cruiseMps * dt, t.cruiseMps * dt);
  p.pos.d += step;
  if (Math.abs(target - p.pos.d) > 1e-6) {
    p.speed = Math.abs(step) / Math.max(dt, 1e-9);
    p.yaw = (step >= 0 ? 1 : -1) * HALF_PI;
    return;
  }
  p.pos.d = target;
  p.speed = 0;
  p.yaw = (p.pos.d < 0 ? 1 : -1) * HALF_PI;
  const { lo, hi } = roadEdges(config.road, p.pos.edge, p.pos.s);
  if ((st.timer[k] ?? 0) <= 0 || riderArrivalS(p, t, threats, lo, hi) === Infinity) {
    resume(world, st, k, t);
  }
}

// ---- W-P: life that reacts ---------------------------------------------------------------

/** Back to what slot k does when nothing is happening: strolling the verge, or waiting. */
function resume(world: World, st: PedsState, k: number, t: SimTrafficTypeDef): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  st.chasing[k] = 0;
  st.reactKind[k] = 0;
  if (strolls(t)) {
    const lo = st.zoneS0[k] ?? p.pos.s;
    const hi = st.zoneS1[k] ?? p.pos.s;
    // Toward the further end of its zone.
    startStroll(world, st, k, hi - p.pos.s > p.pos.s - lo ? 1 : -1, t);
    if (st.phase[k] === PED_PHASE.along) return;
  }
  st.phase[k] = PED_PHASE.loiter;
  st.timer[k] = rollWait(world);
  st.lure[k] = nextFloat(world.rng.peds) < PEDS.lureChance && roadsideClass(t) === 'dodges' ? 1 : 0;
  p.speed = 0;
  p.yaw = (p.pos.d < 0 ? 1 : -1) * HALF_PI;
}

/** Emits a `pedReact` from slot k at rider `riderId`, held for `seconds` (scaled). */
function emitReact(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  kind: ReactName,
  riderId: number,
  seconds: number,
): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  st.reacts++;
  st.reactKind[k] = REACT_CODE[kind];
  st.reactCooldownS[k] = PEDS.reactCooldownS;
  const t = config.trafficTypes[st.type[k] ?? -1];
  emit(
    world,
    'pedReact',
    p.id,
    { kind, ticks: Math.round(seconds * 60), who: t?.contentId ?? '' },
    { target: riderId },
  );
}

/** A fist or a phone for slot k (people only), facing the road; false when it is not a person. */
function startGesture(world: World, config: SimConfig, st: PedsState, k: number, riderId: number): boolean {
  const t = config.trafficTypes[st.type[k] ?? -1];
  const p = world.movers[st.id[k] ?? -1];
  if (!p || t?.category !== 'pedestrian') return false;
  const kind: ReactName = nextFloat(world.rng.peds) < PEDS.fistShare ? 'fist' : 'film';
  st.phase[k] = PED_PHASE.react;
  st.timer[k] = PEDS.reactHoldS;
  p.speed = 0;
  p.yaw = (p.pos.d < 0 ? 1 : -1) * HALF_PI;
  emitReact(world, config, st, k, kind, riderId, PEDS.reactHoldS);
  return true;
}

/** Someone a rider scared reacts once on their feet, by a seeded roll. True when they do. */
function scaredReaction(world: World, config: SimConfig, st: PedsState, k: number): boolean {
  const rider = st.scaredBy[k] ?? -1;
  st.scaredBy[k] = -1;
  if (rider < 0) return false;
  const t = config.trafficTypes[st.type[k] ?? -1];
  if (t?.category !== 'pedestrian') return false;
  if (nextFloat(world.rng.peds) >= PEDS.scaredReactChance) return false;
  return startGesture(world, config, st, k, rider);
}

/** The hop back from the kerb: slot k jumps PEDS.hopDistM further from the road. */
function startHop(world: World, config: SimConfig, st: PedsState, k: number, riderId: number): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  const out = p.pos.d < 0 ? -1 : 1;
  st.phase[k] = PED_PHASE.hop;
  st.timer[k] = PEDS.hopS;
  st.fromD[k] = p.pos.d;
  st.toD[k] = p.pos.d + out * PEDS.hopDistM;
  st.scaredBy[k] = riderId;
  st.chasing[k] = 0;
  p.yaw = (p.pos.d < 0 ? 1 : -1) * HALF_PI;
  emitReact(world, config, st, k, 'jumpBack', riderId, PEDS.hopS);
}

/**
 * A dog runs after a rider (W-P): along the verge in the rider's travel direction, at its own
 * pace, for PEDS.chaseS, inside its zone; `way` is that direction in the dog's edge frame.
 */
function startChase(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  t: SimTrafficTypeDef,
  way: number,
  riderId: number,
): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  st.homeS[k] = p.pos.s;
  const lo = st.zoneS0[k] ?? p.pos.s;
  const hi = st.zoneS1[k] ?? p.pos.s;
  st.phase[k] = PED_PHASE.along;
  st.chasing[k] = 1;
  st.alongMps[k] = t.cruiseMps;
  st.targetS[k] = clamp(p.pos.s + way * t.cruiseMps * PEDS.chaseS, lo, hi);
  emitReact(world, config, st, k, 'chase', riderId, PEDS.chaseS);
}

/**
 * One tick along the verge for slot k (a stroll, a chase or the trot back): at its own pace
 * toward targetS, at the off-road distance it keeps, never onto a bridge walkway if it is an
 * animal. At the end: a chaser trots home, a stroller turns round, anyone else waits.
 */
function walkAlong(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  p: Mover,
  t: SimTrafficTypeDef,
  dt: number,
): void {
  const road = config.road;
  const target = st.targetS[k] ?? p.pos.s;
  const pace = st.alongMps[k] ?? t.cruiseMps;
  const step = clamp(target - p.pos.s, -pace * dt, pace * dt);
  const next = p.pos.s + step;
  const blocked = t.category === 'animal' && onBridgeWalkway(road, p.pos.edge, next);
  if (!blocked && step !== 0) {
    p.pos.s = next;
    const side = p.pos.d < 0 ? -1 : 1;
    p.pos.d = offRoadD(road, p.pos.edge, next, side, t.widthM / 2, st.homeD[k] ?? p.pos.d);
    p.speed = Math.abs(step) / Math.max(dt, 1e-9);
    p.yaw = step > 0 ? 0 : PI;
  }
  if (!blocked && Math.abs(target - p.pos.s) > 1e-6) return;
  p.speed = 0;
  if (st.chasing[k] === 1) {
    // The chase is over: trot back to where it was.
    st.chasing[k] = 0;
    st.targetS[k] = st.homeS[k] ?? p.pos.s;
    st.alongMps[k] = t.cruiseMps * PEDS.trotBack;
    st.reactKind[k] = 0;
    return;
  }
  if (strolls(t)) {
    const lo = (st.zoneS0[k] ?? p.pos.s) + PEDS.strollEndM;
    const hi = (st.zoneS1[k] ?? p.pos.s) - PEDS.strollEndM;
    const back = target >= (lo + hi) / 2 ? lo : hi;
    if (Math.abs(back - p.pos.s) > 1e-6 && hi > lo) {
      st.targetS[k] = back;
      st.alongMps[k] = t.cruiseMps;
      return;
    }
  }
  resume(world, st, k, t);
}

/**
 * A close pass (W-P): a rider (or a kerb rider) going by beside slot k, outside the dive band, or
 * a kerb rider inside it while k is off the road. Dogs give chase; people hop back when it is
 * close, else maybe shake a fist or film. Nothing while k is busy, on the road or cooling down.
 */
function closePass(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  threats: readonly Near[],
  dt: number,
): void {
  st.reactCooldownS[k] = Math.max(0, (st.reactCooldownS[k] ?? 0) - dt);
  const phase = st.phase[k];
  if (
    phase !== PED_PHASE.loiter &&
    phase !== PED_PHASE.along &&
    phase !== PED_PHASE.react &&
    phase !== PED_PHASE.fake
  ) {
    return;
  }
  if ((st.reactCooldownS[k] ?? 0) > 0 || st.chasing[k] === 1) return;
  const p = world.movers[st.id[k] ?? -1];
  const t = config.trafficTypes[st.type[k] ?? -1];
  if (!p || !t || onRoad(config.road, p, t.widthM / 2)) return;
  const dog = chases(t);
  for (const near of threats) {
    const r = near.m;
    if (near.vehicle && !near.kerb) continue;
    const minMps = near.kerb ? PEDS.threatMinMps : dog ? PEDS.chaseMinMps : PEDS.reactMinMps;
    if (r.speed < minMps || r.h - p.h >= PEDS.maxContactH) continue;
    const rel = relate(near, p, 30);
    if (!rel) continue;
    // Beside it now: their boxes overlap along the road (plus a metre).
    if (Math.abs(rel.ahead) > (near.lengthM + t.lengthM) / 2 + 1) continue;
    const band = (near.widthM + t.widthM) / 2 + PEDS.lateralM;
    const side = Math.abs(rel.dd);
    if (dog) {
      if (near.vehicle || side >= PEDS.chaseLateralM + band) continue;
      startChase(world, config, st, k, t, rel.sign * r.pos.dir, r.id);
      return;
    }
    if (t.category !== 'pedestrian') continue;
    if (near.kerb) {
      if (side >= band) continue;
      startHop(world, config, st, k, r.id);
      return;
    }
    if (side < band || side >= band + PEDS.reactLateralM) continue;
    if (side < band + PEDS.hopBandM) {
      startHop(world, config, st, k, r.id);
      return;
    }
    st.reactCooldownS[k] = PEDS.reactCooldownS;
    if (phase !== PED_PHASE.react && nextFloat(world.rng.peds) < PEDS.passReactChance) {
      startGesture(world, config, st, k, r.id);
    }
    return;
  }
}

/** Walks, waits, dives and lie-downs: one tick of movement for slot k. */
function move(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  dt: number,
  threats: readonly Near[],
): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  const t = typeOf(config, st, k);
  const half = t.widthM / 2;
  st.timer[k] = (st.timer[k] ?? 0) - dt;
  const phase = st.phase[k];
  if (phase === PED_PHASE.dive) {
    const u = clamp(1 - (st.timer[k] ?? 0) / PEDS.diveS, 0, 1);
    const from = st.fromD[k] ?? p.pos.d;
    const to = st.toD[k] ?? p.pos.d;
    p.pos.d = from + (to - from) * u;
    p.h = 4 * PEDS.diveHeightM * u * (1 - u);
    p.speed = dt > 0 ? PEDS.diveDistM / PEDS.diveS : 0;
    if (u >= 1) {
      p.h = 0;
      p.speed = 0;
      st.phase[k] = PED_PHASE.down;
      st.timer[k] = PEDS.downS;
    }
    return;
  }
  if (phase === PED_PHASE.down) {
    if ((st.timer[k] ?? 0) > 0) return;
    // Up again: off the road first, to the nearer side; then wait (or loiter) there.
    if (onRoad(config.road, p, half)) {
      const { lo, hi } = roadEdges(config.road, p.pos.edge, p.pos.s);
      const side = hi - p.pos.d < p.pos.d - lo ? 1 : -1;
      st.targetD[k] = offRoadD(config.road, p.pos.edge, p.pos.s, side, half);
      st.phase[k] = PED_PHASE.walk;
    } else if (!scaredReaction(world, config, st, k)) {
      resume(world, st, k, t);
    }
    return;
  }
  if (phase === PED_PHASE.hop) {
    // The hop back from the kerb (W-P): a short arc outward, then a fist or a phone, or carry on.
    const u = clamp(1 - (st.timer[k] ?? 0) / PEDS.hopS, 0, 1);
    const from = st.fromD[k] ?? p.pos.d;
    const to = st.toD[k] ?? p.pos.d;
    p.pos.d = from + (to - from) * u;
    p.h = 4 * PEDS.hopHeightM * u * (1 - u);
    p.speed = dt > 0 ? Math.abs(to - from) / PEDS.hopS : 0;
    if (u >= 1) {
      p.h = 0;
      p.speed = 0;
      if (!scaredReaction(world, config, st, k)) resume(world, st, k, t);
    }
    return;
  }
  if (phase === PED_PHASE.react) {
    // A fist or a phone held up at the road (W-P), then back to what they were doing.
    p.speed = 0;
    if ((st.timer[k] ?? 0) > 0) return;
    st.reactKind[k] = 0;
    resume(world, st, k, t);
    return;
  }
  if (phase === PED_PHASE.along) {
    walkAlong(world, config, st, k, p, t, dt);
    return;
  }
  if (phase === PED_PHASE.fake) {
    fakeOut(world, config, st, k, p, t, dt, threats);
    return;
  }
  if (phase === PED_PHASE.loiter) {
    p.speed = 0;
    if (st.crosses[k] !== 1) return;
    const gap = gapAcceptOn(world);
    // T4.2: the worst-moment gag is a fake-out at the kerb, never a step onto the road.
    if (gap && st.lure[k] === 1 && !onRoad(config.road, p, half) && riderComing(config, p, threats)) {
      startFakeOut(config, st, k, p, t);
      return;
    }
    if ((st.timer[k] ?? 0) > 0 && (gap || !(st.lure[k] === 1 && riderComing(config, p, threats)))) return;
    const home = st.homeD[k] ?? p.pos.d;
    const far = st.farD[k] ?? p.pos.d;
    const goal = Math.abs(p.pos.d - home) < Math.abs(p.pos.d - far) ? far : home;
    if (gap) {
      // T4.2: wait for a gap in the first stage (from the refuge, the same).
      if (!gapClear(config, p, t, threats, p.pos.d, goal)) return;
      st.gated[k] = 1;
      st.hurry[k] = 0;
      st.fromD[k] = p.pos.d;
    }
    st.targetD[k] = goal;
    st.phase[k] = PED_PHASE.walk;
  }
  // Walking across the road, at the kind's own pace. A walker waits for a rider or car in the way.
  // A gap-checked crossing (T4.2) walks one stage at a time and may hurry.
  let stageEnd: number | null = null;
  if (st.gated[k] === 1) {
    stageEnd = gatedTarget(config, st, k, p, t, threats);
    if (stageEnd === null) {
      p.speed = 0;
      return;
    }
  }
  const final = st.targetD[k] ?? p.pos.d;
  const target = stageEnd ?? final;
  const pace = t.cruiseMps * (st.hurry[k] === 1 ? PEDS.hurryScale : 1);
  const step = clamp(target - p.pos.d, -pace * dt, pace * dt);
  const next = p.pos.d + step;
  // Blocked only by a step that closes in on someone: a stopped rider beside a pedestrian never
  // pins them, because stepping away is always allowed.
  let blocked = false;
  for (const r of threats) {
    const after = sideGap(r, p, t, next, PEDS.walkClearM);
    if (after === null || after >= PEDS.walkClearM) continue;
    const now = sideGap(r, p, t, p.pos.d, PEDS.walkClearM);
    if (now === null || after < now) {
      blocked = true;
      break;
    }
  }
  p.speed = blocked ? 0 : Math.abs(step) / Math.max(dt, 1e-9);
  if (!blocked) p.pos.d = next;
  p.yaw = (step >= 0 ? 1 : -1) * HALF_PI;
  if (Math.abs(target - p.pos.d) < 1e-6) {
    p.pos.d = target;
    p.speed = 0;
    st.hurry[k] = 0;
    // T4.2: the refuge ends a stage, not the crossing; the next stage is checked on the next tick.
    if (target !== final) return;
    st.gated[k] = 0;
    // A stroller who walked off the road after a dive strolls on (W-P).
    if (strolls(t)) {
      resume(world, st, k, t);
      return;
    }
    st.phase[k] = PED_PHASE.loiter;
    st.timer[k] = rollWait(world);
    st.lure[k] = nextFloat(world.rng.peds) < PEDS.lureChance && roadsideClass(t) === 'dodges' ? 1 : 0;
    p.yaw = (p.pos.d < 0 ? 1 : -1) * HALF_PI;
  }
}

/**
 * Contacts first (someone already on top of a pedestrian knocks them over), then the threat check:
 * a rider or car inside pedThreatRangeM(its speed) ahead and inside the side band.
 */
function react(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  threats: readonly Near[],
  dt: number,
): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  const t = typeOf(config, st, k);
  // Contacts: counted once per toucher, and never expected.
  let touching: Near | null = null;
  for (const r of threats) {
    if (boxNear(r, p, t, p.pos.d, 0)) {
      touching = r;
      break;
    }
  }
  if (!touching) {
    st.touching[k] = -1;
  } else if (st.touching[k] !== touching.m.id) {
    st.touching[k] = touching.m.id;
    if (touching.vehicle) {
      st.vehicleContacts++;
    } else {
      st.contacts++;
      // Contact is soft for a `dodges` kind and a crash for the others (src/sim/roadside.ts).
      if (roadsideClass(t) !== 'dodges') {
        const data = { cause: 'ped', hazard: 'big', kind: t.contentId };
        emit(world, 'crash', touching.m.id, data, { target: p.id });
      }
    }
    if (st.phase[k] !== PED_PHASE.dive && roadsideClass(t) !== 'solid') {
      startDive(world, config, st, k, touching.m, true, threats);
    }
  }
  if (st.phase[k] === PED_PHASE.dive) return;
  let threat: Mover | null = null;
  let closest = Infinity;
  // A kerb rider on the shoulder never reaches someone on the verge: they hop back (closePass).
  const verge = !onRoad(config.road, p, t.widthM / 2);
  for (const near of threats) {
    const r = near.m;
    if (near.kerb && verge) continue;
    if (r.speed < PEDS.threatMinMps || r.h - p.h >= PEDS.maxContactH) continue;
    const rel = relate(near, p, kindThreatRangeM(world, t, r.speed));
    const band = (near.widthM + t.widthM) / 2 + PEDS.lateralM;
    // A crash can throw a tumbling body backward along the road, against its travel direction (a
    // head-on wipeout), so a tumble threatens both ways (found in the integration round: seed 23's
    // rival, thrown back at 20 m/s, landed on a fisherman who read him as already past).
    const behind = r.mode === 'Tumble' ? -Infinity : -PEDS.threatBehindM;
    if (!rel || rel.ahead < behind || Math.abs(rel.dd) >= band) continue;
    if (Math.abs(rel.ahead) < closest) {
      closest = Math.abs(rel.ahead);
      threat = r;
    }
  }
  // A `solid` kind stands where it is (src/sim/roadside.ts); it is not even startled.
  if (roadsideClass(t) === 'solid') return;
  if (threat) startDive(world, config, st, k, threat, false, threats);
  else closePass(world, config, st, k, threats, dt);
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
  step(world: World, config: SimConfig) {
    const st = pedsState(world);
    if (st.id.length === 0) return;
    const dt = world.timeScale / 60;
    const threats = nearThreats(world, config);
    for (let k = 0; k < st.id.length; k++) {
      move(world, config, st, k, dt, threats);
      react(world, config, st, k, threats, dt);
    }
  },
};
