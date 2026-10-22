import { describe, expect, it } from 'vitest';
import { registryFromGlob, type ContentRegistry } from '../content';
import { DEFAULT_RACE_OPTIONS } from '../save';
import { buildSimConfig } from './config';
import { quickPlayEvent, quickPlayEvents, quickPlayObjective, quickPlaySetup } from './quick-play-events';
import { createStreamCache, regionChoices, routeChoices } from './regions';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const REGION = 'region-clinton:clinton-iowa';
const EVENT = 'region-clinton:clinton-mara-survey-run';
const RACE = 'region-clinton:clinton-ia136-race';
const MARA = 'region-clinton:mara-vale';
const PARK = 'region-clinton:osm-clinton-eagle-point-run';
const HIGHWAY = 'region-clinton:osm-clinton-ia136-run';

function encounter(reg = registry, field: 'open' | 'matched' = 'open', seed = 1) {
  const choice = quickPlayEvent(reg, REGION, 'grudge');
  expect(choice?.kind).toBe('grudge');
  expect(choice?.eventId).toBe(EVENT);
  const setup = quickPlaySetup(
    reg,
    EVENT,
    { ...DEFAULT_RACE_OPTIONS, rivals: 0, bike: 'base:streetfighter-750' },
    { owned: [], current: null },
    field,
    seed,
    'normal',
    {},
  );
  const config = buildSimConfig(reg, createStreamCache().forEvent(reg, EVENT, 'obsolete-length'), {
    seed,
    eventId: EVENT,
    length: 'obsolete-length',
    ...setup,
  });
  return config;
}

function assertEncounter(reg: ContentRegistry) {
  const config = encounter(reg);
  expect(config.event.routeId, 'the named encounter must use Eagle Point').toBe(PARK);
  expect(config.riders.filter((r) => r.role === 'rival').map((r) => r.contentId)).toEqual([MARA]);
  return config;
}

describe('Iowa named park encounter', () => {
  it('offers Mara on Eagle Point while keeping Rural Rush as the regional and Race default', () => {
    assertEncounter(registry);
    expect(quickPlayObjective(registry, EVENT)).toContain(registry.riders[MARA]!.name);
    expect(quickPlayObjective(registry, EVENT)).toContain('finish');
    expect(quickPlayEvent(registry, REGION, 'race')?.eventId).toBe(RACE);
    expect(regionChoices(registry).find((r) => r.id === REGION)?.eventId).toBe(RACE);
    expect(routeChoices(registry, RACE).map((r) => r.id)).toEqual(expect.arrayContaining([null, PARK]));
    const ordinary = buildSimConfig(registry, createStreamCache().forEvent(registry, RACE), {
      seed: 1,
      eventId: RACE,
    });
    expect(ordinary.event.routeId).toBe(HIGHWAY);
    expect(ordinary.riders.filter((r) => r.role === 'rival').length).toBeGreaterThan(1);
  });

  it.each(['open', 'matched'] as const)('keeps named opposition despite zero-rival picks in %s', (field) => {
    for (const seed of [1, 2]) {
      const config = encounter(registry, field, seed);
      expect(config.event.routeId).toBe(PARK);
      expect(config.riders.filter((r) => r.role === 'rival').map((r) => r.contentId)).toEqual([MARA]);
      expect(config.riders.find((r) => r.role === 'player')?.bike.contentId).toBe('base:streetfighter-750');
      expect(config.riders.some((r) => r.controller.kind === 'cop')).toBe(true);
      expect(config.trafficTypes.some((t) => t.category === 'car' && t.weight > 0)).toBe(true);
    }
  });

  it('removing the encounter restores the existing Race fallback without removing Iowa', () => {
    const without = {
      ...registry,
      events: Object.fromEntries(Object.entries(registry.events).filter(([id]) => id !== EVENT)),
    };
    expect(quickPlayEvents(without, REGION).some((e) => e.kind === 'grudge')).toBe(false);
    expect(quickPlayEvent(without, REGION, 'grudge')).toMatchObject({ kind: 'race', eventId: RACE });
    expect(regionChoices(without).some((r) => r.id === REGION)).toBe(true);
  });

  it('detects a wrong authored road and refuses a field without its named opposition', () => {
    const event = registry.events[EVENT];
    expect(event).toBeDefined();
    if (!event) return;
    const wrongRoad = {
      ...registry,
      events: {
        ...registry.events,
        [EVENT]: { ...event, lengths: [{ id: 'standard', route: HIGHWAY, laps: 1 }] },
      },
    };
    expect(() => assertEncounter(wrongRoad)).toThrow('the named encounter must use Eagle Point');
    const missingRival = {
      ...registry,
      events: { ...registry.events, [EVENT]: { ...event, field: { ...event.field, riders: [] } } },
    };
    expect(quickPlayEvents(missingRival, REGION).some((e) => e.eventId === EVENT)).toBe(false);
    expect(quickPlayEvent(missingRival, REGION, 'grudge')?.eventId).toBe(RACE);
    const wrongRival = {
      ...registry,
      events: {
        ...registry.events,
        [EVENT]: { ...event, rules: { ...event.rules, rival: 'base:kevin-from-accounting' } },
      },
    };
    expect(quickPlayEvents(wrongRival, REGION).some((e) => e.eventId === EVENT)).toBe(false);
    const missingDefinition = {
      ...registry,
      riders: Object.fromEntries(Object.entries(registry.riders).filter(([id]) => id !== MARA)),
    };
    expect(() => encounter(missingDefinition)).toThrow();
  });
});
