// CX7 acceptance rules (playtest 4, P4-19, identity sheet row D5): a short island tram that fits the
// `base:island-tram` traffic type. The CX2 tour tram is 18 m and the type is held at its length
// because the rival AI sizes every vehicle by the race's largest traffic type (#500), so that model
// cannot stand for it. This one is built to the type's own size. Model only: no row draws it yet.
import { readFileSync, statSync } from 'node:fs';
import { Box3, Vector3, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { load, triangles as readTriangles } from './cx5-reader.mjs';

type Corners = [Vector3, Vector3, Vector3];
const triangles = (object: Object3D, relativeTo: Object3D = object): Corners[] =>
  readTriangles(object, relativeTo) as Corners[];

const GLB = 'packs/base/assets/models/traffic/island-tram.glb';
const TYPE = JSON.parse(readFileSync('packs/base/traffic/island-tram.json', 'utf8')) as {
  lengthM: number;
  widthM: number;
};
// The brief's caps, frozen here so a catalog budget change cannot loosen them silently.
const BYTES = 14000;
const TRIS = 620;
const DRAWS = 7;

function root(scene: Object3D, name: string): Object3D {
  const r = scene.getObjectByName(name);
  expect(r, name).toBeDefined();
  if (!r) throw new Error(`missing ${name}`);
  return r;
}
function roleTriangles(object: Object3D, role: string): Corners[] {
  const out: Corners[] = [];
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((m) => m.name === role)) out.push(...triangles(mesh, object));
  });
  return out;
}

// Closed parts must wind outward (the game culls back faces), as cx6.test.ts checks them.
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
  for (const t of tris) parts.set(find(at(t[0])), [...(parts.get(find(at(t[0]))) ?? []), t]);
  return [...parts.values()].filter((part) => {
    const uses = new Map<string, number>();
    for (const t of part)
      for (let i = 0; i < 3; i++) {
        const k = [at(t[i]!), at(t[(i + 1) % 3]!)].sort().join('|');
        uses.set(k, (uses.get(k) ?? 0) + 1);
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

describe('CX7: the short island tram (sheet D5)', () => {
  it('fits its byte, triangle and draw caps, ships no normals, and winds every closed part outward', async () => {
    expect(statSync(GLB).size, 'GLB bytes').toBeLessThanOrEqual(BYTES);
    const scene = await load(GLB);
    const vehicle = root(scene, 'vehicle');
    const body = root(scene, 'vehicle_body');
    expect(body.parent).toBe(vehicle);
    expect(triangles(vehicle).length).toBeLessThanOrEqual(TRIS);
    let draws = 0;
    let closed = 0;
    vehicle.traverse((n) => {
      const mesh = n as Mesh;
      if (!mesh.isMesh) return;
      draws += Array.isArray(mesh.material) ? mesh.material.length : 1;
      expect(mesh.geometry.getAttribute('normal'), `${mesh.name}: normals are the game's`).toBeUndefined();
      for (const part of closedParts(triangles(mesh, mesh))) {
        closed++;
        expect(windingFaults(part), mesh.name).toEqual([]);
      }
    });
    for (const part of closedParts(triangles(vehicle))) {
      closed++;
      expect(windingFaults(part), 'a closed part across roles').toEqual([]);
    }
    expect(draws).toBeLessThanOrEqual(DRAWS);
    expect(closed, 'the winding check examined closed parts').toBeGreaterThan(0);
  });

  it("is its traffic type's size, and no longer (the rival AI sizes by the largest vehicle)", async () => {
    const vehicle = root(await load(GLB), 'vehicle');
    const box = new Box3().setFromPoints(triangles(vehicle).flat());
    const size = box.getSize(new Vector3());
    const ex = vehicle.userData as Record<string, number>;
    expect(size.z, 'length').toBeLessThanOrEqual(TYPE.lengthM * 1.005);
    expect(size.z, 'length').toBeGreaterThanOrEqual(TYPE.lengthM * 0.98);
    expect(Math.abs(size.x / TYPE.widthM - 1), 'width').toBeLessThanOrEqual(0.02);
    expect(Math.abs(size.z / ex['length_m']! - 1)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(size.x / ex['width_m']! - 1)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(size.y / ex['height_m']! - 1)).toBeLessThanOrEqual(0.02);
    expect(size.y, 'an open tram, not a bus').toBeGreaterThanOrEqual(2.2);
    expect(size.y).toBeLessThanOrEqual(3.0);
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(Math.abs(box.max.x + box.min.x), 'centred across').toBeLessThan(0.02);
  });

  it('is a tractor pulling open cars: wheels on at least three axles, the hood and headlamps at the front', async () => {
    const vehicle = root(await load(GLB), 'vehicle');
    const tyres = roleTriangles(vehicle, 'tyre').flat();
    expect(tyres.length).toBeGreaterThan(0);
    // Axles: tyre geometry clustered along the length, a cluster ending where a 0.3 m gap opens.
    const zs = [...new Set(tyres.map((p) => Math.round(p.z * 100) / 100))].sort((a, b) => a - b);
    let axles = 1;
    for (let i = 1; i < zs.length; i++) if (zs[i]! - zs[i - 1]! > 0.3) axles++;
    expect(axles, 'axles').toBeGreaterThanOrEqual(3);
    const ex = vehicle.userData as Record<string, number | string>;
    expect(['car', 'truck', 'bus', 'trailer']).toContain(ex['class']);
    const hood = root(vehicle, 'hood');
    expect(hood.position.z, 'the hood is at the front (+Z)').toBeGreaterThan(0);
    expect(hood.position.y).toBeCloseTo(ex['hood_top_m'] as number, 1);
    for (const side of ['l', 'r']) {
      expect(root(vehicle, `light_head_${side}`).position.z).toBeGreaterThan(0);
      expect(root(vehicle, `light_tail_${side}`).position.z).toBeLessThan(0);
    }
    const white = roleTriangles(vehicle, 'paint_primary');
    expect(white.length, 'paint_primary carries the type tint').toBeGreaterThan(0);
  });

  it('holds no words: no text surface and no side panel', async () => {
    const scene = await load(GLB);
    scene.traverse((n) => {
      expect(n.userData['text_surface'], n.name).toBeUndefined();
      expect(n.name).not.toBe('side_panel');
    });
  });
});
