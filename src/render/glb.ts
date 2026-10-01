// A small GLB reader for the Blender models (tools/blender/README.md, "Conventions"). The pipeline
// writes one narrow shape of glTF 2.0: triangles, positions and normals (plus a `_SWAY` weight and
// UVs on text panels), flat Principled colours with no textures, and node transforms. Reading just
// that keeps three's full GLTFLoader (animation, skins, textures, extensions) out of the phone's
// JavaScript budget. scenery.test.ts checks every committed GLB against three's GLTFLoader, so the
// two readers agree on what the game draws.
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from 'three';

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}
interface GltfBufferView {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}
interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  extras?: Record<string, unknown>;
}
interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  materials?: {
    name?: string;
    doubleSided?: boolean;
    pbrMetallicRoughness?: { baseColorFactor?: number[] };
  }[];
}

const COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAYS: Readonly<
  Record<
    number,
    Float32ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor | Uint8ArrayConstructor
  >
> = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array };

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Splits a GLB into its JSON and binary chunks. */
function chunks(data: ArrayBuffer): { gltf: Gltf; bin: ArrayBuffer } {
  const view = new DataView(data);
  if (data.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
  if (view.getUint32(4, true) !== 2) throw new Error('only glTF 2.0 GLBs are read');
  let gltf: Gltf | null = null;
  let bin = new ArrayBuffer(0);
  for (let at = 12; at + 8 <= data.byteLength;) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const body = data.slice(at + 8, at + 8 + length);
    if (type === CHUNK_JSON) gltf = JSON.parse(new TextDecoder().decode(body)) as Gltf;
    else if (type === CHUNK_BIN) bin = body;
    at += 8 + length;
  }
  if (!gltf) throw new Error('GLB without a JSON chunk');
  return { gltf, bin };
}

/** An accessor as a tightly packed typed array (copied, so alignment and stride never matter). */
function readAccessor(
  gltf: Gltf,
  bin: ArrayBuffer,
  index: number,
): { array: ArrayLike<number>; size: number } {
  const acc = gltf.accessors?.[index];
  if (!acc || acc.bufferView === undefined) throw new Error(`accessor ${index} is missing or sparse`);
  const bv = gltf.bufferViews?.[acc.bufferView];
  const Arr = ARRAYS[acc.componentType];
  const size = COMPONENTS[acc.type];
  if (!bv || !Arr || !size) throw new Error(`accessor ${index} has an unsupported layout`);
  const elem = Arr.BYTES_PER_ELEMENT;
  const stride = bv.byteStride ?? size * elem;
  const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Arr(acc.count * size);
  const view = new DataView(bin);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < size; c++) {
      const at = start + i * stride + c * elem;
      out[i * size + c] =
        elem === 4
          ? Arr === Float32Array
            ? view.getFloat32(at, true)
            : view.getUint32(at, true)
          : elem === 2
            ? view.getUint16(at, true)
            : view.getUint8(at);
    }
  }
  return { array: out, size };
}

/**
 * Parses a GLB into three objects: a group per scene root, nodes with their names, extras (as
 * `userData`) and transforms, and one Mesh per triangle primitive with a flat-coloured material.
 */
export function readGlb(data: ArrayBuffer): Object3D {
  const { gltf, bin } = chunks(data);
  const materials = (gltf.materials ?? []).map((m) => {
    const [r = 1, g = 1, b = 1] = m.pbrMetallicRoughness?.baseColorFactor ?? [];
    const mat = new MeshBasicMaterial({ side: m.doubleSided ? DoubleSide : FrontSide });
    // glTF colour factors are linear, as three's working colour space is.
    mat.color.setRGB(r, g, b);
    mat.name = m.name ?? '';
    return mat;
  });
  const primitive = (p: GltfPrimitive): Mesh => {
    if ((p.mode ?? 4) !== 4) throw new Error('only triangle primitives are read');
    const geo = new BufferGeometry();
    for (const [name, index] of Object.entries(p.attributes)) {
      const { array, size } = readAccessor(gltf, bin, index);
      const key = name === 'POSITION' ? 'position' : name === 'NORMAL' ? 'normal' : name.toLowerCase();
      geo.setAttribute(key, new BufferAttribute(array as Float32Array, size));
    }
    if (p.indices !== undefined) {
      const { array } = readAccessor(gltf, bin, p.indices);
      geo.setIndex(new BufferAttribute(array as Uint32Array, 1));
    }
    return new Mesh(geo, materials[p.material ?? -1] ?? new MeshBasicMaterial());
  };
  const build = (index: number): Object3D => {
    const node = gltf.nodes?.[index];
    if (!node) throw new Error(`node ${index} is missing`);
    const prims = node.mesh !== undefined ? (gltf.meshes?.[node.mesh]?.primitives ?? []) : [];
    let obj: Object3D;
    if (prims.length === 1 && prims[0]) obj = primitive(prims[0]);
    else {
      obj = new Group();
      prims.forEach((p) => obj.add(primitive(p)));
    }
    obj.name = node.name ?? '';
    obj.userData = { ...(node.extras ?? {}) };
    if (node.matrix) new Matrix4().fromArray(node.matrix).decompose(obj.position, obj.quaternion, obj.scale);
    else {
      if (node.translation) obj.position.fromArray(node.translation);
      if (node.rotation) obj.quaternion.fromArray(node.rotation);
      if (node.scale) obj.scale.fromArray(node.scale);
    }
    for (const c of node.children ?? []) obj.add(build(c));
    return obj;
  };
  const root = new Group();
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  for (const n of scene?.nodes ?? []) root.add(build(n));
  return root;
}
