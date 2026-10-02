// Distance and Doppler for sounds placed in the world (docs/architecture.md, "Audio": other riders
// at lower cost, with distance attenuation and Doppler pitch from relative speed). World axes
// follow the sim snapshot: x east, z south, and heading 0 faces -z.
import type { EntitySnapshot } from '../sim/api';

/** Speed of sound, m/s. */
const C = 343;

export interface Moving {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Ground-plane position and velocity of an entity, from its heading and speed. */
export function moving(e: Pick<EntitySnapshot, 'x' | 'z' | 'heading' | 'speed'>): Moving {
  return { x: e.x, z: e.z, vx: -Math.sin(e.heading) * e.speed, vz: -Math.cos(e.heading) * e.speed };
}

export function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Gain for a source `d` metres away: full inside `refM`, inverse-distance beyond it, faded to
 * zero at `maxM` so nothing pops when a voice is dropped.
 */
export function distanceGain(d: number, refM = 6, maxM = 180): number {
  if (d >= maxM) return 0;
  const inv = d <= refM ? 1 : refM / d;
  const fadeStart = maxM * 0.75;
  const fade = d <= fadeStart ? 1 : (maxM - d) / (maxM - fadeStart);
  return inv * fade;
}

/**
 * Where a source sits left (-1) or right (1) of a listener facing `heading` (0 faces -z), from its
 * sideways offset: fully to one side at `fullM` metres. Sources ahead or behind sit in the middle.
 */
export function panFor(
  listener: { x: number; z: number; heading: number },
  source: { x: number; z: number },
  fullM = 10,
): number {
  // The listener's right: +x when facing -z.
  const rx = Math.cos(listener.heading);
  const rz = -Math.sin(listener.heading);
  const side = (source.x - listener.x) * rx + (source.z - listener.z) * rz;
  return Math.min(1, Math.max(-1, side / fullM));
}

/**
 * Pitch factor heard by `listener` from `source`: above 1 while they close, below 1 while they
 * part. `scale` 0 turns it off; the result is clamped to half and double.
 */
export function dopplerFactor(listener: Moving, source: Moving, scale = 1): number {
  const d = distance(listener, source);
  if (scale === 0 || d < 1e-6) return 1;
  // Unit vector from listener to source.
  const ux = (source.x - listener.x) / d;
  const uz = (source.z - listener.z) / d;
  const vl = (listener.vx * ux + listener.vz * uz) * scale; // listener toward source: +
  const vs = (source.vx * ux + source.vz * uz) * scale; // source away from listener: +
  const f = (C + vl) / (C + vs);
  return Math.min(2, Math.max(0.5, f));
}
