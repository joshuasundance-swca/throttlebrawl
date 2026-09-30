// dev's batch hook (dev-4): per-tick numbers for the M2 bot assertions that the RaceResult does not
// keep. Slow motion is a state (`snapshot.slowmo`), not only an event, so the ticks spent in it are
// counted here; the takedown and slow-motion assertions in tests/sim/dev-batch.test.ts read them
// and print ACTIVE once combat-4's takedowns and slow motion reach the batch.
import type { BatchHook } from './index';

export interface DevHookResult {
  /** Ticks with the sim's slow motion active. */
  slowmoTicks: number;
  /** Ticks where the world ran below full speed (timeScale < 1: hit-stop or slow motion). */
  slowTicks: number;
  /** The lowest timeScale seen. */
  minTimeScale: number;
}

export const devHook: BatchHook = {
  id: 'dev',
  create() {
    const r: DevHookResult = { slowmoTicks: 0, slowTicks: 0, minTimeScale: 1 };
    return {
      onTick(snap) {
        if (snap.slowmo?.active) r.slowmoTicks++;
        if (snap.timeScale < 1) r.slowTicks++;
        if (snap.timeScale < r.minTimeScale) r.minTimeScale = snap.timeScale;
      },
      result: () => ({ ...r }),
    };
  },
};
