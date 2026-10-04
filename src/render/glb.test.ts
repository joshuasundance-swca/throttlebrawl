// The GLB reader's attribute mapping (playtest 3, C0a): atlas-faced models carry TEXCOORD_0, which
// three's materials read as `uv`, and quantised accessors (signed 8- and 16-bit, normalised) read
// with their sign and their normalised flag, as three's own GLTFLoader reads them.
import type { BufferAttribute, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { readGlb } from './glb';

interface Acc {
  data: ArrayBufferView;
  componentType: number;
  type: string;
  count: number;
  normalized?: boolean;
}

/** One triangle mesh node; `attrs` maps glTF attribute names to accessors. */
function glb(attrs: Record<string, Acc>): ArrayBuffer {
  const views: { byteOffset: number; byteLength: number }[] = [];
  const accessors: object[] = [];
  const parts: Uint8Array[] = [];
  let offset = 0;
  const attributes: Record<string, number> = {};
  for (const [name, a] of Object.entries(attrs)) {
    const bytes = new Uint8Array(a.data.buffer, a.data.byteOffset, a.data.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    views.push({ byteOffset: offset, byteLength: bytes.length });
    parts.push(bytes, new Uint8Array(pad));
    offset += bytes.length + pad;
    accessors.push({
      bufferView: views.length - 1,
      componentType: a.componentType,
      type: a.type,
      count: a.count,
      ...(a.normalized ? { normalized: true } : {}),
    });
    attributes[name] = accessors.length - 1;
  }
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'panel', mesh: 0 }],
    meshes: [{ primitives: [{ attributes }] }],
    accessors,
    bufferViews: views.map((v) => ({ buffer: 0, ...v })),
    buffers: [{ byteLength: offset }],
  };
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  if (json.length % 4) {
    const padded = new Uint8Array(json.length + 4 - (json.length % 4)).fill(0x20);
    padded.set(json);
    json = padded;
  }
  const total = 12 + 8 + json.length + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, json.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  let at = 20 + json.length;
  dv.setUint32(at, offset, true);
  dv.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

const POSITION: Acc = {
  data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  componentType: 5126,
  type: 'VEC3',
  count: 3,
};
const meshOf = (data: ArrayBuffer) => readGlb(data).getObjectByName('panel') as Mesh;

describe('readGlb', () => {
  it('reads TEXCOORD_0 as the uv attribute three materials sample', () => {
    const uvs = new Float32Array([0.25, 0.5, 0.375, 0.5, 0.25, 0.625]);
    const mesh = meshOf(
      glb({ POSITION, TEXCOORD_0: { data: uvs, componentType: 5126, type: 'VEC2', count: 3 } }),
    );
    const uv = mesh.geometry.getAttribute('uv') as BufferAttribute;
    expect(uv).toBeDefined();
    expect(uv.itemSize).toBe(2);
    expect(Array.from(uv.array)).toEqual(Array.from(uvs));
    expect(mesh.geometry.getAttribute('texcoord_0')).toBeUndefined();
  });

  it('reads signed 8- and 16-bit accessors with their sign and the normalised flag', () => {
    const mesh = meshOf(
      glb({
        POSITION,
        TEXCOORD_0: {
          data: new Int16Array([-32767, 0, 32767, -1, 100, -100]),
          componentType: 5122,
          type: 'VEC2',
          count: 3,
          normalized: true,
        },
        _SWAY: { data: new Int8Array([-127, 0, 127, 0]), componentType: 5120, type: 'SCALAR', count: 3 },
      }),
    );
    const uv = mesh.geometry.getAttribute('uv') as BufferAttribute;
    expect(Array.from(uv.array)).toEqual([-32767, 0, 32767, -1, 100, -100]);
    expect(uv.array).toBeInstanceOf(Int16Array);
    expect(uv.normalized).toBe(true);
    const sway = mesh.geometry.getAttribute('_sway') as BufferAttribute;
    expect(Array.from(sway.array)).toEqual([-127, 0, 127]);
    expect(sway.array).toBeInstanceOf(Int8Array);
    expect(sway.normalized).toBe(false);
    expect((mesh.geometry.getAttribute('position') as BufferAttribute).normalized).toBe(false);
  });
});
