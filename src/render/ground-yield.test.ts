// A road's ground yields to a lower road's lanes (lane M1, 2026-10-06; the maintainer: "a road race in a physical
// world with honest edges": a shoulder, a verge band or a fascia over a road's lanes is a ceiling the rider rides
// under). Where a link runs lower beside a road, down its embankment (the I-5 over Lake Samish's links, the park
// cut under the Fogline Climb, the Jones Street choice), the higher road's shoulder, band and fascia stop short of
// the link's lanes (`EdgeLocator.clearReach` and `overLowerLanes`, overlap.ts). The ride-column check
// (road-clear-*.test.ts) holds the drawn triangles to a kerb's 0.15 m; these tests hold the plan behind them, and
// the drawn ground to the tighter 5 cm it is built to, and say what each examined.
import { describe, expect, it } from 'vitest';
import { EdgeLocator, GROUND_OVER_ROAD_M, GROUND_YIELD_MARGIN_M, laneExtentAt } from './overlap';
import { GROUND, RIDE_LOW_M, placeLine, sweepNetwork } from './road-clear.test-util';
import { print, track } from './scene-cost.test-util';
import { VERGE_LIFT_M } from './verge';

const I5 = 'osm-i5-lake-samish';
const EAST_SHORE = 'osm-samish-east-shore';
/** Where the east shore road ends beside the I-5, which stands 1.3 to 1.5 m over it there. */
const I5_S = 5358;
const SHORE_S = 4208;

describe('EdgeLocator.clearReach: the I-5’s verge band stops short of the east shore road’s lanes', () => {
  const { road } = track('osm-pnw-samish');
  const loc = new EdgeLocator(road);
  const i5 = road.edgeIndex(I5);
  const shore = road.edgeIndex(EAST_SHORE);
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

  it('stops it where the lower road’s lanes begin, and the band beside it clear of them stays whole', () => {
    // The east shore road runs 1.3 m under the I-5's right edge here: the band over its lanes goes.
    const here = road.toWorld(i5, I5_S, 12, 0);
    const under = road.toWorld(shore, SHORE_S, 0, 0);
    expect(here.y - under.y, 'the I-5 stands over the shore road here').toBeGreaterThan(1);
    const { v, reach } = reachOf(i5, I5_S, 'right');
    expect(v.widthM, 'the I-5 has a band here').toBeGreaterThan(1);
    expect(reach === null || reach < v.dOuter - 0.5, 'the band is cut short or begins over the lanes').toBe(
      true,
    );
    // The control: the same road with no other road beside it (mid-road) keeps its whole band.
    const mid = reachOf(i5, 1500, 'right');
    expect(mid.v.widthM).toBeGreaterThan(1);
    expect(mid.reach, 'a clear band is not cut').toBe(mid.v.dOuter);
    print(
      `[examined] clearReach: the I-5 at s ${I5_S} (right band ${v.dInner.toFixed(1)} to ${v.dOuter.toFixed(1)}) stops at ${reach === null ? 'its start' : reach.toFixed(2)}; at s 1500 (nothing beside it) it runs to ${mid.reach?.toFixed(2)}`,
    );
  });

  it('does not cut the lower road’s own band under the higher road’s lanes (only a road over a lower one yields)', () => {
    // The shore road's left side faces the I-5: its band lies under the I-5's lanes, 1.3 m lower. It stays.
    const { v, reach } = reachOf(shore, SHORE_S, 'left');
    expect(v.widthM).toBeGreaterThan(1);
    expect(reach, 'the lower road’s band is not cut for a road above it').toBe(v.dOuter);
  });

  it('overLowerLanes: a point 1.3 m over the lanes is over them; within a 1 m underpass limit, or level, it is not', () => {
    const p = road.toWorld(shore, SHORE_S, -2, 0);
    const [lo, hi] = laneExtentAt(road, shore, SHORE_S);
    expect(-2).toBeGreaterThan(lo);
    expect(-2).toBeLessThan(hi);
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
