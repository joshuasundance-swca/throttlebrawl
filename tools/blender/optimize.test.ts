import { readFileSync } from 'node:fs';
import { Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { glbPath, PROPS } from './catalog.mjs';
import { optimizeGlb } from './optimize.mjs';
import { parseGlb } from './score.mjs';

interface PackedGlb {
  gltf: {
    nodes: unknown[];
    scenes: unknown[];
    materials: { name: string; extras?: unknown; pbrMetallicRoughness: Record<string, unknown> }[];
    meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
    accessors: {
      bufferView: number;
      byteOffset?: number;
      componentType: number;
      count: number;
      type: string;
      min?: number[];
      max?: number[];
    }[];
    bufferViews: { byteOffset: number; byteLength: number; target: number }[];
  };
  bin: Buffer;
}
const parsed = (buf: Buffer) => parseGlb(buf) as PackedGlb;

function fixture(): Buffer {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  const uvs = [0, 0, 1, 0, 0, 1];
  const sway = [0, 0.5, 1];
  const arrays = [positions, normals, uvs, sway, positions, normals, uvs, sway];
  let offset = 0;
  const buffers = arrays.map((a) => Buffer.from(new Float32Array(a).buffer));
  const bufferViews = buffers.map((b) => {
    const view = { buffer: 0, byteOffset: offset, byteLength: b.length };
    offset += b.length;
    return view;
  });
  const types = ['VEC3', 'VEC3', 'VEC2', 'SCALAR'];
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'fixture', mesh: 0, translation: [2, 3, 4], extras: { preserved: true } }],
    meshes: [
      {
        name: 'fixture_mesh',
        primitives: [0, 4].map((i) => ({
          attributes: { POSITION: i, NORMAL: i + 1, TEXCOORD_0: i + 2, _SWAY: i + 3 },
          material: i / 4,
        })),
      },
    ],
    materials: ['paint_primary', 'trim'].map((name) => ({
      name,
      extras: { preserved: 'role' },
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 },
    })),
    bufferViews,
    buffers: [{ byteLength: offset }],
    accessors: arrays.map((_, i) => ({
      bufferView: i,
      componentType: 5126,
      type: types[i % 4],
      count: 3,
      ...(i % 4 === 0 ? { min: [0, 0, 0], max: [1, 1, 0] } : {}),
    })),
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + offset, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(offset, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, bh, ...buffers]);
}

async function triangles(buf: Buffer): Promise<number[][]> {
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const scene = await new Promise<import('three').Object3D>((resolve, reject) => {
    new GLTFLoader().parse(data, '', (g) => resolve(g.scene), reject);
  });
  scene.updateMatrixWorld(true);
  const out: number[][] = [];
  scene.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const geometry = obj.geometry as import('three').BufferGeometry;
    const positions = geometry.getAttribute('position');
    const indices = geometry.index;
    for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
      const corners = [0, 1, 2].map((j) => {
        const v = new Vector3().fromBufferAttribute(positions, indices?.getX(i + j) ?? i + j);
        return v.applyMatrix4(obj.matrixWorld).toArray();
      });
      corners.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      out.push(corners.flat());
    }
  });
  return out.sort((a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  });
}

describe('GLB optimiser', () => {
  it('drops normals, welds duplicate primitives, packs views, preserves UV/sway and exact bounds', async () => {
    const input = fixture();
    const result = optimizeGlb(input);
    const { gltf, bin } = parsed(result);
    const prims = gltf.meshes[0]!.primitives;
    expect(gltf.bufferViews).toHaveLength(4);
    for (const view of gltf.bufferViews) expect(view.byteOffset % 4).toBe(0);
    for (const kind of ['POSITION', 'TEXCOORD_0', '_SWAY']) {
      expect(prims[0]!.attributes[kind]).toBe(prims[1]!.attributes[kind]);
      const acc = gltf.accessors[prims[0]!.attributes[kind]!]!;
      expect(acc.count).toBe(3);
      if (kind === 'POSITION') {
        expect(acc.min).toEqual([0, 0, 0]);
        expect(acc.max).toEqual([1, 1, 0]);
      }
      const widths: Record<string, number> = { POSITION: 3, TEXCOORD_0: 2, _SWAY: 1 };
      const start = gltf.bufferViews[acc.bufferView]!.byteOffset + (acc.byteOffset ?? 0);
      const values = Array.from({ length: acc.count * widths[kind]! }, (_, i) =>
        bin.readFloatLE(start + i * 4),
      );
      expect(values).toEqual(
        kind === 'POSITION'
          ? [0, 0, 0, 1, 0, 0, 0, 1, 0]
          : kind === 'TEXCOORD_0'
            ? [0, 0, 1, 0, 0, 1]
            : [0, 0.5, 1],
      );
    }
    for (const p of prims) {
      expect(p.attributes['NORMAL']).toBeUndefined();
      expect(gltf.accessors[p.indices]!.componentType).toBe(5123);
    }
    expect(gltf.materials.map((m) => m.name)).toEqual(['paint_primary', 'trim']);
    for (const m of gltf.materials) {
      expect(m.extras).toEqual({ preserved: 'role' });
      expect(m.pbrMetallicRoughness).toEqual({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0 });
    }
    expect(await triangles(result)).toEqual(await triangles(input));
    expect(optimizeGlb(result)).toEqual(result);
    const kept = parsed(optimizeGlb(input, { keepNormals: true }));
    expect(kept.gltf.meshes[0]!.primitives[0]!.attributes['NORMAL']).toBeDefined();
  });
  for (const prop of PROPS)
    it(`preserves ${prop.name} geometry and contracts deterministically`, async () => {
      const input = readFileSync(glbPath(prop));
      const result = optimizeGlb(input, prop);
      const before = parsed(input);
      const after = parsed(result);
      expect(after.gltf.nodes).toEqual(before.gltf.nodes);
      expect(after.gltf.scenes).toEqual(before.gltf.scenes);
      for (const mesh of after.gltf.meshes) {
        const positions = new Set(
          mesh.primitives.map((p: { attributes: Record<string, number> }) => p.attributes['POSITION']),
        );
        expect(positions.size).toBe(1);
        for (const primitive of mesh.primitives)
          if (!prop.keepNormals) expect(primitive.attributes.NORMAL).toBeUndefined();
      }
      const a = await triangles(input);
      const b = await triangles(result);
      expect(b.length).toBe(a.length);
      a.forEach((triangle, i) =>
        triangle.forEach((v, j) => expect(Math.abs(v - b[i]![j]!)).toBeLessThanOrEqual(1e-6)),
      );
      expect(optimizeGlb(input, prop)).toEqual(result);
      expect(optimizeGlb(result, prop)).toEqual(result);
    });
});
