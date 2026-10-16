/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Vector3, type BufferGeometry } from 'three';
import network from '../../packs/region-pnw/regions/pacific-northwest/networks/osm-pnw-samish.json';
import route from '../../packs/region-pnw/regions/pacific-northwest/routes/osm-i5-samish-run.json';
import type { BakedNetwork, BakedRoad, BakedRoute } from '../../src/road';
import { createFlatLook } from '../../src/render/look';
import { VergeLayer } from '../../src/render/verge';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import { createWorld } from '../../src/sim/world';
import { edgeHoldAt } from '../../src/sim/riders';

const files = import.meta.glob<BakedRoad>('/packs/region-pnw/regions/pacific-northwest/roads/*.json', {
  eager: true,
  import: 'default',
});
const config = gapSimConfig(
  {
    network: network as unknown as BakedNetwork,
    roads: network.roads.map((id) => Object.values(files).find((r) => r.id === id)!),
  },
  { route: route as unknown as BakedRoute },
);

it('opens the brush interval whose clump was removed over another road, retaining its ordinary neighbor', () => {
  const road = config.road,
    edge = road.edgeIndex('osm-samish-east-shore');
  const layer = new VergeLayer(road, createFlatLook(), {
    tags: new Set(road.edges.flatMap((e) => e.tags.map((t) => t.tag))),
  });
  const points = layer.edgeKitPoints().ferns;
  const world = createWorld(config);
  const positions = [1524, 1527].map((s) => road.toWorld(edge, s, road.vergeAt(edge, s, 'left').dOuter, 0));
  const nearest = positions.map((p) => Math.min(...points.map((c) => Math.hypot(c.x - p.x, c.z - p.z))));
  // The renderer actually retains the neighbor, and leaves this phase's next clump out over I-5.
  expect(nearest[0]).toBeLessThan(1);
  expect(nearest[1]).toBeGreaterThan(3);
  layer.update(positions[1]!.x, positions[1]!.z, null, 0);
  layer.group.updateMatrixWorld(true);
  const distances: number[] = [];
  const matrix = new Matrix4();
  layer.group.traverse((m) => {
    if (!(m instanceof InstancedMesh) || !m.name.includes('brush')) return;
    const mesh = m as InstancedMesh<BufferGeometry>;
    mesh.geometry.computeBoundingBox();
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, matrix);
      const box = mesh.geometry.boundingBox!.clone().applyMatrix4(matrix).applyMatrix4(m.matrixWorld);
      const p = positions[1]!;
      const flat = new Vector3(p.x, Math.max(box.min.y, Math.min(p.y, box.max.y)), p.z);
      const distance = box.distanceToPoint(flat);
      distances.push(distance);
    }
  });
  // Even the nearest transformed frond bounds leave over two metres of empty ground here.
  expect(Math.min(...distances)).toBeGreaterThan(2);
  expect(edgeHoldAt(world, config, edge, 1524, -1).hold).toBe('held');
  expect(edgeHoldAt(world, config, edge, 1527, -1).hold).toBe('open');
  layer.dispose();
});
