import { describe, expect, it } from 'vitest';
import { stationsForRegion } from '../audio';
import { signStyleOf } from '../render';
import { loadBasePack, registryFromGlob } from '../content';
import { buildSimConfig, copIds, streamForEvent } from './config';
import {
  boardCatalog,
  createStreamCache,
  narrativeSettingOf,
  racePalette,
  raceRadio,
  raceSky,
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

  it('offers every region the packs ship, by chapter, each with its own free-play event', () => {
    // Read from the packs (the Keys, the Pacific Northwest and San Francisco today), so a new region
    // pack is offered without editing this test.
    const choices = regionChoices(ALL);
    expect(choices.map((c) => c.id).sort()).toEqual(Object.keys(ALL.regions).sort());
    expect(choices.length).toBeGreaterThanOrEqual(3);
    const chapters = choices.map((c) => c.chapter);
    expect(chapters).toEqual([...chapters].sort((a, b) => a - b));
    for (const c of choices) {
      const region = ALL.regions[c.id] as { name?: string; blurb?: string; id: string } | undefined;
      const event = ALL.events[c.eventId];
      // The choice's event is a free-play race (no career tier) of this region, from the region's pack.
      expect(c.packId, c.id).toBe(c.id.slice(0, c.id.indexOf(':')));
      expect(c.eventId.startsWith(`${c.packId}:`), c.id).toBe(true);
      expect(event?.region, c.id).toBe(region?.id);
      expect(event?.tier, c.id).toBeUndefined();
      // Its name and blurb are the region file's own words.
      expect(c.name, c.id).toBe(region?.name);
      expect((c.blurb ?? '').length, c.id).toBeGreaterThan(0);
      expect(c.blurb, c.id).toBe(region?.blurb);
    }
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
    // Every pooled board is also a named item; the items no pool carries are the `site` signs (a
    // junction's own, like Bridge City's MORRISON BRIDGE: KEEP LEFT, below), and they are signs.
    const pooled = new Set([...signs, ...billboards].map((b) => b.ref));
    const items = Object.values(pnw.items);
    expect(items.filter((i) => pooled.has(i.ref))).toHaveLength(pooled.size);
    expect(items.filter((i) => !pooled.has(i.ref)).every((i) => i.kind === 'sign')).toBe(true);
    expect(pnw.items['morrison-keep-left']).toMatchObject({ kind: 'sign' });
    expect(signs.some((s) => s.ref.endsWith('#morrison-keep-left'))).toBe(false);
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
    // Run W-U: a `site` sign shows only in the slot that names it, never in a pooled slot elsewhere.
    const keys = boardCatalog(ALL, 'base:florida-keys');
    for (const id of ['boardwalk-keep-left', 'nothing-out-there', 'unlisted-key', 'ramp-keep-right']) {
      expect(keys.items[id], id).toBeDefined();
      expect(
        keys.pools?.signs?.some((s) => s.ref.endsWith(`#${id}`)),
        id,
      ).toBe(false);
    }
    expect(keys.pools?.signs?.some((s) => s.ref.endsWith('#ices-before-road'))).toBe(true);
  });

  describe('sign faces by region and slot (playtest 4, P4-19: regional sign faces)', () => {
    const KEYS = 'base:florida-keys';
    const PNW = 'region-pnw:pacific-northwest';
    const SF = 'region-sf:san-francisco';
    const styleOf = (v: unknown) => (v as { signStyle?: unknown }).signStyle;
    type Slot = { kind: string; id?: string; item?: string; pool?: string; params?: { style?: unknown } };
    const slotsOf = (roadKey: string): Slot[] =>
      ((ALL.roads[roadKey] as { features?: Slot[] } | undefined)?.features ?? []).filter(
        (f) => f.kind === 'billboard',
      );

    it("hands a region's sign style to its catalog, and only that", () => {
      for (const key of Object.keys(ALL.regions))
        expect(boardCatalog(ALL, key).style, key).toBe(styleOf(ALL.regions[key]));
    });

    it('gives each shipped region a style render knows, and each region its own look', () => {
      const styles = [KEYS, PNW, SF].map((k) => boardCatalog(ALL, k).style);
      for (const s of styles) expect(signStyleOf(s), JSON.stringify(s)).not.toBeNull();
      expect(new Set(styles).size).toBe(3);
      expect(styles).not.toContain('default');
    });

    it('names only styles render knows, in every region and every road slot', () => {
      for (const [key, region] of Object.entries(ALL.regions)) {
        const s = styleOf(region);
        if (s !== undefined) expect(signStyleOf(s), `${key} signStyle ${JSON.stringify(s)}`).not.toBeNull();
      }
      for (const [key, road] of Object.entries(ALL.roads))
        for (const f of (road as { features?: Slot[] }).features ?? []) {
          const s = f.params?.style;
          if (f.kind === 'billboard' && s !== undefined)
            expect(signStyleOf(s), `${key} ${f.id} style ${JSON.stringify(s)}`).not.toBeNull();
        }
    });

    it("overrides the Gorge's and the interstate's sign slots with their own faces", () => {
      const pnw = boardCatalog(ALL, PNW);
      const signSlots = (prefix: string) =>
        Object.keys(ALL.roads)
          .filter((k) => k.startsWith(`region-pnw:${prefix}`))
          .flatMap((k) => slotsOf(k))
          .filter((f) => f.pool === 'signs' || (f.item !== undefined && pnw.items[f.item]?.kind === 'sign'));
      const gorge = signSlots('osm-gorge-');
      const i5 = signSlots('osm-i5-');
      // The loops prove they examined something: each place has signs to dress.
      expect(gorge.length).toBeGreaterThan(0);
      expect(i5.length).toBeGreaterThan(0);
      for (const f of gorge) expect(f.params?.style, f.id).toBe('historic');
      for (const f of i5) expect(f.params?.style, f.id).toBe('guide');
    });
  });

  it("hands render the words for a model's blank board as vetoable items that no pool carries (playtest 3, T12.6)", () => {
    // The Portland roof sign's "STILL RAINING" and the food carts' names are text surfaces: render finds each
    // by its node's name in kebab case, the way a road slot finds a sign by its id, and a cut leaves it blank.
    const pnw = boardCatalog(ALL, 'region-pnw:pacific-northwest');
    const ids = [
      'pdx-roof-sign-words',
      'pdx-food-cart-a-name',
      'pdx-food-cart-b-name',
      'pdx-food-cart-c-name',
    ];
    const pooled = new Set([...(pnw.pools?.signs ?? []), ...(pnw.pools?.billboards ?? [])].map((i) => i.ref));
    for (const id of ids) {
      expect(pnw.items[id], id).toMatchObject({
        kind: 'sign',
        ref: `region-pnw:region/pacific-northwest#${id}`,
      });
      expect(
        pooled.has(pnw.items[id]?.ref ?? ''),
        `${id} is in no pool: a billboard slot elsewhere cannot show it`,
      ).toBe(false);
    }
    expect(pnw.items['pdx-roof-sign-words']?.text).toBe('STILL RAINING');
    const cutRef = pnw.items['pdx-roof-sign-words']?.ref ?? '';
    const cut = boardCatalog(ALL, 'region-pnw:pacific-northwest', new Set([cutRef]));
    expect(cut.items['pdx-roof-sign-words']).toBeUndefined();
    expect(cut.items['pdx-food-cart-a-name']).toBeDefined();
  });

  it("hands render the toll gantry's board words as a vetoable item that no pool carries (playtest 4, P1)", () => {
    // The Golden Gate toll gantry's `toll_gantry_sign` panel is a text surface: render finds its words by the
    // node's name in kebab case, the way the roof sign's are found, and a cut leaves the board blank.
    const sf = boardCatalog(ALL, 'region-sf:san-francisco');
    const pooled = new Set([...(sf.pools?.signs ?? []), ...(sf.pools?.billboards ?? [])].map((i) => i.ref));
    expect(sf.items['toll-gantry-sign']).toMatchObject({
      kind: 'sign',
      ref: 'region-sf:region/san-francisco#toll-gantry-sign',
    });
    expect(
      pooled.has(sf.items['toll-gantry-sign']?.ref ?? ''),
      'in no pool: a slot elsewhere cannot show it',
    ).toBe(false);
    const cutRef = sf.items['toll-gantry-sign']?.ref ?? '';
    const cut = boardCatalog(ALL, 'region-sf:san-francisco', new Set([cutRef]));
    expect(cut.items['toll-gantry-sign']).toBeUndefined();
    expect(cut.items['toll-view'], 'the other signs stay').toBeDefined();
  });

  it("hands render each region's landing one-liners as their own pool, never as a road slot's item", () => {
    // Air that pays (the pitch deck's #13): 'TEN OUT OF TEN, SAYS A PELICAN' on a clean landing.
    for (const key of ['base:florida-keys', 'region-pnw:pacific-northwest', 'region-sf:san-francisco']) {
      const cat = boardCatalog(ALL, key);
      const lines = cat.pools?.landing ?? [];
      expect(lines.length, key).toBeGreaterThanOrEqual(5);
      for (const l of lines) {
        expect(l.text.length).toBeLessThanOrEqual(40);
        expect(l.ref.startsWith(`${key.split(':')[0]}:region/`)).toBe(true);
        expect(Object.values(cat.items).some((i) => i.ref === l.ref)).toBe(false);
      }
    }
    // A cut line leaves the pool (the in-game veto). The line is read from the pack, so a copy edit
    // there is not a test failure.
    const keys = boardCatalog(ALL, 'base:florida-keys');
    const line = keys.pools?.landing?.[0];
    expect(line?.ref.startsWith('base:region/florida-keys#')).toBe(true);
    const cut = boardCatalog(ALL, 'base:florida-keys', new Set([line?.ref ?? '']));
    expect(cut.pools?.landing?.some((l) => l.ref === line?.ref)).toBe(false);
    expect(cut.pools?.landing).toHaveLength((keys.pools?.landing?.length ?? 0) - 1);
  });

  it("merges the region palette with its time of day's", () => {
    // The time of day's own colours win and the region's fill in the rest, read from the packs for
    // every region and time of day (a retuned colour is not a test edit).
    let won = 0;
    let filled = 0;
    for (const [key, region] of Object.entries(ALL.regions)) {
      const own = (region.palette ?? {}) as Readonly<Record<string, string>>;
      for (const option of region.timeOfDayOptions) {
        const over = ((option as { palette?: unknown }).palette ?? {}) as Readonly<Record<string, string>>;
        const p = racePalette(ALL, key, option.id);
        expect(Object.keys(p).sort(), `${key} ${option.id}`).toEqual(
          [...new Set([...Object.keys(own), ...Object.keys(over)])].sort(),
        );
        for (const [name, colour] of Object.entries(p)) {
          if (name in over) {
            expect(colour, `${key} ${option.id} ${name}`).toBe(over[name]);
            if (name in own && own[name] !== over[name]) won++;
          } else {
            expect(colour, `${key} ${option.id} ${name}`).toBe(own[name]);
            filled++;
          }
        }
      }
    }
    // Both halves of the rule were examined: a time of day overrode a region colour, and a region
    // colour showed through.
    expect(won).toBeGreaterThan(0);
    expect(filled).toBeGreaterThan(0);
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

  /**
   * The dial's stations as the packs list them: every station whose regions name `region` (or, with
   * `region` null, every station), except the hidden pirate and a rider's own (audio's pirate and
   * Pivot FM tests have those). Read from the packs, so a lane that adds a station edits no test here.
   */
  const onDial = (reg: typeof ALL, region: string | null) =>
    Object.entries(reg.stations)
      .filter(([, s]) => !s.pirate && !s.rider)
      .filter(([, s]) => region === null || s.regions.includes(region.slice(region.indexOf(':') + 1)))
      .map(([k]) => k)
      .sort();

  it("the Keys play the Keys' own stations, filtered by the region", () => {
    const r = raceRadio(ALL, 'base:florida-keys');
    expect(r.region).toBe('base:florida-keys');
    expect(onDial(ALL, 'base:florida-keys').length).toBeGreaterThanOrEqual(2);
    expect([...dial(r)].sort()).toEqual(onDial(ALL, 'base:florida-keys'));
  });

  it('the Pacific Northwest and San Francisco play their own stations, and only those', () => {
    // Playtest 2, 2026-10-02: "There should be different stations and music in different regions".
    for (const region of ['region-pnw:pacific-northwest', 'region-sf:san-francisco']) {
      const own = onDial(ALL, region);
      expect(own.length, region).toBeGreaterThanOrEqual(2);
      expect(
        own.every((k) => k.startsWith(`${region.slice(0, region.indexOf(':'))}:`)),
        region,
      ).toBe(true);
      expect([...dial(raceRadio(ALL, region))].sort(), region).toEqual(own);
    }
  });

  it('a region with no station of its own gets the base pack stations, unfiltered', () => {
    const baseOnly = {
      ...ALL,
      stations: Object.fromEntries(Object.entries(ALL.stations).filter(([k]) => k.startsWith('base:'))),
    } as typeof ALL;
    for (const region of ['region-pnw:pacific-northwest', 'region-sf:san-francisco']) {
      const r = raceRadio(baseOnly, region);
      expect(r.region, region).toBeNull();
      expect(onDial(baseOnly, null).length, region).toBeGreaterThan(0);
      expect([...dial(r)].sort(), region).toEqual(onDial(baseOnly, null));
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

// Playtest 4 (the identity sheets, cause 10): rain is a property of the light or of the event, not of
// the whole region, so the Pacific Northwest has dry races too. The menu race's own pick still wins.
describe('app: the weather a race draws', () => {
  const PNW = 'region-pnw:pacific-northwest';
  const EVENT = 'region-pnw:pnw-t1-espresso-hunt';
  /** The registry with one event rebuilt: its light and weather as the case sets them. */
  const withEvent = (over: Record<string, unknown>) =>
    ({ ...ALL, events: { ...ALL.events, [EVENT]: { ...ALL.events[EVENT], ...over } } }) as typeof ALL;
  const lights = (ALL.regions[PNW]?.timeOfDayOptions ?? []).map((o) => o.id);
  /** Lights that rain by themselves, and lights that do not. */
  const rainy = lights.filter((t) => racePalette(ALL, PNW, t)['rain']);
  const dry = lights.filter((t) => !racePalette(ALL, PNW, t)['rain']);
  const wetLight = rainy[0] ?? 'no-rainy-light';
  const dryLight = dry[0] ?? 'no-dry-light';

  it('the region has lights that rain and lights that do not, and the base palette alone does not rain', () => {
    console.log(
      `[examined] PNW lights ${lights.join(', ')}: rain in ${rainy.join(', ')}; dry in ${dry.join(', ')}`,
    );
    expect(rainy.length).toBeGreaterThanOrEqual(1);
    expect(dry.length).toBeGreaterThanOrEqual(1);
    expect(ALL.regions[PNW]?.palette?.['rain']).toBeUndefined();
  });

  it("a light's own rain reaches the race, and a dry light draws none", () => {
    for (const t of rainy) expect(raceSky(ALL, EVENT, t).wet, t).toBe(true);
    for (const t of dry) expect(raceSky(ALL, EVENT, t).wet, t).toBe(false);
  });

  it("an event's weather beats its own light: dry in a rainy one, rain in a dry one", () => {
    const dryEvent = withEvent({ timeOfDay: wetLight, weather: 'dry' });
    expect(raceSky(dryEvent, EVENT, wetLight).wet).toBe(false);
    expect(raceSky(dryEvent, EVENT, wetLight).palette['rain']).toBeUndefined();
    const rainEvent = withEvent({ timeOfDay: dryLight, weather: 'rain' });
    expect(raceSky(rainEvent, EVENT, dryLight).wet).toBe(true);
    // The control: the same events with no weather follow their light.
    expect(raceSky(withEvent({ timeOfDay: wetLight, weather: undefined }), EVENT, wetLight).wet).toBe(true);
    expect(raceSky(withEvent({ timeOfDay: dryLight, weather: undefined }), EVENT, dryLight).wet).toBe(false);
  });

  it("an event's weather is for its own light: raced at another hour, that hour's weather holds", () => {
    expect(raceSky(withEvent({ timeOfDay: wetLight, weather: 'dry' }), EVENT, dryLight).wet).toBe(false);
    expect(raceSky(withEvent({ timeOfDay: dryLight, weather: 'dry' }), EVENT, wetLight).wet).toBe(true);
    expect(raceSky(withEvent({ timeOfDay: wetLight, weather: 'rain' }), EVENT, dryLight).wet).toBe(false);
  });

  it("the menu race's pick beats the event and the light, and never dries the registry's palette", () => {
    expect(raceSky(ALL, EVENT, wetLight, 'dry').wet).toBe(false);
    expect(raceSky(ALL, EVENT, wetLight, 'dry').palette['rain']).toBeUndefined();
    expect(racePalette(ALL, PNW, wetLight)['rain']).toBeDefined();
    const asked = raceSky(ALL, EVENT, dryLight, 'rain');
    expect(asked.wet).toBe(true);
    expect(asked.weather).toBe('rain');
    expect(raceSky(ALL, EVENT, wetLight, 'local').wet).toBe(true);
    expect(raceSky(withEvent({ timeOfDay: wetLight, weather: 'dry' }), EVENT, wetLight, 'rain').wet).toBe(
      true,
    );
  });
});
