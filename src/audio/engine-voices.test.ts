// Playtest 2 (2026-10-02), ENGINE: "Richer and quieter" ("a voice per bike, rivals' engines heard
// passing"): every bike class has its own engine voice, a rider's drawn bike picks it, and other
// riders' engines sit left or right of you as they pass. The patches themselves are rendered
// offline in tests/e2e/audio-engine.spec.ts.
import { describe, expect, it } from 'vitest';
import { BIKE_CLASSES, loadBasePack, registryFromGlob } from '../content';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import {
  ENGINE_PRESETS,
  engineFrequencyHz,
  resolveEngineProfile,
  type EngineSoundSpec,
} from './engine-patch';
import { fakeContextFactory } from './fake-context';
import { createAudio } from './index';
import { panFor } from './spatial';

// The class-to-voice table is pack data (run W-S): the base pack's `defaults.engineSoundByClass`.
const byClass: Readonly<Record<string, EngineSoundSpec | undefined>> =
  loadBasePack().packs.find((p) => p.id === 'base')?.defaults.engineSoundByClass ?? {};

describe('a voice per bike', () => {
  it('every bike class has a voice in the base pack, and every voice names a real preset', () => {
    for (const c of BIKE_CLASSES) {
      const spec = byClass[c];
      expect(spec, c).toBeDefined();
      expect(Object.keys(ENGINE_PRESETS)).toContain(spec?.preset);
    }
  });

  it('chopper thump, scooter buzz, sport scream and dirt rasp are four different engines', () => {
    const p = (c: string) => resolveEngineProfile(byClass[c]);
    const [chopper, scooter, sport, dirt] = ['chopper', 'scooter', 'sport', 'dirt'].map(p);
    expect(new Set([chopper, scooter, sport, dirt].map((x) => x!.preset)).size).toBe(4);
    // The chopper is the deepest and the sport bike screams highest.
    const top = (x: typeof chopper) => engineFrequencyHz(x!, x!.redlineRpm);
    expect(top(chopper)).toBeLessThan(top(scooter));
    expect(top(chopper)).toBeLessThan(top(dirt));
    expect(top(sport)).toBeGreaterThan(top(scooter));
    expect(top(sport)).toBeGreaterThan(top(dirt));
    expect(chopper!.cylinders).toBe(2);
    expect(sport!.cylinders).toBe(4);
    // The rasp: more intake noise than any other single.
    expect(dirt!.noise).toBeGreaterThan(ENGINE_PRESETS['single-thump']!.noise);
  });

  it('a class`s numbers shape its preset (a superbike revs past a sport bike)', () => {
    const sup = resolveEngineProfile(byClass['super']);
    expect(sup.preset).toBe('inline-four');
    expect(sup.redlineHz).toBeGreaterThan(ENGINE_PRESETS['inline-four']!.redlineHz);
  });

  it('the packs` rivals are drawn on at least four classes, so the field sounds mixed', () => {
    const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
    const voices = new Set<string>();
    for (const r of Object.values(reg.riders)) {
      const cls = (r as { look?: { bikeClass?: unknown } }).look?.bikeClass;
      if (typeof cls === 'string') voices.add(resolveEngineProfile(byClass[cls]).preset);
    }
    expect(voices.size).toBeGreaterThanOrEqual(4);
    // The base pack alone loads too (the class list does not depend on the region packs).
    expect(Object.keys(loadBasePack().riders).length).toBeGreaterThan(0);
  });
});

describe('rivals heard passing', () => {
  it('pans a source by its side of the listener`s heading', () => {
    const me = { x: 0, z: 0, heading: 0 }; // facing -z: right is +x
    expect(panFor(me, { x: 10, z: 0 })).toBe(1);
    expect(panFor(me, { x: -5, z: 0 })).toBe(-0.5);
    expect(panFor(me, { x: 0, z: -40 })).toBeCloseTo(0);
    // Turned to face +x (heading -pi/2), the right is +z.
    expect(panFor({ x: 0, z: 0, heading: -Math.PI / 2 }, { x: 0, z: 10 })).toBeCloseTo(1);
  });

  it('a rival on a chopper passing on your left plays the chopper`s voice, panned left', async () => {
    const { create } = fakeContextFactory();
    const audio = createAudio({ createContext: create, radioKeys: null, barkEvents: null });
    await audio.resume();
    audio.setEngineSounds({
      player: { preset: 'single-thump' },
      'base:mother-rust': byClass['chopper']!,
      'base:dial-up': byClass['scooter']!,
    });
    const rider = (id: number, contentId: string, x: number, z: number): EntitySnapshot =>
      ({
        id,
        kind: 'rider',
        mode: 'Riding',
        x,
        y: 0,
        z,
        heading: 0,
        speed: 30,
        contentId,
        rpm: 6000,
        gear: 3,
        throttle: 1,
      }) as unknown as EntitySnapshot;
    const snap = {
      tick: 0,
      timeScale: 1,
      entities: [
        rider(0, 'player', 0, 0),
        rider(1, 'base:mother-rust', -4, -2),
        rider(2, 'base:dial-up', 6, 20),
      ],
    } as unknown as SimSnapshot;
    audio.frame(snap, 0);
    const v = audio.inspect().otherEngineVoices;
    expect(v.map((x) => x.preset)).toEqual(['v-twin', 'two-stroke-buzz']);
    expect(v[0]!.pan).toBeLessThan(-0.2);
    expect(v[1]!.pan).toBeGreaterThan(0.2);
    for (const x of v) expect(Math.abs(x.pan)).toBeLessThanOrEqual(0.8);
  });
});
