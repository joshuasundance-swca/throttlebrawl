// Resolvers for the optional M2 SimConfig fields (docs/milestones/M2.md, app-3 item 2). Sim code
// reads per-slot assists and the speed multiplier only through these, so a config that leaves the
// fields out (every M1 test fixture) means "no assists, full speed", and a bad number can never
// reach the physics. The same for the hitbox audit's optional sizes (a rider's box, a vehicle's
// height): a hand-built config that gives none gets the defaults.
import { hitboxOf, trafficHeightM, type Hitbox } from '../../core';
import type { SimAssists, SimConfig, SimTrafficTypeDef } from '../types';

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

/**
 * A rider's contact box on its bike, m: its def's `hitbox` (the rider's file's, else its bike's: the
 * lawnmower, the mobility scooter, the parking trike), else core's DEFAULT_HITBOX, 2.0 x 0.8
 * (docs/content-packs.md, "Heights and hitboxes"). Traffic, smash, set pieces, peds and the tumble
 * meet a rider with it; a riderIndex of -1 (not a rider) is the default box.
 */
export function riderHitbox(config: SimConfig, riderIndex: number): Readonly<Hitbox> {
  return hitboxOf(riderIndex >= 0 ? config.riders[riderIndex]?.hitbox : undefined);
}

/**
 * How tall a traffic type stands, m: its `heightM` (buildSimConfig always writes it), else its
 * category's default (a hand-built config). A rider clears it only above this.
 */
export function vehicleHeightM(t: SimTrafficTypeDef): number {
  return trafficHeightM(t);
}
