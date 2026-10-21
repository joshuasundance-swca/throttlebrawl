import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  courseAt,
  planStructures,
  terrainAt,
  type BakedNetwork,
  type BakedRoad,
} from '../road';
import { iowaParkLayout, iowaParkPlanner, IOWA_PARK_RECOVERY_M } from '../road/structures/iowa-park';
import { GroundTris } from './land-probe.test-util';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';
import { buildTerrainChunks } from './terrain-mesh';
import { IowaParkLayer } from './iowa-park';

const ROOT = 'packs/region-clinton/regions/clinton-iowa';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const network = read<BakedNetwork>(`${ROOT}/networks/osm-clinton-eagle-point.json`);
const roads = network.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
const road = createRoadNetwork({ network, roads });
const built = buildRoadScene(road, createFlatLook(), Object.fromEntries(roads.map((r) => [r.id, r])), {
  seed: 1,
  terrainChunks: buildTerrainChunks,
});
const drawn = new GroundTris(built.group);
afterAll(() => built.dispose());

describe('physical Eagle Point park facilities', () => {
  it('stands every pad on actual rendered land and clears every road and its recovery margin', () => {
    let facilities = 0;
    let supported = 0;
    let clear = 0;
    for (let seed = 1; seed <= 8; seed++)
      for (const facility of iowaParkLayout(road, seed).facilities) {
        facilities++;
        const pad = facility.specs.find((s) => s.rule.endsWith(':foundation'))!;
        expect(pad).toBeDefined();
        for (const part of facility.parts) {
          expect(
            Math.abs(part.at[0]) + part.box[0] / 2,
            `${facility.id}: ${part.name} across pad`,
          ).toBeLessThanOrEqual(pad.foot.hu);
          expect(
            Math.abs(part.at[2]) + part.box[2] / 2,
            `${facility.id}: ${part.name} along pad`,
          ).toBeLessThanOrEqual(pad.foot.hv);
        }
        for (let x = -pad.foot.hu; x <= pad.foot.hu; x += 0.35)
          for (let z = -pad.foot.hv; z <= pad.foot.hv; z += 0.35) {
            const px = pad.foot.x + pad.foot.ux * x - pad.foot.uz * z;
            const pz = pad.foot.z + pad.foot.uz * x + pad.foot.ux * z;
            const ray = drawn.heightAt(px, pz);
            const terrain = terrainAt(road.terrain, px, pz);
            expect(ray, `${facility.id}: drawn support`).not.toBeNull();
            expect(terrain?.surface).not.toBe('water');
            expect(ray!.y).toBeCloseTo(terrain!.y, 4);
            expect(ray!.y).toBeGreaterThanOrEqual(pad.baseY - 0.01);
            expect(ray!.y).toBeLessThan(facility.y);
            supported++;
          }
        for (const e of road.edges)
          for (let s = 0; s <= e.length; s += 1) {
            const p = road.toWorld(e.index, s, 0, 0);
            const distance = Math.hypot(facility.x - p.x, facility.z - p.z) - facility.radiusM;
            expect(distance, `${facility.id} versus ${e.id}`).toBeGreaterThanOrEqual(
              Math.max(-e.dMin, e.dMax) + 0.6 + IOWA_PARK_RECOVERY_M - 0.01,
            );
            clear++;
          }
      }
    expect(facilities).toBeGreaterThan(0);
    expect(supported).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(0);
  });

  it('refuses absent terrain, water and missing park tags with a positive real-ground control', () => {
    expect(iowaParkLayout(road, 1).facilities.length).toBeGreaterThan(0);
    const empty = createRoadNetwork({ network: { ...network, terrain: { patches: [] } }, roads });
    expect(iowaParkLayout(empty, 1).facilities).toEqual([]);
    const water = createRoadNetwork({
      network: {
        ...network,
        terrain: { patches: network.terrain!.patches.map((p) => ({ ...p, surface: 'water' as const })) },
      },
      roads,
    });
    expect(iowaParkLayout(water, 1).facilities).toEqual([]);
    const untagged = createRoadNetwork({
      network,
      roads: roads.map((r) => ({ ...r, tags: r.tags?.filter((t) => t.tag !== 'iowa-park') })),
    });
    expect(iowaParkLayout(untagged, 1).facilities).toEqual([]);
  });

  it('draws the physics boxes exactly, retains the open shelter at distance and supports the floor and roof', () => {
    const layout = iowaParkLayout(road, 1);
    const layer = new IowaParkLayer(createFlatLook(), { layout });
    try {
      layer.group.updateMatrixWorld(true);
      const specs = layout.facilities.flatMap((f) => f.specs);
      const collected: typeof specs = [];
      iowaParkPlanner.plan(road, 1, { add: (spec) => collected.push(spec) - 1 });
      expect(collected).toEqual(specs);
      for (const [index, facility] of layout.facilities.entries()) {
        const mesh = layer.views[index]!.mesh;
        const position = mesh.geometry.getAttribute('position');
        // sceneGeometry draws the full sign box (36 vertices), its thin printed face (6), then
        // every physical part's five visible faces (30). Compare those actual vertices to physics.
        const pieces = [facility.specs.at(-1)!, ...facility.specs.slice(0, -1)];
        let offset = 0;
        for (const [i, spec] of pieces.entries()) {
          const count = i === 0 ? 36 : 30;
          const local: Vector3[] = [];
          for (let k = offset; k < offset + count; k++) {
            const p = new Vector3().fromBufferAttribute(position, k).applyMatrix4(mesh.matrixWorld);
            const dx = p.x - spec.foot.x;
            const dz = p.z - spec.foot.z;
            local.push(
              new Vector3(dx * spec.foot.ux + dz * spec.foot.uz, p.y, -dx * spec.foot.uz + dz * spec.foot.ux),
            );
          }
          expect(Math.min(...local.map((p) => p.x))).toBeCloseTo(-spec.foot.hu, 3);
          expect(Math.max(...local.map((p) => p.x))).toBeCloseTo(spec.foot.hu, 3);
          expect(Math.min(...local.map((p) => p.z))).toBeCloseTo(-spec.foot.hv, 3);
          expect(Math.max(...local.map((p) => p.z))).toBeCloseTo(spec.foot.hv, 3);
          expect(Math.min(...local.map((p) => p.y))).toBeCloseTo(spec.baseY, 3);
          expect(Math.max(...local.map((p) => p.y))).toBeCloseTo(
            spec.baseY + (spec.roof.kind === 'flat' ? spec.roof.topM : 0),
            3,
          );
          offset += count + (i === 0 ? 6 : 0);
        }
      }
      // Directly inject this lane's planner until the coordinator wires the lazy registry.
      const plan = planStructures(
        road,
        1,
        { 'iowa-park': iowaParkPlanner },
        { 'iowa-park': { tags: ['iowa-park'], load: () => Promise.resolve(iowaParkPlanner) } },
      );
      const shelter = layout.facilities.find((f) => f.id === 'park-picnic-shelter')!;
      expect(shelter).toBeDefined();
      const floor = courseAt(road, plan, { edge: shelter.edge, s: shelter.s, d: shelter.d }, shelter.y + 0.1);
      expect(floor.kind).toBe('top');
      expect(floor.y).toBeCloseTo(shelter.y, 4);
      const roof = courseAt(road, plan, { edge: shelter.edge, s: shelter.s, d: shelter.d }, shelter.y + 3.5);
      expect(roof.kind).toBe('top');
      expect(roof.y).toBeCloseTo(shelter.y + 3.16, 3);
      const view = layer.views.find((v) => v.mesh.name === shelter.id)!;
      const full = view.mesh.geometry.getAttribute('position').count;
      layer.update(shelter.x + 200, shelter.z, 400);
      expect(view.mesh.visible).toBe(true);
      expect(view.mesh.geometry.drawRange.count).toBe(Infinity);
      expect(view.mesh.geometry.getAttribute('position').count).toBe(full);
      expect(layer.visibleContent().some((v) => v.ref === view.ref)).toBe(true);
      const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
      camera.position.set(shelter.x, shelter.y + 10, shelter.z + 20);
      camera.lookAt(shelter.x, shelter.y + 3.05, shelter.z);
      camera.updateMatrixWorld(true);
      layer.group.updateMatrixWorld(true);
      expect(layer.pick(0, 0, camera), 'the visible physical facility is selectable').toBe(view.ref);
      layer.hide([view.ref]);
      expect(view.mesh.visible, 'veto keeps the physical shell visible').toBe(true);
      expect(layer.visibleContent().some((v) => v.ref === view.ref)).toBe(false);
      expect(layer.pick(0, 0, camera), 'blanked words cannot be selected again').not.toBe(view.ref);
    } finally {
      layer.dispose();
    }
  });
});
