// U-turns (interview, 2026-10-02: "Right now there's no way to turn around and go the other way as
// far as I know lol"; round 3 picked "U-turns"). How a U-turn is made is the riding model's call
// (docs/architecture.md, "Races as routes"); this is the [default]:
// - A U-turn has its OWN gesture (playtest 4, P4-9, [decided]: "Its own gesture probably makes sense
//   but I think it felt impossible partly because of the speed I was doing it at lol maybe I just
//   need to slow waaaaaay down. It's also just very windy and tight"). Braking into a hairpin with
//   the bars at full lock never turns the bike round: that was the old rule (brake and full lock
//   below 12 m/s), and it flipped a phone rider on Lombard Street's first bend. The gesture is a
//   DOUBLE TAP OF THE BRAKE: two short presses (each under UTURN_TAP_MAX_S) with the bars under
//   half lock, the second within UTURN_TAP_GAP_S of the first lifting, and then the second press
//   HELD with full lock. It is read from the brake and the bars alone, so the touch brake button,
//   the brake key and the pad's brake trigger all make it the same way, and a replay carries it in
//   the inputs it already records.
// - A player slowed to `riders.uturnMps` or less (12 m/s, about 27 mph) who makes that gesture
//   starts a U-turn: a tight pivot toward the steered side at `riders.uturnRate` (2.4 rad/s, a
//   half turn in about 1.3 s), past the normal heading limit. From a standstill it pivots on the spot.
// - Once started, only full lock to the same side is needed: let go of the brake and gas round (the
//   speed stays at or under `riders.uturnMps` while turning). Let go of the bars and normal steering
//   takes the heading back. Another U-turn needs another double tap.
// - When the heading passes square to the road the travel direction flips (`dir`), and the heading
//   offset moves by half a turn, so the world heading is unbroken. Once lined up with the road the
//   other way, the turn ends; another one waits until the bars come back from full lock.
// - Only riders driven from a player slot (a human or the test bot) turn round: AI rivals and cops
//   never do. Hard braking into a tight corner, held or stuttered, never starts one.
// - A kerb or wall met mid-turn holds the bike in and scrapes speed off; it never crashes it.
// Deterministic: core/math only, and the state is plain numbers in the riders' state.
import { HALF_PI, PI, type TuningParamDecl } from '../../core';
import type { SimRiderDef } from '../types';
import type { Mover, World } from '../world';

/** The tuning defaults, for tests and docs. */
export const UTURN_DEFAULTS = { maxMps: 12, rateRadS: 2.4 } as const;
/** The bars count as at full lock from this share of it. [default] */
export const UTURN_STEER = 0.85;
/** The brake share that counts as a press of the brake (a tap, or the second press held). [default] */
export const UTURN_BRAKE = 0.5;
/** A tap of the gesture is a press shorter than this; a longer one is braking, not a tap. [default] */
export const UTURN_TAP_MAX_S = 0.35;
/** The second press must follow the first one's lift within this. [default] */
export const UTURN_TAP_GAP_S = 0.45;
/**
 * The first tap is made with the bars under this share of lock. A rider who stutters the brake
 * through a bend with the bars over is braking, not asking to turn round. [default]
 */
export const UTURN_TAP_STEER = 0.5;

export const UTURN_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'riders.uturnMps',
    group: 'steering',
    label: 'U-turn: start below speed (0 off)',
    default: UTURN_DEFAULTS.maxMps,
    min: 0,
    max: 25,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    id: 'riders.uturnRate',
    group: 'steering',
    label: 'U-turn: turn rate',
    default: UTURN_DEFAULTS.rateRadS,
    min: 0.5,
    max: 6,
    step: 0.1,
    unit: 'rad/s',
    affectsSim: true,
  },
];

/**
 * Per rider (by entity id): 0 idle; ±1 turning toward that side, not yet past square; ±2 turning,
 * past square (the direction has flipped); 3 done, waiting for the bars to leave full lock.
 */
export interface UturnState {
  uturn: number[];
  /**
   * Per rider: the brake gesture so far. 0 nothing; 1 one tap made, waiting for the second press;
   * 2 the second press is down and held, the turn ready to start once the bars are at full lock.
   */
  uturnTap: number[];
  /** Per rider: seconds the brake has been down (taps 0 and 2) or up since the tap lifted (tap 1). */
  uturnClock: number[];
  /** Per rider: 1 while the brake was pressed last tick. */
  uturnDown: number[];
}

/**
 * Reads the brake gesture for one tick: two short presses with the bars under half lock, the
 * second within the gap and then held. Returns whether the second press is down and held (the
 * turn may start).
 */
function readGesture(st: UturnState, id: number, steer: number, brake: number, dt: number): boolean {
  const down = brake >= UTURN_BRAKE;
  const was = (st.uturnDown[id] ?? 0) === 1;
  let tap = st.uturnTap[id] ?? 0;
  let clock = st.uturnClock[id] ?? 0;
  if (down && !was) {
    // A press begins. After a tap and a short gap it is the second press; otherwise it may be a first.
    if (tap === 1 && clock <= UTURN_TAP_GAP_S) tap = 2;
    else tap = Math.abs(steer) < UTURN_TAP_STEER ? 1 : 0;
    clock = 0;
  } else if (down) {
    clock += dt;
    // The first press is a tap only while it is short and the bars stay under half lock.
    if (tap === 1 && (clock > UTURN_TAP_MAX_S || Math.abs(steer) >= UTURN_TAP_STEER)) tap = 0;
  } else if (was) {
    // The press lifts: an armed second press is over; a first tap starts the gap.
    tap = tap === 1 ? 1 : 0;
    clock = 0;
  } else {
    clock += dt;
    if (tap === 1 && clock > UTURN_TAP_GAP_S) tap = 0;
  }
  st.uturnTap[id] = tap;
  st.uturnClock[id] = clock;
  st.uturnDown[id] = down ? 1 : 0;
  return tap === 2 && down;
}

/** Forgets the gesture (a remount, a respawn, a turn started or given up). */
export function uturnForget(st: UturnState, id: number): void {
  st.uturnTap[id] = 0;
  st.uturnClock[id] = 0;
  st.uturnDown[id] = 0;
}

/** What a turning rider does this tick: its own turn rate (signed, rad/s) and its speed cap. */
export interface UturnStep {
  rate: number;
  capMps: number;
}

/**
 * Advances a grounded rider's U-turn state from its input and returns what the turn does this tick,
 * or null when it is not turning (normal steering applies). `fresh` is a rider who was not riding
 * last tick (a remount): it starts idle.
 */
export function uturnStep(
  world: World,
  st: UturnState,
  def: SimRiderDef,
  m: Mover,
  steer: number,
  brake: number,
  fresh: boolean,
  dt: number,
): UturnStep | null {
  const maxMps = world.params['riders.uturnMps'] ?? UTURN_DEFAULTS.maxMps;
  const rate = world.params['riders.uturnRate'] ?? UTURN_DEFAULTS.rateRadS;
  const state = fresh ? 0 : (st.uturn[m.id] ?? 0);
  const full = steer >= UTURN_STEER || steer <= -UTURN_STEER;
  const side = steer > 0 ? 1 : -1;
  if (def.controller.kind !== 'player' || !(maxMps > 0)) {
    st.uturn[m.id] = 0;
    uturnForget(st, m.id);
    return null;
  }
  if (fresh) uturnForget(st, m.id);
  const armed = readGesture(st, m.id, steer, brake, dt);
  if (state === 3) {
    st.uturn[m.id] = full ? 3 : 0;
    return null;
  }
  if (state !== 0) {
    // Still at full lock to the same side: the turn goes on. Otherwise it is given up.
    if (full && side === Math.sign(state)) return { rate: side * rate, capMps: maxMps };
    st.uturn[m.id] = 0;
    return null;
  }
  if (full && armed && m.speed <= maxMps) {
    st.uturn[m.id] = side;
    uturnForget(st, m.id);
    return { rate: side * rate, capMps: maxMps };
  }
  st.uturn[m.id] = 0;
  return null;
}

/** Whether a rider is in the middle of a U-turn (for the kerb rule). */
export function uturnTurning(st: UturnState, id: number): boolean {
  const state = st.uturn[id] ?? 0;
  return state !== 0 && state !== 3;
}

/**
 * After a turning rider's heading step: past square to the road its travel direction flips and its
 * heading offset moves by half a turn (the world heading is unchanged); lined up the other way, the
 * turn ends there.
 */
export function uturnSettle(st: UturnState, m: Mover): void {
  const state = st.uturn[m.id] ?? 0;
  const side = state > 0 ? 1 : -1;
  if (state === 1 || state === -1) {
    if (m.yaw * side <= HALF_PI) return;
    m.pos.dir = m.pos.dir === 1 ? -1 : 1;
    m.yaw -= side * PI;
    st.uturn[m.id] = 2 * side;
    return;
  }
  if ((state === 2 || state === -2) && m.yaw * side >= 0) {
    m.yaw = 0;
    st.uturn[m.id] = 3;
  }
}
