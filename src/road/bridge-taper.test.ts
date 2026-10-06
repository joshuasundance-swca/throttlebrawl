// Bridge tapers (road/bridge-taper.ts; playtest 4, the maintainer on the Gorge: "when it goes from
// grass to bridge or whatever the rider clips from open air onto the bridge. You can see it happen
// if you stay to the far right"). The verge band beside a land road narrows into each bridge end at
// BRIDGE_TAPER_SLOPE instead of stopping square, inside an edge and across a pass-through join, so
// the far edge of the ground a rider may ride never jumps sideways at a bridge.
import { describe, expect, it } from 'vitest';
import { BRIDGE_TAPER_SLOPE, bridgeTapers, taperedWidth } from './bridge-taper';
import { fixtureNetwork } from './fixture';
import { createRoadNetwork } from './network';
import type { BakedNetworkBundle, BakedTag } from './types';

/** A forest road (a 6 m dirt band with a brush edge) with rails over its bridge stretches. */
function forestWithBridges(
  specs: { id: string; lengthM: number; bridges: [number, number][] }[],
): BakedNetworkBundle {
  const bundle = fixtureNetwork(specs.map((s) => ({ id: s.id, lengthM: s.lengthM, kappa: 0 })));
  for (const road of bundle.roads) {
    const spec = specs.find((s) => s.id === road.id);
    const bridges = spec?.bridges ?? [];
    const tags: BakedTag[] = [{ s0: 0, s1: road.lengthM, side: 'both', tag: 'forest' }];
    for (const [s0, s1] of bridges) tags.push({ s0, s1, side: 'both', tag: 'bridge' });
    road.tags = tags;
    road.barriers = bridges.map(([s0, s1]) => ({ s0, s1, side: 'both', kind: 'rail', heightM: 1 }));
  }
  return bundle;
}

describe('bridge tapers', () => {
  it('the cap is the band on the bridge plus the slope times the distance from the bridge end', () => {
    const anchors = [{ s: 100, widthM: 0 }];
    expect(taperedWidth(6, anchors, 100)).toBe(0);
    expect(taperedWidth(6, anchors, 90)).toBeCloseTo(10 * BRIDGE_TAPER_SLOPE, 9);
    expect(taperedWidth(6, anchors, 40)).toBe(6);
    expect(taperedWidth(6, [], 100)).toBe(6);
  });

  it('a band narrows smoothly into a bridge inside a road, both ends, both sides', () => {
    const road = createRoadNetwork(forestWithBridges([{ id: 'a', lengthM: 600, bridges: [[300, 400]] }]));
    let examined = 0;
    for (const side of ['left', 'right'] as const) {
      // Off the bridge and out of the taper's reach: the forest's full band.
      expect(road.vergeAt(0, 200, side).widthM).toBe(6);
      expect(road.vergeAt(0, 500, side).widthM).toBe(6);
      // At the bridge's ends the band is the deck's (none): the rail starts where the band ends.
      expect(road.vergeAt(0, 300, side).widthM).toBeCloseTo(0, 6);
      expect(road.vergeAt(0, 400, side).widthM).toBeCloseTo(0, 6);
      // On the taper the band is the slope times the distance, and says it is a taper.
      const v = road.vergeAt(0, 280, side);
      expect(v.widthM).toBeCloseTo(20 * BRIDGE_TAPER_SLOPE, 9);
      expect(v.taper).toBe(true);
      expect(road.vergeAt(0, 200, side).taper).toBeUndefined();
      // The ground at the band's tapered outer edge is the band's; past it, none.
      const sign = side === 'left' ? -1 : 1;
      expect(road.groundAt(0, 280, v.dOuter - sign * 0.01)).toBe('dirt');
      expect(road.groundAt(0, 280, v.dOuter + sign * 0.01)).toBeNull();
      // No step anywhere along the road: the outer edge moves at most the slope per metre.
      let prev = road.vergeAt(0, 0, side).dOuter;
      for (let s = 0.5; s <= 600; s += 0.5) {
        const cur = road.vergeAt(0, s, side).dOuter;
        expect(Math.abs(cur - prev)).toBeLessThanOrEqual(0.5 * BRIDGE_TAPER_SLOPE + 1e-9);
        prev = cur;
        examined++;
      }
    }
    console.log(
      `[examined] one 600 m forest road, a 100 m bridge: ${examined} half-metre steps of both bands`,
    );
  });

  it('a bridge that starts at a road end tapers the band of the road before it, across the join', () => {
    // b is all bridge; a and c are forest roads joined end to end on either side of it.
    const road = createRoadNetwork(
      forestWithBridges([
        { id: 'a', lengthM: 200, bridges: [] },
        { id: 'b', lengthM: 300, bridges: [[0, 300]] },
        { id: 'c', lengthM: 200, bridges: [] },
      ]),
    );
    for (const side of ['left', 'right'] as const) {
      expect(road.vergeAt(0, 200, side).widthM).toBeCloseTo(0, 6);
      expect(road.vergeAt(0, 190, side).widthM).toBeCloseTo(10 * BRIDGE_TAPER_SLOPE, 9);
      expect(road.vergeAt(0, 100, side).widthM).toBe(6);
      expect(road.vergeAt(2, 0, side).widthM).toBeCloseTo(0, 6);
      expect(road.vergeAt(2, 30, side).widthM).toBeCloseTo(30 * BRIDGE_TAPER_SLOPE, 9);
    }
  });

  it('a taper longer than a short road carries on into the road before it', () => {
    // a (forest) - b (20 m of forest) - c (bridge from its start): the 60 m taper crosses b into a.
    const road = createRoadNetwork(
      forestWithBridges([
        { id: 'a', lengthM: 200, bridges: [] },
        { id: 'b', lengthM: 20, bridges: [] },
        { id: 'c', lengthM: 300, bridges: [[0, 300]] },
      ]),
    );
    expect(road.vergeAt(1, 20, 'right').widthM).toBeCloseTo(0, 6);
    expect(road.vergeAt(1, 0, 'right').widthM).toBeCloseTo(20 * BRIDGE_TAPER_SLOPE, 9);
    expect(road.vergeAt(0, 200, 'right').widthM).toBeCloseTo(20 * BRIDGE_TAPER_SLOPE, 9);
    expect(road.vergeAt(0, 190, 'right').widthM).toBeCloseTo(30 * BRIDGE_TAPER_SLOPE, 9);
    expect(road.vergeAt(0, 100, 'right').widthM).toBe(6);
  });

  it('a road with no bridge has no anchors, and its bands are exactly as before', () => {
    const bundle = forestWithBridges([{ id: 'a', lengthM: 400, bridges: [] }]);
    const road = createRoadNetwork(bundle);
    const table = bridgeTapers(road.edges, () => 6);
    expect(table[0]).toEqual([[], []]);
    expect(road.vergeAt(0, 123, 'left')).toEqual({
      widthM: 6,
      surface: 'dirt',
      edge: 'brush',
      side: 'left',
      dInner: -4.9,
      dOuter: -10.9,
      derived: true,
    });
  });
});
