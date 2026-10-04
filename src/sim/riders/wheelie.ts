// sim/riders/wheelie.ts: the wheelie and the hood launch (playtest 3: "a way to do wheelies", and
// "wheelie into the hood of a car... launch you up into a jump doing backflips"; the maintainer's
// gesture: double-tap the throttle, then balance it by thumb height).
//
// This is the contract stub (K0a): the hooks sim/riders and sim/traffic call, each returning its
// neutral value, so every race rides exactly as before. The wheelie lane (T2.1) fills the bodies
// here and the backflip spin in air.ts, without touching riders/index.ts or traffic/index.ts:
// - `wheelieStep`, each grounded tick after the throttle and brake are read: the steering scale
//   (× maxYaw) and the pitch the front is up (added to the ground pitch, so the snapshot's `pitch`
//   is the bike's real pitch and a take-off starts the flight from it);
// - `wheelieTakeoff`, the tick a grounded rider leaves the ground: the wheelie ends (its angle is
//   already in the flight's starting pitch);
// - `hoodLaunchContact`, traffic's first contact with a vehicle, before it is classed as a crash or
//   a wobble: true means the wheelie launched the rider and traffic leaves the contact alone (no
//   crash, no push-out). The body brakes the vehicle itself (its mover's speed);
// - `hazardLaunch`, a grounded rider meeting a solid road hazard head on (a parked pickup: the
//   critic's S2, "a car is a car"): true means it launched, and the hazard rule leaves it alone.
//   The launch must start above `hazardTop(hazard)`, or the air rule crashes it into the hazard;
// - `wheelieOf` and `wheelieMoves`, for the snapshot (`EntitySnapshot.wheelie`, `SimSnapshot.moves`).
// The wheelie is off while its tuning keys are absent (`riders.wheelie`), as every move here is, so
// recordings made before ride as they did.
import type { EntityId, TuningParamDecl } from '../../core';
import type { BakedFeature } from '../../road';
import type { MovesSnapshot, SimConfig, SimInput, SimTrafficTypeDef } from '../types';
import type { Mover, World } from '../world';
import type { RiderState } from './index';

/** The wheelie's tuning (T2.1 declares `riders.wheelie` and `riders.wheelieGain` here). */
export const WHEELIE_TUNING: readonly TuningParamDecl[] = [];

/**
 * The wheelie's per-rider state, by entity id, part of RiderState (T2.1 adds its arrays here and
 * their empty values in `newWheelieState`).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the contract's seam: T2.1 fills it
export interface WheelieState {}

export function newWheelieState(): WheelieState {
  return {};
}

/** What a wheelie does to a grounded tick. */
export interface WheelieStep {
  /** Multiplies the steering's largest heading offset (1: as before). */
  steerScale: number;
  /** Radians the front is up, added to the ground pitch (0: as before). */
  pitchAdd: number;
}

const NO_WHEELIE: Readonly<WheelieStep> = { steerScale: 1, pitchAdd: 0 };

/**
 * One grounded tick of the wheelie: pop on the rising edge of InputFlag.wheelie, balance by the
 * throttle, end on the front coming down, a loop-out, a hit or a take-off. `throttle` and `brake`
 * are 0..1, as the riding model reads them.
 */
export function wheelieStep(
  _world: World,
  _config: SimConfig,
  _st: RiderState,
  _m: Mover,
  _input: SimInput,
  _throttle: number,
  _brake: number,
  _dt: number,
): Readonly<WheelieStep> {
  return NO_WHEELIE;
}

/** A grounded rider leaves the ground this tick: the wheelie, if any, ends. */
export function wheelieTakeoff(_world: World, _st: RiderState, _m: Mover): void {}

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

/** Whether a wheelie launches the rider off this vehicle (and has done it). */
export function hoodLaunchContact(_world: World, _config: SimConfig, _c: HoodContact): boolean {
  return false;
}

/** Whether a wheelie launches a grounded rider off a solid road hazard it meets head on. */
export function hazardLaunch(
  _world: World,
  _config: SimConfig,
  _st: RiderState,
  _m: Mover,
  _hazard: BakedFeature,
  _closingMps: number,
): boolean {
  return false;
}

/** The wheelie angle above the slope for the snapshot, radians; 0 when none. */
export function wheelieOf(_world: World, _m: Mover): number {
  return 0;
}

/** The player's wheelie for the HUD (SimSnapshot.moves). */
export function wheelieMoves(_world: World, _id: EntityId): Pick<MovesSnapshot, 'wheelieS' | 'wheelieBand'> {
  return { wheelieS: 0, wheelieBand: null };
}
