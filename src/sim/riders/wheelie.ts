// sim/riders/wheelie.ts: the wheelie and the hood launch (playtest 3: "a way to do wheelies", and
// "wheelie into the hood of a car... launch you up into a jump doing backflips"). Playtest 4 (P4-7,
// [decided] "Wheelie button"): HOLD a button to lift the front and keep it up, RELEASE to drop it;
// the throttle stays the throttle, and the skill is how long you hold before it loops out.
//
// The K0a contract's hooks, called from sim/riders and sim/traffic:
// - `wheelieStep`, each grounded tick after the throttle and brake are read: the steering scale
//   (× maxYaw) and the pitch the front is up (added to the ground pitch, so the snapshot's `pitch`
//   is the bike's real pitch and a take-off starts the flight from it);
// - `wheelieTakeoff`, the tick a grounded rider leaves the ground: the wheelie ends (its angle is
//   already in the flight's starting pitch);
// - `hoodLaunchContact`, traffic's first contact with a vehicle, before it is classed as a crash or
//   a wobble: true means the wheelie launched the rider and traffic leaves the contact alone;
// - `hazardLaunch`, a grounded rider meeting a solid road hazard head on (a parked pickup: the
//   critic's S2, "a car is a car"): true means it launched, from above the hazard's top;
// - `wheelieOf` and `wheelieMoves`, for the snapshot (`EntitySnapshot.wheelie`, `SimSnapshot.moves`).
//
// The wheelie (scratch spec moves.md §3.2 and the playtest 4 brief, [default] every number):
// - **Pop.** InputFlag.wheelie is level-held while the button is (input/: the touch button, a key, a
//   pad button). A press arms the pop; it pops on the first tick of that press a player rides at
//   6 m/s or more (× the speed multiplier), not wobbling, U-turning or drifting, lifting the front at
//   2.5 rad/s. Any throttle, none included. One press, one pop: a wheelie that ends while the button
//   is still held waits for a new press. AI riders never pop.
// - **Hold and release.** The front's angle θ above the slope follows an aim a:
//   θ̈ = K·(a − θ) + λ·(θ − θ_bp) − D·θ̇ − B·brake. While held, a climbs at `riders.wheelieRise`
//   (0.25 rad/s) from where the press found the front (at least WHEELIE_HOLD_AIM, the sweet band's
//   floor); released, a is 0 and the front comes down. Held still, θ settles at 1.6·a − 0.36, so a
//   hold carries the front up through the sweet band (θ 0.35 to 0.85), into the high band and over
//   the top: playtest 3's [decided] "too high loops out" is now "held too long loops out". The λ
//   term is "past the balance point it wants to keep going"; the brake is the rear brake bringing the
//   nose down. The throttle plays no part: it is only the throttle. `riders.wheelieGain` scales K and
//   λ (lower: lazier). The moves audit (playtest 4) measured why the old thumb-height balance failed:
//   its sweet band was 9.4 px of thumb in mid-stick, and the natural full swipe up looped out 0.6 s
//   after the pop.
// - **End.** The front back down (θ ≤ 0.04): clean when it falls slower than 2.5 rad/s, else a wobble
//   (`cause: 'wheelie'`). Over the top (θ ≥ 1.2): a loop-out, a crash thrown up and back. Also on a
//   wobble or a hit (dirty), a take-off or a hood launch (clean), under 3 m/s (clean), or a rider
//   taken off the bike in between (dirty). Every end emits `wheelieEnd`, which sim/race scores.
// - **While up**, steering has 0.6 of its reach.
//
// The hood launch (moves.md §3.3, the critic's S2): in a wheelie with the front at least 0.35 rad up
// (the front wheel about hood height), meeting end on and not a graze, at 8 m/s closing or more (×
// the speed multiplier; off the back of a car going your way from 3 m/s, playtest 4's P4-2: "wheelie
// into the back of a car should also allow backflips", so a wheelie into a car is never a solid
// crash), a car you can ride up (a normal-hazard `car` or `oddity` at least 3.5 m
// long: sedans, pickups, vans, robotaxis, stalled cars; never bicycles, scooters, golf carts or
// anything `big`), or a parked car-like road hazard (`object` pickup, sedan or car), launches the
// rider instead of crashing: 1 m up (just over a hazard's top), rising at 0.45 × the closing speed,
// at least 6 m/s and at most what keeps the apex at HOOD_APEX_M, at 0.9 of its speed, the bike
// spinning 1 to 3 backflips (sim/riders/air.ts `startSpin`). An oncoming car is a `hood` launch,
// one going your way a `trunk` launch; the car brakes to 0.6 of its speed. `hoodLaunch` and a
// `jump` (data.hood) fire, and the landing carries `data.hood` for sim/race's hood-trick scale. A
// crash into a vehicle from a live wheelie says why in one word (`wheelieCrashReason`).
//
// The wheelie is off while its switch is absent or 0 (`riders.wheelie`), so recordings made before
// ride as they did, and nothing is written for a rider that never pops.
import { clamp, cos, TAU, type EntityId, type TuningParamDecl } from '../../core';
import type { BakedFeature } from '../../road';
import {
  InputFlag,
  type MovesSnapshot,
  type SimConfig,
  type SimInput,
  type SimTrafficTypeDef,
} from '../types';
import { emit, speedMultiplierOf, type Mover, type World } from '../world';
import {
  FLIP_MAX_RATE,
  newSpinState,
  slopeAt,
  startFlight,
  startSpin,
  timeToGround,
  type SpinState,
} from './air';
import { driftOf } from './drift';
import { hazardObject, hazardTop } from './features';
import type { RiderState } from './index';
import { uturnTurning } from './uturn';

/** The held aim's climb, rad/s, when `riders.wheelieRise` is absent. */
export const WHEELIE_RISE_DEFAULT = 0.25;

/** The wheelie's tuning: its switch (absent or 0: off), its balance gain and its hold's climb. */
export const WHEELIE_TUNING: readonly TuningParamDecl[] = [
  {
    // Playtest 3's wheelie and hood launch: 1 on, 0 off (absent: off, so old recordings ride as
    // they did). [default] on.
    id: 'riders.wheelie',
    group: 'crashes',
    label: 'Wheelie',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
  },
  {
    // Scales the balance's pull toward the hold's aim and its tip past the balance point together:
    // lower is a lazier front, higher a twitchier one. [default] 1.
    id: 'riders.wheelieGain',
    group: 'crashes',
    label: 'Wheelie: balance gain',
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.1,
    unit: '×',
    affectsSim: true,
  },
  {
    // Playtest 4's wheelie button: how fast a held button carries the front up (the aim's climb).
    // Lower is a longer hold before it loops out, higher a shorter one. [default] 0.25.
    id: 'riders.wheelieRise',
    group: 'crashes',
    label: 'Wheelie: hold lift rate',
    default: WHEELIE_RISE_DEFAULT,
    min: 0.1,
    max: 0.6,
    step: 0.05,
    unit: 'rad/s',
    affectsSim: true,
  },
];

/** The pop's lift, rad/s. */
export const WHEELIE_POP_RATE = 2.5;
/** The slowest a wheelie pops, m/s (× the speed multiplier). */
export const WHEELIE_MIN_MPS = 6;
/** Under this speed (× the multiplier) the front settles, m/s. */
export const WHEELIE_SETTLE_MPS = 3;
/** The balance: pull K toward the throttle's angle, tip λ past the balance point, damping D. */
export const WHEELIE_K = 8;
export const WHEELIE_TIP = 3;
export const WHEELIE_BALANCE_RAD = 0.6;
export const WHEELIE_DAMP = 4;
/**
 * The rear brake's pull on the nose, rad/s² at full brake. 26, not the spec's 12: at 12, ten ticks
 * of full brake from 0.8 rad only reach 0.64 (computed), short of the spec's own "under 0.5".
 */
export const WHEELIE_BRAKE = 26;
/**
 * A press aims at least this high, radians: held still there, the front settles at 0.36, the sweet
 * band's floor. A press on a front already higher aims where the front is, so it holds it there.
 */
export const WHEELIE_HOLD_AIM = 0.45;
/** The front is down at or under this, radians; over the top at or past WHEELIE_LOOP_RAD. */
export const WHEELIE_DOWN_RAD = 0.04;
export const WHEELIE_LOOP_RAD = 1.2;
/** Falling faster than this when it lands, rad/s, the front slams down: a wobble. */
export const WHEELIE_SLAM_RATE = 2.5;
/** The sweet band, radians. */
export const WHEELIE_SWEET = { lo: 0.35, hi: 0.85 } as const;
/** Steering's reach while the front is up. */
export const WHEELIE_STEER_SCALE = 0.6;
/** A slammed-down front's wobble, ticks: the riders' WOBBLE_TICKS (a test pins them equal). */
export const WHEELIE_WOBBLE_TICKS = 36;
/** A loop-out throws the rider up this fast, m/s. */
const LOOP_OUT_UP_MPS = 3;

/** The hood launch needs the front up this far, radians (the front wheel about hood height). */
export const HOOD_MIN_THETA = 0.35;
/** A vehicle you can ride up is at least this long, m. */
export const HOOD_MIN_LENGTH_M = 3.5;
/** The least closing speed that launches off a car's hood (or a parked car), m/s (× the speed multiplier). */
export const HOOD_MIN_CLOSING_MPS = 8;
/**
 * The least closing speed that launches off the back of a car going your way, m/s (× the multiplier;
 * playtest 4, P4-2, [decided] "should also allow backflips": from about 3 m/s). Under it the front
 * wobbles down; at it and over, a held wheelie into a car's back is never a solid crash (the traffic
 * rule's solid line is 6 m/s), and the launch's own minimum rise gives a small hop and one flip.
 */
export const HOOD_TRUNK_MIN_CLOSING_MPS = 3;
/** The launch rises at this share of the closing speed... */
export const HOOD_VY_SHARE = 0.45;
/** ...at least this fast, m/s (× the multiplier)... */
export const HOOD_VY_MIN_MPS = 6;
/**
 * ...and at most what keeps the apex this high above the road, m: a flat landing then comes down at
 * 13.7 m/s, under the landing's 14 m/s wobble line (the spec's 14 m/s cap from 1 m came down at 14.7,
 * a wobble on every big launch; computed).
 */
export const HOOD_APEX_M = 9.5;
/** Off a moving car the flight starts this high, m. */
export const HOOD_LAUNCH_H_M = 1;
/** Off a parked hazard it starts this far over its top, m (the air rule crashes anything below it). */
export const HAZARD_LAUNCH_CLEAR_M = 0.1;
/** The rider keeps this share of its speed; the car brakes to this share of its own. */
export const HOOD_SPEED_KEEP = 0.9;
export const HOOD_CAR_BRAKE = 0.6;
/** Backflips: one per 2π / HOOD_FLIP_RATE seconds of forecast air, 1 to HOOD_MAX_FLIPS... */
export const HOOD_FLIP_RATE = 5.5;
export const HOOD_MAX_FLIPS = 3;
/** ...spun at a rate that would finish them in this share of the air. */
export const HOOD_SPIN_SHARE = 0.85;
/** Parked road hazards that are cars (`params.object`). */
export const CAR_LIKE_HAZARDS: readonly string[] = ['pickup', 'sedan', 'car'];

const GRAVITY = 9.81;

/** The wheelie's per-rider state, by entity id, part of RiderState; plus the hood launch's spin. */
export interface WheelieState extends SpinState {
  /** The front's angle above the slope, radians (0: down), and its rate, rad/s. */
  wheelie: number[];
  wheelieRate: number[];
  /** World ticks (× timeScale) this wheelie has been up, and of those in the sweet band. */
  wheelieUp: number[];
  wheelieSweet: number[];
  /** The wheelie flag last grounded tick (1 held), for its press edge. */
  wheelieFlag: number[];
  /** 1 while a press waits to pop (pressed, not yet popped, still held). */
  wheelieArmed: number[];
  /** The hold's aim, radians: climbing while held, 0 released. */
  wheelieAim: number[];
  /** The last tick the wheelie was stepped: a gap means the rider was off the bike in between. */
  wheelieTick: number[];
}

export function newWheelieState(): WheelieState {
  return {
    ...newSpinState(),
    wheelie: [],
    wheelieRate: [],
    wheelieUp: [],
    wheelieSweet: [],
    wheelieFlag: [],
    wheelieArmed: [],
    wheelieAim: [],
    wheelieTick: [],
  };
}

/** What a wheelie does to a grounded tick. */
export interface WheelieStep {
  /** Multiplies the steering's largest heading offset (1: as before). */
  steerScale: number;
  /** Radians the front is up, added to the ground pitch (0: as before). */
  pitchAdd: number;
}

const NO_WHEELIE: Readonly<WheelieStep> = { steerScale: 1, pitchAdd: 0 };

function isOn(world: World): boolean {
  return (world.params['riders.wheelie'] ?? 0) > 0;
}

/** Ends the wheelie: `wheelieEnd` with its world seconds, and the state back to front down. */
function endWheelie(world: World, st: WheelieState, m: Mover, clean: boolean, loopOut = false): void {
  const id = m.id;
  emit(world, 'wheelieEnd', id, {
    seconds: (st.wheelieUp[id] ?? 0) / 60,
    sweetS: (st.wheelieSweet[id] ?? 0) / 60,
    clean,
    loopOut,
  });
  st.wheelie[id] = 0;
  st.wheelieRate[id] = 0;
  st.wheelieUp[id] = 0;
  st.wheelieSweet[id] = 0;
  st.wheelieAim[id] = 0;
}

/**
 * The aim that holds the front still at θ (the balance's equilibrium, solved for the aim): where a
 * press on a front already up starts climbing from, so pressing never pulls the front down.
 */
function aimHolding(theta: number): number {
  return (theta * (WHEELIE_K - WHEELIE_TIP) + WHEELIE_TIP * WHEELIE_BALANCE_RAD) / WHEELIE_K;
}

/**
 * One grounded tick of the wheelie: pop on a press, lift while held, drop when released, end on the
 * front coming down, a loop-out, a hit or a slow crawl. `brake` is 0..1, as the riding model reads
 * it; the throttle plays no part (playtest 4: the throttle stays the throttle).
 */
export function wheelieStep(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  input: SimInput,
  brake: number,
  dt: number,
): Readonly<WheelieStep> {
  const id = m.id;
  let theta = st.wheelie[id] ?? 0;
  const on = isOn(world);
  if (!on && theta <= 0) return NO_WHEELIE;
  const def = config.riders[m.riderIndex];
  if (!def || def.controller.kind !== 'player') return NO_WHEELIE;
  const flag = (input.flags & InputFlag.wheelie) !== 0 ? 1 : 0;
  const pressed = flag === 1 && (st.wheelieFlag[id] ?? 0) === 0;
  if ((st.wheelieFlag[id] ?? 0) !== flag) st.wheelieFlag[id] = flag;
  // A press made with the front down arms the pop until it pops or lifts (a press while the front is
  // up only lifts it). Written only when it changes, so a rider who never presses carries no state.
  const armed = theta <= 0 && flag === 1 && (pressed || (st.wheelieArmed[id] ?? 0) === 1) ? 1 : 0;
  if ((st.wheelieArmed[id] ?? 0) !== armed) st.wheelieArmed[id] = armed;
  const mult = speedMultiplierOf(config);
  const ts = world.timeScale;

  if (theta > 0) {
    // Off the bike in between (a crash, a tumble): it comes back with the front down.
    if (st.wheelieTick[id] !== world.tick - 1 || !on) {
      endWheelie(world, st, m, false);
      return NO_WHEELIE;
    }
    // A wobble or a hit (combat and contacts wobble the rider) drops the front.
    if ((st.wobble[id] ?? 0) > 0) {
      endWheelie(world, st, m, false);
      return NO_WHEELIE;
    }
    // Crawling, the front settles.
    if (m.speed < WHEELIE_SETTLE_MPS * mult) {
      endWheelie(world, st, m, true);
      return NO_WHEELIE;
    }
    const gain = world.params['riders.wheelieGain'] ?? 1;
    // The hold: a press starts the aim where the front is (at least the sweet band's floor), a held
    // button climbs it, a released one drops it to 0.
    let aim = 0;
    if (flag === 1) {
      const rise = world.params['riders.wheelieRise'] ?? WHEELIE_RISE_DEFAULT;
      const from = pressed ? Math.max(WHEELIE_HOLD_AIM, aimHolding(theta)) : (st.wheelieAim[id] ?? 0);
      aim = Math.max(from, WHEELIE_HOLD_AIM) + rise * dt;
    }
    st.wheelieAim[id] = aim;
    let rate = st.wheelieRate[id] ?? 0;
    const accel =
      gain * (WHEELIE_K * (aim - theta) + WHEELIE_TIP * (theta - WHEELIE_BALANCE_RAD)) -
      WHEELIE_DAMP * rate -
      WHEELIE_BRAKE * brake;
    rate += accel * dt;
    theta += rate * dt;
    st.wheelieRate[id] = rate;
    st.wheelie[id] = theta;
    st.wheelieTick[id] = world.tick;
    st.wheelieUp[id] = (st.wheelieUp[id] ?? 0) + ts;
    if (theta >= WHEELIE_SWEET.lo && theta <= WHEELIE_SWEET.hi)
      st.wheelieSweet[id] = (st.wheelieSweet[id] ?? 0) + ts;
    if (theta >= WHEELIE_LOOP_RAD) {
      // Over the top: thrown up and back, straight (the tumble reads upMps and sideMps).
      st.wobble[id] = 0;
      emit(world, 'crash', id, {
        cause: 'wheelie',
        loopOut: true,
        upMps: LOOP_OUT_UP_MPS,
        sideMps: 0,
        speed: m.speed,
      });
      endWheelie(world, st, m, false, true);
      return NO_WHEELIE;
    }
    if (theta <= WHEELIE_DOWN_RAD && rate < 0) {
      const clean = rate >= -WHEELIE_SLAM_RATE;
      if (!clean) {
        st.wobble[id] = Math.max(st.wobble[id] ?? 0, WHEELIE_WOBBLE_TICKS);
        emit(world, 'wobble', id, { cause: 'wheelie', speed: m.speed, rateRad: rate });
      }
      endWheelie(world, st, m, clean);
      return NO_WHEELIE;
    }
    return { steerScale: WHEELIE_STEER_SCALE, pitchAdd: theta };
  }

  // The pop: the first tick of a press that can.
  if (
    armed !== 1 ||
    m.speed < WHEELIE_MIN_MPS * mult ||
    (st.wobble[id] ?? 0) > 0 ||
    uturnTurning(st, id) ||
    driftOf(world, m) !== 0
  )
    return NO_WHEELIE;
  st.wheelieArmed[id] = 0;
  theta = WHEELIE_POP_RATE * dt;
  st.wheelieRate[id] = WHEELIE_POP_RATE;
  st.wheelieAim[id] = WHEELIE_HOLD_AIM;
  st.wheelie[id] = theta;
  st.wheelieUp[id] = ts;
  st.wheelieSweet[id] = 0;
  st.wheelieTick[id] = world.tick;
  return { steerScale: WHEELIE_STEER_SCALE, pitchAdd: theta };
}

/** A grounded rider leaves the ground this tick: the wheelie, if any, ends (cleanly). */
export function wheelieTakeoff(world: World, st: RiderState, m: Mover): void {
  if ((st.wheelie[m.id] ?? 0) > 0) endWheelie(world, st, m, true);
}

/** A rider's first contact with a traffic vehicle, as traffic classes it. */
export interface HoodContact {
  rider: EntityId;
  vehicle: EntityId;
  type: SimTrafficTypeDef;
  /** They met front to tail (not side by side). */
  endOn: boolean;
  /** End-on but barely overlapping sideways. */
  graze: boolean;
  /** The vehicle is ahead of the rider. */
  front: boolean;
  /** The vehicle drives against the rider's direction (a hood launch; else a trunk launch). */
  oncoming: boolean;
  /** How fast they came together, m/s. */
  closingMps: number;
}

/** Whether a traffic type is a car a wheelie can ride up (moves §3.3). */
export function hoodLaunchable(t: SimTrafficTypeDef): boolean {
  return (
    t.hazard === 'normal' &&
    t.lengthM >= HOOD_MIN_LENGTH_M &&
    (t.category === 'car' || t.category === 'oddity') &&
    t.behaviour?.kerb !== true
  );
}

/** Whether the rider is in a live wheelie high enough to ride up a car, and not crashing this tick. */
function upForIt(world: World, st: WheelieState, m: Mover): boolean {
  if (m.mode !== 'Road' || (st.wheelie[m.id] ?? 0) < HOOD_MIN_THETA) return false;
  if (st.wheelieTick[m.id] !== world.tick) return false;
  return !world.events.some((e) => e.actor === m.id && e.type === 'crash');
}

/** Whether a wheelie launches the rider off this vehicle (and has done it). */
export function hoodLaunchContact(world: World, config: SimConfig, c: HoodContact): boolean {
  const st = world.systems['riders'] as RiderState | undefined;
  const m = world.movers[c.rider];
  if (!st || !m || !upForIt(world, st, m)) return false;
  if (!hoodLaunchable(c.type) || !c.endOn || c.graze || !c.front) return false;
  const least = c.oncoming ? HOOD_MIN_CLOSING_MPS : HOOD_TRUNK_MIN_CLOSING_MPS;
  if (c.closingMps < least * speedMultiplierOf(config)) return false;
  launch(world, config, st, m, {
    closingMps: c.closingMps,
    startH: HOOD_LAUNCH_H_M,
    part: c.oncoming ? 'hood' : 'trunk',
    data: { vehicle: c.type.contentId },
    target: c.vehicle,
  });
  const car = world.movers[c.vehicle];
  if (car && car.kind === 'vehicle') car.speed *= HOOD_CAR_BRAKE;
  return true;
}

/**
 * The one-word reason a rider in a live wheelie crashed into a vehicle instead of launching (playtest
 * 4, P4-2; `crash` data `wheelieReason`, which the ticker shows), or undefined when the rider was not
 * in a wheelie. The first reason that holds, in the order the rule asks: a vehicle the wheelie cannot
 * ride up (`BIG`: a truck, an RV or anything `big`; `SMALL`: a cyclist, a scooter, a golf cart), the
 * front under the launch's floor (`LOW`), not ahead (`BEHIND`), not end on (`SIDEWAYS`), and else a
 * rider already wobbling (`WOBBLY`).
 */
export function wheelieCrashReason(world: World, c: HoodContact): string | undefined {
  const st = world.systems['riders'] as RiderState | undefined;
  const m = world.movers[c.rider];
  if (!st || !m || m.mode !== 'Road') return undefined;
  const theta = st.wheelie[m.id] ?? 0;
  if (theta <= 0 || st.wheelieTick[m.id] !== world.tick) return undefined;
  if (!hoodLaunchable(c.type)) {
    return c.type.hazard === 'big' || c.type.lengthM >= HOOD_MIN_LENGTH_M ? 'BIG' : 'SMALL';
  }
  if (theta < HOOD_MIN_THETA) return 'LOW';
  if (!c.front) return 'BEHIND';
  if (!c.endOn || c.graze) return 'SIDEWAYS';
  return 'WOBBLY';
}

/** Whether a wheelie launches a grounded rider off a solid road hazard it meets head on. */
export function hazardLaunch(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  hazard: BakedFeature,
  closingMps: number,
): boolean {
  const object = hazardObject(hazard);
  if (!CAR_LIKE_HAZARDS.includes(object) || !upForIt(world, st, m)) return false;
  if (closingMps < HOOD_MIN_CLOSING_MPS * speedMultiplierOf(config)) return false;
  launch(world, config, st, m, {
    closingMps,
    startH: hazardTop(hazard) + HAZARD_LAUNCH_CLEAR_M,
    part: 'hood',
    data: { feature: hazard.id, object },
  });
  return true;
}

/**
 * The launch, as sim/modifiers' `hop()` puts a rider in the air: the wheelie ends (cleanly), the
 * rider flies from `startH` at the launch's rise, and the bike spins its backflips.
 */
function launch(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  o: {
    closingMps: number;
    startH: number;
    part: 'hood' | 'trunk';
    data: Record<string, string>;
    target?: EntityId;
  },
): void {
  const theta = st.wheelie[m.id] ?? 0;
  const mult = speedMultiplierOf(config);
  const gravity = GRAVITY * mult * mult;
  const pos = m.pos;
  const road = config.road;
  const vyCap = Math.sqrt(2 * gravity * Math.max(0, HOOD_APEX_M - o.startH));
  const vy0 = clamp(HOOD_VY_SHARE * o.closingMps, Math.min(HOOD_VY_MIN_MPS * mult, vyCap), vyCap);
  endWheelie(world, st, m, true);
  m.mode = 'Airborne';
  m.h = o.startH;
  st.yAbs[m.id] = road.surfaceHeight(pos.edge, pos.s, pos.d) + o.startH;
  st.vy[m.id] = vy0;
  st.airTicks[m.id] = 0;
  m.speed *= HOOD_SPEED_KEEP;
  // The flight starts at the bike's real pitch: the slope plus the front's angle.
  startFlight(st, m, world.inputs[m.id], slopeAt(config, m) + theta);
  const groundRate = road.frameAt(pos.edge, pos.s).grade * pos.dir * m.speed * cos(m.yaw);
  const airS = timeToGround(o.startH, vy0 - groundRate, gravity);
  const flips = clamp(Math.floor((airS * HOOD_FLIP_RATE) / TAU), 1, HOOD_MAX_FLIPS);
  const spinRate = Math.min(FLIP_MAX_RATE, (TAU * flips) / (HOOD_SPIN_SHARE * Math.max(airS, 1e-3)));
  startSpin(st, m, flips, spinRate);
  const cause = emit(
    world,
    'hoodLaunch',
    m.id,
    { part: o.part, closingMps: o.closingMps, vyMps: vy0, flips, ...o.data },
    o.target !== undefined ? { target: o.target } : {},
  );
  emit(world, 'jump', m.id, { speed: m.speed, vyMps: vy0, hood: true }, { causeId: cause });
}

/** The wheelie angle above the slope for the snapshot, radians; 0 when none. */
export function wheelieOf(world: World, m: Mover): number {
  if (m.kind !== 'rider' || m.mode !== 'Road') return 0;
  const st = world.systems['riders'] as Partial<WheelieState> | undefined;
  return st?.wheelie?.[m.id] ?? 0;
}

/** The player's wheelie for the HUD (SimSnapshot.moves). */
export function wheelieMoves(world: World, id: EntityId): Pick<MovesSnapshot, 'wheelieS' | 'wheelieBand'> {
  const m = world.movers[id];
  const theta = m ? wheelieOf(world, m) : 0;
  if (theta <= 0) return { wheelieS: 0, wheelieBand: null };
  const st = world.systems['riders'] as Partial<WheelieState> | undefined;
  const band = theta < WHEELIE_SWEET.lo ? 'low' : theta > WHEELIE_SWEET.hi ? 'high' : 'sweet';
  return { wheelieS: (st?.wheelieUp?.[id] ?? 0) / 60, wheelieBand: band };
}
