import { Box3, BoxGeometry, Matrix4, Mesh, Triangle, Vector3, type BufferGeometry } from 'three';
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

function cuts(geometry: BufferGeometry, box: Box3, toLocal?: Matrix4): number {
  const p = geometry.getAttribute('position');
  const end = Math.min(p.count, geometry.drawRange.start + geometry.drawRange.count);
  const triangle = new Triangle();
  let hits = 0;
  for (let i = geometry.drawRange.start; i + 2 < end; i += 3) {
    triangle.a.fromBufferAttribute(p, i);
    triangle.b.fromBufferAttribute(p, i + 1);
    triangle.c.fromBufferAttribute(p, i + 2);
    if (toLocal) {
      triangle.a.applyMatrix4(toLocal);
      triangle.b.applyMatrix4(toLocal);
      triangle.c.applyMatrix4(toLocal);
    }
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

describe('the drawn Stump Social street opening', () => {
  const banners = placeItems(road, 7, layout, () => 24).filter((it) => it.kind === 'banner');
  for (const lodM of [30, 100, 200, Infinity]) {
    it(`keeps the roadway clear beneath each banner at scenery LOD ${lodM}`, () => {
      const layer = new PnwPlacesLayer(createFlatLook(), { road, seed: 7, layout, landReach: () => 24 });
      try {
        expect(banners.length).toBeGreaterThan(0);
        for (const banner of banners) {
          const centre = road.toWorld(banner.edge, banner.s, 0, 0);
          const origin = new Vector3(centre.x, centre.y, centre.z);
          const r = road.toWorld(banner.edge, banner.s, 1, 0);
          const f = road.toWorld(banner.edge, banner.s + 1, 0, 0);
          const right = new Vector3(r.x, r.y, r.z).sub(origin).normalize();
          const forward = new Vector3(f.x, f.y, f.z).sub(origin).normalize();
          const frame = new Matrix4().makeBasis(right, new Vector3(0, 1, 0), forward).setPosition(origin);
          const toLocal = frame.clone().invert();
          const camera = origin.clone().addScaledVector(forward, -320);
          layer.update(camera.x, camera.z, 800, lodM, Infinity);
          const meshes: Mesh<BufferGeometry>[] = [];
          layer.group.traverse((o) => {
            if (o instanceof Mesh && o.visible) meshes.push(o as Mesh<BufferGeometry>);
          });
          expect(meshes.length).toBeGreaterThan(0);
          const opening = new Box3(new Vector3(-3, 0.5, -0.15), new Vector3(3, 4.8, 0.15));
          expect(
            meshes.reduce((n, mesh) => n + cuts(mesh.geometry, opening, toLocal), 0),
            `banner on edge ${banner.edge} at ${banner.s}`,
          ).toBe(0);
          const overhead = new Box3(new Vector3(-3, 5.15, -0.15), new Vector3(3, 5.35, 0.15));
          expect(
            meshes.reduce((n, mesh) => n + cuts(mesh.geometry, overhead, toLocal), 0),
            'the overhead sign remains drawn',
          ).toBeGreaterThan(0);
          const closed = new BoxGeometry(6, 4.3, 0.2).toNonIndexed();
          closed.translate(0, 2.65, 0).applyMatrix4(frame);
          expect(cuts(closed, opening, toLocal), 'the same oracle detects a planted wall').toBeGreaterThan(0);
          closed.dispose();
        }
      } finally {
        layer.dispose();
      }
    });
  }
});
