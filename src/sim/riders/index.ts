// sim/riders: the riding model (M1 riders-1, riders-2). Kinematics follow docs/architecture.md,
// "Coordinates": ds/dt = v·cos(yaw)/(1 − kappa·d), dd/dt = v·sin(yaw), d(yaw)/dt = own turn rate −
// kappa·ds/dt, with the signs of ds/dt and the yaw coupling flipped for dir −1. The longitudinal
// model is scaled throttle against a drag that makes full throttle converge to top speed, plus a
// coasting drag, the brake and gravity along the grade. The barrier rule (docs/architecture.md,
// "Movers on the network") turns a contact into a wobble or a crash by the speed into the wall.
import { atan, clamp, cos, sin, type TuningParamDecl } from '../../core';
import { sRateFactor } from '../../road';
import type { SimConfig } from '../types';
import { emit, systemState, type Mover, type SimSystem, type World } from '../world';

export const RIDERS_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'riders.steerScale',
    group: 'steering',
    label: 'Steering',
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'riders.speedScale',
    group: 'speed',
    label: 'Top speed',
    default: 1,
    min: 0.5,
    max: 1.5,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'riders.accelScale',
    group: 'speed',
    label: 'Acceleration',
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'riders.crashImpactMps',
    group: 'crashes',
    label: 'Barrier crash speed',
    default: 6,
    min: 2,
    max: 15,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
];

/** Per-rider plain state, by entity id. */
export interface RiderState {
  throttle: number[];
  brake: number[];
  rpm: number[];
  gear: number[];
  /** Lean angle in radians, positive leaning right; smoothed, plus the wobble shake. */
  lean: number[];
  /** Lean before the wobble shake is added (smoothed toward the lateral-acceleration lean). */
  leanBase: number[];
  health: number[];
  /** Scaled ticks of wobble left: steering authority is reduced and the bike shakes. */
  wobble: number[];
  /** 1 while the rider is in contact with a barrier, so one contact emits one event. */
  touching: number[];
}

/** m/s² when off the throttle, before air drag. */
export const COAST_DECEL = 0.6;
const GRAVITY = 9.81;
/** 1/s: how fast the bike reaches the steered heading. */
const YAW_RESPONSE = 4;
/** rad: the largest heading offset steering can ask for. */
const MAX_YAW = 0.5;
const GEAR_TOP_MPS = [9, 16, 23, 30, 1000];
/** Half the bike's width: the rider's centre stays this far inside the barrier. */
export const BIKE_HALF_WIDTH_M = 0.5;
/** Extra drag on the rougher shoulder, m/s². */
const SHOULDER_DRAG = 1.5;
/** Scrape friction while touching a barrier, m/s². */
const SCRAPE_DRAG = 4;
/** How long a wobble lasts, in ticks at timeScale 1 (0.6 s). */
export const WOBBLE_TICKS = 36;
/** Steering authority while wobbling. */
const WOBBLE_STEER = 0.5;
/** Extra drag while wobbling, m/s². */
const WOBBLE_DRAG = 1;
/** Peak lean shake while wobbling, radians. */
const WOBBLE_LEAN = 0.18;
/** While already wobbling, a contact this fraction of the crash speed crashes you. */
const UNSTABLE_CRASH_FRACTION = 0.4;
/** Lean follows its target at this rate, 1/s (the "weighty" part). */
const LEAN_RESPONSE = 8;
const MAX_LEAN = 0.8;

export function riderState(world: World): RiderState {
  return systemState<RiderState>(world, 'riders', () => ({
    throttle: [],
    brake: [],
    rpm: [],
    gear: [],
    lean: [],
    leanBase: [],
    health: [],
    wobble: [],
    touching: [],
  }));
}

/**
 * The largest heading offset steering can ask for at a speed (reaches the bike's steer rate), times
 * the tuning panel's steering scale. The scale applies after the clamp so the slider also changes
 * low-speed steering, where the clamp would otherwise swallow it.
 */
export function maxYawAt(steerRateMps: number, speed: number, steerScale: number): number {
  return clamp(steerRateMps / (speed < 6 ? 6 : speed), 0.05, MAX_YAW) * steerScale;
}

/** Top speed after the tuning panel's speed scale. */
export function topSpeedOf(world: World, bikeTopMps: number): number {
  return bikeTopMps * (world.params['riders.speedScale'] ?? 1);
}

/** The drivable limits for a rider's centre at (edge, s): the outer lane edges, less half a bike. */
export function barrierLimits(config: SimConfig, edge: number, s: number): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const lane of config.road.lanesAt(edge, s)) {
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  return { lo: lo + BIKE_HALF_WIDTH_M, hi: hi - BIKE_HALF_WIDTH_M };
}

function onShoulder(config: SimConfig, m: Mover): boolean {
  for (const lane of config.road.lanesAt(m.pos.edge, m.pos.s)) {
    if (lane.kind !== 'shoulder') continue;
    if (Math.abs(m.pos.d - lane.dCenterM) <= lane.widthM / 2) return true;
  }
  return false;
}

/**
 * The barrier rule. Past the outer edge the rider is held inside, loses the speed it carried into
 * the wall and scrapes. A new contact emits one event: a crash when the speed into the wall is at
 * least the crash speed (or 40 % of it while already wobbling), otherwise a wobble.
 */
function barrierContact(world: World, config: SimConfig, st: RiderState, m: Mover, dt: number): void {
  const pos = m.pos;
  const { lo, hi } = barrierLimits(config, pos.edge, pos.s);
  if (pos.d >= lo && pos.d <= hi) {
    st.touching[m.id] = 0;
    return;
  }
  const side = pos.d > hi ? 1 : -1; // road-frame side of the wall
  const v = m.speed;
  // Speed across the road toward the wall (the rider's right is -d when riding toward -s).
  const vAcross = pos.dir * v * sin(m.yaw);
  const impact = vAcross * side > 0 ? vAcross * side : 0;
  const yawBefore = m.yaw;
  pos.d = side > 0 ? hi : lo;
  // The wall takes the across component and turns the bike along it: the rider scrapes along.
  m.speed = Math.max(0, v * cos(m.yaw) - SCRAPE_DRAG * dt);
  m.yaw = 0;
  const newContact = st.touching[m.id] !== 1;
  st.touching[m.id] = 1;
  const crashAt = world.params['riders.crashImpactMps'] ?? 6;
  const unstable = (st.wobble[m.id] ?? 0) > 0;
  const crashes = impact >= crashAt || (unstable && impact >= crashAt * UNSTABLE_CRASH_FRACTION);
  if (crashes) {
    st.wobble[m.id] = 0;
    emit(world, 'crash', m.id, { cause: 'barrier', speed: v, impactMps: impact, yaw: yawBefore, side });
  } else if (unstable) {
    st.wobble[m.id] = WOBBLE_TICKS; // still shaky from the last one: the wobble goes on
  } else if (newContact) {
    st.wobble[m.id] = WOBBLE_TICKS;
    emit(world, 'wobble', m.id, { cause: 'barrier', speed: v, impactMps: impact, yaw: yawBefore, side });
  }
}

function stepGrounded(world: World, config: SimConfig, st: RiderState, m: Mover): void {
  const def = config.riders[m.riderIndex];
  const input = world.inputs[m.id];
  if (!def || !input) return;
  const dt = world.timeScale / 60;
  const steerScale = world.params['riders.steerScale'] ?? 1;
  const accelScale = world.params['riders.accelScale'] ?? 1;
  const road = config.road;
  const bike = def.bike;
  const throttle = clamp(input.throttle / 255, 0, 1);
  const brake = clamp(input.brake / 255, 0, 1);
  const steer = clamp(input.steer / 127, -1, 1);
  const pos = m.pos;
  const frameKappa = road.kappaAt(pos.edge, pos.s);
  const grade = road.frameAt(pos.edge, pos.s).grade * pos.dir;
  const wobble = st.wobble[m.id] ?? 0;
  if (wobble > 0) st.wobble[m.id] = Math.max(0, wobble - world.timeScale);

  // Longitudinal: full throttle on the flat converges to top speed.
  const v = m.speed;
  const top = topSpeedOf(world, bike.topSpeedMps);
  const a = bike.accelMps2 * accelScale;
  let accel = throttle * a - (a * v * v) / (top * top);
  accel -= (1 - throttle) * COAST_DECEL + brake * bike.brakeMps2 + GRAVITY * grade;
  if (onShoulder(config, m)) accel -= SHOULDER_DRAG;
  if (wobble > 0) accel -= WOBBLE_DRAG;
  m.speed = Math.max(0, v + accel * dt);

  // Lateral: steering asks for a heading offset; the road turning under the bike pulls it.
  const authority = wobble > 0 ? WOBBLE_STEER : 1;
  const yawTarget = steer * authority * maxYawAt(bike.steerRateMps, m.speed, steerScale);
  const ownTurn = (yawTarget - m.yaw) * YAW_RESPONSE;
  const along = m.speed * cos(m.yaw) * sRateFactor(frameKappa, pos.d);
  m.yaw = clamp(m.yaw + (ownTurn - pos.dir * frameKappa * along) * dt, -1.2, 1.2);
  pos.s += pos.dir * along * dt;
  pos.d += pos.dir * m.speed * sin(m.yaw) * dt;
  m.h = 0;
  if (road.advance(pos) === 'deadEnd') m.speed = 0;
  barrierContact(world, config, st, m, dt);

  // Lean from sideways acceleration (the heading's world turn rate is the rider's own turn rate).
  const leanTarget = clamp(atan((m.speed * ownTurn) / GRAVITY), -MAX_LEAN, MAX_LEAN);
  const base = st.leanBase[m.id] ?? 0;
  const leanBase = base + (leanTarget - base) * Math.min(1, LEAN_RESPONSE * dt);
  st.leanBase[m.id] = leanBase;
  const shake = ((st.wobble[m.id] ?? 0) / WOBBLE_TICKS) * WOBBLE_LEAN * sin(world.tick * 0.9);
  st.lean[m.id] = clamp(leanBase + shake, -MAX_LEAN, MAX_LEAN);

  st.throttle[m.id] = throttle;
  st.brake[m.id] = brake;
  let gear = 1;
  let low = 0;
  for (const topOfGear of GEAR_TOP_MPS) {
    if (m.speed <= topOfGear) break;
    low = topOfGear;
    gear++;
  }
  const high = GEAR_TOP_MPS[gear - 1] ?? 40;
  st.gear[m.id] = gear;
  st.rpm[m.id] = 1200 + 8800 * clamp((m.speed - low) / Math.min(high - low, 12), 0, 1);
}

export const ridersSystem: SimSystem = {
  name: 'riders',
  init(world: World, config: SimConfig) {
    const st = riderState(world);
    for (const m of world.movers) {
      const def = config.riders[m.riderIndex];
      if (m.kind !== 'rider' || !def) continue;
      st.throttle[m.id] = 0;
      st.brake[m.id] = 0;
      st.rpm[m.id] = 1200;
      st.gear[m.id] = 1;
      st.lean[m.id] = 0;
      st.leanBase[m.id] = 0;
      st.health[m.id] = def.healthMax;
      st.wobble[m.id] = 0;
      st.touching[m.id] = 0;
    }
  },
  step(world: World, config: SimConfig) {
    const st = riderState(world);
    for (const m of world.movers) {
      if (m.kind !== 'rider' || m.riderIndex < 0) continue;
      if (m.mode === 'Road') stepGrounded(world, config, st, m);
    }
  },
};
