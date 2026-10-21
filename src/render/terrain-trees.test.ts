import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Matrix4, Raycaster, Vector3 } from 'three';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { planTerrainTrees, trunkRadiusAt, RURAL_TRUNK } from '../road/structures/terrain-trees';
import { TerrainTrees } from './terrain-trees';
import { createFlatLook } from './look';
import { deciduousGeometry } from './deciduous';

function countryside(y: number) {
  const bundle = fixtureNetwork([{ id: 'country', lengthM: 600, kappa: 0 }]);
  bundle.roads[0]!.tags = [{ s0: 0, s1: 600, side: 'both', tag: 'rural' }];
  return createRoadNetwork({
    ...bundle,
    network: {
      ...bundle.network,
      terrain: {
        patches: [
          {
            surface: 'grass',
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
          },
        ],
      },
    },
  });
}

describe('source-rooted rural tree drawing', () => {
  it('keeps the actual central trunk caps and taper within the physical profile', () => {
    const geometry = deciduousGeometry();
    const p = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const caps: { y: number; r: number }[] = [];
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (Math.abs(normal.getY(i)) > 0.999 && r <= RURAL_TRUNK.baseRadiusM + 1e-6)
        caps.push({ y: p.getY(i), r });
    }
    expect(caps.length).toBeGreaterThan(0);
    expect(Math.min(...caps.map((c) => c.y))).toBe(0);
    expect(Math.max(...caps.map((c) => c.y))).toBe(RURAL_TRUNK.heightM);
    expect(Math.max(...caps.filter((c) => c.y === 0).map((c) => c.r))).toBeCloseTo(
      RURAL_TRUNK.baseRadiusM,
      6,
    );
    expect(Math.max(...caps.filter((c) => c.y === RURAL_TRUNK.heightM).map((c) => c.r))).toBeCloseTo(
      RURAL_TRUNK.topRadiusM,
      6,
    );
    geometry.dispose();
  });
  it.each([-8, 4])('draws real tapered trunks at the shared world placements at height %s', (y) => {
    const road = countryside(y);
    const plan = planTerrainTrees(road, 7);
    expect(plan.items.length).toBeGreaterThan(0);
    const layer = new TerrainTrees(createFlatLook());
    layer.setRoad(road, 7);
    expect(layer.counts().placed).toBe(plan.items.length);
    for (const tree of plan.items) {
      layer.update(tree.x, tree.z, 0); // density/quality cannot remove a nearby physical trunk
      layer.root.updateMatrixWorld(true);
      for (const lift of [0.5, 3]) {
        const height = tree.baseY + lift * tree.scale;
        const ray = new Raycaster(new Vector3(tree.x + 2, height, tree.z), new Vector3(-1, 0, 0), 0, 4);
        const hit = ray.intersectObjects(
          layer.root.children.filter((o) => o.visible),
          false,
        )[0];
        expect(hit, 'a physical trunk must actually draw at its source height').toBeDefined();
        const radial = hit!.point.x - tree.x;
        expect(radial).toBeGreaterThan(trunkRadiusAt(tree, height) - 0.06);
        expect(radial).toBeLessThanOrEqual(trunkRadiusAt(tree, height) + 1e-5);
      }
    }
    // A real ghost-trunk detector: moving the drawing invalidates the same probe.
    const tree = plan.items[0]!;
    layer.root.position.y += 30;
    layer.root.updateMatrixWorld(true);
    const ray = new Raycaster(
      new Vector3(tree.x + 2, tree.baseY + 0.5 * tree.scale, tree.z),
      new Vector3(-1, 0, 0),
      0,
      4,
    );
    expect(
      ray.intersectObjects(
        layer.root.children.filter((o) => o.visible),
        false,
      ),
    ).toEqual([]);
    layer.dispose();
  });

  it('replaces seeds/roads and releases its own instance buffers, geometry and material', () => {
    const layer = new TerrainTrees(createFlatLook());
    const road = countryside(-4);
    layer.setRoad(road, 7);
    const meshes: InstancedMesh[] = [];
    layer.root.traverse((o) => {
      if (o instanceof InstancedMesh) meshes.push(o as InstancedMesh);
    });
    expect(meshes.length).toBeGreaterThan(0);
    const geometry = vi.spyOn(meshes[0]!.geometry, 'dispose');
    const material = meshes[0]!.material;
    expect(Array.isArray(material)).toBe(false);
    if (Array.isArray(material)) throw new Error('one shared material');
    const paint = vi.spyOn(material, 'dispose');
    const dispose = meshes.map((m) => vi.spyOn(m, 'dispose'));
    const old = new Matrix4();
    meshes[0]!.getMatrixAt(0, old);
    layer.setRoad(road, 8);
    expect(dispose.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(layer.counts().placed).toBe(planTerrainTrees(road, 8).items.length);
    layer.setRoad(createRoadNetwork(fixtureNetwork([{ id: 'legacy', lengthM: 600, kappa: 0 }])), 8);
    expect(layer.root.children).toEqual([]);
    expect(layer.counts().placed).toBe(0);
    layer.dispose();
    expect(geometry).toHaveBeenCalledOnce();
    expect(paint).toHaveBeenCalledOnce();
  });
});
