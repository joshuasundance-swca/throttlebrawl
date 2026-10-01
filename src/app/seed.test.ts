import { describe, expect, it } from 'vitest';
import { createRaceSeeds, cryptoSeed } from './seed';

describe('race seeds (playtest 1c item 2)', () => {
  it('draws a fresh seed for each race when no seed is fixed', () => {
    let n = 100;
    const seeds = createRaceSeeds(undefined, () => n++);
    expect([seeds.next(), seeds.next(), seeds.next()]).toEqual([100, 101, 102]);
    expect(seeds.fixed).toBeNull();
  });

  it('never repeats the last race seed, even from a stuck source', () => {
    const seeds = createRaceSeeds(null, () => 7);
    const a = seeds.next();
    const b = seeds.next();
    expect(a).toBe(7);
    expect(b).not.toBe(a);
  });

  it('a fixed seed pins every race (the test flag, setSeed)', () => {
    let draws = 0;
    const seeds = createRaceSeeds(1, () => ++draws);
    expect([seeds.next(), seeds.next()]).toEqual([1, 1]);
    seeds.fix(42);
    expect(seeds.next()).toBe(42);
    expect(seeds.fixed).toBe(42);
    expect(draws).toBe(0);
  });

  it('seeds are unsigned 32-bit integers', () => {
    const seeds = createRaceSeeds(undefined, () => -1);
    expect(seeds.next()).toBe(0xffffffff);
    const s = cryptoSeed();
    expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
  });

  it('the crypto source gives two different seeds in a row', () => {
    const seeds = createRaceSeeds();
    expect(seeds.next()).not.toBe(seeds.next());
  });
});
