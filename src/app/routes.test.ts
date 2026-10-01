import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import type { ReplayHeader } from '../replay';
import { buildSimConfig, raceRouteKey, realRoutes, streamForEvent } from './config';
import { createHeadlessRace } from './headless';
import { createStreamCache, routeChoices, routeKeyOf } from './regions';
import { roadsForHeader } from './resume';

// Real roads as routes (the maintainer, 2026-10-01: "Yes, add as routes"): after the region, the
// player picks a route. The region's hand-made road stays the default; each real road its region
// carries (a network baked from map data by tools/gis) is offered by its name. The base pack has one
// already: the Overseas Highway stretch at Bahia Honda (gis-1), so these checks run on the Keys.

// The whole base pack: the bundled one leaves the real roads out until fetched (run W-P).
const BASE = registryFromGlob(import.meta.glob('/packs/base/**/*.json', { eager: true, import: 'default' }));
const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const KEYS = 'base:m1-skeleton-sprint';
const BAHIA = 'base:osm-bahia-honda-run';

/** The config as plain data (the road and route are handles, compared by their ids instead). */
const plain = ({ road: _r, route: _q, ...rest }: ReturnType<typeof buildSimConfig>) =>
  JSON.parse(JSON.stringify(rest)) as { event: { routeId?: string } } & Record<string, unknown>;

describe('app: real-road routes', () => {
  it("lists the region's real roads only: not the event's own lengths, hand-made spares or other regions", () => {
    expect(realRoutes(BASE, KEYS)).toEqual([BAHIA]);
    // The Keys' hand-made spare routes (m1-standard-run, m1-long-haul) are not real roads.
    expect(Object.keys(BASE.routes)).toEqual(expect.arrayContaining(['base:m1-long-haul']));
    // With every pack carried, the Keys still list only their own; a region's list never holds
    // another region's routes.
    expect(realRoutes(ALL, KEYS)).toEqual([BAHIA]);
    for (const event of ['region-pnw:pnw-fogline-run', 'region-sf:sf-hill-sprint'])
      expect(realRoutes(ALL, event)).not.toContain(BAHIA);
  });

  it('offers the hand-made road first (the default), then each real road by name, with its length', () => {
    const choices = routeChoices(BASE, KEYS);
    expect(choices.map((c) => [c.id, c.name])).toEqual([
      [null, 'Causeway Sprint'],
      [BAHIA, 'Bahia Honda Run'],
    ]);
    const real = choices[1];
    const raced = buildSimConfig(BASE, streamForEvent(BASE, KEYS, undefined, BAHIA), {
      seed: 1,
      eventId: KEYS,
      route: BAHIA,
    });
    expect(real?.lengthM ?? 0).toBeCloseTo(raced.route.length, 0);
    expect(real?.blurb).toMatch(/^Real road: Overseas Highway\. \d+\.\d km\.$/);
    expect(choices[0]?.lengthM).toBeNull();
  });

  it('a chosen real route is raced and recorded; the field, law and traffic stay the region race', () => {
    const own = buildSimConfig(BASE, streamForEvent(BASE, KEYS), { seed: 5, eventId: KEYS });
    const real = buildSimConfig(BASE, streamForEvent(BASE, KEYS, undefined, BAHIA), {
      seed: 5,
      eventId: KEYS,
      route: BAHIA,
    });
    expect(own.event.routeId).toBe('base:m1-skeleton-sprint');
    expect(real.event.routeId).toBe(BAHIA);
    expect(real.route.length).toBeGreaterThan(5000);
    expect(real.seed).toBe(5);
    // Everything but the road and the route id is the same race.
    const { event: ownEvent, ...ownRest } = plain(own);
    const { event: realEvent, ...realRest } = plain(real);
    expect(realRest).toEqual(ownRest);
    expect({ ...realEvent, routeId: 'x' }).toEqual({ ...ownEvent, routeId: 'x' });
  });

  it('anything else falls back to the length route: a hand-made spare, another region, unknown, blank', () => {
    const pnw = 'region-pnw:pnw-espresso-run';
    for (const route of ['base:m1-long-haul', 'm1-long-haul', pnw, 'nope', '', null, undefined]) {
      expect(raceRouteKey(ALL, KEYS, undefined, route), String(route)).toBe('base:m1-skeleton-sprint');
      expect(routeKeyOf(ALL, KEYS, undefined, route)).toBe('base:m1-skeleton-sprint');
      const c = buildSimConfig(ALL, streamForEvent(ALL, KEYS), {
        seed: 1,
        eventId: KEYS,
        ...(route === undefined || route === null ? {} : { route }),
      });
      expect(c.event.routeId).toBe('base:m1-skeleton-sprint');
    }
    // A bare id in the event's own pack names the same route as its qualified id.
    expect(raceRouteKey(BASE, KEYS, undefined, 'osm-bahia-honda-run')).toBe(BAHIA);
  });

  it('a headless race (the bot batch, the self-test) runs a chosen real road on its own stream', () => {
    const race = createHeadlessRace({ seed: 3, eventId: KEYS, route: BAHIA }, { registry: BASE });
    expect(race.config.event.routeId).toBe(BAHIA);
    expect(race.config.route.length).toBeGreaterThan(5000);
    expect(createHeadlessRace({ seed: 3, eventId: KEYS }).config.event.routeId).toBe(KEYS);
  });

  it("a replay or a resume rebuilds the chosen real road from the header's route id", () => {
    const streams = createStreamCache();
    const config = buildSimConfig(BASE, streams.forEvent(BASE, KEYS, undefined, BAHIA), {
      seed: 9,
      eventId: KEYS,
      route: BAHIA,
    });
    const header = { eventId: KEYS, seed: 9, config: plain(config) } as unknown as ReplayHeader;
    const { route } = roadsForHeader(BASE, streams)(header);
    expect(route.routeId).toBe('osm-bahia-honda-run');
    expect(route.length).toBeCloseTo(config.route.length, 6);
  });
});
