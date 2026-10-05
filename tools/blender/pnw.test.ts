// CX4's geometry seams, measured in each root's own coordinates from the committed GLBs.
import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Triangle, Vector3, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';

type Corners = [Vector3, Vector3, Vector3];
type Axis = 'x' | 'y' | 'z';

async function load(asset: string): Promise<Object3D> {
  const bytes = readFileSync(`packs/region-pnw/assets/models/${asset}.glb`);
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

// A part that closes on itself once the optimiser welds its corners (a tube bent round into a loop,
// say) must be one consistently wound, outward surface: the game culls back faces and the score's
// pre-export guard only sees the open pieces Blender made. Each mesh's triangles are welded by
// position, split into connected parts, and each closed part (every edge used twice) is checked:
// no edge runs the same way in two triangles (a twist or fold), and its signed volume is positive.
const at = (p: Vector3): string => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
function closedParts(tris: Corners[]): Corners[][] {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (const t of tris) for (const p of t) if (!parent.has(at(p))) parent.set(at(p), at(p));
  for (const [a, b, c] of tris) {
    parent.set(find(at(a)), find(at(b)));
    parent.set(find(at(b)), find(at(c)));
  }
  const parts = new Map<string, Corners[]>();
  for (const t of tris) {
    const r = find(at(t[0]));
    parts.set(r, [...(parts.get(r) ?? []), t]);
  }
  return [...parts.values()].filter((part) => {
    const uses = new Map<string, number>();
    for (const t of part)
      for (let i = 0; i < 3; i++) {
        const [a, b] = [at(t[i]!), at(t[(i + 1) % 3]!)].sort();
        uses.set(`${a}|${b}`, (uses.get(`${a}|${b}`) ?? 0) + 1);
      }
    return [...uses.values()].every((n) => n === 2);
  });
}
function windingFaults(part: Corners[]): string[] {
  const directed = new Set<string>();
  let twisted = 0;
  let volume = 0;
  for (const [a, b, c] of part) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = `${at(p)}>${at(q)}`;
      if (directed.has(k)) twisted++;
      directed.add(k);
    }
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  const faults: string[] = [];
  if (twisted) faults.push(`${twisted} edges wound the same way twice`);
  if (!(volume > 0)) faults.push(`signed volume ${volume.toExponential(2)}`);
  return faults;
}
function meshWindingFaults(object: Object3D): string[] {
  const faults: string[] = [];
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    for (const part of closedParts(triangles(mesh, mesh)))
      for (const f of windingFaults(part)) faults.push(`${mesh.name}: ${f}`);
  });
  return faults;
}

describe('PNW geometry contract probes', () => {
  it('reads a closed box wound outward as sound, and the same box flipped or folded as faulty', () => {
    const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
    const c = [
      v(0, 0, 0),
      v(1, 0, 0),
      v(1, 1, 0),
      v(0, 1, 0),
      v(0, 0, 1),
      v(1, 0, 1),
      v(1, 1, 1),
      v(0, 1, 1),
    ];
    const quads = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    const box: Corners[] = quads.flatMap(([a, b, d, e]) => [
      [c[a!]!, c[b!]!, c[d!]!],
      [c[a!]!, c[d!]!, c[e!]!],
    ]);
    expect(closedParts(box)).toHaveLength(1);
    expect(windingFaults(box)).toEqual([]);
    expect(windingFaults(box.map(([a, b, d]) => [a, d, b] as Corners))).not.toEqual([]);
    const folded = box.map((t, i) => (i === 0 ? ([t[0], t[2], t[1]] as Corners) : t));
    expect(windingFaults(folded).join()).toMatch(/same way twice/);
  });

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

describe('CX4 winding', () => {
  it.each([
    'landmarks/pdx-landmarks',
    'scenery/pdx-downtown',
    'traffic/pdx-streetcar',
    'traffic/wagon-with-kayaks',
    'traffic/camper-van',
    'traffic/log-truck',
  ])('winds every closed part of %s outward, with no twist', async (asset) => {
    const scene = await load(asset);
    expect(meshWindingFaults(scene)).toEqual([]);
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

function envelope(x: number, y0: number, y1: number): Box3 {
  return new Box3(
    new Vector3(-x + 0.001, y0 + 0.001, -Infinity),
    new Vector3(x - 0.001, y1 - 0.001, Infinity),
  );
}

function textFace(scene: Object3D, parent: Object3D, name: string, width: number, height: number): void {
  const panel = root(scene, name);
  expect(panel.parent).toBe(parent);
  expect(panel.userData).toMatchObject({ text_surface: true, width_m: width, height_m: height });
  panel.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh) {
      expect(Array.isArray(mesh.material)).toBe(false);
      expect(mesh.geometry.getAttribute('uv')).toBeDefined();
    }
  });
  for (const [a, b, c] of triangles(panel, parent))
    expect(b.clone().sub(a).cross(c.clone().sub(a)).normalize().z).toBeGreaterThan(0.99);
}

describe('Portland landmark kit', () => {
  it('has no repeated triangle faces in the operator houses or roof-sign building', async () => {
    const scene = await load('landmarks/pdx-landmarks');
    for (const name of ['pdx_bascule_pier', 'pdx_roof_sign']) {
      const faces = triangles(root(scene, name)).map((corners) =>
        corners
          .map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`)
          .sort()
          .join('|'),
      );
      expect(new Set(faces).size, `${name} exact duplicate triangles flicker`).toBe(faces.length);
    }
  });
  it('has both clear lift portals with exact deck-relative piers and compatible LODs', async () => {
    const scene = await load('landmarks/pdx-landmarks');
    for (const name of ['pdx_lift_tower_lod0', 'pdx_lift_tower_lod1']) {
      const tower = root(scene, name);
      expect(tower.userData).toMatchObject({ top_m: 36, foundation_m: 20, deck_w_m: 19 });
      const box = bounds(tower);
      expect(box.min.y).toBeCloseTo(-20, 3);
      range(box.max.y, 35, 37, 'sheave top');
      range(box.min.z, -5, 0, 'portal extent');
      range(box.max.z, 0, 5, 'portal extent');
      for (const p of triangles(tower).flat()) expect(Math.abs(p.x)).toBeLessThanOrEqual(16);
      clear(tower, envelope(10.5, -1.5, 30));
    }
    const near = root(scene, 'pdx_lift_tower_lod0');
    const far = root(scene, 'pdx_lift_tower_lod1');
    sameBox(near, far);
    expect(triangles(far).length / triangles(near).length).toBeLessThanOrEqual(0.3);
  });

  it('keeps both through-truss bays and bascule houses clear of the road', async () => {
    const scene = await load('landmarks/pdx-landmarks');
    for (const [name, length] of [
      ['pdx_truss_bay', 40],
      ['pdx_lift_span', 64],
    ] as const) {
      const bay = root(scene, name);
      expect(bay.userData).toMatchObject({ bay_m: length, deck_w_m: 19, pier_m: 1.5 });
      const box = bounds(bay);
      expect(box.min.z).toBeCloseTo(0, 3);
      expect(box.max.z).toBeCloseTo(length, 3);
      expect(box.min.y).toBeCloseTo(-1.5, 3);
      clear(bay, envelope(10, -0.3, 6.5));
    }
    const pier = root(scene, 'pdx_bascule_pier');
    expect(pier.userData).toMatchObject({ foundation_m: 18, deck_w_m: 19 });
    expect(bounds(pier).min.y).toBeCloseTo(-18, 3);
    range(bounds(pier).max.y, 9, 11, 'operator house roofs');
    range(bounds(pier).min.z, -8, 0, 'pier extent');
    range(bounds(pier).max.z, 0, 8, 'pier extent');
    clear(pier, envelope(10.5, -1.5, Infinity));
  });

  it('places Gothic towers at the waterline with deck portals and cable saddles', async () => {
    const scene = await load('landmarks/pdx-landmarks');
    for (const name of ['pdx_st_johns_tower_lod0', 'pdx_st_johns_tower_lod1']) {
      const tower = root(scene, name);
      expect(tower.userData).toMatchObject({ top_m: 125, cable_saddle_x_m: 12, deck_y_m: 62, deck_w_m: 19 });
      expect(bounds(tower).min.y).toBeCloseTo(-numericExtra(tower, 'foundation_m'), 3);
      expect(bounds(tower).max.y).toBeCloseTo(125, 3);
      clear(tower, envelope(10.5, 60.5, 70));
      for (const side of [-1, 1])
        expect(distanceToGeometry(tower, new Vector3(side * 12, 125, 0))).toBeLessThanOrEqual(1);
    }
    const near = root(scene, 'pdx_st_johns_tower_lod0');
    const far = root(scene, 'pdx_st_johns_tower_lod1');
    sameBox(near, far);
    expect(triangles(far).length / triangles(near).length).toBeLessThanOrEqual(0.3);
  });

  it('leaves sign words blank and models the original salmon and rain-cloud plaza', async () => {
    const scene = await load('landmarks/pdx-landmarks');
    const sign = root(scene, 'pdx_roof_sign');
    expect(sign.userData).toMatchObject({ roof_m: 12 });
    textFace(scene, sign, 'pdx_roof_sign_words', 16, 3.2);
    const salmon = root(scene, 'pdx_roof_sign_salmon');
    expect(salmon.parent).toBe(sign);
    const mesh = salmon as Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    expect(materials.some((m) => m.name === 'neon')).toBe(true);
    const fish = new Box3().setFromPoints(triangles(salmon, sign).flat());
    expect(fish.min.y).toBeGreaterThan(12);
    range(fish.getSize(new Vector3()).x, 7.5, 8.5, 'salmon nose to tail');
    expect(fish.getSize(new Vector3()).z, 'body neon stays thick enough to read').toBeGreaterThan(0.28);
    const mounts = root(scene, 'pdx_roof_sign_mounts');
    expect(mounts.parent).toBe(sign);
    const mountBox = new Box3().setFromPoints(triangles(mounts, sign).flat());
    range(mountBox.min.y, 16.8, 17.3, 'mounts start at the board frame');
    range(mountBox.max.y, 19.3, 19.8, 'mounts reach the belly');
    range(bounds(sign).max.y, 20, 22, 'roof sign top');
    const plaza = root(scene, 'pdx_plaza');
    expect(plaza.userData).toMatchObject({ column_top_m: 13 });
    const column = root(scene, 'pdx_plaza_weather');
    const cb = new Box3().setFromPoints(triangles(column, plaza).flat());
    expect(cb.max.y).toBeCloseTo(13, 2);
    range(cb.getCenter(new Vector3()).x, -23, -17, 'column street edge');
    const paving = root(scene, 'pdx_plaza_paving');
    const pb = new Box3().setFromPoints(triangles(paving, plaza).flat());
    expect(pb.max.y).toBeLessThanOrEqual(0.15);
    expect(pb.getSize(new Vector3()).x).toBeCloseTo(56, 3);
    expect(pb.getSize(new Vector3()).z).toBeCloseTo(56, 3);
  });
});

describe('Downtown Portland', () => {
  it('uses street-centred origins and matching pink tower module outlines', async () => {
    const scene = await load('scenery/pdx-downtown');
    for (const name of [
      'pdx_cast_iron',
      'pdx_brick_loft',
      'pdx_office_block',
      'pdx_pink_tower_base',
      'pdx_pink_tower_mid',
      'pdx_pink_tower_crown',
    ]) {
      const building = root(scene, name);
      const box = bounds(building);
      expect(box.min.y).toBeCloseTo(0, 3);
      expect(Math.abs(box.max.z)).toBeLessThan(0.011);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 2);
      let panels = 0;
      building.traverse((n) => {
        if (n.userData.atlas_tile) panels++;
      });
      expect(panels).toBeGreaterThan(0);
    }
    const base = root(scene, 'pdx_pink_tower_base');
    const mid = root(scene, 'pdx_pink_tower_mid');
    const crown = root(scene, 'pdx_pink_tower_crown');
    expect(bounds(base).max.y).toBeCloseTo(7, 3);
    expect(bounds(mid).max.y).toBeCloseTo(14, 3);
    const bottom = outlineAt(mid, 'y', 0);
    expect(bottom.length).toBeGreaterThanOrEqual(4);
    for (const target of [outlineAt(mid, 'y', 14), outlineAt(base, 'y', 7), outlineAt(crown, 'y', 0)]) {
      for (const [a, b] of [
        [bottom, target],
        [target, bottom],
      ] as const) {
        for (const p of a) expect(Math.min(...b.map((q) => p.distanceTo(q)))).toBeLessThanOrEqual(0.01);
      }
    }
  });
  it('provides three front-facing cart name surfaces and a bike rack', async () => {
    const scene = await load('scenery/pdx-downtown');
    for (const suffix of ['a', 'b', 'c']) {
      const cart = root(scene, `pdx_food_cart_${suffix}`);
      const name = `pdx_food_cart_${suffix}_name`;
      const panel = root(scene, name);
      textFace(scene, cart, name, numericExtra(panel, 'width_m'), numericExtra(panel, 'height_m'));
      expect(bounds(cart).min.y).toBeCloseTo(0, 3);
    }
    root(scene, 'pdx_bike_rack');
  });
});

describe('PNW moving traffic', () => {
  it('gives the log truck a tall conventional cab and a raised squared hood', async () => {
    const truck = root(await load('traffic/log-truck'), 'vehicle');
    const roof = triangles(truck)
      .flat()
      .filter((p) => p.z > 3.4 && p.z < 5.8 && p.y > 3.2);
    expect(roof.length, 'day-cab roof reaches at least 3.2 m').toBeGreaterThan(0);
    range(numericExtra(truck, 'hood_top_m'), 1.8, 2.2, 'squared truck hood');
    range(numericExtra(truck, 'hood_back_m'), 5.4, 5.8, 'cab ahead of bunks');
  });

  it('has a visible fabric pop-top beneath the camper canoe', async () => {
    const camper = root(await load('traffic/camper-van'), 'vehicle');
    let canvas = false;
    camper.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        if (material.name === 'canvas') canvas = true;
    });
    expect(canvas, 'raised fabric section uses canvas role').toBe(true);
  });

  it.each([
    ['pdx-streetcar', 20, 2.5, 3.9, 'bus'],
    ['wagon-with-kayaks', 4.8, 1.8, 2.1, 'car'],
    ['camper-van', 6.6, 2.2, 3, 'truck'],
    ['log-truck', 16, 2.6, 3.9, 'truck'],
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
      const hood = root(scene, 'hood');
      expect(hood.parent).toBe(vehicle);
      for (const key of ['wheelbase_m', 'hood_top_m', 'hood_front_m', 'hood_back_m'])
        numericExtra(vehicle, key);
      expect(hood.position.y).toBeCloseTo(numericExtra(vehicle, 'hood_top_m'), 3);
      expect(hood.position.z).toBeCloseTo(
        (numericExtra(vehicle, 'hood_front_m') + numericExtra(vehicle, 'hood_back_m')) / 2,
        3,
      );
      let primaryPaint = false;
      vehicle.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (material.name === 'paint_primary') {
            primaryPaint = true;
            expect((material as import('three').MeshStandardMaterial).color.getHexString()).toBe('ffffff');
          }
        }
      });
      expect(primaryPaint).toBe(true);
      vehicle.traverse((node) =>
        expect(node.userData.atlas_tile, 'traffic has no atlas surfaces').toBeUndefined(),
      );
    },
  );
});
