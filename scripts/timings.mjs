#!/usr/bin/env node
// Refreshes tests/timings.json, the measured CI seconds per test file that scripts/shard-plan.mjs
// uses to balance CI's sim and browser slices (docs/engineering.md, "CI on GitHub Actions").
//
//   node scripts/timings.mjs <run-id> [<run-id> ...]
//
// It reads the unit, sim and browser job logs of those ci.yml runs through the GitHub CLI (`gh`,
// already signed in), takes each unit and sim file's time from Vitest's per-file line and each
// browser spec's time as the sum of its tests' times from Playwright's list reporter, averages over
// the runs, and writes the table. The unit table is not sliced: tests/sequencer.ts reads it to start
// the unit job's slowest files first. The numbers only steer which runner gets which file; a stale or missing number can make the
// slices uneven, never drop a test (shard-plan.mjs plans an unmeasured file as the table's mean
// time, and `npm run check` warns about it).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { repoRoot } from './lib.mjs';
import { TIMINGS_FILE } from './shard-plan.mjs';

const VITEST_FILE = /[✓×❯]\s+(?:sim\s+)?(tests\/sim\/\S+\.test\.ts)\s+\(\d+ tests?[^)]*\)\s*(\d+)ms/;
const VITEST_UNIT_FILE =
  /[✓×❯]\s+(?:unit\s+)?((?:src|scripts|tools)\/\S+\.test\.ts)\s+\(\d+ tests?[^)]*\)\s*(\d+)ms/;
const PLAYWRIGHT_TEST = /\[(e2e|perf)\] › (tests\/(?:e2e|perf)\/\S+?):\d+:\d+ › .* \(([\d.]+)(ms|s|m)\)\s*$/;
// tests/file-times.ts's line: a sim file's whole time on its worker, collect plus tests. Vitest's own
// line leaves out the collection, so a file that races at describe time reads as a few ms there.
const FILE_TIME_LINE = /(?:^|\s)file-time (tests\/sim\/\S+\.test\.ts): ([\d.]+) s\b/;

function gh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.status !== 0) throw new Error(`gh ${args.join(' ')} failed:\n${res.stderr}`);
  return res.stdout;
}

/**
 * Per-file seconds from one run's unit, sim and browser job logs. A sim file's whole-file line
 * (tests/file-times.ts) wins over Vitest's line for it; `simWhole` counts those lines.
 * @param {string} text
 * @returns {{ unit: Record<string, number>, sim: Record<string, number>, e2e: Record<string, number>, perf: number, simWhole: number }}
 */
export function parseLog(text) {
  /** @type {Record<string, number>} */
  const unit = {};
  /** @type {Record<string, number>} */
  const sim = {};
  /** @type {Record<string, number>} */
  const e2e = {};
  /** @type {Record<string, number>} */
  const whole = {};
  let perf = 0;
  for (const raw of text.split('\n')) {
    // `gh run view --log` can print the escape byte of a colour code as the two characters "^[".
    const line = stripVTControlCharacters(raw)
      .replace(/\^\[\[[0-9;]*m/g, '')
      .trimEnd();
    const w = FILE_TIME_LINE.exec(line);
    if (w) {
      whole[w[1]] = Number(w[2]);
      continue;
    }
    const v = VITEST_FILE.exec(line);
    if (v) {
      sim[v[1]] = Number(v[2]) / 1000;
      continue;
    }
    const u = VITEST_UNIT_FILE.exec(line);
    if (u) {
      unit[u[1]] = Number(u[2]) / 1000;
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
  return { unit, sim: { ...sim, ...whole }, e2e, perf, simWhole: Object.keys(whole).length };
}

/**
 * The runs to average the sim table over: those whose logs carry whole-file times
 * (tests/file-times.ts) when any does, so a run from before it (its describe-time files at a few ms)
 * never drags a measured file back toward 0; otherwise every run, by Vitest's lines as before.
 * @template {{ simWhole: number }} R
 * @param {R[]} runs
 * @returns {R[]}
 */
export function simRuns(runs) {
  const whole = runs.filter((r) => r.simWhole > 0);
  return whole.length ? whole : runs;
}

// check.mjs's result line for a runner step: "unit tests (slice 1/2, 211 files)  pass  ... (248.0s)",
// "e2e (slice 7/7, 10 files)  pass ...", "perf   pass ...". The build is not a runner step: it is
// part of the job's setup, like the checkout and the Chromium install.
const RUNNER_STEP =
  /(?:^|\s)(?:unit tests|sim batch|e2e|perf)(?: \([^)]*\))?\s+(?:pass|FAIL)\s.*\(([\d.]+)s\)\s*$/;

/** The seconds a job's log says its runner steps took (tests, and perf in the last browser slice). */
export function runnerSeconds(/** @type {string} */ text) {
  let total = 0;
  for (const raw of text.split('\n')) {
    const m = RUNNER_STEP.exec(stripVTControlCharacters(raw).trimEnd());
    if (m) total += Number(m[1]);
  }
  return total;
}

/**
 * Each tier's mean seconds of a job outside its runner (setup, npm ci, the file listing, and for
 * browser the Chromium install, the build and the uploads), rounded: what scripts/shard-plan.mjs
 * adds to every slice. A job with no runner line says nothing.
 * @param {{ tier: string, seconds: number, ran: number }[]} jobs
 * @returns {Record<string, number>}
 */
export function meanOverheads(jobs) {
  /** @type {Record<string, number[]>} */
  const by = {};
  for (const j of jobs) {
    if (!(j.ran > 0) || !(j.seconds > 0)) continue;
    (by[j.tier === 'browser' ? 'e2e' : j.tier] ??= []).push(j.seconds - j.ran);
  }
  return Object.fromEntries(
    Object.entries(by)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]),
  );
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
  const jobTimes = [];
  for (const id of runIds) {
    const { jobs } = JSON.parse(gh(['run', 'view', id, '--json', 'jobs']));
    const run = { unit: {}, sim: {}, e2e: {}, perf: 0, simWhole: 0 };
    for (const job of jobs) {
      // A red job's other files still timed true; a cancelled or skipped one says nothing. The unit
      // tests ran in `static and unit` until 2026-10-05, then in `unit`. Since the suite moved into
      // suite.yml (2026-10-05), ci.yml's jobs are named `suite / unit (1/2)` and so on.
      const tier = /^(?:suite \/ )?(sim|browser|unit|static and unit)\b/.exec(job.name)?.[1];
      if (!tier) continue;
      if (!['success', 'failure'].includes(job.conclusion)) continue;
      const log = gh(['run', 'view', '--job', String(job.databaseId), '--log']);
      const got = parseLog(log);
      // The whole job's seconds against its runner steps': the setup the slice plan adds per slice.
      const seconds = (Date.parse(job.completedAt) - Date.parse(job.startedAt)) / 1000;
      if (job.conclusion === 'success') jobTimes.push({ tier, seconds, ran: runnerSeconds(log) });
      Object.assign(run.unit, got.unit);
      Object.assign(run.sim, got.sim);
      Object.assign(run.e2e, got.e2e);
      run.perf += got.perf;
      run.simWhole += got.simWhole;
    }
    const files = Object.keys(run.unit).length + Object.keys(run.sim).length + Object.keys(run.e2e).length;
    console.log(
      `run ${id}: ${Object.keys(run.unit).length} unit files, ${Object.keys(run.sim).length} sim files (${run.simWhole} with whole-file times), ${Object.keys(run.e2e).length} browser specs, perf ${run.perf.toFixed(1)} s`,
    );
    if (files > 0) per.push(run);
  }
  if (per.length === 0) throw new Error('no timed files in those runs');
  const perfRuns = per.filter((r) => r.perf > 0);
  const table = {
    about:
      'Measured CI seconds per test file, averaged over the runs below; scripts/shard-plan.mjs balances the sim and browser slices with them, and tests/sequencer.ts starts the slowest unit and sim files first. Refresh: node scripts/timings.mjs <run-id>...',
    runs: runIds.map(Number),
    overhead: meanOverheads(jobTimes),
    perf: perfRuns.length
      ? Math.round((perfRuns.reduce((n, r) => n + r.perf, 0) / perfRuns.length) * 10) / 10
      : 0,
    unit: average(per.map((r) => r.unit)),
    sim: average(simRuns(per).map((r) => r.sim)),
    e2e: average(per.map((r) => r.e2e)),
  };
  writeFileSync(path.join(repoRoot, TIMINGS_FILE), `${JSON.stringify(table, null, 2)}\n`);
  // In the repo's own style, so the format check passes on the refreshed table as written.
  spawnSync('npx', ['--no-install', 'prettier', '--write', TIMINGS_FILE], {
    cwd: repoRoot,
    shell: process.platform === 'win32',
  });
  const simFrom = simRuns(per).length;
  console.log(
    `[examined] ${per.length} runs (sim from ${simFrom}): job setup (s) ${JSON.stringify(table.overhead)} over ${jobTimes.length} jobs; ${Object.keys(table.unit).length} unit files, ${Object.keys(table.sim).length} sim files, ${Object.keys(table.e2e).length} browser specs, perf ${table.perf} s; wrote ${TIMINGS_FILE}`,
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(repoRoot, 'scripts', 'timings.mjs'))
  main(process.argv.slice(2));
