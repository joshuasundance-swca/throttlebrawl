// Playtest 2 (2026-10-02): "Engine monotonous and maybe too loud", then ENGINE: "Richer and
// quieter" (a lower default level, gear shifts, a rev on throttle, a pop on decel). The feel is
// pure, so its rules are checked here; the mixer's use of it is checked on the fake context below,
// and the levels in dB offline in tests/e2e/audio-mix.spec.ts.
import { describe, expect, it } from 'vitest';
import { createEngineFeel, ENGINE_FEEL_DEFAULTS, heardRpm } from './engine-feel';
import { fakeContextFactory } from './fake-context';
import { createAudio, ENGINE_LEVELS } from './system';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';

const P = ENGINE_FEEL_DEFAULTS;

describe('engine feel: gears', () => {
  it('first gear plays the sim rpm; higher gears run from the shift floor to redline', () => {
    expect(heardRpm(1200, 1, P)).toBe(1200);
    expect(heardRpm(7000, 1, P)).toBe(7000);
    expect(heardRpm(1200, 3, P)).toBe(P.shiftFloorRpm);
    expect(heardRpm(10000, 3, P)).toBe(P.redlineRpm);
    expect(heardRpm(5600, 2, P)).toBeCloseTo(P.shiftFloorRpm + 0.5 * (P.redlineRpm - P.shiftFloorRpm));
    // An unknown gear (the skeleton path) plays the sim's rpm.
    expect(heardRpm(3000, 0, P)).toBe(3000);
  });

  it('an upshift drops the heard rpm by a real-engine step, not back to idle, and dips the level', () => {
    const f = createEngineFeel();
    const top = f.step({ t: 0, rpm: 10000, gear: 2, throttle: 1, down: false });
    const after = f.step({ t: 1 / 60, rpm: 1200, gear: 3, throttle: 1, down: false });
    expect(after.shift).toBe('up');
    expect(after.rpm).toBeGreaterThan(P.idleRpm * 3);
    expect(after.rpm / top.rpm).toBeGreaterThan(0.5);
    expect(after.rpm / top.rpm).toBeLessThan(0.75);
    expect(after.level).toBe(P.shiftDip);
    // The dip is brief.
    const later = f.step({ t: 0.3, rpm: 3000, gear: 3, throttle: 1, down: false });
    expect(later.level).toBe(1);
    expect(later.shift).toBeNull();
  });

  it('a downshift blips the revs above the gear`s own, then settles', () => {
    const f = createEngineFeel();
    f.step({ t: 0, rpm: 3000, gear: 3, throttle: 0.2, down: false });
    const blip = f.step({ t: 1 / 60, rpm: 9000, gear: 2, throttle: 0.2, down: false });
    expect(blip.shift).toBe('down');
    expect(blip.rpm).toBeGreaterThan(heardRpm(9000, 2, P) + 500);
    const settled = f.step({ t: 1, rpm: 9000, gear: 2, throttle: 0.2, down: false });
    expect(settled.rpm).toBeCloseTo(heardRpm(9000, 2, P));
  });
});

describe('engine feel: the throttle', () => {
  it('snapping the throttle open flares the revs and the load for a moment', () => {
    const f = createEngineFeel();
    f.step({ t: 0, rpm: 4000, gear: 1, throttle: 0, down: false });
    const snap = f.step({ t: 1 / 60, rpm: 4000, gear: 1, throttle: 1, down: false });
    expect(snap.rev).toBe(true);
    expect(snap.rpm).toBeGreaterThan(4000 + P.revRpm * 0.9);
    const gone = f.step({ t: 1, rpm: 4000, gear: 1, throttle: 1, down: false });
    expect(gone.rpm).toBe(4000);
    // Opening it slowly does not.
    const g = createEngineFeel();
    let any = false;
    for (let i = 0; i <= 60; i++)
      any ||= g.step({ t: i / 60, rpm: 4000, gear: 1, throttle: i / 60, down: false }).rev;
    expect(any).toBe(false);
  });

  it('shutting it at high revs pops a burst; at low revs it does not', () => {
    const f = createEngineFeel(7);
    f.step({ t: 0, rpm: 9000, gear: 2, throttle: 1, down: false });
    const shut = f.step({ t: 1 / 60, rpm: 9000, gear: 2, throttle: 0, down: false });
    expect(shut.pops.length).toBeGreaterThanOrEqual(P.popBurstMin);
    expect(shut.pops.length).toBeLessThanOrEqual(P.popBurstMax);
    for (const p of shut.pops) {
      expect(p.delayS).toBeGreaterThanOrEqual(0);
      expect(p.delayS).toBeLessThanOrEqual(P.popBurstS);
      expect(p.size).toBeGreaterThan(0);
      expect(p.size).toBeLessThanOrEqual(1);
    }
    const low = createEngineFeel(7);
    low.step({ t: 0, rpm: 2000, gear: 1, throttle: 1, down: false });
    expect(low.step({ t: 1 / 60, rpm: 2000, gear: 1, throttle: 0, down: false }).pops).toEqual([]);
  });

  it('coasting at high revs crackles now and then, about `coastPopsPerS`; the same seed, the same pops', () => {
    const run = (seed: number) => {
      const f = createEngineFeel(seed);
      let pops = 0;
      for (let i = 0; i < 60 * 20; i++)
        pops += f.step({ t: i / 60, rpm: 8000, gear: 2, throttle: 0, down: false }).pops.length;
      return pops;
    };
    const n = run(11);
    expect(n / 20).toBeGreaterThan(P.coastPopsPerS * 0.5);
    expect(n / 20).toBeLessThan(P.coastPopsPerS * 2);
    expect(run(11)).toBe(n);
  });

  it('off the bike, the engine idles with no feel', () => {
    const f = createEngineFeel();
    f.step({ t: 0, rpm: 9000, gear: 2, throttle: 1, down: false });
    const down = f.step({ t: 1 / 60, rpm: 9000, gear: 2, throttle: 0, down: true });
    expect(down).toMatchObject({ rpm: 0, load: 0, pops: [], shift: null, rev: false });
  });
});

describe('engine feel in the mixer', () => {
  const rider = (over: Partial<EntitySnapshot>): EntitySnapshot =>
    ({
      id: 0,
      kind: 'rider',
      mode: 'Riding',
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      speed: 30,
      contentId: 'player',
      rpm: 5000,
      gear: 2,
      throttle: 1,
      ...over,
    }) as unknown as EntitySnapshot;
  const snap = (me: EntitySnapshot): SimSnapshot =>
    ({ tick: 0, timeScale: 1, entities: [me] }) as unknown as SimSnapshot;

  async function racing() {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({ createContext: create, radioKeys: null, barkEvents: null });
    await audio.resume();
    return { ctx, audio };
  }

  it('plays the player`s engine quieter than before playtest 2 (0.5), and follows the slider', async () => {
    const { audio } = await racing();
    audio.frame(snap(rider({})), 0);
    expect(audio.inspect().playerEngineLevel).toBeCloseTo(ENGINE_LEVELS.player);
    expect(20 * Math.log10(ENGINE_LEVELS.player / 0.5)).toBeLessThan(-9);
    audio.setParam('audio.engineGain', 2);
    audio.frame(snap(rider({})), 0);
    expect(audio.inspect().playerEngineLevel).toBeCloseTo(2 * ENGINE_LEVELS.player);
  });

  it('counts a shift, dips the level for it, and fires pops when the throttle shuts at high revs', async () => {
    const { ctx, audio } = await racing();
    audio.setParam('audio.radio', 0); // no music, so every new oscillator is the engine's
    audio.frame(snap(rider({ rpm: 10000, gear: 2, throttle: 1 })), 0);
    ctx.currentTime = 1 / 60;
    audio.frame(snap(rider({ rpm: 1200, gear: 3, throttle: 1 })), 0);
    expect(audio.inspect().engineFeel.shifts).toBe(1);
    expect(audio.inspect().playerEngineLevel).toBeCloseTo(
      ENGINE_LEVELS.player * ENGINE_FEEL_DEFAULTS.shiftDip,
    );
    const oscBefore = ctx.nodes.filter((n) => n.kind === 'oscillator').length;
    ctx.currentTime = 0.5;
    audio.frame(snap(rider({ rpm: 10000, gear: 3, throttle: 1 })), 0);
    ctx.currentTime = 0.5 + 1 / 60;
    audio.frame(snap(rider({ rpm: 10000, gear: 3, throttle: 0 })), 0);
    const pops = audio.inspect().engineFeel.pops;
    expect(pops).toBeGreaterThanOrEqual(ENGINE_FEEL_DEFAULTS.popBurstMin);
    // Each pop is a thump oscillator (and a noise burst) on the audio graph.
    expect(ctx.nodes.filter((n) => n.kind === 'oscillator').length - oscBefore).toBe(pops);
  });

  it('the pops slider at 0 turns them off', async () => {
    const { ctx, audio } = await racing();
    audio.setParam('audio.enginePops', 0);
    audio.frame(snap(rider({ rpm: 10000, gear: 3, throttle: 1 })), 0);
    ctx.currentTime = 1 / 60;
    audio.frame(snap(rider({ rpm: 10000, gear: 3, throttle: 0 })), 0);
    expect(audio.inspect().engineFeel.pops).toBe(0);
  });
});
