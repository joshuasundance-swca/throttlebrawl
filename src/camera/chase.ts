// The low chase cam (docs/architecture.md, "Camera"; docs/milestones/M1.md, camera-1).
//
// The rig keeps its state as springs on the camera's placement *relative to the rider*: a bearing
// (yaw), a distance, a height, a small sideways shift, and the aim point's offset. The rider's
// own motion passes straight through, so the bike stays put on screen at any speed (a spring on
// absolute position would trail a 38 m/s bike by metres), while every change of framing (a bend,
// a tuning change, a new auto-target, a lean) eases in on a critically damped spring and never
// overshoots.
//
// Where the aim comes from:
// - With the road handle, the camera finds the rider on the road, faces along the road the way the
//   rider is going, and aims at a point `camera.lookAheadM` further along the road in the rider's
//   lane. Weaving on the bars does not swing the camera; a bend does.
// - Without it (or at a dead end), it faces the rider's heading.
// The camera never writes sim state and never reads anything but the target, the entities it is
// handed and the road handle.
import type { EntitySnapshot, MoverMode, RoadNetwork, SimEvent } from '../sim/api';
import { createShake } from './shake';
import { spring, stepAngleSpring, stepSpring } from './spring';

/** What the rig reads about the rider it follows: the interpolated snapshot fields. */
export interface CameraTarget {
  x: number;
  y: number;
  z: number;
  /** World heading about +y (three.js rotation.y of a model facing -z). */
  heading: number;
  speed: number;
  /** Entity id, so the rig can pick out the events that involve this rider. */
  id?: number | undefined;
  lean?: number | undefined;
  mode?: MoverMode | undefined;
  /** The rider's current auto-target, or -1. */
  targetId?: number | undefined;
  /** The rider's road position in the snapshot, used as a hint to find it on the road. */
  road?: { edge: number } | undefined;
}

/** Other entities the rig may frame (the auto-target), from the same snapshot. */
export interface CameraContext {
  entities?: readonly Pick<EntitySnapshot, 'id' | 'x' | 'y' | 'z'>[] | undefined;
}

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  /** Vertical field of view, degrees. */
  fov: number;
  /**
   * Roll about the view axis, radians, in three.js `rotation.z` sense (the same sense render uses
   * for the bike's lean, `rotation.z = -lean`).
   */
  roll: number;
  /** The camera's up vector with the roll applied: set `camera.up` to it before `lookAt`. */
  upX: number;
  upY: number;
  upZ: number;
}

export interface ChaseParams {
  chaseDistanceM: number;
  heightM: number;
  lookAheadM: number;
  lookHeightM: number;
  springRate: number;
  rollFraction: number;
  fovBaseDeg: number;
  fovKickDeg: number;
  fovKickSpeedMps: number;
  targetBias: number;
  shakeScale: number;
}

export interface ChaseRig {
  update(target: CameraTarget, dt: number, ctx?: CameraContext): CameraPose;
  snap(target: CameraTarget, ctx?: CameraContext): CameraPose;
  onEvents(events: readonly SimEvent[]): void;
  setRoad(road: RoadNetwork | null): void;
  readonly params: ChaseParams;
}

// Relative spring rates: the aim settles a little faster than the placement, so a bend is read
// before the camera swings; the FOV breathes a little slower.
const AIM_RATE = 1.5;
const ROLL_RATE = 1.2;
const FOV_RATE = 0.8;
/** How far to either side the auto-target can pull the framing, metres of lateral offset. */
const BIAS_LATERAL_MAX_M = 4;
/** The camera itself shifts away from the target by this share of the aim's shift. */
const BIAS_CAMERA_SHARE = 0.4;
/** Targets further than this are not framed. */
const BIAS_RANGE_M = 25;
/** Heading must agree with the road this clearly (|cos|) before the rig trusts it for direction. */
const DIR_CONFIDENCE = 0.25;
/** A look-ahead point closer than this (a dead end just ahead) is replaced by the fallback. */
const MIN_AIM_M = 2;
/** The longest frame the rig integrates; the loop already clamps to this. */
const MAX_DT = 0.25;

interface Goal {
  yaw: number;
  distance: number;
  height: number;
  side: number;
  aimX: number;
  aimY: number;
  aimZ: number;
  roll: number;
  fov: number;
}

const finite = (v: number): boolean => Number.isFinite(v);

function yawOf(fx: number, fz: number): number {
  // Heading convention: forward = (-sin yaw, -cos yaw).
  return Math.atan2(-fx, -fz);
}

export function createChaseRig(params: ChaseParams, initialRoad: RoadNetwork | null = null): ChaseRig {
  let road = initialRoad && initialRoad.edges.length > 0 ? initialRoad : null;
  let hintEdge: number | undefined;
  /** The last trusted world direction of travel (horizontal unit vector). */
  let travelX = 0;
  let travelZ = -1;
  let haveTravel = false;
  let pending: SimEvent[] = [];
  const shake = createShake();

  const s = {
    yaw: spring(0),
    distance: spring(params.chaseDistanceM),
    height: spring(params.heightM),
    side: spring(0),
    aimX: spring(0),
    aimY: spring(0),
    aimZ: spring(0),
    roll: spring(0),
    fov: spring(params.fovBaseDeg),
  };
  let ready = false;
  let last: CameraPose | null = null;

  const goalFor = (t: CameraTarget, ctx: CameraContext | undefined): Goal => {
    const hx = -Math.sin(t.heading);
    const hz = -Math.cos(t.heading);
    const tumbling = t.mode === 'Tumble';
    if (!tumbling || !haveTravel) {
      travelX = hx;
      travelZ = hz;
      haveTravel = true;
    }

    let fx = hx;
    let fz = hz;
    let aimX = t.x + hx * params.lookAheadM;
    let aimY = t.y + params.lookHeightM;
    let aimZ = t.z + hz * params.lookAheadM;

    if (road) {
      const hint = t.road && t.road.edge >= 0 && t.road.edge < road.edges.length ? t.road.edge : hintEdge;
      const pos = road.project(t.x, t.z, hint);
      hintEdge = pos.edge;
      const frame = road.frameAt(pos.edge, pos.s);
      const along = travelX * frame.tx + travelZ * frame.tz;
      // Tumbling (or sideways to the road), keep the last direction the rider was going.
      let dir: 1 | -1 = along >= 0 ? 1 : -1;
      if (!tumbling && Math.abs(along) < DIR_CONFIDENCE) {
        const prev = last ? -Math.sin(s.yaw.x) * frame.tx - Math.cos(s.yaw.x) * frame.tz : along;
        dir = prev >= 0 ? 1 : -1;
      }
      fx = frame.tx * dir;
      fz = frame.tz * dir;
      const ahead = { edge: pos.edge, s: pos.s + dir * params.lookAheadM, d: pos.d, dir };
      road.advance(ahead);
      const p = road.toWorld(ahead.edge, ahead.s, ahead.d, 0);
      if (Math.hypot(p.x - t.x, p.z - t.z) >= MIN_AIM_M) {
        aimX = p.x;
        aimY = p.y + params.lookHeightM;
        aimZ = p.z;
      } else {
        aimX = t.x + fx * params.lookAheadM;
        aimY = t.y + params.lookHeightM;
        aimZ = t.z + fz * params.lookAheadM;
      }
    }

    // Framing bias toward the auto-target: the aim leans toward its side of the road and the
    // camera steps the other way, so both riders stay in frame.
    let side = 0;
    const targetId = t.targetId ?? -1;
    if (targetId >= 0 && ctx?.entities && params.targetBias > 0) {
      const other = ctx.entities.find((e) => e.id === targetId);
      if (other && Math.hypot(other.x - t.x, other.z - t.z) <= BIAS_RANGE_M) {
        const rx = -fz; // right of forward (f × up, horizontal)
        const rz = fx;
        const lateral = (other.x - t.x) * rx + (other.z - t.z) * rz;
        const shift =
          Math.max(-BIAS_LATERAL_MAX_M, Math.min(BIAS_LATERAL_MAX_M, lateral)) *
          Math.min(1, params.targetBias);
        aimX += rx * shift;
        aimZ += rz * shift;
        side = -shift * BIAS_CAMERA_SHARE;
      }
    }

    const kick = params.fovKickSpeedMps > 0 ? Math.min(1, Math.max(0, t.speed / params.fovKickSpeedMps)) : 0;
    return {
      yaw: yawOf(fx, fz),
      distance: params.chaseDistanceM,
      height: params.heightM,
      side,
      aimX: aimX - t.x,
      aimY: aimY - t.y,
      aimZ: aimZ - t.z,
      roll: -(t.lean ?? 0) * params.rollFraction,
      fov: params.fovBaseDeg + params.fovKickDeg * kick * kick,
    };
  };

  const settle = (g: Goal): void => {
    for (const [sp, v] of [
      [s.yaw, g.yaw],
      [s.distance, g.distance],
      [s.height, g.height],
      [s.side, g.side],
      [s.aimX, g.aimX],
      [s.aimY, g.aimY],
      [s.aimZ, g.aimZ],
      [s.roll, g.roll],
      [s.fov, g.fov],
    ] as const) {
      sp.x = v;
      sp.v = 0;
    }
    ready = true;
  };

  const poseFrom = (t: CameraTarget, shakeSide: number, shakeUp: number, shakeRoll: number): CameraPose => {
    const fx = -Math.sin(s.yaw.x);
    const fz = -Math.cos(s.yaw.x);
    const rx = -fz;
    const rz = fx;
    let x = t.x - fx * s.distance.x + rx * s.side.x;
    let y = t.y + s.height.x;
    let z = t.z - fz * s.distance.x + rz * s.side.x;
    let lookX = t.x + s.aimX.x;
    let lookY = t.y + s.aimY.x;
    let lookZ = t.z + s.aimZ.x;

    // View basis: right = view × worldUp, up = right × view.
    let vx = lookX - x;
    let vy = lookY - y;
    let vz = lookZ - z;
    const vl = Math.hypot(vx, vy, vz);
    if (vl < 1e-6) {
      vx = fx;
      vy = 0;
      vz = fz;
    } else {
      vx /= vl;
      vy /= vl;
      vz /= vl;
    }
    let bx = -vz;
    let bz = vx;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-6) {
      bx = rx;
      bz = rz;
    } else {
      bx /= bl;
      bz /= bl;
    }
    const ux = -bz * vy;
    const uy = bz * vx - bx * vz;
    const uz = bx * vy;

    if (shakeSide !== 0 || shakeUp !== 0) {
      const ox = bx * shakeSide + ux * shakeUp;
      const oy = uy * shakeUp;
      const oz = bz * shakeSide + uz * shakeUp;
      x += ox;
      y += oy;
      z += oz;
      lookX += ox * 0.4;
      lookY += oy * 0.4;
      lookZ += oz * 0.4;
    }

    const roll = s.roll.x + shakeRoll;
    const sr = Math.sin(roll);
    const cr = Math.cos(roll);
    return {
      x,
      y,
      z,
      lookX,
      lookY,
      lookZ,
      fov: s.fov.x,
      roll,
      upX: -bx * sr + ux * cr,
      upY: uy * cr,
      upZ: -bz * sr + uz * cr,
    };
  };

  const valid = (p: CameraPose): boolean => Object.values(p).every(finite);
  const targetValid = (t: CameraTarget): boolean =>
    finite(t.x) && finite(t.y) && finite(t.z) && finite(t.heading) && finite(t.speed);

  const snap = (t: CameraTarget, ctx?: CameraContext): CameraPose => {
    pending = [];
    shake.reset();
    if (!targetValid(t)) return last ?? fallbackPose();
    settle(goalFor(t, ctx));
    last = poseFrom(t, 0, 0, 0);
    return last;
  };

  return {
    params,
    snap,
    update(t, dtIn, ctx) {
      if (!targetValid(t)) return last ?? fallbackPose();
      if (!ready) return snap(t, ctx);
      const dt = finite(dtIn) && dtIn > 0 ? Math.min(dtIn, MAX_DT) : 0;
      const g = goalFor(t, ctx);
      const w = params.springRate;
      stepAngleSpring(s.yaw, g.yaw, w, dt);
      stepSpring(s.distance, g.distance, w, dt);
      stepSpring(s.height, g.height, w, dt);
      stepSpring(s.side, g.side, w, dt);
      stepSpring(s.aimX, g.aimX, w * AIM_RATE, dt);
      stepSpring(s.aimY, g.aimY, w * AIM_RATE, dt);
      stepSpring(s.aimZ, g.aimZ, w * AIM_RATE, dt);
      stepSpring(s.roll, g.roll, w * ROLL_RATE, dt);
      stepSpring(s.fov, g.fov, w * FOV_RATE, dt);

      if (pending.length) {
        shake.add(pending, t.id ?? -1);
        pending = [];
      }
      const k = shake.step(dt, params.shakeScale);
      const pose = poseFrom(t, k.side, k.up, k.roll);
      if (!valid(pose)) {
        // Never hand render a NaN: start over from the ideal framing.
        settle(goalFor(t, ctx));
        last = poseFrom(t, 0, 0, 0);
        return last;
      }
      last = pose;
      return pose;
    },
    onEvents(events) {
      if (events.length) pending = pending.concat(events);
    },
    setRoad(next) {
      road = next && next.edges.length > 0 ? next : null;
      hintEdge = undefined;
    },
  };

  function fallbackPose(): CameraPose {
    return {
      x: 0,
      y: params.heightM,
      z: params.chaseDistanceM,
      lookX: 0,
      lookY: params.lookHeightM,
      lookZ: -params.lookAheadM,
      fov: params.fovBaseDeg,
      roll: 0,
      upX: 0,
      upY: 1,
      upZ: 0,
    };
  }
}
