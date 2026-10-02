// U-turns (interview, 2026-10-02: "Right now there's no way to turn around and go the other way as
// far as I know lol"; round 3 picked "U-turns"). How a U-turn is made is the riding model's call
// (docs/architecture.md, "Races as routes"); this is the [default]:
// - A player slowed to `riders.uturnMps` or less (12 m/s, about 27 mph) who holds the brake and full
//   lock starts a U-turn: a tight pivot toward the steered side at `riders.uturnRate` (2.4 rad/s, a
//   half turn in about 1.3 s), past the normal heading limit. From a standstill it pivots on the spot.
// - Once started, only full lock to the same side is needed: let go of the brake and gas round (the
//   speed stays at or under `riders.uturnMps` while turning). Let go of the bars and normal steering
//   takes the heading back.
// - When the heading passes square to the road the travel direction flips (`dir`), and the heading
//   offset moves by half a turn, so the world heading is unbroken. Once lined up with the road the
//   other way, the turn ends; another one waits until the bars come back from full lock.
// - Only riders driven from a player slot (a human or the test bot) turn round: AI rivals and cops
//   never do. Above the speed nothing changes, so hard braking into a tight corner is as before.
// - A kerb or wall met mid-turn holds the bike in and scrapes speed off; it never crashes it.
// Deterministic: core/math only, and the state is plain numbers in the riders' state.
import { HALF_PI, PI, type TuningParamDecl } from '../../core';
import type { SimRiderDef } from '../types';
import type { Mover, World } from '../world';

/** The tuning defaults, for tests and docs. */
export const UTURN_DEFAULTS = { maxMps: 12, rateRadS: 2.4 } as const;
/** The bars count as at full lock from this share of it. [default] */
export const UTURN_STEER = 0.85;
/** The brake share that starts a U-turn. [default] */
export const UTURN_BRAKE = 0.5;

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
): UturnStep | null {
  const maxMps = world.params['riders.uturnMps'] ?? UTURN_DEFAULTS.maxMps;
  const rate = world.params['riders.uturnRate'] ?? UTURN_DEFAULTS.rateRadS;
  const state = fresh ? 0 : (st.uturn[m.id] ?? 0);
  const full = steer >= UTURN_STEER || steer <= -UTURN_STEER;
  const side = steer > 0 ? 1 : -1;
  if (def.controller.kind !== 'player' || !(maxMps > 0)) {
    st.uturn[m.id] = 0;
    return null;
  }
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
  if (full && brake >= UTURN_BRAKE && m.speed <= maxMps) {
    st.uturn[m.id] = side;
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
