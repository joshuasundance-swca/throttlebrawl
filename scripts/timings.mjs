#!/usr/bin/env node
// Refreshes tests/timings.json, the measured CI seconds per test file that scripts/shard-plan.mjs
// uses to balance CI's sim and browser slices (docs/engineering.md, "CI on GitHub Actions").
//
//   node scripts/timings.mjs <run-id> [<run-id> ...]
//
// It reads the sim and browser job logs of those ci.yml runs through the GitHub CLI (`gh`, already
// signed in), takes each sim file's time from Vitest's per-file line and each browser spec's time as
// the sum of its tests' times from Playwright's list reporter, averages over the runs, and writes the
// table. The numbers only steer which runner gets which file; a stale or missing number can make the
// slices uneven, never drop a test (shard-plan.mjs gives an unmeasured file the median time).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { repoRoot } from './lib.mjs';
import { TIMINGS_FILE } from './shard-plan.mjs';

const VITEST_FILE = /[✓×❯]\s+(?:sim\s+)?(tests\/sim\/\S+\.test\.ts)\s+\(\d+ tests?[^)]*\)\s*(\d+)ms/;
const PLAYWRIGHT_TEST = /\[(e2e|perf)\] › (tests\/(?:e2e|perf)\/\S+?):\d+:\d+ › .* \(([\d.]+)(ms|s|m)\)\s*$/;

function gh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.status !== 0) throw new Error(`gh ${args.join(' ')} failed:\n${res.stderr}`);
  return res.stdout;
}

/**
 * Per-file seconds from one run's sim and browser job logs.
 * @param {string} text
 * @returns {{ sim: Record<string, number>, e2e: Record<string, number>, perf: number }}
 */
export function parseLog(text) {
  /** @type {Record<string, number>} */
  const sim = {};
  /** @type {Record<string, number>} */
  const e2e = {};
  let perf = 0;
  for (const raw of text.split('\n')) {
    // `gh run view --log` can print the escape byte of a colour code as the two characters "^[".
    const line = stripVTControlCharacters(raw)
      .replace(/\^\[\[[0-9;]*m/g, '')
      .trimEnd();
    const v = VITEST_FILE.exec(line);
    if (v) {
      sim[v[1]] = Number(v[2]) / 1000;
      continue;
    }
    const p = PLAYWRIGHT_TEST.exec(line);
    if (p) {
      const n = Number(p[3]);
      const secs = p[4] === 'ms' ? n / 1000 : p[4] === 'm' ? n * 60 : n;
      if (p[1] === 'perf') perf += secs;
      else e2e[p[2]] = (e2e[p[2]] ?? 0) + secs;
    }
  }
  return { sim, e2e, perf };
}

function average(maps) {
  const sums = {};
  const counts = {};
  for (const m of maps)
    for (const [k, v] of Object.entries(m)) {
      sums[k] = (sums[k] ?? 0) + v;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  return Object.fromEntries(
    Object.keys(sums)
      .sort()
      .map((k) => [k, Math.round((sums[k] / counts[k]) * 10) / 10]),
  );
}

function main(runIds) {
  if (runIds.length === 0) {
    console.error('usage: node scripts/timings.mjs <ci run id> [<run id> ...]');
    process.exit(1);
  }
  const per = [];
  for (const id of runIds) {
    const { jobs } = JSON.parse(gh(['run', 'view', id, '--json', 'jobs']));
    const run = { sim: {}, e2e: {}, perf: 0 };
    for (const job of jobs) {
      if (!/^(sim|browser)\b/.test(job.name) || job.conclusion !== 'success') continue;
      const got = parseLog(gh(['run', 'view', '--job', String(job.databaseId), '--log']));
      Object.assign(run.sim, got.sim);
      Object.assign(run.e2e, got.e2e);
      run.perf += got.perf;
    }
    const files = Object.keys(run.sim).length + Object.keys(run.e2e).length;
    console.log(
      `run ${id}: ${Object.keys(run.sim).length} sim files, ${Object.keys(run.e2e).length} browser specs, perf ${run.perf.toFixed(1)} s`,
    );
    if (files > 0) per.push(run);
  }
  if (per.length === 0) throw new Error('no timed files in those runs');
  const perfRuns = per.filter((r) => r.perf > 0);
  const table = {
    about:
      'Measured CI seconds per test file, averaged over the runs below; scripts/shard-plan.mjs balances the sim and browser slices with them. Refresh: node scripts/timings.mjs <run-id>...',
    runs: runIds.map(Number),
    perf: perfRuns.length
      ? Math.round((perfRuns.reduce((n, r) => n + r.perf, 0) / perfRuns.length) * 10) / 10
      : 0,
    sim: average(per.map((r) => r.sim)),
    e2e: average(per.map((r) => r.e2e)),
  };
  writeFileSync(path.join(repoRoot, TIMINGS_FILE), `${JSON.stringify(table, null, 2)}\n`);
  console.log(
    `[examined] ${per.length} runs: ${Object.keys(table.sim).length} sim files, ${Object.keys(table.e2e).length} browser specs, perf ${table.perf} s; wrote ${TIMINGS_FILE}`,
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(repoRoot, 'scripts', 'timings.mjs'))
  main(process.argv.slice(2));
