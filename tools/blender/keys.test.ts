// CX2's real dimensions and root conventions, independently of catalog tuning budgets.
import { readFileSync } from 'node:fs';
import { Box3, Vector3, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';

async function load(asset: string): Promise<Object3D> {
  const bytes = readFileSync(`packs/base/assets/models/${asset}.glb`);
  return new Promise((resolve, reject) =>
    new GLTFLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
      (g) => {
        g.scene.updateMatrixWorld(true);
        resolve(g.scene);
      },
      reject,
    ),
  );
}

describe('Keys landmark and bridge geometry', () => {
  it('keeps atlas UVs strictly inside declared tiles with top-left image orientation', async () => {
    const layout = JSON.parse(
      readFileSync('packs/base/assets/textures/atlas/florida-keys-layout.json', 'utf8'),
    ) as {
      tiles: Record<string, { rect: [number, number, number, number] }>;
    };
    const scenes = await Promise.all([load('scenery/duval-kit'), load('scenery/seven-mile-kit')]);
    let checked = 0;
    for (const scene of scenes) {
      scene.traverse((node) => {
        const mesh = node as Mesh;
        const tile = mesh.userData.atlas_tile as string | undefined;
        if (!mesh.isMesh || !tile) return;
        const [left, top, right, bottom] = layout.tiles[tile]!.rect;
        const uv = mesh.geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) {
          expect(uv.getX(i), mesh.name).toBeGreaterThan(left);
          expect(uv.getX(i), mesh.name).toBeLessThan(right);
          expect(uv.getY(i), mesh.name).toBeGreaterThan(top);
          expect(uv.getY(i), mesh.name).toBeLessThan(bottom);
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(0);
    const panel = scenes[0].getObjectByName('duval_balcony_a_siding_0') as Mesh;
    const positions = panel.geometry.getAttribute('position');
    const uv = panel.geometry.getAttribute('uv');
    const corners = Array.from({ length: positions.count }, (_, i) => ({
      x: positions.getX(i),
      y: positions.getY(i),
      u: uv.getX(i),
      v: uv.getY(i),
    }));
    const upper = corners.filter((c) => c.y === Math.max(...corners.map((p) => p.y)));
    const lower = corners.filter((c) => c.y === Math.min(...corners.map((p) => p.y)));
    expect(Math.max(...upper.map((c) => c.v))).toBeLessThan(Math.min(...lower.map((c) => c.v)));
    const left = corners.filter((c) => c.x === Math.min(...corners.map((p) => p.x)));
    const right = corners.filter((c) => c.x === Math.max(...corners.map((p) => p.x)));
    expect(Math.max(...left.map((c) => c.u))).toBeLessThan(Math.min(...right.map((c) => c.u)));
  });
  it('keeps the reported buoy dimensions and blank lettering inside its silhouette', async () => {
    const scene = await load('landmarks/keys-landmarks');
    const root = scene.getObjectByName('southernmost_buoy')!;
    const size = new Box3().setFromObject(root).getSize(new Vector3());
    expect(size.y).toBeCloseTo(3.66, 3);
    expect(size.x).toBeCloseTo(2.13, 3);
    const sign = new Box3().setFromObject(scene.getObjectByName('southernmost_buoy_text')!);
    const body = new Box3().setFromObject(scene.getObjectByName('southernmost_buoy_body')!);
    expect(sign.getSize(new Vector3()).toArray()).toEqual(
      expect.arrayContaining([expect.closeTo(1.2, 3), expect.closeTo(0.9, 3)]),
    );
    expect(sign.min.x).toBeGreaterThan(body.min.x);
    expect(sign.max.x).toBeLessThan(body.max.x);
    expect(sign.min.y).toBeGreaterThan(1.35);
    expect(sign.max.y).toBeLessThan(2.3);
    expect(sign.max.z - body.max.z).toBeLessThan(0.004);
  });

  it('anchors Mallory pier at its landward deck edge with the seawall below it', async () => {
    const scene = await load('landmarks/keys-landmarks');
    const root = scene.getObjectByName('mallory_pier')!;
    const bounds = new Box3().setFromObject(root);
    expect(root.position.y).toBe(0);
    expect(bounds.min.y).toBeCloseTo(-1.8, 3);
    expect(bounds.min.z).toBeCloseTo(-12, 3);
    expect(bounds.max.z).toBe(0);
    expect(bounds.getSize(new Vector3()).x).toBe(30);
  });

  it('keeps bays tileable at their start and excludes an authored road surface', async () => {
    const scene = await load('scenery/seven-mile-kit');
    const bays = [
      ['nsm_bay', 41, 11.6, 6],
      ['nsm_bay_tall', 41, 11.6, 19.8],
      ['osm_arch_bay', 18, 6.7, 6],
      ['osm_girder_bay', 24, 6.7, 6],
      ['osm_rail_bay', 24, 6.7, 0],
      ['osm_gap_end', 8, 6.7, 6],
      ['staging_platform', 10, 8, 6],
    ] as const;
    for (const [name, length, width, depth] of bays) {
      const root = scene.getObjectByName(name)!;
      const bounds = new Box3().setFromObject(root);
      expect(root.userData, name).toMatchObject({ bay_m: length, deck_w_m: width, pier_m: depth });
      expect(bounds.min.z, name).toBeCloseTo(0, 3);
      expect(bounds.max.z, name).toBeCloseTo(length, 3);
      expect(bounds.min.y, name).toBeCloseTo(-depth, 3);
      let roadTriangles = 0;
      root.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        const p = mesh.geometry.getAttribute('position');
        const index = mesh.geometry.index;
        for (let i = 0; i < (index?.count ?? p.count); i += 3) {
          const corners = [0, 1, 2].map((j) =>
            new Vector3()
              .fromBufferAttribute(p, index ? index.getX(i + j) : i + j)
              .applyMatrix4(mesh.matrixWorld),
          );
          const [a, b, c] = corners as [Vector3, Vector3, Vector3];
          const normal = b.clone().sub(a).cross(c.clone().sub(a));
          if (
            normal.y > 0 &&
            corners.every((v) => Math.abs(v.y) < 0.0001 && Math.abs(v.x - root.position.x) < width / 2 - 0.2)
          )
            roadTriangles++;
        }
      });
      expect(roadTriangles, `${name} leaves its deck to the game`).toBe(0);
    }
  });

  it('keeps the planter palm sway from its fixed base to the leaf tips', async () => {
    const scene = await load('scenery/duval-kit');
    const body = scene.getObjectByName('duval_planter_palm_body')!;
    const values: number[] = [];
    body.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const sway = mesh.geometry.getAttribute('_sway');
      expect(sway).toBeDefined();
      values.push(...Array.from({ length: sway.count }, (_, i) => sway.getX(i)));
    });
    expect(values.length).toBeGreaterThan(0);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(1);
  });
});
