// Duration-balanced slices for CI's unit, sim and browser jobs (docs/engineering.md, "CI on GitHub
// Actions"). `npm run check -- --tier sim --shard i/n` (and `--tier browser`) asks planSlices which
// test files slice i runs. The slices are a partition of the files the test runner itself lists:
// every file lands in exactly one slice, so the slices' test counts add up to the unsharded run's.
// Only the grouping is chosen here, from each file's measured CI seconds in tests/timings.json, so
// that no runner sits idle while another one finishes the tier. [default]
//
// - A file with no measured time (a new test) counts as the tier's mean file, and `npm run check`
//   names it in a warning (unmeasured). The median would be the typical quick file: on 2026-10-03
//   it was 9.5 s for sim, while three of the four new geometry sweeps took 34 to 86 s each on CI.
//   The mean (47 s then) prices in the slow files.
// - Sim files that read the shared seeded batch (simBatch or presetBatch, tests/sim/batch.ts) stay
//   in one slice, the first. Each runner computes the batch once, and every one of those files
//   waits for it; a reader's measured time already includes that wait, and the readers wait side
//   by side on their workers, so they are planned like any other file. (Until 2026-10-03 the
//   readers were one block as long as the longest reader, which left the other readers' time out:
//   main run 37157149149 planned 387 s for sim slice 1/4, which took 537 s.)
// - No other file shares the readers' slice (since 2026-10-05). The readers wait on the Normal batch,
//   which one worker computes in 218 to 375 s depending on the runner, then do their own work, so
//   their measured times cannot price the slice well; other files there only stretch it (run
//   37270067041: 15 other files beside them, 535 s against a plan of 335).
// - The readers of the Easy and Hard batches (presetBatch) start before every other sim file, on CI
//   and in tests/sequencer.ts alike, so those two batches compute beside the Normal one instead of
//   after it. Until 2026-10-05 the three longest readers started first and all waited about 280 s
//   for the Normal batch, and only then did Easy and Hard start (about 120 s each): the reader
//   slice took 517 s on #475's run.
// - A runner runs several files at once (WORKERS): Vitest's default on CI's 4 vCPUs is 3, and
//   Playwright's is 2. A slice's predicted time simulates that: each file goes to the first free
//   worker, in the order the runner starts them (Vitest: longest first, see
//   tests/sequencer.ts; Playwright: by file path).
// - The last browser slice also runs perf after its e2e (ci.yml), so it starts with perf's seconds.
// - A slice is planned as its whole job (since 2026-10-06): the runner's files plus the job's own
//   setup (overhead: checkout, npm ci, listing the files; for browser also the Chromium install
//   and the build). Planned as test seconds alone, browser slices at 355 s took 410 to 533 s as
//   jobs and sim slice 3/6 at 386 s took 590 to 597 s of its 600 (runs 37435436811, 37439710625).
//   Every slice must plan within JOB_SHARE of its job's timeout-minutes in suite.yml
//   (scripts/shard-plan.test.ts checks the checked-in table; `npm run check` warns on CI).
// A stale or missing time can only make the slices uneven, never drop a file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './lib.mjs';

export const TIMINGS_FILE = 'tests/timings.json';

/**
 * Whole-job seconds outside the runner's own run, when tests/timings.json has none of its own
 * (`overhead`, which scripts/timings.mjs measures with the file times): the mean of (job seconds -
 * the runner steps' reported seconds) over the suite jobs of eight green runs of 2026-10-06
 * (37433560803, 37435436811, 37436176046, 37437164463, 37439710625, 37442774709, 37443954405 and
 * 37443974626; 16 unit, 48 sim and 56 browser jobs): unit 11 to 22 s, sim 12 to 25 s, browser 37
 * to 70 s.
 */
const UNIT_OVERHEAD = 16;
const SIM_OVERHEAD = 17;
const E2E_OVERHEAD = 49;

/**
 * Parallel test workers per CI runner, the order each runner starts its files in, and seconds each
 * file costs beyond its measured time (perFile). Vitest's per-file line times the tests only; the
 * unit files' setup and import add about 0.8 s each (run 37266882407: 695 s of tests in a 320-file
 * slice, which Vitest put at 73% of its time). Few, long sim files make it negligible there.
 *
 * overhead: the seconds of a job outside the runner's own run (setup, npm ci, the file listing,
 * and for browser the Chromium install, the build and the uploads), when tests/timings.json has no
 * overhead of its own. [default]
 */
export const TIERS = {
  unit: { workers: 3, order: 'longest-first', perFile: 0.8, overhead: UNIT_OVERHEAD },
  sim: { workers: 3, order: 'longest-first', overhead: SIM_OVERHEAD },
  e2e: { workers: 2, order: 'path', overhead: E2E_OVERHEAD },
};

/**
 * The share of a job's timeout-minutes its planned time may fill. The rest is room for a slow
 * runner: the same files ran at 0.55 to 1.5 times their table time from one runner to the next
 * (docs/engineering.md, "Jobs and timeouts"). [default]
 */
export const JOB_SHARE = 0.7;

export const SUITE_FILE = '.github/workflows/suite.yml';

/**
 * Each sliced job's slice count and timeout in seconds, read from suite.yml's text: the job ids
 * unit, sim and browser (the e2e tier), their `timeout-minutes:` and their matrix's `shard:` list.
 * @param {string} text
 * @returns {{ unit: { slices: number, timeout: number }, sim: { slices: number, timeout: number }, e2e: { slices: number, timeout: number } }}
 */
export function suiteJobs(text) {
  const blocks = new Map(
    [...`\n${text}`.split(/\n {2}(?=[\w-]+:\n)/)].slice(1).map((b) => [b.slice(0, b.indexOf(':')), `${b}\n`]),
  );
  const job = (/** @type {string} */ id) => {
    const b = blocks.get(id) ?? '';
    const minutes = /\n {4}timeout-minutes: (\d+)\n/.exec(b)?.[1];
    const shards = /\n {8}shard: \[([\d, ]+)\]\n/.exec(b)?.[1];
    if (!minutes || !shards) throw new Error(`suiteJobs: no timeout-minutes or shard list for the ${id} job`);
    return { slices: shards.split(',').length, timeout: Number(minutes) * 60 };
  };
  return { unit: job('unit'), sim: job('sim'), e2e: job('browser') };
}

/** suite.yml's sliced jobs, or null when it cannot be read (then nothing is checked against a line). */
export function readSuiteJobs(file = path.join(repoRoot, SUITE_FILE)) {
  try {
    return suiteJobs(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The slices of a plan whose planned job seconds pass JOB_SHARE of the timeout.
 * @param {{ predicted: number }[]} plan
 * @param {number} timeout seconds
 */
export function overLine(plan, timeout) {
  const line = Math.round(timeout * JOB_SHARE);
  return plan.flatMap((s, i) => (s.predicted > line ? [{ slice: i + 1, predicted: s.predicted, line }] : []));
}

/** tests/timings.json, or an empty table when it is missing or unreadable (every file then weighs the same). */
export function readTimings(file = path.join(repoRoot, TIMINGS_FILE)) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** The sim test files that read the shared seeded batch, found by their source. */
export function batchUsers(files, read = (f) => readFileSync(path.join(repoRoot, f), 'utf8')) {
  return files.filter((f) => /\b(?:simBatch|presetBatch)\s*\(/.test(read(f)));
}

/** The sim test files that read the Easy or Hard batch (presetBatch), found by their source: they start first. */
export function presetUsers(files, read = (f) => readFileSync(path.join(repoRoot, f), 'utf8')) {
  return files.filter((f) => /\bpresetBatch\s*\(/.test(read(f)));
}

/**
 * The browser specs whose tests run in parallel across the runner's workers (`mode: 'parallel'`),
 * found by their source. Playwright otherwise runs a spec's tests one after another on one worker.
 */
export function spreadUsers(files, read = (f) => readFileSync(path.join(repoRoot, f), 'utf8')) {
  return files.filter((f) => /\bmode:\s*['"]parallel['"]/.test(read(f)));
}

/** What a file with no measured time is planned as: the mean of the measured ones; 1 for none. */
export function estimateSeconds(values) {
  if (values.length === 0) return 1;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const isSeconds = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * The files of a tier that the timing table has no time for, and the seconds each is planned as.
 * @param {'unit' | 'sim' | 'e2e'} tier
 * @param {string[]} files
 * @param {{ timings?: { unit?: Record<string, number>, sim?: Record<string, number>, e2e?: Record<string, number> } }} [options]
 * @returns {{ files: string[], seconds: number }}
 */
export function unmeasured(tier, files, { timings = readTimings() } = {}) {
  const table = timings[tier] ?? {};
  return {
    files: [...new Set(files)].filter((f) => !isSeconds(table[f])).sort(),
    seconds: estimateSeconds(Object.values(table).filter(isSeconds)),
  };
}

/** When the last of `items` ends if `workers` workers each take the next one as they free up. */
function makespan(items, workers) {
  const free = Array.from({ length: workers }, () => 0);
  for (const it of items) {
    let w = 0;
    for (let i = 1; i < workers; i++) if (free[i] < free[w]) w = i;
    free[w] += it.cost;
  }
  return Math.max(...free);
}

/**
 * Splits `files` into `n` slices, each a list of files, so that the slowest slice is as quick as
 * the greedy plan can make it. Deterministic: the same inputs give the same slices on every runner.
 *
 * @param {object} o
 * @param {string[]} o.files every test file of the tier, as the runner lists them
 * @param {Record<string, number>} [o.seconds] measured seconds per file
 * @param {number} o.n how many slices
 * @param {number} o.workers parallel workers per runner
 * @param {'longest-first' | 'path'} [o.order] the order a runner starts its files in
 * @param {string[]} [o.together] files that must share one slice, run first (the batch readers)
 * @param {string[]} [o.first] files the runner starts before all others (the preset batch readers)
 * @param {number} [o.lastExtra] seconds the last slice spends after its files (perf)
 * @param {number} [o.perFile] seconds each file costs beyond its measured time (setup and import)
 * @param {number} [o.overhead] seconds every slice's job spends outside its runner (setup, build)
 * @param {string[]} [o.spread] files whose tests spread over all the runner's workers (parallel mode)
 * @returns {{ files: string[], predicted: number }[]} predicted: the slice's job seconds
 */
export function planSlices({
  files,
  seconds = {},
  n,
  workers,
  order = 'path',
  together = [],
  first = [],
  lastExtra = 0,
  perFile = 0,
  overhead = 0,
  spread = [],
}) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`planSlices: n must be a whole number >= 1, got ${n}`);
  const all = [...new Set(files)].sort();
  // The table's own times, not only this tier's files: the same estimate as unmeasured() reports
  // and tests/sequencer.ts orders by.
  const fallback = estimateSeconds(Object.values(seconds).filter(isSeconds));
  const cost = (f) => (isSeconds(seconds[f]) ? seconds[f] : fallback) + perFile;

  const item = (f) => ({
    files: [f],
    cost: cost(f),
    pinned: together.includes(f),
    spread: spread.includes(f),
  });
  const items = all.filter((f) => !together.includes(f)).map(item);
  items.sort((a, b) => b.cost - a.cost || a.files[0].localeCompare(b.files[0]));

  const slices = Array.from({ length: n }, (_, i) => ({
    // The batch readers share the first slice (they wait on one batch per runner).
    items: i === 0 ? all.filter((f) => together.includes(f)).map(item) : [],
    tail: i === n - 1 ? lastExtra : 0,
  }));
  const early = (it) => (first.includes(it.files[0]) ? 0 : 1);
  const runOrder = (list) =>
    order === 'longest-first'
      ? [...list].sort(
          (a, b) => early(a) - early(b) || b.cost - a.cost || a.files[0].localeCompare(b.files[0]),
        )
      : [...list].sort((a, b) => a.files[0].localeCompare(b.files[0]));
  // A parallel-mode spec's tests go to whichever worker is free: planned as one equal part per worker.
  const parts = (list) =>
    list.flatMap((it) =>
      it.spread ? Array.from({ length: workers }, () => ({ cost: it.cost / workers })) : [it],
    );
  const predict = (s, extra) =>
    makespan(parts(runOrder(extra ? [...s.items, extra] : s.items)), workers) + s.tail;

  // The batch readers' slice holds the readers alone (when there is another slice): they wait on a
  // batch one worker computes, whose time varies by runner, and other files there only stretch it.
  const start = together.length > 0 && n > 1 ? 1 : 0;
  for (const item of items) {
    let best = start;
    let bestTime = predict(slices[start], item);
    for (let i = start + 1; i < n; i++) {
      const t = predict(slices[i], item);
      if (t < bestTime) {
        best = i;
        bestTime = t;
      }
    }
    slices[best].items.push(item);
  }
  // A slice with no files would fail its runner ("no tests found"); perf's head start can leave the
  // last one empty when there are many slices. Hand it the quickest file of the fullest slice.
  const movableOf = (s) => s.items.filter((it) => !it.pinned);
  for (const s of slices) {
    if (s.items.length > 0) continue;
    const donor = slices.reduce((a, b) => (movableOf(b).length > movableOf(a).length ? b : a));
    const movable = movableOf(donor);
    if (movable.length < 2) continue;
    const quickest = movable.reduce((a, b) => (b.cost < a.cost ? b : a));
    donor.items.splice(donor.items.indexOf(quickest), 1);
    s.items.push(quickest);
  }
  return slices.map((s) => ({
    files: s.items.flatMap((it) => it.files).sort(),
    predicted: Math.round(predict(s) + overhead),
  }));
}

/**
 * The sim table without its files timed at 0 s, so the plan prices them as the mean file. Vitest's
 * per-file time leaves out a file's collection, and some sim files race at describe time
 * (app-cast-and-law, riders-race and six more on 2026-10-06), so the table times them at 0 s. Priced
 * at 0 s they tied every slice and all went to one: sim slice 3/6 took 590 to 597 s of 600 on main
 * runs of 2026-10-06, and slice 3/7 took 488 s on #601's first run against a plan of 340, every other sim
 * slice 200 to 399 s; its longest file also ran 1.36 times its table time there, so their own share
 * is an estimate, about 30 to 56 s a file. The mean prices them at about that, or a little over.
 * @param {Record<string, number>} table
 */
export function collectedOnly(table) {
  return Object.fromEntries(Object.entries(table).filter(([, v]) => !(isSeconds(v) && v < 0.05)));
}

/**
 * The plan for one tier, from the timing table and (for sim) the batch readers.
 * @param {'unit' | 'sim' | 'e2e'} tier
 * @param {string[]} files
 * @param {number} n
 * @param {{ timings?: { unit?: Record<string, number>, sim?: Record<string, number>, e2e?: Record<string, number>, perf?: number, overhead?: Record<string, number> }, read?: (file: string) => string }} [options]
 */
export function planTier(tier, files, n, { timings = readTimings(), read } = {}) {
  const spec = TIERS[tier];
  if (!spec) throw new Error(`planTier: no slice plan for tier ${tier} (${Object.keys(TIERS).join(', ')})`);
  return planSlices({
    files,
    seconds: tier === 'sim' ? collectedOnly(timings.sim ?? {}) : (timings[tier] ?? {}),
    n,
    workers: spec.workers,
    order: spec.order,
    together: tier === 'sim' ? batchUsers(files, read) : [],
    first: tier === 'sim' ? presetUsers(files, read) : [],
    spread: tier === 'e2e' ? spreadUsers(files, read) : [],
    lastExtra: tier === 'e2e' ? (timings.perf ?? 0) : 0,
    perFile: 'perFile' in spec ? spec.perFile : 0,
    // The table's own setup seconds (scripts/timings.mjs measures them with the file times), else TIERS'.
    overhead: isSeconds(timings.overhead?.[tier]) ? timings.overhead[tier] : spec.overhead,
  });
}
