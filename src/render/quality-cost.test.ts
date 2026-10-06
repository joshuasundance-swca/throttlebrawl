// The quality tiers' cut at each region's busiest view (roadmap M5, the benchmark phone; playtest 4 run C's
// live check, punch item 9). The low tier used to trim only how far the still scenery reached, so at the
// game's busiest view (Russian Hill's Hyde Street) it drew 152,430 triangles against high's 156,948: about
// 3% lighter, too little to rescue a heavy frame on a phone. Each lower tier now cuts geometry that is cheap
// to lose (quality.ts QUALITY_TIERS: the scatter's far stand-ins nearer, fewer trees and ferns, the roadside's
// and the road's small detail nearer, the city blocks' stand-ins nearer). This rides each region's heaviest
// route with the still-scene sweep (scene-cost.test-util.ts: every 5 m of every road the route allows, both
// ways, from all six camera views) at `high` and at `low`, and holds low's peak view at least 25% lighter.
// The control rides Russian Hill with the low tier as it was (#562: reach only), which must fail that bar.
import { describe, expect, it } from 'vitest';
import { QUALITY_TIERS, type QualityTier } from './quality';
import {
  cameraParams,
  describeParts,
  print,
  ROUTES,
  SAMPLE_M,
  stillSceneOf,
  sweep,
} from './scene-cost.test-util';

/**
 * Each region's heaviest route at `high` (its still scene's peak view, seed 1, 2026-10-06): the Keys' M1
 * standard run (89,418 triangles; the long haul rides the same network to the same peak view, with more
 * road to sweep), San Francisco's Russian Hill (105,269) and the Pacific Northwest's Columbia River Gorge
 * (93,639). Russian Hill and the Gorge are the only routes over 90,000.
 */
const HEAVIEST = ['m1-standard-run', 'osm-sf-hills-run', 'osm-gorge-run'] as const;
/** The low tier's peak view is at least this much lighter than high's. [default] */
const LOW_CUT_MIN = 0.25;
/** The low tier before this change (#562): only the scenery's reach and far-detail distance shrank. */
const LOW_BEFORE: Readonly<QualityTier> = {
  ...QUALITY_TIERS.low,
  sceneryReach: 0.8,
  lodReach: 0.7,
  propDetail: 1,
  treeShare: 1,
  cityDetail: 1,
};

async function peakOf(routeId: string, tier: Readonly<QualityTier>) {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route) throw new Error(`no route ${routeId}`);
  const { road, scene } = await stillSceneOf(route.network, 1, tier);
  return sweep(road, scene, route, await cameraParams(), { step: SAMPLE_M, bothWays: true });
}

describe("the low quality tier at each region's busiest view", () => {
  for (const id of HEAVIEST) {
    it(`${id}: low's peak view is at least ${LOW_CUT_MIN * 100}% lighter than high's`, async () => {
      const high = await peakOf(id, QUALITY_TIERS.high);
      const low = await peakOf(id, QUALITY_TIERS.low);
      const cut = 1 - low.tris.total.tris / high.tris.total.tris;
      print(
        `[examined] ${id}: ${high.views} views per tier; high peak ${Math.round(high.tris.total.tris)} triangles, ` +
          `${high.draws.total.draws} draw calls at ${high.tris.at} (${describeParts(high.tris.parts, 'tris')}); ` +
          `low peak ${Math.round(low.tris.total.tris)}, ${low.draws.total.draws} draw calls at ${low.tris.at} ` +
          `(${describeParts(low.tris.parts, 'tris')}): ${(cut * 100).toFixed(1)}% lighter`,
      );
      expect(high.views).toBeGreaterThan(100);
      expect(
        cut,
        `${id}: low ${Math.round(low.tris.total.tris)} against high ${Math.round(high.tris.total.tris)}`,
      ).toBeGreaterThanOrEqual(LOW_CUT_MIN);
      // A lower tier never draws more calls.
      expect(low.draws.total.draws).toBeLessThanOrEqual(high.draws.total.draws);
    }, 300_000);
  }

  it('control: the low tier as it was (reach only) misses the bar on Russian Hill', async () => {
    const high = await peakOf('osm-sf-hills-run', QUALITY_TIERS.high);
    const before = await peakOf('osm-sf-hills-run', LOW_BEFORE);
    const cut = 1 - before.tris.total.tris / high.tris.total.tris;
    print(
      `[examined] control, osm-sf-hills-run: the old low tier's peak ${Math.round(before.tris.total.tris)} against high's ` +
        `${Math.round(high.tris.total.tris)}: ${(cut * 100).toFixed(1)}% lighter`,
    );
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(LOW_CUT_MIN);
  }, 300_000);
});
