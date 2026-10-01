// Duration-balanced slices for CI's sim and browser jobs (docs/engineering.md, "CI on GitHub
// Actions"). `npm run check -- --tier sim --shard i/n` (and `--tier browser`) asks planSlices which
// test files slice i runs. The slices are a partition of the files the test runner itself lists:
// every file lands in exactly one slice, so the slices' test counts add up to the unsharded run's.
// Only the grouping is chosen here, from each file's measured CI seconds in tests/timings.json, so
// that no runner sits idle while another one finishes the tier. [default]
//
// - A file with no measured time (a new test) counts as the tier's median file.
// - Sim files that read the shared seeded batch (simBatch or presetBatch, tests/sim/batch.ts) stay
//   in one slice. Each runner computes the batch once, and every one of those files waits for it,
//   so the slice is modelled as the batch first (all of its workers busy) and the rest after.
// - A runner runs several files at once (WORKERS): Vitest's default on CI's 4 vCPUs is 3, and
//   Playwright's is 2. A slice's predicted time simulates that: each file goes to the first free
//   worker, in the order the runner starts them (Vitest: longest first, see
//   tests/sim/sequencer.ts; Playwright: by file path).
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

/** The middle value (the mean of the two middle ones for an even count); 1 for none. */
export function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return 1;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** When the last of `items` ends if `workers` workers each take the next one as they free up. */
function makespan(items, workers, start = 0) {
  const free = Array.from({ length: workers }, () => start);
  for (const it of items) {
    let w = 0;
    for (let i = 1; i < workers; i++) if (free[i] < free[w]) w = i;
    free[w] += it.cost;
  }
  return Math.max(start, ...free);
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
  const measured = (f) => typeof seconds[f] === 'number' && Number.isFinite(seconds[f]) && seconds[f] >= 0;
  const fallback = median(all.filter(measured).map((f) => seconds[f]));
  const cost = (f) => (measured(f) ? seconds[f] : fallback);

  const group = all.filter((f) => together.includes(f));
  const items = all.filter((f) => !group.includes(f)).map((f) => ({ files: [f], cost: cost(f) }));
  items.sort((a, b) => b.cost - a.cost || a.files[0].localeCompare(b.files[0]));

  const slices = Array.from({ length: n }, (_, i) => ({
    items: [],
    // The batch readers wait on one batch: model them as a block that holds every worker.
    head: 0,
    tail: i === n - 1 ? lastExtra : 0,
  }));
  if (group.length) {
    slices[0].items.push({ files: group, cost: Math.max(...group.map(cost)), block: true });
    slices[0].head = Math.max(...group.map(cost));
  }
  const runOrder = (list) =>
    order === 'longest-first'
      ? [...list].sort((a, b) => b.cost - a.cost || a.files[0].localeCompare(b.files[0]))
      : [...list].sort((a, b) => a.files[0].localeCompare(b.files[0]));
  const predict = (s, extra) => {
    const list = s.items.filter((it) => !it.block);
    if (extra) list.push(extra);
    return makespan(runOrder(list), workers, s.head) + s.tail;
  };

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
  for (const s of slices) {
    if (s.items.length > 0) continue;
    const donor = slices.reduce((a, b) =>
      b.items.filter((it) => !it.block).length > a.items.filter((it) => !it.block).length ? b : a,
    );
    const movable = donor.items.filter((it) => !it.block);
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
