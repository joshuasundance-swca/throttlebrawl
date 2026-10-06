// CX6 acceptance rules (playtest 4, P4-19: "The real roads do not have the characteristics of the
// roads in question in terms of scenery and feel"). They come from the identity sheets' rows R3, R4,
// M3, G2, T1, D6, S5, H1, H2 and I3, as the CX6 brief sets them: San Francisco's apartment and corner
// buildings, the flatiron and the mission church, the headlands' battery and scrub, Twin Peaks' chert,
// a docked cruise ship, an osprey post, Chuckanut's sandstone and Lake Samish's shore. Models only:
// no route places them yet.
import { readFileSync, statSync } from 'node:fs';
import { Box3, Vector3, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { authoredState, fingerprint, load, triangles as readTriangles } from './cx5-reader.mjs';

type Corners = [Vector3, Vector3, Vector3];
const triangles = (object: Object3D, relativeTo: Object3D = object): Corners[] =>
  readTriangles(object, relativeTo) as Corners[];
function root(scene: Object3D, name: string): Object3D {
  const r = scene.getObjectByName(name);
  expect(r, name).toBeDefined();
  if (!r) throw new Error(`missing ${name}`);
  return r;
}
const bounds = (object: Object3D): Box3 => new Box3().setFromPoints(triangles(object).flat());
const normal = ([a, b, c]: Corners): Vector3 => b.clone().sub(a).cross(c.clone().sub(a)).normalize();
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

// Closed parts must wind outward (the game culls back faces): weld by position, split into connected
// parts, and check each closed one for an edge run the same way twice and for a positive volume.
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

// The brief's caps, frozen here so a catalog budget change cannot loosen them silently.
const kits = [
  {
    name: 'sf_apartments',
    pack: 'region-sf',
    asset: 'scenery/sf-apartments',
    bytes: 45000,
    caps: {
      sf_flats_a: 260,
      sf_flats_b: 260,
      sf_apartment_a: 420,
      sf_apartment_b: 420,
      sf_corner_l: 460,
      sf_corner_r: 460,
    },
  },
  {
    name: 'sf_landmarks',
    pack: 'region-sf',
    asset: 'landmarks/sf-landmarks',
    bytes: 60000,
    caps: { sf_flatiron_lod0: 600, sf_flatiron_lod1: 180, sf_mission_church: 360 },
  },
  {
    name: 'sf_headlands',
    pack: 'region-sf',
    asset: 'scenery/sf-headlands',
    bytes: 12000,
    caps: { gg_battery: 240, coyote_brush: 60, sf_chert_outcrop: 120 },
  },
  {
    name: 'keys_landmarks',
    pack: 'base',
    asset: 'landmarks/keys-landmarks',
    bytes: 45000,
    caps: { cruise_ship_lod0: 500, cruise_ship_lod1: 150 },
  },
  {
    name: 'keys_identity',
    pack: 'base',
    asset: 'scenery/keys-identity',
    bytes: 60000,
    caps: { keys_osprey_post: 120 },
  },
  {
    name: 'pnw_shore',
    pack: 'region-pnw',
    asset: 'scenery/pnw-shore',
    bytes: 30000,
    caps: {
      chuckanut_rockcut: 140,
      chuckanut_rockcut_tall: 180,
      chuckanut_parapet: 80,
      chuckanut_bluff: 260,
      chuckanut_boulder_a: 60,
      chuckanut_boulder_b: 60,
      samish_lake_house: 260,
      samish_dock: 140,
    },
  },
];
const pathOf = (name: string): string => {
  const kit = kits.find((k) => k.name === name)!;
  return `packs/${kit.pack}/assets/models/${kit.asset}.glb`;
};
const sceneFor = (name: string): Promise<Object3D> => load(pathOf(name));
const node = async (kit: string, name: string): Promise<Object3D> => root(await sceneFor(kit), name);

describe('CX6 identity models: budgets and build contract', () => {
  it.each(kits)(
    '$name: every new root has its body, fits its byte and triangle caps, and winds outward',
    async (kit) => {
      expect(statSync(pathOf(kit.name)).size, 'GLB bytes').toBeLessThanOrEqual(kit.bytes);
      const scene = await sceneFor(kit.name);
      let closed = 0;
      for (const [name, cap] of Object.entries(kit.caps)) {
        const object = root(scene, name);
        expect(root(scene, `${name}_body`).parent, `${name}_body`).toBe(object);
        const count = triangles(object).length;
        expect(count, name).toBeGreaterThan(0);
        expect(count, name).toBeLessThanOrEqual(cap);
        let draws = 0;
        object.traverse((n) => {
          const mesh = n as Mesh;
          if (!mesh.isMesh) return;
          draws += Array.isArray(mesh.material) ? mesh.material.length : 1;
          expect(
            mesh.geometry.getAttribute('normal'),
            `${mesh.name}: normals are the game's`,
          ).toBeUndefined();
          for (const part of closedParts(triangles(mesh, mesh))) {
            closed++;
            expect(windingFaults(part), mesh.name).toEqual([]);
          }
        });
        expect(draws, `${name} draws`).toBeLessThanOrEqual(8);
        // A closed part can span roles (a sandstone bed with a moss top): the loader splits each role
        // into its own mesh, so the check above never sees it whole. Weld the root's triangles too.
        for (const part of closedParts(triangles(object))) {
          closed++;
          expect(windingFaults(part), `${name}: a closed part across roles`).toEqual([]);
        }
      }
      expect(closed, 'the winding check examined closed parts').toBeGreaterThan(0);
    },
  );

  it('flags reversed and folded closed parts (the winding check can fail)', () => {
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
  });

  it('leaves every node that was in an extended kit before CX6 exactly as it was', async () => {
    const baseline = JSON.parse(readFileSync('tools/blender/cx6-baseline.json', 'utf8')) as Record<
      string,
      Record<string, { triangles: number; sha256: string; authoredState: string }>
    >;
    for (const [kit, rows] of Object.entries(baseline)) {
      const scene = await sceneFor(kit);
      for (const [name, saved] of Object.entries(rows)) {
        const object = root(scene, name);
        expect(fingerprint(object), `${kit} ${name}`).toEqual({
          triangles: saved.triangles,
          sha256: saved.sha256,
        });
        expect(authoredState(object), `${kit} ${name}: transforms, roles, attributes and extras`).toBe(
          saved.authoredState,
        );
      }
    }
  });

  it.each([
    ['sf_landmarks', 'sf_flatiron'],
    ['keys_landmarks', 'cruise_ship'],
  ])('%s %s: the far stand-in keeps its box with at most 30 percent of the triangles', async (kit, name) => {
    const scene = await sceneFor(kit);
    const near = root(scene, `${name}_lod0`);
    const far = root(scene, `${name}_lod1`);
    expect(triangles(far).length).toBeLessThanOrEqual(triangles(near).length * 0.3);
    const a = bounds(near);
    const b = bounds(far);
    const size = a.getSize(new Vector3());
    for (const axis of ['x', 'y', 'z'] as const)
      for (const end of ['min', 'max'] as const)
        expect(Math.abs(a[end][axis] - b[end][axis]), `${name} ${axis} ${end}`).toBeLessThanOrEqual(
          size[axis] * 0.05 + 0.001,
        );
  });
});

describe('CX6: San Francisco apartments and corners fit the terrace plots (R3)', () => {
  // A house plot is 7 m along the road (scenery.ts SCATTER_SPACING_M) and 11.5 m deep (DEPTH_M);
  // the front wall is the root, the facade faces +Z, and a stoop or bay may reach 2.6 m toward the
  // road (the house's setback, ACROSS_M). A two-plot building takes two plots side by side.
  it.each([
    ['sf_flats_a', 1, 13, 16.5],
    ['sf_flats_b', 1, 13, 16.5],
    ['sf_apartment_a', 2, 16, 20],
    ['sf_apartment_b', 2, 18, 22],
    ['sf_corner_l', 2, 13.5, 17],
    ['sf_corner_r', 2, 13.5, 17],
  ] as const)('%s fills %i plot(s) and stands %f to %f m', async (name, plots, low, high) => {
    const object = await node('sf_apartments', name);
    expect(object.userData).toMatchObject({ plots });
    const box = bounds(object);
    const half = plots * 3.5;
    expect(box.min.x, 'left plot edge').toBeGreaterThanOrEqual(-half - 0.001);
    expect(box.max.x, 'right plot edge').toBeLessThanOrEqual(half + 0.001);
    expect(box.max.x - box.min.x, 'fills its plots').toBeGreaterThanOrEqual(plots * 7 - 1);
    expect(box.min.z, 'plot depth').toBeGreaterThanOrEqual(-11.5 - 0.001);
    expect(box.max.z, 'reach toward the road').toBeLessThanOrEqual(2.6 + 0.001);
    expect(box.max.y).toBeGreaterThanOrEqual(low);
    expect(box.max.y).toBeLessThanOrEqual(high);
    expect(box.min.y, 'stands on its plot').toBeGreaterThanOrEqual(-1.5);
    const frontGlass = roleTriangles(object, 'glass').filter((t) => normal(t).z > 0.9);
    expect(frontGlass.length, 'windows on the front').toBeGreaterThan(0);
  });

  it.each([
    ['sf_corner_l', -1],
    ['sf_corner_r', 1],
  ] as const)(
    '%s turns its corner: windows on its open side, and a blank shop sign facing the road',
    async (name, side) => {
      const scene = await sceneFor('sf_apartments');
      const object = root(scene, name);
      const sideGlass = roleTriangles(object, 'glass').filter((t) => normal(t).x * side > 0.9);
      expect(sideGlass.length, 'windows on the cross-street side').toBeGreaterThan(0);
      const sign = root(scene, `${name}_sign`);
      expect(sign.parent).toBe(object);
      expect(sign.userData).toMatchObject({ text_surface: true });
      expect(sign.userData.width_m).toBeGreaterThan(0);
      expect(sign.userData.height_m).toBeGreaterThan(0);
      const tris = triangles(sign, object);
      expect(tris.length, 'a blank rectangle').toBe(2);
      for (const t of tris) expect(normal(t).z).toBeGreaterThan(0.99);
    },
  );
});

describe('CX6: San Francisco landmarks and headlands (R4, M3, G2, T1)', () => {
  it('the flatiron is a wedge: narrow at its prow (+Z), wide at its back, 28 to 40 m tall', async () => {
    const object = await node('sf_landmarks', 'sf_flatiron_lod0');
    expect(object.userData.top_m).toBeGreaterThan(0);
    const box = bounds(object);
    expect(box.max.y).toBeGreaterThanOrEqual(28);
    expect(box.max.y).toBeLessThanOrEqual(40);
    const length = box.max.z - box.min.z;
    const low = triangles(object)
      .flat()
      .filter((p) => p.y > 1 && p.y < 20);
    const widthNear = (z0: number, z1: number): number => {
      const xs = low.filter((p) => p.z >= z0 && p.z <= z1).map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    const back = widthNear(box.min.z, box.min.z + length * 0.15);
    const prow = widthNear(box.max.z - length * 0.15, box.max.z);
    expect(prow, 'prow width against back width').toBeLessThan(back * 0.5);
  });

  it('the mission church is a low, wide-fronted chapel, its front at the root facing +Z', async () => {
    const object = await node('sf_landmarks', 'sf_mission_church');
    const box = bounds(object);
    expect(box.max.y).toBeGreaterThanOrEqual(10);
    expect(box.max.y).toBeLessThanOrEqual(16);
    expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(10);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(16);
    expect(box.min.z, 'the nave runs back from the front').toBeLessThanOrEqual(-25);
    expect(box.max.z).toBeLessThanOrEqual(3);
  });

  it('the headland battery is long and low, and the scrub and chert are small', async () => {
    const battery = bounds(await node('sf_headlands', 'gg_battery'));
    expect(battery.max.y).toBeLessThanOrEqual(6);
    expect(battery.max.x - battery.min.x).toBeGreaterThanOrEqual(20);
    expect(battery.max.x - battery.min.x).toBeLessThanOrEqual(40);
    const brush = bounds(await node('sf_headlands', 'coyote_brush'));
    expect(brush.max.y).toBeLessThanOrEqual(2);
    const chert = bounds(await node('sf_headlands', 'sf_chert_outcrop'));
    expect(chert.max.y).toBeLessThanOrEqual(5);
    expect(Math.max(chert.max.x - chert.min.x, chert.max.z - chert.min.z)).toBeLessThanOrEqual(10);
  });
});

describe('CX6: the Keys (D6, S5)', () => {
  it('the cruise ship lies along +Z, about 290 m long, floating on its waterline', async () => {
    const object = await node('keys_landmarks', 'cruise_ship_lod0');
    const box = bounds(object);
    expect(box.max.z - box.min.z).toBeGreaterThanOrEqual(250);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(310);
    expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(30);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(42);
    expect(box.max.y).toBeGreaterThanOrEqual(50);
    expect(box.max.y).toBeLessThanOrEqual(70);
    expect(object.userData.top_m).toBeGreaterThan(0);
    expect(box.min.y, 'hull below the waterline').toBeCloseTo(-object.userData.foundation_m, 2);
  });

  it('the osprey post stands 7 to 11 m tall on a small footprint', async () => {
    const box = bounds(await node('keys_identity', 'keys_osprey_post'));
    expect(box.max.y).toBeGreaterThanOrEqual(7);
    expect(box.max.y).toBeLessThanOrEqual(11);
    expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeLessThanOrEqual(3);
  });
});

describe("CX6: Chuckanut's sandstone and Lake Samish (H1, H2, I3)", () => {
  it.each([
    ['chuckanut_rockcut', 3, 3.5, 6],
    ['chuckanut_rockcut_tall', 3, 6.5, 10],
    ['chuckanut_parapet', 3, 0.7, 1.0],
    ['chuckanut_bluff', 10, 0, 0.6],
  ] as const)(
    '%s is a section whose ends meet flush at x = +/-%f, its top %f to %f m',
    async (name, half, low, high) => {
      const object = await node('pnw_shore', name);
      const box = bounds(object);
      expect(Math.abs(box.min.x + half), 'left end').toBeLessThanOrEqual(0.02);
      expect(Math.abs(box.max.x - half), 'right end').toBeLessThanOrEqual(0.02);
      expect(box.max.y).toBeGreaterThanOrEqual(low);
      expect(box.max.y).toBeLessThanOrEqual(high);
      expect(box.max.z, 'reaches at most 1 m toward the road').toBeLessThanOrEqual(1.0);
    },
  );

  it('the bluff drops its drop_m below the lip, away from the road', async () => {
    const object = await node('pnw_shore', 'chuckanut_bluff');
    expect(object.userData).toMatchObject({ section_m: 20 });
    const drop = object.userData.drop_m as number;
    expect(drop).toBeGreaterThanOrEqual(20);
    const box = bounds(object);
    expect(Math.abs(box.min.y + drop)).toBeLessThanOrEqual(drop * 0.01);
    expect(box.min.z, 'the face falls away on the far side').toBeLessThan(-5);
  });

  it('the dock runs out over the water from the shore at its root, its deck near the waterline', async () => {
    const box = bounds(await node('pnw_shore', 'samish_dock'));
    expect(box.min.z).toBeLessThanOrEqual(-12);
    expect(box.max.z).toBeLessThanOrEqual(0.5);
    expect(box.max.y).toBeLessThanOrEqual(2.5);
  });

  it('the lake house is a one-and-a-half-storey cabin', async () => {
    const box = bounds(await node('pnw_shore', 'samish_lake_house'));
    expect(box.max.y).toBeGreaterThanOrEqual(6);
    expect(box.max.y).toBeLessThanOrEqual(10);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(12);
  });
});
