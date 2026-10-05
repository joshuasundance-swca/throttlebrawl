// CX5 uses the same world-space triangle reader for its frozen baseline and tests.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export async function load(path) {
  const bytes = readFileSync(path);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

/**
 * Every triangle under `object`, in `relativeTo`'s frame (world space when it is null).
 * @param {import('three').Object3D} object
 * @param {import('three').Object3D | null} [relativeTo]
 * @returns {Vector3[][]}
 */
export function triangles(object, relativeTo = null) {
  const inverse = relativeTo ? relativeTo.matrixWorld.clone().invert() : new Matrix4();
  const result = [];
  object.traverse((mesh) => {
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
        ),
      );
    }
  });
  return result;
}

export function fingerprint(object) {
  const tris = triangles(object);
  const sorted = tris
    .map((t) =>
      t
        .map((p) => [p.x, p.y, p.z].map((n) => Math.round(n * 1000)).join(','))
        .sort()
        .join('|'),
    )
    .sort();
  return { triangles: tris.length, sha256: createHash('sha256').update(sorted.join('\n')).digest('hex') };
}

// Node transforms, extras, role colours, indices and all shipped attributes: the
// append-only promise covers more than the millimetre triangle-position oracle.
export function authoredState(object) {
  const nodes = [];
  object.traverse((node) => {
    const data = {
      name: node.name,
      parent: node.parent?.name,
      position: node.position.toArray(),
      rotation: node.quaternion.toArray(),
      scale: node.scale.toArray(),
      extras: node.userData,
    };
    if (node.isMesh) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      data.materials = materials.map((m) => ({
        name: m.name,
        color: m.color.toArray(),
        metalness: m.metalness,
        roughness: m.roughness,
        side: m.side,
      }));
      data.attributes = Object.fromEntries(
        Object.entries(node.geometry.attributes).map(([name, attr]) => [name, Array.from(attr.array)]),
      );
      data.indices = node.geometry.index ? Array.from(node.geometry.index.array) : null;
    }
    nodes.push(data);
  });
  return createHash('sha256').update(JSON.stringify(nodes)).digest('hex');
}
