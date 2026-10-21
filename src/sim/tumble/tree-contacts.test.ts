import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, terrainAt, type RoadNetwork } from '../../road';
import { planTerrainTrees, trunkRadiusAt, type TerrainTree } from '../../road/structures/terrain-trees';
import { centre, makeCluster, stepCluster, type ClusterKind } from './rig';

function fixture(height = 7.1, terrain = true) {
  const bundle = fixtureNetwork([{ id: 'rural', lengthM: 500, kappa: 0 }]);
  return createRoadNetwork({
    ...bundle,
    network: {
      ...bundle.network,
      ...(terrain
        ? {
            terrain: {
              patches: [
                {
                  surface: 'grass' as const,
                  vertices: [
                    [-1000, height - 80, -500],
                    [-1000, height - 80, 0],
                    [1000, height + 80, -500],
                    [1000, height + 80, 0],
                  ] as const,
                  triangles: [
                    [0, 1, 2],
                    [2, 1, 3],
                  ] as const,
                },
              ],
            },
          }
        : {}),
    },
    roads: bundle.roads.map((r) => ({
      ...r,
      barriers: [],
      tags: [{ tag: 'rural', side: 'both' as const, s0: 0, s1: 500 }],
    })),
  });
}

function treeOf(road: RoadNetwork) {
  const plan = planTerrainTrees(road, 19);
  const tree = plan.items.find((t) => t.s > 10 && t.s < 490);
  expect(tree, 'fixture has a source-grounded rural trunk away from its ends').toBeDefined();
  return { plan, tree: tree! };
}

function crossing(kind: ClusterKind, tree: TerrainTree, height: number, speed = 36) {
  return makeCluster(
    kind,
    { x: tree.x - 2, y: height, z: tree.z },
    { fx: 1, fz: 0, rx: 0, rz: 1 },
    { x: speed, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    tree.edge,
  );
}

function outsideTrunk(c: ReturnType<typeof crossing>, tree: TerrainTree) {
  for (const q of c.p) {
    if (q.y < tree.baseY || q.y > tree.topY) continue;
    expect(Math.hypot(q.x - tree.x, q.z - tree.z)).toBeGreaterThanOrEqual(trunkRadiusAt(tree, q.y) - 1e-7);
  }
}

function linkErrors(c: ReturnType<typeof crossing>, original: ReturnType<typeof crossing>): number[] {
  const errors: number[] = [];
  for (let i = 0; i < c.p.length; i++) {
    for (let j = i + 1; j < c.p.length; j++) {
      if (c.kind === 'rider' && j !== i + 1) continue;
      const a = c.p[i]!;
      const b = c.p[j]!;
      const oa = original.p[i]!;
      const ob = original.p[j]!;
      errors.push(
        Math.abs(
          Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - Math.hypot(oa.x - ob.x, oa.y - ob.y, oa.z - ob.z),
        ),
      );
    }
  }
  return errors;
}

describe('crash clusters against source-rooted rural trunks', () => {
  it.each(['rider', 'bike'] as const)(
    'stops a fast %s crossing, solves links and rests on real terrain',
    (kind) => {
      const road = fixture();
      const { plan, tree } = treeOf(road);
      const c = crossing(kind, tree, tree.baseY + 0.1, 240);
      const original = structuredClone(c);
      stepCluster(road, c, 1 / 60, 1, true, undefined, true, plan);
      expect(centre(c.p).x).toBeLessThan(tree.x);
      expect(c.p.some((q) => q.vx < 0)).toBe(true);
      outsideTrunk(c, tree);
      expect(Math.max(...linkErrors(c, original))).toBeLessThan(0.1);
      for (let tick = 0; tick < 180; tick++) {
        stepCluster(road, c, 1 / 60, 1, true, undefined, true, plan);
        outsideTrunk(c, tree);
        expect(Math.max(...linkErrors(c, original))).toBeLessThan(0.1);
        for (const q of c.p) expect(q.y).toBeGreaterThanOrEqual(terrainAt(road.terrain, q.x, q.z)!.y - 1e-7);
      }
      expect(Math.min(...c.p.map((q) => q.y - terrainAt(road.terrain, q.x, q.z)!.y))).toBeLessThan(0.06);
      expect(c.overboard).toBe(false);
      expect(c.splashed).toBe(false);
    },
  );

  it.each([7.1, -14.3])('uses the absolute trunk height rooted on terrain at %s', (height) => {
    const road = fixture(height);
    const { plan, tree } = treeOf(road);
    const c = crossing('rider', tree, tree.baseY + 1, 240);
    stepCluster(road, c, 1 / 60, 0, true, undefined, true, plan);
    expect(centre(c.p).x).toBeLessThan(tree.x);
    outsideTrunk(c, tree);
  });

  it('expels a cluster initially overlapping the central trunk without entering the ground', () => {
    const road = fixture();
    const { plan, tree } = treeOf(road);
    const c = crossing('rider', tree, tree.baseY + 0.1, 0);
    for (const q of c.p) q.x = tree.x;
    stepCluster(road, c, 1 / 60, 1, true, undefined, true, plan);
    outsideTrunk(c, tree);
    for (const q of c.p) expect(q.y).toBeGreaterThanOrEqual(terrainAt(road.terrain, q.x, q.z)!.y);
  });

  it('catches downward motion on the finite trunk top without treating the crown as solid', () => {
    const road = fixture();
    const { plan, tree } = treeOf(road);
    const c = crossing('rider', tree, tree.topY + 1, 0);
    for (const q of c.p) {
      q.x = tree.x;
      q.vy = -240;
    }
    stepCluster(road, c, 1 / 60, 0, true, undefined, true, plan);
    expect(Math.min(...c.p.map((q) => q.y))).toBeGreaterThanOrEqual(tree.topY - 1e-7);
    expect(c.p.some((q) => q.vy > 0)).toBe(true);
  });

  it.each(['above', 'below', 'aside', 'taper'] as const)(
    'leaves a clear %s trajectory unchanged',
    (where) => {
      const road = fixture();
      const { plan, tree } = treeOf(road);
      const c = crossing(
        'rider',
        tree,
        where === 'above' ? tree.topY + 1 : where === 'below' ? tree.baseY - 4 : tree.topY - 1.5,
        240,
      );
      if (where === 'aside') for (const q of c.p) q.z += 3;
      if (where === 'taper') {
        const radius = trunkRadiusAt(tree, tree.topY - 0.05);
        const baseRadius = trunkRadiusAt(tree, tree.baseY);
        for (const q of c.p) q.z += (radius + baseRadius) / 2;
      }
      const control = structuredClone(c);
      stepCluster(road, c, 1 / 60, 0, true, undefined, true, plan);
      stepCluster(road, control, 1 / 60, 0, true, undefined, true);
      expect(c).toEqual(control);
    },
  );

  it('preserves no-tree and legacy trajectories and holds still at zero time scale', () => {
    const road = fixture();
    const { plan, tree } = treeOf(road);
    const c = crossing('bike', tree, tree.baseY + 1, 240);
    const held = structuredClone(c);
    stepCluster(road, c, 0, 1, true, undefined, true, plan);
    expect(c).toEqual(held);
    for (const network of [road, fixture(0, false)]) {
      const a = crossing('rider', tree, tree.baseY + 1);
      const b = structuredClone(a);
      const empty = planTerrainTrees(fixture(0, false), 19);
      for (let tick = 0; tick < 10; tick++) {
        stepCluster(network, a, 1 / 60, 1, true, undefined, true, network.terrain ? empty : plan);
        stepCluster(network, b, 1 / 60, 1, true, undefined, true);
      }
      expect(a).toEqual(b);
    }
  });

  it('replays identically after unrelated warm spatial queries', () => {
    const road = fixture();
    const { plan, tree } = treeOf(road);
    const a = crossing('bike', tree, tree.baseY + 1, 240);
    const b = structuredClone(a);
    for (let tick = 0; tick < 30; tick++) {
      stepCluster(road, a, 1 / 60, 1, true, undefined, true, plan);
      plan.near(tree.x + 100, tree.z + 100, 10);
      stepCluster(road, b, 1 / 60, 1, true, undefined, true, plan);
      expect(a).toEqual(b);
    }
  });
});
