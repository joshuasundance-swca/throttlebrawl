// What stands at the road's edge and what lies past it (road/beyond.ts; the maintainer, 2026-10-06:
// "consistent physics and gameplay is important here so players know what to expect"). The sim's use
// is in sim/riders/gap.test.ts and tests/sim/over-barrier.test.ts; every real road is swept in
// tests/sim/over-barrier-roads.test.ts.
import { describe, expect, it } from 'vitest';
import {
  BUILDING_FRONT_TAGS,
  EDGE_TOP_BY_TAG,
  edgeTopAt,
  pastAt,
  WATER_LEVEL_M,
  waterLevelOf,
} from './beyond';
import { VERGE_BY_TAG, vergeTagAt } from './cross-section';
import {
  createRoadNetwork,
  fixtureNetwork,
  type BakedBarrier,
  type BakedNetworkBundle,
  type BakedTag,
} from './index';

/** A straight 400 m road `a` with these barriers and tags, on network `id`. */
function road(barriers: readonly BakedBarrier[], tags: readonly BakedTag[], id = 'fixture') {
  const bundle = JSON.parse(
    JSON.stringify(fixtureNetwork([{ id: 'a', lengthM: 400, kappa: 0 }], id)),
  ) as BakedNetworkBundle;
  const r = bundle.roads[0] as unknown as { barriers: BakedBarrier[]; tags: BakedTag[] };
  r.barriers = [...barriers];
  r.tags = [...tags];
  return createRoadNetwork(bundle);
}

const tag = (t: string, side: BakedTag['side'] = 'right', s0 = 0, s1 = 400): BakedTag => ({
  s0,
  s1,
  side,
  tag: t,
});
const bar = (kind: 'rail' | 'wall', heightM: number, side: BakedBarrier['side'] = 'right'): BakedBarrier => ({
  s0: 0,
  s1: 400,
  side,
  kind,
  heightM,
});

describe('edgeTopAt: how high what stands at the band edge is', () => {
  it("a barrier's own height, whatever the tags say", () => {
    expect(edgeTopAt(road([bar('rail', 1)], [tag('towers')]), 0, 100, 'right')).toBe(1);
    expect(edgeTopAt(road([bar('wall', 1.3)], [tag('water-open')]), 0, 100, 'right')).toBe(1.3);
  });

  it('nothing at a water edge (0), a ground edge is not a barrier (null)', () => {
    expect(edgeTopAt(road([], [tag('water-open')]), 0, 100, 'right')).toBe(0);
    expect(edgeTopAt(road([], [tag('mangrove')]), 0, 100, 'right')).toBe(0);
    expect(edgeTopAt(road([], [tag('palms')]), 0, 100, 'right')).toBeNull();
    expect(edgeTopAt(road([], [tag('forest')]), 0, 100, 'right')).toBeNull();
  });

  it("a building front is a wall at any height; the bluff's parapet and the interstate's rail are as drawn", () => {
    expect(edgeTopAt(road([], [tag('shopfronts')]), 0, 100, 'right')).toBe(Infinity);
    expect(edgeTopAt(road([], [tag('key-oldtown')]), 0, 100, 'right')).toBe(Infinity);
    expect(edgeTopAt(road([], [tag('bluff')]), 0, 100, 'right')).toBe(1.26);
    expect(edgeTopAt(road([], [tag('interstate'), tag('forest')]), 0, 100, 'right')).toBe(0.76);
    // A side no tag covers, on a road with tags (nothing drawn there): the old wall, any height.
    expect(edgeTopAt(road([], [tag('palms', 'left')]), 0, 100, 'right')).toBe(Infinity);
  });

  it('every land tag whose band ends in a hard edge is named: a building front or a drawn top', () => {
    const hard = VERGE_BY_TAG.filter(([, v]) => v.edge === 'hard').map(([t]) => t);
    const unnamed = hard.filter((t) => !BUILDING_FRONT_TAGS.has(t) && !Object.hasOwn(EDGE_TOP_BY_TAG, t));
    console.log(`[examined] ${hard.length} hard-edged tags: ${hard.join(', ')}`);
    expect(hard.length).toBeGreaterThan(5);
    expect(unnamed).toEqual([]);
    for (const t of [...BUILDING_FRONT_TAGS, ...Object.keys(EDGE_TOP_BY_TAG)])
      expect(hard, `${t} is a hard-edged tag`).toContain(t);
  });

  it('vergeTagAt names the tag that gave the band (the best-ranked land tag), or none', () => {
    const r = { tags: [tag('forest'), tag('bluff')], barriers: [] };
    expect(vergeTagAt(r, 'right', 100)).toBe('bluff');
    expect(vergeTagAt(r, 'left', 100)).toBeNull();
    expect(vergeTagAt({ tags: [tag('bluff'), tag('water-open')] }, 'right', 100)).toBeNull();
    expect(vergeTagAt({ tags: [tag('bluff')], barriers: [bar('wall', 1)] }, 'right', 100)).toBeNull();
  });
});

describe('pastAt: what lies past the edge', () => {
  it('the sea where a water tag says so, whatever stands at the edge', () => {
    expect(pastAt(road([bar('wall', 1.3)], [tag('bridge'), tag('water-open')]), 0, 100, 'right')).toBe(
      'water',
    );
    expect(pastAt(road([], [tag('promenade')]), 0, 100, 'right')).toBe('water');
  });

  it('a drop past the bluff, a bridge with no water tagged, and any rail (rails stand only on bridges and drops)', () => {
    expect(pastAt(road([], [tag('bluff')]), 0, 100, 'right')).toBe('drop');
    expect(pastAt(road([bar('wall', 0.81)], [tag('bridge')]), 0, 100, 'right')).toBe('drop');
    expect(pastAt(road([bar('rail', 1)], []), 0, 100, 'right')).toBe('drop');
  });

  it('ground otherwise: a wall on land, the land tags', () => {
    expect(pastAt(road([bar('wall', 1.2)], []), 0, 100, 'right')).toBe('ground');
    expect(pastAt(road([], [tag('interstate'), tag('forest')]), 0, 100, 'right')).toBe('ground');
    expect(pastAt(road([], [tag('palms')]), 0, 100, 'left')).toBe('ground');
  });
});

describe("waterLevelOf: the network's water, and a drop's floor", () => {
  it("is Lake Samish's 82.85 m there and sea level elsewhere", () => {
    expect(WATER_LEVEL_M['osm-pnw-samish']).toBe(82.85);
    expect(waterLevelOf(road([], [], 'osm-pnw-samish'))).toBe(82.85);
    expect(waterLevelOf(road([], [], 'osm-keys-seven-mile'))).toBe(0);
    expect(waterLevelOf(road([], []))).toBe(0);
  });
});
