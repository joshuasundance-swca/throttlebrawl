// What the chase camera shows of a thing that stands beside the road (playtest 4, P4-19, run B's live check:
// "a zoomed frame 28 m before mile 41 shows only a dark stub", "Key deer were not visible on Big Pine"). A
// test hands over a rider's place on a road and the world points of the thing; the camera settles behind
// the rider at speed, exactly as the app builds it (position, lookAt, roll), and the points are projected
// onto the phone's landscape screen. Test-only: nothing here ships.
import { PerspectiveCamera, Vector3 } from 'three';
import { createFollowCamera, type CameraPose, type CameraTarget } from '../../src/camera';
import type { RoadNetwork } from '../../src/road';

/** The phone in landscape, in CSS px (run B's live check drove 915 x 412). */
export const PHONE = { width: 915, height: 412 } as const;

export interface ChaseSight {
  /** Every point projects inside the view, in front of the camera. */
  inView: boolean;
  /** The points' projected height and width, in CSS px of the phone's screen. */
  heightPx: number;
  widthPx: number;
  /** Where the camera stands once settled. */
  camera: Vector3;
}

/** The camera's pose behind a rider at (edge, s, d), heading along the road, settled at `speed` (m/s). */
export function settledPose(
  road: RoadNetwork,
  edge: number,
  s: number,
  d: number,
  speed: number,
): { pose: CameraPose; aspect: number } {
  const aspect = PHONE.width / PHONE.height;
  const cam = createFollowCamera({ road });
  const w = road.toWorld(edge, s, d, 0);
  const f = road.frameAt(edge, s);
  const target: CameraTarget = {
    id: 0,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-f.tx, -f.tz),
    speed,
    lean: 0,
    road: { edge },
  };
  let pose = cam.snap(target, { aspect });
  for (let n = 0; n < 240; n++) pose = cam.update(target, 1 / 60, { aspect });
  return { pose, aspect };
}

/** The chase camera's view of `points` for a rider at (edge, s, d) riding at `speed`. */
export function chaseSight(
  road: RoadNetwork,
  edge: number,
  s: number,
  d: number,
  speed: number,
  points: readonly Vector3[],
): ChaseSight {
  const { pose, aspect } = settledPose(road, edge, s, d, speed);
  const cam = new PerspectiveCamera(pose.fov, aspect, 0.3, 1500);
  cam.position.set(pose.x, pose.y, pose.z);
  cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  if (pose.roll) cam.rotateZ(pose.roll);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  let inView = true;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.clone().applyMatrix4(cam.matrixWorldInverse).z >= -cam.near) inView = false;
    const n = p.clone().project(cam);
    if (Math.abs(n.x) > 1 || Math.abs(n.y) > 1 || n.z > 1) inView = false;
    x0 = Math.min(x0, n.x);
    x1 = Math.max(x1, n.x);
    y0 = Math.min(y0, n.y);
    y1 = Math.max(y1, n.y);
  }
  return {
    inView,
    heightPx: ((y1 - y0) / 2) * PHONE.height,
    widthPx: ((x1 - x0) / 2) * PHONE.width,
    camera: new Vector3(pose.x, pose.y, pose.z),
  };
}
