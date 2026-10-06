// A string of lights hung between two points (playtest 4, P4-19: "Duval St should be a party street";
// Chinatown's lantern strings, run W-U, were the first). One sagging cord and the things hung from it
// (lanterns, bulbs), as plain points: the lantern builder in chinatown-northbeach.ts and the party
// street's lights (party-lights.ts) both hang theirs this way, so a string sags and spaces its lights
// the same wherever it is hung. Pure geometry, no three.js objects: presentation only.
import type { Point3 } from './geometry';

/** How far a hung string has dropped at `u` (0 at one end, 1 at the other) when it sags `sagM` at its middle. */
export const sagAt = (u: number, sagM: number): number => 4 * sagM * u * (1 - u);

/** The point at `u` along the chord from a to b, dropped by the sag. */
export function stringPoint(a: Point3, b: Point3, u: number, sagM: number): Point3 {
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u - sagAt(u, sagM),
    z: a.z + (b.z - a.z) * u,
  };
}

/** The cord itself: `segments + 1` points from a to b, sagging `sagM` at the middle. */
export function stringPoints(a: Point3, b: Point3, sagM: number, segments: number): Point3[] {
  const out: Point3[] = [];
  for (let i = 0; i <= segments; i++) out.push(stringPoint(a, b, i / segments, sagM));
  return out;
}

/** How a string's lights are spaced and hung. */
export interface Hanging {
  /** The sag at the cord's middle, m. */
  sagM: number;
  /** Metres between lights along the chord, and how far in from each end the first and last hang. */
  pitchM: number;
  endM: number;
  /** How far each light's top hangs below the cord, m. Default 0. */
  dropM?: number;
}

/**
 * The points where a string's lights hang: every `pitchM` along the chord, `endM` in from a, to `endM` short
 * of b (a light exactly `endM` from b hangs too, so a pitch that divides the span evenly keeps its last one).
 */
export function hangPoints(a: Point3, b: Point3, h: Hanging): Point3[] {
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const out: Point3[] = [];
  if (span <= 0) return out;
  for (let along = h.endM; along < span - h.endM + 1e-6; along += h.pitchM) {
    const p = stringPoint(a, b, along / span, h.sagM);
    out.push({ x: p.x, y: p.y - (h.dropM ?? 0), z: p.z });
  }
  return out;
}

/** The lowest a string hangs between a and b (its cord's middle), for a clearance check. */
export function lowestPoint(a: Point3, b: Point3, sagM: number): number {
  return Math.min(a.y, b.y, (a.y + b.y) / 2 - sagM);
}
