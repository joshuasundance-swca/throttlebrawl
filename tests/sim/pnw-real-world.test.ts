/// <reference types="vite/client" />
// Playtest 3's real-world content in the Pacific Northwest (T10.5; the critic's W1, C4 and G5): the
// chapter opens in downtown Portland ("Bridge City", dusk, rain), a drift race on the Crown Point
// loops joins the third tier, and Bridge City's sidewalks and streets carry downtown's own people and
// traffic instead of the forest's. The rules are checked on the packs' files; the drift events'
// targets against the drift bot are tests/sim/drift-events.test.ts, and "every route of a region has
// an event" is career-content.test.ts.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, racePalette, streamForRoute } from '../../src/app';
import { careerDefs, eventPlan, type CareerDef } from '../../src/career';
import { REG } from './career-harness';

const REGION = 'region-pnw:pacific-northwest';
const BRIDGE_CITY = 'region-pnw:osm-bridge-city-run';
/** The road tags downtown's traffic areas are keyed by: the blocks, and the decks of the bridges. */
const DOWNTOWN = ['pdx-blocks', 'pdx-deck'] as const;

/** What a road file holds that these checks read: scenery tags over s ranges, and its features. */
interface RoadFile {
  lengthM: number;
  tags: { s0: number; s1: number; tag: string }[];
  features: { kind: string; id: string; item?: string; params?: Record<string, unknown> }[];
}
const roadFile = (id: string): RoadFile => {
  const road = REG.roads[`region-pnw:${id}`];
  if (!road) throw new Error(`no road ${id}`);
  return road as unknown as RoadFile;
};

const def: CareerDef | undefined = careerDefs(REG).find((d) => d.regionId === 'pacific-northwest');
if (!def) throw new Error('no Pacific Northwest career');
const career = def;

/** The route an event's first length rides, qualified. */
const routeOf = (event: string): string => {
  const route = eventPlan(REG, event).lengths[0]?.route ?? '';
  return route.includes(':') ? route : `region-pnw:${route}`;
};
const bridgeCityNode = career.nodes.find((n) => routeOf(n.event) === BRIDGE_CITY);

describe('the chapter opens in the city', () => {
  it('a first-tier career event rides Bridge City at dusk, in the rain', () => {
    expect(bridgeCityNode, 'a node on the Bridge City route').toBeDefined();
    expect(bridgeCityNode?.tier, 'the first tier').toBe(0);
    const event = REG.events[bridgeCityNode?.event ?? ''];
    expect(event?.timeOfDay).toBe('dusk');
    // The region offers that time of day, and the rain (a palette key) is on in it.
    const options = (REG.regions[REGION]?.timeOfDayOptions ?? []).map((o) => o.id);
    expect(options).toContain('dusk');
    expect(racePalette(REG, REGION, 'dusk')['rain'], 'rain at dusk').toMatch(/^#/);
  });

  it("its bonus is the route's own junction choice, and its pin stands on the route", () => {
    const plan = eventPlan(REG, bridgeCityNode?.event ?? '');
    const route = REG.routes[BRIDGE_CITY];
    if (!route) throw new Error('no Bridge City route');
    const branches = streamForRoute(REG, BRIDGE_CITY)
      .routeFor(route)
      .branches.map((b) => b.id);
    const bonus = plan.objectives.filter((o) => o.kind === 'ride-branch');
    expect(bonus.length).toBeGreaterThan(0);
    for (const o of bonus) {
      expect(branches, o.id).toContain(o.params['branch']);
      expect(o.required, o.id).toBe(false);
    }
    expect(route.allowedRoads, 'the pin road is on the route').toContain(bridgeCityNode?.road);
  });

  it('the Samish road stays on the map: its races are still there and its roads are claimed or opened', () => {
    const samish = career.nodes.filter((n) => routeOf(n.event) === 'region-pnw:osm-i5-samish-run');
    expect(samish.length).toBeGreaterThanOrEqual(2);
    const reached = new Set(career.nodes.flatMap((n) => [n.road, ...n.opens, ...n.claims]));
    for (const road of ['osm-i5-nulle-run', 'osm-i5-samish-summit', 'osm-i5-lake-samish'])
      expect(reached.has(road), road).toBe(true);
  });
});

describe('a drift race on the Crown Point loops', () => {
  it('is a third-tier race on the Gorge route with a required drift-only style-cash objective', () => {
    const node = career.nodes.find((n) => routeOf(n.event) === 'region-pnw:osm-gorge-run' && n.tier === 2);
    const drift = career.nodes.filter((n) =>
      eventPlan(REG, n.event).objectives.some(
        (o) =>
          o.kind === 'style-cash' &&
          o.required &&
          Array.isArray(o.params['kinds']) &&
          o.params['kinds'].join() === 'drift',
      ),
    );
    expect(drift.map((n) => n.tier)).toEqual([2]);
    expect(drift[0]?.id).toBe('crown-point');
    expect(node, 'a third-tier node on the Gorge route').toBeDefined();
    // It is a race to the line, so its purse is the tier's: nothing else is required for cash.
    const plan = eventPlan(REG, drift[0]?.event ?? '');
    expect(plan.kind).toBe('classic-race');
    expect(plan.objectives.some((o) => o.kind === 'finish-place' && o.required)).toBe(true);
  });
});

describe("Bridge City's local life", () => {
  const config = buildSimConfig(REG, streamForRoute(REG, BRIDGE_CITY), {
    seed: 1,
    eventId: bridgeCityNode?.event ?? '',
  });
  const type = (id: string) => config.trafficTypes.find((t) => t.contentId === `region-pnw:${id}`);

  it("the streetcar is in no region's mix and spawns only in downtown's traffic areas", () => {
    const streetcar = type('pdx-streetcar');
    expect(streetcar?.category).toBe('truck');
    expect(streetcar?.weight ?? 0, 'outside the areas').toBe(0);
    for (const area of DOWNTOWN) expect(streetcar?.areaWeights?.[area] ?? 0, area).toBeGreaterThan(0);
  });

  it("downtown's tags cover every metre of the main path, so no stretch of it takes the forest's mix", () => {
    // A bridge deck carries only the bake's `bridge` tag besides its own `deckTags`; without a
    // downtown tag over it, a log truck would spawn on the Hawthorne Bridge.
    const route = REG.routes[BRIDGE_CITY];
    expect(route?.mainPath.length).toBeGreaterThan(0);
    for (const id of route?.mainPath ?? []) {
      const road = roadFile(id);
      const tags = road.tags.filter((t) => (DOWNTOWN as readonly string[]).includes(t.tag));
      for (let s = 0; s <= road.lengthM; s += 5)
        expect(
          tags.some((t) => t.s0 <= s && s <= t.s1),
          `${id} at s ${s}`,
        ).toBe(true);
    }
  });

  it("downtown's mix leaves the forest out: no log truck, no camper, no mud, and a cargo bike at 0.5", () => {
    for (const area of DOWNTOWN) {
      for (const forest of ['log-truck', 'camper-van', 'motorhome', 'muddy-pickup', 'espresso-stand-in-tow'])
        expect(type(forest)?.areaWeights?.[area] ?? 0, `${forest} in ${area}`).toBe(0);
      expect(type('cargo-bike')?.areaWeights?.[area], area).toBe(0.5);
    }
    expect(type('cargo-bike')?.weight ?? 0).toBe(0);
  });

  it("every sidewalk zone on Bridge City's roads names its people, and they are all people", () => {
    const route = REG.routes[BRIDGE_CITY];
    const zones = (route?.allowedRoads ?? []).flatMap((id) =>
      roadFile(id).features.filter((f) => f.kind === 'roadsideZone'),
    );
    console.log(`[print] Bridge City roadside zones examined: ${zones.map((z) => z.id).join(', ')}`);
    expect(zones.length).toBeGreaterThanOrEqual(5);
    for (const z of zones) {
      const kinds = (z.params?.['kinds'] ?? []) as string[];
      expect(kinds.length > 0, `${z.id} names its kinds`).toBe(true);
      for (const k of kinds) {
        const t = REG.trafficTypes[k.includes(':') ? k : `region-pnw:${k}`];
        expect(t, `${z.id}: ${k} exists`).toBeDefined();
        expect(t?.category, `${z.id}: ${k} is a person`).toBe('pedestrian');
      }
    }
    // The pod's diners stand in the pod and nowhere else.
    const diner = zones.filter((z) => JSON.stringify(z.params?.['kinds']).includes('pod-diner'));
    expect(diner.map((z) => z.id)).toEqual(['cart-pod']);
  });

  it('every sign the new dressing places is a site sign of the region, kept out of the forest pool', () => {
    const route = REG.routes[BRIDGE_CITY];
    const region = REG.regions[REGION];
    const items = (route?.allowedRoads ?? [])
      .flatMap((id) => roadFile(id).features)
      .filter((f) => f.kind === 'billboard')
      .map((f) => String(f.item));
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      const sign = (region?.signs ?? []).find((s) => s.id === item);
      expect(sign, `${item} is a region sign`).toBeDefined();
      expect(sign?.tags, `${item} is a site sign`).toContain('site');
    }
  });
});
