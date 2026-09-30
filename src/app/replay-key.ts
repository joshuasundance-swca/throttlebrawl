// The replay key (docs/architecture.md, "Replay and input recording"): `simCodeHash +
// simContentHash`. The code part is the content hash of the sim chunk (src/sim, src/road and
// src/core), injected by the build as __SIM_CODE_HASH__ (scripts/sim-chunk.mjs), so a deploy that
// changes only UI, audio or render code keeps the key and a saved race still resumes (M2 app-3).
// Where no bundle made one (dev, tests) the build id stands in, as in M1.
import { makeReplayKey } from '../replay';

/** A real code hash: 12 lowercase hex digits (the build's placeholder is not one). */
const CODE_HASH = /^[0-9a-f]{12}$/;

export function appReplayKey(build: { id: string; simCodeHash?: string }, simContentHash: string): string {
  const code = build.simCodeHash && CODE_HASH.test(build.simCodeHash) ? build.simCodeHash : build.id;
  return makeReplayKey(code, simContentHash);
}
