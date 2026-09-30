// sim/riders: the riding model (M1 riders-1, riders-2). Kinematics follow docs/architecture.md,
// "Coordinates": ds/dt = v·cos(yaw)/(1 − kappa·d), dd/dt = v·sin(yaw), d(yaw)/dt = own turn rate −
// kappa·ds/dt, with the signs of ds/dt and the yaw coupling flipped for dir −1. The longitudinal
// model is scaled throttle against a drag that makes full throttle converge to top speed, plus a
// coasting drag, the brake and gravity along the grade. The barrier rule (docs/architecture.md,
// "Movers on the network") turns a contact into a wobble or a crash by the speed into the wall.
// Airtime (riders-2) follows "Jumps, ramps and airtime": a grounded rider tracks its vertical speed
// along the surface; when its ballistic height next tick clears the surface it goes Airborne with an
// absolute height and vertical speed, reports h above the road, and lands clean, wobbling or crashing
// by its sideways speed (and, far less, how hard it comes down).
// Assists and the lower overall speed (M2 riders-4, docs/milestones/M2.md): a human slot's steering
// assist nudges the heading away from the shoulder and barriers, auto-throttle holds the gas, and
// the speed multiplier m scales every speed by m and every acceleration (gravity too) by m², so the
// ride traces the same paths and arcs, 1/m slower. Time constants (steering and lean response, the
// wobble) and the crash thresholds are not scaled: timers are unaffected, and landings and barrier
// contacts only get gentler.
import { atan, clamp, cos, sin, type TuningParamDecl } from '../../core';
import { sRateFactor } from '../../road';
import type { SimConfig, SimInput, SimRiderDef, SimSteerAssist } from '../types';
import { applyShove, riderContacts } from './contact';
import {
  emit,
  slotAssists,
  speedMultiplierOf,
  systemState,
  type Mover,
  type SimSystem,
  type World,
} from '../world';

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
  {
    id: 'riders.landingCrashMps',
    group: 'crashes',
    label: 'Landing crash sideways speed',
    default: 4,
    min: 1.5,
    max: 10,
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
  /** Absolute height of the rider while airborne, metres (the surface height while grounded). */
  yAbs: number[];
  /** Vertical speed, m/s: along the surface while grounded, ballistic while airborne. */
  vy: number[];
  /** Scaled ticks in the air in the current jump. */
  airTicks: number[];
  /** Tick of this rider's last riders step, so a rider put down by another system starts fresh. */
  lastTick: number[];
  /** Sideways shove from bumping another rider, m/s along +d (sim/riders/contact). */
  shove: number[];
  /** Last tick each pair of riders ("lowId-highId") touched, so one contact emits one event. */
  contactTick: Record<string, number>;
  /** Scaled ticks of speed boost left from a `boostPad` (playtest 1b quick wins); the snapshot's boostS. */
  boost: number[];
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
/** The ballistic height must clear the surface by this much to take off (ignores sample kinks). */
export const TAKEOFF_CLEARANCE_M = 0.02;
/** Heading change steering can make in the air, rad/s at full lock. */
const AIR_TURN_RATE = 0.6;
/** A landing wobbles from this fraction of the landing crash sideways speed. */
const LANDING_WOBBLE_FRACTION = 0.4;
/** Coming down harder than this into the surface wobbles, and much harder crashes, m/s. */
const LANDING_WOBBLE_VERTICAL = 14;
const LANDING_CRASH_VERTICAL = 22;
/**
 * The lowest overall-speed multiplier the settings offer [default]. The sim accepts anything in
 * (0, 1]; this is the value the ramp shortcut and jumps are tested at.
 */
export const SPEED_MULTIPLIER_MIN = 0.6;
/**
 * Steering assist strength: the heading nudge at the edge of the travel lanes, as a share of the
 * steering's full heading offset. Even strong stays below full lock, so a rider who means it still gets onto the shoulder.
 */
const ASSIST_GAIN: Readonly<Record<SimSteerAssist, number>> = { off: 0, light: 0.45, strong: 0.9 };
/** The assist acts within this distance of the travel lanes' edge (a bike's half-width inside it). */
const ASSIST_MARGIN_M = 1;
/** It judges where the rider will be this far ahead, so riding away from the edge is left alone. */
const ASSIST_LOOKAHEAD_S = 0.4;

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
    yAbs: [],
    vy: [],
    airTicks: [],
    lastTick: [],
    shove: [],
    contactTick: {},
    boost: [],
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

/** Top speed after the tuning panel's speed scale and the lower-overall-speed multiplier. */
export function topSpeedOf(world: World, config: SimConfig, bikeTopMps: number): number {
  return bikeTopMps * (world.params['riders.speedScale'] ?? 1) * speedMultiplierOf(config);
}

/** What the lower overall speed does to accelerations and gravity: m², so paths keep their shape. */
function accelMultiplierOf(config: SimConfig): number {
  const m = speedMultiplierOf(config);
  return m * m;
}

/** The human slot a rider is driven from, or -1 (AI and cop riders have none). */
function slotOf(def: SimRiderDef): number {
  return def.controller.kind === 'player' ? def.controller.slot : -1;
}

/** The throttle the model applies: the input's, or full gas less the brake under auto-throttle. */
function throttleOf(config: SimConfig, def: SimRiderDef, input: SimInput): number {
  if (slotAssists(config, slotOf(def)).autoThrottle) return 1 - clamp(input.brake / 255, 0, 1);
  return clamp(input.throttle / 255, 0, 1);
}

/** The outer edges of the travel lanes (every lane but the shoulders) at (edge, s), or null. */
export function travelLimits(config: SimConfig, edge: number, s: number): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const lane of config.road.lanesAt(edge, s)) {
    if (lane.kind === 'shoulder') continue;
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  return lo < hi ? { lo, hi } : null;
}

/**
 * The steering assist's heading nudge, rad: zero in the middle of the road, growing as the rider's
 * position a moment ahead nears the travel lanes' edge, and always pointing back onto the road. It
 * never picks a line; it only pushes back from the edges, and a rider steering hard enough still
 * gets onto the shoulder.
 */
function assistYaw(config: SimConfig, m: Mover, level: SimSteerAssist, maxYaw: number): number {
  const gain = ASSIST_GAIN[level];
  if (gain === 0) return 0;
  const pos = m.pos;
  const limits = travelLimits(config, pos.edge, pos.s);
  if (!limits) return 0;
  const ahead = pos.d + pos.dir * m.speed * sin(m.yaw) * ASSIST_LOOKAHEAD_S;
  const hi = limits.hi - BIKE_HALF_WIDTH_M;
  const lo = limits.lo + BIKE_HALF_WIDTH_M;
  const towardPlus = clamp((ahead - (hi - ASSIST_MARGIN_M)) / ASSIST_MARGIN_M, 0, 1);
  const towardMinus = clamp((lo + ASSIST_MARGIN_M - ahead) / ASSIST_MARGIN_M, 0, 1);
  // A heading that moves toward -d is -dir: dd/dt = dir * v * sin(yaw).
  return (towardMinus - towardPlus) * pos.dir * gain * maxYaw;
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
  const m2 = accelMultiplierOf(config);
  m.speed = Math.max(0, v * cos(m.yaw) - SCRAPE_DRAG * m2 * dt);
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
  const m2 = accelMultiplierOf(config);
  const gravity = GRAVITY * m2;
  const throttle = throttleOf(config, def, input);
  const brake = clamp(input.brake / 255, 0, 1);
  const steer = clamp(input.steer / 127, -1, 1);
  const pos = m.pos;
  const frameKappa = road.kappaAt(pos.edge, pos.s);
  const grade = road.frameAt(pos.edge, pos.s).grade * pos.dir;
  const wobble = st.wobble[m.id] ?? 0;
  if (wobble > 0) st.wobble[m.id] = Math.max(0, wobble - world.timeScale);
  // Vertical: where the bike is now, and how fast it was rising if it was riding last tick too.
  const yBefore = road.surfaceHeight(pos.edge, pos.s, pos.d);
  const fresh = st.lastTick[m.id] !== world.tick - 1;
  const vyBefore = fresh ? 0 : (st.vy[m.id] ?? 0);
  st.lastTick[m.id] = world.tick;

  // Longitudinal: full throttle on the flat converges to top speed.
  const v = m.speed;
  const top = topSpeedOf(world, config, bike.topSpeedMps);
  const a = bike.accelMps2 * accelScale * m2;
  let accel = throttle * a - (a * v * v) / (top * top);
  accel -= ((1 - throttle) * COAST_DECEL + brake * bike.brakeMps2) * m2 + gravity * grade;
  if (onShoulder(config, m)) accel -= SHOULDER_DRAG * m2;
  if (wobble > 0) accel -= WOBBLE_DRAG * m2;
  m.speed = Math.max(0, v + accel * dt);

  // Lateral: steering asks for a heading offset; the road turning under the bike pulls it.
  const authority = wobble > 0 ? WOBBLE_STEER : 1;
  const maxYaw = maxYawAt(bike.steerRateMps, m.speed, steerScale);
  const assist = assistYaw(config, m, slotAssists(config, slotOf(def)).steer, maxYaw);
  const asked = steer * authority * maxYaw;
  // Without a nudge the heading asked for is untouched (no clamp, no +0), exactly as before M2.
  const yawTarget = assist === 0 ? asked : clamp(asked + assist, -maxYaw, maxYaw);
  const ownTurn = (yawTarget - m.yaw) * YAW_RESPONSE;
  const along = m.speed * cos(m.yaw) * sRateFactor(frameKappa, pos.d);
  m.yaw = clamp(m.yaw + (ownTurn - pos.dir * frameKappa * along) * dt, -1.2, 1.2);
  pos.s += pos.dir * along * dt;
  pos.d += pos.dir * m.speed * sin(m.yaw) * dt;
  m.h = 0;
  applyShove(config, st, m, dt);
  if (road.advance(pos) === 'deadEnd') m.speed = 0;
  barrierContact(world, config, st, m, dt);

  // Take-off: the surface fell away faster than gravity can follow (the ballistic height clears it).
  const surface = road.surfaceHeight(pos.edge, pos.s, pos.d);
  const ballistic = yBefore + vyBefore * dt - 0.5 * gravity * dt * dt;
  if (dt > 0 && !fresh && ballistic > surface + TAKEOFF_CLEARANCE_M) {
    m.mode = 'Airborne';
    m.h = ballistic - surface;
    st.yAbs[m.id] = ballistic;
    st.vy[m.id] = vyBefore - gravity * dt;
    st.airTicks[m.id] = 0;
    emit(world, 'jump', m.id, { speed: m.speed, vyMps: vyBefore });
  } else {
    st.yAbs[m.id] = surface;
    if (dt > 0) st.vy[m.id] = (surface - yBefore) / dt;
  }

  // Lean from sideways acceleration (the heading's world turn rate is the rider's own turn rate).
  settle(world, st, m, atan((m.speed * ownTurn) / GRAVITY), dt);
  st.throttle[m.id] = throttle;
  st.brake[m.id] = brake;
  gearAndRpm(st, m);
}

/** Smooths the lean toward its target and adds the wobble shake. */
function settle(world: World, st: RiderState, m: Mover, target: number, dt: number): void {
  const leanTarget = clamp(target, -MAX_LEAN, MAX_LEAN);
  const base = st.leanBase[m.id] ?? 0;
  const leanBase = base + (leanTarget - base) * Math.min(1, LEAN_RESPONSE * dt);
  st.leanBase[m.id] = leanBase;
  const shake = ((st.wobble[m.id] ?? 0) / WOBBLE_TICKS) * WOBBLE_LEAN * sin(world.tick * 0.9);
  st.lean[m.id] = clamp(leanBase + shake, -MAX_LEAN, MAX_LEAN);
}

function gearAndRpm(st: RiderState, m: Mover): void {
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

/**
 * Airborne: s and d advance with the take-off velocity (air drag only), steering nudges the heading,
 * gravity acts on the absolute height, and h = yAbs - surface. It lands when h reaches 0.
 */
function stepAirborne(world: World, config: SimConfig, st: RiderState, m: Mover): void {
  const def = config.riders[m.riderIndex];
  const input = world.inputs[m.id];
  if (!def || !input) return;
  const dt = world.timeScale / 60;
  const road = config.road;
  const pos = m.pos;
  const bike = def.bike;
  st.lastTick[m.id] = world.tick;
  const wobble = st.wobble[m.id] ?? 0;
  if (wobble > 0) st.wobble[m.id] = Math.max(0, wobble - world.timeScale);
  const steer = clamp(input.steer / 127, -1, 1);
  const throttle = throttleOf(config, def, input);
  const m2 = accelMultiplierOf(config);
  const gravity = GRAVITY * m2;

  const top = topSpeedOf(world, config, bike.topSpeedMps);
  const a = bike.accelMps2 * (world.params['riders.accelScale'] ?? 1) * m2;
  m.speed = Math.max(0, m.speed - ((a * m.speed * m.speed) / (top * top)) * dt);
  const kappa = road.kappaAt(pos.edge, pos.s);
  const ownTurn = steer * AIR_TURN_RATE;
  const along = m.speed * cos(m.yaw) * sRateFactor(kappa, pos.d);
  m.yaw = clamp(m.yaw + (ownTurn - pos.dir * kappa * along) * dt, -1.2, 1.2);
  pos.s += pos.dir * along * dt;
  pos.d += pos.dir * m.speed * sin(m.yaw) * dt;
  const vy = st.vy[m.id] ?? 0;
  const y = (st.yAbs[m.id] ?? 0) + vy * dt - 0.5 * gravity * dt * dt;
  st.vy[m.id] = vy - gravity * dt;
  if (road.advance(pos) === 'deadEnd') m.speed = 0;
  barrierContact(world, config, st, m, dt);
  st.airTicks[m.id] = (st.airTicks[m.id] ?? 0) + world.timeScale;

  const surface = road.surfaceHeight(pos.edge, pos.s, pos.d);
  if (y - surface <= 0) land(world, config, st, m, surface);
  else {
    m.h = y - surface;
    st.yAbs[m.id] = y;
  }
  settle(world, st, m, 0, dt);
  st.throttle[m.id] = throttle;
  st.brake[m.id] = 0;
  gearAndRpm(st, m);
  st.rpm[m.id] = Math.max(st.rpm[m.id] ?? 0, 1200 + 8800 * throttle); // the engine revs free in the air
}

/**
 * Landing quality: sideways speed decides it (a straight landing is clean), with a very hard drop
 * into the surface as a second way to wobble or crash. Emits `land`, plus `wobble` or `crash`.
 */
function land(world: World, config: SimConfig, st: RiderState, m: Mover, surface: number): void {
  const pos = m.pos;
  const grade = config.road.frameAt(pos.edge, pos.s).grade * pos.dir;
  const slopeVy = grade * m.speed * cos(m.yaw);
  const vertical = Math.max(0, slopeVy - (st.vy[m.id] ?? 0));
  const lateral = Math.abs(m.speed * sin(m.yaw));
  const crashAt = world.params['riders.landingCrashMps'] ?? 4;
  const unstable = (st.wobble[m.id] ?? 0) > 0;
  const crashes =
    lateral >= crashAt || vertical >= LANDING_CRASH_VERTICAL || (unstable && lateral >= crashAt * 0.5);
  const wobbles = lateral >= crashAt * LANDING_WOBBLE_FRACTION || vertical >= LANDING_WOBBLE_VERTICAL;
  const quality = crashes ? 'crash' : wobbles ? 'wobble' : 'clean';
  const airTicks = st.airTicks[m.id] ?? 0;
  m.mode = 'Road';
  m.h = 0;
  st.yAbs[m.id] = surface;
  st.vy[m.id] = slopeVy;
  st.airTicks[m.id] = 0;
  const data = { quality, airTicks, lateralMps: lateral, verticalMps: vertical, speed: m.speed };
  const cause = emit(world, 'land', m.id, data);
  if (quality === 'crash') {
    st.wobble[m.id] = 0;
    emit(world, 'crash', m.id, { ...data, cause: 'landing', yaw: m.yaw }, { causeId: cause });
  } else if (quality === 'wobble') {
    st.wobble[m.id] = WOBBLE_TICKS;
    emit(world, 'wobble', m.id, { ...data, cause: 'landing' }, { causeId: cause });
  }
}

const CONTACT_RULES = { wobbleTicks: WOBBLE_TICKS, limits: barrierLimits };

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
      st.yAbs[m.id] = config.road.surfaceHeight(m.pos.edge, m.pos.s, m.pos.d);
      st.vy[m.id] = 0;
      st.airTicks[m.id] = 0;
      st.lastTick[m.id] = -2;
      st.shove[m.id] = 0;
    }
  },
  step(world: World, config: SimConfig) {
    const st = riderState(world);
    for (const m of world.movers) {
      if (m.kind !== 'rider' || m.riderIndex < 0) continue;
      if (m.mode === 'Road') stepGrounded(world, config, st, m);
      else if (m.mode === 'Airborne') stepAirborne(world, config, st, m);
    }
    riderContacts(world, config, st, CONTACT_RULES);
  },
};
