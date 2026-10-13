import { Box3, BoxGeometry, Mesh, Triangle, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, loadPnwPlacesLayout, type BakedNetwork, type BakedRoad } from '../road';
import { createFlatLook } from './look';
import { FERRY_DIM, placeItems, PnwPlacesLayer } from './pnw-places';

const networks = import.meta.glob<BakedNetwork>('../../packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const files = import.meta.glob<BakedRoad>('../../packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const network = Object.values(networks).find((n) => n.id === 'pnw-c1');
if (!network) throw new Error('missing PNW ferry network');
const road = createRoadNetwork({
  network,
  roads: Object.values(files).filter((r) => network.roads.includes(r.id)),
});
const { pnwPlacesLayout } = await loadPnwPlacesLayout();
const layout = pnwPlacesLayout(road, 7);
const hulls = placeItems(road, 7, layout, () => 24).filter((it) => {
  it.geometry.computeBoundingBox();
  return it.kind === 'ferry-hull' && it.geometry.boundingBox!.max.y > FERRY_DIM.ceilingY;
});

function cuts(geometry: BufferGeometry, box: Box3): number {
  const p = geometry.getAttribute('position');
  const end = Math.min(p.count, geometry.drawRange.start + geometry.drawRange.count);
  const triangle = new Triangle();
  let hits = 0;
  for (let i = geometry.drawRange.start; i + 2 < end; i += 3) {
    triangle.a.fromBufferAttribute(p, i);
    triangle.b.fromBufferAttribute(p, i + 1);
    triangle.c.fromBufferAttribute(p, i + 2);
    if (triangle.intersectsBox(box)) hits++;
  }
  return hits;
}

describe('the drawn ferry car-deck opening', () => {
  for (const lodM of [30, 100, 200]) {
    it(`keeps both lanes visible from the route start at scenery LOD ${lodM}`, () => {
      const layer = new PnwPlacesLayer(createFlatLook(), { road, seed: 7, layout, landReach: () => 24 });
      try {
        const edge = road.edgeIndex('pnw-ferry-landing');
        const camera = road.toWorld(edge, 40, 0, 0);
        layer.update(camera.x, camera.z, 360, lodM, Infinity);
        const meshes: Mesh<BufferGeometry>[] = [];
        layer.group.traverse((o) => {
          if (o instanceof Mesh && o.visible) meshes.push(o as Mesh<BufferGeometry>);
        });
        expect(meshes.length).toBeGreaterThan(0);
        expect(hulls.length).toBeGreaterThan(0);
        for (const hull of hulls) {
          const half = (hull.geometry.boundingBox!.max.z - hull.geometry.boundingBox!.min.z) / 2;
          const entry = road.toWorld(edge, hull.s - half, 0, 0);
          const opening = new Box3(
            new Vector3(entry.x - 3, entry.y + 0.5, entry.z - 0.1),
            new Vector3(entry.x + 3, entry.y + 5.8, entry.z + 0.1),
          );
          expect(
            meshes.reduce((n, mesh) => n + cuts(mesh.geometry, opening), 0),
            `covered section at ${hull.s}`,
          ).toBe(0);
          const mid = road.toWorld(edge, hull.s, 0, 0);
          const roof = new Box3(
            new Vector3(mid.x - 3, mid.y + FERRY_DIM.ceilingY - 0.05, mid.z - 0.1),
            new Vector3(mid.x + 3, mid.y + FERRY_DIM.ceilingY + 0.45, mid.z + 0.1),
          );
          expect(
            meshes.reduce((n, mesh) => n + cuts(mesh.geometry, roof), 0),
            'the roof remains drawn',
          ).toBeGreaterThan(0);
          const closed = new BoxGeometry(6, 5.3, 0.2).toNonIndexed();
          closed.translate(entry.x, entry.y + 3.15, entry.z);
          expect(cuts(closed, opening), 'the same oracle detects a planted wall').toBeGreaterThan(0);
          closed.dispose();
        }
      } finally {
        layer.dispose();
      }
    });
  }
});
