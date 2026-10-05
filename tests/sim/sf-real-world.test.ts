/// <reference types="vite/client" />
// Playtest 3's real-world content in San Francisco (T10.6; the critic's W1, C4, C5 and G5): the
// fourth tier's "Series C" is the Golden Gate at dawn, Lombard Street is a race of its own (the T2.6
// probe found a drift cannot hold on its hairpins at the shipped floors), and the third tier holds a
// drift race on the Twin Peaks hairpins. The rules are checked on the packs'
// files; the drift targets against the drift bot are tests/sim/drift-events.test.ts, "every route of
// a region has an event" is career-content.test.ts, and the one-way block's traffic is
// tests/sim/traffic-one-way.test.ts.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, streamForRoute } from '../../src/app';
import { careerDefs, eventPlan, type CareerDef } from '../../src/career';
import { trafficAreaAt } from '../../src/sim/traffic';
import { buildCorridor } from '../../src/sim/traffic/corridor';
import { REG } from './career-harness';

const GOLDEN_GATE = 'region-sf:osm-sf-golden-gate-run';
const LOMBARD = 'region-sf:osm-sf-lombard-run';
const TWIN_PEAKS = 'region-sf:osm-sf-twin-peaks-run';
const REGION = 'region-sf:san-francisco';

const def: CareerDef | undefined = careerDefs(REG).find((d) => d.regionId === 'san-francisco');
if (!def) throw new Error('no San Francisco career');
const career = def;

/** The route an event's first length rides, qualified. */
const routeOf = (event: string): string => {
  const route = eventPlan(REG, event).lengths[0]?.route ?? '';
  return route.includes(':') ? route : `region-sf:${route}`;
};
const nodesOn = (route: string) => career.nodes.filter((n) => routeOf(n.event) === route);
/** Whether a plan asks a required, drift-only style-cash objective. */
const isDrift = (event: string): boolean =>
  eventPlan(REG, event).objectives.some(
    (o) =>
      o.kind === 'style-cash' &&
      o.required &&
      Array.isArray(o.params['kinds']) &&
      o.params['kinds'].join() === 'drift',
  );

describe('the Golden Gate closes the climb', () => {
  const nodes = nodesOn(GOLDEN_GATE);

  it('is one fourth-tier race to the line, at dawn, which the region offers', () => {
    expect(nodes.map((n) => n.tier)).toEqual([3]);
    const plan = eventPlan(REG, nodes[0]?.event ?? '');
    expect(plan.kind).toBe('classic-race');
    expect(plan.objectives.some((o) => o.kind === 'finish-place' && o.required)).toBe(true);
    const event = REG.events[nodes[0]?.event ?? ''];
    expect(event?.timeOfDay).toBe('dawn');
    expect((REG.regions[REGION]?.timeOfDayOptions ?? []).map((o) => o.id)).toContain('dawn');
  });

  it("its map pin stands on the route, and every road of the route is the player's after a win", () => {
    const node = nodes[0];
    const route = REG.routes[GOLDEN_GATE];
    expect(route?.allowedRoads).toContain(node?.road);
    for (const id of route?.allowedRoads ?? []) expect(node?.claims, id).toContain(id);
  });
});

describe('Lombard Street is a race of its own, not a drift race', () => {
  it('one fourth-tier race, to the line, with no drift objective (a drift holds there only at floors an event cannot set)', () => {
    const nodes = nodesOn(LOMBARD);
    expect(nodes.map((n) => n.tier)).toEqual([3]);
    const plan = eventPlan(REG, nodes[0]?.event ?? '');
    expect(plan.kind).toBe('classic-race');
    expect(isDrift(plan.key)).toBe(false);
    // The field is small: a one-lane brick block of hairpins is no place for six.
    expect(plan.field.length).toBeLessThanOrEqual(4);
  });

  it("its map pin stands on the route, and every road of the route is the player's after a win", () => {
    const node = nodesOn(LOMBARD)[0];
    const route = REG.routes[LOMBARD];
    expect(route?.allowedRoads).toContain(node?.road);
    for (const id of route?.allowedRoads ?? []) expect(node?.claims, id).toContain(id);
  });
});

describe('the drift races ride the Twin Peaks hairpins', () => {
  const drift = career.nodes.filter((n) => isDrift(n.event));

  it('hold the third tier, on the Twin Peaks route, and never Lombard', () => {
    expect(drift.map((n) => n.tier)).toEqual([2]);
    for (const n of drift) {
      expect(routeOf(n.event), n.id).toBe(TWIN_PEAKS);
      expect(routeOf(n.event), n.id).not.toBe(LOMBARD);
      expect(eventPlan(REG, n.event).kind, n.id).toBe('classic-race');
    }
  });

  it('are races to the line too: a required finish beside the drift goal, and the usual optional podium', () => {
    for (const n of drift) {
      const plan = eventPlan(REG, n.event);
      expect(
        plan.objectives.some((o) => o.kind === 'finish-place' && o.required),
        n.id,
      ).toBe(true);
      expect(
        plan.objectives.some((o) => o.kind === 'finish-place' && !o.required),
        n.id,
      ).toBe(true);
    }
  });
});

describe("the finale's roads are not stranded by the Series C swap", () => {
  it("the boss's road is opened by a win in the boss's own tier, so the map shows it as reachable", () => {
    const boss = career.nodes.find((n) => n.id === career.boss);
    const opened = new Set(career.nodes.filter((n) => n.tier === boss?.tier).flatMap((n) => n.opens));
    expect(opened.has(boss?.road ?? ''), boss?.road).toBe(true);
  });
});

// Playtest 4 (the identity sheets, cause 8): San Francisco had no traffic areas, so the Golden Gate's
// six lanes took the city's mix, rental scooters and delivery e-bikes included. The deck and the
// headlands roads around it are an area of their own, with the city's cars and no kerb riders.
describe("the Golden Gate's lanes keep the city's kerb riders off", () => {
  const nodes = nodesOn(GOLDEN_GATE);
  const config = buildSimConfig(REG, streamForRoute(REG, GOLDEN_GATE), {
    seed: 1,
    eventId: nodes[0]?.event ?? '',
  });
  /** A kerb rider: it rides the verge (scooters, e-bikes) or is a light one (width 0.8 m or less). */
  const kerbRiders = config.trafficTypes.filter(
    (t) =>
      t.category !== 'pedestrian' &&
      t.category !== 'animal' &&
      (t.behaviour?.kerb === true || t.widthM <= 0.8),
  );
  const corridor = buildCorridor(config);
  const areasOver = () => {
    const used = new Set<string>();
    for (let u = 0; u <= corridor.length; u += 5) used.add(trafficAreaAt(config, corridor, u) ?? '');
    return used;
  };

  it("the city's mix still has its kerb riders (a control: the rule is not a mix with none)", () => {
    // The sim config carries every type of the packs the event loads; the city's are the ones with a weight.
    const city = kerbRiders.filter((t) => (t.weight ?? 0) > 0);
    console.log(`[examined] kerb riders in SF's mix: ${city.map((t) => t.contentId).join(', ')}`);
    expect(city.length).toBeGreaterThanOrEqual(2);
  });

  it('every 5 m of the route is in a traffic area, so no stretch takes the whole city mix', () => {
    expect(corridor.length).toBeGreaterThan(3000);
    expect(areasOver().has(''), 'a stretch with no area').toBe(false);
  });

  it('no area on the route lists a kerb rider, and each lists several kinds of the city mix', () => {
    const used = [...areasOver()].filter((a) => a !== '');
    console.log(`[examined] areas over the Golden Gate route: ${used.join(', ')}`);
    expect(used.length).toBeGreaterThanOrEqual(1);
    for (const area of used) {
      for (const t of kerbRiders) expect(t.areaWeights?.[area] ?? 0, `${t.contentId} in ${area}`).toBe(0);
      const listed = config.trafficTypes.filter((t) => (t.areaWeights?.[area] ?? 0) > 0);
      expect(listed.length, area).toBeGreaterThanOrEqual(3);
      for (const t of listed) expect(t.weight ?? 0, `${t.contentId} is in the city mix`).toBeGreaterThan(0);
    }
  });

  it('the deck has an area tag of its own: a bridge run holds only `bridge` and `water-open` besides it', () => {
    const deck = REG.roads['region-sf:osm-sf-gg-bridge'] as unknown as { tags: { tag: string }[] };
    const areaTags = new Set((REG.regions['region-sf:san-francisco']?.traffic.areas ?? []).map((a) => a.tag));
    expect(areaTags.has('bridge')).toBe(false);
    expect(deck.tags.some((t) => areaTags.has(t.tag))).toBe(true);
  });
});
