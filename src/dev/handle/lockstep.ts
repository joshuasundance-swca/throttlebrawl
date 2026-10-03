// The test handle's fast-forward (inventory R4, 2026-10-03): whole-race browser specs ride the
// loop's lockstep (app/loop.ts) at many ticks a frame until a condition on the race holds, then
// hand back to a slow lockstep for what they came to check. Without it a race runs at the speed
// the runner draws (a software-rendered CI runner: 7 to 19 frames a second, 4 ticks each at most),
// and every wall-clock deadline on a whole race walked into its limit as content grew.
import type { SimSnapshot } from '../../sim/api';

/** Fast-forward's ticks a frame: 4 s of race per drawn frame. */
export const FAST_FORWARD_TICKS = 240;
/** The lockstep a fast-forward hands back to: the loop's real-time cap, frame for frame. */
export const SETTLE_TICKS = 4;

export interface FastForwardOptions {
  /** Ticks a frame while fast-forwarding (default FAST_FORWARD_TICKS). */
  perFrame?: number;
  /** The lockstep to hand back to once the condition holds (default SETTLE_TICKS; null: real time). */
  then?: number | null;
}

export interface FastForward {
  /** Starts (or restarts) a fast-forward that stops on the first step after which `until` holds. */
  start(until: (snap: SimSnapshot) => boolean, opts?: FastForwardOptions): void;
  /** Drops the fast-forward without touching the loop (the caller sets its own lockstep). */
  cancel(): void;
  /** Called after every sim step with the new snapshot. */
  step(snap: SimSnapshot): void;
  readonly active: boolean;
}

/**
 * The fast-forward over the loop's lockstep. The loop reads its count before every step, so the
 * hand-back inside `step` ends the frame's run at once: the race overshoots the condition by fewer
 * than `then` ticks. A condition that throws stops the fast-forward and is reported as an error
 * (the browser specs fail on console errors), so the loop never keeps racing on a broken check.
 */
export function createFastForward(setLockstep: (steps: number | null) => void): FastForward {
  let run: { until: (snap: SimSnapshot) => boolean; then: number | null } | null = null;
  return {
    start(until, opts = {}) {
      run = { until, then: opts.then === undefined ? SETTLE_TICKS : opts.then };
      setLockstep(opts.perFrame ?? FAST_FORWARD_TICKS);
    },
    cancel() {
      run = null;
    },
    step(snap) {
      if (!run) return;
      let done = true;
      try {
        done = run.until(snap);
      } catch (err) {
        console.error('fast-forward: the condition threw, so it stopped here', err);
      }
      if (!done) return;
      const then = run.then;
      run = null;
      setLockstep(then);
    },
    get active() {
      return run !== null;
    },
  };
}
