// The road's gap queries (playtest 3, T3.1): where there is no surface, where a rider who fell
// through one wakes, and the jumpable walls. The sim's use of them is in sim/riders/gap.test.ts and
// sim/tumble/gap.test.ts.
import { describe, expect, it } from 'vitest';
import { gapAt, gapById, gapFarSide, jumpableWallAt, nearestOnEdges } from './gap';
import { createRoadNetwork, fixtureNetwork, type BakedFeature, type BakedNetworkBundle } from './index';

function withFeatures(
  features: readonly BakedFeature[],
  specs = [{ id: 'a', lengthM: 400, kappa: 0 }],
  barriers: readonly unknown[] = [],
): ReturnType<typeof createRoadNetwork> {
  const bundle = JSON.parse(JSON.stringify(fixtureNetwork(specs))) as BakedNetworkBundle;
  const road = bundle.roads[0] as unknown as { features: BakedFeature[]; barriers: unknown[] };
  road.features = [...features];
  road.barriers = [...barriers];
  return createRoadNetwork(bundle);
}

const gap = (
  id: string,
  s0: number,
  s1: number,
  d0 = -8,
  d1 = 8,
  params?: Record<string, unknown>,
): BakedFeature => ({
  kind: 'gap',
  id,
  s0,
  s1,
  d0,
  d1,
  ...(params ? { params } : {}),
});

describe('gapAt', () => {
  const road = withFeatures([
    { kind: 'roadsideZone', id: 'z', s0: 0, s1: 400, d0: 6, d1: 12 },
    gap('one', 100, 130),
    gap('lane', 200, 220, 0, 8),
  ]);

  it('finds the gap whose box holds (s, d), edges included, and nothing outside it', () => {
    expect(gapAt(road, 0, 100, 0)?.id).toBe('one');
    expect(gapAt(road, 0, 130, -8)?.id).toBe('one');
    expect(gapAt(road, 0, 99.99, 0)).toBeNull();
    expect(gapAt(road, 0, 130.01, 0)).toBeNull();
    expect(gapAt(road, 0, 210, 1)?.id).toBe('lane');
    expect(gapAt(road, 0, 210, -1)).toBeNull();
  });

  it('ignores other feature kinds, and an edge that does not exist', () => {
    expect(gapAt(road, 0, 50, 8)).toBeNull();
    expect(gapAt(road, 7, 100, 0)).toBeNull();
    expect(gapById(road, 0, 'lane')?.s0).toBe(200);
    expect(gapById(road, 0, 'z')).toBeNull();
  });
});

describe('gapFarSide', () => {
  it('is respawnPastM past the end the rider was heading for, on its own road', () => {
    const f = gap('one', 100, 130);
    const road = withFeatures([f]);
    expect(gapFarSide(road, 0, f, 1, 1.7)).toEqual({ edge: 0, s: 140, d: 1.7, dir: 1 });
    expect(gapFarSide(road, 0, f, -1, -1.7)).toEqual({ edge: 0, s: 90, d: -1.7, dir: -1 });
    const far = gap('far', 100, 130, -8, 8, { respawnPastM: 25 });
    expect(gapFarSide(road, 0, far, 1, 0).s).toBe(155);
  });

  it('carries across the road end onto the next road, and stops at a dead end', () => {
    const f = gap('end', 390, 396);
    const road = withFeatures(
      [f],
      [
        { id: 'a', lengthM: 400, kappa: 0 },
        { id: 'b', lengthM: 300, kappa: 0 },
      ],
    );
    expect(gapFarSide(road, 0, f, 1, 1.7)).toMatchObject({ edge: road.edgeIndex('b'), dir: 1 });
    expect(gapFarSide(road, 0, f, 1, 1.7).s).toBeCloseTo(6, 6);
    const lone = withFeatures([f]);
    expect(gapFarSide(lone, 0, f, 1, 1.7).s).toBe(400);
  });

  it('never wakes the rider inside another gap: it walks on past it', () => {
    const a = gap('a', 100, 130);
    const b = gap('b', 135, 150);
    const road = withFeatures([a, b]);
    expect(gapFarSide(road, 0, a, 1, 0).s).toBe(160);
  });
});

describe('nearestOnEdges', () => {
  it('is the nearest point on the given edges only, with its offset', () => {
    const road = withFeatures(
      [],
      [
        { id: 'a', lengthM: 200, kappa: 0 },
        { id: 'b', lengthM: 200, kappa: 0.004 },
      ],
    );
    const w = road.toWorld(0, 120, 3, 0);
    const p = nearestOnEdges(road, [0], w.x, w.z);
    expect(p?.edge).toBe(0);
    expect(p?.s).toBeCloseTo(120, 3);
    expect(p?.d).toBeCloseTo(3, 3);
    // A point by road b, asked about road a only, lands on a's nearest end.
    const wb = road.toWorld(1, 150, 0, 0);
    const onA = nearestOnEdges(road, [0], wb.x, wb.z);
    expect(onA?.edge).toBe(0);
    expect(onA?.s).toBeCloseTo(200, 3);
    expect(nearestOnEdges(road, [1, 0], wb.x, wb.z)?.edge).toBe(1);
    expect(nearestOnEdges(road, [], 0, 0)).toBeNull();
  });
});

describe('jumpableWallAt', () => {
  it('is the jumpable wall on that side at s, or null', () => {
    const road = withFeatures([], undefined, [
      { s0: 50, s1: 150, side: 'right', kind: 'wall', heightM: 1.2, jumpable: true },
      { s0: 0, s1: 400, side: 'left', kind: 'wall', heightM: 1 },
    ]);
    expect(jumpableWallAt(road, 0, 100, 'right')?.heightM).toBe(1.2);
    expect(jumpableWallAt(road, 0, 160, 'right')).toBeNull();
    expect(jumpableWallAt(road, 0, 100, 'left')).toBeNull();
  });
});
