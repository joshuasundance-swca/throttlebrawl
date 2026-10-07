// What stands at the road's edge and what lies past it (road/beyond.ts; the maintainer, 2026-10-06:
// "consistent physics and gameplay is important here so players know what to expect"). The sim's use
// is in sim/riders/gap.test.ts and tests/sim/over-barrier.test.ts; every real road is swept in
// tests/sim/over-barrier-roads.test.ts.
import { describe, expect, it } from 'vitest';
import {
  beyondAt,
  BUILDING_FRONT_TAGS,
  courseEdgeTopAt,
  drawnEdgeAt,
  EDGE_TOP_BY_TAG,
  edgeTopAt,
  GROUND_EDGE_TOP_M,
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

describe('the honest edges (2026-10-06): what is drawn at a band edge, and what a flight must clear there', () => {
  const at = (barriers: readonly BakedBarrier[], tags: readonly BakedTag[]) => {
    const r = road(barriers, tags);
    return { drawn: drawnEdgeAt(r, 0, 100, 'right'), top: courseEdgeTopAt(r, 0, 100, 'right') };
  };

  it('nothing at a soft edge or a bare hard edge with ground past it: open, cleared at any height', () => {
    // Soft ground runs on (palms, a town's kerb): nothing stands.
    expect(at([], [tag('palms')])).toEqual({ drawn: null, top: 0 });
    expect(at([], [tag('town')])).toEqual({ drawn: null, top: 0 });
    // A side no land tag covers, on a road with tags, and nothing past it but ground: a connector's side.
    expect(at([], [tag('palms', 'left')])).toEqual({ drawn: null, top: 0 });
    // Control: the old rule held it at any height (edgeTopAt Infinity), the invisible wall this replaces.
    expect(edgeTopAt(road([], [tag('palms', 'left')]), 0, 100, 'right')).toBe(Infinity);
  });

  it('what stands is named and cleared above its drawn top: barriers, rails, parapets, ferns and fences', () => {
    expect(at([bar('rail', 1)], [tag('towers')])).toEqual({ drawn: 'barrier', top: 1 });
    expect(at([bar('wall', 1.3)], [])).toEqual({ drawn: 'barrier', top: 1.3 });
    expect(at([], [tag('bluff')])).toEqual({ drawn: 'wall', top: 1.26 });
    expect(at([], [tag('interstate')])).toEqual({ drawn: 'wall', top: 0.76 });
    expect(at([], [tag('forest')])).toEqual({ drawn: 'brush', top: GROUND_EDGE_TOP_M.brush });
    expect(at([], [tag('gardens')])).toEqual({ drawn: 'fence', top: GROUND_EDGE_TOP_M.fence });
    expect(at([], [tag('water-open')])).toEqual({ drawn: 'water', top: 0 });
    expect(at([], [tag('mangrove')])).toEqual({ drawn: null, top: 0 });
  });

  it('a building front is a front, a wall at any height to the road (the sim meets planned ones itself)', () => {
    for (const t of BUILDING_FRONT_TAGS)
      expect(at([], [tag(t)]), t).toEqual({ drawn: 'front', top: Infinity });
  });

  it("a bare deck's edge over a drop holds on the ground (the drop) and is cleared in the air", () => {
    // A bridge with no land and no water under it, and no rail: the deck's edge.
    expect(at([], [tag('bridge')])).toEqual({ drawn: 'drop', top: 0 });
    expect(pastAt(road([], [tag('bridge')]), 0, 100, 'right')).toBe('drop');
  });

  it('a listed rail clipped for another road has no contact top, while its visible side still holds', () => {
    const a = fixtureNetwork([{ id: 'a', lengthM: 400, kappa: 0 }]);
    const b = fixtureNetwork([{ id: 'b', lengthM: 400, kappa: 0 }]);
    const ra = a.roads[0]!;
    const rb = b.roads[0]!;
    const r = createRoadNetwork({
      network: {
        ...a.network,
        roads: ['a', 'b'],
        junctions: [
          ...a.network.junctions,
          ...b.network.junctions.map((j) => ({ ...j, id: `b-${j.id}`, x: j.x + 8 })),
        ],
      },
      roads: [
        { ...ra, barriers: [bar('rail', 1, 'both')] },
        {
          ...rb,
          from: `b-${rb.from}`,
          to: `b-${rb.to}`,
          samples: {
            ...rb.samples,
            data: { ...rb.samples.data, x: rb.samples.data['x']!.map((x) => x + 8) },
          },
        },
      ],
    });
    expect(drawnEdgeAt(r, 0, 100, 'right')).toBeNull();
    expect(courseEdgeTopAt(r, 0, 100, 'right')).toBe(0);
    expect(drawnEdgeAt(r, 0, 100, 'left')).toBe('barrier');
    expect(courseEdgeTopAt(r, 0, 100, 'left')).toBe(1);
  });
});

describe('beyondAt: what a rider out past the edge meets is what the road scene draws there', () => {
  /** What lies `k` m past the right band edge at s 100, and its floor over the deck there. */
  const at = (barriers: readonly BakedBarrier[], tags: readonly BakedTag[], k: number) => {
    const r = road(barriers, tags);
    const deck = r.surfaceHeight(0, 100, r.vergeAt(0, 100, 'right').dOuter);
    const b = beyondAt(r, 0, 100, 'right', k);
    return { past: b.past, over: Math.round((b.floorY - deck) * 100) / 100 };
  };

  it("the bluff's shelf is ground at the road's height out to its lip; past it the cliff, a drop to the water", () => {
    // Chuckanut's bay side: a 4 m band to the parapet, the land drawn 10 m past the verge (render/scenery.ts
    // BLUFF_LAND_M), so 6.6 m of it past the parapet, then the sheer drop.
    for (const k of [0.5, 3, 6.5])
      expect(at([], [tag('bluff')], k), `+${k}`).toEqual({ past: 'ground', over: -0.09 });
    expect(at([], [tag('bluff')], 7).past).toBe('drop');
    expect(beyondAt(road([], [tag('bluff')]), 0, 100, 'right', 12)).toEqual({ past: 'drop', floorY: 0 });
    // The tags alone (the old rule) say a drop at once past the parapet.
    expect(pastAt(road([], [tag('bluff')]), 0, 100, 'right')).toBe('drop');
  });

  it("a deck's 0.55 m lip outside its rail holds no bike: past the rail, the water", () => {
    const bridge = [tag('bridge'), tag('water-open')];
    expect(at([bar('rail', 1)], bridge, 0.3).past).toBe('water');
    expect(at([bar('rail', 1)], bridge, 5).past).toBe('water');
  });

  it("a mangrove key's land drawn past its water edge is ground; where nothing is drawn the tags decide", () => {
    expect(at([], [tag('mangrove')], 2)).toEqual({ past: 'ground', over: -0.09 });
    // A wall on a side no land tag covers: nothing is drawn past it at the road's height (the tags say ground): a drop.
    expect(at([bar('wall', 1.2)], [tag('palms', 'left')], 2).past).toBe('drop');
  });
});
