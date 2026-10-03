#!/usr/bin/env node
// perf (docs/engineering.md, perf check). Needs a build in dist/.
//  1. The download budget from tests/perf/budget.json: the first-load JavaScript's gzip size (the
//     entry and its static imports, first-load.mjs; lazy `import()` chunks are listed apart, they
//     load later and on demand), and the whole first load counted as the raw bytes of every file in
//     dist/, lazy chunks included (a conservative stand-in for transfer).
//     Models are counted per region too (run W-Q): the dataset models under assets/ds/<region>/
//     load only when a race in that region starts, so each region's stay under its own limit.
//     It prints the first-load JavaScript's headroom and, on CI (or with --base <ref>), the pull
//     request's own change against main: it builds the merge base with origin/main in a throwaway
//     worktree under .cache/ (git-ignored) and measures it the same way. A growth of 5 KB or more
//     prints a warning. The budget fails any build; on a pull request (GitHub's `pull_request`
//     event), a change that grows the first load and leaves under 10 KB of headroom fails too (the
//     floor, scripts/perf-limits.mjs). Main's pushes keep the budget alone.
//  2. The Playwright perf probes (project `perf`): draw calls and triangles are hard limits; frame
//     and sim step times are a trend with a 3x catastrophe guard (scripts/perf-limits.mjs). Their
//     numbers and the size line go to CI's step summary (GITHUB_STEP_SUMMARY) when it is set.
//
//   node scripts/perf.mjs [--size-only] [--base <ref>|--no-base]
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { CACHE_DIR, modelsByRegion, SHARED, worstRaceModelBytes } from './dataset-assets.mjs';
import { firstLoadScripts } from './first-load.mjs';
import { examined, fmtBytes, git, refExists, repoRoot } from './lib.mjs';
import {
  firstLoadReport,
  floorProblem,
  isPullRequestRun,
  PR_FLOOR_KB,
  summaryMarkdown,
} from './perf-limits.mjs';

const args = process.argv.slice(2);
const sizeOnly = args.includes('--size-only');
const baseArg = args.indexOf('--base');
const baseRef = args.includes('--no-base')
  ? null
  : baseArg >= 0
    ? (args[baseArg + 1] ?? null)
    : process.env.CI
      ? 'origin/main'
      : null;

const dist = path.join(repoRoot, 'dist');
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('perf: dist/index.html is missing; run npm run build first');
  process.exit(1);
}
const budget = JSON.parse(readFileSync(path.join(repoRoot, 'tests/perf/budget.json'), 'utf8'));

const toPosix = (p) => p.split(path.sep).join('/');

/** Measures one build folder: its first-load JavaScript (gzip), lazy chunks and every file. */
function measure(dir) {
  const first = firstLoadScripts(readFileSync(path.join(dir, 'index.html'), 'utf8'), (rel) =>
    readFileSync(path.join(dir, rel), 'utf8'),
  );
  const out = { files: 0, raw: 0, jsGzip: 0, jsFiles: 0, lazy: [], distFiles: [] };
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const buf = readFileSync(path.join(entry.parentPath, entry.name));
    const rel = toPosix(path.relative(dir, path.join(entry.parentPath, entry.name)));
    out.files++;
    out.raw += buf.length;
    out.distFiles.push({ rel, bytes: buf.length });
    if (/\.m?js$/.test(entry.name)) {
      const gz = gzipSync(buf, { level: 9 }).length;
      if (first.has(rel)) {
        out.jsFiles++;
        out.jsGzip += gz;
      } else out.lazy.push({ rel, gz });
    }
  }
  return out;
}

/**
 * The first-load JavaScript of the merge base with `ref`, built in a throwaway worktree under
 * .cache/ (git-ignored; node_modules resolves from this checkout's, up the folder tree), or a
 * reason it was not measured. Never fails the gate: the number is information.
 */
function measureBase(ref) {
  if (!refExists(ref)) return { reason: `${ref} is not fetched here` };
  const base = git(['merge-base', 'HEAD', ref], { allowFail: true }).trim();
  if (!base) return { reason: `no merge base with ${ref}` };
  const head = git(['rev-parse', 'HEAD']).trim();
  if (base === head) return { reason: `this is ${ref} itself` };
  const dir = path.join(repoRoot, '.cache', 'perf-base');
  const cleanup = () => {
    git(['worktree', 'remove', '--force', dir], { allowFail: true });
    rmSync(dir, { recursive: true, force: true });
  };
  cleanup();
  try {
    // --force: a registration left by a killed run (its folder gone) must not block this one.
    git(['worktree', 'add', '--force', '--detach', dir, base]);
    // The pinned dataset files: a COPY of this checkout's cache (a few MB), so the base build
    // downloads only what the base pins and this checkout has not cached. Never a link: removing
    // the worktree would then delete this checkout's own cache through it.
    const cache = path.join(repoRoot, CACHE_DIR);
    if (existsSync(cache)) cpSync(cache, path.join(dir, CACHE_DIR), { recursive: true });
    const started = Date.now();
    const res = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'],
      { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 },
    );
    if (res.status !== 0)
      return {
        reason: `the base build failed: ${(res.stderr || res.stdout).trim().split('\n').slice(-3).join(' ')}`,
      };
    const m = measure(path.join(dir, 'dist'));
    return { sha: base.slice(0, 7), jsGzip: m.jsGzip, seconds: (Date.now() - started) / 1000 };
  } catch (err) {
    return { reason: String(err?.message ?? err).split('\n')[0] };
  } finally {
    cleanup();
  }
}

const here = measure(dist);
const problems = [];
if (here.jsFiles === 0) problems.push('found no first-load JavaScript in dist/index.html');
if (here.jsGzip > budget.jsGzipKB * 1024)
  problems.push(`first-load JavaScript ${fmtBytes(here.jsGzip)} gzip is over ${budget.jsGzipKB} KB`);
if (here.raw > budget.firstLoadKB * 1024)
  problems.push(`first load ${fmtBytes(here.raw)} is over ${budget.firstLoadKB} KB`);
const models = modelsByRegion(here.distFiles);
for (const [region, m] of [...models].sort(([a], [b]) => (a < b ? -1 : 1))) {
  console.log(`perf: models ${region}: ${m.files} files, ${fmtBytes(m.bytes)}`);
  if (region !== SHARED && m.bytes > budget.regionModelsKB * 1024)
    problems.push(`${region}'s models ${fmtBytes(m.bytes)} are over ${budget.regionModelsKB} KB`);
}
for (const c of here.lazy.sort((a, b) => b.gz - a.gz))
  console.log(`perf: lazy chunk ${c.rel} ${fmtBytes(c.gz)} gzip`);
const lazyGzip = here.lazy.reduce((n, c) => n + c.gz, 0);

const baseM = baseRef ? measureBase(baseRef) : { reason: 'not measured locally (pass --base origin/main)' };
const fl = firstLoadReport(here.jsGzip, budget.jsGzipKB, 'jsGzip' in baseM ? baseM.jsGzip : null);
const sizeLine =
  'jsGzip' in baseM
    ? `${fl.line}; main measured at merge base ${baseM.sha}, built in ${baseM.seconds.toFixed(1)} s`
    : `${fl.line}: ${baseM.reason}`;
console.log(`perf: ${sizeLine}`);
if (fl.warn)
  console.log(
    `perf: WARNING: this change grows the first-load JavaScript by ${fmtBytes(fl.deltaBytes ?? 0)}; ` +
      'move code the first screen does not need into a lazy import() chunk (docs/engineering.md, perf check)',
  );
// The pull request's floor: a PR that grows the first load must leave PR_FLOOR_KB of headroom.
const pullRequest = isPullRequestRun(process.env);
const floor = floorProblem(fl, budget.jsGzipKB, pullRequest);
if (floor) problems.push(floor);
const floorLine = pullRequest
  ? `pull-request floor ${PR_FLOOR_KB} KB of first-load headroom: ${floor ? 'FAILED' : 'holds'}`
  : `pull-request floor ${PR_FLOOR_KB} KB: not applied (not a pull_request run; the ${budget.jsGzipKB} KB budget alone)`;
console.log(`perf: ${floorLine}`);
examined(
  `${here.files} dist files: first-load JavaScript ${fmtBytes(here.jsGzip)} gzip in ${here.jsFiles} files ` +
    `(budget ${budget.jsGzipKB} KB, ${fmtBytes(Math.abs(fl.headroomBytes))} ${fl.headroomBytes >= 0 ? 'headroom' : 'over'}), ` +
    `lazy JavaScript ${fmtBytes(lazyGzip)} gzip in ${here.lazy.length} chunks, ` +
    `first load ${fmtBytes(here.raw)} (budget ${budget.firstLoadKB} KB), models in ${models.size} groups ` +
    `(${fmtBytes(models.get(SHARED)?.bytes ?? 0)} shared; one race's worst ${fmtBytes(worstRaceModelBytes(models))}, ` +
    `budget ${budget.regionModelsKB} KB per region)`,
);
for (const p of problems) console.error(`perf: ${p}`);

const probeSpecs =
  !sizeOnly && existsSync(path.join(repoRoot, 'tests/perf'))
    ? readdirSync(path.join(repoRoot, 'tests/perf')).filter((f) => f.endsWith('.spec.ts'))
    : [];
const results = path.join(repoRoot, 'test-results');
let probeStatus = 0;
if (probeSpecs.length) {
  // A stale probe file from an earlier run must never reach the summary.
  if (existsSync(results))
    for (const f of readdirSync(results))
      if (/^perf-probe.*\.json$/.test(f)) rmSync(path.join(results, f), { force: true });
  // One probe at a time: each times frames under 4x CPU throttling with software WebGL, so two
  // probes running side by side (Playwright's default on CI is 2 workers) slow each other down and
  // the frame times measure the contention, not the game.
  const res = spawnSync('npx', ['--no-install', 'playwright', 'test', '--project=perf', '--workers=1'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  probeStatus = res.status ?? 1;
} else {
  console.log(
    sizeOnly
      ? 'perf: --size-only: the probes did not run'
      : 'perf: no perf probe specs yet (dev-2 adds tests/perf/*.spec.ts); the size budget ran alone',
  );
}

// CI's step summary: the size line and every probe's trend rows.
if (process.env.GITHUB_STEP_SUMMARY) {
  const probes = [];
  if (existsSync(results))
    for (const f of readdirSync(results).sort()) {
      const m = /^perf-probe(?:-(.+))?\.json$/.exec(f);
      if (!m) continue;
      try {
        const j = JSON.parse(readFileSync(path.join(results, f), 'utf8'));
        if (Array.isArray(j.trend)) probes.push({ label: m[1] ? `${m[1]} look` : 'classic', rows: j.trend });
      } catch {
        // An unreadable probe file shows as missing in the summary.
      }
    }
  const size = [
    sizeLine,
    ...(fl.warn ? ['**Warning:** the first-load JavaScript grew by 5 KB or more.'] : []),
    floor ? `**Failed:** ${floor}` : floorLine,
  ];
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown({ size, probes }));
  } catch (err) {
    console.log(`perf: could not write the step summary: ${String(err)}`);
  }
}
if (problems.length || probeStatus !== 0) process.exit(1);
