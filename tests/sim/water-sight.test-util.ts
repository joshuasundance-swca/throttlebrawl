// How hazy the water looks from the chase camera (playtest 4 answers, 2026-10-06: Chuckanut's bay and Lake Samish).
// The camera settles behind a rider as the app builds it (chase-sight.test-util.ts); rays through the phone's
// screen meet the near world the road scene draws (its sea at world y = 0 included) and the backdrop's floors (the
// bay's and the lake's water). Each water pixel's haze is the renderer's, mirrored:
// - the near sea takes three's fog: smoothstep(fog near, fog far, view depth), per pixel;
// - a backdrop floor takes the backdrop shader's haze: per vertex, interpolated across the triangle as the GPU
//   does (barycentric in world space), with a lake's own fog term per pixel where the shader computes it there.
// Which of the two a pixel shows follows the depth the renderer draws: the near world up to the camera's far
// plane, a floor at its squeezed depth (`floorDrawnDepth`). Test-only: nothing here ships.
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import type { RoadNetwork } from '../../src/road';
import { CAMERA_FAR_M } from '../../src/render';
import type { BackdropRegionFile } from '../../src/render/backdrop/data';
import { floorDrawnDepth, floorHazeAt, type BuiltBackdrop } from '../../src/render/backdrop/builder';
import { MIN_THREAT_DRAW_M } from '../../src/render/look';
import { PHONE, settledPose } from './chase-sight.test-util';

/** Where three's fog starts in every look (look.ts `setupScene`). */
export const FOG_NEAR_M = MIN_THREAT_DRAW_M + 20;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The backdrop's floor triangles (not the far ring that follows the camera), as a mesh rays can meet. */
export interface Floors {
  mesh: Mesh;
  /** Per vertex: x, y, z, the piece's haze, its floor flag. */
  at(i: number): { x: number; y: number; z: number; haze: number; flag: number };
}

export function floorsOf(built: BuiltBackdrop): Floors {
  const g = built.mesh.geometry;
  const pos = g.getAttribute('position');
  const info = g.getAttribute('aInfo');
  const keep: number[] = [];
  const meta: number[] = [];
  for (let t = 0; t < pos.count / 3; t++) {
    const v = t * 3;
    if (info.getY(v) <= 0.5 || info.getW(v) !== 0) continue;
    for (let k = 0; k < 3; k++) {
      keep.push(pos.getX(v + k), pos.getY(v + k), pos.getZ(v + k));
      meta.push(info.getX(v + k), info.getY(v + k));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(keep, 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  mesh.updateMatrixWorld(true);
  return {
    mesh,
    at: (i) => ({
      x: keep[i * 3]!,
      y: keep[i * 3 + 1]!,
      z: keep[i * 3 + 2]!,
      haze: meta[i * 2]!,
      flag: meta[i * 2 + 1]!,
    }),
  };
}

/** What one ray met: the near world's first surface and the first floor, each with its view depth. */
export interface PixelHit {
  near: { depth: number; sea: boolean } | null;
  floor: {
    depth: number;
    point: Vector3;
    face: [number, number, number];
    w: [number, number, number];
  } | null;
}

export interface Shot {
  camera: PerspectiveCamera;
  pixels: PixelHit[];
}

/** The render camera as the app poses it behind a rider at (edge, s, d) settled at `speed` (m/s). */
export function chaseCamera(
  road: RoadNetwork,
  edge: number,
  s: number,
  d: number,
  speed: number,
): PerspectiveCamera {
  const { pose, aspect } = settledPose(road, edge, s, d, speed);
  const camera = new PerspectiveCamera(pose.fov, aspect, 0.3, CAMERA_FAR_M);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  if (pose.roll) camera.rotateZ(pose.roll);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

/** The chase camera behind a rider at (edge, s, d) at `speed`, and what each ray (every `stepPx` px) meets. */
export function shoot(
  road: RoadNetwork,
  edge: number,
  s: number,
  d: number,
  speed: number,
  near: readonly Object3D[],
  floors: Floors,
  stepPx: number,
): Shot {
  const camera = chaseCamera(road, edge, s, d, speed);
  const depthOf = (p: Vector3) => -p.clone().applyMatrix4(camera.matrixWorldInverse).z;
  const ray = new Raycaster();
  const pixels: PixelHit[] = [];
  for (let px = stepPx / 2; px < PHONE.width; px += stepPx)
    for (let py = stepPx / 2; py < PHONE.height; py += stepPx) {
      ray.setFromCamera(new Vector2((px / PHONE.width) * 2 - 1, 1 - (py / PHONE.height) * 2), camera);
      const n = ray.intersectObjects(near as Object3D[], false)[0];
      const f = ray.intersectObject(floors.mesh, false)[0];
      const nd = n ? depthOf(n.point) : Infinity;
      pixels.push({
        near: n && nd <= CAMERA_FAR_M ? { depth: nd, sea: n.object.name === 'road-water' } : null,
        floor:
          f && f.face && f.barycoord
            ? {
                depth: depthOf(f.point),
                point: f.point,
                face: [f.face.a, f.face.b, f.face.c],
                w: [f.barycoord.x, f.barycoord.y, f.barycoord.z],
              }
            : null,
      });
    }
  return { camera, pixels };
}

/**
 * The lake's haze law. `then`: the shader before this change, the lake's fog term by straight distance from 0 m,
 * per vertex (floorHazeAt with no fog near). `now`: three's own fog law by view depth from the fog's start, per pixel.
 */
export type LakeLaw = 'then' | 'now';

/** What the pixel shows, if it is water, and how hazed: null for land, sky or a far floor that is not water. */
export function waterHaze(
  hit: PixelHit,
  shot: Shot,
  floors: Floors,
  region: BackdropRegionFile,
  fogFar: number,
  law: LakeLaw,
  isWater: (p: Vector3, flag: number) => boolean,
): { haze: number; depth: number; lake: boolean } | null {
  const { near, floor } = hit;
  if (near && (!floor || near.depth < floorDrawnDepth(floor.depth, fogFar)))
    return near.sea ? { haze: smooth(FOG_NEAR_M, fogFar, near.depth), depth: near.depth, lake: false } : null;
  if (!floor) return null;
  const cam = shot.camera.position;
  const vs = floor.face.map((i) => floors.at(i));
  const flag = vs[0]!.flag;
  if (!isWater(floor.point, flag)) return null;
  const lake = flag > 1.5;
  const dist = vs.map((v) => Math.hypot(v.x - cam.x, v.y - cam.y, v.z - cam.z));
  // The aerial haze and the piece's own (the vertex shader's `h`, before the floor term).
  const h0 = vs.map((v, k) => {
    const aerial = Math.min(1 - Math.exp(-dist[k]! / region.hazeM), region.hazeMax ?? 0.8);
    return 1 - (1 - aerial) * (1 - v.haze);
  });
  const lerp = (xs: number[]) => xs[0]! * floor.w[0] + xs[1]! * floor.w[1] + xs[2]! * floor.w[2];
  if (lake && law === 'now') {
    const far = lerp(dist.map((d) => floorHazeAt(d, fogFar, cam.y, 1)));
    return {
      haze: Math.max(lerp(h0), Math.min(far, smooth(FOG_NEAR_M, fogFar, floor.depth))),
      depth: floor.depth,
      lake,
    };
  }
  const per = dist.map((d, k) => Math.max(h0[k]!, Math.min(flag, 1) * floorHazeAt(d, fogFar, cam.y, flag)));
  return { haze: lerp(per), depth: floor.depth, lake };
}
