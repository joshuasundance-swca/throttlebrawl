import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Raycaster, Vector3 } from 'three';
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
