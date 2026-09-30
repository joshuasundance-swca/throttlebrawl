// Tilt steering, a seam only in M1 (docs/milestones/M1.md, "input-1"). The DeviceOrientation
// reader (beta in landscape, sign flipped by screen.orientation.angle, recalibrated at race start,
// with a sensitivity slider) plugs in here later; it adds to thumb steering (hybrid).
export interface TiltSource {
  /** Steering from tilt, -1..1, or null when there is no reading. */
  steer(): number | null;
}
