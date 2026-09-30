// sim/tumble: the crude crash tumble, the hand-back and the on-foot run-back (docs/architecture.md,
// "Crash tumble"; docs/milestones/M1.md, tumble-1).
//
// How a crash reaches this system: any system earlier in the tick order (controllers, riders,
// combat, cops, traffic, peds) emits a `crash` event whose `actor` is the rider who goes down.
// Optional numeric data: `sideMps` (a shove to the rider's right, m/s) and `upMps` (extra pop).
// The event's causeId is kept, so a kick → crash chain stays intact.
//
// The life of a crash, in scaled time (timers advance by timeScale each tick):
//   Tumble  one world-space body each for rider and bike, ground and barrier walls only. The mover
//           keeps a valid road position: the rider body's projection, with h above the surface.
//   hand-back when both bodies stay under 0.5 m/s for 0.5 s, or after 5 s: the bike is parked at the
//           nearest standing spot inside the drivable width, and the rider is put down OnFoot.
//   OnFoot  the rider runs to the bike in (s, d); the player steers sideways to dodge. Touching the
//           bike remounts. `skipRunBack` (player slots only) teleports to the bike and remounts
//           3 s after the press; pressed during the tumble, it starts at the hand-back.
//   Road    remounted on the parked bike, at rest, with health restored to full.
import {
  cos,
  nextFloat,
  secondsToTicks,
  sin,
  wrapAngle,
  type EntityId,
  type TuningParamDecl,
} from '../../core';
import type { RoadPos } from '../../road';
import { riderState } from '../riders';
import { InputFlag, type SimConfig } from '../types';
import { systemState, type Mover, type SimSystem, type World } from '../world';
import { bodySpeed, standingBand, stepBody, wallBand, type TumbleBody } from './body';
import { REMOUNT_M, runDistance, stepRunner } from './runback';

export { drivableBand, standingBand } from './body';
export type { TumbleBody } from './body';

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
    id: 'tumble.timeoutS',
    group: 'crash',
    label: 'Tumble timeout',
    default: 5,
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
];

/** Both bodies under this speed count as at rest (m/s). */
const REST_MPS = 0.5;
/**
 * Sliding friction, as a multiple of g, and the share of the riding speed each body is thrown
 * with. High friction and a rider thrown mostly upward keep a top-speed crash short (about 3 s to
 * the hand-back) and land the rider a few metres from the bike, so the run-back starts fast.
 */
const RIDER_MU = 1.6;
const BIKE_MU = 1.4;
const RIDER_THROW = 0.55;
const BIKE_THROW = 0.9;
/** The rider sits this high above the bike's contact point when thrown. */
const SEAT_M = 0.8;

/** One rider's crash, from the crash tick to the remount. Plain data. */
export interface TumbleRecord {
  phase: 'tumble' | 'onFoot';
  crashTick: number;
  /** The crash event's causeId, for cause chains. */
  causeId: number;
  /** Tick of the hand-back, or -1 while tumbling. */
  handbackTick: number;
  /** Scaled ticks since the crash. */
  elapsed: number;
  /** Scaled ticks both bodies have been at rest. */
  rest: number;
  rider: TumbleBody;
  bike: TumbleBody;
  /** Spin of the rider's box about the vertical, rad/s (for the look only). */
  spin: number;
  /** Unit world direction the rider was travelling at the crash; decides dir after projection. */
  travelX: number;
  travelZ: number;
  /** Where the bike is parked after the hand-back, else null. */
  parked: RoadPos | null;
  /** Scaled ticks since a skip began, or -1. */
  skip: number;
  /** A skip pressed during the tumble, to start at the hand-back. */
  skipQueued: boolean;
}

export interface TumbleState {
  /** By entity id: the rider's crash in progress, or null. */
  records: (TumbleRecord | null)[];
}

export function tumbleState(world: World): TumbleState {
  return systemState<TumbleState>(world, 'tumble', () => ({ records: [] }));
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

function startCrash(
  world: World,
  config: SimConfig,
  m: Mover,
  data: Readonly<Record<string, unknown>>,
  causeId: number,
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
  const riderSide = (nextFloat(rng) - 0.5) * 4 + side;
  const riderUp = 3 + 3 * nextFloat(rng) + up;
  const bikeSide = (nextFloat(rng) - 0.5) * 3 + 0.7 * side;
  const bikeUp = 0.8 + 1.2 * nextFloat(rng) + 0.5 * up;
  const spin = (nextFloat(rng) - 0.5) * 16;
  const base = road.toWorld(pos.edge, pos.s, pos.d, m.h);
  const record: TumbleRecord = {
    phase: 'tumble',
    crashTick: world.tick,
    causeId,
    handbackTick: -1,
    elapsed: 0,
    rest: 0,
    rider: {
      x: base.x,
      y: base.y + SEAT_M,
      z: base.z,
      vx: fx * v * RIDER_THROW + rx * riderSide,
      vy: riderUp,
      vz: fz * v * RIDER_THROW + rz * riderSide,
      edge: pos.edge,
    },
    bike: {
      x: base.x,
      y: base.y,
      z: base.z,
      vx: fx * v * BIKE_THROW + rx * bikeSide,
      vy: bikeUp,
      vz: fz * v * BIKE_THROW + rz * bikeSide,
      edge: pos.edge,
    },
    spin,
    travelX: tx,
    travelZ: tz,
    parked: null,
    skip: -1,
    skipQueued: false,
  };
  tumbleState(world).records[m.id] = record;
  m.mode = 'Tumble';
}

function isPlayer(config: SimConfig, m: Mover): boolean {
  return config.riders[m.riderIndex]?.controller.kind === 'player';
}

function wantsSkip(world: World, config: SimConfig, m: Mover): boolean {
  return isPlayer(config, m) && ((world.inputs[m.id]?.flags ?? 0) & InputFlag.skipRunBack) !== 0;
}

function stepTumble(world: World, config: SimConfig, m: Mover, r: TumbleRecord, dt: number): void {
  const road = config.road;
  const ts = world.timeScale;
  if (wantsSkip(world, config, m)) r.skipQueued = true;
  if (dt > 0) {
    const on = stepBody(road, r.rider, dt, RIDER_MU);
    stepBody(road, r.bike, dt, BIKE_MU);
    const band = wallBand(road, on.edge);
    m.pos.edge = on.edge;
    m.pos.s = on.s;
    m.pos.d = on.d < band.lo ? band.lo : on.d > band.hi ? band.hi : on.d;
    m.pos.dir = dirAlong(config, on.edge, on.s, r.travelX, r.travelZ);
    m.h = Math.max(0, r.rider.y - on.ground);
    m.speed = bodySpeed(r.rider);
    m.yaw = wrapAngle(m.yaw + r.spin * dt);
    if (m.h <= 0.05) r.spin *= Math.max(0, 1 - 1.5 * dt);
  }
  r.elapsed += ts;
  const atRest = bodySpeed(r.rider) < REST_MPS && bodySpeed(r.bike) < REST_MPS;
  r.rest = atRest ? r.rest + ts : 0;
  const restTicks = secondsToTicks(param(world, 'tumble.restS'));
  const timeoutTicks = secondsToTicks(param(world, 'tumble.timeoutS'));
  if (r.rest >= restTicks || r.elapsed >= timeoutTicks) handBack(world, config, m, r);
}

/** Parks the bike at the nearest standing spot and puts the rider down on foot beside it. */
function handBack(world: World, config: SimConfig, m: Mover, r: TumbleRecord): void {
  const road = config.road;
  const place = (b: TumbleBody): RoadPos => {
    const p = road.project(b.x, b.z, b.edge);
    const band = standingBand(road, p.edge, p.s);
    const d = p.d < band.lo ? band.lo : p.d > band.hi ? band.hi : p.d;
    return { edge: p.edge, s: p.s, d, dir: dirAlong(config, p.edge, p.s, r.travelX, r.travelZ) };
  };
  const bike = place(r.bike);
  r.parked = bike;
  r.phase = 'onFoot';
  r.handbackTick = world.tick;
  m.mode = 'OnFoot';
  m.h = 0;
  m.speed = 0;
  if (r.skipQueued) {
    m.pos = { ...bike };
    r.skip = 0;
  } else {
    m.pos = place(r.rider);
  }
}

function stepOnFoot(world: World, config: SimConfig, m: Mover, r: TumbleRecord, dt: number): void {
  const bike = r.parked;
  if (!bike) return;
  if (r.skip >= 0) {
    r.skip += world.timeScale;
    m.speed = 0;
    if (r.skip >= secondsToTicks(param(world, 'tumble.skipDelayS'))) remount(world, config, m, bike);
    return;
  }
  if (runDistance(config.road, m.pos, bike) <= REMOUNT_M) {
    remount(world, config, m, bike);
    return;
  }
  if (wantsSkip(world, config, m)) {
    m.pos = { ...bike };
    m.speed = 0;
    r.skip = 0;
    return;
  }
  const steer = isPlayer(config, m) ? (world.inputs[m.id]?.steer ?? 0) / 127 : 0;
  const run = stepRunner(config.road, m.pos, bike, param(world, 'tumble.runSpeedMps'), steer, dt, m.yaw);
  m.yaw = run.yaw;
  m.speed = dt > 0 ? run.moved / dt : 0;
}

/** Back on the parked bike, at rest, with health restored to full. */
function remount(world: World, config: SimConfig, m: Mover, bike: RoadPos): void {
  m.mode = 'Road';
  m.pos = { ...bike };
  m.h = 0;
  m.speed = 0;
  m.yaw = 0;
  const def = config.riders[m.riderIndex];
  if (def) riderState(world).health[m.id] = def.healthMax;
  tumbleState(world).records[m.id] = null;
}

export const tumbleSystem: SimSystem = {
  name: 'tumble',
  init(world: World) {
    const st = tumbleState(world);
    for (const m of world.movers) st.records[m.id] = null;
  },
  step(world: World, config: SimConfig) {
    const st = tumbleState(world);
    // Crashes emitted earlier this tick, in emission order. A rider already down ignores more.
    for (const e of world.events) {
      if (e.type !== 'crash') continue;
      const m = world.movers[e.actor];
      if (!m || m.kind !== 'rider' || (m.mode !== 'Road' && m.mode !== 'Airborne')) continue;
      startCrash(world, config, m, e.data, e.causeId ?? 0);
    }
    const dt = world.timeScale / 60;
    for (const m of world.movers) {
      const r = st.records[m.id];
      if (!r || r.crashTick === world.tick) continue;
      if (r.phase === 'tumble') stepTumble(world, config, m, r, dt);
      else stepOnFoot(world, config, m, r, dt);
    }
  },
};
