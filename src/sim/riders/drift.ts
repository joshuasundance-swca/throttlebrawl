// sim/riders/drift.ts: drift as a first-class move (playtest 3: "Braking into a hairpin at speeds
// makes a nice drift like mechanism and we should consider that a first class experience";
// interview round 2: a drift meter with style cash, chained corners multiply it, an exit boost).
//
// sim/riders calls these hooks (the K0a contract), so this lane never edits riders/index.ts:
// - `driftStep`, each grounded tick after the throttle and brake are read: the steering's reach
//   (× maxYaw, the payoff), a drag (the cost, m/s² before the speed multiplier's m²) and the lean
//   target (knee down), or null to keep the lean from the turn;
// - `driftTakeoff`, the tick a grounded rider leaves the ground: the drift ends;
// - `driftOf` and `driftMoves`, for the snapshot (`EntitySnapshot.drift`, `SimSnapshot.moves`).
//
// The move, `[default]` throughout (scratch spec moves.md §4.1, the critic's C5 for the floors):
// - Entry. A player's rider on the road, not wobbling, wheelieing or mid U-turn, holding all of
//   these for DRIFT_GATE_TICKS (0.15 s, so a stab of the brake in traffic never drifts): speed at
//   least `riders.driftMinMps` (× the lower-overall-speed multiplier), the brake at DRIFT_BRAKE or
//   more and the bars at DRIFT_STEER or more. Anywhere (playtest 4, P4-8, "Anywhere": the road's
//   bend is no part of the entry, so a drift starts on a straight too; it was gated on a bend
//   ahead, which kept it off the Seven Mile and SF downtown). A `driftStart` fires with the side
//   (1 right, -1 left) and the speed.
// - Hold. The brake is no longer needed (held, it still brakes); the throttle may come back on (a
//   power slide). The slip β follows its target, side × βmax × (0.55 + 0.45 × |steer|), at
//   DRIFT_BETA_RATE. It buys a tighter line at a higher speed (maxYaw × 1 + `riders.driftSteerGain`
//   × |β|/βmax) and costs speed (`riders.driftDrag` × |β|/βmax m/s²); the rider leans in to the
//   cap, knee down.
// - Exit. The bars let go (|steer| < DRIFT_LET_GO for DRIFT_GATE_TICKS), turned the other way past
//   DRIFT_LET_GO, the speed under `riders.driftExitMps`, a take-off, a U-turn, a wheelie popped
//   mid-slide, or a knock (a crash, a wobble or a hit taken, read from the last tick's events and
//   the wobble timer). β then eases back to 0. An exit is clean when the bike points down the road
//   (|yaw| ≤ DRIFT_CLEAN_YAW), nothing knocked it out, and it lasted DRIFT_CLEAN_S or more.
//   Flicking the bars to the other lock (DRIFT_FLICK) faster than DRIFT_HIGHSIDE_MPS with |β| over
//   DRIFT_HIGHSIDE_BETA is a highside: a `wobble` (cause `drift`), never a crash. Unwinding the
//   bars out of a bend is not.
// - Keeping the chain (playtest 4, the maintainer, 2026-10-05: "it's too easy to lose a drift. I
//   think crashing should lose it but maybe not just wobbling or bumping"). A knock that is not a
//   crash (a wobble, a bump or side contact with traffic, a rival, a wall or a prop, a hit that only
//   staggers, a highside) still ends the slide, as before, but the chain and its cash stay: the
//   slide ends unclean, with no boost, and the chain's window opens for the next drift. ONLY a
//   crash empties the chain: the tick the rider goes down (sim/riders calls `driftDown` for a rider
//   off the road), or, as a net, on the first riding tick after a spell off the road that did not
//   end in a landing on the wheels (the remount that follows a crash).
// - Exit boost. A clean exit raises the top speed by 2 + 4 × min(1, seconds / 2.5) m/s for 1.2 s and
//   pushes the bike to it, on the boost a pad gives (a bigger boost already running is kept), as
//   the landing surge does.
// - The meter. While drifting, style points accrue at perDriftSecondCash × |β|/βmax × clamp(v/top,
//   0.3, 1) × the chain's multiplier, per world second. A drift that starts within
//   `riders.driftChainS` of the last clean exit (grounded riding time) extends the chain: ×1, ×1.5,
//   ×2, ×2.5, then ×3. When that window lapses, one `driftEnd` with `bank: true` carries the
//   chain's points and sim/race scores them as a `drift` style event. A sloppy exit (not clean,
//   but no knock) banks at once; a knock keeps the chain open (above); a crash empties the unbanked
//   meter (the only loss: the maintainer called knockdowns "about right").
//
// Every `driftEnd` carries `seconds`, `clean`, `chain`, `boostMps` and `points` (above 0 only on
// the end that banks the chain), plus `lost` (the cash a crash emptied) or `kept` (the cash a knock
// left open); the bank after a lapsed window is a `driftEnd` with `bank: true` and no slide behind
// it. A rider who finishes with a chain still open loses it: sim/race scores
// only racers still racing (a finisher's bank would need a line in race/style.ts's closeStyle).
// AI riders never drift in this pass. Off while `riders.drift` is absent or 0, so recordings made
// before ride as they did. Deterministic: core math only, plain numbers in the riders' state.
import { clamp, type EntityId, type TuningParamDecl } from '../../core';
import type { MovesSnapshot, SimConfig, SimEvent, SimInput } from '../types';
import { emit, speedMultiplierOf, type Mover, type World } from '../world';
import type { RiderState } from './index';
import { uturnTurning } from './uturn';
import { wheelieOf } from './wheelie';

/** The tuning defaults, for tests and docs. */
export const DRIFT_DEFAULTS = {
  on: 1,
  steerGain: 0.8,
  dragMps2: 2.5,
  chainS: 4,
  minMps: 18,
  exitMps: 10,
  edgeForgive: 1.6,
} as const;

export const DRIFT_TUNING: readonly TuningParamDecl[] = [
  {
    // The switch (playtest 3). Absent or 0: no rider ever drifts, exactly as before.
    id: 'riders.drift',
    group: 'steering',
    label: 'Drift (0 off)',
    default: DRIFT_DEFAULTS.on,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
  },
  {
    // How much farther the bars reach at full slip: maxYaw × (1 + this). [default]
    id: 'riders.driftSteerGain',
    group: 'steering',
    label: 'Drift: steering reach at full slip',
    default: DRIFT_DEFAULTS.steerGain,
    min: 0,
    max: 2,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    // What the slide costs at full slip, m/s² (before the speed multiplier's m²). [default]
    id: 'riders.driftDrag',
    group: 'steering',
    label: 'Drift: drag at full slip',
    default: DRIFT_DEFAULTS.dragMps2,
    min: 0,
    max: 8,
    step: 0.1,
    unit: 'm/s²',
    affectsSim: true,
  },
  {
    // A drift that starts this soon after a clean exit extends the chain (Crown Point's loops sit
    // 130 to 300 m apart, 4 to 10 s at drift speeds). [default]
    id: 'riders.driftChainS',
    group: 'steering',
    label: 'Drift: chain window',
    default: DRIFT_DEFAULTS.chainS,
    min: 0.5,
    max: 10,
    step: 0.25,
    unit: 's',
    affectsSim: true,
  },
  {
    // The speed a drift starts from (the critic's C5: a tuning key, so a walking-pace hairpin such
    // as Lombard's can lower it). × the lower-overall-speed multiplier. [default]
    id: 'riders.driftMinMps',
    group: 'steering',
    label: 'Drift: start above speed',
    default: DRIFT_DEFAULTS.minMps,
    min: 3,
    max: 40,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // Drift room (playtest 4, "more room for error in heavy traffic"): while a drift slides, a
    // barrier or rail crashes only from this many times the barrier crash speed; under it, a
    // wobble, never a crash. 1 is the old rule. [default]
    id: 'riders.driftEdgeForgive',
    group: 'steering',
    label: 'Drift: edge forgiveness',
    default: DRIFT_DEFAULTS.edgeForgive,
    min: 1,
    max: 3,
    step: 0.1,
    unit: '×',
    affectsSim: true,
  },
  {
    // Under this speed a drift ends (C5, likewise). × the lower-overall-speed multiplier. [default]
    id: 'riders.driftExitMps',
    group: 'steering',
    label: 'Drift: ends below speed',
    default: DRIFT_DEFAULTS.exitMps,
    min: 1,
    max: 30,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
];

/** The entry's conditions must hold this long, scaled ticks (0.15 s). [default] */
export const DRIFT_GATE_TICKS = 9;
/**
 * The brake share that starts a drift [default]. Above half on purpose: the dev bot follows a car
 * at half brake and matches a rival's speed at 0.6, and those are not drifts. The touch brake
 * button and the keys brake at 1.
 */
export const DRIFT_BRAKE = 0.7;
/** The bars count as turned in from this share of full lock. [default] */
export const DRIFT_STEER = 0.5;
/** The largest slip, rad (34°). [default] */
export const DRIFT_BETA_MAX = 0.6;
/** β follows its target at this rate while drifting, 1/s, and eases back to 0 at DRIFT_EASE after. */
const DRIFT_BETA_RATE = 6;
const DRIFT_EASE = 5;
/** The lean a drift settles toward, rad (the riding model's lean cap: knee down). */
const DRIFT_LEAN = 0.8;
/** The bars count as let go under this share of full lock (or turned the other way past it). */
export const DRIFT_LET_GO = 0.25;
/** A clean exit points down the road within this heading offset, rad, after at least this long, s. */
export const DRIFT_CLEAN_YAW = 0.3;
export const DRIFT_CLEAN_S = 0.8;
/**
 * A highside: flicking the bars to the other side's DRIFT_FLICK of lock or more, faster than
 * DRIFT_HIGHSIDE_MPS (× the speed multiplier) with more slip than DRIFT_HIGHSIDE_BETA. Only a flick:
 * a rider who unwinds the bars out of a corner, even past centre, rides out of it. [default]
 */
const DRIFT_FLICK = 0.75;
const DRIFT_HIGHSIDE_MPS = 25;
const DRIFT_HIGHSIDE_BETA = 0.45;
/** The riding model's wobble length, scaled ticks (riders/index.ts WOBBLE_TICKS, 0.6 s). */
const DRIFT_WOBBLE_TICKS = 36;
/** The exit boost: base + per-second m/s up to DRIFT_BOOST_FULL_S of drift, held DRIFT_BOOST_S. */
const DRIFT_BOOST_BASE_MPS = 2;
const DRIFT_BOOST_MORE_MPS = 4;
const DRIFT_BOOST_FULL_S = 2.5;
export const DRIFT_BOOST_S = 1.2;
/** The chain's multiplier grows by this per link, to at most DRIFT_CHAIN_MAX. */
const DRIFT_CHAIN_STEP = 0.5;
const DRIFT_CHAIN_MAX = 3;
/** A speed share under this still accrues as this (a crawl through a hairpin still pays a little). */
const DRIFT_SPEED_FLOOR = 0.3;

/** The chain's multiplier for its nth link (1 for a lone drift). */
export function driftChainMult(chain: number): number {
  return Math.min(DRIFT_CHAIN_MAX, 1 + DRIFT_CHAIN_STEP * Math.max(0, chain - 1));
}

/** The exit boost a clean drift of `seconds` earns, m/s (before the speed multiplier). */
export function driftBoostMps(seconds: number): number {
  return DRIFT_BOOST_BASE_MPS + DRIFT_BOOST_MORE_MPS * Math.min(1, seconds / DRIFT_BOOST_FULL_S);
}

/** The drift's per-rider state, by entity id, part of RiderState. */
export interface DriftState {
  /** The drift's side while drifting (1 right, -1 left), 0 when not. */
  driftSide: number[];
  /** The slip β, rad, positive with the nose to the right; eases to 0 after a drift. */
  driftBeta: number[];
  /** Scaled ticks the entry's conditions have held, or (drifting) the bars have been let go. */
  driftGate: number[];
  /** World seconds of the drift in progress. */
  driftS: number[];
  /** The open chain's length (1 for a lone drift), 0 when no chain is open. */
  driftChain: number[];
  /** The open chain's unbanked points. */
  driftCash: number[];
  /** Grounded world seconds left before the open chain banks (after a clean exit), else 0. */
  driftWindow: number[];
  /** The last tick driftStep ran for the rider, so a spell off the ground is seen. */
  driftTick: number[];
}

export function newDriftState(): DriftState {
  return {
    driftSide: [],
    driftBeta: [],
    driftGate: [],
    driftS: [],
    driftChain: [],
    driftCash: [],
    driftWindow: [],
    driftTick: [],
  };
}

/** What a drift does to a grounded tick. */
export interface DriftStep {
  /** Multiplies the steering's largest heading offset (1: as before). */
  maxYawScale: number;
  /** Extra drag, m/s², scaled by the speed multiplier's m² like every acceleration (0: as before). */
  dragMps2: number;
  /** The lean the rider settles toward, radians, or null for the lean the turn gives. */
  leanTarget: number | null;
}

const NO_DRIFT: Readonly<DriftStep> = { maxYawScale: 1, dragMps2: 0, leanTarget: null };

/** Whether the rider has anything the drift tracks: a slide, an open chain or slip still easing. */
function busy(st: DriftState, id: EntityId): boolean {
  return (
    (st.driftSide[id] ?? 0) !== 0 ||
    (st.driftChain[id] ?? 0) !== 0 ||
    (st.driftBeta[id] ?? 0) !== 0 ||
    (st.driftGate[id] ?? 0) !== 0
  );
}

function clearDrift(st: DriftState, id: EntityId): void {
  st.driftSide[id] = 0;
  st.driftBeta[id] = 0;
  st.driftGate[id] = 0;
  st.driftS[id] = 0;
  st.driftChain[id] = 0;
  st.driftCash[id] = 0;
  st.driftWindow[id] = 0;
}

/** The rider went down last tick: a `crash` (any cause). The only thing that loses a chain. */
function crashedLast(events: readonly SimEvent[], id: EntityId): boolean {
  return events.some((e) => e.type === 'crash' && e.actor === id);
}

/**
 * The rider was knocked last tick without going down: a `wobble` (a bump, a brush, a wall or a
 * prop, any cause) or a `hit` taken (a stagger). It ends a slide; it does not touch the chain.
 */
function knockedLast(events: readonly SimEvent[], id: EntityId): boolean {
  for (const e of events) {
    if (e.type === 'wobble' && e.actor === id) return true;
    if (e.type === 'hit' && e.target === id) return true;
  }
  return false;
}

/** Whether the rider came down off a flight last tick on its wheels (no crash). */
function landed(events: readonly SimEvent[], id: EntityId): boolean {
  return events.some((e) => e.type === 'land' && e.actor === id && e.data['quality'] !== 'crash');
}

/** The style points a drift earns per world second, before the chain (perDriftSecondCash scaled). */
function rateOf(world: World, config: SimConfig, m: Mover, beta: number): number {
  const perS = config.event.style?.perDriftSecondCash ?? 0;
  if (perS <= 0) return 0;
  const def = config.riders[m.riderIndex];
  const top =
    (def?.bike.topSpeedMps ?? 0) * (world.params['riders.speedScale'] ?? 1) * speedMultiplierOf(config);
  const share = top > 0 ? clamp(m.speed / top, DRIFT_SPEED_FLOOR, 1) : DRIFT_SPEED_FLOOR;
  return perS * (Math.abs(beta) / DRIFT_BETA_MAX) * share;
}

/** Banks the open chain: one `driftEnd` with `bank: true` and its points, and the chain closes. */
function bank(world: World, st: DriftState, m: Mover): void {
  const chain = st.driftChain[m.id] ?? 0;
  const points = st.driftCash[m.id] ?? 0;
  st.driftChain[m.id] = 0;
  st.driftCash[m.id] = 0;
  st.driftWindow[m.id] = 0;
  if (chain <= 0) return;
  emit(world, 'driftEnd', m.id, { seconds: 0, clean: true, chain, points, boostMps: 0, bank: true });
}

/** Empties the open chain (a crash): its points are lost. */
function empty(st: DriftState, id: EntityId): void {
  st.driftChain[id] = 0;
  st.driftCash[id] = 0;
  st.driftWindow[id] = 0;
}

/**
 * Ends the drift in progress. `crash` (the rider went down) empties the meter; `knocked` (a wobble,
 * a bump or a stagger, or a highside) ends the slide unclean and leaves the chain open, its window
 * running; a clean exit boosts and opens the chain's window; any other exit banks at once.
 */
function endDrift(
  world: World,
  st: RiderState,
  m: Mover,
  how: { crash: boolean; knocked?: boolean; takeoff: boolean; flick?: boolean },
  /** The lower-overall-speed multiplier (speedMultiplierOf). */
  mult: number,
): void {
  const id = m.id;
  const seconds = st.driftS[id] ?? 0;
  const beta = st.driftBeta[id] ?? 0;
  const chain = st.driftChain[id] ?? 0;
  const highside =
    how.flick === true && Math.abs(beta) > DRIFT_HIGHSIDE_BETA && m.speed > DRIFT_HIGHSIDE_MPS * mult;
  const knocked = !how.crash && (how.knocked === true || highside);
  const clean =
    !how.crash &&
    !knocked &&
    !how.takeoff &&
    Math.abs(m.yaw) <= DRIFT_CLEAN_YAW &&
    seconds + 1e-9 >= DRIFT_CLEAN_S;
  st.driftSide[id] = 0;
  st.driftGate[id] = 0;
  st.driftS[id] = 0;
  if (how.crash) {
    const cash = st.driftCash[id] ?? 0;
    empty(st, id);
    emit(world, 'driftEnd', id, { seconds, clean: false, chain, points: 0, boostMps: 0, lost: cash });
  } else if (knocked) {
    // The slide is over, the chain is not: its cash stays up and the next drift within the window
    // extends it (the window banks it if none comes).
    st.driftWindow[id] = world.params['riders.driftChainS'] ?? DRIFT_DEFAULTS.chainS;
    emit(world, 'driftEnd', id, {
      seconds,
      clean: false,
      chain,
      points: 0,
      boostMps: 0,
      kept: st.driftCash[id] ?? 0,
    });
  } else if (clean) {
    const boostMps = driftBoostMps(seconds);
    const left = st.boost[id] ?? 0;
    st.boostMps[id] = left > 0 ? Math.max(st.boostMps[id] ?? 0, boostMps) : boostMps;
    st.boost[id] = Math.max(left, DRIFT_BOOST_S * 60);
    st.driftWindow[id] = world.params['riders.driftChainS'] ?? DRIFT_DEFAULTS.chainS;
    emit(world, 'driftEnd', id, { seconds, clean: true, chain, points: 0, boostMps });
  } else {
    const points = st.driftCash[id] ?? 0;
    empty(st, id);
    emit(world, 'driftEnd', id, { seconds, clean: false, chain, points, boostMps: 0 });
  }
  if (highside) {
    st.wobble[id] = Math.max(st.wobble[id] ?? 0, DRIFT_WOBBLE_TICKS);
    emit(world, 'wobble', id, { cause: 'drift', speed: m.speed, yaw: m.yaw, slip: beta });
  }
}

/**
 * One grounded tick of the drift. `steer` is -1..1, `throttle` and `brake` 0..1, as the riding
 * model reads them.
 */
export function driftStep(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  _input: SimInput,
  steer: number,
  _throttle: number,
  brake: number,
  dt: number,
): Readonly<DriftStep> {
  const id = m.id;
  const def = config.riders[m.riderIndex];
  if (!def || def.controller.kind !== 'player') return NO_DRIFT;
  if ((world.params['riders.drift'] ?? 0) <= 0) {
    if (busy(st, id)) clearDrift(st, id);
    return NO_DRIFT;
  }
  const last = st.driftTick[id];
  st.driftTick[id] = world.tick;
  const mult = speedMultiplierOf(config);
  let side = st.driftSide[id] ?? 0;

  // A crash since last tick empties the meter. Back on the road after a spell off it, only a
  // landing on the wheels keeps the chain: a crash, a fall or a remount after one does not. A knock
  // that is not a crash (a wobble, a bump, a stagger) ends a slide but keeps the chain.
  if (busy(st, id)) {
    const away = last !== undefined && world.tick - last > 1;
    const wiped = crashedLast(world.lastEvents, id) || (away && !landed(world.lastEvents, id));
    if (wiped) {
      if (side !== 0) endDrift(world, st, m, { crash: true, takeoff: false }, mult);
      else empty(st, id);
      side = 0;
    } else if (side !== 0 && knockedLast(world.lastEvents, id)) {
      endDrift(world, st, m, { crash: false, knocked: true, takeoff: false }, mult);
      side = 0;
    } else if (away && side !== 0) {
      // Off the ground mid-slide by a way that skipped the take-off hook (a wheelie's launch off a
      // parked car), and down again on the wheels: the slide ended when it left the ground.
      endDrift(world, st, m, { crash: false, takeoff: true }, mult);
      side = 0;
    }
  }

  const wobbling = (st.wobble[id] ?? 0) > 0;
  const uturn = uturnTurning(st, id);
  if (side !== 0) {
    // Drifting: the exits first.
    const letGo = Math.abs(steer) < DRIFT_LET_GO;
    st.driftGate[id] = letGo ? (st.driftGate[id] ?? 0) + world.timeScale : 0;
    const reversed = steer * side < -DRIFT_LET_GO;
    const slow = m.speed < (world.params['riders.driftExitMps'] ?? DRIFT_DEFAULTS.exitMps) * mult;
    // A U-turn or a wheelie popped mid-slide ends it, and so does a wobble (still riding, so the
    // chain is kept: only a crash loses it).
    if (wobbling || uturn || wheelieOf(world, m) !== 0) {
      endDrift(world, st, m, { crash: false, knocked: wobbling, takeoff: false }, mult);
      side = 0;
    } else if (reversed || slow || (st.driftGate[id] ?? 0) >= DRIFT_GATE_TICKS) {
      const flick = steer * side <= -DRIFT_FLICK;
      endDrift(world, st, m, { crash: false, takeoff: false, flick }, mult);
      side = 0;
    }
  } else {
    // Not drifting: an open chain's window runs down and banks; the entry's gate counts.
    const window = st.driftWindow[id] ?? 0;
    if (window > 0) {
      const leftS = window - dt;
      if (leftS <= 1e-9) bank(world, st, m);
      else st.driftWindow[id] = leftS;
    }
    const want = steer >= DRIFT_STEER ? 1 : steer <= -DRIFT_STEER ? -1 : 0;
    const ready =
      want !== 0 &&
      !wobbling &&
      !uturn &&
      wheelieOf(world, m) === 0 &&
      brake >= DRIFT_BRAKE &&
      m.speed >= (world.params['riders.driftMinMps'] ?? DRIFT_DEFAULTS.minMps) * mult;
    st.driftGate[id] = ready ? (st.driftGate[id] ?? 0) + world.timeScale : 0;
    if (ready && (st.driftGate[id] ?? 0) >= DRIFT_GATE_TICKS) {
      side = want;
      st.driftSide[id] = side;
      st.driftGate[id] = 0;
      st.driftS[id] = 0;
      // Within the window of the last clean exit the chain grows; otherwise a new one opens.
      const open = (st.driftChain[id] ?? 0) > 0 && (st.driftWindow[id] ?? 0) > 0;
      st.driftChain[id] = open ? (st.driftChain[id] ?? 0) + 1 : 1;
      if (!open) st.driftCash[id] = 0;
      st.driftWindow[id] = 0;
      emit(world, 'driftStart', id, { side, speed: m.speed, chain: st.driftChain[id] ?? 1 });
    }
  }

  const beta = st.driftBeta[id] ?? 0;
  if (side === 0) {
    // β eases back to 0 after a drift (presentation: the bike swings back in line).
    if (beta !== 0) {
      const next = beta - beta * Math.min(1, DRIFT_EASE * dt);
      st.driftBeta[id] = Math.abs(next) < 1e-4 ? 0 : next;
    }
    return NO_DRIFT;
  }

  // Holding the slide.
  const target = side * DRIFT_BETA_MAX * (0.55 + 0.45 * Math.abs(steer));
  const b = beta + (target - beta) * Math.min(1, DRIFT_BETA_RATE * dt);
  st.driftBeta[id] = b;
  st.driftS[id] = (st.driftS[id] ?? 0) + dt;
  const chainMult = driftChainMult(st.driftChain[id] ?? 1);
  st.driftCash[id] = (st.driftCash[id] ?? 0) + rateOf(world, config, m, b) * chainMult * dt;
  const slip = Math.abs(b) / DRIFT_BETA_MAX;
  return {
    maxYawScale: 1 + (world.params['riders.driftSteerGain'] ?? DRIFT_DEFAULTS.steerGain) * slip,
    dragMps2: (world.params['riders.driftDrag'] ?? DRIFT_DEFAULTS.dragMps2) * slip,
    leanTarget: side * DRIFT_LEAN,
  };
}

/**
 * A grounded rider leaves the ground this tick: the drift, if any, ends there, with no boost, and
 * its chain banks (a take-off is never a highside, so the speed multiplier plays no part).
 */
export function driftTakeoff(world: World, st: RiderState, m: Mover): void {
  if ((st.driftSide[m.id] ?? 0) !== 0) endDrift(world, st, m, { crash: false, takeoff: true }, 1);
  if (st.driftBeta?.[m.id]) st.driftBeta[m.id] = 0;
  // An entry half-made over the lip starts again on the ground.
  if (st.driftGate?.[m.id]) st.driftGate[m.id] = 0;
}

/**
 * A rider who is not on the road this tick (in the air, tumbling, running back to the bike): a crash
 * last tick empties the open chain now, so the rider going down is what loses it, not the remount
 * seconds later. A tumbling rider is never stepped by `driftStep`. Only the player's chain can be
 * open; for anyone else, or while nothing is open, this does nothing.
 */
export function driftDown(world: World, st: RiderState, m: Mover): void {
  if (!busy(st, m.id) || !crashedLast(world.lastEvents, m.id)) return;
  if ((st.driftSide[m.id] ?? 0) !== 0) endDrift(world, st, m, { crash: true, takeoff: false }, 1);
  else empty(st, m.id);
}

/** The riders' state as the snapshot reads it (never created by a read). */
function stateOf(world: World): DriftState | undefined {
  return world.systems['riders'] as DriftState | undefined;
}

/** The drift's slip angle for the snapshot, radians, positive with the nose to the right; 0 when none. */
export function driftOf(world: World, m: Mover): number {
  return stateOf(world)?.driftBeta?.[m.id] ?? 0;
}

/** The player's drift for the HUD (SimSnapshot.moves). */
export function driftMoves(
  world: World,
  id: EntityId,
): Pick<MovesSnapshot, 'driftS' | 'driftChain' | 'driftCash' | 'driftSide'> {
  const st = stateOf(world);
  const side = st?.driftSide?.[id] ?? 0;
  return {
    driftS: side !== 0 ? (st?.driftS?.[id] ?? 0) : 0,
    driftChain: st?.driftChain?.[id] ?? 0,
    driftCash: Math.round(st?.driftCash?.[id] ?? 0),
    driftSide: side > 0 ? 1 : side < 0 ? -1 : 0,
  };
}
