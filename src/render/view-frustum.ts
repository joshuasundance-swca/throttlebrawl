// The frustum a camera sees through (polish J3). The renderer hands it to the rider rigs each frame (riders/index.ts
// `RiderRigs.setView`), whose skinned meshes three.js cannot cull by their own bounds; the tests build it the same way.
import { Frustum, Matrix4, type PerspectiveCamera } from 'three';

const product = new Matrix4();

/**
 * The frustum a camera sees through, from its pose and projection as they stand now (call it after both are set).
 * `into` is written and returned when given, so a frame allocates nothing.
 */
export function frustumOf(camera: PerspectiveCamera, into: Frustum = new Frustum()): Frustum {
  camera.updateMatrixWorld(true);
  return into.setFromProjectionMatrix(
    product.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}
