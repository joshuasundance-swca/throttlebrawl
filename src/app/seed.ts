// Each race's seed (playtest 1c item 2, 2026-09-30: "I want randomness so you don't see the same
// cars in the same order, ramp truck in the same place, etc"). A new race draws a fresh seed here,
// at race start and outside the sim, and the seed goes into SimConfig, so the recording's header
// carries it and a replay or a resume reproduces the race exactly. A fixed seed (the test flag, a
// test's `setSeed`) makes every race use that one instead, so seeded tests stay repeatable.

/** Where a fresh seed comes from: any non-deterministic source (never the sim's own streams). */
export type SeedSource = () => number;

/** A fresh 32-bit seed from the browser's (or Node's) cryptographic random source. */
export function cryptoSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 1) >>> 0;
}

export interface RaceSeeds {
  /** The seed for the race starting now: the fixed one, else a fresh draw. */
  next(): number;
  /** Fixes the seed every later race uses (a test's `setSeed`). */
  fix(seed: number): void;
  /** The fixed seed, or null while each race draws its own. */
  readonly fixed: number | null;
}

/**
 * The race seed policy: `fixed` (a number) pins every race to it; otherwise each `next()` draws
 * from `source`. Two draws in a row never repeat: a repeat is redrawn (and, from a stuck source,
 * stepped by one), so two races in a row always differ.
 */
export function createRaceSeeds(fixed?: number | null, source: SeedSource = cryptoSeed): RaceSeeds {
  let pinned = fixed === undefined || fixed === null ? null : fixed >>> 0;
  let last: number | null = null;
  return {
    next() {
      if (pinned !== null) return pinned;
      let seed = source() >>> 0;
      if (seed === last) seed = source() >>> 0;
      if (seed === last) seed = (seed + 1) >>> 0;
      last = seed;
      return seed;
    },
    fix(seed) {
      pinned = seed >>> 0;
    },
    get fixed() {
      return pinned;
    },
  };
}
