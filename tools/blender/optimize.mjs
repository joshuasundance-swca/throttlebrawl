// Deterministic, dependency-free packing for the static Blender catalog. Rebuild vertex tables
// from complete attribute tuples, so dropping normals also welds flat-shading duplicates.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseGlb } from './score.mjs';

const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const COMPONENT = {
  5120: [1, 'readInt8'],
  5121: [1, 'readUInt8'],
  5122: [2, 'readInt16LE'],
  5123: [2, 'readUInt16LE'],
  5125: [4, 'readUInt32LE'],
  5126: [4, 'readFloatLE'],
};
const align = (n) => (n + 3) & ~3;

/** @param {Buffer} input @param {{keepNormals?: boolean}} [prop] @returns {Buffer} */
export function optimizeGlb(input, prop = {}) {
  const { gltf, bin } = parseGlb(input);
  if (gltf.animations?.length || gltf.skins?.length || gltf.images?.length)
    throw new Error('optimiser accepts static untextured catalog models only');
  const source = gltf.accessors;
  const read = (id) => {
    const a = source[id];
    if (a.sparse) throw new Error('sparse accessor unsupported');
    const [size, getter] = COMPONENT[a.componentType];
    const width = WIDTH[a.type];
    if (!width) throw new Error(`unsupported accessor type ${a.type}`);
    const view = gltf.bufferViews[a.bufferView];
    const stride = view?.byteStride ?? size * width;
    const base = (view?.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: width }, (_, c) => (view ? bin[getter](base + i * stride + c * size) : 0)),
    );
  };
  const accessors = [];
  const groups = new Map();
  const packed = new Map();
  const add = (kind, bytes, descriptor) => {
    const key = `${kind}:${JSON.stringify(descriptor)}:${bytes.toString('hex')}`;
    if (packed.has(key)) return packed.get(key);
    if (!groups.has(kind)) groups.set(kind, { chunks: [], length: 0, entries: [] });
    const group = groups.get(kind);
    const offset = align(group.length);
    group.chunks.push(Buffer.alloc(offset - group.length), bytes);
    group.length = offset + bytes.length;
    const id = accessors.length;
    packed.set(key, id);
    accessors.push({ ...descriptor, bufferView: 0, byteOffset: offset });
    group.entries.push(id);
    return id;
  };
  // Always place the shared index view first; attribute views follow sorted semantic order.
  groups.set('indices', { chunks: [], length: 0, entries: [] });
  for (const mesh of gltf.meshes ?? []) {
    const kinds = [...new Set(mesh.primitives.flatMap((p) => Object.keys(p.attributes)))]
      .filter((k) => prop.keepNormals || k !== 'NORMAL')
      .sort();
    const descriptors = Object.fromEntries(
      kinds.map((k) => {
        const p = mesh.primitives.find((p) => p.attributes[k] !== undefined);
        const a = source[p.attributes[k]];
        return [
          k,
          { componentType: a.componentType, type: a.type, ...(a.normalized ? { normalized: true } : {}) },
        ];
      }),
    );
    const tables = Object.fromEntries(kinds.map((k) => [k, []]));
    const vertices = new Map();
    const primitiveIndices = [];
    for (const primitive of mesh.primitives) {
      if (primitive.targets) throw new Error('morph targets unsupported');
      const attrs = Object.fromEntries(
        kinds.map((k) => [k, primitive.attributes[k] === undefined ? null : read(primitive.attributes[k])]),
      );
      const count = source[primitive.attributes.POSITION].count;
      const remap = Array.from({ length: count }, (_, i) => {
        const tuple = kinds.map((k) => attrs[k]?.[i] ?? Array(WIDTH[descriptors[k].type]).fill(0));
        const key = JSON.stringify(tuple);
        if (!vertices.has(key)) {
          vertices.set(key, vertices.size);
          kinds.forEach((k, j) => tables[k].push(...tuple[j]));
        }
        return vertices.get(key);
      });
      const indices =
        primitive.indices === undefined
          ? Array.from({ length: count }, (_, i) => i)
          : read(primitive.indices).map((v) => v[0]);
      primitiveIndices.push(indices.map((i) => remap[i]));
    }
    const shared = {};
    for (const kind of kinds) {
      const d = descriptors[kind];
      const [size] = COMPONENT[d.componentType];
      const values = tables[kind];
      const bytes = Buffer.alloc(values.length * size);
      const writers = {
        5120: 'writeInt8',
        5121: 'writeUInt8',
        5122: 'writeInt16LE',
        5123: 'writeUInt16LE',
        5125: 'writeUInt32LE',
        5126: 'writeFloatLE',
      };
      values.forEach((v, i) => bytes[writers[d.componentType]](v, i * size));
      const descriptor = { ...d, count: vertices.size };
      if (kind === 'POSITION') {
        descriptor.min = [Infinity, Infinity, Infinity];
        descriptor.max = [-Infinity, -Infinity, -Infinity];
        values.forEach((v, i) => {
          descriptor.min[i % 3] = Math.min(descriptor.min[i % 3], v);
          descriptor.max[i % 3] = Math.max(descriptor.max[i % 3], v);
        });
      }
      shared[kind] = add(kind, bytes, descriptor);
    }
    mesh.primitives.forEach((p, i) => {
      const indices = primitiveIndices[i];
      const short = vertices.size < 65536;
      const bytes = Buffer.alloc(indices.length * (short ? 2 : 4));
      indices.forEach((v, j) => (short ? bytes.writeUInt16LE(v, j * 2) : bytes.writeUInt32LE(v, j * 4)));
      p.indices = add('indices', bytes, {
        componentType: short ? 5123 : 5125,
        type: 'SCALAR',
        count: indices.length,
      });
      p.attributes = Object.fromEntries(
        Object.keys(p.attributes)
          .filter((k) => prop.keepNormals || k !== 'NORMAL')
          .sort()
          .map((k) => [k, shared[k]]),
      );
    });
  }
  const chunks = [];
  const views = [];
  let length = 0;
  for (const [kind, group] of [...groups].sort(([a], [b]) =>
    a === 'indices' ? -1 : b === 'indices' ? 1 : a.localeCompare(b),
  )) {
    if (!group.length) continue;
    const start = align(length);
    chunks.push(Buffer.alloc(start - length), ...group.chunks);
    group.entries.forEach((id) => {
      accessors[id].bufferView = views.length;
    });
    views.push({
      buffer: 0,
      byteOffset: start,
      byteLength: group.length,
      target: kind === 'indices' ? 34963 : 34962,
    });
    length = start + group.length;
  }
  chunks.push(Buffer.alloc(align(length) - length));
  const binary = Buffer.concat(chunks);
  gltf.accessors = accessors;
  gltf.bufferViews = views;
  gltf.buffers = [{ byteLength: binary.length }];
  for (const material of gltf.materials ?? []) delete material.pbrMetallicRoughness?.roughnessFactor;
  const json = Buffer.from(JSON.stringify(gltf));
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + align(json.length) + binary.length, 8);
  header.writeUInt32LE(align(json.length), 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binary.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, Buffer.alloc(align(json.length) - json.length, 32), bh, binary]);
}

/** @param {string} file @param {{keepNormals?: boolean}} [prop] */
export function optimizeFile(file, prop = {}) {
  const before = readFileSync(file);
  const after = optimizeGlb(before, prop);
  writeFileSync(file, after);
  console.log(`OPTIMIZE ${file.split(/[\\/]/).at(-1)}: ${before.length} -> ${after.length} bytes`);
  return after;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  for (const file of process.argv.slice(2).filter((a) => !a.startsWith('--')))
    optimizeFile(file, { keepNormals: process.argv.includes('--keep-normals') });
