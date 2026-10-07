// The drawn land as the structure plans read it (road/land.ts `landReachOf`), on the networks beyond the downtowns'
// (src/render/land-reach.test.ts holds Portland and San Francisco's downtown): Old Town's street fronts
// (road/structures/oldtown.ts) stand only where their whole depth is on it, and the second row reaches 33 m past
// the sidewalk, so the rule must be render's own (road-mesh.ts `buildRoadScene`, `RoadScene.landReach`) at every
// sample, or a plan would stand a house where render draws no ground (or leave a lot empty where it does).
import { describe, expect, it } from 'vitest';
import { landReachOf } from '../src/road/land';
import { createFlatLook } from '../src/render/look';
import { buildRoadScene } from '../src/render/road-mesh';
import { print, track } from '../src/render/structures.test-util';

const look = createFlatLook();

/**
 * The networks it is held on: every one with Old Town on it, and one of each other kind of land render lays:
 * seawalls and a lake bank (the waterfront, Chuckanut and Samish), loops and stacked roads (the hills), bridges and
 * rails (the Seven Mile), and plain Keys roads.
 */
const NETWORKS = [
  'osm-keys-duval',
  'osm-keys-key-west',
  'keys-m1',
  'osm-keys-seven-mile',
  'osm-pnw-chuckanut',
  'osm-pnw-samish',
  'sf-hills',
  'sf-waterfront',
];

describe('the land a structure plan reads is the land render draws (road/land.ts)', () => {
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
            if (Math.abs(got - want) > 1e-3)
              off.push(`${e.id} side ${side} s ${s}: drawn ${want}, planned ${got}`);
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
