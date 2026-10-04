// The rider's pose (interview, 2026-10-02: real riders with limbs): measurements read off the baked
// parts, two-bone IK for arms and legs, and the seated pose that puts the hips on the bike's
// `seat_anchor`, the hands on `bar_l`/`bar_r` and the feet on `peg_l`/`peg_r`, whatever the bike.
// Pure math on three's vectors: every bone gets a position and an absolute rotation in the rider's
// frame (the bike's frame while riding; x right, y up, forward -z). Presentation only.
import { Quaternion, Vector3 } from 'three';
import { boneIndex, RIDER_BONES, type BakedPart, type PropMount, type RiderBone } from './bake';

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export type Side = 'l' | 'r';
export const SIDES: readonly Side[] = ['l', 'r'];
/** +1 for the rider's right (game +x), -1 for the left. */
export const sideSign = (s: Side): number => (s === 'r' ? 1 : -1);

export interface LimbMeasure {
  /** Rest joint positions: shoulder (or hip), elbow (or knee), grip (or ankle). */
  root: Vector3;
  mid: Vector3;
  end: Vector3;
  upper: number;
  lower: number;
  /** Rest directions of the two segments. */
  upperDir: Vector3;
  lowerDir: Vector3;
}

export interface RiderFrame {
  rest: Record<RiderBone, Vector3>;
  arms: Record<Side, LimbMeasure>;
  legs: Record<Side, LimbMeasure>;
  /** The seat under the hips at rest (the root's `seat_m`), which the bike's seat anchor takes. */
  seatY: number;
  propMount: PropMount;
  /** Height of the head's top above the feet, roughly (for framing). */
  height: number;
}

export interface BikeFrame {
  seat: Vector3;
  bars: Record<Side, Vector3>;
  pegs: Record<Side, Vector3>;
  lightHead: Vector3;
  lightTail: Vector3;
  fork: Vector3;
  /** The steering axis (unit), from the front axle up through the steering head. */
  steerAxis: Vector3;
  wheelbase: number;
  /** Wheel radii (front, rear), from the axles' heights. */
  radius: { front: number; rear: number };
  /** Contact points of the rear and front wheels (wheelie and stoppie pivots). */
  rearContact: Vector3;
  frontContact: Vector3;
  bikeClass: string;
}

function limb(root: Vector3, mid: Vector3, end: Vector3): LimbMeasure {
  return {
    root: root.clone(),
    mid: mid.clone(),
    end: end.clone(),
    upper: root.distanceTo(mid),
    lower: mid.distanceTo(end),
    upperDir: mid.clone().sub(root).normalize(),
    lowerDir: end.clone().sub(mid).normalize(),
  };
}

const PROP_MOUNT_SET = new Set<string>(['head', 'chest', 'hips', 'seat']);

/** A rider's measurements from its baked part. */
export function riderFrame(part: BakedPart): RiderFrame {
  const rest = {} as Record<RiderBone, Vector3>;
  for (const name of RIDER_BONES) {
    const b = part.bones[boneIndex(part, name)];
    if (!b) throw new Error(`rider part has no ${name}`);
    rest[name] = b.rest.clone();
  }
  const pt = (n: string) => {
    const p = part.points[n];
    if (!p) throw new Error(`rider part has no ${n}`);
    return p;
  };
  const mountRaw = part.extras['prop_mount'];
  const mount = typeof mountRaw === 'string' ? mountRaw : 'chest';
  const seat = Number(part.extras['seat_m']);
  let top = 0;
  for (let i = 1; i < part.positions.length; i += 3) top = Math.max(top, part.positions[i] ?? 0);
  return {
    rest,
    arms: {
      l: limb(rest.upper_arm_l, rest.forearm_l, pt('grip_l')),
      r: limb(rest.upper_arm_r, rest.forearm_r, pt('grip_r')),
    },
    legs: {
      l: limb(rest.thigh_l, rest.shin_l, pt('ankle_l')),
      r: limb(rest.thigh_r, rest.shin_r, pt('ankle_r')),
    },
    seatY: Number.isFinite(seat) && seat > 0 ? seat : rest.hips.y - 0.1,
    propMount: (PROP_MOUNT_SET.has(mount) ? mount : 'chest') as PropMount,
    height: top,
  };
}

/** A bike's anchors and wheels from its baked part. */
export function bikeFrame(part: BakedPart): BikeFrame {
  const pt = (n: string, fallback?: Vector3) => {
    const p = part.points[n] ?? fallback;
    if (!p) throw new Error(`bike part has no ${n}`);
    return p.clone();
  };
  const bone = (n: string) => part.bones[boneIndex(part, n)]?.rest.clone() ?? null;
  const front = bone('wheel_front') ?? new Vector3(0, 0.32, -0.7);
  const rear = bone('wheel_rear') ?? new Vector3(0, 0.32, 0.7);
  const fork = bone('fork') ?? front.clone().add(new Vector3(0, 0.5, 0.2));
  const axis = fork.clone().sub(front);
  if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
  axis.normalize();
  const seat = pt('seat_anchor');
  const wb = Number(part.extras['wheelbase_m']);
  return {
    seat,
    bars: { l: pt('bar_l'), r: pt('bar_r') },
    pegs: { l: pt('peg_l'), r: pt('peg_r') },
    lightHead: pt('light_head', new Vector3(0, 0.9, front.z - 0.1)),
    lightTail: pt('light_tail', new Vector3(0, seat.y, rear.z + 0.1)),
    fork,
    steerAxis: axis,
    wheelbase: Number.isFinite(wb) && wb > 0 ? wb : Math.abs(rear.z - front.z),
    radius: { front: Math.max(0.1, front.y), rear: Math.max(0.1, rear.y) },
    rearContact: new Vector3(0, 0, rear.z),
    frontContact: new Vector3(0, 0, front.z),
    bikeClass: typeof part.extras['class'] === 'string' ? part.extras['class'] : '',
  };
}

/**
 * Two-bone IK: from `root`, segments `l1` and `l2` reach toward `target`, bending toward `pole`.
 * Writes the middle joint and the end (the target, or as near as the limb reaches).
 */
export function twoBoneIk(
  root: Vector3,
  target: Vector3,
  l1: number,
  l2: number,
  pole: Vector3,
  outMid: Vector3,
  outEnd: Vector3,
): void {
  const u = target.clone().sub(root);
  let d = u.length();
  if (d < 1e-6) {
    u.set(0, -1, 0);
    d = 1e-6;
  } else u.divideScalar(d);
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const v = pole.clone().addScaledVector(u, -pole.dot(u));
  if (v.lengthSq() < 1e-8)
    v.copy(Math.abs(u.y) < 0.9 ? Y : Z).addScaledVector(u, -u.dot(Math.abs(u.y) < 0.9 ? Y : Z));
  v.normalize();
  outMid
    .copy(root)
    .addScaledVector(u, l1 * cosA)
    .addScaledVector(v, l1 * sinA);
  outEnd.copy(root).addScaledVector(u, d);
}

/** One bone's pose in the rider's frame: where its joint is and its absolute rotation. */
export interface BonePose {
  p: Vector3;
  q: Quaternion;
}

export type RiderPose = Record<RiderBone, BonePose>;

export function freshPose(frame: RiderFrame): RiderPose {
  const out = {} as RiderPose;
  for (const name of RIDER_BONES) out[name] = { p: frame.rest[name].clone(), q: new Quaternion() };
  return out;
}

/** The rotation about x that leans the body forward by `a` radians (forward is -z). */
export function leanForward(a: number, out = new Quaternion()): Quaternion {
  return out.setFromAxisAngle(X, -a);
}

/** Places a child bone rigidly on a parent: its joint keeps its rest offset, turned by `q`. */
export function follow(
  frame: RiderFrame,
  pose: RiderPose,
  child: RiderBone,
  parent: RiderBone,
  q?: Quaternion,
): void {
  const par = pose[parent];
  const off = frame.rest[child].clone().sub(frame.rest[parent]).applyQuaternion(par.q);
  pose[child].p.copy(par.p).add(off);
  pose[child].q.copy(q ?? par.q);
}

/** Sets a limb's two bones from its joint positions (the rotation from rest to the new segment). */
export function setLimb(
  pose: RiderPose,
  upper: RiderBone,
  lower: RiderBone,
  m: LimbMeasure,
  root: Vector3,
  mid: Vector3,
  end: Vector3,
): void {
  pose[upper].p.copy(root);
  pose[upper].q.setFromUnitVectors(m.upperDir, mid.clone().sub(root).normalize());
  pose[lower].p.copy(mid);
  pose[lower].q.setFromUnitVectors(m.lowerDir, end.clone().sub(mid).normalize());
}

/** Where a limb's root joint is, given the bone it hangs from (hips or chest) in `pose`. */
export function limbRoot(
  frame: RiderFrame,
  pose: RiderPose,
  body: 'hips' | 'chest',
  m: LimbMeasure,
  out: Vector3,
): Vector3 {
  const b = pose[body];
  return out.copy(m.root).sub(frame.rest[body]).applyQuaternion(b.q).add(b.p);
}

/** The pole each limb bends toward while riding: elbows out and back, knees forward and out. */
export function ridingPole(kind: 'arm' | 'leg', side: Side, out = new Vector3()): Vector3 {
  const s = sideSign(side);
  return kind === 'arm' ? out.set(s * 0.8, -0.35, 0.6).normalize() : out.set(s * 0.35, 0.1, -1).normalize();
}

/** The seated pose's fixed parts for a rider on a bike (computed once per pairing). */
export interface Seating {
  /** Hips joint above the seat anchor. */
  hips: Vector3;
  /** The forward lean of the chest that puts the hands at a comfortable reach of the bars. */
  chestLean: number;
  /** The pelvis's own forward tilt. */
  hipsLean: number;
  /**
   * The most upright (or back-leaning) chest the arms still allow: the lean at which the shoulders
   * are STRETCH_REACH of an arm's length from the grips. A wheelie or a backflip sits back this far
   * and no further, so the hands stay on the bars. At most `chestLean`.
   */
  stretchLean: number;
}

/** How much of an arm's length the stretched pose may use (the seated one uses 0.88). */
export const STRETCH_REACH = 0.97;

/**
 * Solves the seated lean: the hips sit on the seat anchor, and the chest leans forward (or back,
 * on a chopper's high bars) until the shoulders are about 88% of an arm's length from the grips.
 */
export function seating(rider: RiderFrame, bike: BikeFrame): Seating {
  const hips = bike.seat.clone().add(new Vector3(0, rider.rest.hips.y - rider.seatY, 0.02));
  const barMid = bike.bars.l.clone().add(bike.bars.r).multiplyScalar(0.5);
  const reach = 0.88 * (rider.arms.l.upper + rider.arms.l.lower);
  const shoulderMid = rider.rest.upper_arm_l.clone().add(rider.rest.upper_arm_r).multiplyScalar(0.5);
  const q = new Quaternion();
  const qh = new Quaternion();
  let best = 0.2;
  let bestCost = Infinity;
  for (let a = -0.35; a <= 1.3001; a += 0.025) {
    const hipsLean = a * 0.35;
    leanForward(hipsLean, qh);
    const chest = rider.rest.chest.clone().sub(rider.rest.hips).applyQuaternion(qh).add(hips);
    leanForward(a, q);
    const sh = shoulderMid.clone().sub(rider.rest.chest).applyQuaternion(q).add(chest);
    const cost = Math.abs(sh.distanceTo(barMid) - reach) + 0.03 * Math.abs(a - 0.25);
    if (cost < bestCost) {
      bestCost = cost;
      best = a;
    }
  }
  // Sitting back: walk the lean down from the seated one until the arms are nearly straight.
  let stretch = best;
  for (let a = best; a >= -0.9; a -= 0.025) {
    const hipsLean = a * 0.35;
    leanForward(hipsLean, qh);
    const chest = rider.rest.chest.clone().sub(rider.rest.hips).applyQuaternion(qh).add(hips);
    leanForward(a, q);
    const sh = shoulderMid.clone().sub(rider.rest.chest).applyQuaternion(q).add(chest);
    if (sh.distanceTo(barMid) > STRETCH_REACH * (reach / 0.88)) break;
    stretch = a;
  }
  return { hips, chestLean: best, hipsLean: best * 0.35, stretchLean: stretch };
}
