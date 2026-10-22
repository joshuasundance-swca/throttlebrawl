import { readFileSync } from 'node:fs';
import {
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Vector3,
  type BufferGeometry,
} from 'three';
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
import { deciduousGeometry } from './deciduous';
import { TerrainTrees } from './terrain-trees';
import { planTerrainTrees } from '../road/structures/terrain-trees';

const ROOT = 'packs/region-clinton/regions/clinton-iowa';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const network = read<BakedNetwork>(`${ROOT}/networks/osm-clinton-eagle-point.json`);
const roads = network.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
const road = createRoadNetwork({ network, roads });
const built = buildRoadScene(road, createFlatLook(), Object.fromEntries(roads.map((r) => [r.id, r])), {
  seed: 1,
  terrainChunks: buildTerrainChunks,
});

describe('Eagle park canopy presentation', () => {
  const positions = (geometry: BufferGeometry) => Array.from(geometry.getAttribute('position').array);
  const ordinaryRoads = roads.map((r) => ({ ...r, tags: r.tags?.filter((t) => t.tag !== 'iowa-park') }));
  const ordinary = createRoadNetwork({ network, roads: ordinaryRoads });
  const mixed = createRoadNetwork({ network, roads: roads.map((r, i) => (i ? r : ordinaryRoads[i]!)) });

  it('has a fuller bounded park crown with the same physical trunk and a real empty control', () => {
    const rural = deciduousGeometry();
    const park = deciduousGeometry('park');
    const material = createFlatLook().material('prop', { vertexColors: true });
    const ruralMesh = new Mesh(rural, material),
      parkMesh = new Mesh(park, material);
    const ray = new Raycaster();
    try {
      expect(positions(park)).not.toEqual(positions(rural));
      const p = park.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        expect(p.getY(i)).toBeGreaterThanOrEqual(0);
        expect(p.getY(i)).toBeLessThanOrEqual(11.2 + 1e-6);
        expect(Math.hypot(p.getX(i), p.getZ(i))).toBeLessThanOrEqual(4.8 + 1e-6);
      }
      for (const y of [1, 3, 4])
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
          const direction = new Vector3(Math.cos(a), 0, Math.sin(a));
          ray.set(direction.clone().multiplyScalar(2).setY(y), direction.clone().negate());
          expect(ray.intersectObject(parkMesh)[0]?.distance).toBeCloseTo(
            ray.intersectObject(ruralMesh)[0]!.distance,
            6,
          );
        }
      const cover = (mesh: Mesh) => {
        let hit = 0;
        for (let x = -4.8; x <= 4.8; x += 0.3)
          for (let z = -4.8; z <= 4.8; z += 0.3) {
            ray.set(new Vector3(x, 12, z), new Vector3(0, -1, 0));
            if (ray.intersectObject(mesh).length) hit++;
          }
        return hit;
      };
      expect(cover(ruralMesh)).toBeGreaterThan(0);
      expect(cover(parkMesh)).toBeGreaterThan(cover(ruralMesh));
      parkMesh.visible = false;
      parkMesh.position.x = 100;
      parkMesh.updateMatrixWorld(true);
      expect(cover(parkMesh), 'a displaced empty canopy cannot pass coverage').toBe(0);
    } finally {
      rural.dispose();
      park.dispose();
      material.dispose();
    }
  });

  it('switches park/default geometry without changing shared positions, chunks or threat visibility', () => {
    const trees = new TerrainTrees(createFlatLook());
    const parkGeometry = deciduousGeometry('park'),
      ruralGeometry = deciduousGeometry();
    try {
      for (const source of [road, ordinary, mixed, road]) {
        trees.setRoad(source, 1);
        const plan = planTerrainTrees(source, 1);
        const expected = source === road ? parkGeometry : ruralGeometry;
        const actual: number[][] = [];
        for (const child of trees.root.children) {
          expect(child).toBeInstanceOf(InstancedMesh);
          const mesh = child as InstancedMesh;
          expect(positions(mesh.geometry)).toEqual(positions(expected));
          for (let i = 0; i < mesh.count; i++) {
            const matrix = new Matrix4();
            mesh.getMatrixAt(i, matrix);
            actual.push([matrix.elements[12], matrix.elements[13], matrix.elements[14]]);
          }
        }
        expect(actual.length).toBe(plan.items.length);
        for (const tree of plan.items)
          expect(
            actual.some(
              ([x, y, z]) =>
                Math.abs(x! - tree.x) < 1e-4 &&
                Math.abs(y! - tree.baseY) < 1e-4 &&
                Math.abs(z! - tree.z) < 1e-4,
            ),
          ).toBe(true);
        expect(trees.root.children.length).toBe(
          new Set(plan.items.map((t) => `${Math.floor(t.x / 100)},${Math.floor(t.z / 100)}`)).size,
        );
        const first = plan.items[0]!;
        expect(trees.update(first.x, first.z, 0)).toBeGreaterThan(0);
        expect(trees.update(first.x + 100000, first.z + 100000, 0)).toBe(0);
      }
      trees.setRoad(null, 1);
      expect(trees.root.children).toEqual([]);
    } finally {
      trees.dispose();
      parkGeometry.dispose();
      ruralGeometry.dispose();
    }
  });

  it('keeps actual canopy triangles out of both ordinary facility approach sightlines', () => {
    const trees = new TerrainTrees(createFlatLook());
    const blockerGeometry = deciduousGeometry('park');
    const material = createFlatLook().material('prop', { vertexColors: true });
    const blocker = new Mesh(blockerGeometry, material);
    const ray = new Raycaster();
    let checked = 0;
    try {
      for (let seed = 1; seed <= 8; seed++) {
        trees.setRoad(road, seed);
        trees.root.updateMatrixWorld(true);
        for (const facility of iowaParkLayout(road, seed).facilities)
          for (const sign of [-1, 1]) {
            const eye = road.toWorld(facility.edge, facility.s + sign * 25, 0, 2.6);
            const target = new Vector3(facility.x, facility.y + 2, facility.z);
            const origin = new Vector3(eye.x, eye.y, eye.z);
            const direction = target.clone().sub(origin).normalize();
            ray.set(origin, direction);
            ray.far = origin.distanceTo(target);
            expect(ray.intersectObject(trees.root, true), facility.id).toEqual([]);
            const midpoint = origin.clone().lerp(target, 0.5);
            blocker.position.copy(midpoint).add(new Vector3(0, -7, 0));
            blocker.updateMatrixWorld(true);
            expect(
              ray.intersectObject(blocker).length,
              'a canopy in the opening blocks this detector',
            ).toBeGreaterThan(0);
            checked++;
          }
      }
      expect(checked).toBeGreaterThan(0);
    } finally {
      trees.dispose();
      blockerGeometry.dispose();
      material.dispose();
    }
  });
});
const drawn = new GroundTris(built.group);
afterAll(() => built.dispose());

describe('physical Eagle Point park facilities', () => {
  it('shows the physical shelter roof from beneath its open passage', () => {
    const layout = iowaParkLayout(road, 1);
    const layer = new IowaParkLayer(createFlatLook(), { layout });
    try {
      layer.group.updateMatrixWorld(true);
      const facility = layout.facilities.find((f) => f.id === 'park-picnic-shelter')!;
      const roof = facility.specs.find((s) => s.rule.endsWith(':shelter-roof'))!;
      const mesh = layer.views.find((v) => v.mesh.name === facility.id)!.mesh;
      const ray = new Raycaster(
        new Vector3(roof.foot.x, roof.baseY - 0.5, roof.foot.z),
        new Vector3(0, 1, 0),
      );
      expect(ray.intersectObject(mesh)[0]?.distance).toBeCloseTo(0.5, 3);
    } finally {
      layer.dispose();
    }
  });
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
        // Probe actual face triangles from their outward side; no vertex order/count contract.
        const ray = new Raycaster();
        const facesPresent = () =>
          facility.specs.every((spec) => {
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
        expect(facesPresent(), facility.id).toBe(true);
        mesh.position.x += 1;
        mesh.updateMatrixWorld(true);
        expect(facesPresent(), 'displaced drawing fails contact alignment').toBe(false);
        mesh.position.x -= 1;
        mesh.updateMatrixWorld(true);
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
      if (floor.kind !== 'top') throw new Error('shelter floor is not a supported top');
      expect(floor.y).toBeCloseTo(shelter.y, 4);
      const roof = courseAt(road, plan, { edge: shelter.edge, s: shelter.s, d: shelter.d }, shelter.y + 3.5);
      expect(roof.kind).toBe('top');
      if (roof.kind !== 'top') throw new Error('shelter roof is not a supported top');
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
