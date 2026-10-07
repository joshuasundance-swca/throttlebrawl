// The crash and the run back: the system's step (sim/tumble), the code only a running race needs. It loads after the first
// screen, in the sim's step chunk (src/sim/late.ts; scripts/sim-chunk.mjs SIM_STEPS_TEST), and a race waits for
// it. ./index.ts keeps the system's state, its init, its tuning and what a snapshot reads (the menu's grid).
import { type EntityId, cos, sin, nextFloat, wrapAngle, secondsToTicks } from '../../core';
import {
  gapAt,
  gapById,
  type RoadPos,
  type BakedFeature,
  gapParams,
  nearestOnEdges,
  gapFarSide,
} from '../../road';
import { offRoadOn } from '../ground';
import { highDrop, riderState } from '../riders';
import { courseEdgesOn } from '../riders/course';
import { RIDER_HALF_LENGTH_M, RIDER_CONTACT_HALF_WIDTH_M } from '../riders/contact';
import {
  furnitureOn,
  pileUpsOn,
  PARKED_BIKE_TOP_M,
  PARKED_BIKE_HALF_LENGTH_M,
  PARKED_BIKE_HALF_WIDTH_M,
  LIGHT_SCRUB,
  LIGHT_KICK,
} from '../riders/furniture';
import { bodyTopsOf } from '../riders/structures';
import { supportedWorldVelocity, leaveSupport } from '../riders/supports';
import { startTrafficGhost } from '../traffic';
import { type SimConfig, InputFlag } from '../types';
import { type World, emit, type Mover, noteGrudge } from '../world';
import { wallBand, type TumbleBody, ownSideBand, standingBand } from './body';
import { type Box, nearbyBoxes, collideBox } from './contacts';
import {
  makeCluster,
  centre,
  type Cluster,
  type ClusterContact,
  relax,
  intoWater,
  stepCluster,
  maxParticleSpeed,
} from './rig';
import { runDistance, REMOUNT_M, stepRunner } from './runback';
import {
  TUMBLE_TUNING,
  tumbleState,
  OVERBOARD_MAX_TICKS,
  type TumbleState,
  type TumbleRecord,
} from './index';

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

/**
 * How far under the water a body that fell from a high drop (`riders.highDropM`) ends, m: deeper than a
 * body is big, so the water hides it. A low splash floats at the surface for its gag.
 */
export const HIGH_PLUNGE_M = 3;

/**
 * A splash respawn passes over a lane a vehicle stands in within this far along the road, either way, m: a
 * car at 25 m/s is about a second away.
 */
const RESPAWN_CLEAR_M = 25;

/** A car a flying body hits keeps this share of its speed: it brakes (hard hit, soft hit). */
const CAR_KEEP_HARD = 0.4;

const CAR_KEEP_SOFT = 0.8;

/** A closing speed at or above this is a hard hit on a car (m/s). */
const CAR_HARD_MPS = 4;

/** A rider a body brushes keeps this share of speed, and is turned this far away (rad). */
const WOBBLE_KEEP = 0.85;

const WOBBLE_YAW = 0.15;

/**
 * The old rule for a riding rider meeting another rider's parked bike (playtest 4: the hitbox audit found
 * the bikes left standing while their riders run back to them drawn with no sim shape, so anyone rode
 * through them): the bike was knocked aside, a light thing, ridden through once with a light street
 * piece's cost (a little speed and a heading kick, sim/riders/furniture.ts) and a `wobble` whose `cause`
 * is `smash` (`object` `parked-bike`, target its rider), never a crash. Since the maintainer's "Pile ups
 * are fun lol" (2026-10-06) a dropped bike is solid by closing speed, met by the riding model
 * (sim/riders, `droppedBikeContact`); this rule stays for a race whose tuning leaves `riders.pileUps`
 * out (every recording made before), so those replay as they were. Off with `riders.furniture`.
 */
function parkedBikeContacts(world: World, st: TumbleState): void {
  if (!furnitureOn(world.params) || pileUpsOn(world.params)) return;
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
  // On a support (sim/riders/supports.ts: a truck's roof) the rider's speed is over it, signed: through
  // the world the bodies go at that plus the support's own velocity. Then it stands on nothing.
  const on = supportedWorldVelocity(world, config, m);
  const wx = on ? on.vx : fx * v;
  const wz = on ? on.vz : fz * v;
  const throwV = on ? Math.sqrt(wx * wx + wz * wz) : v;
  if (on) leaveSupport(world, m.id);
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
  const big = throwV >= CARTWHEEL_MPS;
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
    { x: wx * RIDER_THROW + rx * riderSide, y: riderUp, z: wz * RIDER_THROW + rz * riderSide },
    turn(riderPitch, riderRoll, spin),
    pos.edge,
  );
  const bikeRig = makeCluster(
    'bike',
    base,
    frame,
    { x: wx * BIKE_THROW + rx * bikeSide, y: bikeUp, z: wz * BIKE_THROW + rz * bikeSide },
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
 * deck's broken end, or one that flew over the barrier and fell past the deck): both bodies fall free
 * at once, each with a `railOver` (`gap: true` through a gap; `over: true`, `past`, `dropM` and `high`
 * over the barrier). Through a gap, the gap it fell through (`data.feature`, else the one under it)
 * decides the respawn; over the barrier, the crossing (`data.crossEdge`, `crossS`, `crossD`) is where
 * it wakes, on the road.
 */
function startOverboard(
  world: World,
  config: SimConfig,
  m: Mover,
  r: TumbleRecord,
  data: Readonly<Record<string, unknown>>,
): void {
  const pos = m.pos;
  const cross = data['cause'] === 'over' ? crossingOf(config, data, pos.dir) : null;
  if (cross) {
    const dropM = num(data, 'dropM');
    const past = data['past'];
    r.over = {
      past: past === 'water' || past === 'ground' ? past : 'drop',
      dropM,
      high: highDrop(world.params, dropM),
    };
    r.railAt = cross;
    // A crossing over a hole in the road (a gap's missing span, where nothing stands at the edge): no road to
    // wake on there, so the gap's own rule says where (its far side, or the main road).
    const hole = gapAt(config.road, cross.edge, cross.s, 0);
    if (hole) r.gap = { edge: cross.edge, id: hole.id };
  } else {
    const id = data['feature'];
    const f =
      (typeof id === 'string' ? gapById(config.road, pos.edge, id) : null) ??
      gapAt(config.road, pos.edge, pos.s, pos.d);
    if (f) r.gap = { edge: pos.edge, id: f.id };
    r.railAt = { edge: pos.edge, s: pos.s, d: pos.d, dir: pos.dir };
  }
  r.overboard = 0;
  for (const c of [r.riderRig, r.bikeRig]) {
    c.overboard = true;
    emit(world, 'railOver', m.id, { body: c.kind, ...overData(r, true) }, { causeId: r.causeId });
  }
  // Out of bounds onto ground (the course's honest edges, sim/riders/course.ts): down already, where he came
  // down, with nothing to fall into. The penalty starts now (`splash`, `past: 'ground'`: the plain quick
  // reset, no water and no gag), then the respawn at the crossing as for any fall past the edge.
  if (r.over?.past === 'ground') {
    for (const c of [r.riderRig, r.bikeRig]) {
      c.splashed = true;
      for (const q of c.p) {
        q.vx = 0;
        q.vy = 0;
        q.vz = 0;
      }
      splash(world, config, m, r, c);
    }
  }
}

/** The crossing an over-the-barrier crash names (sim/riders/gap.ts `overFall`), or null. */
function crossingOf(config: SimConfig, data: Readonly<Record<string, unknown>>, dir: 1 | -1): RoadPos | null {
  const edge = data['crossEdge'];
  if (typeof edge !== 'number' || !config.road.edges[edge]) return null;
  return { edge, s: num(data, 'crossS'), d: num(data, 'crossD'), dir };
}

/**
 * What an overboard event says about the fall: over the barrier, `over`, `past`, `dropM` and `high`;
 * through a gap (`gap`, for the crash's own `railOver`s), `gap: true`; else nothing.
 */
function overData(r: TumbleRecord, gap: boolean): Record<string, string | number | boolean> {
  if (r.over) return { over: true, past: r.over.past, dropM: r.over.dropM, high: r.over.high };
  return gap ? { gap: true } : {};
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
function railEvents(
  world: World,
  config: SimConfig,
  m: Mover,
  r: TumbleRecord,
  c: Cluster,
  at: ClusterContact,
): void {
  if (at.railOver) {
    // The first body over decides the respawn: a rail's spot, or the gap's rule; and over the barrier
    // line, what lies past and how far down (2026-10-06).
    if (r.overboard < 0 && at.gap !== undefined) r.gap = { ...at.gap };
    if (r.overboard < 0 && at.over !== undefined)
      r.over = { ...at.over, high: highDrop(world.params, at.over.dropM) };
    // Into a gap (playtest 3, ./rig.ts) rather than over a rail: flagged, and the gap is kept.
    const data = { body: c.kind, ...overData(r, at.gap !== undefined) };
    emit(world, 'railOver', m.id, data, { causeId: r.causeId });
    if (r.overboard < 0) r.overboard = 0;
    r.railAt ??= { edge: at.edge, s: at.s, d: at.d, dir: m.pos.dir };
  }
  if (at.splash) splash(world, config, m, r, c);
}

/**
 * A cluster reached the water: the event, and the penalty clock starts at the first one. From a high drop
 * it goes under (`HIGH_PLUNGE_M`): a fall over `riders.highDropM` ends below the surface, so nothing lies
 * still on the water in view of the cut-away's held camera (the one live check of 2026-10-07). A low
 * splash floats at the surface, for its gag.
 */
function splash(world: World, config: SimConfig, m: Mover, r: TumbleRecord, c: Cluster): void {
  // Out of bounds onto ground there is no water to go under: the body stays where it came down.
  if (r.over?.high === true && r.over.past !== 'ground') intoWater(config.road, c, HIGH_PLUNGE_M);
  const at = centre(c.p);
  const penaltyTicks = secondsToTicks(param(world, 'tumble.splashPenaltyS'));
  const data = { body: c.kind, penaltyTicks, x: at.x, z: at.z, ...overData(r, false) };
  emit(world, 'splash', m.id, data, { causeId: r.causeId });
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
    // The structures' tops (the physical world, sim/riders/structures.ts): a crash on a roof rests there.
    const tops = bodyTopsOf(world, config);
    // With the course's honest edges, both bodies meet the ground drawn past the barrier.
    const honest = courseEdgesOn(world.params);
    const on = stepCluster(road, r.riderRig, dt, RIDER_MU, offRoad, tops, honest);
    const bikeAt = stepCluster(road, r.bikeRig, dt, BIKE_MU, offRoad, tops, honest);
    contacts(world, config, m, r, r.riderRig, on);
    contacts(world, config, m, r, r.bikeRig, bikeAt);
    railEvents(world, config, m, r, r.riderRig, on);
    railEvents(world, config, m, r, r.bikeRig, bikeAt);
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
          intoWater(config.road, c);
          splash(world, config, m, r, c);
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
  const pos: RoadPos = { edge: at.edge, s: at.s, d: respawnD(world, config, at.edge, at.s, dir, at.d), dir };
  const data = { reason: 'splash', crashTick: r.crashTick, splashTick: r.splashTick, ...overData(r, false) };
  emit(world, 'respawn', m.id, woke && gap ? { ...data, gap: gap.id, at: woke.at } : data, {
    causeId: r.causeId,
  });
  remount(world, config, m, pos);
}

/**
 * The one respawn rule after any overboard (over a barrier or into a gap; the one live check of 2026-10-07:
 * the Seven Mile woke him against its rail, the Golden Gate by its centre line): across the road at (edge, s),
 * he wakes at the centre of a drive lane of his own direction `dir`, the one nearest `nearD` (where he went
 * over), clear of the rails; one a vehicle stands in within `RESPAWN_CLEAR_M` along is passed over for the
 * next, and with none clear the nearest is kept (the respawn ghost lets traffic pass through him). A lane
 * whose centre lies over a gap is never chosen. A road with no drive lane his way keeps the old rule: the
 * point of his own side's band nearest `nearD`.
 */
function respawnD(
  world: World,
  config: SimConfig,
  edge: number,
  s: number,
  dir: 1 | -1,
  nearD: number,
): number {
  const road = config.road;
  const lanes = road
    .lanesAt(edge, s)
    .filter((l) => l.kind === 'drive' && l.direction === dir && !gapAt(road, edge, s, l.dCenterM))
    .map((l) => ({ d: l.dCenterM, half: l.widthM / 2 }))
    .sort((a, b) => Math.abs(a.d - nearD) - Math.abs(b.d - nearD) || a.d - b.d);
  const nearest = lanes[0];
  if (!nearest) {
    const band = ownSideBand(road, edge, s, dir);
    return nearD < band.lo ? band.lo : nearD > band.hi ? band.hi : nearD;
  }
  const taken = (lane: { d: number; half: number }) =>
    world.movers.some(
      (v) =>
        v.kind === 'vehicle' &&
        v.pos.edge === edge &&
        Math.abs(v.pos.s - s) < RESPAWN_CLEAR_M &&
        Math.abs(v.pos.d - lane.d) < lane.half,
    );
  return (lanes.find((l) => !taken(l)) ?? nearest).d;
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

export function tumbleStep(world: World, config: SimConfig): void {
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
}
