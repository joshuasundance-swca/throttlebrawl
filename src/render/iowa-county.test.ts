import { readFileSync } from 'node:fs';
import { Mesh, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../road';
import { iowaCountyLayout } from '../road/structures/iowa-county';
import { GroundTris } from './land-probe.test-util';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';
import { IowaCountyLayer } from './iowa-county';

const root = 'packs/region-clinton/regions/clinton-iowa';
const read = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const network = read<BakedNetwork>(`${root}/networks/osm-clinton-ia136.json`);
const roads = network.roads.map((id) => read<BakedRoad>(`${root}/roads/${id}.json`));
const road = createRoadNetwork({ network, roads });

it('draws every contact box exactly, including crib slats and the clear shed passage at distance', () => {
  const layout = iowaCountyLayout(road, 1);
  expect(layout.facilities.length).toBeGreaterThan(0);
  const layer = new IowaCountyLayer(createFlatLook(), { layout });
  try {
    layer.group.updateMatrixWorld(true);
    for (const [i, f] of layout.facilities.entries()) {
      const mesh = layer.views[i]!.mesh;
      const ray = new Raycaster();
      const facesPresent = () =>
        f.specs.every((spec) => {
          const height = spec.roof.kind === 'flat' ? spec.roof.topM : 0;
          const center = new Vector3(spec.foot.x, spec.baseY + height / 2, spec.foot.z);
          const axes = [
            { normal: new Vector3(spec.foot.ux, 0, spec.foot.uz), half: spec.foot.hu },
            { normal: new Vector3(0, 1, 0), half: height / 2 },
            { normal: new Vector3(-spec.foot.uz, 0, spec.foot.ux), half: spec.foot.hv },
          ];
          return axes.every(({ normal, half }) =>
            [-1, 1].every((sign) => {
              const outward = normal.clone().multiplyScalar(sign);
              ray.set(center.clone().addScaledVector(outward, half + 0.02), outward.clone().negate());
              return ray.intersectObject(mesh).some((hit) => Math.abs(hit.distance - 0.02) < 0.001);
            }),
          );
        });
      expect(facesPresent(), f.id).toBe(true);
      mesh.position.x += 1;
      mesh.updateMatrixWorld(true);
      expect(facesPresent(), 'displaced drawing fails contact alignment').toBe(false);
      mesh.position.x -= 1;
      mesh.updateMatrixWorld(true);
      layer.update(f.x + 200, f.z, 400);
      expect(mesh.visible).toBe(true);
      expect(mesh.geometry.drawRange.count).toBe(Infinity);
      expect(layer.visibleContent().some((v) => v.ref === layer.views[i]!.ref)).toBe(true);
      const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
      camera.position.set(f.x, f.y + 12, f.z + 20);
      camera.lookAt(f.x, f.y + 2, f.z);
      camera.updateMatrixWorld(true);
      expect(layer.pick(0, 0, camera)).toBe(layer.views[i]!.ref);
      layer.hide([layer.views[i]!.ref]);
      expect(mesh.visible).toBe(true);
      expect(layer.visibleContent().some((v) => v.ref === layer.views[i]!.ref)).toBe(false);
      expect(layer.pick(0, 0, camera)).not.toBe(layer.views[i]!.ref);
      if (f.id === 'county-loading-shed') {
        const ray = new Raycaster(new Vector3(f.x, f.y + 2, f.z), new Vector3(0, 1, 0));
        expect(ray.intersectObject(mesh, false)[0]?.distance, 'roof underside is actually drawn').toBeCloseTo(
          1.98,
          3,
        );
      }
    }
  } finally {
    layer.dispose();
  }
});

it('stands the full approach, facility and return on rendered connected county land', () => {
  const built = buildRoadScene(road, createFlatLook(), Object.fromEntries(roads.map((r) => [r.id, r])), {
    seed: 1,
  });
  try {
    const ground = new GroundTris(built.group);
    let probes = 0;
    for (const f of iowaCountyLayout(road, 1).facilities) {
      for (let ds = -5; ds <= 5; ds += 0.4)
        for (let d = 7.75; d <= f.d + 3.5; d += 0.4) {
          const p = road.toWorld(f.edge, f.s + ds, d, 0);
          const hit = ground.heightAt(p.x, p.z, p.y + 1);
          expect(hit, `${f.id} footprint ${ds},${d}`).not.toBeNull();
          expect(Math.abs(hit!.y - f.y), 'apron joins drawn land within a shallow step').toBeLessThan(0.11);
          probes++;
        }
      for (let ds = -70; ds <= 110; ds += 0.5)
        for (let d = 1.75; d <= f.d + 3.5; d += 0.5) {
          const p = road.toWorld(f.edge, f.s + ds, d, 0);
          expect(ground.heightAt(p.x, p.z, p.y + 1), `${f.id} approach and return ${ds},${d}`).not.toBeNull();
          probes++;
        }
    }
    expect(probes).toBeGreaterThan(0);
  } finally {
    built.dispose();
  }
});

it('draws low soft rows on an opted-in field, with every visible vertex rooted on real ground', () => {
  const fieldRoads = roads;
  const fieldRoad = createRoadNetwork({ network, roads: fieldRoads });
  const built = buildRoadScene(
    fieldRoad,
    createFlatLook(),
    Object.fromEntries(fieldRoads.map((r) => [r.id, r])),
  );
  const layer = new IowaCountyLayer(createFlatLook(), { layout: iowaCountyLayout(fieldRoad, 1) });
  try {
    const meshes: Mesh[] = [];
    layer.group.traverse((o) => {
      if (o instanceof Mesh && o.name.startsWith('county-crops:')) meshes.push(o as Mesh);
    });
    expect(meshes.length).toBeGreaterThan(0);
    const ground = new GroundTris(built.group);
    layer.group.updateMatrixWorld(true);
    let vertices = 0;
    const measurements: unknown[] = [];
    for (const mesh of meshes) {
      layer.update(mesh.position.x, mesh.position.z, 100);
      expect(mesh.visible).toBe(true);
      const positions = mesh.geometry.getAttribute('position');
      let minimumLift = Infinity,
        maximumLift = -Infinity;
      for (let i = 0; i < positions.count; i++) {
        const p = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        const support = ground.heightAt(p.x, p.z, p.y + 1);
        expect(support).not.toBeNull();
        expect(p.y - support!.y).toBeGreaterThan(0);
        expect(p.y - support!.y).toBeLessThan(0.21);
        minimumLift = Math.min(minimumLift, p.y - support!.y);
        maximumLift = Math.max(maximumLift, p.y - support!.y);
        vertices++;
      }
      for (let i = 0; i < positions.count; i += 3) {
        const p = new Vector3();
        for (let k = 0; k < 3; k++) p.add(new Vector3().fromBufferAttribute(positions, i + k));
        p.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
        const support = ground.heightAt(p.x, p.z, p.y + 1);
        expect(support).not.toBeNull();
        expect(p.y - support!.y).toBeGreaterThan(0);
        expect(p.y - support!.y).toBeLessThan(0.21);
      }
      measurements.push({ name: mesh.name, triangles: positions.count / 3, minimumLift, maximumLift });
    }
    expect(vertices).toBeGreaterThan(0);
    process.stdout.write(
      `[county crops rendered geometry] ${JSON.stringify({ fields: meshes.length, vertices, measurements })}\n`,
    );
  } finally {
    layer.dispose();
    built.dispose();
  }
});

it('culls, picks, vetoes and disposes the soft crops while leaving facility lifecycle intact', () => {
  const layer = new IowaCountyLayer(createFlatLook(), { layout: iowaCountyLayout(road, 1) });
  const crops: Mesh[] = [];
  layer.group.traverse((o) => {
    if (o instanceof Mesh && o.name.startsWith('county-crops:')) crops.push(o as Mesh);
  });
  expect(crops.length).toBeGreaterThan(0);
  let disposed = 0;
  for (const mesh of crops) mesh.geometry.addEventListener('dispose', () => disposed++);
  try {
    for (const mesh of crops) {
      layer.update(mesh.position.x, mesh.position.z, 100);
      layer.group.updateMatrixWorld(true);
      expect(mesh.visible).toBe(true);
      const ref = String(mesh.userData['contentRef']);
      expect(layer.visibleContent().some((v) => v.ref === ref)).toBe(true);
      const positions = mesh.geometry.getAttribute('position'),
        at = new Vector3();
      for (let i = 0; i < 3; i++) at.add(new Vector3().fromBufferAttribute(positions, i));
      at.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
      const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
      camera.position.copy(at).add(new Vector3(0, 6, 0));
      camera.lookAt(at);
      camera.updateMatrixWorld(true);
      expect(layer.pick(0, 0, camera)).toBe(ref);
      layer.update(mesh.position.x + 10000, mesh.position.z, 100);
      expect(mesh.visible).toBe(false);
      layer.hide([ref]);
      layer.update(mesh.position.x, mesh.position.z, 100);
      expect(mesh.visible).toBe(false);
      expect(layer.visibleContent().some((v) => v.ref === ref)).toBe(false);
      expect(layer.pick(0, 0, camera)).not.toBe(ref);
    }
  } finally {
    layer.dispose();
  }
  expect(disposed).toBe(crops.length);
});
