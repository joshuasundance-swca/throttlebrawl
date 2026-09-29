// camera: camera modes as small rigs that read only the interpolated snapshot and the road
// (docs/architecture.md, "Camera"). The skeleton's follow camera sits behind and above the rider
// and eases toward it; camera-1 builds the low chase cam's damped spring, roll, FOV kick and shake.
import type { EntitySnapshot, TuningParamDecl } from '../sim/api';

export const CAMERA_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'camera.chaseDistanceM',
    group: 'camera',
    label: 'Chase distance',
    default: 6.5,
    min: 3,
    max: 14,
    step: 0.25,
    unit: 'm',
    affectsSim: false,
  },
];

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface FollowCamera {
  /** Moves the camera toward its target; `dt` is the real frame time in seconds. */
  update(target: Pick<EntitySnapshot, 'x' | 'y' | 'z' | 'heading' | 'speed'>, dt: number): CameraPose;
  /** Jumps straight to the target (race start, a respawn). */
  snap(target: Pick<EntitySnapshot, 'x' | 'y' | 'z' | 'heading' | 'speed'>): CameraPose;
  setParam(id: string, value: number): void;
}

export function createFollowCamera(): FollowCamera {
  let distance = CAMERA_TUNING[0]?.default ?? 6.5;
  const height = 2.3;
  const lookAhead = 12;
  let pose: CameraPose | null = null;

  const ideal = (t: Pick<EntitySnapshot, 'x' | 'y' | 'z' | 'heading' | 'speed'>): CameraPose => {
    const fx = -Math.sin(t.heading);
    const fz = -Math.cos(t.heading);
    return {
      x: t.x - fx * distance,
      y: t.y + height,
      z: t.z - fz * distance,
      lookX: t.x + fx * lookAhead,
      lookY: t.y + 0.9,
      lookZ: t.z + fz * lookAhead,
      fov: 62 + Math.min(10, t.speed * 0.2),
    };
  };

  return {
    update(target, dt) {
      const want = ideal(target);
      if (!pose) {
        pose = want;
        return pose;
      }
      const k = 1 - Math.exp(-dt * 10);
      const p = pose;
      pose = {
        x: p.x + (want.x - p.x) * k,
        y: p.y + (want.y - p.y) * k,
        z: p.z + (want.z - p.z) * k,
        lookX: p.lookX + (want.lookX - p.lookX) * k,
        lookY: p.lookY + (want.lookY - p.lookY) * k,
        lookZ: p.lookZ + (want.lookZ - p.lookZ) * k,
        fov: p.fov + (want.fov - p.fov) * k,
      };
      return pose;
    },
    snap(target) {
      pose = ideal(target);
      return pose;
    },
    setParam(id, value) {
      if (id === 'camera.chaseDistanceM') distance = value;
    },
  };
}
