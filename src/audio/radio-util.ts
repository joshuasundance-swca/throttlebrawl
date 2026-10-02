// Small pure helpers the code-made radio composers share (radio-compose.ts and
// radio-compose-regional.ts): seeded randomness, key names, scale walks and the loop finisher.
import type { Composition, RadioNote } from './radio-compose';

/** FNV-1a, 32-bit: a string to a seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small seeded stream in [0, 1). Presentation only; never the sim's streams. */
export function seededRandom(seed: number): () => number {
  let a = (seed ^ 0x3c6ef372) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NOTE_PC: Readonly<Record<string, number>> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

/** A key name's root in the bass register (D2..C#3), so phones still hear the bass's harmonics. */
export function keyRoot(name: string): number | null {
  const pc = NOTE_PC[name];
  if (pc === undefined) return null;
  const root = 36 + pc;
  return root < 38 ? root + 12 : root;
}

export type Rand = () => number;
export const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length] as T;
export const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;
export const oneOf = <T extends string>(v: unknown, xs: readonly T[]): T | null =>
  typeof v === 'string' && (xs as readonly string[]).includes(v) ? (v as T) : null;
export const humanize = (r: Rand, vel: number) => Math.min(1, Math.max(0.05, vel * (0.92 + 0.16 * r())));

export function finish(
  base: Omit<Composition, 'notes' | 'steps' | 'stepS'>,
  notes: RadioNote[],
): Composition {
  const steps = base.stepsPerBar * base.bars;
  const stepS = 60 / base.bpm / base.stepsPerBeat;
  const kept = notes.filter((n) => n.step >= 0 && n.step < steps);
  kept.sort((a, b) => a.step - b.step);
  return { ...base, steps, stepS, notes: kept };
}

/** Nearest pitch to `near` among `pcs` (pitch classes relative to `root`) inside [lo, hi]. */
export function nearestOf(
  pcs: readonly number[],
  root: number,
  near: number,
  lo: number,
  hi: number,
): number {
  let best = near;
  let bestD = Infinity;
  for (let m = lo; m <= hi; m++) {
    const pc = (((m - root) % 12) + 12) % 12;
    if (!pcs.includes(pc)) continue;
    const d = Math.abs(m - near);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/** `n` scale steps from `from` along the scale `pcs` (relative to `root`). */
export function scaleStep(pcs: readonly number[], root: number, from: number, n: number): number {
  let m = from;
  const dir = Math.sign(n);
  let left = Math.abs(n);
  while (left > 0) {
    m += dir;
    const pc = (((m - root) % 12) + 12) % 12;
    if (pcs.includes(pc)) left--;
  }
  return m;
}
