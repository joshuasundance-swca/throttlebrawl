// The frame-rate cap (docs/milestones/M1.md, tuning-1): a divisor of the measured refresh rate,
// full, 1/2 or 1/3, so every shown frame lasts the same number of screen refreshes (90, 45 and 30
// fps on a 90 Hz screen; 60, 30 and 20 on a 60 Hz one). A fixed 60 fps cap on a 90 Hz screen
// would skip every third frame and judder, so it is not offered. The cap is presentation only.
import type { TuningParamDecl } from '../core';

export const FRAME_DIVISOR_ID = 'display.frameDivisor';
export const FRAME_DIVISOR_MAX = 3;

/** Tuning's own declaration: the loop runs one animation frame in every `divisor`. */
export const FRAME_CAP_TUNING: readonly TuningParamDecl[] = [
  {
    id: FRAME_DIVISOR_ID,
    group: 'frame-rate',
    label: 'Frame-rate cap',
    default: 1,
    min: 1,
    max: FRAME_DIVISOR_MAX,
    step: 1,
    unit: '',
    affectsSim: false,
  },
];

/** Common panel rates; a measurement within 4 % of one snaps to it. */
const COMMON_HZ = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];

/** The refresh rate from animation-frame intervals (ms): the median, snapped to a common rate. */
export function measureRefreshHz(intervalsMs: readonly number[]): number | null {
  const good = intervalsMs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (good.length === 0) return null;
  const median = good[Math.floor(good.length / 2)] ?? 0;
  const hz = 1000 / median;
  const near = COMMON_HZ.find((c) => Math.abs(hz - c) / c <= 0.04);
  return near ?? Math.round(hz);
}

export interface FrameCapOption {
  divisor: number;
  /** The resulting frame rate, or null before the refresh rate is measured. */
  fps: number | null;
  label: string;
}

const LABELS = ['every frame', 'every 2nd frame', 'every 3rd frame'];

/** The offered caps: divisors of the refresh rate, labelled by what they do on the device. */
export function frameCapOptions(refreshHz: number | null): FrameCapOption[] {
  return LABELS.map((label, i) => ({
    divisor: i + 1,
    fps: refreshHz === null ? null : Math.round(refreshHz / (i + 1)),
    label,
  }));
}

/** A whole divisor in 1..3; anything else is full rate (or the largest cap). */
export function sanitizeDivisor(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) return 1;
  return Math.min(FRAME_DIVISOR_MAX, value);
}

export interface FrameGate {
  /** Call once per animation frame: true when this frame should run (step and draw). */
  shouldRun(): boolean;
}

/**
 * Counts animation frames and lets one in every `divisor` through. The loop skips the others
 * entirely, so the next run frame sees the whole elapsed time and the sim keeps real-time pace.
 */
export function createFrameGate(divisor: () => number): FrameGate {
  let count = 0;
  let current = 1;
  return {
    shouldRun() {
      const d = sanitizeDivisor(divisor());
      if (d !== current) {
        current = d;
        count = 0;
      }
      const run = count % d === 0;
      count = (count + 1) % d;
      return run;
    },
  };
}
