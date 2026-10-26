/// <reference types="vite/client" />
// Longview and Iowa in the career (2026-10-26, the maintainer: "yes I want the new content in career
// too"). Iowa is the fourth chapter, after San Francisco: global tiers 13 to 16, shut until Pivot
// falls, every one of its routes raced by the map. Longview races in the Pacific Northwest's chapter
// on two of its three routes. The ladder rules themselves (purses, paces, tiers) are
// career-ladder.test.ts, which covers every career; this file checks what the two new pieces add.
// Data only: no race is run here; the races are tests/sim/career-headless-iowa.test.ts.
import { describe, expect, it } from 'vitest';
import { careerDefs, careerOf, globalTier, progressOf, regionOpen, startCareer } from '../../src/career';
import { quickPlayEvents } from '../../src/app/quick-play-events';
import { DEFAULT_PROFILE } from '../../src/save';
import { REG } from './career-harness';

const DEFS = careerDefs(REG);
const iowa = careerOf(DEFS, 'clinton-iowa');
const sf = careerOf(DEFS, 'san-francisco');
const pnw = careerOf(DEFS, 'pacific-northwest');
if (!iowa || !sf || !pnw) throw new Error('a career is missing');

/** The routes an event's lengths race, qualified by the event's pack. */
const routesOf = (eventKey: string): string[] => {
  const pack = eventKey.slice(0, eventKey.indexOf(':'));
  return (REG.events[eventKey]?.lengths ?? []).map((l) => `${pack}:${l.route}`);
};
/** The route a career node races (its length, else the event's first). */
const nodeRoute = (eventKey: string, length: string | null | undefined): string | undefined => {
  const pack = eventKey.slice(0, eventKey.indexOf(':'));
  const lengths = REG.events[eventKey]?.lengths ?? [];
  const l = lengths.find((x) => x.id === length) ?? lengths[0];
  return l ? `${pack}:${l.route}` : undefined;
};

describe('Iowa, the fourth chapter', () => {
  it('follows San Francisco: chapter 4, global tiers 13 to 16, and the Bay Circuit points to it', () => {
    expect(DEFS.map((d) => d.regionId)).toEqual([
      'florida-keys',
      'pacific-northwest',
      'san-francisco',
      'clinton-iowa',
    ]);
    expect(iowa.chapter).toBe(4);
    expect(globalTier(DEFS, iowa, 0)).toBe(13);
    expect(globalTier(DEFS, iowa, iowa.tiers.length - 1)).toBe(16);
    expect(sf.ending.next).toBe(iowa.regionKey);
    // The last chapter promises no next region.
    expect(iowa.ending.next).toBeNull();
  });

  it('is shut until Pivot falls, then open', () => {
    const fresh = startCareer(DEFS, { ...DEFAULT_PROFILE });
    expect(regionOpen(DEFS, fresh, iowa)).toBe(false);
    // Negative control: the chapter before it is not opened by Iowa's rule.
    expect(regionOpen(DEFS, fresh, sf)).toBe(false);
    const done = {
      ...fresh,
      regions: { ...fresh.regions, [sf.regionId]: { ...progressOf(sf, fresh.regions), finaleBeaten: true } },
    };
    expect(regionOpen(DEFS, done, iowa)).toBe(true);
  });

  it("races every one of the region's routes, Mara Vale its finale", () => {
    const region = REG.regions[iowa.regionKey];
    expect(region).toBeDefined();
    const regionRoutes = Object.keys(REG.routes).filter((k) => {
      const net = REG.routes[k]?.network;
      return k.startsWith('region-clinton:') && region!.networks.includes(net ?? '');
    });
    expect(regionRoutes.length).toBeGreaterThanOrEqual(3);
    const raced = new Set(iowa.nodes.map((n) => nodeRoute(n.event, n.length)));
    for (const route of regionRoutes) expect(raced, route).toContain(route);
    const finale = iowa.nodes.find((n) => n.id === iowa.boss);
    expect(REG.events[finale?.event ?? '']?.rules?.['rival']).toBe('mara-vale');
  });

  it("keeps Rural Rush and the Survey Run as Iowa's Quick Play race and grudge", () => {
    const picks = Object.fromEntries(quickPlayEvents(REG, iowa.regionKey).map((q) => [q.kind, q.eventId]));
    expect(picks['race']).toBe('region-clinton:clinton-ia136-race');
    expect(picks['grudge']).toBe('region-clinton:clinton-mara-survey-run');
    // Iowa had no hunt or escape before its chapter; Quick Play now offers its first-tier ones.
    const careerEvents = new Set(iowa.nodes.map((n) => n.event));
    expect(careerEvents).toContain(picks['hunt']);
    expect(careerEvents).toContain(picks['escape']);
  });
});

describe('Longview in the Pacific Northwest chapter', () => {
  it('races at least two of Longview’s routes from the map, on its own roads', () => {
    const longview = Object.keys(REG.routes).filter((k) => k.startsWith('region-pnw:osm-longview-'));
    expect(longview.length).toBeGreaterThanOrEqual(2);
    const nodes = pnw.nodes.filter((n) => longview.includes(nodeRoute(n.event, n.length) ?? ''));
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    for (const n of nodes) {
      // The map point is a road of the route it races.
      const route = REG.routes[nodeRoute(n.event, n.length) ?? ''];
      expect(route?.allowedRoads ?? [], n.id).toContain(n.road);
    }
    // Negative control: a non-Longview node is not counted.
    const ferry = pnw.nodes.find((n) => n.id === 'ferry-line');
    expect(longview).not.toContain(nodeRoute(ferry?.event ?? '', ferry?.length));
    expect(routesOf(ferry?.event ?? '').length).toBeGreaterThan(0);
  });
});
