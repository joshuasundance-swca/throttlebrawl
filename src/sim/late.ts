// The sim's step, loaded late (lane U3, 2026-10-07: the first-load headroom; docs/architecture.md, "Lazy
// loading"). Each system keeps its state, its init, its tuning and what a snapshot reads in its own folder, in
// the first load: the menu's grid is a sim made and snapshotted, never stepped. Its step, and the rules only the
// step reaches, sit in `<system>/step.ts`, which `./steps.ts` gathers into one lazy chunk
// (scripts/sim-chunk.mjs SIM_STEPS_TEST, hashed with the sim chunk into the replay key). The app loads it with
// the structures' planners, in the background at boot, and a race waits for it as it waits for them; the tests
// and the node tools load it at their start. A sim stepped before it has loaded throws: a race never rides
// with a rule missing.
type Steps = typeof import('./steps');

let steps: Steps | null = null;
let loading: Promise<void> | null = null;

/** Loads the step chunk (once; a failed load is tried again by the next call). */
export function loadSimSteps(): Promise<void> {
  loading ??= import('./steps').then(
    (m) => {
      steps = m;
    },
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

/** The systems' steps; throws while the chunk has not loaded (`loadSimSteps`). */
export function lateSteps(): Steps {
  if (!steps) throw new Error('sim: the step has not loaded (loadSimSteps first)');
  return steps;
}
