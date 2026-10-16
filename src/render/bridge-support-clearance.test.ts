import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';

function supports(otherY: number, sideways = 0): Vector3[] {
  const bundle = fixtureNetwork([
    { id: 'upper', lengthM: 60, kappa: 0 },
    { id: 'other', lengthM: 60, kappa: 0 },
  ]);
  const road = createRoadNetwork({
    ...bundle,
    roads: bundle.roads.map((r, index) => {
      const data = r.samples.data;
      if (!data) throw new Error('fixture requires explicit samples');
      return {
        ...r,
        samples: {
          ...r.samples,
          data: {
            ...data,
            x: data['x']!.map((x) => x + (index ? sideways : 0)),
            y: data['y']!.map(() => (index ? otherY : 12)),
            z: data['z']!.map((z) => z + (index ? 60 : 0)),
          },
        },
      };
    }),
  });
  const { group } = buildRoadScene(road, createFlatLook(), {
    upper: { tags: [{ s0: 0, s1: 60, side: 'both', tag: 'bridge' }] },
  });
  const positions: Vector3[] = [];
  group.updateMatrixWorld(true);
  group.traverse((mesh) => {
    if (!(mesh instanceof InstancedMesh) || mesh.name !== 'road-pylons') return;
    for (let i = 0; i < mesh.count; i++) {
      const matrix = new Matrix4();
      mesh.getMatrixAt(i, matrix);
      matrix.premultiply(mesh.matrixWorld);
      positions.push(new Vector3().setFromMatrixPosition(matrix));
    }
  });
  return positions;
}

describe('ordinary bridge supports leave lower lanes open', () => {
  it('omits a support through a lower lane, retaining supports when the other road is above, below the foot or beside it', () => {
    expect(supports(0)).toEqual([]);
    for (const [height, offset] of [
      [20, 0],
      [-10, 0],
      [0, 20],
    ])
      expect(supports(height!, offset).length, `other road at y${height}, x${offset}`).toBeGreaterThan(0);
  });
});
