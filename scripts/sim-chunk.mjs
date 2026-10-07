// The sim chunk and its code hash (docs/architecture.md, "Replay and input recording"; M2 app-3
// item 4). vite.config.ts puts src/sim, src/road and src/core into one chunk named `sim`; after
// bundling, this plugin hashes that chunk's code and writes the result over the
// __SIM_CODE_HASH__ placeholder in every other chunk. The app uses it as the code part of the
// replay key (`simCodeHash + simContentHash`), so a deploy that leaves the sim's code alone (a UI,
// audio or render change) keeps the key and a saved race still resumes. In dev and in tests there
// is no bundle, the placeholder stays, and the app falls back to the build id.
import { createHash } from 'node:crypto';

export const SIM_CHUNK_NAME = 'sim';
/** Twelve characters, the same length as a hash, so the rewrite keeps every offset. */
export const SIM_CODE_HASH_PLACEHOLDER = 'SIMCODE_NONE';
const HASH_LENGTH = SIM_CODE_HASH_PLACEHOLDER.length;

/**
 * The road's structure planners (the physical world, 2026-10-06: src/road/structures/*): lazy, never in the
 * first load, so they build into their own chunk, which src/road/structures.ts imports dynamically. Their code
 * is part of the sim's, so the code hash covers that chunk too (`simCodeHashOfChunks`): a planner change
 * changes the replay key. The land rule they read (src/road/drawn-ground.ts) is the sim's too since
 * 2026-10-07 (what a rider out past an edge meets), so it builds into the sim chunk.
 */
export const ROAD_LAZY_TEST = /[\\/]src[\\/]road[\\/]structures[\\/]/;
export const ROAD_LAZY_CHUNK_NAME = 'road-structures';

/**
 * The systems' steps (lane U3, 2026-10-07: the first-load headroom; src/sim/late.ts): each system's step and
 * the rules only a step reaches (`src/sim/<system>/step.ts`, gathered by src/sim/steps.ts; the law's props, the
 * shortcut stamps, the crash rig and its contacts, the run back). The menu's grid is made and snapshotted without
 * them, so they build into their own
 * chunk, which src/sim/late.ts imports dynamically, and the code hash covers it as it covers the planners'. The
 * sim chunk's group leaves them out (`simChunkGroup`) and theirs comes after it: a group takes its modules'
 * dependencies too, so the steps' group first would take the whole sim.
 */
export const SIM_STEPS_TEST =
  /[\\/]src[\\/]sim[\\/](?:steps|[\w-]+[\\/]step|modifiers[\\/]law-props|race[\\/]shortcuts|tumble[\\/](?:rig|contacts|runback))\.ts$/;
export const SIM_STEPS_CHUNK_NAME = 'sim-steps';
// Manual splitting keeps Rolldown's namespace helper in a separate generated chunk. Its code
// must be part of the rules hash too, even though it has no application modules.
export const RUNTIME_CHUNK_NAME = 'rolldown-runtime';
const HASHED_RULES_CHUNKS = new Set([ROAD_LAZY_CHUNK_NAME, SIM_STEPS_CHUNK_NAME, RUNTIME_CHUNK_NAME]);

/** Modules that belong in the sim chunk: the sim, the road model (all but its lazy planners) and core. */
export const SIM_CHUNK_TEST = /[\\/]src[\\/](?:sim|core|road(?![\\/]structures[\\/]))[\\/]/;

/** The code hash of a chunk: the first 12 hex digits of the SHA-256 of its code. */
export function simCodeHashOf(code) {
  return createHash('sha256').update(code).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * The sim's code hash from a build's chunks: the sim chunk's code, then each road planner chunk's and step
 * chunk's and generated runtime helper's in file name order (with none, exactly
 * `simCodeHashOf(sim.code)`, as before the planners had a chunk).
 */
export function simCodeHashOfChunks(sim, chunks) {
  const rules = chunks
    .filter((c) => HASHED_RULES_CHUNKS.has(c.name))
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
  return simCodeHashOf([sim, ...rules].map((c) => c.code).join('\n'));
}

/** The Rolldown code-splitting group that makes the sim chunk. */
export function simChunkGroup() {
  return { name: SIM_CHUNK_NAME, test: (id) => SIM_CHUNK_TEST.test(id) && !SIM_STEPS_TEST.test(id) };
}

/** The Rolldown code-splitting group that makes the road's lazy planners' chunk. */
export function roadLazyChunkGroup() {
  return { name: ROAD_LAZY_CHUNK_NAME, test: ROAD_LAZY_TEST };
}

/** The Rolldown code-splitting group that makes the systems' steps' chunk; it comes after the sim chunk's. */
export function simStepsChunkGroup() {
  return { name: SIM_STEPS_CHUNK_NAME, test: SIM_STEPS_TEST };
}

/**
 * Hashes the sim chunk and writes the hash over the placeholder in the other chunks. It runs after the other
 * plugins' `generateBundle` (`order: 'post'`): the sim chunk holds dynamic `import()`s of the planners' chunk
 * (src/road/structures.ts, the layout doors in src/road/index.ts), and Vite fills in each one's preload list in
 * its own `generateBundle`, so the hash must be of the code as shipped.
 */
export function simCodeHashPlugin() {
  return {
    name: 'throttlebrawl:sim-code-hash',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
        const sims = chunks.filter((c) => c.name === SIM_CHUNK_NAME);
        if (sims.length !== 1) {
          this.error(`expected one "${SIM_CHUNK_NAME}" chunk, found ${sims.length}`);
          return;
        }
        const sim = sims[0];
        const own = [sim, ...chunks.filter((c) => HASHED_RULES_CHUNKS.has(c.name))];
        if (own.some((c) => c.code.includes(SIM_CODE_HASH_PLACEHOLDER)))
          this.error(
            'the sim, road planner, step and generated runtime chunks must not read __SIM_CODE_HASH__ (its hash would depend on itself)',
          );
        const hash = simCodeHashOfChunks(sim, chunks);
        for (const c of chunks) {
          if (c !== sim && c.code.includes(SIM_CODE_HASH_PLACEHOLDER))
            c.code = c.code.split(SIM_CODE_HASH_PLACEHOLDER).join(hash);
        }
      },
    },
  };
}
