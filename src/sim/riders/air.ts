// sim/riders air control, flips and tricks (playtest 2, 2026-10-02: "I love the idea of doing
// flips"). In the air a player pitches and leans the bike with the controls they already ride with:
// - pull back (the brake: the brake button, S or Down, a pulled-back stick, L2) lifts the nose, and
//   held long enough the bike goes over backwards: a backflip;
// - kick (swipe down on the attack button and hold, K) throws the rider's weight over the bars: the
//   nose drops, and held long enough it is a front flip;
// - steering leans the bike over (as well as the small heading nudge the air already had); held hard
//   it lays the bike flat sideways: a whip;
// - the gas, or nothing, flies the bike level: it settles to the slope of the ground below, so a
//   rider who only holds the gas lands lined up (the forgiving default).
// A brake or kick already held over the lip counts only once let go: a rider braking into a crest
// does not flip by accident. Let go mid-rotation, the bike carries on to the nearest upright
// (judged a moment ahead, so a flip past halfway completes and one short of it rights itself).
// A held command turns the bike only while it can still come down on its wheels: each tick the sim
// forecasts the time to the ground and checks that level flight from there lands the bike upright (W-Q0
// verifier, playtest 2's "Forgiving landings": a brake held from mid-air to the ground used to loop the
// bike out on 23 of 34 jumps). Held into the ground, the brake gives a wheelie landing, the kick a
// slightly nose-down one; held long enough over a long jump, a flip that fits completes and is landed.
// Landing: a flip (a full turn, either way), a wheelie landing (nose held high, down on the back
// wheel) or a whip (laid flat, straightened before the ground) is a trick the `land` event carries
// (`data.trick`, `data.flips`) and sim/race scores as style cash. Coming down far off the slope (nose
// first, or looped onto the back, now only when the ground comes up sooner than forecast) wipes the
// rider out, thrown high: a botched flip is a big, funny crash (`data.botched`). AI riders give no air commands: they fly level. All state is plain numbers
// and strings in the riders state, so it is in the hash and the snapshot. [default] every number.
import { atan, clamp, PI, TAU, wrapAngle, type TuningParamDecl } from '../../core';
import {
  InputFlag,
  TRICK_IDS,
  type SimConfig,
  type SimInput,
  type SimRiderDef,
  type TrickId,
} from '../types';
import type { Mover, World } from '../world';

export const AIR_TUNING: readonly TuningParamDecl[] = [
  {
    // How hard the air controls turn the bike: 1 is the default, 0 turns air control (and so flips)
    // off, so the bike always flies level. [default]
    id: 'riders.airControl',
    group: 'crashes',
    label: 'Air: flip strength',
    default: 1,
    min: 0,
    max: 2,
    step: 0.1,
    unit: '×',
    affectsSim: true,
  },
];

/** Pitch acceleration while a player holds an air command, rad/s². */
export const FLIP_ACCEL = 18;
/** The fastest the bike turns end over end, rad/s (a flip takes about 0.7 s at full spin). */
export const FLIP_MAX_RATE = 9;
/** The level-flight pull: a spring of LEVEL_K toward the nearest upright, damped by LEVEL_D. */
const LEVEL_K = 40;
const LEVEL_D = 12;
/** The most the level-flight pull turns the bike, rad/s². */
const LEVEL_MAX_ACCEL = 40;
/** The nearest upright is judged where the spin would carry the bike this far ahead, s. */
const LEVEL_LOOKAHEAD_S = 0.3;
/** The lean steering asks for in the air at full lock, radians. */
export const AIR_LEAN = 0.7;
/** A whip: leaned at least this far... */
export const WHIP_LEAN = 0.55;
/** ...for at least this long, ticks at timeScale 1 (0.3 s)... */
export const WHIP_TICKS = 18;
/** ...and straightened to under this by the landing, radians. */
export const WHIP_LAND_LEAN = 0.35;
/** A landing leaned over further than this wobbles. */
export const LAND_LEAN_WOBBLE = 0.55;
/** A wheelie landing: nose up at least this far off the slope at touch-down, radians... */
export const WHEELIE_MIN = 0.3;
/** ...after the nose was pulled up for at least this long, ticks at timeScale 1 (0.2 s). */
export const WHEELIE_TICKS = 12;
/**
 * Landing attitude (the bike's pitch off the slope it lands on, nose up positive): rear wheel first is
 * how a jump is landed, so nose-up is clean up to PITCH_CLEAN_UP; nose-down is clean to
 * PITCH_CLEAN_DOWN. Past those it wobbles; past PITCH_CRASH_UP (looped onto the back) or
 * PITCH_CRASH_DOWN (nose first) it is a crash. [default]
 */
export const PITCH_CLEAN_UP = 0.8;
export const PITCH_CLEAN_DOWN = -0.35;
export const PITCH_CRASH_UP = 1.3;
export const PITCH_CRASH_DOWN = -0.9;
/**
 * The attitude a held command may leave the bike in at touch-down: nose up to SAFE_UP (a wheelie
 * landing, clean), nose down to SAFE_DOWN. Inside the clean band, with room for a forecast that is a
 * little off. [default]
 */
export const SAFE_UP = 0.6;
export const SAFE_DOWN = -0.2;
/** The touch-down window judged around the forecast, seconds each side. [default] */
const LANDING_WINDOW_S = 0.1;
/** How high a botched trick throws the rider, m/s up, and sideways along the lean. */
const BOTCHED_UP_MPS = 5;
const BOTCHED_SIDE_MPS = 3;

/** The riders state this file keeps (a slice of RiderState). */
export interface AirState {
  /** The bike's pitch, radians, nose up positive, from the horizontal; unwrapped through flips. */
  pitch: number[];
  /** Its rate, rad/s. */
  pitchRate: number[];
  /** Air command bits held over the lip, not yet let go: 1 brake, 2 kick. */
  airBlock: number[];
  /** Ticks this flight with the nose commanded up, and with the bike leaned into a whip. */
  noseUpTicks: number[];
  whipTicks: number[];
  /** The trick in progress (a TrickId), or ''. */
  trick: string[];
  lean: number[];
  leanBase: number[];
}

/** The ground's pitch under a mover, along its travel direction, radians. */
export function slopeAt(config: SimConfig, m: Mover): number {
  return atan(config.road.frameAt(m.pos.edge, m.pos.s).grade * m.pos.dir);
}

function brakeOn(input: SimInput): boolean {
  return input.brake >= 128;
}

function kickOn(input: SimInput): boolean {
  return (input.flags & InputFlag.kick) !== 0;
}

/** A take-off: the flight starts at the ground's pitch, and air commands held over the lip wait. */
export function startFlight(st: AirState, m: Mover, input: SimInput | undefined, pitch: number): void {
  st.pitch[m.id] = pitch;
  st.pitchRate[m.id] = 0;
  st.airBlock[m.id] = input ? (brakeOn(input) ? 1 : 0) | (kickOn(input) ? 2 : 0) : 0;
  st.noseUpTicks[m.id] = 0;
  st.whipTicks[m.id] = 0;
  st.trick[m.id] = '';
}

/** On the ground the bike lies along the slope, upright, doing no trick. */
export function groundPitch(st: AirState, m: Mover, slope: number): void {
  st.pitch[m.id] = slope;
  st.pitchRate[m.id] = 0;
  st.trick[m.id] = '';
}

/**
 * One tick of the bike's attitude in the air. Returns the lean the steering asks for (radians), for
 * the riders model's own lean smoothing.
 */
export function stepAttitude(
  world: World,
  config: SimConfig,
  st: AirState,
  m: Mover,
  def: SimRiderDef,
  input: SimInput,
  steer: number,
  dt: number,
  tGround: number,
): number {
  const slope = slopeAt(config, m);
  let block = st.airBlock[m.id] ?? 0;
  if (!brakeOn(input)) block &= ~1;
  if (!kickOn(input)) block &= ~2;
  st.airBlock[m.id] = block;
  const gain = def.controller.kind === 'player' ? (world.params['riders.airControl'] ?? 0) : 0;
  const up = gain > 0 && brakeOn(input) && (block & 1) === 0;
  const down = gain > 0 && kickOn(input) && (block & 2) === 0;
  const pitch = st.pitch[m.id] ?? slope;
  const rate = st.pitchRate[m.id] ?? 0;
  // A held command turns the bike only while it can still come down on its wheels (W-Q0 verifier: a
  // brake held from mid-air to the ground used to loop the bike out, 23 of 34 jumps down).
  const wanted = (up ? 1 : 0) - (down ? 1 : 0);
  const command =
    wanted !== 0 && landsUpright(pitch, rate, wanted * FLIP_ACCEL * gain, slope, tGround, dt) ? wanted : 0;
  const accel = command !== 0 ? command * FLIP_ACCEL * gain : levelAccel(pitch, rate, slope);
  const nextRate = clamp(rate + accel * dt, -FLIP_MAX_RATE, FLIP_MAX_RATE);
  st.pitchRate[m.id] = nextRate;
  st.pitch[m.id] = pitch + nextRate * dt;
  if (command > 0) st.noseUpTicks[m.id] = (st.noseUpTicks[m.id] ?? 0) + world.timeScale;
  if (Math.abs(st.leanBase[m.id] ?? 0) >= WHIP_LEAN)
    st.whipTicks[m.id] = (st.whipTicks[m.id] ?? 0) + world.timeScale;
  st.trick[m.id] = trickInProgress(st, m, slope);
  return steer * AIR_LEAN;
}

/**
 * Seconds until a bike `height` m above the ground, closing on it at `-relVy` m/s (its vertical speed
 * less the ground's own rise under it), meets it under `gravity`: the ground taken as its current slope.
 */
export function timeToGround(height: number, relVy: number, gravity: number): number {
  if (height <= 0 || gravity <= 0) return 0;
  return (relVy + Math.sqrt(relVy * relVy + 2 * gravity * height)) / gravity;
}

/** The level-flight pull: toward the upright nearest where the spin carries the bike a moment ahead. */
function levelAccel(pitch: number, rate: number, slope: number): number {
  const ahead = pitch + rate * LEVEL_LOOKAHEAD_S;
  const target = slope + TAU * Math.round((ahead - slope) / TAU);
  return clamp(LEVEL_K * (target - pitch) - LEVEL_D * rate, -LEVEL_MAX_ACCEL, LEVEL_MAX_ACCEL);
}

/**
 * Whether one more tick of a held command still lets the bike come down on its wheels: after it, level
 * flight must hold the bike within SAFE_UP / SAFE_DOWN of the slope over the whole touch-down window
 * (LANDING_WINDOW_S each side of the forecast). The same steps as the flight itself, so the forecast
 * and the flight agree; only the time to the ground is an estimate.
 */
function landsUpright(
  pitch: number,
  rate: number,
  accel: number,
  slope: number,
  tGround: number,
  dt: number,
): boolean {
  if (dt <= 0) return true;
  let r = clamp(rate + accel * dt, -FLIP_MAX_RATE, FLIP_MAX_RATE);
  let p = pitch + r * dt;
  const last = Math.ceil((tGround + LANDING_WINDOW_S) / dt);
  const first = Math.floor((tGround - LANDING_WINDOW_S) / dt);
  for (let k = 1; k <= last; k++) {
    if (k >= first) {
      const off = p - slope - TAU * Math.round((p - slope) / TAU);
      if (off > SAFE_UP || off < SAFE_DOWN) return false;
    }
    r = clamp(r + levelAccel(p, r, slope) * dt, -FLIP_MAX_RATE, FLIP_MAX_RATE);
    p += r * dt;
  }
  return true;
}

/** The trick a rider is visibly doing in the air now, or ''. */
function trickInProgress(st: AirState, m: Mover, slope: number): TrickId | '' {
  const off = (st.pitch[m.id] ?? 0) - slope;
  if (off >= PI / 2) return 'backflip';
  if (off <= -PI / 2) return 'frontflip';
  if (Math.abs(st.leanBase[m.id] ?? 0) >= WHIP_LEAN) return 'whip';
  if ((st.noseUpTicks[m.id] ?? 0) > 0 && off >= WHEELIE_MIN) return 'wheelie';
  return '';
}

/** What the bike's attitude makes of a landing on a slope. */
export interface Touchdown {
  /** Pitch off the slope, wrapped to [-π, π], nose up positive. */
  pitchOff: number;
  /** Full turns since take-off: positive backflips, negative front flips. */
  flips: number;
  /** The trick landed if the landing holds ('' for none). */
  trick: TrickId | '';
  /** The attitude alone crashes it (nose first, or looped onto the back). */
  crashes: boolean;
  /** The attitude alone wobbles it (well off the slope, or leaned over). */
  wobbles: boolean;
  /** A crash during a trick: thrown high and sideways along the lean (crash data). */
  throw: { upMps: number; sideMps: number } | null;
  /** The trick being tried at touch-down, for a botched one's crash data ('' for none). */
  attempt: TrickId | '';
}

export function touchdown(st: AirState, m: Mover, slope: number): Touchdown {
  const unwrapped = (st.pitch[m.id] ?? slope) - slope;
  const flips = Math.round(unwrapped / TAU);
  const pitchOff = wrapAngle(unwrapped);
  const lean = st.lean[m.id] ?? 0;
  const crashes = pitchOff >= PITCH_CRASH_UP || pitchOff <= PITCH_CRASH_DOWN;
  const wobbles =
    pitchOff > PITCH_CLEAN_UP || pitchOff < PITCH_CLEAN_DOWN || Math.abs(lean) > LAND_LEAN_WOBBLE;
  let trick: TrickId | '' = '';
  if (flips > 0) trick = 'backflip';
  else if (flips < 0) trick = 'frontflip';
  else if ((st.noseUpTicks[m.id] ?? 0) >= WHEELIE_TICKS && pitchOff >= WHEELIE_MIN) trick = 'wheelie';
  else if ((st.whipTicks[m.id] ?? 0) >= WHIP_TICKS && Math.abs(lean) < WHIP_LAND_LEAN) trick = 'whip';
  // Mid-trick when it went wrong: a flip under way (a quarter turn or more), or any trick.
  const flipping: TrickId | '' = unwrapped >= PI / 2 ? 'backflip' : unwrapped <= -PI / 2 ? 'frontflip' : '';
  const shown = (st.trick[m.id] ?? '') as TrickId | '';
  const attempt: TrickId | '' = trick !== '' ? trick : flipping !== '' ? flipping : shown;
  const side = lean > 0 ? 1 : lean < 0 ? -1 : 0;
  return {
    pitchOff,
    flips,
    trick,
    crashes,
    wobbles,
    throw: attempt !== '' ? { upMps: BOTCHED_UP_MPS, sideMps: side * BOTCHED_SIDE_MPS } : null,
    attempt,
  };
}

/** A stored trick id as the snapshot's `trick`: the TrickId, or null for none. */
export function trickOf(id: string | undefined): TrickId | null {
  return (TRICK_IDS as readonly string[]).includes(id ?? '') ? (id as TrickId) : null;
}
