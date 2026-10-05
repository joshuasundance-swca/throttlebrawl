// CX3's geometry seams, measured in each root's own coordinates from the committed GLBs.
import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Triangle, Vector3, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';

type Corners = [Vector3, Vector3, Vector3];
type Axis = 'x' | 'y' | 'z';

async function load(asset: string): Promise<Object3D> {
  const bytes = readFileSync(`packs/region-sf/assets/models/${asset}.glb`);
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

function root(scene: Object3D, name: string): Object3D {
  const result = scene.getObjectByName(name);
  expect(result, `root ${name}`).toBeDefined();
  if (!result) throw new Error(`Missing root ${name}`);
  return result;
}

function triangles(object: Object3D, relativeTo = object): Corners[] {
  const inverse = relativeTo.matrixWorld.clone().invert();
  const result: Corners[] = [];
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const transform = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    const positions = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.index;
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      result.push(
        [0, 1, 2].map((j) =>
          new Vector3()
            .fromBufferAttribute(positions, index ? index.getX(i + j) : i + j)
            .applyMatrix4(transform),
        ) as Corners,
      );
    }
  });
  expect(result.length, `${object.name} has triangles`).toBeGreaterThan(0);
  return result;
}

function bounds(object: Object3D): Box3 {
  return new Box3().setFromPoints(triangles(object).flat());
}

// Clip the whole triangle against six half-spaces. Checking vertices alone would miss
// a portal strut with both ends outside the lane and its face crossing through it.
function intersectsBox(corners: Corners, box: Box3): boolean {
  let polygon: Vector3[] = corners;
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const [limit, direction] of [
      [box.min[axis], 1],
      [box.max[axis], -1],
    ] as const) {
      if (!Number.isFinite(limit)) continue;
      const next: Vector3[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]!;
        const b = polygon[(i + 1) % polygon.length]!;
        const da = direction * (a[axis] - limit);
        const db = direction * (b[axis] - limit);
        if (da >= 0) next.push(a);
        if (da >= 0 !== db >= 0) next.push(a.clone().lerp(b, da / (da - db)));
      }
      polygon = next;
      if (!polygon.length) return false;
    }
  }
  return polygon.length > 0;
}

function clear(object: Object3D, box: Box3): void {
  const hits = triangles(object).filter((t) => intersectsBox(t, box));
  expect(hits.length, `${object.name} triangles crossing the traffic envelope`).toBe(0);
}

function distanceToGeometry(object: Object3D, point: Vector3): number {
  return Math.min(
    ...triangles(object).map(([a, b, c]) =>
      new Triangle(a, b, c).closestPointToPoint(point, new Vector3()).distanceTo(point),
    ),
  );
}

function range(value: number, min: number, max: number, label: string): void {
  expect(value, label).toBeGreaterThanOrEqual(min - 0.00001);
  expect(value, label).toBeLessThanOrEqual(max + 0.00001);
}

function sameBox(a: Object3D, b: Object3D): void {
  const aa = bounds(a);
  const bb = bounds(b);
  const size = aa.getSize(new Vector3());
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(Math.abs(aa.min[axis] - bb.min[axis]), `${b.name} min ${axis}`).toBeLessThanOrEqual(
      size[axis] * 0.05 + 0.001,
    );
    expect(Math.abs(aa.max[axis] - bb.max[axis]), `${b.name} max ${axis}`).toBeLessThanOrEqual(
      size[axis] * 0.05 + 0.001,
    );
  }
}

function numericExtra(object: Object3D, key: string): number {
  const value: unknown = object.userData[key];
  expect(typeof value, `${object.name}.${key}`).toBe('number');
  if (typeof value !== 'number') throw new Error(`Missing numeric extra ${key}`);
  return value;
}

describe('SF geometry contract probes', () => {
  it('detects a spanning triangle even when every vertex misses the forbidden box', () => {
    const box = new Box3(new Vector3(-1, 55, -1), new Vector3(1, 82, 1));
    expect(
      intersectsBox([new Vector3(-20, 60, 0), new Vector3(20, 60, 0), new Vector3(20, 65, 0)], box),
    ).toBe(true);
    expect(
      intersectsBox([new Vector3(-20, 90, 0), new Vector3(20, 90, 0), new Vector3(20, 95, 0)], box),
    ).toBe(false);
    const point = new Vector3(0, 0, 0.4);
    expect(
      new Triangle(new Vector3(-2, -2, 0), new Vector3(2, -2, 0), new Vector3(0, 2, 0))
        .closestPointToPoint(point, new Vector3())
        .distanceTo(point),
    ).toBeCloseTo(0.4);
  });
});

describe('the Golden Gate kit', () => {
  it('provides the named roots, preserves the road opening and seats both main cables', async () => {
    const scene = await load('landmarks/golden-gate');
    const names = [
      'gg_tower_lod0',
      'gg_tower_lod1',
      'gg_bay_lod0',
      'gg_bay_lod1',
      'gg_suspender',
      'gg_anchorage',
      'gg_approach_pier',
      'gg_fort_arch',
    ];
    for (const name of names) root(scene, name);
    for (const name of ['gg_tower_lod0', 'gg_tower_lod1']) {
      const tower = root(scene, name);
      const box = bounds(tower);
      range(box.max.y, 226.5, 227.5, `${name} top`);
      expect(tower.userData).toMatchObject({ top_m: 225, cable_saddle_x_m: 17.5 });
      expect(box.min.y).toBeCloseTo(-numericExtra(tower, 'foundation_m'), 3);
      clear(tower, new Box3(new Vector3(-14.499, 55, -Infinity), new Vector3(14.499, 82, Infinity)));
      for (const side of [-1, 1]) {
        const saddle = new Vector3(
          side * numericExtra(tower, 'cable_saddle_x_m'),
          numericExtra(tower, 'top_m'),
          0,
        );
        expect(distanceToGeometry(tower, saddle), `${name} saddle ${side}`).toBeLessThanOrEqual(1);
      }
    }
    sameBox(root(scene, 'gg_tower_lod0'), root(scene, 'gg_tower_lod1'));
  });

  it('keeps repeated bays below the deck with independently stretchable suspenders', async () => {
    const scene = await load('landmarks/golden-gate');
    for (const name of ['gg_bay_lod0', 'gg_bay_lod1']) {
      const bay = root(scene, name);
      const box = bounds(bay);
      expect(bay.userData).toMatchObject({ bay_m: 15.24, deck_w_m: 27.6 });
      expect(box.min.z).toBeCloseTo(0, 3);
      expect(box.max.z).toBeCloseTo(15.24, 3);
      expect(box.max.y).toBeLessThanOrEqual(0.05);
      range(-box.min.y, 7.6, 8, `${name} depth`);
      expect(box.min.y).toBeCloseTo(-numericExtra(bay, 'pier_m'), 3);
      clear(
        bay,
        new Box3(new Vector3(-13.799, -Infinity, -Infinity), new Vector3(13.799, Infinity, Infinity)),
      );
    }
    sameBox(root(scene, 'gg_bay_lod0'), root(scene, 'gg_bay_lod1'));
    const suspender = root(scene, 'gg_suspender');
    expect(suspender.userData).toMatchObject({ unit_m: 1, cable_saddle_x_m: 17.5 });
    const ropes = bounds(suspender);
    expect(ropes.min.y).toBeCloseTo(0, 5);
    expect(ropes.max.y).toBeCloseTo(1, 5);
    for (const side of [-1, 1]) {
      const points = triangles(suspender)
        .flat()
        .filter((p) => side * p.x > 0);
      const box = new Box3().setFromPoints(points);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(side * 17.5, 3);
      range(box.getSize(new Vector3()).x, 0.1, 0.14, 'rope width');
      range(box.getSize(new Vector3()).z, 0.6, 0.64, 'paired rope spacing and thickness');
    }
  });

  it('keeps anchorage housings outside the continuing road and declares below-origin depths', async () => {
    const scene = await load('landmarks/golden-gate');
    const anchorage = root(scene, 'gg_anchorage');
    const box = bounds(anchorage);
    expect(anchorage.userData).toMatchObject({ foundation_m: 72, cable_entry_m: 6 });
    expect(box.min.y).toBeCloseTo(-72, 3);
    expect(box.max.z).toBeLessThanOrEqual(0.5);
    range(-box.min.z, 40, 50, 'anchorage length behind cable entry');
    clear(
      anchorage,
      new Box3(new Vector3(-14.499, -0.299, -Infinity), new Vector3(14.499, Infinity, -0.0001)),
    );
    for (const side of [-1, 1]) {
      expect(
        distanceToGeometry(anchorage, new Vector3(side * 17.5, numericExtra(anchorage, 'cable_entry_m'), 0)),
        `anchorage cable ${side}`,
      ).toBeLessThanOrEqual(1);
    }
    const pier = root(scene, 'gg_approach_pier');
    expect(pier.userData).toMatchObject({ height_m: 10, deck_w_m: 27.6 });
    expect(bounds(pier).min.y).toBeCloseTo(0, 3);
    expect(bounds(pier).max.y).toBeCloseTo(10, 3);
    const fort = root(scene, 'gg_fort_arch');
    expect(fort.userData).toMatchObject({ bay_m: 98, deck_w_m: 27.6, pier_m: 50 });
    expect(bounds(fort).min.y).toBeCloseTo(-50, 3);
    expect(bounds(fort).min.z).toBeCloseTo(0, 3);
    expect(bounds(fort).max.z).toBeCloseTo(98, 3);
  });
});

describe('SF landmarks', () => {
  it('fits Coit Tower inside its hilltop footprint and preserves the LOD silhouette', async () => {
    const scene = await load('landmarks/sf-landmarks');
    for (const name of ['coit_tower', 'coit_tower_lod1']) {
      const tower = root(scene, name);
      const box = bounds(tower);
      expect(tower.userData).toMatchObject({ foundation_m: 4 });
      expect(box.min.y).toBeCloseTo(-4, 3);
      range(box.max.y, 63.5, 64.5, `${name} height above root`);
      for (const axis of ['x', 'z'] as const) {
        expect(box.min[axis]).toBeGreaterThanOrEqual(-11.001);
        expect(box.max[axis]).toBeLessThanOrEqual(11.001);
      }
    }
    sameBox(root(scene, 'coit_tower'), root(scene, 'coit_tower_lod1'));
  });

  it('keeps the toll gantry and readers clear of traffic with a front-facing blank sign', async () => {
    const scene = await load('landmarks/sf-landmarks');
    const gantry = root(scene, 'toll_gantry');
    expect(gantry.userData).toMatchObject({ span_m: 31 });
    range(bounds(gantry).max.y, 8, 9, 'gantry height');
    clear(gantry, new Box3(new Vector3(-13.8, 0, -Infinity), new Vector3(13.8, 5.799, Infinity)));
    const low = triangles(gantry)
      .flat()
      .filter((p) => p.y >= 0 && p.y < 5.8);
    expect(low.length, 'posts exist below the beam').toBeGreaterThan(0);
    for (const p of low) expect(Math.abs(p.x), 'posts outside road').toBeGreaterThan(13.8);
    const sign = root(scene, 'toll_gantry_sign');
    expect(sign.userData).toMatchObject({ text_surface: true, width_m: 10, height_m: 1.6 });
    for (const [a, b, c] of triangles(sign, gantry)) {
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      expect(normal.z, 'sign faces +Z').toBeGreaterThan(0.99);
    }
  });
});

function outlineAt(object: Object3D, axis: Axis, height: number): Vector3[] {
  const vertices = triangles(object)
    .flat()
    .filter((p) => Math.abs(p[axis] - height) < 0.001);
  const unique = new Map<string, Vector3>();
  for (const v of vertices) unique.set(`${v.x.toFixed(3)},${v.z.toFixed(3)}`, new Vector3(v.x, 0, v.z));
  return [...unique.values()];
}

describe('SF stacked downtown modules', () => {
  it('uses exact module heights and identical top and bottom mid outlines', async () => {
    const scene = await load('scenery/sf-tower-modules');
    for (const style of ['glass', 'stone', 'screen', 'crown', 'midrise']) {
      const base = root(scene, `${style}_base`);
      const mid = root(scene, `${style}_mid`);
      const crown = root(scene, `${style}_crown`);
      for (const [object, height] of [
        [base, 7],
        [mid, 14],
      ] as const) {
        const box = bounds(object);
        expect(box.min.y).toBeCloseTo(0, 3);
        expect(Math.abs(box.max.y - height), `${object.name} height`).toBeLessThanOrEqual(0.01);
        range(box.getSize(new Vector3()).x, 24, 34, `${object.name} width`);
        expect(Math.abs((box.min.x + box.max.x) / 2), 'root at street-face middle').toBeLessThan(0.01);
        expect(Math.abs(box.max.z), 'street face at root +Z').toBeLessThan(0.01);
      }
      expect(bounds(crown).min.y).toBeCloseTo(0, 3);
      const bottom = outlineAt(mid, 'y', 0);
      const top = outlineAt(mid, 'y', 14);
      expect(bottom.length).toBeGreaterThanOrEqual(4);
      expect(top.length).toBeGreaterThanOrEqual(4);
      for (const [a, b] of [
        [bottom, top],
        [top, bottom],
        [bottom, outlineAt(base, 'y', 7)],
        [bottom, outlineAt(crown, 'y', 0)],
      ] as const) {
        for (const p of a)
          expect(Math.min(...b.map((q) => p.distanceTo(q))), `${style} stacking outline`).toBeLessThanOrEqual(
            0.01,
          );
      }
      const centre = bounds(mid).getCenter(new Vector3());
      for (const [a, b, c] of triangles(mid)) {
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        if (Math.abs(normal.y) > 0.001) continue;
        const outward = a
          .clone()
          .add(b)
          .add(c)
          .multiplyScalar(1 / 3)
          .sub(centre);
        expect(normal.dot(outward), `${style} mid side winds outward`).toBeGreaterThan(0);
      }
    }
    expect(root(scene, 'screen_crown_screen').userData.text_surface).toBe(true);
  });
});

describe('Lombard planting', () => {
  it('stays inside the hairpin radius and mirrors the paired beds', async () => {
    const scene = await load('scenery/lombard-kit');
    const left = root(scene, 'lombard_bed_curve_l');
    const right = root(scene, 'lombard_bed_curve_r');
    for (const bed of [left, right]) {
      const radius = numericExtra(bed, 'bed_r_m');
      range(radius, 0.1, 3, `${bed.name} bed radius`);
      for (const p of triangles(bed).flat())
        expect(Math.sqrt(p.x * p.x + p.z * p.z), bed.name).toBeLessThanOrEqual(radius + 0.001);
      expect(bounds(bed).min.y).toBeCloseTo(0, 3);
      expect(bounds(bed).max.y).toBeLessThanOrEqual(1.201);
    }
    const lp = triangles(left).flat();
    const rp = triangles(right).flat();
    for (const [source, target] of [
      [lp, rp],
      [rp, lp],
    ] as const) {
      for (const p of source) {
        const mirror = new Vector3(-p.x, p.y, p.z);
        expect(Math.min(...target.map((q) => mirror.distanceTo(q))), 'mirrored beds').toBeLessThan(0.001);
      }
    }
    const hedge = root(scene, 'lombard_hedge');
    expect(hedge.userData).toMatchObject({ length_m: 6 });
    const box = bounds(hedge);
    expect(box.min.x).toBeCloseTo(-3, 3);
    expect(box.max.x).toBeCloseTo(3, 3);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(1, 3);
    range(box.getSize(new Vector3()).z, 0.7, 0.9, 'hedge depth');
  });
});

describe('SF moving traffic', () => {
  it.each([
    ['sf-streetcar', 14, 2.6, 3.2, 'bus'],
    ['sf-trolleybus', 12.2, 2.55, 3.3, 'bus'],
    ['robotaxi', 4.8, 1.9, 1.9, 'car'],
    ['startup-shuttle', 11, 2.6, 3.4, 'bus'],
  ] as const)(
    'matches %s dimensions and the traffic node seam',
    async (asset, length, width, height, vehicleClass) => {
      const scene = await load(`traffic/${asset}`);
      const vehicle = root(scene, 'vehicle');
      for (const name of [
        'vehicle_body',
        'hood',
        'light_head_l',
        'light_head_r',
        'light_tail_l',
        'light_tail_r',
      ])
        root(scene, name);
      expect(vehicle.userData).toMatchObject({
        length_m: length,
        width_m: width,
        height_m: height,
        class: vehicleClass,
      });
      const box = bounds(vehicle);
      const size = box.getSize(new Vector3());
      expect(size.x).toBeCloseTo(width, 2);
      expect(size.y).toBeCloseTo(height, 2);
      expect(Math.abs(size.z - length), 'lamps included within CX1 size tolerance').toBeLessThanOrEqual(
        length * 0.02,
      );
      expect(box.min.y).toBeCloseTo(0, 3);
      vehicle.traverse((node) =>
        expect(node.userData.atlas_tile, 'traffic has no atlas surfaces').toBeUndefined(),
      );
    },
  );
});
