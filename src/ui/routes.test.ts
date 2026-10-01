import { describe, expect, it } from 'vitest';
import { cleanRoutes, pickRoute, routeChipId, type RouteOption } from './routes';

// The route picker's rules (the maintainer, 2026-10-01: "Yes, add as routes"): the region's own
// road is the default, a real road stays picked while it is offered, and the list is cleaned.

const own: RouteOption = { id: null, name: 'Fogline Run', blurb: 'The hand-made road.' };
const chuckanut: RouteOption = { id: 'region-pnw:osm-chuckanut-run', name: 'Chuckanut Drive' };
const gorge: RouteOption = { id: 'region-pnw:osm-gorge-run', name: 'Historic Columbia River Highway' };

describe('route picker rules', () => {
  it("defaults to the region's own road, and keeps an offered real road", () => {
    expect(pickRoute([own, chuckanut, gorge])).toBeNull();
    expect(pickRoute([own, chuckanut, gorge], 'region-pnw:osm-gorge-run')).toBe('region-pnw:osm-gorge-run');
  });

  it("falls back to the own road for a route the region does not offer (another region's pick)", () => {
    expect(pickRoute([own, chuckanut], 'region-sf:osm-sf-hills-run')).toBeNull();
    // With no own road in the list, the first route; nothing at all for an empty list.
    expect(pickRoute([chuckanut, gorge], 'nope')).toBe('region-pnw:osm-chuckanut-run');
    expect(pickRoute([])).toBeNull();
  });

  it('drops blank names and repeats, keeping the first', () => {
    const cleaned = cleanRoutes([
      own,
      { id: 'x', name: ' ' },
      chuckanut,
      { ...chuckanut, name: 'Again' },
      own,
    ]);
    expect(cleaned.map((o) => o.name)).toEqual(['Fogline Run', 'Chuckanut Drive']);
    expect(cleanRoutes([{ id: ' ', name: 'Blank id' }])).toEqual([]);
  });

  it('gives each chip a stable element id', () => {
    expect(routeChipId(null)).toBe('route-own');
    expect(routeChipId('region-pnw:osm-chuckanut-run')).toBe('route-region-pnw-osm-chuckanut-run');
  });
});
