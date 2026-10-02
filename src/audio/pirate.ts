// The hidden pirate station (run W-Q audio, interview 2026-10-02 round 6: "a hidden pirate station
// per region"). A station file with a `pirate` spot is never on the dial: it comes in only when the
// rider is near one place on the route, takes over the radio there (the score too, unless the radio
// is off) behind a burst of tuning static, and gives the dial back when the rider rides on. The spot
// is a fraction of the way along the route and a radius, so it works on every route length of a
// region. Pure; index.ts drives it.

export interface PirateSpot {
  /** How far along the route the spot is, 0..1 of the route's length. */
  atFraction: number;
  /** How near the rider must be to hear it, m. */
  radiusM: number;
}

/** Leaving the spot takes this much more than entering it (so the station never flickers at the edge). */
export const PIRATE_EXIT_SCALE = 1.2;
/** The smallest radius a spot may have, m (a data typo never makes it a point nobody can hit). */
export const PIRATE_MIN_RADIUS_M = 60;

/** A spot from a station file's `pirate` field, or null when it is missing or malformed. */
export function pirateSpotFrom(v: unknown): PirateSpot | null {
  if (typeof v !== 'object' || v === null) return null;
  const at = (v as Record<string, unknown>)['atFraction'];
  const radius = (v as Record<string, unknown>)['radiusM'];
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > 1) return null;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) return null;
  return { atFraction: at, radiusM: Math.max(PIRATE_MIN_RADIUS_M, radius) };
}

/** Where along the route the spot is, m (kept off the very start and finish, where nobody listens). */
export function pirateCentreM(spot: PirateSpot, routeLengthM: number): number {
  return Math.min(0.95, Math.max(0.05, spot.atFraction)) * routeLengthM;
}

/**
 * Whether a rider `progressM` metres along a `routeLengthM` route hears the pirate. `was` is whether
 * it was on a moment ago: staying on takes `PIRATE_EXIT_SCALE` times the radius.
 */
export function inPirateSpot(
  spot: PirateSpot,
  progressM: number,
  routeLengthM: number,
  was: boolean,
): boolean {
  if (!(routeLengthM > 0) || !Number.isFinite(progressM)) return false;
  const d = Math.abs(progressM - pirateCentreM(spot, routeLengthM));
  return d <= spot.radiusM * (was ? PIRATE_EXIT_SCALE : 1);
}
