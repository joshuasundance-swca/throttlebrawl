// Checked only by tsconfig.sim.json, the DOM-free config for src/sim, src/road and src/core.
// Each line below must be a type error there. If a DOM lib or Node types ever leak into that
// config, the @ts-expect-error directives become unused and `npm run typecheck` fails.

// @ts-expect-error -- `document` must not exist in the sim/road config.
export const noDocument: unknown = document;

// @ts-expect-error -- `window` must not exist in the sim/road config.
export const noWindow: unknown = window;

// @ts-expect-error -- Node's `process` must not exist in the sim/road config.
export const noProcess: unknown = process;
