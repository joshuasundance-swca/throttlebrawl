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

// The ms maxima keep the timing invariant (gesture.ts) true against M1's 7-tick punch wind-up:
// ceil(80 ms at 60 Hz) = 5 ticks, plus the sampling tick, is 6, under 7.
export const INPUT_TUNING: readonly TuningParamDecl[] = [
  decl('attackDragPx', 'Attack side drag', 24, 8, 80, 1, 'px'),
  decl('attackDragMs', 'Attack side drag window', 80, 30, 80, 5, 'ms'),
  decl('kickSwipePx', 'Kick swipe distance', 24, 8, 80, 1, 'px'),
  decl('kickSwipeMs', 'Kick swipe window', 80, 30, 80, 5, 'ms'),
  decl('stickRangePx', 'Stick range', 60, 30, 140, 5, 'px'),
  decl('stickDeadZone', 'Stick steer dead zone', 0.08, 0, 0.3, 0.01, ''),
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
