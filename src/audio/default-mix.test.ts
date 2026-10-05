import { describe, expect, it } from 'vitest';
import { busTargets, createAudio as createStandIn, DEFAULT_VOLUMES } from './index';
import { createAudio as createEngine } from './system';

// Playtest 4, P4-18 (the maintainer: "Effects are too loud by default compared to the other audio").
// audio's own starting levels (what it reports and plays before app/ hands it the settings record's
// volumes at boot) moved with the record's defaults: Effects 90% -> 70%. One constant, DEFAULT_VOLUMES
// (tuning.ts), is what both the stand-in (index.ts) and the engine (system.ts) start from. That they
// agree with the settings record is held in src/app/default-mix.test.ts.

const quiet = { radioKeys: null, barkEvents: null, radioSeed: 1 } as const;

describe("audio's starting levels", () => {
  it('are master 80%, music 60%, effects 70% (voices 90% until the record hands over its own 80%)', () => {
    expect(DEFAULT_VOLUMES).toEqual({ master: 0.8, music: 0.6, effects: 0.7, voices: 0.9 });
    // Frozen: the engine and the stand-in each start from a copy, so nothing can write through it.
    expect(Object.isFrozen(DEFAULT_VOLUMES)).toBe(true);
  });

  it('are what the stand-in reports before the engine loads, and what the engine starts with', () => {
    const want = busTargets({ ...DEFAULT_VOLUMES }, false);
    expect(want.effects).toBeCloseTo(0.49, 10);
    // A load that never arrives: the stand-in answers from its own start levels.
    const standIn = createStandIn(quiet, () => new Promise(() => undefined));
    expect(standIn.inspect().busTargets).toEqual(want);
    expect(createEngine(quiet).inspect().busTargets).toEqual(want);
  });

  it('give way to the levels app/ hands over, and a second engine still starts at the defaults', () => {
    const first = createEngine(quiet);
    first.setVolumes({ master: 1, music: 1, effects: 1, voices: 1 }, false);
    expect(first.inspect().busTargets.effects).toBe(1);
    expect(createEngine(quiet).inspect().busTargets).toEqual(busTargets({ ...DEFAULT_VOLUMES }, false));
  });
});
