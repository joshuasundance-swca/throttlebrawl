// sim/riders/drift.ts: drift as a first-class move (playtest 3: "Braking into a hairpin... a first
// class experience"; interview round 2: a drift meter with style cash, chained corners multiply it,
// an exit boost).
//
// This is the contract stub (K0a): the hooks sim/riders calls, each returning its neutral value, so
// every race rides exactly as before. The drift lane (T2.3) fills the bodies without touching
// riders/index.ts:
// - `driftStep`, each grounded tick after the throttle and brake are read: the steering's reach
//   (× maxYaw, the payoff), a drag (the cost, m/s² before the speed multiplier's m²) and the lean
//   target (knee down), or null to keep the lean from the turn. The exit boost goes on the rider's
//   own boost (`st.boost`, `st.boostMps`), as the landing surge does; `driftStart` and `driftEnd`
//   events carry the meter, and sim/race scores the banked chain;
// - `driftTakeoff`, the tick a grounded rider leaves the ground: the drift ends;
// - `driftOf` and `driftMoves`, for the snapshot (`EntitySnapshot.drift`, `SimSnapshot.moves`).
// The drift is off while its tuning keys are absent (`riders.drift`), so recordings made before
// ride as they did.
import type { EntityId, TuningParamDecl } from '../../core';
import type { MovesSnapshot, SimConfig, SimInput } from '../types';
import type { Mover, World } from '../world';
import type { RiderState } from './index';

/** The drift's tuning (T2.3 declares `riders.drift` and the rest here). */
export const DRIFT_TUNING: readonly TuningParamDecl[] = [];

/**
 * The drift's per-rider state, by entity id, part of RiderState (T2.3 adds its arrays here and
 * their empty values in `newDriftState`).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the contract's seam: T2.3 fills it
export interface DriftState {}

export function newDriftState(): DriftState {
  return {};
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

/**
 * One grounded tick of the drift. `steer` is -1..1, `throttle` and `brake` 0..1, as the riding
 * model reads them.
 */
export function driftStep(
  _world: World,
  _config: SimConfig,
  _st: RiderState,
  _m: Mover,
  _input: SimInput,
  _steer: number,
  _throttle: number,
  _brake: number,
  _dt: number,
): Readonly<DriftStep> {
  return NO_DRIFT;
}

/** A grounded rider leaves the ground this tick: the drift, if any, ends. */
export function driftTakeoff(_world: World, _st: RiderState, _m: Mover): void {}

/** The drift's slip angle for the snapshot, radians, positive with the nose to the right; 0 when none. */
export function driftOf(_world: World, _m: Mover): number {
  return 0;
}

/** The player's drift for the HUD (SimSnapshot.moves). */
export function driftMoves(
  _world: World,
  _id: EntityId,
): Pick<MovesSnapshot, 'driftS' | 'driftChain' | 'driftCash' | 'driftSide'> {
  return { driftS: 0, driftChain: 0, driftCash: 0, driftSide: 0 };
}
