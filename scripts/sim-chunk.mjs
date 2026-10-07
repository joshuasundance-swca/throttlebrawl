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
 * The road's structure planners and the land rule they read (the physical world, 2026-10-06:
 * src/road/structures/*, src/road/land.ts): lazy, never in the first load, so they build into their own
 * chunk, which src/road/structures.ts imports dynamically. Their code is part of the sim's, so the code
 * hash covers that chunk too (`simCodeHashOfChunks`): a planner change changes the replay key.
 */
export const ROAD_LAZY_TEST = /[\\/]src[\\/]road[\\/](?:structures[\\/]|land\.ts$)/;
export const ROAD_LAZY_CHUNK_NAME = 'road-structures';

/** Modules that belong in the sim chunk: the sim, the road model (all but its lazy planners) and core. */
export const SIM_CHUNK_TEST = /[\\/]src[\\/](?:sim|core|road(?![\\/](?:structures[\\/]|land\.ts$)))[\\/]/;

/** The code hash of a chunk: the first 12 hex digits of the SHA-256 of its code. */
export function simCodeHashOf(code) {
  return createHash('sha256').update(code).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * The sim's code hash from a build's chunks: the sim chunk's code, then each road planner chunk's in file
 * name order (with none, exactly `simCodeHashOf(sim.code)`, as before the planners had a chunk).
 */
export function simCodeHashOfChunks(sim, chunks) {
  const lazy = chunks
    .filter((c) => c.name === ROAD_LAZY_CHUNK_NAME)
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
  return simCodeHashOf([sim, ...lazy].map((c) => c.code).join('\n'));
}

/** The Rolldown code-splitting group that makes the sim chunk. */
export function simChunkGroup() {
  return { name: SIM_CHUNK_NAME, test: SIM_CHUNK_TEST };
}

/** The Rolldown code-splitting group that makes the road's lazy planners' chunk. */
export function roadLazyChunkGroup() {
  return { name: ROAD_LAZY_CHUNK_NAME, test: ROAD_LAZY_TEST };
}

/** Hashes the sim chunk and writes the hash over the placeholder in the other chunks. */
export function simCodeHashPlugin() {
  return {
    name: 'throttlebrawl:sim-code-hash',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
      const sims = chunks.filter((c) => c.name === SIM_CHUNK_NAME);
      if (sims.length !== 1) {
        this.error(`expected one "${SIM_CHUNK_NAME}" chunk, found ${sims.length}`);
        return;
      }
      const sim = sims[0];
      const own = [sim, ...chunks.filter((c) => c.name === ROAD_LAZY_CHUNK_NAME)];
      if (own.some((c) => c.code.includes(SIM_CODE_HASH_PLACEHOLDER)))
        this.error(
          'the sim and road planner chunks must not read __SIM_CODE_HASH__ (its hash would depend on itself)',
        );
      const hash = simCodeHashOfChunks(sim, chunks);
      for (const c of chunks) {
        if (c !== sim && c.code.includes(SIM_CODE_HASH_PLACEHOLDER))
          c.code = c.code.split(SIM_CODE_HASH_PLACEHOLDER).join(hash);
      }
    },
  };
}
