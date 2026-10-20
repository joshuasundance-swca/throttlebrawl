import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, terrainAt, type BakedTerrainPatch } from '../index';
import { planTerrainTrees } from './terrain-trees';

function ground(y: number, surface: 'grass' | 'water' = 'grass'): BakedTerrainPatch {
  return {
    surface,
    vertices: [
      [-120, y, -650],
      [-120, y, 50],
      [120, y, -650],
      [120, y, 50],
    ],
    triangles: [
      [0, 1, 2],
      [2, 1, 3],
    ],
  };
}

function road(patches?: BakedTerrainPatch[], tag = 'rural') {
  const bundle = fixtureNetwork([{ id: 'country', lengthM: 600, kappa: 0, grade: 0 }]);
  bundle.roads[0]!.tags = [{ s0: 0, s1: 600, side: 'both', tag }];
  return createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, ...(patches ? { terrain: { patches } } : {}) },
  });
}

describe('physical trees on authored rural land', () => {
  it.each([-8, 4])('roots real trees on dry land at world height %s, not the reference road', (y) => {
    const network = road([ground(y)]);
    const plan = planTerrainTrees(network, 7);
    expect(plan.items.length).toBeGreaterThan(0);
    for (const tree of plan.items) {
      expect(terrainAt(network.terrain, tree.x, tree.z)?.surface).toBe('grass');
      expect(tree.baseY).toBeCloseTo(y, 6);
      expect(tree.scale).toBeGreaterThan(0);
      expect(tree.topY).toBeGreaterThan(tree.baseY);
      expect(plan.near(tree.x, tree.z, 0)).toContain(tree);
      // World discovery intentionally takes no edge: a neighboring-road projection cannot hide it.
      expect(plan.near(tree.x + 0.1, tree.z, 0.2)).toContain(tree);
      expect(plan.near(tree.x + 1000, tree.z, 1)).not.toContain(tree);
    }
  });

  it('keeps missing terrain, water, holes and submerged land free of physical trees', () => {
    for (const network of [
      road(),
      road([]),
      road([ground(0, 'water')]),
      road([ground(-2), ground(1, 'water')]),
    ]) {
      expect(planTerrainTrees(network, 7).items).toEqual([]);
    }
  });

  it('does not invent this rural tree cohort on other themes', () => {
    for (const tag of ['headlands', 'forest', 'palms']) {
      expect(planTerrainTrees(road([ground(-4)], tag), 7).items).toEqual([]);
    }
  });

  it('rejects a root with dry centre but uncovered rim, and a steep source footprint', () => {
    const tree = planTerrainTrees(road([ground(-4)]), 7).items[0]!;
    const narrow: BakedTerrainPatch = {
      surface: 'grass',
      vertices: [
        [tree.x - 0.05, -4, tree.z - 0.05],
        [tree.x - 0.05, -4, tree.z + 0.05],
        [tree.x + 0.05, -4, tree.z - 0.05],
        [tree.x + 0.05, -4, tree.z + 0.05],
      ],
      triangles: [
        [0, 1, 2],
        [2, 1, 3],
      ],
    };
    const strip = road([narrow]);
    expect(terrainAt(strip.terrain, tree.x, tree.z)?.surface).toBe('grass');
    expect(planTerrainTrees(strip, 7).items).toEqual([]);
    const slope = ground(-4);
    const steep = { ...slope, vertices: slope.vertices.map(([x, y, z]) => [x, y + x * 2, z] as const) };
    expect(planTerrainTrees(road([steep]), 7).items).toEqual([]);
  });

  it('keeps placement deterministic without consuming a simulation random stream', () => {
    const network = road([ground(-4)]);
    const first = planTerrainTrees(network, 7).items;
    expect(first.length).toBeGreaterThan(0);
    expect(planTerrainTrees(network, 7).items).toEqual(first);
    const other = planTerrainTrees(network, 8).items;
    expect(other).not.toEqual(first);
    expect(planTerrainTrees(network, 7).items).toEqual(first);
  });

  it('keeps whole crowns and a recovery strip clear of another road, including a wide carriageway', () => {
    const bundle = fixtureNetwork([
      { id: 'country', lengthM: 600, kappa: 0 },
      {
        id: 'beside',
        lengthM: 600,
        kappa: 0,
        lanes: [{ id: 'wide', dCenterM: 0, widthM: 80, direction: 1, kind: 'drive' }],
      },
    ]);
    bundle.roads[0]!.tags = [{ s0: 0, s1: 600, side: 'both', tag: 'rural' }];
    const columns = bundle.roads[1]!.samples.data;
    bundle.roads[1]!.samples.data = {
      ...columns,
      x: columns['x']!.map((x) => x + 65),
      z: columns['z']!.map((z) => z + 600),
    };
    const network = createRoadNetwork({
      ...bundle,
      network: { ...bundle.network, terrain: { patches: [ground(0)] } },
    });
    const trees = planTerrainTrees(network, 7).items;
    expect(trees.length).toBeGreaterThan(0);
    // Independent straight-road geometry: it doesn't call the planner's lane finder.
    const violates = (x: number, scale: number) => Math.abs(x - 65) < 40 + 8 + 4.8 * scale;
    expect(trees.filter((t) => violates(t.x, t.scale))).toEqual([]);
    expect(violates(65, 1), 'a deliberately planted tree in the other lane must fail this detector').toBe(
      true,
    );
    const out = [trees[0]!];
    expect(planTerrainTrees(network, 7).near(10000, 10000, 0, out)).toBe(out);
    expect(out).toEqual([]);
  });
});
