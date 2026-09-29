// Seeded random numbers (docs/architecture.md, "Determinism rules"). One named stream per sim
// subsystem, derived from the race seed, so a new roll in traffic never shifts the AI's rolls.
// A stream's state is one plain number, kept in sim state, so it hashes and serializes.
import { fnvString, fnvU32, FNV_OFFSET } from './hash';

export const RNG_STREAMS = ['traffic', 'ai', 'combat', 'peds', 'cops', 'tumble', 'modifiers'] as const;
export type RngStreamName = (typeof RNG_STREAMS)[number];

/** The state of one stream (mulberry32). Plain data: copy it, hash it, store it. */
export interface RngState {
  s: number;
}

/** A stream's seed from the race seed, the subsystem, and an optional entity id (a substream). */
export function streamSeed(raceSeed: number, stream: string, entityId?: number): number {
  let h = fnvU32(FNV_OFFSET, raceSeed >>> 0);
  h = fnvString(h, stream);
  if (entityId !== undefined) h = fnvU32(h, entityId >>> 0);
  return h;
}

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Every named stream for a race seed. */
export function createStreams(raceSeed: number): Record<RngStreamName, RngState> {
  const out = {} as Record<RngStreamName, RngState>;
  for (const name of RNG_STREAMS) out[name] = createRng(streamSeed(raceSeed, name));
  return out;
}

/** The next unsigned 32-bit integer; advances the state. Integer maths only, so bit-exact. */
export function nextU32(st: RngState): number {
  st.s = (st.s + 0x6d2b79f5) | 0;
  let t = st.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** A float in [0, 1). */
export function nextFloat(st: RngState): number {
  return nextU32(st) / 4294967296;
}

/** A float in [lo, hi). */
export function nextRange(st: RngState, lo: number, hi: number): number {
  return lo + (hi - lo) * nextFloat(st);
}
