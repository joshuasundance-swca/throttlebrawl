// sim/ai/level: the career's field level, as far as the AI applies it itself (playtest 3, round 3:
// "Gentle climb": about 10% easier to knock down at a region's first tier, about 20% harder by its
// last; docs/architecture.md, "Controllers"). `SimEventDef.level` carries two scales, written by
// buildSimConfig from the career's FieldLevel:
//   - `aggressionScale` multiplies every rival's aggression, on top of the difficulty preset (about
//     0.9 at a region's first tier up to about 1.2 at its last; the career owns the numbers);
//   - `signatureGapScale` multiplies each timed signature move's gap and spread, so lower means
//     more often (signature.ts; the first move still waits out the start).
// Absent, or 1 and 1, every race runs exactly as before and no hash moves. A bad number (not
// finite, or not above 0) counts as 1, and a wild one is held to a range that cannot freeze or
// flood a fight; the career's own clamps are tighter.
import type { SimConfig } from '../types';

/** The range an `aggressionScale` is held to [default]. */
export const AGGRESSION_SCALE_RANGE = { min: 0.25, max: 2 } as const;
/** The range a `signatureGapScale` is held to [default]. */
export const SIGNATURE_GAP_SCALE_RANGE = { min: 0.25, max: 4 } as const;

function held(value: number | undefined, range: { min: number; max: number }): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 1;
  return Math.min(range.max, Math.max(range.min, value));
}

/** The factor on every rival's aggression this race. */
export function aggressionScale(config: SimConfig): number {
  return held(config.event.level?.aggressionScale, AGGRESSION_SCALE_RANGE);
}

/** The factor on every signature move's gap and spread this race. */
export function signatureGapScale(config: SimConfig): number {
  return held(config.event.level?.signatureGapScale, SIGNATURE_GAP_SCALE_RANGE);
}
