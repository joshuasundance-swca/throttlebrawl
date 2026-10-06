import { describe, expect, it } from 'vitest';
import { deriveVerge, lanesPerDirection, VERGE_BY_TAG } from './cross-section';
import { fixtureNetwork } from './fixture';
import { createRoadNetwork } from './network';
import type { BakedLaneSection, BakedNetworkBundle, BakedRoad } from './types';
import { lintRoad } from './validate';

// The W-Q cross-section contract: lanes per direction, a median, and verge bands per side, given in
// the road file or derived from its tags and barriers, so every existing road has ground beside it.

function withRoad(patch: Partial<BakedRoad>): { bundle: BakedNetworkBundle; road: BakedRoad } {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0 }]);
  const road = { ...(bundle.roads[0] as BakedRoad), ...patch };
  return { bundle: { ...bundle, roads: [road] }, road };
}

const SIX_LANES: BakedLaneSection = {
  s0: 0,
  lanes: [
    { id: 'L0', dCenterM: -13.75, widthM: 1.5, direction: -1, kind: 'shoulder' },
    { id: 'L3', dCenterM: -11, widthM: 4, direction: -1, kind: 'drive' },
    { id: 'L2', dCenterM: -7, widthM: 4, direction: -1, kind: 'drive' },
    { id: 'L1', dCenterM: -3, widthM: 4, direction: -1, kind: 'drive' },
    { id: 'R1', dCenterM: 3, widthM: 4, direction: 1, kind: 'drive' },
    { id: 'R2', dCenterM: 7, widthM: 4, direction: 1, kind: 'drive' },
    { id: 'R3', dCenterM: 11, widthM: 4, direction: 1, kind: 'drive' },
    { id: 'R0', dCenterM: 13.75, widthM: 1.5, direction: 1, kind: 'shoulder' },
  ],
  median: { widthM: 2, kind: 'kerb' },
};

describe('derived verges (no band in the road file)', () => {
  it('a road with no tags is palm land: a 4 m sand band that runs on', () => {
    expect(deriveVerge({}, 'left', 10)).toEqual({ widthM: 4, surface: 'sand', edge: 'soft' });
  });

  it('land tags pick their band, in the scenery theme order (palms beat forest)', () => {
    const tags = [
      { s0: 0, s1: 500, side: 'both' as const, tag: 'forest' },
      { s0: 200, s1: 300, side: 'right' as const, tag: 'palms' },
    ];
    expect(deriveVerge({ tags }, 'left', 250)).toEqual({ widthM: 6, surface: 'dirt', edge: 'brush' });
    expect(deriveVerge({ tags }, 'right', 250)).toEqual({ widthM: 4, surface: 'sand', edge: 'soft' });
    expect(deriveVerge({ tags: [{ s0: 0, s1: 9, side: 'both', tag: 'row-houses' }] }, 'right', 5)).toEqual({
      widthM: 2.5,
      surface: 'kerb',
      edge: 'hard',
    });
  });

  it('the sea is a water edge, and so is a causeway; a dry bridge is hard; a rail barrier is a rail', () => {
    const sea = [{ s0: 0, s1: 100, side: 'both' as const, tag: 'water-open' }];
    expect(deriveVerge({ tags: sea }, 'left', 50)).toEqual({ widthM: 0, surface: 'shoulder', edge: 'water' });
    const causeway = [{ s0: 0, s1: 100, side: 'both' as const, tag: 'causeway' }];
    expect(deriveVerge({ tags: causeway }, 'right', 50).edge).toBe('water');
    const dryBridge = [{ s0: 0, s1: 100, side: 'both' as const, tag: 'bridge' }];
    expect(deriveVerge({ tags: dryBridge }, 'right', 50)).toEqual({
      widthM: 0,
      surface: 'kerb',
      edge: 'hard',
    });
    const rail = [{ s0: 0, s1: 100, side: 'left' as const, kind: 'rail' as const, heightM: 1 }];
    expect(deriveVerge({ tags: sea, barriers: rail }, 'left', 50).edge).toBe('rail');
    expect(deriveVerge({ tags: sea, barriers: rail }, 'right', 50).edge).toBe('water');
    const wall = [{ s0: 0, s1: 100, side: 'both' as const, kind: 'wall' as const, heightM: 1 }];
    expect(deriveVerge({ tags: [], barriers: wall }, 'right', 50).edge).toBe('hard');
  });

  it('a side whose tags say nothing about the ground keeps the wall it had (no band)', () => {
    const tags = [{ s0: 0, s1: 100, side: 'right' as const, tag: 'forest' }];
    expect(deriveVerge({ tags }, 'left', 50)).toEqual({ widthM: 0, surface: 'kerb', edge: 'hard' });
    expect(deriveVerge({ tags: [{ s0: 0, s1: 100, side: 'both', tag: 'fog' }] }, 'left', 50).widthM).toBe(0);
  });

  it('every derived band stays inside the 24 m land strip render draws', () => {
    for (const [, v] of VERGE_BY_TAG) expect(v.widthM).toBeLessThanOrEqual(24);
  });
});

describe('network queries', () => {
  it('vergeAt places the band past the outermost lane, shoulder included', () => {
    const { bundle } = withRoad({ tags: [{ s0: 0, s1: 1000, side: 'both', tag: 'forest' }] });
    const net = createRoadNetwork(bundle);
    const left = net.vergeAt(0, 100, 'left');
    const right = net.vergeAt(0, 100, 'right');
    expect(left).toMatchObject({ side: 'left', dInner: -4.9, dOuter: -10.9, derived: true, surface: 'dirt' });
    expect(right).toMatchObject({ side: 'right', dInner: 4.9, dOuter: 10.9, edge: 'brush' });
  });

  it('a band in the road file wins over the derived one, per side', () => {
    const { bundle } = withRoad({
      tags: [{ s0: 0, s1: 1000, side: 'both', tag: 'forest' }],
      laneSections: [
        {
          s0: 0,
          lanes: (fixtureNetwork([{ id: 'x', lengthM: 10, kappa: 0 }]).roads[0] as BakedRoad).laneSections[0]
            ?.lanes as BakedLaneSection['lanes'],
          verges: { right: { widthM: 12, surface: 'gravel', edge: 'fence' } },
        },
      ],
    });
    const net = createRoadNetwork(bundle);
    expect(net.vergeAt(0, 10, 'right')).toMatchObject({
      widthM: 12,
      surface: 'gravel',
      edge: 'fence',
      derived: false,
    });
    expect(net.vergeAt(0, 10, 'left')).toMatchObject({ surface: 'dirt', derived: true });
  });

  it('groundAt: the road surface on the lanes, shoulder on a shoulder lane, the verge, then nothing', () => {
    const { bundle } = withRoad({ surface: 'dirt', tags: [{ s0: 0, s1: 1000, side: 'both', tag: 'beach' }] });
    const net = createRoadNetwork(bundle);
    expect(net.edges[0]?.surface).toBe('dirt');
    expect(net.groundAt(0, 50, 1)).toBe('dirt');
    expect(net.groundAt(0, 50, -4.5)).toBe('shoulder');
    expect(net.groundAt(0, 50, 8)).toBe('sand');
    expect(net.groundAt(0, 50, -10.8)).toBe('sand'); // a 6 m beach (run W-R)
    expect(net.groundAt(0, 50, 11.5)).toBeNull();
  });

  it('a road file without a surface is asphalt', () => {
    const net = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 100, kappa: 0 }]));
    expect(net.crossSectionAt(0, 10)).toMatchObject({
      surface: 'asphalt',
      lanesForward: 1,
      lanesOncoming: 1,
      median: null,
    });
  });

  it('crossSectionAt counts drive lanes per direction and carries the median', () => {
    const { bundle } = withRoad({ laneSections: [SIX_LANES] });
    const cs = createRoadNetwork(bundle).crossSectionAt(0, 500);
    expect(cs.lanesForward).toBe(3);
    expect(cs.lanesOncoming).toBe(3);
    expect(cs.median).toEqual({ widthM: 2, kind: 'kerb' });
    expect(lanesPerDirection(SIX_LANES.lanes)).toEqual({ forward: 3, oncoming: 3 });
  });
});

describe('the lint and the schema', () => {
  const rules = (road: BakedRoad) => lintRoad(road).filter((i) => i.rule === 'cross-section');

  it('passes a six-lane road with a median that fits its gap', () => {
    const { road } = withRoad({ laneSections: [SIX_LANES] });
    expect(rules(road)).toEqual([]);
  });

  it('flags a fourth lane in one direction, a median wider than the gap, and a rail with no rail barrier', () => {
    const lanes = [
      ...SIX_LANES.lanes,
      { id: 'R4', dCenterM: 17, widthM: 4, direction: 1 as const, kind: 'drive' as const },
    ];
    const { road } = withRoad({
      laneSections: [
        {
          s0: 0,
          lanes,
          median: { widthM: 5, kind: 'grass' },
          verges: { left: { widthM: 0, surface: 'shoulder', edge: 'rail' } },
        },
      ],
    });
    const found = rules(road).map((i) => i.pointer);
    expect(found).toEqual([
      '/laneSections/0/lanes',
      '/laneSections/0/median/widthM',
      '/laneSections/0/verges/left/edge',
    ]);
    const railed = {
      ...road,
      barriers: [{ s0: 0, s1: 1000, side: 'left' as const, kind: 'rail' as const, heightM: 1 }],
    };
    expect(rules(railed).map((i) => i.pointer)).not.toContain('/laneSections/0/verges/left/edge');
  });
});

describe('the Pacific Northwest places (run W-U)', () => {
  const on = (tag: string) => deriveVerge({ tags: [{ s0: 0, s1: 500, side: 'both', tag }] }, 'right', 100);

  it('a ferry deck runs 4.5 m of steel to the hull; a festival street 4 m of sidewalk to the shopfronts', () => {
    expect(on('ferry')).toEqual({ widthM: 4.5, surface: 'shoulder', edge: 'hard' });
    expect(on('festival')).toEqual({ widthM: 4, surface: 'kerb', edge: 'hard' });
  });

  it('a clear-cut is 16 m of open dirt that runs on, and beats the forest beside it', () => {
    expect(on('clearcut')).toEqual({ widthM: 16, surface: 'dirt', edge: 'soft' });
    const both = deriveVerge(
      {
        tags: [
          { s0: 0, s1: 500, side: 'both', tag: 'forest' },
          { s0: 0, s1: 500, side: 'both', tag: 'clearcut' },
        ],
      },
      'left',
      100,
    );
    expect(both.widthM).toBe(16);
  });
});

describe('an interstate has a wide paved shoulder that ends in a wall (playtest 4, P4-19, run C5)', () => {
  const tagged = (...names: string[]) => names.map((tag) => ({ s0: 0, s1: 500, side: 'both' as const, tag }));

  it('is 3 m of shoulder past the lanes, ending hard, and beats the forest beside it', () => {
    const alone = deriveVerge({ tags: tagged('forest', 'interstate') }, 'right', 100);
    expect(alone).toEqual({ widthM: 3, surface: 'shoulder', edge: 'hard' });
    // The control: the same road without the tag has the forest's 6 m of dirt and ferns, so the check can see a change.
    expect(deriveVerge({ tags: tagged('forest') }, 'right', 100)).toEqual({
      widthM: 6,
      surface: 'dirt',
      edge: 'brush',
    });
    // Either order of the tags, either side.
    expect(deriveVerge({ tags: tagged('interstate', 'forest') }, 'left', 100)).toEqual(alone);
  });

  it('is wider than the lanes own shoulder, and a barrier on the side still wins over it', () => {
    const lane = 1.5;
    expect(deriveVerge({ tags: tagged('interstate') }, 'left', 10).widthM).toBeGreaterThan(lane);
    const wall = [{ s0: 0, s1: 500, side: 'both' as const, kind: 'wall' as const, heightM: 0.9 }];
    expect(deriveVerge({ tags: tagged('interstate'), barriers: wall }, 'right', 100)).toEqual({
      widthM: 0,
      surface: 'kerb',
      edge: 'hard',
    });
  });
});
