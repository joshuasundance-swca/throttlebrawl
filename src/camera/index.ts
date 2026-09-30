// camera: camera modes as small rigs that read only the interpolated snapshot and the road
// (docs/architecture.md, "Camera"). M1 builds the low chase cam (camera-1): a critically damped
// spring aimed at a look-ahead point on the road, roll at a fraction of the bike's lean, an FOV
// kick with speed, a framing bias toward the auto-target, and event shake scaled by
// camera.shakeScale. Far chase, helmet, look-back and the replay cams are later modes.
import type { RoadNetwork, SimEvent, TuningParamDecl } from '../sim/api';
import {
  createChaseRig,
  type CameraContext,
  type CameraPose,
  type CameraTarget,
  type ChaseParams,
} from './chase';

export type { CameraContext, CameraPose, CameraTarget } from './chase';
export { SHAKE_TRAUMA } from './shake';

/** Camera modes. M1 has one; the architecture doc lists the rest (farChase, helmet, lookBack...). */
export type CameraMode = 'lowChase';

// Every constant of the rig is a tuning parameter [default] (docs/architecture.md, "Camera").
// None affects the sim, so they never enter SimConfig or a replay's outcome.
const decl = (
  key: keyof ChaseParams,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
  unit: string,
): TuningParamDecl => ({
  id: `camera.${key}`,
  group: 'camera',
  label,
  default: def,
  min,
  max,
  step,
  unit,
  affectsSim: false,
});

// Playtest 1 (2026-09-30) [decided]: "Camera too low to see oncoming traffic". M1's 5.5 m back and
// 1.6 m up put the camera below the rider's helmet (about 1.9 m), so the rider hid the horizon
// where oncoming traffic appears. At 7 m back and 2.6 m up the sight line to a car 125 m ahead
// (the reaction range) clears the helmet with room to spare (reaction-range.test.ts).
export const CAMERA_TUNING: readonly TuningParamDecl[] = [
  decl('chaseDistanceM', 'Chase distance', 7, 3, 14, 0.25, 'm'),
  decl('heightM', 'Camera height', 2.6, 0.8, 5, 0.1, 'm'),
  decl('lookAheadM', 'Look-ahead', 18, 5, 40, 1, 'm'),
  decl('lookHeightM', 'Aim height', 0.9, 0, 3, 0.1, 'm'),
  decl('springRate', 'Camera stiffness', 5, 1, 15, 0.5, '1/s'),
  decl('rollFraction', 'Roll with lean', 0.3, 0, 0.6, 0.05, ''),
  decl('fovBaseDeg', 'Field of view', 60, 45, 80, 1, '°'),
  decl('fovKickDeg', 'Speed FOV kick', 12, 0, 25, 1, '°'),
  decl('fovKickSpeedMps', 'Full kick at', 38, 10, 80, 1, 'm/s'),
  decl('targetBias', 'Target framing', 0.35, 0, 1, 0.05, ''),
  decl('shakeScale', 'Camera shake', 1, 0, 2, 0.05, ''),
];

export interface FollowCamera {
  readonly mode: CameraMode;
  /**
   * Moves the camera toward its target; `dt` is the real frame time in seconds (clamped to 0.25,
   * and 0 or NaN holds the springs). `ctx.entities` lets it frame the rider's auto-target.
   */
  update(target: CameraTarget, dt: number, ctx?: CameraContext): CameraPose;
  /** Jumps straight to the target's ideal framing and clears any shake (race start, a respawn). */
  snap(target: CameraTarget, ctx?: CameraContext): CameraPose;
  /** Hands the camera a tick's sim events; the ones involving the followed rider shake it. */
  onEvents(events: readonly SimEvent[]): void;
  /** The road handle to aim along; null falls back to the rider's heading. */
  setRoad(road: RoadNetwork | null): void;
  /** Applies a `camera.*` tuning value; other ids are ignored. */
  setParam(id: string, value: number): void;
}

export interface FollowCameraOptions {
  road?: RoadNetwork | null;
}

function defaults(): ChaseParams {
  const p: Record<string, number> = {};
  for (const d of CAMERA_TUNING) p[d.id.slice('camera.'.length)] = d.default;
  return p as unknown as ChaseParams;
}

/** The low chase cam. The name is the skeleton's; the rig behind it is camera-1's. */
export function createFollowCamera(opts: FollowCameraOptions = {}): FollowCamera {
  const params = defaults();
  const rig = createChaseRig(params, opts.road ?? null);
  return {
    mode: 'lowChase',
    update: (t, dt, ctx) => rig.update(t, dt, ctx),
    snap: (t, ctx) => rig.snap(t, ctx),
    onEvents: (events) => rig.onEvents(events),
    setRoad: (road) => rig.setRoad(road),
    setParam(id, value) {
      if (!id.startsWith('camera.') || !Number.isFinite(value)) return;
      const key = id.slice('camera.'.length);
      if (key in params) (params as unknown as Record<string, number>)[key] = value;
    },
  };
}
