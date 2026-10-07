// The loading boundary for simulation steps. The current implementation is eager: importing the
// public sim contract already brings in every system's step. The first-load reduction uses this
// same asynchronous boundary when those steps move into a lazy chunk.
export function loadSimSteps(): Promise<void> {
  return Promise.resolve();
}
