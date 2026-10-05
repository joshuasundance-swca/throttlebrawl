// W-Q (the pitch deck's item 8, "A different field and light each race"): a free-play race draws its
// rivals from the region's whole cast and its time of day from the region's list, by the seed. Every
// carried pack, the way the game loads them.
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { buildSimConfig, raceField, raceTimeOfDay } from './config';
import { createStreamCache } from './regions';

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const streams = createStreamCache();
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const KEYS = 'm1-skeleton-sprint';
const PNW = 'region-pnw:pnw-fogline-run';
const SF = 'region-sf:sf-hill-sprint';

const rivals = (eventId: string, seed: number, freePlay?: boolean) =>
  buildSimConfig(ALL, streams.forEvent(ALL, eventId), {
    seed,
    eventId,
    ...(freePlay === undefined ? {} : { freePlay }),
  })
    .riders.filter((r) => r.role === 'rival')
    .map((r) => r.contentId);

describe('W-Q: a free-play race draws its field and its light by the seed', () => {
  it('left out, a race fields the event’s own four (the career and the batch race these)', () => {
    expect(rivals(KEYS, 3)).toEqual([
      'base:deacon-vane',
      'base:dial-up',
      'base:chad-speedwell',
      'base:kevin-from-accounting',
    ]);
    expect(raceField(ALL, KEYS, 3)).toEqual(rivals(KEYS, 3));
    expect(raceTimeOfDay(ALL, PNW, 3)).toBe('dawn');
  });

  it('free play: four rivals from the whole Keys cast, so the three who never rode now ride', () => {
    const seen = new Set<string>();
    const fields = new Set<string>();
    for (const seed of SEEDS) {
      const field = rivals(KEYS, seed, true);
      expect(field).toHaveLength(4);
      expect(new Set(field).size).toBe(4);
      for (const id of field) seen.add(id);
      fields.add([...field].sort().join(','));
    }
    console.log(
      `[examined] Keys free play over ${SEEDS.length} seeds: ${fields.size} fields, cast ${[...seen].sort().join(', ')}`,
    );
    expect([...seen].sort()).toEqual([
      'base:chad-speedwell',
      'base:deacon-vane',
      'base:dial-up',
      'base:kevin-from-accounting',
      'base:mother-rust',
      'base:tammy-two-stroke',
      'base:the-mayor',
    ]);
    expect(fields.size).toBeGreaterThan(5);
  });

  it('each region draws only its own locals and the travelling cast', () => {
    for (const seed of SEEDS) {
      for (const id of rivals(PNW, seed, true))
        expect(id, `seed ${seed}`).toMatch(
          /^(base:(deacon-vane|dial-up|chad-speedwell|kevin-from-accounting)|region-pnw:)/,
        );
      for (const id of rivals(SF, seed, true))
        expect(id, `seed ${seed}`).toMatch(
          /^(base:(deacon-vane|dial-up|chad-speedwell|kevin-from-accounting)|region-sf:)/,
        );
    }
  });

  it('the same seed draws the same field and light; the light is one of the region’s', () => {
    expect(rivals(SF, 9, true)).toEqual(rivals(SF, 9, true));
    const times = new Set(SEEDS.map((s) => raceTimeOfDay(ALL, SF, s, true)));
    expect([...times].sort()).toEqual(['dawn', 'golden-hour']);
    expect(raceTimeOfDay(ALL, SF, 9, true)).toBe(raceTimeOfDay(ALL, SF, 9, true));
    // The Keys list has several (T10.4 added noon and dusk): each draw is one of them, and 40 seeds
    // draw more than one.
    const keysLights = ALL.regions['base:florida-keys']?.timeOfDayOptions.map((o) => o.id) ?? [];
    const keysDrawn = new Set(SEEDS.map((s) => raceTimeOfDay(ALL, KEYS, s, true)));
    for (const light of keysDrawn) expect(keysLights).toContain(light);
    expect(keysDrawn.size).toBeGreaterThan(1);
  });
});
