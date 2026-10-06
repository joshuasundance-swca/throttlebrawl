// The sim chunk and its code hash (docs/architecture.md, "Replay and input recording"; M2 app-3
// item 4). vite.config.ts puts src/sim, src/road and src/core into one chunk named `sim` (but for the
// structures' planners, src/road/structures/: a lazy chunk named `structures`, hashed with it, the physical
// world's lazy loading); after bundling, this plugin hashes that code and writes the result over the
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
 * Modules that belong in the sim chunk: the sim, the road model and core. Not the structures' planners
 * (src/road/structures/, `STRUCTURES_CHUNK_TEST`): they load with a region's road data as a lazy chunk, never in
 * the first load (docs/architecture.md, "Physical world"). The contract file src/road/structures.ts stays in the
 * sim chunk.
 */
export const SIM_CHUNK_TEST = /[\\/]src[\\/](sim|core)[\\/]|[\\/]src[\\/]road[\\/](?!structures[\\/])/;

/**
 * The structures' planners (the districts' placement, src/road/structures/*.ts), one lazy chunk of their own. The
 * sim chunk loads it by `import()` (road/structures.ts `STRUCTURE_LAYERS`), so its file name, which carries a hash
 * of its code, is in the sim chunk's code: a change to a planner moves `simCodeHash` (and so the replay key), and
 * a change to render, which is not in this chunk, does not.
 */
export const STRUCTURES_CHUNK_NAME = 'structures';
export const STRUCTURES_CHUNK_TEST = /[\\/]src[\\/]road[\\/]structures[\\/]/;

/** The code hash of a chunk: the first 12 hex digits of the SHA-256 of its code. */
export function simCodeHashOf(code) {
  return createHash('sha256').update(code).digest('hex').slice(0, HASH_LENGTH);
}

/** The Rolldown code-splitting group that makes the sim chunk. */
export function simChunkGroup() {
  return { name: SIM_CHUNK_NAME, test: SIM_CHUNK_TEST };
}

/** The Rolldown code-splitting group that makes the planners' chunk. */
export function structuresChunkGroup() {
  return { name: STRUCTURES_CHUNK_NAME, test: STRUCTURES_CHUNK_TEST };
}

/**
 * The replay key's code part for a build: the code of the sim chunk, and, when the build has it, of the
 * structures' chunk (their planners lay out the world the sim meets, so a change to one must move the key; the
 * chunk is lazy, so it is not in the sim chunk). A build with no such chunk hashes the sim chunk alone, as before.
 * @param {{ name?: string; code: string; fileName: string }[]} chunks
 */
export function simCodeHashOfChunks(chunks) {
  const sim = chunks.find((c) => c.name === SIM_CHUNK_NAME);
  if (!sim) throw new Error(`no ${SIM_CHUNK_NAME} chunk`);
  const planners = chunks
    .filter((c) => c.name === STRUCTURES_CHUNK_NAME)
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
  return simCodeHashOf(
    planners.length === 0 ? sim.code : [sim.code, ...planners.map((c) => c.code)].join('\n'),
  );
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
      if (sim.code.includes(SIM_CODE_HASH_PLACEHOLDER))
        this.error('the sim chunk must not read __SIM_CODE_HASH__ (its hash would depend on itself)');
      const hash = simCodeHashOfChunks(chunks);
      for (const c of chunks) {
        if (c !== sim && c.code.includes(SIM_CODE_HASH_PLACEHOLDER))
          c.code = c.code.split(SIM_CODE_HASH_PLACEHOLDER).join(hash);
      }
    },
  };
}
