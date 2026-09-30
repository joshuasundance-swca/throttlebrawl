// Tilt steering (docs/milestones/M2.md, "input-2"; docs/architecture.md, "Input"). An option,
// never the default: turning the phone like a steering wheel steers.
//
// The steer angle is asin(g_h / |g|), where g_h is the gravity reading's component along the
// screen's horizontal axis, read from `devicemotion`'s `accelerationIncludingGravity` (the
// reaction to gravity: it points up). In landscape that axis is the device's long axis, so this is
// the plan's asin(g_long / |g|) with its sign set by `screen.orientation.angle`. Unlike Euler
// `beta`, the gravity component keeps working when the phone is held upright in landscape, where
// `gamma` nears its ±90° limit. Where `devicemotion` never arrives, `deviceorientation`'s `beta`
// (and `gamma` in portrait) is the fallback. The angle is low-pass filtered (tiltSmoothingS),
// zeroed at the race-start calibration, and mapped through a dead zone to full lock, divided by the
// sensitivity setting. The whole mapping is (unverified) until the phone check.
import type { InputThresholds } from '../tuning';

/** Steering from tilt, added to (or replacing) thumb steering. */
export interface TiltSource {
  /** Steering from tilt, -1..1, or null when there is no reading. `dt` is the sim step, seconds. */
  steer(dt?: number): number | null;
  /** Makes the current angle the rest angle (race start). */
  calibrate?(): void;
  dispose?(): void;
}

export interface GravityReading {
  x: number | null;
  y: number | null;
  z: number | null;
}

const RAD = 180 / Math.PI;

/**
 * The steering angle, degrees, positive when the phone turns clockwise as the player sees it
 * (steer right), from one gravity reading and the screen's orientation angle. Null when the
 * reading is missing or near zero.
 */
export function tiltAngleFromGravity(g: GravityReading, screenAngleDeg: number): number | null {
  const { x, y, z } = g;
  if (x === null || y === null) return null;
  const mag = Math.hypot(x, y, z ?? 0);
  if (!(mag > 1)) return null;
  // The screen's rightward axis in device coordinates: (cos a, -sin a).
  const a = (screenAngleDeg * Math.PI) / 180;
  const h = x * Math.cos(a) - y * Math.sin(a);
  // Turning clockwise tips the "up" reading toward the screen's left, so h falls: negate.
  return Math.asin(Math.max(-1, Math.min(1, -h / mag))) * RAD;
}

/**
 * The fallback from Euler angles (degrees): gravity's device components rebuilt from `beta` and
 * `gamma`, then the same angle as above.
 */
export function tiltAngleFromEuler(
  beta: number | null,
  gamma: number | null,
  screenAngleDeg: number,
): number | null {
  if (beta === null) return null;
  const b = beta / RAD;
  const c = (gamma ?? 0) / RAD;
  return tiltAngleFromGravity(
    { x: -Math.cos(b) * Math.sin(c) * 9.81, y: Math.sin(b) * 9.81, z: Math.cos(b) * Math.cos(c) * 9.81 },
    screenAngleDeg,
  );
}

/** The filter, calibration and response curve; fed readings, sampled per tick. Pure. */
export class TiltState implements TiltSource {
  private raw: number | null = null;
  private filtered: number | null = null;
  private rest: number | null = null;
  /** Divides the full-lock angle: 2 means half the tilt for full steer. */
  sensitivity = 1;
  private readonly t: InputThresholds;

  constructor(thresholds: InputThresholds) {
    this.t = thresholds;
  }

  /** A new angle reading, degrees (null: the sensor has nothing). */
  reading(angleDeg: number | null): void {
    if (angleDeg !== null && Number.isFinite(angleDeg)) this.raw = angleDeg;
  }

  /**
   * The angle now becomes the rest angle, and the filter starts from it. The newest reading, not
   * the smoothed one: the filter runs only while a race samples, so between races it still holds
   * the last race's angle, and the phone may have turned since.
   */
  calibrate(): void {
    if (this.raw !== null) this.filtered = this.raw;
    this.rest = this.raw;
  }

  steer(dt = 1 / 60): number | null {
    if (this.raw === null) return null;
    const tau = this.t.tiltSmoothingS;
    if (this.filtered === null || !(tau > 0)) this.filtered = this.raw;
    else this.filtered += (this.raw - this.filtered) * (1 - Math.exp(-dt / tau));
    // The first reading after switching tilt on is the rest angle until a race start recalibrates.
    if (this.rest === null) this.rest = this.filtered;
    const d = this.filtered - this.rest;
    const dz = Math.max(0, this.t.tiltDeadZoneDeg);
    const lock = Math.max(dz + 1, this.t.tiltFullLockDeg / Math.max(0.1, this.sensitivity));
    if (Math.abs(d) <= dz) return 0;
    return Math.sign(d) * Math.min(1, (Math.abs(d) - dz) / (lock - dz));
  }
}

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

interface MotionLike {
  accelerationIncludingGravity?: GravityReading | null;
}
interface OrientationLike {
  beta?: number | null;
  gamma?: number | null;
}

/**
 * Tilt from the browser's motion events on `target` (the window). `devicemotion` wins; once it has
 * given a reading, `deviceorientation` is ignored. `screenAngle` reads screen.orientation.angle.
 */
export function createTilt(
  target: Listenable,
  thresholds: InputThresholds,
  screenAngle: () => number,
): TiltState & { dispose(): void } {
  const state = new TiltState(thresholds) as TiltState & { dispose(): void };
  let motionSeen = false;
  const onMotion = (e: Event) => {
    const g = (e as unknown as MotionLike).accelerationIncludingGravity;
    const angle = g ? tiltAngleFromGravity(g, screenAngle()) : null;
    if (angle === null) return;
    motionSeen = true;
    state.reading(angle);
  };
  const onOrientation = (e: Event) => {
    if (motionSeen) return;
    const o = e as unknown as OrientationLike;
    state.reading(tiltAngleFromEuler(o.beta ?? null, o.gamma ?? null, screenAngle()));
  };
  target.addEventListener('devicemotion', onMotion);
  target.addEventListener('deviceorientation', onOrientation);
  state.dispose = () => {
    target.removeEventListener('devicemotion', onMotion);
    target.removeEventListener('deviceorientation', onOrientation);
  };
  return state;
}

/** screen.orientation.angle, with the older window.orientation, or landscape (90) as a guess. */
export function browserScreenAngle(): number {
  const g = globalThis as unknown as {
    screen?: { orientation?: { angle?: number } };
    orientation?: number;
  };
  const a = g.screen?.orientation?.angle ?? g.orientation ?? 90;
  return ((a % 360) + 360) % 360;
}
