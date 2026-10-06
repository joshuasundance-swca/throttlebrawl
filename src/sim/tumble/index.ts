// sim/tumble: the crash tumble, the rail and the splash, the get-up, the hand-back and the on-foot
// run-back (docs/architecture.md, "Crash tumble"; docs/milestones/M1.md, tumble-1;
// docs/milestones/M2.md, tumble-2).
//
// How a crash reaches this system: any system earlier in the tick order (controllers, riders,
// combat, cops, traffic, peds) emits a `crash` event whose `actor` is the rider who goes down.
// Optional numeric data: `sideMps` (a shove to the rider's right, m/s) and `upMps` (extra pop).
// The event's causeId is kept, so a kick → crash chain stays intact.
//
// The life of a crash, in scaled time (timers advance by timeScale each tick):
//   Tumble  a point-mass rig each for rider and bike (./rig.ts): a floppy ragdoll rider, and a
//           rigid bike that cartwheels end over end after a big impact. Contacts against the road,
//           the barrier line, and boxes built each tick from nearby traffic and riders
//           (./contacts.ts). A first contact with a car is a `crash` event (actor = the rider
//           already down, target = the car, data.contact `tumble`) and the car brakes; a first
//           contact with a riding rider wobbles them, or crashes them if it is hard enough (a new
//           `crash`, target = the rider whose body hit them). Every contact keeps the crash's
//           causeId. The mover keeps a valid road position: the rider cluster's projection, with h
//           above the surface.
//   Rail    a cluster whose centre crosses a `rail` higher than its heightM goes overboard
//           (`railOver`), falls to the water plane (world y = 0: `splash`), and after the splash
//           penalty the rider respawns at rest on the bike, on the bridge where it went over
//           (`respawn`, reason `splash`). No hand-back while a body is overboard; no swimming.
//   hand-back when every particle stays under `tumble.restMps` (1.5 m/s, nearly stopped) for 0.5 s,
//           or after `tumble.timeoutS` (3.5 s) (interview, 2026-10-02: "Trim only the waiting"; it
//           was 0.5 m/s and 5 s, so a slow last slide held the player for seconds): the bike is parked
//           at the nearest standing spot inside the drivable width, and the rider stands up
//           OnFoot (`getUp`). A rival someone knocked off (the crash's rider target, else whoever
//           landed a hit on them in the last 2 s) shakes a fist at them (`fistShake`), notes the
//           grudge (`grudgeNoted`) and starts the run-back after the get-up time. Everyone else
//           runs at once.
//   OnFoot  the rider runs to the bike in (s, d); the player steers sideways to dodge. Touching the
//           bike remounts. `skipRunBack` (player slots only) teleports to the bike and remounts
//           `tumble.skipDelayS` (3 s) after the press, or sooner: never later than running there
//           would have taken from where he stood (interview, 2026-10-02: "Skip is never slower than
//           running"); pressed during the tumble, it starts at the hand-back. The run is unchanged.
//   Road    remounted on the parked bike, rolling at `tumble.remountMps` (8 m/s, capped at the
//           bike's top speed; interview, 2026-10-02: "remount rolling"), with health restored to
//           full. The splash respawn on the bridge rolls the same way. Either way the rider is a
//           ghost to traffic for a moment (playtest 4; sim/traffic startTrafficGhost): back on the
//           bike behind stopped cars, it rides through them instead of crashing again.
//   Gap     (playtest 3; the maintainer, round 3: "the real 80 m missing span is the big jump (a miss
//           = splash, respawn on the highway)") a crash with `data.overboard` (sim/riders/gap.ts: a
//           rider past a gap's kill depth) starts with both bodies overboard (`railOver` with
//           `gap: true` for each, on the crash's tick), and a body that slides or falls into a gap
//           later goes overboard the same way (./rig.ts). The splash and its penalty are as for the
//           rail; the respawn is where the gap's `params.respawn` says (road/gap.ts): `far`, at rest
//           `respawnPastM` past its far end, or `main`, on the route's main road nearest the splash.
import {
  cos,
  nextFloat,
  secondsToTicks,
  sin,
  wrapAngle,
  type EntityId,
  type TuningParamDecl,
} from '../../core';
import {
  gapAt,
  gapById,
  gapFarSide,
  gapParams,
  nearestOnEdges,
  type BakedFeature,
  type RoadPos,
} from '../../road';
import { offRoadOn } from '../ground';
import { riderState } from '../riders';
import { RIDER_CONTACT_HALF_WIDTH_M, RIDER_HALF_LENGTH_M } from '../riders/contact';
import { furnitureOn, LIGHT_KICK, LIGHT_SCRUB } from '../riders/furniture';
import { startTrafficGhost } from '../traffic';
import { InputFlag, type SimConfig } from '../types';
import { emit, noteGrudge, systemState, type Mover, type SimSystem, type World } from '../world';
import { ownSideBand, standingBand, wallBand, type TumbleBody } from './body';
import { collideBox, nearbyBoxes, type Box } from './contacts';
import {
  centre,
  makeCluster,
  maxParticleSpeed,
  relax,
  stepCluster,
  type Cluster,
  type ClusterContact,
} from './rig';
import { REMOUNT_M, runDistance, stepRunner } from './runback';

export { drivableBand, standingBand } from './body';
export type { TumbleBody } from './body';
export type { Cluster } from './rig';

export const TUMBLE_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'tumble.restS',
    group: 'crash',
    label: 'Tumble rest time',
    default: 0.5,
    min: 0.1,
    max: 2,
    step: 0.05,
    unit: 's',
    affectsSim: true,
  },
  {
    // Interview, 2026-10-02: the tumble hands back once nearly stopped. Was a fixed 0.5 m/s.
    id: 'tumble.restMps',
    group: 'crash',
    label: 'Tumble counts as stopped under',
    default: 1.5,
    min: 0.25,
    max: 4,
    step: 0.25,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // Interview, 2026-10-02: at most about 3.5 s of tumble (was 5).
    id: 'tumble.timeoutS',
    group: 'crash',
    label: 'Tumble timeout',
    default: 3.5,
    min: 1,
    max: 10,
    step: 0.5,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'tumble.skipDelayS',
    group: 'crash',
    label: 'Skip run-back delay',
    default: 3,
    min: 0.5,
    max: 6,
    step: 0.25,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'tumble.runSpeedMps',
    group: 'crash',
    label: 'Run-back speed',
    default: 7,
    min: 3,
    max: 12,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // Interview, 2026-10-02: "remount rolling". Was 0 (a standing start, about 9 s to speed).
    id: 'tumble.remountMps',
    group: 'crash',
    label: 'Remount rolling speed',
    default: 8,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    id: 'tumble.splashPenaltyS',
    group: 'crash',
    label: 'Splash penalty',
    default: 4,
    min: 1,
    max: 10,
    step: 0.5,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'tumble.getUpS',
    group: 'crash',
    label: 'Rival get-up and fist shake',
    default: 1.5,
    min: 0,
    max: 4,
    step: 0.1,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'tumble.contactCrashMps',
    group: 'crash',
    label: 'Flying body knocks a rider off at',
    default: 12,
    min: 4,
    max: 30,
    step: 1,
    unit: 'm/s',
    affectsSim: true,
  },
];

/**
 * Sliding friction, as a multiple of g, and the share of the riding speed each body is thrown
 * with. High friction and a rider thrown mostly upward keep a top-speed crash short (about 3 s to
 * the hand-back) and land the rider a few metres from the bike, so the run-back starts fast.
 */
const RIDER_MU = 1.6;
const BIKE_MU = 2.2;
const RIDER_THROW = 0.55;
const BIKE_THROW = 0.75;
/** At or above this riding speed a crash is a big one: the bike cartwheels end over end (m/s). */
const CARTWHEEL_MPS = 12;
/** A hit this recent names who knocked a rider off (the takedown attribution window, 2 s). */
const BLAME_TICKS = 120;
/** Of the get-up time, the share spent standing up before the fist shake. */
const FIST_AT = 1 / 3;
/** An overboard body that has not reached the water after this long splashes anyway (scaled). */
const OVERBOARD_MAX_TICKS = 180;
/** A car a flying body hits keeps this share of its speed: it brakes (hard hit, soft hit). */
const CAR_KEEP_HARD = 0.4;
const CAR_KEEP_SOFT = 0.8;
/** A closing speed at or above this is a hard hit on a car (m/s). */
const CAR_HARD_MPS = 4;
/** A rider a body brushes keeps this share of speed, and is turned this far away (rad). */
const WOBBLE_KEEP = 0.85;
const WOBBLE_YAW = 0.15;

/** One rider's crash, from the crash tick to the remount (or the respawn). Plain data. */
export interface TumbleRecord {
  phase: 'tumble' | 'onFoot';
  crashTick: number;
  /** The crash event's causeId, for cause chains. */
  causeId: number;
  /** Tick of the hand-back, or -1 while tumbling. */
  handbackTick: number;
  /** Scaled ticks since the crash. */
  elapsed: number;
  /** Scaled ticks every particle has been at rest. */
  rest: number;
  /** The centres (and mean velocities) of the two clusters, for the snapshot and the hand-back. */
  rider: TumbleBody;
  bike: TumbleBody;
  /** The point-mass rigs. */
  riderRig: Cluster;
  bikeRig: Cluster;
  /** Spin of the rider's box about the vertical, rad/s (for the look only). */
  spin: number;
  /** Unit world direction the rider was travelling at the crash; decides dir after projection. */
  travelX: number;
  travelZ: number;
  /**
   * The rider's way along the route at the crash: 1 with it, -1 against it, 0 off the route. The
   * hand-back faces the same way along the route wherever the body comes to rest (playtest 2's
   * real-road hairpins could reverse the world-direction test). Absent in records from before it.
   */
  routeWay?: 1 | -1 | 0;
  /** Where the bike is parked after the hand-back, else null. */
  parked: RoadPos | null;
  /** Scaled ticks since a skip began, or -1. */
  skip: number;
  /** Scaled ticks the skip waits: the skip delay, or the run from where he stood if shorter. */
  skipTicks: number;
  /** A skip pressed during the tumble, to start at the hand-back. */
  skipQueued: boolean;
  /** Who knocked this rider off, or -1. */
  blame: EntityId;
  /** Entities the bodies have touched this crash (one contact event each). */
  touched: EntityId[];
  /** Where the first body went over a rail, else null: the respawn spot. */
  railAt: RoadPos | null;
  /**
   * The gap the first body went overboard through (playtest 3): its edge and feature id. Then the
   * gap's `params.respawn` decides the respawn spot, not `railAt`. Absent for every other crash, so
   * a race with no gap hashes as before.
   */
  gap?: { edge: number; id: string };
  /** Scaled ticks since the first body went overboard, or -1. */
  overboard: number;
  /** Tick of the first splash, or -1, and scaled ticks since it (the penalty clock). */
  splashTick: number;
  splashElapsed: number;
  /** Scaled ticks of the get-up left before the run-back (rivals someone knocked off). */
  getUp: number;
  /** The get-up's full length, and whether the fist shake has happened. */
  getUpTotal: number;
  fistShaken: boolean;
}

export interface TumbleState {
  /** By entity id: the rider's crash in progress, or null. */
  records: (TumbleRecord | null)[];
  /** By entity id: the last rider to land a hit on them, and the tick (for blame). */
  hitBy: EntityId[];
  hitTick: number[];
  /**
   * By entity id: whose parked bike the rider rode into last tick, that rider's id + 1 (0 for none;
   * playtest 4, `parkedBikeContacts`), so one bike is ridden through once. Absent in old states.
   */
  bikeTouch?: number[];
}

export function tumbleState(world: World): TumbleState {
  return systemState<TumbleState>(world, 'tumble', () => ({
    records: [],
    hitBy: [],
    hitTick: [],
    bikeTouch: [],
  }));
}

/** A parked bike's box (the rider box the bike models are fitted to, render/riders/bake.ts) and its top, m. */
const PARKED_BIKE_HALF_LENGTH_M = RIDER_HALF_LENGTH_M;
const PARKED_BIKE_HALF_WIDTH_M = RIDER_CONTACT_HALF_WIDTH_M;
const PARKED_BIKE_TOP_M = 1.2;

/**
 * A riding rider meeting another rider's parked bike (playtest 4: the hitbox audit found the bikes left
 * standing while their riders run back to them drawn with no sim shape, so anyone rode through them). A
 * parked bike is knocked aside, not ridden into as a wall (docs/content-packs.md, "Contact outcomes":
 * light or knockable things): the rider rides through it once with a light street piece's cost (a
 * little speed and a heading kick, sim/riders/furniture.ts) and a `wobble` whose `cause` is `smash`
 * (`object` `parked-bike`, target its rider), never a crash, so a bike left on a lane after a crash never
 * brings down the rider behind it. Off with `riders.furniture`.
 */
function parkedBikeContacts(world: World, st: TumbleState): void {
  if (!furnitureOn(world.params)) return;
  const touch = (st.bikeTouch ??= []);
  for (const m of world.movers) {
    if (m.kind !== 'rider' || (m.mode !== 'Road' && m.mode !== 'Airborne') || m.h > PARKED_BIKE_TOP_M)
      continue;
    let met = 0;
    for (const owner of world.movers) {
      const bike = owner.id === m.id ? null : (st.records[owner.id]?.parked ?? null);
      if (!bike || bike.edge !== m.pos.edge) continue;
      if (Math.abs(bike.s - m.pos.s) >= PARKED_BIKE_HALF_LENGTH_M + RIDER_HALF_LENGTH_M) continue;
      if (Math.abs(bike.d - m.pos.d) >= PARKED_BIKE_HALF_WIDTH_M + RIDER_CONTACT_HALF_WIDTH_M) continue;
      met = owner.id + 1;
      if (touch[m.id] === met) break;
      const toward = bike.d >= m.pos.d ? 1 : -1;
      m.speed *= LIGHT_SCRUB;
      m.yaw = Math.max(-1.2, Math.min(1.2, m.yaw - toward * m.pos.dir * LIGHT_KICK));
      emit(
        world,
        'wobble',
        m.id,
        { cause: 'smash', object: 'parked-bike', speed: m.speed },
        { target: owner.id },
      );
      break;
    }
    touch[m.id] = met;
  }
}

/** The crash in progress for an entity, or null. */
export function tumbleRecord(world: World, id: EntityId): TumbleRecord | null {
  return tumbleState(world).records[id] ?? null;
}

/** Whether a rider is down: tumbling or on foot (the cop's bust reads this). */
export function isDown(world: World, id: EntityId): boolean {
  const m = world.movers[id];
  return m !== undefined && (m.mode === 'Tumble' || m.mode === 'OnFoot');
}

/** The parked bike of a rider on foot, or null. */
export function parkedBike(world: World, id: EntityId): RoadPos | null {
  return tumbleRecord(world, id)?.parked ?? null;
}

function param(world: World, id: string): number {
  const decl = TUMBLE_TUNING.find((d) => d.id === id);
  return world.params[id] ?? decl?.default ?? 0;
}

function num(data: Readonly<Record<string, unknown>>, key: string): number {
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Travel direction relative to an edge's s, from a world direction. */
function dirAlong(config: SimConfig, edge: number, s: number, x: number, z: number): 1 | -1 {
  const f = config.road.frameAt(edge, s);
  return f.tx * x + f.tz * z >= 0 ? 1 : -1;
}

/** The route's way along an edge's s (1 or -1), or 0 when the route does not run along it. */
function routeOrient(config: SimConfig, edge: number): 1 | -1 | 0 {
  const len = config.road.edges[edge]?.length ?? 0;
  const p0 = config.route.progressAt(edge, 0);
  const p1 = config.route.progressAt(edge, len);
  if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 === p1) return 0;
  return p1 > p0 ? 1 : -1;
}

/** Whether travelling `dir` along `edge` goes with the route (1), against it (-1), or neither (0). */
function routeWay(config: SimConfig, edge: number, dir: 1 | -1): 1 | -1 | 0 {
  const o = routeOrient(config, edge);
  return o === 0 ? 0 : o === dir ? 1 : -1;
}

/**
 * The direction a rider is handed back facing on `edge`: the same way along the route as at the
 * crash when both edges are on the route, else the crash's world travel direction there.
 */
function handBackDir(config: SimConfig, r: TumbleRecord, edge: number, s: number): 1 | -1 {
  const o = routeOrient(config, edge);
  const way = r.routeWay ?? 0;
  if (o !== 0 && way !== 0) return way === 1 ? o : o === 1 ? -1 : 1;
  return dirAlong(config, edge, s, r.travelX, r.travelZ);
}

/** Who knocked a rider off: the crash's rider target, else a hit in the last 2 s, else -1. */
function blameFor(world: World, id: EntityId, target: EntityId | undefined): EntityId {
  if (target !== undefined && target !== id && world.movers[target]?.kind === 'rider') return target;
  const st = tumbleState(world);
  const by = st.hitBy[id] ?? -1;
  if (by >= 0 && by !== id && world.tick - (st.hitTick[id] ?? -Infinity) <= BLAME_TICKS) return by;
  return -1;
}

function startCrash(
  world: World,
  config: SimConfig,
  m: Mover,
  data: Readonly<Record<string, unknown>>,
  causeId: number,
  blame: EntityId,
  touched: EntityId,
) {
  const road = config.road;
  const rng = world.rng.tumble;
  const pos = m.pos;
  // Forward: the road tangent in the travel direction, turned by yaw toward the rider's right.
  const f = road.frameAt(pos.edge, pos.s);
  const tx = f.tx * pos.dir;
  const tz = f.tz * pos.dir;
  const c = cos(m.yaw);
  const s = sin(m.yaw);
  const fx = c * tx - s * tz;
  const fz = c * tz + s * tx;
  // The rider's right in the world (the right of a horizontal direction (x, z) is (−z, x)).
  const rx = -fz;
  const rz = fx;
  const v = m.speed;
  const side = num(data, 'sideMps');
  const up = num(data, 'upMps');
  // Rolls, always in this order, from the tumble stream.
  const riderSide = (nextFloat(rng) - 0.5) * 4 + side;
  const riderUp = 3 + 3 * nextFloat(rng) + up;
  const bikeSide = (nextFloat(rng) - 0.5) * 3 + 0.7 * side;
  const bikeUp = 0.8 + 1.2 * nextFloat(rng) + 0.5 * up;
  const spin = (nextFloat(rng) - 0.5) * 16;
  const riderPitch = 2 + 4 * nextFloat(rng);
  const riderRoll = (nextFloat(rng) - 0.5) * 6;
  const big = v >= CARTWHEEL_MPS;
  const bikePitch = big ? 5 + 4 * nextFloat(rng) : 2 * nextFloat(rng);
  const bikeRoll = (nextFloat(rng) - 0.5) * (big ? 3 : 6);
  const base = road.toWorld(pos.edge, pos.s, pos.d, m.h);
  const frame = { fx, fz, rx, rz };
  // Angular velocity: pitch forward (the top goes forward: about −right), roll about forward,
  // and the rider's spin about the vertical.
  const turn = (pitch: number, roll: number, yaw: number) => ({
    x: -rx * pitch + fx * roll,
    y: yaw,
    z: -rz * pitch + fz * roll,
  });
  const riderRig = makeCluster(
    'rider',
    base,
    frame,
    { x: fx * v * RIDER_THROW + rx * riderSide, y: riderUp, z: fz * v * RIDER_THROW + rz * riderSide },
    turn(riderPitch, riderRoll, spin),
    pos.edge,
  );
  const bikeRig = makeCluster(
    'bike',
    base,
    frame,
    { x: fx * v * BIKE_THROW + rx * bikeSide, y: bikeUp, z: fz * v * BIKE_THROW + rz * bikeSide },
    turn(bikePitch, bikeRoll, 0),
    pos.edge,
  );
  const record: TumbleRecord = {
    phase: 'tumble',
    crashTick: world.tick,
    causeId,
    handbackTick: -1,
    elapsed: 0,
    rest: 0,
    rider: centre(riderRig.p),
    bike: centre(bikeRig.p),
    riderRig,
    bikeRig,
    spin,
    travelX: tx,
    travelZ: tz,
    routeWay: routeWay(config, pos.edge, pos.dir),
    parked: null,
    skip: -1,
    skipTicks: 0,
    skipQueued: false,
    blame,
    // The entity that caused the crash is not "hit" again by the bodies it throws off.
    touched: touched >= 0 ? [touched] : [],
    railAt: null,
    overboard: -1,
    splashTick: -1,
    splashElapsed: -1,
    getUp: 0,
    getUpTotal: 0,
    fistShaken: false,
  };
  tumbleState(world).records[m.id] = record;
  m.mode = 'Tumble';
  if (data['overboard'] === true) startOverboard(world, config, m, record, data);
}

/**
 * A crash that starts overboard (sim/riders/gap.ts: a rider past a gap's kill depth, or into the far
 * deck's broken end): both bodies fall free at once, each with a `railOver` (`gap: true`), and the
 * gap it fell through (`data.feature`, else the one under it) decides the respawn.
 */
function startOverboard(
  world: World,
  config: SimConfig,
  m: Mover,
  r: TumbleRecord,
  data: Readonly<Record<string, unknown>>,
): void {
  const pos = m.pos;
  const id = data['feature'];
  const f =
    (typeof id === 'string' ? gapById(config.road, pos.edge, id) : null) ??
    gapAt(config.road, pos.edge, pos.s, pos.d);
  if (f) r.gap = { edge: pos.edge, id: f.id };
  r.railAt = { edge: pos.edge, s: pos.s, d: pos.d, dir: pos.dir };
  r.overboard = 0;
  for (const c of [r.riderRig, r.bikeRig]) {
    c.overboard = true;
    emit(world, 'railOver', m.id, { body: c.kind, gap: true }, { causeId: r.causeId });
  }
}

function isPlayer(config: SimConfig, m: Mover): boolean {
  return config.riders[m.riderIndex]?.controller.kind === 'player';
}

function wantsSkip(world: World, config: SimConfig, m: Mover): boolean {
  return isPlayer(config, m) && ((world.inputs[m.id]?.flags ?? 0) & InputFlag.skipRunBack) !== 0;
}

/** A first contact between a crash body and a box: events, and the car or the rider reacts. */
function onContact(
  world: World,
  config: SimConfig,
  m: Mover,
  r: TumbleRecord,
  body: Cluster,
  box: Box,
  impact: number,
): void {
  const other = world.movers[box.id];
  if (!other) return;
  const impactMps = Math.round(impact * 100) / 100;
  if (box.kind === 'vehicle') {
    emit(
      world,
      'crash',
      m.id,
      { cause: 'tumble', contact: 'tumble', body: body.kind, vehicle: box.contentId, impactMps },
      { target: box.id, causeId: r.causeId },
    );
    other.speed *= impact >= CAR_HARD_MPS ? CAR_KEEP_HARD : CAR_KEEP_SOFT;
    return;
  }
  if (other.mode !== 'Road' && other.mode !== 'Airborne') return;
  if (impact >= param(world, 'tumble.contactCrashMps')) {
    const data = { cause: 'tumble', body: body.kind, by: m.id, impactMps };
    emit(world, 'crash', other.id, data, { target: m.id, causeId: r.causeId });
    // This phase has already read this tick's crashes, so the knocked rider goes down here.
    startCrash(world, config, other, data, r.causeId, m.id, m.id);
    return;
  }
  emit(
    world,
    'wobble',
    other.id,
    { cause: 'tumble', body: body.kind, impactMps },
    { target: m.id, causeId: r.causeId },
  );
  other.speed *= WOBBLE_KEEP;
  // Turned away from the body that hit it.
  const at = centre(body.p);
  const f = config.road.frameAt(other.pos.edge, other.pos.s);
  const rightX = -f.tz * other.pos.dir;
  const rightZ = f.tx * other.pos.dir;
  const away = (box.cx - at.x) * rightX + (box.cz - at.z) * rightZ >= 0 ? 1 : -1;
  other.yaw = wrapAngle(other.yaw + away * WOBBLE_YAW);
}

/** Contacts for one cluster against the boxes near it. */
function contacts(
  world: World,
  config: SimConfig,
  m: Mover,
  r: TumbleRecord,
  c: Cluster,
  near: ClusterContact,
): void {
  if (c.overboard) return;
  const at = centre(c.p);
  let pushed = false;
  for (const box of nearbyBoxes(world, config, near, at.x, at.z, m.id)) {
    const impact = collideBox(c, box);
    if (impact < 0) continue;
    pushed = true;
    if (r.touched.includes(box.id)) continue;
    r.touched.push(box.id);
    onContact(world, config, m, r, c, box, impact);
  }
  // Single particles were pushed out of a box: pull the cluster back into shape.
  if (pushed) relax(c);
}

/** The rail and the splash events for one cluster's step. */
function railEvents(world: World, m: Mover, r: TumbleRecord, c: Cluster, at: ClusterContact): void {
  if (at.railOver) {
    // Into a gap (playtest 3, ./rig.ts) rather than over a rail: flagged, and the gap is kept.
    const data = at.gap === undefined ? { body: c.kind } : { body: c.kind, gap: true };
    emit(world, 'railOver', m.id, data, { causeId: r.causeId });
    // The first body over decides the respawn: a rail's spot, or the gap's rule.
    if (r.overboard < 0 && at.gap !== undefined) r.gap = { ...at.gap };
    if (r.overboard < 0) r.overboard = 0;
    r.railAt ??= { edge: at.edge, s: at.s, d: at.d, dir: m.pos.dir };
  }
  if (at.splash) splash(world, m, r, c);
}

/** A cluster reached the water: the event, and the penalty clock starts at the first one. */
function splash(world: World, m: Mover, r: TumbleRecord, c: Cluster): void {
  const at = centre(c.p);
  const penaltyTicks = secondsToTicks(param(world, 'tumble.splashPenaltyS'));
  emit(world, 'splash', m.id, { body: c.kind, penaltyTicks, x: at.x, z: at.z }, { causeId: r.causeId });
  if (r.splashTick < 0) {
    r.splashTick = world.tick;
    r.splashElapsed = 0;
  }
}

function stepTumble(world: World, config: SimConfig, m: Mover, r: TumbleRecord, dt: number): void {
  const road = config.road;
  const ts = world.timeScale;
  if (wantsSkip(world, config, m)) r.skipQueued = true;
  if (dt > 0) {
    const offRoad = offRoadOn(world.params);
    const on = stepCluster(road, r.riderRig, dt, RIDER_MU, offRoad);
    const bikeAt = stepCluster(road, r.bikeRig, dt, BIKE_MU, offRoad);
    contacts(world, config, m, r, r.riderRig, on);
    contacts(world, config, m, r, r.bikeRig, bikeAt);
    railEvents(world, m, r, r.riderRig, on);
    railEvents(world, m, r, r.bikeRig, bikeAt);
    r.rider = { ...centre(r.riderRig.p), edge: on.edge };
    r.bike = { ...centre(r.bikeRig.p), edge: bikeAt.edge };
    const band = wallBand(road, on.edge, on.s, offRoad);
    m.pos.edge = on.edge;
    m.pos.s = on.s;
    m.pos.d = on.d < band.lo ? band.lo : on.d > band.hi ? band.hi : on.d;
    m.pos.dir = dirAlong(config, on.edge, on.s, r.travelX, r.travelZ);
    m.h = Math.max(0, r.rider.y - on.ground);
    m.speed = Math.sqrt(r.rider.vx * r.rider.vx + r.rider.vy * r.rider.vy + r.rider.vz * r.rider.vz);
    m.yaw = wrapAngle(m.yaw + r.spin * dt);
    if (m.h <= 0.05) r.spin *= Math.max(0, 1 - 1.5 * dt);
  }
  r.elapsed += ts;
  if (r.overboard >= 0) {
    // Over the rail: no hand-back. The splash penalty runs, then the respawn on the bridge.
    if (r.splashTick < 0) {
      r.overboard += ts;
      if (r.overboard >= OVERBOARD_MAX_TICKS) {
        for (const c of [r.riderRig, r.bikeRig]) {
          if (!c.overboard || c.splashed) continue;
          c.splashed = true;
          for (const q of c.p) {
            q.vx = 0;
            q.vy = 0;
            q.vz = 0;
          }
          splash(world, m, r, c);
        }
      }
      return;
    }
    if (r.splashTick !== world.tick) r.splashElapsed += ts;
    if (r.splashElapsed >= secondsToTicks(param(world, 'tumble.splashPenaltyS')))
      respawn(world, config, m, r);
    return;
  }
  const restMps = param(world, 'tumble.restMps');
  const atRest = maxParticleSpeed(r.riderRig) < restMps && maxParticleSpeed(r.bikeRig) < restMps;
  r.rest = atRest ? r.rest + ts : 0;
  const restTicks = secondsToTicks(param(world, 'tumble.restS'));
  const timeoutTicks = secondsToTicks(param(world, 'tumble.timeoutS'));
  if (r.rest >= restTicks || r.elapsed >= timeoutTicks) handBack(world, config, m, r);
}

/** Parks the bike at the nearest standing spot and stands the rider up on foot beside it. */
function handBack(world: World, config: SimConfig, m: Mover, r: TumbleRecord): void {
  const road = config.road;
  const place = (b: TumbleBody, ownSide: boolean): RoadPos => {
    const p = road.project(b.x, b.z, b.edge);
    const dir = handBackDir(config, r, p.edge, p.s);
    const band = ownSide ? ownSideBand(road, p.edge, p.s, dir) : standingBand(road, p.edge, p.s);
    const d = p.d < band.lo ? band.lo : p.d > band.hi ? band.hi : p.d;
    return { edge: p.edge, s: p.s, d, dir };
  };
  // The bike is parked on the rider's own side of the road, so the remount never faces traffic.
  const bike = place(r.bike, true);
  r.parked = bike;
  r.phase = 'onFoot';
  r.handbackTick = world.tick;
  m.mode = 'OnFoot';
  m.h = 0;
  m.speed = 0;
  emit(world, 'getUp', m.id, { crashTick: r.crashTick }, { causeId: r.causeId });
  const def = config.riders[m.riderIndex];
  if (def?.role === 'rival' && r.blame >= 0) {
    r.getUpTotal = secondsToTicks(param(world, 'tumble.getUpS'));
    r.getUp = r.getUpTotal;
  }
  m.pos = place(r.rider, false);
  if (r.skipQueued) startSkip(world, config, m, r, bike);
}

/**
 * A skip: to the bike at once, and back on it after the skip delay, or after the time the run from
 * here would have taken if that is shorter (Skip is never slower than running).
 */
function startSkip(world: World, config: SimConfig, m: Mover, r: TumbleRecord, bike: RoadPos): void {
  const runM = Math.max(0, runDistance(config.road, m.pos, bike) - REMOUNT_M);
  const runTicks = Math.ceil((runM / Math.max(0.1, param(world, 'tumble.runSpeedMps'))) * 60);
  r.skipTicks = Math.min(secondsToTicks(param(world, 'tumble.skipDelayS')), runTicks);
  m.pos = { ...bike };
  m.speed = 0;
  r.skip = 0;
}

/** The get-up pause of a rival someone knocked off: stand, shake a fist, note the grudge. */
function stepGetUp(world: World, m: Mover, r: TumbleRecord): void {
  r.getUp = Math.max(0, r.getUp - world.timeScale);
  m.speed = 0;
  if (!r.fistShaken && r.getUpTotal - r.getUp >= r.getUpTotal * FIST_AT) {
    r.fistShaken = true;
    emit(world, 'fistShake', m.id, {}, { target: r.blame, causeId: r.causeId });
    emit(world, 'grudgeNoted', m.id, {}, { target: r.blame, causeId: r.causeId });
    noteGrudge(world, m.id, r.blame);
  }
}

function stepOnFoot(world: World, config: SimConfig, m: Mover, r: TumbleRecord, dt: number): void {
  const bike = r.parked;
  if (!bike) return;
  if (r.getUp > 0 || (r.getUpTotal > 0 && !r.fistShaken)) {
    stepGetUp(world, m, r);
    return;
  }
  if (r.skip >= 0) {
    r.skip += world.timeScale;
    m.speed = 0;
    if (r.skip >= r.skipTicks) remount(world, config, m, bike);
    return;
  }
  if (runDistance(config.road, m.pos, bike) <= REMOUNT_M) {
    remount(world, config, m, bike);
    return;
  }
  if (wantsSkip(world, config, m)) {
    startSkip(world, config, m, r, bike);
    if (r.skipTicks <= 0) remount(world, config, m, bike);
    return;
  }
  const steer = isPlayer(config, m) ? (world.inputs[m.id]?.steer ?? 0) / 127 : 0;
  const run = stepRunner(config.road, m.pos, bike, param(world, 'tumble.runSpeedMps'), steer, dt, m.yaw);
  m.yaw = run.yaw;
  m.speed = dt > 0 ? run.moved / dt : 0;
}

/**
 * After the splash penalty: back on the bike, at rest, on the bridge where the body went over; or,
 * through a gap, where the gap's `params.respawn` says (gapRespawn).
 */
function respawn(world: World, config: SimConfig, m: Mover, r: TumbleRecord): void {
  const gap = r.gap ? gapById(config.road, r.gap.edge, r.gap.id) : null;
  const woke = gap && r.gap ? gapRespawn(config, m, r, r.gap.edge, gap) : null;
  const at = woke?.pos ?? r.railAt ?? m.pos;
  const dir = woke ? woke.pos.dir : handBackDir(config, r, at.edge, at.s);
  const band = ownSideBand(config.road, at.edge, at.s, dir);
  const d = at.d < band.lo ? band.lo : at.d > band.hi ? band.hi : at.d;
  const pos: RoadPos = { edge: at.edge, s: at.s, d, dir };
  const data = { reason: 'splash', crashTick: r.crashTick, splashTick: r.splashTick };
  emit(world, 'respawn', m.id, woke && gap ? { ...data, gap: gap.id, at: woke.at } : data, {
    causeId: r.causeId,
  });
  remount(world, config, m, pos);
}

/**
 * Where a rider who went into gap `f` (on `edge`) wakes, facing the way it was going along the route:
 * `far`, `respawnPastM` past the gap's far end on its own road (road/gap.ts, gapFarSide); `main`, on
 * the route's main road at the point nearest the rider's splash (the Seven Mile's Moser gap: "respawn
 * on the highway"), or past the gap there if that point is on one. A route with no main road wakes
 * it on the far side.
 */
function gapRespawn(
  config: SimConfig,
  m: Mover,
  r: TumbleRecord,
  edge: number,
  f: BakedFeature,
): { pos: RoadPos; at: 'far' | 'main' } {
  const road = config.road;
  const from = r.railAt ?? m.pos;
  if (gapParams(f).respawn === 'main') {
    const near = nearestOnEdges(road, config.route.mainEdges, r.rider.x, r.rider.z);
    if (near) {
      const dir = handBackDir(config, r, near.edge, near.s);
      const hole = gapAt(road, near.edge, near.s, near.d);
      const pos = hole ? gapFarSide(road, near.edge, hole, dir, near.d) : { ...near, dir };
      return { pos, at: 'main' };
    }
  }
  const dir = handBackDir(config, r, edge, (f.s0 + f.s1) / 2);
  return { pos: gapFarSide(road, edge, f, dir, from.d), at: 'far' };
}

/**
 * Back on the bike, rolling at tumble.remountMps (capped at its top speed), with full health, and a
 * ghost to traffic for a moment (sim/traffic, startTrafficGhost; playtest 4).
 */
function remount(world: World, config: SimConfig, m: Mover, bike: RoadPos): void {
  const def = config.riders[m.riderIndex];
  m.mode = 'Road';
  m.pos = { ...bike };
  m.h = 0;
  m.speed = Math.max(0, Math.min(param(world, 'tumble.remountMps'), def?.bike.topSpeedMps ?? 0));
  m.yaw = 0;
  if (def) riderState(world).health[m.id] = def.healthMax;
  tumbleState(world).records[m.id] = null;
  // A fair restart (playtest 4): for a moment traffic passes through the rider, so a bike parked
  // behind stopped cars, or a respawn among them, never crashes again at once.
  startTrafficGhost(world, m.id);
}

export const tumbleSystem: SimSystem = {
  name: 'tumble',
  init(world: World) {
    const st = tumbleState(world);
    for (const m of world.movers) {
      st.records[m.id] = null;
      st.hitBy[m.id] = -1;
      st.hitTick[m.id] = -1;
    }
  },
  step(world: World, config: SimConfig) {
    const st = tumbleState(world);
    // Hits landed earlier this tick: who to blame if the target goes down soon.
    for (const e of world.events) {
      if (e.type !== 'hit' || e.target === undefined) continue;
      st.hitBy[e.target] = e.actor;
      st.hitTick[e.target] = world.tick;
    }
    // Crashes emitted earlier this tick, in emission order. A rider already down ignores more.
    const count = world.events.length;
    for (let i = 0; i < count; i++) {
      const e = world.events[i];
      if (!e || e.type !== 'crash') continue;
      const m = world.movers[e.actor];
      if (!m || m.kind !== 'rider' || (m.mode !== 'Road' && m.mode !== 'Airborne')) continue;
      const blame = blameFor(world, m.id, e.target);
      startCrash(world, config, m, e.data, e.causeId ?? 0, blame, e.target ?? -1);
    }
    const dt = world.timeScale / 60;
    for (const m of world.movers) {
      const r = st.records[m.id];
      if (!r || r.crashTick === world.tick) continue;
      if (r.phase === 'tumble') stepTumble(world, config, m, r, dt);
      else stepOnFoot(world, config, m, r, dt);
    }
    parkedBikeContacts(world, st);
  },
};
