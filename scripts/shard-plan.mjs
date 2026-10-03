// Duration-balanced slices for CI's sim and browser jobs (docs/engineering.md, "CI on GitHub
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
// - A runner runs several files at once (WORKERS): Vitest's default on CI's 4 vCPUs is 3, and
//   Playwright's is 2. A slice's predicted time simulates that: each file goes to the first free
//   worker, in the order the runner starts them (Vitest: longest first, see
//   tests/sequencer.ts; Playwright: by file path).
// - The last browser slice also runs perf after its e2e (ci.yml), so it starts with perf's seconds.
// A stale or missing time can only make the slices uneven, never drop a file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './lib.mjs';

export const TIMINGS_FILE = 'tests/timings.json';

/** Parallel test workers per CI runner, and the order each runner starts its files in. */
export const TIERS = {
  sim: { workers: 3, order: 'longest-first' },
  e2e: { workers: 2, order: 'path' },
};

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

/** What a file with no measured time is planned as: the mean of the measured ones; 1 for none. */
export function estimateSeconds(values) {
  if (values.length === 0) return 1;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const isSeconds = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * The files of a tier that the timing table has no time for, and the seconds each is planned as.
 * @param {'sim' | 'e2e'} tier
 * @param {string[]} files
 * @param {{ timings?: { sim?: Record<string, number>, e2e?: Record<string, number> } }} [options]
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
 * @param {number} [o.lastExtra] seconds the last slice spends after its files (perf)
 * @returns {{ files: string[], predicted: number }[]}
 */
export function planSlices({
  files,
  seconds = {},
  n,
  workers,
  order = 'path',
  together = [],
  lastExtra = 0,
}) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`planSlices: n must be a whole number >= 1, got ${n}`);
  const all = [...new Set(files)].sort();
  // The table's own times, not only this tier's files: the same estimate as unmeasured() reports
  // and tests/sequencer.ts orders by.
  const fallback = estimateSeconds(Object.values(seconds).filter(isSeconds));
  const cost = (f) => (isSeconds(seconds[f]) ? seconds[f] : fallback);

  const item = (f) => ({ files: [f], cost: cost(f), pinned: together.includes(f) });
  const items = all.filter((f) => !together.includes(f)).map(item);
  items.sort((a, b) => b.cost - a.cost || a.files[0].localeCompare(b.files[0]));

  const slices = Array.from({ length: n }, (_, i) => ({
    // The batch readers share the first slice (they wait on one batch per runner).
    items: i === 0 ? all.filter((f) => together.includes(f)).map(item) : [],
    tail: i === n - 1 ? lastExtra : 0,
  }));
  const runOrder = (list) =>
    order === 'longest-first'
      ? [...list].sort((a, b) => b.cost - a.cost || a.files[0].localeCompare(b.files[0]))
      : [...list].sort((a, b) => a.files[0].localeCompare(b.files[0]));
  const predict = (s, extra) => makespan(runOrder(extra ? [...s.items, extra] : s.items), workers) + s.tail;

  for (const item of items) {
    let best = 0;
    let bestTime = predict(slices[0], item);
    for (let i = 1; i < n; i++) {
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
    predicted: Math.round(predict(s)),
  }));
}

/**
 * The plan for one tier, from the timing table and (for sim) the batch readers.
 * @param {'sim' | 'e2e'} tier
 * @param {string[]} files
 * @param {number} n
 * @param {{ timings?: { sim?: Record<string, number>, e2e?: Record<string, number>, perf?: number }, read?: (file: string) => string }} [options]
 */
export function planTier(tier, files, n, { timings = readTimings(), read } = {}) {
  const spec = TIERS[tier];
  if (!spec) throw new Error(`planTier: no slice plan for tier ${tier} (${Object.keys(TIERS).join(', ')})`);
  return planSlices({
    files,
    seconds: timings[tier] ?? {},
    n,
    workers: spec.workers,
    order: spec.order,
    together: tier === 'sim' ? batchUsers(files, read) : [],
    lastExtra: tier === 'e2e' ? (timings.perf ?? 0) : 0,
  });
}
