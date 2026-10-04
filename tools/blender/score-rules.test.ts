// The asset-contract score rules (playtest 3, C0a): atlas surfaces, vehicles, bridge bays, levels
// of detail, outward winding and the winding-read text surface. Each rule is shown to pass on a
// small hand-made GLB and to fail on a bad one, so a green run means the rule looked at something.
import { describe, expect, it } from 'vitest';
import type { PROPS } from './catalog.mjs';
import { scoreGlb } from './score.mjs';

type Prop = (typeof PROPS)[number];
type V3 = [number, number, number];

interface FixturePrim {
  positions: number[];
  indices: number[];
  uvs?: number[];
  normals?: number[];
  material: number;
}
interface FixtureNode {
  name: string;
  translation?: V3;
  children?: number[];
  mesh?: number;
  extras?: Record<string, unknown>;
}
interface Fixture {
  nodes: FixtureNode[];
  meshes: { name: string; primitives: FixturePrim[] }[];
  materials: { name: string; color?: V3 }[];
  roots: number[];
}

/** Writes a minimal glTF 2.0 GLB: float positions (with min/max), optional normals and UVs. */
function makeGlb(f: Fixture): Buffer {
  const parts: Buffer[] = [];
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  let offset = 0;
  const push = (data: Buffer, acc: Record<string, unknown>): number => {
    const pad = (4 - (data.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    parts.push(data, Buffer.alloc(pad));
    offset += data.length + pad;
    accessors.push({ bufferView: bufferViews.length - 1, ...acc });
    return accessors.length - 1;
  };
  const floats = (a: number[]) => Buffer.from(new Float32Array(a).buffer);
  const meshes = f.meshes.map((m) => ({
    name: m.name,
    primitives: m.primitives.map((p) => {
      const n = p.positions.length / 3;
      const min = [0, 1, 2].map((c) => Math.min(...p.positions.filter((_, i) => i % 3 === c)));
      const max = [0, 1, 2].map((c) => Math.max(...p.positions.filter((_, i) => i % 3 === c)));
      const attributes: Record<string, number> = {
        POSITION: push(floats(p.positions), { componentType: 5126, count: n, type: 'VEC3', min, max }),
      };
      if (p.normals)
        attributes['NORMAL'] = push(floats(p.normals), { componentType: 5126, count: n, type: 'VEC3' });
      if (p.uvs)
        attributes['TEXCOORD_0'] = push(floats(p.uvs), { componentType: 5126, count: n, type: 'VEC2' });
      const indices = push(Buffer.from(new Uint16Array(p.indices).buffer), {
        componentType: 5123,
        count: p.indices.length,
        type: 'SCALAR',
      });
      return { attributes, indices, material: p.material };
    }),
  }));
  const bin = Buffer.concat(parts);
  const gltf = {
    asset: { version: '2.0', generator: 'score-rules.test' },
    scene: 0,
    scenes: [{ nodes: f.roots }],
    nodes: f.nodes,
    meshes,
    materials: f.materials.map((m) => ({
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: [...(m.color ?? [0.5, 0.5, 0.5]), 1], metallicFactor: 0 },
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(json.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, json, bh, bin]);
}

/** An axis-aligned box with every face wound outward (12 triangles). `inside` flips them all. */
function box(lo: V3, hi: V3, material = 0, inside = false): FixturePrim {
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const positions = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ].flat();
  const out = [
    0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6,
    5,
  ];
  const indices = inside ? out.map((_, i) => out[i - (i % 3) + (2 - (i % 3))]!) : out;
  return { positions, indices, material };
}

/** A flat quad facing +Z (or -Z when `back`), with UVs (0, 0) at its top-left seen from the front. */
function panel(w: number, h: number, back = false, uvRect: [number, number, number, number] = [0, 0, 1, 1]) {
  const [u0, v0, u1, v1] = uvRect;
  const prim: FixturePrim = {
    positions: [-w / 2, 0, 0, w / 2, 0, 0, w / 2, h, 0, -w / 2, h, 0],
    uvs: [u0, v1, u1, v1, u1, v0, u0, v0],
    indices: back ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3],
    material: 0,
  };
  return prim;
}

const failedOf = (buf: Buffer, prop: Prop, opts?: Parameters<typeof scoreGlb>[2]) =>
  scoreGlb(buf, prop, opts).summary.failed;
const checkOf = (buf: Buffer, prop: Prop, id: string, opts?: Parameters<typeof scoreGlb>[2]) =>
  scoreGlb(buf, prop, opts).checks.find((c) => c.id === id);

// ---- atlas surfaces
const TILE = 128 / 1024;
const GUT = 4 / 1024;
const tileRect = (cx: number, cy: number): [number, number, number, number] => [
  cx * TILE + GUT,
  cy * TILE + GUT,
  (cx + 1) * TILE - GUT,
  (cy + 1) * TILE - GUT,
];
const LAYOUT = {
  formatVersion: 1,
  size: 1024,
  tile: 128,
  gutterPx: 4,
  white: [TILE / 2, TILE / 2],
  tiles: {
    white: { rect: tileRect(0, 0), kind: 'facade', mean: '#ffffff' },
    siding: { rect: tileRect(1, 0), kind: 'facade', mean: '#808080' },
  },
  palette: [{ hex: '#ffffff', role: 'grey_8' }],
};

function atlasShed(uvRect: [number, number, number, number], extraUvOn = false): Buffer {
  const wall = panel(4, 3, false, uvRect);
  const roof = box([-2, 3, -2], [2, 3.4, 2], 0);
  if (extraUvOn) roof.uvs = Array.from({ length: (roof.positions.length / 3) * 2 }, () => TILE / 2);
  return makeGlb({
    nodes: [
      { name: 'shed', children: [1, 2] },
      { name: 'shed_wall', mesh: 0, translation: [0, 0, 2] },
      { name: 'shed_roof', mesh: 1 },
    ],
    meshes: [
      { name: 'shed_wall', primitives: [wall] },
      { name: 'shed_roof', primitives: [roof] },
    ],
    materials: [{ name: 'paint_cream', color: [1, 1, 1] }],
    roots: [0],
  });
}
const SHED = {
  name: 'shed',
  script: 'props/shed.py',
  asset: 'models/scenery/shed',
  pack: 'base',
  region: 'florida-keys',
  kind: 'single',
  budget: { tris: 100, draws: 4, materials: 2 },
  single: {
    root: 'shed',
    nodes: ['shed_wall', 'shed_roof'],
    size: [
      [3, 5],
      [3, 4],
      [3, 5],
    ],
  },
  atlas: { sheet: 'florida-keys', surfaces: ['shed_wall'] },
  views: ['front34'],
} as unknown as Prop;

describe('atlas surfaces', () => {
  it('pass when every triangle of an atlas surface stays inside one tile', () => {
    const buf = atlasShed(tileRect(1, 0));
    expect(failedOf(buf, SHED, { atlasLayout: LAYOUT })).toEqual([]);
    expect(checkOf(buf, SHED, 'atlas_uvs_in_tiles', { atlasLayout: LAYOUT })?.detail).toMatch(/^2 triangles/);
  });

  it('fail on a UV that spans two tiles, or that sits in a gutter', () => {
    const across: [number, number, number, number] = [GUT, GUT, 2 * TILE - GUT, TILE - GUT];
    expect(failedOf(atlasShed(across), SHED, { atlasLayout: LAYOUT })).toContain('atlas_uvs_in_tiles');
    const gutter: [number, number, number, number] = [TILE, GUT, 2 * TILE - GUT, TILE - GUT];
    expect(failedOf(atlasShed(gutter), SHED, { atlasLayout: LAYOUT })).toContain('atlas_uvs_in_tiles');
  });

  it('fail when the sheet has no layout JSON', () => {
    const res = checkOf(atlasShed(tileRect(1, 0)), SHED, 'atlas_uvs_in_tiles', { atlasLayout: null });
    expect(res?.pass).toBe(false);
    expect(res?.detail).toMatch(/layout/);
    // read from disk: a sheet with no committed layout fails the rule rather than skipping it
    const nowhere = {
      ...SHED,
      atlas: { sheet: 'no-such-sheet', surfaces: ['shed_wall'] },
    } as unknown as Prop;
    expect(failedOf(atlasShed(tileRect(1, 0)), nowhere)).toContain('atlas_uvs_in_tiles');
  });

  it('allow UVs only on text and atlas surfaces', () => {
    const failed = failedOf(atlasShed(tileRect(1, 0), true), SHED, { atlasLayout: LAYOUT });
    expect(failed).toContain('uvs_only_on_text_or_atlas_surfaces');
    const plain = { ...SHED, atlas: undefined } as unknown as Prop;
    expect(failedOf(atlasShed(tileRect(1, 0)), plain)).toContain('uvs_only_on_text_or_atlas_surfaces');
  });
});

// ---- vehicles
interface CarOpts {
  hood?: boolean;
  length?: number;
  paint?: V3;
  wheel?: boolean;
}
function car({ hood = true, length = 4.8, paint = [1, 1, 1], wheel = false }: CarOpts = {}): Buffer {
  const nodes: FixtureNode[] = [
    {
      name: 'vehicle',
      children: [1, 2, 3, 4, 5],
      extras: {
        length_m: 4.8,
        width_m: 1.85,
        height_m: 1.45,
        wheelbase_m: 2.8,
        hood_top_m: 0.95,
        hood_front_m: 2.3,
        hood_back_m: 1.1,
        class: 'car',
      },
    },
    { name: 'vehicle_body', mesh: 0 },
    { name: 'light_head_l', translation: [0.7, 0.7, 2.4] },
    { name: 'light_head_r', translation: [-0.7, 0.7, 2.4] },
    { name: 'light_tail_l', translation: [0.7, 0.8, -2.4] },
    { name: 'light_tail_r', translation: [-0.7, 0.8, -2.4] },
  ];
  if (hood) {
    nodes.push({ name: 'hood', translation: [0, 0.95, 1.7] });
    nodes[0]!.children!.push(nodes.length - 1);
  }
  const meshes = [
    {
      name: 'vehicle_body',
      primitives: [
        box([-0.925, 0, -length / 2], [0.925, 1.45, length / 2], 0),
        box([-0.9, 0.9, -1], [0.9, 1.4, 0.8], 1),
      ],
    },
  ];
  if (wheel) {
    nodes.push({ name: 'wheel_fl', mesh: 1, translation: [0.8, 0, 1.4] });
    nodes[0]!.children!.push(nodes.length - 1);
    meshes.push({ name: 'wheel_fl', primitives: [box([-0.1, 0, -0.3], [0.1, 0.6, 0.3], 1)] });
  }
  return makeGlb({
    nodes,
    meshes,
    materials: [
      { name: 'paint_primary', color: paint },
      { name: 'glass', color: [0.1, 0.12, 0.15] },
    ],
    roots: [0],
  });
}
const SEDAN = {
  name: 'sedan',
  script: 'props/sedan.py',
  asset: 'models/traffic/sedan',
  pack: 'base',
  kind: 'vehicle',
  budget: { tris: 360, draws: 2, materials: 7 },
  views: ['front34'],
} as unknown as Prop;

describe('vehicles', () => {
  it('pass the node contract, the extras, the size and the white primary paint', () => {
    const res = scoreGlb(car(), SEDAN);
    expect(res.summary.failed).toEqual([]);
    expect(res.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'required_nodes',
        'vehicle_extras',
        'vehicle_size_matches_extras',
        'hood_on_top',
        'paint_primary_white',
        'vehicle_one_body',
      ]),
    );
  });

  it('fail without a hood empty', () => {
    expect(failedOf(car({ hood: false }), SEDAN)).toEqual(
      expect.arrayContaining(['required_nodes', 'hood_on_top']),
    );
  });

  it('fail when the body is 3% longer than its extras say', () => {
    expect(failedOf(car({ length: 4.8 * 1.03 }), SEDAN)).toContain('vehicle_size_matches_extras');
  });

  it('fail on a tinted primary paint, and on a separate wheel mesh', () => {
    expect(failedOf(car({ paint: [0.8, 0.1, 0.1] }), SEDAN)).toContain('paint_primary_white');
    expect(failedOf(car({ wheel: true }), SEDAN)).toContain('vehicle_one_body');
  });
});

// ---- bridge bays and levels of detail (kind `variants`)
function bridgeKit(bayLen: number, lod1Tris: number): Buffer {
  // bay: a deck-edge girder from z = 0 to bayLen, a pier down to -pier_m
  const bay = [
    box([-6, -1.5, 0], [6, 0, bayLen], 0),
    box([-1, -12, bayLen / 2 - 1], [1, -1.5, bayLen / 2 + 1], 0),
  ];
  const lod0 = Array.from({ length: 10 }, (_, k) => box([-1, k * 3, -1], [1, k * 3 + 3, 1], 0));
  const n1 = lod1Tris / 12;
  const lod1 = Array.from({ length: n1 }, (_, k) =>
    box([-1, (k * 30) / n1, -1], [1, ((k + 1) * 30) / n1, 1], 0),
  );
  return makeGlb({
    nodes: [
      { name: 'bay_a', translation: [-20, 0, 0], children: [1], extras: { bay_m: 41, pier_m: 12 } },
      { name: 'bay_a_body', mesh: 0 },
      { name: 'tower_lod0', translation: [0, 0, 0], children: [3] },
      { name: 'tower_lod0_body', mesh: 1 },
      { name: 'tower_lod1', translation: [20, 0, 0], children: [5] },
      { name: 'tower_lod1_body', mesh: 2 },
    ],
    meshes: [
      { name: 'bay_a_body', primitives: bay },
      { name: 'tower_lod0_body', primitives: lod0 },
      { name: 'tower_lod1_body', primitives: lod1 },
    ],
    materials: [{ name: 'concrete' }],
    roots: [0, 2, 4],
  });
}
const KIT = {
  name: 'bridge_kit',
  script: 'props/bridge_kit.py',
  asset: 'models/landmarks/bridge-kit',
  pack: 'base',
  region: 'florida-keys',
  kind: 'variants',
  budget: { materials: 2 },
  variants: {
    roots: ['bay_a', 'tower_lod0', 'tower_lod1'],
    xs: [-20, 0, 20],
    parts: ['body'],
    perVariant: { tris: 200, draws: 20 },
    height: [0, 31],
    sway: false,
    sharedMaterials: true,
    bays: { roots: ['bay_a'], lengthM: [41] },
    lods: [{ lod0: 'tower_lod0', lod1: 'tower_lod1' }],
  },
  views: ['front34'],
} as unknown as Prop;

describe('bridge bays', () => {
  it('pass when a bay runs exactly its bay_m along +Z with its root at deck level', () => {
    const res = scoreGlb(bridgeKit(41, 24), KIT);
    expect(res.summary.failed).toEqual([]);
    expect(res.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(['bay_a_bay_length', 'bay_a_deck_level']),
    );
  });

  it('fail on a bay 3% short', () => {
    expect(failedOf(bridgeKit(41 * 0.97, 24), KIT)).toContain('bay_a_bay_length');
  });
});

describe('levels of detail', () => {
  it('pass when lod1 has at most 30% of lod0 triangles and the same box', () => {
    expect(checkOf(bridgeKit(41, 24), KIT, 'tower_lod1_lod')?.pass).toBe(true);
  });

  it('fail when lod1 keeps 40% of lod0 triangles', () => {
    expect(failedOf(bridgeKit(41, 48), KIT)).toContain('tower_lod1_lod');
  });
});

// ---- winding
function cube(inside: boolean): Buffer {
  return makeGlb({
    nodes: [
      { name: 'crate', children: [1] },
      { name: 'crate_body', mesh: 0 },
    ],
    meshes: [{ name: 'crate_body', primitives: [box([-0.5, 0, -0.5], [0.5, 1, 0.5], 0, inside)] }],
    materials: [{ name: 'wood' }],
    roots: [0],
  });
}
const CRATE = {
  name: 'crate',
  script: 'props/crate.py',
  asset: 'models/props/crate',
  kind: 'single',
  budget: { tris: 12, draws: 1, materials: 1 },
  single: {
    root: 'crate',
    nodes: ['crate_body'],
    size: [
      [0.9, 1.1],
      [0.9, 1.1],
      [0.9, 1.1],
    ],
  },
  convexParts: ['crate_body'],
  views: ['front34'],
} as unknown as Prop;

describe('faces wound outward', () => {
  it('pass on a convex part wound outward, and say how many faces it read', () => {
    const res = checkOf(cube(false), CRATE, 'faces_wound_outward');
    expect(res?.pass).toBe(true);
    expect(res?.detail).toMatch(/12 faces on 1 convex part/);
  });

  it('fail on the same part wound inward', () => {
    expect(failedOf(cube(true), CRATE)).toContain('faces_wound_outward');
  });
});

// ---- text surfaces read by winding once the normals are gone
function sign(back: boolean, normals: boolean): Buffer {
  const face = panel(2, 1, back);
  if (normals) face.normals = Array.from({ length: 4 }, () => [0, 0, 1]).flat();
  return makeGlb({
    nodes: [
      { name: 'sign', children: [1] },
      { name: 'sign_face', mesh: 0, extras: { text_surface: true, width_m: 2, height_m: 1 } },
    ],
    meshes: [{ name: 'sign_face', primitives: [face] }],
    materials: [{ name: 'sign_face' }],
    roots: [0],
  });
}
const SIGN = {
  name: 'sign',
  script: 'props/sign.py',
  asset: 'models/scenery/sign',
  kind: 'single',
  budget: { tris: 10, draws: 1, materials: 1 },
  single: {
    root: 'sign',
    nodes: ['sign_face'],
    size: [
      [1.9, 2.1],
      [0.9, 1.1],
      [0, 0.1],
    ],
  },
  textSurfaces: ['sign_face'],
  views: ['front34'],
} as unknown as Prop;

describe('text surfaces', () => {
  it('reads a +X side panel by winding and rejects its reversed face', () => {
    const sideSign = (back: boolean) => {
      const face = panel(2, 1, back);
      // Rotate a front sign 90 degrees about Y: min X maps to max Z (screen left).
      face.positions = face.positions.flatMap((_, i, a) =>
        i % 3 === 0 ? [a[i + 2]!, a[i + 1]!, -a[i]!] : [],
      );
      return makeGlb({
        nodes: [
          { name: 'sign', children: [1] },
          {
            name: 'sign_face',
            mesh: 0,
            extras: { text_surface: true, facing_axis: 'x', width_m: 2, height_m: 1 },
          },
        ],
        meshes: [{ name: 'sign_face', primitives: [face] }],
        materials: [{ name: 'sign_face' }],
        roots: [0],
      });
    };
    expect(checkOf(sideSign(false), SIGN, 'sign_face_text_surface')?.pass).toBe(true);
    expect(checkOf(sideSign(true), SIGN, 'sign_face_text_surface')?.pass).toBe(false);
  });
  it('find the front face by winding when the GLB ships no normals', () => {
    expect(checkOf(sign(false, false), SIGN, 'sign_face_text_surface')?.pass).toBe(true);
    expect(checkOf(sign(true, false), SIGN, 'sign_face_text_surface')?.pass).toBe(false);
  });

  it('still read the normals when they are there', () => {
    expect(checkOf(sign(false, true), SIGN, 'sign_face_text_surface')?.pass).toBe(true);
  });
});
