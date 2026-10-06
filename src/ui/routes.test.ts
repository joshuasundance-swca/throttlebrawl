import { describe, expect, it } from 'vitest';
import {
  cleanRoutes,
  pageScrollLeft,
  pickRoute,
  routeChipId,
  scrollCue,
  scrollLeftToShow,
  type RouteOption,
} from './routes';

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

// The chip row's scroll cue (playtest 4, run B, punch item 10): the row runs past the right edge at
// every text size and nothing showed that it scrolls. The row says so with a "more roads" arrow at
// each end it can still go, and the arrows page it. These are the rules the arrows follow.
describe('the chip row scroll cue', () => {
  const row = (scrollLeft: number, clientWidth = 560, scrollWidth = 1603) => ({
    scrollLeft,
    clientWidth,
    scrollWidth,
  });

  it('a row that fits shows no cue (the control: nothing to scroll, nothing to point at)', () => {
    expect(scrollCue(row(0, 560, 560))).toEqual({ scrolls: false, before: false, after: false });
    // A sub-pixel overhang is not a scroll.
    expect(scrollCue(row(0, 560, 560.6))).toEqual({ scrolls: false, before: false, after: false });
  });

  it('a row that runs past its edge points at the more chips, at the start, the middle and the end', () => {
    expect(scrollCue(row(0))).toEqual({ scrolls: true, before: false, after: true });
    expect(scrollCue(row(400))).toEqual({ scrolls: true, before: true, after: true });
    expect(scrollCue(row(1043))).toEqual({ scrolls: true, before: true, after: false });
    // Sub-pixel rest positions at the far end still count as the end.
    expect(scrollCue(row(1042.4))).toEqual({ scrolls: true, before: true, after: false });
  });

  it('an arrow with no chip edge to land on pages by most of a view, and never past either end', () => {
    expect(pageScrollLeft(row(0), 1)).toBe(448);
    expect(pageScrollLeft(row(448), 1)).toBe(896);
    expect(pageScrollLeft(row(896), 1)).toBe(1043);
    expect(pageScrollLeft(row(448), -1)).toBe(0);
    expect(pageScrollLeft(row(0), -1)).toBe(0);
  });

  // The widest region's chips, measured at Largest on a 915 x 412 phone (the live check's San
  // Francisco row): the widest chip is 309 px, the gap 10, the row 4 px in from each end.
  const widths = [262, 167, 179, 203, 156, 309, 132, 150, 142];
  const spans = widths.map((w, i) => {
    const left = widths.slice(0, i).reduce((a, x) => a + x + 10, 4);
    return { left, right: left + w };
  });
  const scrollWidth = spans[8]!.right + 4;
  const whole = (at: number, clientWidth: number) =>
    spans.flatMap((c, i) => (c.left >= at && c.right <= at + clientWidth ? [i] : []));

  it('paging from the start brings every chip of the widest region whole into view, in a few taps', () => {
    for (const clientWidth of [460, 560, 330]) {
      let at = 0;
      const seen = new Set<number>();
      let taps = 0;
      for (; taps < 12; taps++) {
        for (const i of whole(at, clientWidth)) seen.add(i);
        const m = { scrollLeft: at, clientWidth, scrollWidth };
        if (!scrollCue(m).after) break;
        at = pageScrollLeft(m, 1, spans);
      }
      expect([...seen].sort(), `view ${clientWidth}`).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(taps, `view ${clientWidth}: taps to reach the last chip`).toBeLessThanOrEqual(8);
    }
  });

  it('paging back from the end does the same, and the left arrow always moves the row', () => {
    const clientWidth = 460;
    let at = scrollWidth - clientWidth;
    const seen = new Set<number>();
    for (let taps = 0; taps < 12; taps++) {
      for (const i of whole(at, clientWidth)) seen.add(i);
      const m = { scrollLeft: at, clientWidth, scrollWidth };
      if (!scrollCue(m).before) break;
      const next = pageScrollLeft(m, -1, spans);
      expect(next, 'a tap moves the row').toBeLessThan(at);
      at = next;
    }
    expect(at).toBe(0);
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('a chip wider than the row still pages (by most of a view), so the row never sticks', () => {
    const m = { scrollLeft: 0, clientWidth: 200, scrollWidth: 800 };
    const wide = [{ left: 4, right: 700 }];
    expect(pageScrollLeft(m, 1, wide)).toBe(160);
  });

  it('a picked chip is brought into view by the least scroll, and left alone when it is in view', () => {
    const m = row(100);
    expect(scrollLeftToShow(m, 200, 400)).toBe(100); // inside [100, 660]
    expect(scrollLeftToShow(m, 50, 150)).toBe(46); // off the left: its left edge, with a 4 px margin
    expect(scrollLeftToShow(m, 600, 800)).toBe(244); // off the right: its right edge, with the margin
    expect(scrollLeftToShow(row(0, 560, 560), 10, 100)).toBe(0); // nothing scrolls
  });
});
