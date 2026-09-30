// Intelligent Driver Model car-following (Treiber, Hennecke and Helbing, 2000), the rule the
// architecture doc names for traffic: each vehicle accelerates toward its cruise speed and brakes
// smoothly behind whatever is ahead in its lane, so cars stop behind a stopped rider or a crash
// with no extra code. Plain + - * / and sqrt only (docs/architecture.md, "Determinism rules").

export interface IdmParams {
  /** Desired time gap to the leader, s. */
  timeGapS: number;
  /** Minimum bumper-to-bumper gap when stopped, m. */
  minGapM: number;
  /** Maximum acceleration, m/s². */
  accelMps2: number;
  /** Comfortable deceleration, m/s². */
  comfortDecelMps2: number;
  /** Hardest braking allowed, m/s² (positive). */
  maxDecelMps2: number;
}

/** [default] starting values for M1 traffic: a relaxed Sunday driver on a causeway. */
export const IDM: IdmParams = {
  timeGapS: 1.2,
  minGapM: 3,
  accelMps2: 1.6,
  comfortDecelMps2: 3,
  maxDecelMps2: 9,
};

/**
 * Acceleration for a vehicle at speed `v` wanting `v0`, with a leader `gap` metres ahead
 * (bumper to bumper) moving at `vLead` along the same direction. `gap` = Infinity means a free
 * road. The free-road term uses the IDM exponent 4.
 */
export function idmAccel(v: number, v0: number, gap: number, vLead: number, p: IdmParams = IDM): number {
  let free: number;
  if (v0 <= 0.01) {
    free = v > 0 ? -p.comfortDecelMps2 : 0;
  } else {
    const r = v / v0;
    const r2 = r * r;
    free = p.accelMps2 * (1 - r2 * r2);
  }
  let acc = free;
  if (gap !== Infinity) {
    if (gap <= 0.1) return -p.maxDecelMps2;
    const dv = v - vLead;
    const wanted =
      p.minGapM + Math.max(0, v * p.timeGapS + (v * dv) / (2 * Math.sqrt(p.accelMps2 * p.comfortDecelMps2)));
    const q = wanted / gap;
    acc -= p.accelMps2 * q * q;
  }
  return acc < -p.maxDecelMps2 ? -p.maxDecelMps2 : acc > p.accelMps2 ? p.accelMps2 : acc;
}
