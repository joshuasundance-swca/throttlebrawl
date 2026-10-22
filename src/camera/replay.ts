// Replay-only, data-only rigs. The absolute playback clock never advances while paused.
import type { RoadNetwork, StructurePlan } from '../road';
import type { CameraContext, CameraPose, CameraTarget } from './chase';
import { createFrontKeeper, frontLimitM } from './fronts';
import { createFollowCamera } from './index';
import { armClear, EYE_CLEARANCE_M, insideSolid, solidsNear } from './solids';

export type ReplayCameraMode = 'trackside' | 'orbit';

export interface ReplayCameraContext extends CameraContext {
  /** Known rendered ground, world y. Null means unknown, never proof of clearance. */
  groundHeightAt?: ((x: number, z: number) => number | null) | undefined;
}

export interface ReplayCameraOptions {
  road?: RoadNetwork | null;
}

export interface ReplayCamera {
  pose(
    target: CameraTarget,
    playbackSeconds: number,
    mode: ReplayCameraMode,
    context?: ReplayCameraContext,
  ): CameraPose;
  /** Forgets shot/follow history on restart. Settings remain local to this rig. */
  reset(): void;
  /** 0 selects a calm follow shot; 1 allows cinematic motion. Clamped; NaN means 1. */
  setMotionAmount(amount: number): void;
}

// Authored framing defaults, not device/performance limits. Root measures the rendered scene cost.
const STATION_M = 24;
const TRACKSIDE_M = 7;
const ORBIT_M = 7;
const ORBIT_RAD_S = 0.22;
const MAX_ARM_M = 24;
const MIN_ARM_M = 3;
const FOV_DEG = 60;
const BODY_RADIUS_M = 1.6;
const GROUND_STEP_M = 0.25;
const FRONT_PARAMS = { keepClearOfFronts: 1, frontMarginM: 0.5, frontReachM: 3.2 };

interface Point {
  x: number;
  y: number;
  z: number;
}

/** Aim at the body, with an orthonormal unrolled up vector (also after clearance lowers the eye). */
function aimed(eye: Point, pivot: Point, fov = FOV_DEG): CameraPose {
  const dx = pivot.x - eye.x;
  const dy = pivot.y - eye.y;
  const dz = pivot.z - eye.z;
  const horizontal = Math.hypot(dx, dz);
  const length = Math.hypot(horizontal, dy);
  return {
    ...eye,
    lookX: pivot.x,
    lookY: pivot.y,
    lookZ: pivot.z,
    fov,
    roll: 0,
    upX: horizontal > 1e-6 ? (-dx * dy) / (horizontal * length) : 0,
    upY: horizontal > 1e-6 ? horizontal / length : 0,
    upZ: horizontal > 1e-6 ? (-dz * dy) / (horizontal * length) : 1,
  };
}

const aspectOf = (ctx?: ReplayCameraContext): number =>
  ctx?.aspect !== undefined && Number.isFinite(ctx.aspect) && ctx.aspect > 0 ? ctx.aspect : 16 / 9;

/** Tests known ground along the whole arm. Unknown samples do not establish terrain safety. */
function aboveGround(pivot: Point, eye: Point, ctx?: ReplayCameraContext): boolean {
  const sample = ctx?.groundHeightAt;
  if (!sample) return true;
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(eye.x - pivot.x, eye.y - pivot.y, eye.z - pivot.z) / GROUND_STEP_M),
  );
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const ground = sample(pivot.x + (eye.x - pivot.x) * k, pivot.z + (eye.z - pivot.z) * k);
    if (ground === null) continue;
    if (!Number.isFinite(ground) || pivot.y + (eye.y - pivot.y) * k <= ground + EYE_CLEARANCE_M) return false;
  }
  return true;
}

function usable(pose: CameraPose, pivot: Point, plan: StructurePlan, ctx?: ReplayCameraContext): boolean {
  if (!Object.values(pose).every(Number.isFinite)) return false;
  const length = Math.hypot(pose.x - pivot.x, pose.y - pivot.y, pose.z - pivot.z);
  if (length < MIN_ARM_M || length > MAX_ARM_M) return false;
  if (
    solidsNear(plan, pose.x, pose.z, EYE_CLEARANCE_M).some((s) =>
      insideSolid(s, pose.x, pose.y, pose.z, EYE_CLEARANCE_M),
    )
  )
    return false;
  // Unlike chase's arm solver, an arbitrary cinematic shot may not ignore a pivot inside a solid.
  if (solidsNear(plan, pivot.x, pivot.z, 0).some((s) => insideSolid(s, pivot.x, pivot.y, pivot.z, 0)))
    return false;
  if (armClear(plan, pivot, pose) < 1 || !aboveGround(pivot, pose, ctx)) return false;
  const vertical = (pose.fov * Math.PI) / 360;
  const halfFrame = Math.min(vertical, Math.atan(Math.tan(vertical) * aspectOf(ctx)));
  // A body-sized sphere fits with margin, including narrow views, after the eye has been moved.
  return Math.asin(Math.min(1, BODY_RADIUS_M / length)) < halfFrame * 0.85;
}

export function createReplayCamera({ road = null }: ReplayCameraOptions = {}): ReplayCamera {
  let follow = createFollowCamera({ road });
  let motion = 1;
  const fronts = createFrontKeeper(() => road, FRONT_PARAMS);

  const configure = (): void => {
    follow.setShakeAmount(0);
    follow.setMotionAmount(motion);
  };
  configure();

  return {
    reset() {
      follow = createFollowCamera({ road });
      configure();
      fronts.reset();
    },
    setMotionAmount(amount) {
      motion = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 1;
      follow.setMotionAmount(motion);
    },
    pose(target, playbackSeconds, mode, ctx) {
      // Replay controls never activate the live look-back mode or target/event camera moves.
      const context: CameraContext = { aspect: ctx?.aspect, structures: ctx?.structures };
      const fallback = follow.snap({ ...target, targetId: -1 }, context);
      const plan = ctx?.structures;
      if (!plan || ![target.x, target.y, target.z, target.heading, target.speed].every(Number.isFinite))
        return fallback;
      const pivot = { x: target.x, y: target.y + 1, z: target.z };
      const clear = (eye: Point): CameraPose | null => {
        if (![eye.x, eye.y, eye.z].every(Number.isFinite)) return null;
        if (Math.hypot(eye.x - pivot.x, eye.y - pivot.y, eye.z - pivot.z) > MAX_ARM_M) return null;
        const raw = aimed(eye, pivot);
        const solved = fronts.apply(raw, 0, target.road?.edge, { plan, pivot, helmet: false });
        const framed = aimed(solved, pivot);
        if (road) {
          const at = road.project(framed.x, framed.z, target.road?.edge);
          const limit = frontLimitM(
            road,
            at.edge,
            at.s,
            at.d < 0 ? 'left' : 'right',
            FRONT_PARAMS,
            plan.items.length > 0,
          );
          if (limit !== null && Math.abs(at.d) > limit + 1e-6) return null;
        }
        return usable(framed, pivot, plan, ctx) ? framed : null;
      };
      const safeFollow = (): CameraPose => {
        // Re-aim only the replay fallback, preserving live camera behavior and the missing-plan shot.
        const ordinary = clear(fallback);
        if (ordinary) return ordinary;
        // A terrain ridge can block the chase direction too; try bounded nearby bearings, never raise
        // blindly through a deck. Every alternative goes through the same eye/arm/framing checks.
        for (let i = 0; i < 8; i++) {
          const angle = target.heading + (i * Math.PI) / 4;
          const safe = clear({
            x: target.x + Math.sin(angle) * ORBIT_M,
            y: target.y + 2.6,
            z: target.z + Math.cos(angle) * ORBIT_M,
          });
          if (safe) return safe;
        }
        // An enclosed/invalid rider may offer no safe body-framing pose. Keep ordinary bounded follow;
        // this is deliberately not a claim of arbitrary geometry or unknown-terrain clearance.
        return fallback;
      };
      if (motion === 0) return safeFollow();
      const seconds = Number.isFinite(playbackSeconds) ? Math.max(0, playbackSeconds) : 0;
      let eye: Point | null = null;
      // Increase distance for a narrow viewport before validation; never widen the lens to compensate.
      const narrow = Math.max(1, 1 / aspectOf(ctx));
      const radius = Math.min(16, ORBIT_M * narrow);
      if (mode === 'orbit') {
        const bearing = target.heading + seconds * ORBIT_RAD_S * motion + Math.PI / 3;
        eye = {
          x: target.x + Math.sin(bearing) * radius,
          y: target.y + 3.2,
          z: target.z + Math.cos(bearing) * radius,
        };
      } else if (road?.edges.length) {
        const pos = road.project(target.x, target.z, target.road?.edge);
        const station = Math.floor(pos.s / STATION_M);
        const s = Math.min(road.edges[pos.edge]?.length ?? pos.s, Math.max(0, (station + 0.5) * STATION_M));
        const side = station % 2 === 0 ? 1 : -1;
        const anchor = road.toWorld(pos.edge, s, side * Math.min(16, TRACKSIDE_M * narrow), 0);
        const ground = road.toWorld(pos.edge, pos.s, pos.d, 0).y;
        // Fixed road stations and support-height bands hold the eye while the rider passes. A station
        // boundary or a changed support height justifies a cut; no accumulated frame clock is involved.
        eye = { x: anchor.x, y: anchor.y + 3.2 + Math.floor((target.y - ground) / 3) * 3, z: anchor.z };
      }
      return (eye && clear(eye)) ?? safeFollow();
    },
  };
}
