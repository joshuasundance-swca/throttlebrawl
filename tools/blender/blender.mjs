// Finds headless Blender for the asset scripts. Blender is a local tool: CI has none, so every
// entry point skips cleanly (exit 0, with a note) when it is absent, and the committed GLBs gate
// on their own (docs/engineering.md, "Repo layout": npm scripts read BLENDER_EXE).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** The Blender executable from BLENDER_EXE (or BLENDER), or null when it is not set or missing. */
export function findBlender(env = process.env) {
  const exe = env.BLENDER_EXE || env.BLENDER || '';
  return exe && existsSync(exe) ? exe : null;
}

export const SKIP_NOTE =
  'skipped: no Blender. Set BLENDER_EXE to the blender executable (Blender 5.2 LTS) to build or render. ' +
  'The committed GLBs are still checked by `npm test` (tools/blender/models.test.ts).';

/** Runs a Python script inside headless Blender with args after `--`. Returns {code, out, secs}. */
export function runBlender(blender, script, args, { timeoutMs = 300_000 } = {}) {
  const t0 = process.hrtime.bigint();
  const res = spawnSync(
    blender,
    ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', ...args],
    { encoding: 'utf8', maxBuffer: 1 << 26, timeout: timeoutMs },
  );
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  return {
    code: res.status ?? -1,
    out: `${res.stdout ?? ''}\n--- stderr ---\n${res.stderr ?? ''}${res.error ? `\n${res.error.message}` : ''}`,
    secs: Math.round(secs * 100) / 100,
  };
}
