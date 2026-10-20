import { Frustum, Matrix4, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { planTerrainTrees } from '../road/structures/terrain-trees';
import { firstSeed } from '../../tests/sim/batch';
import { ROUTES, stillSceneOf, track } from './scene-cost.test-util';

describe('physical terrain trees in the actual cost scene', () => {
  it('counts drawn trunks on shipped rural terrain and detects their omission', async () => {
    const candidates = ROUTES.map((r) => track(r.network)).filter(({ road }) => road.terrain);
    expect(candidates.length).toBeGreaterThan(0);
    const found = firstSeed(
      'source-rooted rural trees in cost scene',
      [1, 2, 3, 4],
      (seed) =>
        candidates
          .map(({ road }) => ({ road, tree: planTerrainTrees(road, seed).items[0] }))
          .find((p) => p.tree),
      (result) => result !== undefined,
    );
    const chosen = found.result;
    expect(chosen?.tree).toBeDefined();
    if (found.seed === null) throw new Error(found.summary);
    const tree = chosen!.tree!;
    const { scene } = await stillSceneOf(chosen!.road.id, found.seed);
    const camera = new PerspectiveCamera(62, 915 / 412, 0.3, 200);
    camera.position.set(tree.x + 15, tree.baseY + 5, tree.z + 15);
    camera.lookAt(tree.x, tree.baseY + 3, tree.z);
    camera.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    scene.update(camera.position.x, camera.position.z);
    const count = () =>
      [...scene.count(frustum)]
        .filter(([key]) => key.endsWith('/physical-rural-trees'))
        .reduce((sum, [, load]) => sum + load.tris, 0);
    expect(count()).toBeGreaterThan(0);
    const root = scene.roots().find((r) => r.getObjectByName('physical-rural-trees'));
    expect(root).toBeDefined();
    root!.visible = false;
    expect(count(), 'the same detector must catch an omitted physical-tree layer').toBe(0);
    root!.visible = true;
  });
});
