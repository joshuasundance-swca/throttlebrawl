import { readFileSync } from 'node:fs';
import { Box3, Raycaster, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { PROPS, glbPath } from '../catalog.mjs';
import { load, triangles } from '../cx5-reader.mjs';
import { scoreGlb } from '../score.mjs';
import { bakeLandmarkKit, type LandmarkKitId } from '../../../src/render/models';
import { columnParts } from '../../../src/render/structure-columns.test-util';
import { surfacePoints } from '../../../src/render/structures.test-util';

const prop = () => {
  const row = PROPS.find((p) => p.name === 'eagle_stone_tower');
  if (!row) throw new Error('missing Eagle stone tower catalog row');
  return row;
};
const scene = () => load(process.env['EAGLE_TOWER_GLB'] ?? glbPath(prop()));
const node = (root: Object3D, name: string) => {
  const result = root.getObjectByName(name);
  if (!result) throw new Error(`missing tower node ${name}`);
  return result;
};
const bounds = (root: Object3D) => new Box3().setFromPoints(triangles(root, root).flat());

describe('original Eagle stone tower exterior', () => {
  it('has a broad low round outer section around a narrower tall round central tower', async () => {
    const tower = node(await scene(), 'eagle_stone_tower_lod0');
    const radii = (y: number) =>
      Array.from({ length: 16 }, (_, i) => {
        const angle = (i * Math.PI) / 8;
        const direction = new Vector3(Math.cos(angle), 0, Math.sin(angle));
        const hit = new Raycaster(
          direction.clone().multiplyScalar(10).setY(y),
          direction.clone().negate(),
        ).intersectObject(tower, true)[0];
        return hit ? Math.hypot(hit.point.x, hit.point.z) : 0;
      });
    const low = radii(0.5),
      high = radii(8.5);
    expect(Math.min(...low)).toBeGreaterThan(Math.max(...high) * 1.7);
    for (const ring of [low, high]) expect(Math.max(...ring) / Math.min(...ring)).toBeLessThan(1.1);
  });
  it('registers a Clinton landmark with near/far geometry and passes the existing asset score', () => {
    const row = prop();
    expect(row.pack).toBe('region-clinton');
    expect(row.region).toBe('clinton-iowa');
    expect(row.kind).toBe('variants');
    const result = scoreGlb(readFileSync(process.env['EAGLE_TOWER_GLB'] ?? glbPath(row)), row);
    expect(result.summary.failed).toEqual([]);
    expect(result.counts.triangles).toBeGreaterThan(0);
  });

  it('loads grounded unit-scale nodes with a substantially cheaper matching far silhouette', async () => {
    const root = await scene();
    const near = node(root, 'eagle_stone_tower_lod0');
    const far = node(root, 'eagle_stone_tower_lod1');
    expect(near.userData['exterior_only']).toBe(true);
    for (const tower of [near, far]) {
      expect(tower.scale.toArray()).toEqual([1, 1, 1]);
      const box = bounds(tower);
      expect(box.min.y).toBeCloseTo(0, 5);
      expect(box.max.y).toBeGreaterThan(8);
      expect(box.getSize(new Vector3()).x).toBeGreaterThan(4);
    }
    const nearSize = bounds(near).getSize(new Vector3());
    const farSize = bounds(far).getSize(new Vector3());
    for (const axis of ['x', 'y', 'z'] as const)
      expect(Math.abs(nearSize[axis] - farSize[axis])).toBeLessThanOrEqual(nearSize[axis] * 0.05);
    expect(triangles(far).length).toBeLessThanOrEqual(triangles(near).length * 0.3);
  });

  it('draws a real open-top parapet above a solid observation floor, with gaps between merlons', async () => {
    const root = await scene();
    const tower = node(root, 'eagle_stone_tower_lod0');
    const offset = tower.getWorldPosition(new Vector3());
    const down = new Vector3(0, -1, 0);
    const height = (x: number, z: number) =>
      new Raycaster(new Vector3(x, 15, z).add(offset), down).intersectObject(tower, true)[0]?.point.y;
    const floor = height(0, 0)!;
    const merlon = height(2.55, 0)!;
    const gap = height(2.55 * Math.cos(Math.PI / 8), 2.55 * Math.sin(Math.PI / 8))!;
    expect(floor).toBeGreaterThan(8);
    expect(merlon).toBeGreaterThan(floor + 1);
    expect(gap).toBeGreaterThan(floor);
    expect(gap).toBeLessThan(merlon - 0.5);
    expect(height(4, 0), 'the outer terrace has a real lower floor').toBeCloseTo(3.35, 3);
    expect(height(20, 20), 'empty control has no fabricated roof').toBeUndefined();
  });

  it('closes the ground-level door and backs the elevated arch recess with real drawn surfaces', async () => {
    const root = await scene();
    const tower = node(root, 'eagle_stone_tower_lod0');
    const hit = (x: number, y: number) =>
      new Raycaster(new Vector3(x, y, 8), new Vector3(0, 0, -1)).intersectObject(tower, true)[0];
    expect(hit(0.3, 1)?.point.z).toBeGreaterThan(5.2);
    expect(hit(0, 1), 'the closed joint has a solid backing too').toBeDefined();
    const recess = hit(0, 6.4)!.point.z;
    const wall = hit(0.6, 6.4)!.point.z;
    expect(wall - recess).toBeGreaterThan(0.25);
    expect(wall - recess).toBeLessThan(0.6);
    expect(hit(0, 13), 'above-tower ray must miss').toBeUndefined();
  });

  it('bakes through the existing renderer and measures honest exterior ground columns without capping the deck', async () => {
    // The generic bake accepts named roots; runtime kit registration belongs to later integration.
    const kit = bakeLandmarkKit('eagle-stone-tower' as LandmarkKitId, await scene());
    try {
      const near = kit.nodes.get('eagle_stone_tower_lod0')!;
      expect(near.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(kit.doubleSided).toBe(false);
      const parts = columnParts(surfacePoints(near.geometry, 0.5 / 3), {
        cell: 0.5,
        mode: 'ground',
        merge: 0.15,
      });
      const top = (x: number, z: number) =>
        Math.max(
          ...parts.filter(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1).map((p) => p[5]),
        );
      expect(parts.length).toBeGreaterThan(0);
      // Column tooling rounds stored float surfaces outward to centimetres.
      expect(top(0, 0)).toBeGreaterThanOrEqual(9.4 - 1e-6);
      expect(top(0, 0)).toBeLessThanOrEqual(9.42);
      expect(top(2.55, 0)).toBeGreaterThanOrEqual(10.7 - 1e-6);
      expect(top(2.55, 0)).toBeLessThanOrEqual(10.72);
      expect(top(2.55 * Math.cos(Math.PI / 8), 2.55 * Math.sin(Math.PI / 8))).toBeLessThan(
        top(2.55, 0) - 0.5,
      );
      expect(top(4, 0)).toBeGreaterThanOrEqual(3.35 - 1e-6);
      expect(top(4, 0)).toBeLessThanOrEqual(3.37);
      expect(top(20, 20), 'no invented distant solid').toBe(-Infinity);
      for (const part of parts) expect(part[4]).toBeCloseTo(0, 1);
    } finally {
      for (const part of kit.nodes.values()) part.geometry.dispose();
    }
  });
});
