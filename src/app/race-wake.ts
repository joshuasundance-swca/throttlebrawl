import type { AppState } from './states';

/** Synchronize the race's wake-lock intent at lifecycle boundaries, never from the frame loop. */
export function createRaceWakeSync(keepAwake: (on: boolean) => void) {
  let wanted = false;
  return (state: AppState, paused: boolean, held: boolean): void => {
    const next = state === 'race' && !paused && !held;
    if (next === wanted) return;
    wanted = next;
    keepAwake(next);
  };
}
