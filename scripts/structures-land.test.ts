// The drawn land as the structure plans read it (road/structures/land.ts): render's own strip rule
// (road-mesh.ts `buildRoadScene`, `RoadScene.landReach`), moved to road/ so a planner can size its lots on
// the land render draws without reading the drawn scene. The two must agree at every sample, or a plan
// would stand a building where render draws no ground (or leave a lot empty where it does).
import { describe, expect, it } from 'vitest';
import { landReachOf, SEAWALL_LAND, WIDE_LAND } from '../src/road/structures/land';
import { createFlatLook } from '../src/render/look';
import { buildRoadScene } from '../src/render/road-mesh';
import { SEAWALL_LAND_M, WIDE_LAND_M } from '../src/render/scenery';
import { print, track } from '../src/render/structures.test-util';

const look = createFlatLook();

/**
 * The networks it is held on: every one with a theme the plans place on (Old Town's), and one of each kind of
 * land render lays: a wide strip (Portland's blocks), seawalls and a lake bank (the waterfront, Chuckanut and
 * Samish), loops and stacked roads (the hills), bridges and rails (the Seven Mile), and a plain Keys road.
 */
const NETWORKS = [
  'osm-keys-duval',
  'osm-keys-key-west',
  'keys-m1',
  'osm-keys-seven-mile',
  'osm-pnw-portland',
  'osm-pnw-chuckanut',
  'osm-pnw-samish',
  'sf-hills',
  'sf-waterfront',
];

describe('the land a structure plan reads is the land render draws (road/structures/land.ts)', () => {
  it("keeps render's widths: the wide strips and the seawalls", () => {
    expect(WIDE_LAND).toEqual(WIDE_LAND_M);
    expect(SEAWALL_LAND).toEqual(SEAWALL_LAND_M);
  });

  it.each(NETWORKS)(
    '%s: the same reach at every 2 m on both sides of every road',
    (id) => {
      const { road, dressing } = track(id);
      const drawn = buildRoadScene(road, look, dressing, { seed: 7, roadsideDensity: 1 });
      const planned = landReachOf(road);
      let samples = 0;
      let land = 0;
      const off: string[] = [];
      for (const e of road.edges)
        for (const side of [-1, 1] as const)
          for (let s = 0; s <= e.length; s += 2) {
            const want = drawn.landReach(e.index, side, s);
            const got = planned(e.index, side, s);
            samples++;
            if (want > 0) land++;
            if (got !== want) off.push(`${e.id} side ${side} s ${s}: drawn ${want}, planned ${got}`);
          }
      drawn.dispose();
      print(`[examined] ${id}: ${samples} samples, ${land} with drawn land, ${off.length} that differ`);
      expect(off.slice(0, 8)).toEqual([]);
      expect(land).toBeGreaterThan(0);
    },
    120_000,
  );

  it('a negative control: a road the planner thinks is elsewhere reads other land', () => {
    // Shifting where the plan asks by 40 m along Whitehead's end, where Duval runs close by on its left,
    // reads the wide strip where render draws the narrow one: the comparison above can find a difference.
    const { road, dressing } = track('osm-keys-duval');
    const drawn = buildRoadScene(road, look, dressing, { seed: 7, roadsideDensity: 1 });
    const planned = landReachOf(road);
    const e = road.edges.find((x) => x.id === 'osm-duval-whitehead');
    if (!e) throw new Error('no Whitehead');
    let differ = 0;
    for (let s = 1400; s <= 1740; s += 2)
      if (planned(e.index, -1, s - 40) !== drawn.landReach(e.index, -1, s)) differ++;
    drawn.dispose();
    expect(differ).toBeGreaterThan(0);
  }, 60_000);
});
