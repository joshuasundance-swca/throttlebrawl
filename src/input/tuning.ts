// Input tuning declarations (docs/milestones/M1.md, "Starting numbers": the attack side drag and
// the kick swipe). Presentation-side: the thresholds shape which SimInput is produced, and those
// inputs are recorded, so a replay never re-derives them (affectsSim false).
import type { TuningParamDecl } from '../core';

export interface InputThresholds {
  /** Sideways travel on the attack button that picks a side, CSS px. */
  attackDragPx: number;
  /** The side drag must cross attackDragPx within this long after the press, ms. */
  attackDragMs: number;
  /** Downward travel on the attack button that turns the wind-up into a kick, CSS px. */
  kickSwipePx: number;
  /** The kick swipe must cross kickSwipePx within this long after the press, ms. */
  kickSwipeMs: number;
  /** Stick travel for full throttle or full steer, CSS px. */
  stickRangePx: number;
  /** Stick steering dead zone, as a fraction of full deflection. */
  stickDeadZone: number;
  /** Gamepad stick dead zone, radial, as a fraction of full deflection (M2 input-2). */
  gamepadDeadZone: number;
  /** Tilt steering dead zone either side of the calibrated rest angle, degrees (M2 input-2). */
  tiltDeadZoneDeg: number;
  /** Tilt from the rest angle that gives full steer at sensitivity 1, degrees (M2 input-2). */
  tiltFullLockDeg: number;
  /** Tilt low-pass time constant, seconds (M2 input-2). */
  tiltSmoothingS: number;
}

const decl = (
  key: keyof InputThresholds,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  unit: string,
): TuningParamDecl => ({
  id: `input.${key}`,
  group: 'controls',
  label,
  default: value,
  min,
  max,
  step,
  unit,
  affectsSim: false,
});

// The ms maxima keep the timing invariant (gesture.ts) true. The side drag works only during the
// wind-up: ceil(80 ms at 60 Hz) = 5 ticks, plus the sampling tick, is 6, under the punch's 7. The
// kick swipe window (playtest 1: 200 ms, so a natural 150-200 ms swipe counts) must land inside
// combat's 250 ms (15-tick) kick-conversion window: ceil(200 ms) = 12 ticks, plus the sampling
// tick, is 13; the slider's maximum, ceil(230 ms) = 14, plus 1 is 15.
export const INPUT_TUNING: readonly TuningParamDecl[] = [
  decl('attackDragPx', 'Attack side drag', 24, 8, 80, 1, 'px'),
  decl('attackDragMs', 'Attack side drag window', 80, 30, 80, 5, 'ms'),
  decl('kickSwipePx', 'Kick swipe distance', 24, 8, 80, 1, 'px'),
  decl('kickSwipeMs', 'Kick swipe window', 200, 30, 230, 5, 'ms'),
  decl('stickRangePx', 'Stick range', 60, 30, 140, 5, 'px'),
  decl('stickDeadZone', 'Stick steer dead zone', 0.08, 0, 0.3, 0.01, ''),
  // M2 input-2 starting numbers (docs/milestones/M2.md, "Starting numbers").
  decl('gamepadDeadZone', 'Gamepad stick dead zone', 0.12, 0, 0.4, 0.01, ''),
  decl('tiltDeadZoneDeg', 'Tilt dead zone', 2, 0, 10, 0.5, 'deg'),
  decl('tiltFullLockDeg', 'Tilt full lock', 25, 8, 60, 1, 'deg'),
  decl('tiltSmoothingS', 'Tilt smoothing', 0.1, 0, 0.5, 0.01, 's'),
];

/** The shipped thresholds. */
export function inputDefaults(): InputThresholds {
  const t = {} as Record<string, number>;
  for (const d of INPUT_TUNING) t[d.id.slice('input.'.length)] = d.default;
  return t as unknown as InputThresholds;
}

/** Applies one `input.*` tuning value; returns false for ids that are not the input module's. */
export function applyInputParam(t: InputThresholds, id: string, value: number): boolean {
  const key = id.startsWith('input.') ? id.slice('input.'.length) : '';
  if (!(key in t) || !Number.isFinite(value)) return false;
  t[key as keyof InputThresholds] = value;
  return true;
}
