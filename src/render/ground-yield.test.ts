// A road's ground yields to a lower road's lanes (lane M1, 2026-10-06; the maintainer: "a road race in a physical
// world with honest edges": a shoulder, a verge band or a fascia over a road's lanes is a ceiling the rider rides
// under). Where a link runs lower beside a road, down its embankment (the I-5 over Lake Samish's links, the park
// cut under the Fogline Climb, the Jones Street choice), the higher road's shoulder, band and fascia stop short of
// the link's lanes (`EdgeLocator.clearReach` and `overLowerLanes`, overlap.ts). The ride-column check
// (road-clear-*.test.ts) holds the drawn triangles to a kerb's 0.15 m; these tests hold the plan behind them, and
// the drawn ground to the tighter 5 cm it is built to, and say what each examined.
import { describe, expect, it } from 'vitest';
import { nearestOnEdges } from '../road';
import { EdgeLocator, GROUND_OVER_ROAD_M, GROUND_YIELD_MARGIN_M, laneExtentAt } from './overlap';
import { GROUND, RIDE_LOW_M, placeLine, sweepNetwork } from './road-clear.test-util';
import { print, track } from './scene-cost.test-util';
import { VERGE_LIFT_M } from './verge';

const I5 = 'osm-i5-lake-samish';
const SOUTHBOUND_TAIL = 'osm-samish-exit242-sb-on';
/** The unchanged I-5 world site over the south shore tail, where it stands 1.3 to 1.5 m higher. */
const I5_S = 5358;
/** Old `osm-samish-east-shore` s 4208 projected from the pre-split committed bake. */
const ORIGINAL_LOWER_WORLD = { x: 1782.6501, z: 1998.9109 };

describe('EdgeLocator.clearReach at the split south shore tail', () => {
  const { road } = track('osm-pnw-samish');
  const loc = new EdgeLocator(road);
  const i5 = road.edgeIndex(I5);
  const shore = road.edgeIndex(SOUTHBOUND_TAIL);
  const site = road.toWorld(i5, I5_S, 12, 0);
  const lowerAtSite = nearestOnEdges(road, [shore], site.x, site.z);
  if (!lowerAtSite) throw new Error('no lower road at the I-5 regression site');
  const shoreS = lowerAtSite.s;
  const reachOf = (edge: number, s: number, side: 'left' | 'right') => {
    const v = road.vergeAt(edge, s, side);
    return {
      v,
      reach: loc.clearReach(
        edge,
        s,
        v.dInner,
        v.dOuter,
        VERGE_LIFT_M,
        GROUND_YIELD_MARGIN_M,
        GROUND_OVER_ROAD_M,
      ),
    };
  };

  it('keeps the band whole after the reverse lower lane is removed, at the original physical crossing', () => {
    // Anchor on the old I-5 world site, then project onto the newly split lower tail. This catches a
    // migration to the wrong fragment or an unrelated crossing instead of preserving the regression.
    const under = road.toWorld(shore, shoreS, 0, 0);
    expect(
      Math.hypot(site.x - under.x, site.z - under.z),
      'the projected lower road is at the same crossing',
    ).toBeLessThan(6);
    expect(
      Math.hypot(ORIGINAL_LOWER_WORLD.x - under.x, ORIGINAL_LOWER_WORLD.z - under.z),
      'the lower control preserves the pre-split world site',
    ).toBeLessThan(1);
    expect(site.y - under.y, 'the I-5 stands over the shore road here').toBeGreaterThan(1);
    const { v, reach } = reachOf(i5, I5_S, 'right');
    expect(v.widthM, 'the I-5 has a band here').toBeGreaterThan(1);
    expect(reach, 'the remaining lane is outside the I-5 band').toBe(v.dOuter);
    // The control: the same road with no other road beside it (mid-road) keeps its whole band.
    const mid = reachOf(i5, 1500, 'right');
    expect(mid.v.widthM).toBeGreaterThan(1);
    expect(mid.reach, 'a clear band is not cut').toBe(mid.v.dOuter);
    print(
      `[examined] clearReach: the I-5 at s ${I5_S} (right band ${v.dInner.toFixed(1)} to ${v.dOuter.toFixed(1)}) runs to ${reach?.toFixed(2)} after the reverse lower lane is removed; at s 1500 (nothing beside it) it runs to ${mid.reach?.toFixed(2)}`,
    );
  });

  it('does not cut the lower road’s own band under the higher road’s lanes (only a road over a lower one yields)', () => {
    // The shore road's left side faces the I-5: its band lies under the I-5's lanes, 1.3 m lower. It stays.
    const { v, reach } = reachOf(shore, shoreS, 'left');
    expect(v.widthM).toBeGreaterThan(1);
    expect(reach, 'the lower road’s band is not cut for a road above it').toBe(v.dOuter);
  });

  it('overLowerLanes: a point 1.3 m over the lanes is over them; within a 1 m underpass limit, or level, it is not', () => {
    const laneD = 2;
    const p = road.toWorld(shore, shoreS, laneD, 0);
    const [lo, hi] = laneExtentAt(road, shore, shoreS);
    expect(laneD).toBeGreaterThan(lo);
    expect(laneD).toBeLessThan(hi);
    const q = (up: number) => ({ ...p, y: p.y + up });
    const over = (up: number, within?: number) =>
      loc.overLowerLanes(q(up).x, q(up).y, q(up).z, i5, GROUND_YIELD_MARGIN_M, GROUND_OVER_ROAD_M, within);
    expect(over(1.3)).toBe(true);
    expect(over(1.3, 1)).toBe(false);
    expect(over(0.02), 'level with the lanes: a merge, not a ceiling').toBe(false);
    expect(over(-0.5), 'under them').toBe(false);
  });
});

/**
 * The ground of the roads that cross, branch and join at heights, held to 8 cm (the build's 5 cm, and the
 * interpolation between two samples), not the check's 15 cm kerb. Paint over a crest's chord stands higher over a
 * curved road, so only the pieces that yield are held to it.
 */
const YIELDS = /^(road-shoulder|road-deck|verge-band)$/;
const STRICT_M = 0.08;
const strict = (name: string) => (YIELDS.test(name) ? STRICT_M : GROUND.test(name) ? 0.15 : RIDE_LOW_M);

describe('the drawn shoulder, fascia and verge band lie within 8 cm over any road’s lanes, where roads meet at heights', () => {
  for (const [id, seed] of [
    ['osm-pnw-samish', 1],
    ['sf-hills', 1],
    ['osm-sf-russian-hill', 1],
  ] as const) {
    it(`${id}, seed ${seed}`, async () => {
      const { places, points } = await sweepNetwork(id, seed, undefined, strict);
      const held = places.filter((p) => YIELDS.test(p.part.split('/')[1] ?? ''));
      print(
        `[examined] ${id}: ${points} column points, ${places.length} places cut, ${held.length} of the yielding ground`,
      );
      for (const p of held) print(`  OVER AN 8 CM RULE: ${placeLine(p)}`);
      expect(held.map(placeLine)).toEqual([]);
    }, 300_000);
  }
});
