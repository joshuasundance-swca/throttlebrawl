/// <reference types="vite/client" />
// Playtest 3's real-world content in San Francisco (T10.6; the critic's W1, C4, C5 and G5): the
// fourth tier's "Series C" is the Golden Gate at dawn, Lombard Street is a race of its own (the T2.6
// probe found a drift cannot hold on its hairpins at the shipped floors), and the third tier holds a
// drift race on the Twin Peaks hairpins. The rules are checked on the packs'
// files; the drift targets against the drift bot are tests/sim/drift-events.test.ts, "every route of
// a region has an event" is career-content.test.ts, and the one-way block's traffic is
// tests/sim/traffic-one-way.test.ts.
import { describe, expect, it } from 'vitest';
import { careerDefs, eventPlan, type CareerDef } from '../../src/career';
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
