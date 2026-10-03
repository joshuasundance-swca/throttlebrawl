import { describe, expect, it } from 'vitest';
import { stationsForRegion } from '../audio';
import { loadBasePack, registryFromGlob } from '../content';
import { buildSimConfig, copIds, streamForEvent } from './config';
import {
  boardCatalog,
  createStreamCache,
  narrativeSettingOf,
  racePalette,
  raceRadio,
  regionChoices,
  regionKeyOf,
  routeKeyOf,
} from './regions';

// Regions as the menu offers them (playtest 1c item 6, 2026-09-30: "Pnw and sf first then
// others"), built from every carried pack, the way the game loads them once their road data is in
// (docs/content-packs.md, "Region packs at runtime").

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const streams = createStreamCache();
const config = (eventId: string, seed = 3) =>
  buildSimConfig(ALL, streams.forEvent(ALL, eventId), { seed, eventId });
/** The config as plain data (the road and route are handles, compared by the ids instead). */
const plain = ({ road: _r, route: _q, ...rest }: ReturnType<typeof config>) =>
  JSON.parse(JSON.stringify(rest)) as unknown;

describe('app: regions', () => {
  it("hands the barks the race's event kind, bare region id and time of day", () => {
    // Bark lines name the region bare (`"value": "pacific-northwest"`) and the time of day by its
    // option id, so `when` conditions on region.id and timeOfDay can match (content-packs.md).
    expect(narrativeSettingOf(ALL, 'region-pnw:pnw-fogline-run')).toEqual({
      eventKind: 'classic-race',
      regionId: 'pacific-northwest',
      timeOfDay: 'dawn',
    });
    expect(narrativeSettingOf(ALL, 'region-sf:sf-hill-sprint').regionId).toBe('san-francisco');
    expect(narrativeSettingOf(ALL, 'base:m1-skeleton-sprint').regionId).toBe('florida-keys');
  });

  it('offers the Keys, the Pacific Northwest and San Francisco, by chapter, each with its event', () => {
    const choices = regionChoices(ALL);
    expect(choices.map((c) => [c.id, c.eventId, c.packId])).toEqual([
      ['base:florida-keys', 'base:m1-skeleton-sprint', 'base'],
      ['region-pnw:pacific-northwest', 'region-pnw:pnw-fogline-run', 'region-pnw'],
      ['region-sf:san-francisco', 'region-sf:sf-hill-sprint', 'region-sf'],
    ]);
    expect(choices.map((c) => c.name)).toEqual(['The Keys', 'The Pacific Northwest', 'San Francisco']);
    expect(choices.every((c) => (c.blurb ?? '').length > 0)).toBe(true);
    // The base pack alone offers just the Keys.
    expect(regionChoices(loadBasePack()).map((c) => c.id)).toEqual(['base:florida-keys']);
  });

  it('carrying the region packs never changes the Keys race', () => {
    const base = loadBasePack();
    const alone = buildSimConfig(base, streamForEvent(base), { seed: 3 });
    expect(plain(config('m1-skeleton-sprint'))).toEqual(plain(alone));
    expect(config('m1-skeleton-sprint').route.length).toBe(alone.route.length);
  });

  it('a Pacific Northwest race: its route, locals, local deputy and traffic mix', () => {
    const c = config('region-pnw:pnw-fogline-run');
    expect(c.event.contentId).toBe('region-pnw:pnw-fogline-run');
    expect(c.event.routeId).toBe('region-pnw:pnw-espresso-run');
    const ids = c.riders.map((r) => r.contentId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'base:deacon-vane',
        'base:chad-speedwell',
        'region-pnw:old-growth',
        'region-pnw:juniper-moss',
        'base:player',
        'region-pnw:deputy-lindqvist',
      ]),
    );
    expect(ids).not.toContain('base:sgt-pruitt');
    const cop = c.riders.find((r) => r.controller.kind === 'cop');
    expect(cop?.law?.agency).toBe('region-pnw:fir-county-sheriff');
    // A local's bike resolves from its own pack's references (base bikes, qualified).
    expect(c.riders.every((r) => r.bike.contentId.includes(':'))).toBe(true);
    const types = new Map(c.trafficTypes.map((t) => [t.contentId, t.weight ?? -1]));
    expect(types.get('region-pnw:log-truck')).toBeGreaterThan(0);
    expect(types.get('base:pickup')).toBeGreaterThan(0);
    expect(types.get('base:box-truck')).toBe(0);
    expect(
      [...types.keys()].some((k) => k.startsWith('region-sf:')),
      'no other region',
    ).toBe(false);
    // Playtest 2: the lot's starter, up to two on patrol and one more in the lot, from the region's pool.
    expect(new Set(copIds(ALL, 'region-pnw:pnw-fogline-run'))).toEqual(
      new Set(['region-pnw:deputy-lindqvist']),
    );
    expect(copIds(ALL, 'region-pnw:pnw-fogline-run')).toHaveLength(4);
  });

  it('a San Francisco race: its route, locals, Officer Meter, and no cable cars in its traffic', () => {
    const c = config('region-sf:sf-hill-sprint');
    expect(c.event.routeId).toBe('region-sf:sf-standard-run');
    const ids = c.riders.map((r) => r.contentId);
    expect(ids).toEqual(
      expect.arrayContaining(['region-sf:pivot', 'region-sf:gripman-gus', 'region-sf:officer-meter']),
    );
    const types = new Map(c.trafficTypes.map((t) => [t.contentId, t.weight ?? -1]));
    // Playtest 2 ("including in forests"), run W-R: cable cars run only on downtown's cable-car
    // streets, drawn by render, never as traffic on a race road.
    expect(types.get('region-sf:cable-car') ?? 0).toBe(0);
    expect(types.get('region-sf:startup-shuttle')).toBeGreaterThan(0);
    expect([...types.keys()].some((k) => k.startsWith('region-pnw:'))).toBe(false);
    expect(routeKeyOf(ALL, 'region-sf:sf-hill-sprint')).toBe('region-sf:sf-standard-run');
    expect(regionKeyOf(ALL, 'region-sf:sf-hill-sprint')).toBe('region-sf:san-francisco');
  });

  it("builds each region's board catalog with veto references, minus this device's cuts", () => {
    const pnw = boardCatalog(ALL, 'region-pnw:pacific-northwest');
    // Content lanes add boards freely, so the counts come from the pools, not a fixed number.
    const signs = pnw.pools?.signs ?? [];
    const billboards = pnw.pools?.billboards ?? [];
    expect(signs.length).toBeGreaterThanOrEqual(5);
    expect(billboards.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(pnw.items)).toHaveLength(signs.length + billboards.length);
    expect(pnw.items['bigfoot-crossing']).toMatchObject({
      ref: 'region-pnw:region/pacific-northwest#bigfoot-crossing',
      kind: 'sign',
    });
    expect(signs.every((s) => s.kind === 'sign')).toBe(true);
    expect(billboards.every((b) => b.kind === 'billboard')).toBe(true);
    const cut = boardCatalog(
      ALL,
      'region-pnw:pacific-northwest',
      new Set(['region-pnw:region/pacific-northwest#view-lots']),
    );
    expect(cut.items['view-lots']).toBeUndefined();
    expect(Object.keys(boardCatalog(ALL, 'base:florida-keys').items)).toEqual(
      expect.arrayContaining(['ices-before-road', 'timeshare']),
    );
  });

  it("merges the region palette with its time of day's", () => {
    const p = racePalette(ALL, 'region-pnw:pacific-northwest', 'dawn');
    expect(p['road']).toBe('#3b3f3e');
    expect(p['sky']).toBe('#c4ccc6');
    expect(racePalette(ALL, 'region-pnw:pacific-northwest', 'noon')['sky']).toBe('#aab5b1');
    expect(racePalette(ALL, 'base:florida-keys', 'golden-hour')['sky']).toBe('#f6b26b');
  });

  it('caches one stream per network', () => {
    const a = streams.forEvent(ALL, 'region-sf:sf-hill-sprint');
    expect(streams.forRoute(ALL, 'region-sf:sf-standard-run')).toBe(a);
    expect(streams.forEvent(ALL, 'm1-skeleton-sprint')).not.toBe(a);
  });
});

describe('app: the race radio per region (radio-1 head start, the integration round)', () => {
  /** What the dial offers in a race: audio's own region filter over what the app hands it. */
  const dial = (r: ReturnType<typeof raceRadio>) =>
    stationsForRegion(r.stations, r.region).map((s) => `${s.packId}:${s.id}`);

  it("the Keys play the Keys' own stations, filtered by the region", () => {
    const r = raceRadio(ALL, 'base:florida-keys');
    expect(r.region).toBe('base:florida-keys');
    expect(dial(r)).toEqual(['base:keys-rockabilly', 'base:keys-surf', 'base:keys-tradewinds']);
  });

  it('the Pacific Northwest and San Francisco play their own three stations, and only those', () => {
    // Playtest 2, 2026-10-02: "There should be different stations and music in different regions".
    expect(dial(raceRadio(ALL, 'region-pnw:pacific-northwest'))).toEqual([
      'region-pnw:pnw-drizzle',
      'region-pnw:pnw-salal',
      'region-pnw:pnw-stump',
    ]);
    expect(dial(raceRadio(ALL, 'region-sf:san-francisco'))).toEqual([
      'region-sf:sf-burn-rate',
      'region-sf:sf-fog-bank',
      'region-sf:sf-gold-rush',
    ]);
  });

  it('a region with no station of its own gets the base pack stations, unfiltered', () => {
    const baseOnly = {
      ...ALL,
      stations: Object.fromEntries(Object.entries(ALL.stations).filter(([k]) => k.startsWith('base:'))),
    } as typeof ALL;
    for (const region of ['region-pnw:pacific-northwest', 'region-sf:san-francisco']) {
      const r = raceRadio(baseOnly, region);
      expect(r.region, region).toBeNull();
      expect(dial(r), region).toEqual(['base:keys-rockabilly', 'base:keys-surf', 'base:keys-tradewinds']);
    }
  });

  it("a region's own station takes over once a pack carries one", () => {
    const keysSurf = ALL.stations['base:keys-surf'];
    const withPnw = {
      ...ALL,
      stations: {
        ...ALL.stations,
        'region-pnw:fog-fm': { ...keysSurf, id: 'fog-fm', regions: ['pacific-northwest'] },
      },
    } as typeof ALL;
    const r = raceRadio(withPnw, 'region-pnw:pacific-northwest');
    expect(r.region).toBe('region-pnw:pacific-northwest');
    expect(r.stations.map((s) => s.id)).toContain('fog-fm');
  });
});
