// A long-press recogniser with no DOM (the DOM side feeds it pointer events), so its rules are
// unit-tested: one pointer at a time, held for `ms` without drifting more than `slopPx`. It never
// cancels or consumes the pointer, so a press it ignores still reaches whoever else listens.
import { VETO_LONG_PRESS_MS } from './veto';

/** How far a finger may drift and still count as holding still, in CSS pixels. [default] */
export const LONG_PRESS_SLOP_PX = 12;

export type Schedule = (fn: () => void, ms: number) => () => void;

export interface LongPressOptions<T> {
  ms?: number;
  slopPx?: number;
  /** Timer: setTimeout in the browser, a fake clock in tests. */
  schedule?: Schedule;
  /** Called when a press is held long enough, with what `down` was given. */
  onLongPress(payload: T): void;
}

export interface LongPress<T> {
  /** A pointer went down on the target; `payload` is what the press is about. */
  down(pointerId: number, x: number, y: number, payload: T): void;
  move(pointerId: number, x: number, y: number): void;
  /** Pointer up or cancel. */
  up(pointerId: number): void;
  readonly pressing: boolean;
}

const defaultSchedule: Schedule = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export function createLongPress<T>(opts: LongPressOptions<T>): LongPress<T> {
  const ms = opts.ms ?? VETO_LONG_PRESS_MS;
  const slop = opts.slopPx ?? LONG_PRESS_SLOP_PX;
  const schedule = opts.schedule ?? defaultSchedule;
  let active: { id: number; x: number; y: number; cancel: () => void } | null = null;
  const stop = () => {
    active?.cancel();
    active = null;
  };
  return {
    down(pointerId, x, y, payload) {
      if (active) return;
      const cancel = schedule(() => {
        active = null;
        opts.onLongPress(payload);
      }, ms);
      active = { id: pointerId, x, y, cancel };
    },
    move(pointerId, x, y) {
      if (active?.id === pointerId && Math.hypot(x - active.x, y - active.y) > slop) stop();
    },
    up(pointerId) {
      if (active?.id === pointerId) stop();
    },
    get pressing() {
      return active !== null;
    },
  };
}
