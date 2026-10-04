// sim/riders/gap.ts: road with no surface, and walls a rider can fly over (playtest 3: the Old Seven
// Mile Bridge's missing span, "Jumps could let you get from one to the other"; the static ramp
// trucks that reach shortcuts over a `jumpable` wall).
//
// This is the contract stub (K0a): the hooks sim/riders calls, each returning its neutral value, so
// every race rides exactly as before. The gaps lane (T3.1) fills the bodies here (and owns
// road/gap.ts and sim/tumble) without touching riders/index.ts:
// - `gapUnder`: whether there is no road surface under the rider (inside a `gap` feature's box).
//   A grounded rider over one leaves the ground (the surface fell away), and an airborne one never
//   lands there;
// - `gapFall`, each airborne tick over a gap, with how far the rider is above (+) or below (-) the
//   deck plane: past the gap's kill depth it goes overboard (a `crash` with `cause: 'gap'`), which
//   sim/tumble takes into the water and the respawn;
// - `airWallSkip`, each airborne tick before the barrier rule, with the rider's absolute height
//   this tick: true means it flies over a `jumpable` wall here, and the barrier rule is skipped
//   for this tick.
// Gaps and jumpable walls exist only where road data puts them, so a race without them rides as
// before; any switch the lane adds is off when absent.
import type { TuningParamDecl } from '../../core';
import type { SimConfig } from '../types';
import type { Mover, World } from '../world';
import type { RiderState } from './index';

/** The gaps' tuning (T3.1 declares any here). */
export const GAP_TUNING: readonly TuningParamDecl[] = [];

/**
 * The gaps' per-rider state, by entity id, part of RiderState (T3.1 adds its arrays here and their
 * empty values in `newGapState`).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the contract's seam: T3.1 fills it
export interface GapState {}

export function newGapState(): GapState {
  return {};
}

/** Whether the rider is over a gap: no road surface under it. */
export function gapUnder(_world: World, _config: SimConfig, _m: Mover): boolean {
  return false;
}

/** An airborne rider over a gap, `aboveDeckM` above (+) or below (-) the deck plane. */
export function gapFall(
  _world: World,
  _config: SimConfig,
  _st: RiderState,
  _m: Mover,
  _aboveDeckM: number,
): void {}

/** Whether an airborne rider at absolute height `y` flies over a `jumpable` wall this tick. */
export function airWallSkip(
  _world: World,
  _config: SimConfig,
  _st: RiderState,
  _m: Mover,
  _y: number,
): boolean {
  return false;
}
