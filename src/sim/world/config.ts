// Resolvers for the optional M2 SimConfig fields (docs/milestones/M2.md, app-3 item 2). Sim code
// reads per-slot assists and the speed multiplier only through these, so a config that leaves the
// fields out (every M1 test fixture) means "no assists, full speed", and a bad number can never
// reach the physics.
import type { SimAssists, SimConfig } from '../types';

export const NO_ASSISTS: Readonly<SimAssists> = Object.freeze({ steer: 'off', autoThrottle: false });

/** A player slot's assists; no assists for a slot the config does not list (or an AI's -1). */
export function slotAssists(config: SimConfig, slot: number): Readonly<SimAssists> {
  return (slot >= 0 ? config.slots?.[slot]?.assists : undefined) ?? NO_ASSISTS;
}

/** The lower-overall-speed multiplier, in (0, 1]: absent, non-finite or non-positive means 1. */
export function speedMultiplierOf(config: SimConfig): number {
  const m = config.speedMultiplier;
  if (m === undefined || !Number.isFinite(m) || m <= 0) return 1;
  return Math.min(1, m);
}
