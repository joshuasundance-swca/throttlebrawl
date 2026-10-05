// CX5 acceptance rules come from the identity-model brief.
import { readFileSync, statSync } from 'node:fs';
import { Box3, Ray, Vector3, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { load, triangles as readTriangles, fingerprint, authoredState } from './cx5-reader.mjs';
type Corners = [Vector3, Vector3, Vector3];
function triangles(object: Object3D, relativeTo = object): Corners[] {
  return readTriangles(object, relativeTo) as Corners[];
}
function root(scene: Object3D, name: string): Object3D {
  const r = scene.getObjectByName(name);
  expect(r, name).toBeDefined();
  if (!r) throw new Error('Missing ' + name);
  return r;
}
function bounds(object: Object3D): Box3 {
  return new Box3().setFromPoints(triangles(object).flat());
}
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

// Literal caps freeze the brief rather than accepting a catalog budget increase.
const kits = [
  {
    name: 'gorge_landmarks',
    pack: 'region-pnw',
    asset: 'landmarks/gorge-landmarks',
    bytes: 60000,
    caps: {
      vista_house_lod0: 700,
      vista_house_lod1: 210,
      multnomah_falls_lod0: 900,
      multnomah_falls_lod1: 270,
      multnomah_lodge: 600,
      gorge_arch_bay: 560,
      gorge_arch_span_46: 880,
    },
  },
  {
    name: 'pnw_identity',
    pack: 'region-pnw',
    asset: 'scenery/pnw-identity',
    bytes: 20000,
    caps: { pnw_madrone_a: 220, pnw_madrone_b: 180, gorge_guard_wall: 120 },
  },
  {
    name: 'keys_identity',
    pack: 'base',
    asset: 'scenery/keys-identity',
    bytes: 60000,
    caps: {
      key_deer_buck: 220,
      key_deer_doe: 200,
      keys_mile_marker: 60,
      keys_banyan: 320,
      keys_poinciana: 220,
      keys_frangipani: 160,
      duval_open_bar_a: 480,
      duval_open_bar_b: 420,
    },
  },
  {
    name: 'keys_landmarks',
    pack: 'base',
    asset: 'landmarks/keys-landmarks',
    bytes: 45000,
    caps: { east_martello_lod0: 700, east_martello_lod1: 210, west_martello: 500 },
  },
  { name: 'pedicab', pack: 'base', asset: 'traffic/pedicab', bytes: 10000, caps: { vehicle: 380 } },
  {
    name: 'sf_identity',
    pack: 'region-sf',
    asset: 'scenery/sf-identity',
    bytes: 15000,
    caps: { sf_cypress: 220, sf_eucalyptus: 200 },
  },
  {
    name: 'sf_landmarks',
    pack: 'region-sf',
    asset: 'landmarks/sf-landmarks',
    bytes: 45000,
    caps: { sf_dragon_gate: 600, sf_twin_spire_lod0: 700, sf_twin_spire_lod1: 210 },
  },
  {
    name: 'pdx_landmarks',
    pack: 'region-pnw',
    asset: 'landmarks/pdx-landmarks',
    bytes: 62000,
    caps: { pdx_chinatown_gate: 500 },
  },
];
const pathOf = (kit: (typeof kits)[number]): string => `packs/${kit.pack}/assets/models/${kit.asset}.glb`;
async function sceneFor(name: string): Promise<Object3D> {
  return load(pathOf(kits.find((k) => k.name === name)!));
}

describe('CX5 identity contracts', () => {
  function roleTriangles(object: Object3D, role: string): Corners[] {
    const result: Corners[] = [];
    object.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some((m) => m.name === role)) result.push(...triangles(mesh, object));
    });
    return result;
  }

  it('keeps both reviewed Vista House roots exactly unchanged in round two', async () => {
    const saved = JSON.parse(readFileSync('tools/blender/cx5-gorge-baseline.json', 'utf8')) as Record<
      string,
      { triangles: number; sha256: string; authoredState: string }
    >;
    const scene = await sceneFor('gorge_landmarks');
    for (const [name, state] of Object.entries(saved)) {
      const original = state;
      const object = root(scene, name);
      expect(fingerprint(object)).toEqual({ triangles: original.triangles, sha256: original.sha256 });
      expect(authoredState(object)).toBe(original.authoredState);
    }
  });

  it.each(['multnomah_falls_lod0', 'multnomah_falls_lod1'])(
    '%s reads as a broad forested waterfall wall',
    async (name) => {
      const object = root(await sceneFor('gorge_landmarks'), name);
      const box = bounds(object);
      expect(box.min.x).toBeCloseTo(-80, 2);
      expect(box.max.x).toBeCloseTo(80, 2);
      expect(box.max.z - box.min.z).toBeLessThanOrEqual(30);
      const rock = roleTriangles(object, 'steel_dark').flat();
      expect(Math.max(...rock.filter((p) => Math.abs(p.x) < 21).map((p) => p.z))).toBeCloseTo(-20, 2);
      expect(Math.max(...rock.filter((p) => Math.abs(p.x) > 79).map((p) => p.z))).toBeCloseTo(0, 2);
      expect(
        roleTriangles(object, 'foliage_dark')
          .flat()
          .some((p) => p.y > 175),
      ).toBe(true);
      const upper = roleTriangles(object, 'falls_water')
        .flat()
        .filter((p) => p.y >= 25);
      const top = upper.filter((p) => p.y > 189);
      const foot = upper.filter((p) => p.y < 26);
      expect(Math.max(...top.map((p) => p.x)) - Math.min(...top.map((p) => p.x))).toBeCloseTo(8, 2);
      expect(Math.max(...foot.map((p) => p.x)) - Math.min(...foot.map((p) => p.x))).toBeGreaterThanOrEqual(
        14,
      );
      expect(Math.min(...upper.map((p) => p.z))).toBeGreaterThanOrEqual(-19.4 - 0.001);
      expect(roleTriangles(object, 'glass').length, 'dark plunge pool').toBeGreaterThan(0);
    },
  );

  it.each(['gorge_arch_bay', 'gorge_arch_span_46'])(
    '%s has continuous concrete ribs at both interior rib lines',
    async (name) => {
      const object = root(await sceneFor('gorge_landmarks'), name);
      const rib = roleTriangles(object, 'concrete');
      for (const x of [-3.6, 3.6]) {
        for (let z = 0.25; z < object.userData.bay_m; z += 2) {
          const ray = new Ray(new Vector3(x, -0.91, z), new Vector3(0, -1, 0));
          expect(
            rib.some(([a, b, c]) => ray.intersectTriangle(a, b, c, false, new Vector3()) !== null),
            `${name} rib at x=${x}, z=${z}`,
          ).toBe(true);
        }
      }
    },
  );

  it('gives the lodge low eaves, a steep roof, three dormers and a projecting gabled porch', async () => {
    const object = root(await sceneFor('gorge_landmarks'), 'multnomah_lodge');
    const roof = roleTriangles(object, 'roof').flat();
    expect(Math.min(...roof.map((p) => p.y))).toBeLessThanOrEqual(5);
    expect(Math.max(...roof.map((p) => p.y)) - Math.min(...roof.map((p) => p.y))).toBeGreaterThanOrEqual(7);
    expect(Math.max(...roof.map((p) => p.z)), 'entrance roof projects into street').toBeGreaterThanOrEqual(3);
    const windows = roleTriangles(object, 'glass')
      .flat()
      .filter((p) => p.y > 6);
    for (const x of [-10, 0, 10]) expect(windows.some((p) => Math.abs(p.x - x) < 1.5)).toBe(true);
    const stone = roleTriangles(object, 'stone').flat();
    expect(stone.filter((p) => p.y > 13 && p.x < 0).length).toBeGreaterThan(0);
    expect(stone.filter((p) => p.y > 13 && p.x > 0).length).toBeGreaterThan(0);
  });
  it.each(kits)(
    '$name has every new body, fits bytes and triangle caps, and winds closed parts outward',
    async (kit) => {
      expect(statSync(pathOf(kit)).size).toBeLessThanOrEqual(kit.bytes);
      const scene = await load(pathOf(kit));
      let closed = 0;
      for (const [name, cap] of Object.entries(kit.caps)) {
        if (cap === undefined) continue;
        const object = root(scene, name);
        expect(root(scene, `${name}_body`).parent).toBe(object);
        const count = triangles(object).length;
        expect(count, name).toBeGreaterThan(0);
        expect(count, name).toBeLessThanOrEqual(cap);
        expect(meshWindingFaults(object), name).toEqual([]);
        let draws = 0;
        object.traverse((node) => {
          const mesh = node as Mesh;
          if (mesh.isMesh) {
            draws += Array.isArray(mesh.material) ? mesh.material.length : 1;
            closed += closedParts(triangles(mesh, mesh)).length;
            expect(mesh.geometry.getAttribute('normal'), 'normals rebuilt by game').toBeUndefined();
          }
        });
        expect(draws, `${name} role draws`).toBeLessThanOrEqual(name === 'vehicle' ? 7 : 8);
      }
      expect(closed, 'winding check examined closed components').toBeGreaterThan(0);
    },
  );

  it.each([
    ['gorge_landmarks', 'vista_house'],
    ['gorge_landmarks', 'multnomah_falls'],
    ['keys_landmarks', 'east_martello'],
    ['sf_landmarks', 'sf_twin_spire'],
  ])('%s %s far silhouette keeps its box and at most 30 percent of triangles', async (kit, name) => {
    const scene = await sceneFor(kit);
    const near = root(scene, `${name}_lod0`);
    const far = root(scene, `${name}_lod1`);
    expect(triangles(far).length).toBeLessThanOrEqual(triangles(near).length * 0.3);
    const a = bounds(near),
      b = bounds(far),
      size = a.getSize(new Vector3());
    for (const axis of ['x', 'y', 'z'] as const)
      for (const end of ['min', 'max'] as const)
        expect(Math.abs(a[end][axis] - b[end][axis]), `${name} ${axis} ${end}`).toBeLessThanOrEqual(
          size[axis] * 0.05 + 0.001,
        );
  });

  it('leaves the game-owned arch decks and railings clear, with exact repeating lengths', async () => {
    const scene = await sceneFor('gorge_landmarks');
    for (const [name, length, pier] of [
      ['gorge_arch_bay', 24, 16],
      ['gorge_arch_span_46', 46, 28],
    ] as const) {
      const bay = root(scene, name),
        box = bounds(bay);
      expect(bay.userData).toMatchObject({ bay_m: length, deck_w_m: 11, pier_m: pier });
      expect(Math.abs(box.min.z)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(box.max.z - length)).toBeLessThanOrEqual(length * 0.01);
      expect(box.min.y).toBeCloseTo(-pier, 3);
      clear(bay, new Box3(new Vector3(-5.5, 0.00001, -Infinity), new Vector3(5.5, Infinity, Infinity)));
    }
  });

  it.each([
    ['sf_landmarks', 'sf_dragon_gate', 6, 6],
    ['pdx_landmarks', 'pdx_chinatown_gate', 4, 5.5],
  ] as const)('%s gate has a clear road opening', async (kit, name, halfWidth, height) => {
    const object = root(await sceneFor(kit), name);
    const low = triangles(object)
      .flat()
      .filter((p) => p.y > 0 && p.y < height);
    expect(low.length, 'posts are present beside opening').toBeGreaterThan(0);
    clear(
      object,
      new Box3(
        new Vector3(-halfWidth + 0.00001, 0.00001, -Infinity),
        new Vector3(halfWidth - 0.00001, height - 0.00001, Infinity),
      ),
    );
  });

  it('honours Vista House, banyan and guard wall footprints', async () => {
    const vista = root(await sceneFor('gorge_landmarks'), 'vista_house_lod0');
    expect(vista.userData.top_m).toBeGreaterThan(0);
    for (const p of triangles(vista).flat()) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(12.001);
    const banyan = root(await sceneFor('keys_identity'), 'keys_banyan');
    const low = triangles(banyan)
      .flat()
      .filter((p) => p.y < 2);
    expect(low.length).toBeGreaterThan(0);
    for (const p of low) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(5.001);
    const wall = bounds(root(await sceneFor('pnw_identity'), 'gorge_guard_wall'));
    expect(Math.abs(wall.min.x + 3)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(wall.max.x - 3)).toBeLessThanOrEqual(0.02);
  });

  it.each([
    ['keys_identity', 'keys_mile_marker', 'keys_mile_marker_face'],
    ['keys_identity', 'duval_open_bar_a', 'duval_open_bar_a_name'],
    ['keys_identity', 'duval_open_bar_b', 'duval_open_bar_b_name'],
    ['sf_landmarks', 'sf_dragon_gate', 'sf_dragon_gate_plaque'],
    ['pdx_landmarks', 'pdx_chinatown_gate', 'pdx_chinatown_gate_plaque'],
  ])('%s %s carries a blank front-facing text surface %s', async (kit, name, panelName) => {
    const scene = await sceneFor(kit),
      parent = root(scene, name),
      panel = root(scene, panelName);
    expect(panel.parent).toBe(parent);
    expect(panel.userData.text_surface).toBe(true);
    expect(panel.userData.width_m).toBeGreaterThan(0);
    expect(panel.userData.height_m).toBeGreaterThan(0);
    expect(triangles(panel).length, 'blank rectangle only').toBe(2);
    for (const [a, b, c] of triangles(panel, parent))
      expect(b.clone().sub(a).cross(c.clone().sub(a)).normalize().z).toBeGreaterThan(0.99);
    panel.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.isMesh) expect(mesh.geometry.getAttribute('uv')).toBeDefined();
    });
  });

  it('preserves every pre-existing landmark world-space triangle', async () => {
    const baseline = JSON.parse(readFileSync('tools/blender/cx5-baseline.json', 'utf8')) as Record<
      string,
      Record<string, { triangles: number; sha256: string; authoredState: string }>
    >;
    expect(Object.keys(baseline)).toHaveLength(3);
    for (const [kit, rows] of Object.entries(baseline)) {
      const scene = await sceneFor(kit);
      for (const [name, saved] of Object.entries(rows)) {
        const object = root(scene, name);
        expect(fingerprint(object), name).toEqual({ triangles: saved.triangles, sha256: saved.sha256 });
        expect(authoredState(object), `${name} attributes, transforms, roles and extras`).toBe(
          saved.authoredState,
        );
      }
    }
  });

  it('detects a triangle crossing a forbidden opening with all vertices outside it', () => {
    const box = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1));
    expect(intersectsBox([new Vector3(-4, 1, 0), new Vector3(4, 1, 0), new Vector3(4, 1.5, 0)], box)).toBe(
      true,
    );
    expect(intersectsBox([new Vector3(-4, 3, 0), new Vector3(4, 3, 0), new Vector3(4, 4, 0)], box)).toBe(
      false,
    );
  });

  it('retains the pedicab traffic dimensions, baked body and launch/lamp empties', async () => {
    const scene = await sceneFor('pedicab'),
      vehicle = root(scene, 'vehicle');
    expect(vehicle.userData).toMatchObject({ length_m: 2.6, width_m: 1.2, height_m: 1.9, class: 'car' });
    const box = bounds(vehicle),
      size = box.getSize(new Vector3());
    for (const [actual, wanted] of [
      [size.x, 1.2],
      [size.y, 1.9],
      [size.z, 2.6],
    ])
      expect(Math.abs(actual! - wanted!)).toBeLessThanOrEqual(wanted! * 0.02);
    for (const name of ['hood', 'light_head_l', 'light_head_r', 'light_tail_l', 'light_tail_r'])
      expect(root(scene, name).parent).toBe(vehicle);
    for (const key of ['wheelbase_m', 'hood_top_m', 'hood_front_m', 'hood_back_m'])
      expect(typeof vehicle.userData[key]).toBe('number');
  });

  it('distinguishes outward, reversed and folded closed components', () => {
    const p = [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
    const tetra: Corners[] = [
      [p[0]!, p[2]!, p[1]!],
      [p[0]!, p[1]!, p[3]!],
      [p[0]!, p[3]!, p[2]!],
      [p[1]!, p[2]!, p[3]!],
    ];
    expect(closedParts(tetra)).toHaveLength(1);
    expect(windingFaults(tetra)).toEqual([]);
    expect(windingFaults(tetra.map(([a, b, c]) => [a, c, b]))).not.toEqual([]);
    expect(windingFaults(tetra.map((t, i) => (i ? t : [t[0], t[2], t[1]]))).join()).toMatch(/same way twice/);
  });
});
