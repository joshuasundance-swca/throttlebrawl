#!/usr/bin/env node
// perf (docs/engineering.md, perf check). Needs a build in dist/.
//  1. The download budget from tests/perf/budget.json: the first-load JavaScript's gzip size (the
//     entry and its static imports, first-load.mjs; lazy `import()` chunks are listed apart, they
//     load later and on demand), and the whole first load counted as the raw bytes of every file in
//     dist/, lazy chunks included (a conservative stand-in for transfer).
//     Models are counted per region too (run W-Q): the dataset models under assets/ds/<region>/
//     load only when a race in that region starts, so each region's stay under its own limit.
//     Pack-baked models and region atlases count too (playtest 3, C0a): each dist file is matched
//     to its pack file by content, and a region pack's files, a region's atlas and any base-pack
//     model whose catalog row names a region count as that region's own (dataset-assets.mjs).
//     It prints the first-load JavaScript's headroom and, on CI (or with --base <ref>), the pull
//     request's own change against main: it builds the merge base with origin/main in a throwaway
//     worktree under .cache/ (git-ignored) and measures it the same way. A growth of 5 KB or more
//     prints a warning. The budget fails any build; on a pull request's own run and on a train's run
//     (the tree that lands), a change that grows the first load and leaves under 10 KB of headroom
//     fails too (the floor, scripts/perf-limits.mjs floorJudgesRun). Main's pushes keep the budget
//     alone.
//     It names the biggest first-load modules, each one's estimated share of the gzip size, from the
//     list the build writes (scripts/first-load-modules.mjs, lane F1), and with main measured, the
//     modules that grew, so a growth shows by name, not only as a bigger chunk.
//  2. The Playwright perf probes (project `perf`): draw calls and triangles are hard limits; frame
//     and sim step times are a trend with a 3x catastrophe guard (scripts/perf-limits.mjs). Their
//     numbers and the size line go to CI's step summary (GITHUB_STEP_SUMMARY) when it is set.
//
//   node scripts/perf.mjs [--size-only] [--base <ref>|--no-base]
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { glbPath, PROPS } from '../tools/blender/catalog.mjs';
import {
  CACHE_DIR,
  modelsByRegion,
  packSourceRegion,
  packSources,
  regionsByPack,
  SHARED,
  sha256,
  worstRaceModelBytes,
} from './dataset-assets.mjs';
import { firstLoadScripts } from './first-load.mjs';
import {
  biggestModules,
  moduleGrowth,
  moduleLines,
  MODULES_FILE,
  statsMatch,
} from './first-load-modules.mjs';
import { examined, fmtBytes, git, refExists, repoRoot } from './lib.mjs';
import {
  firstLoadReport,
  floorProblem,
  floorJudgesRun,
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

// Which pack file each dist model or atlas came from, by content, and the region it counts under.
const packFileByHash = packSources(repoRoot);
const regionOfSource = packSourceRegion(
  regionsByPack(repoRoot),
  new Map(PROPS.filter((p) => p.region).map((p) => [glbPath(p), p.region])),
);

/** Measures one build folder: its first-load JavaScript (gzip), lazy chunks and every file. */
function measure(dir) {
  const first = firstLoadScripts(readFileSync(path.join(dir, 'index.html'), 'utf8'), (rel) =>
    readFileSync(path.join(dir, rel), 'utf8'),
  );
  const out = {
    files: 0,
    raw: 0,
    jsGzip: 0,
    jsFiles: 0,
    lazy: [],
    distFiles: [],
    gzCopies: 0,
    gzBytes: 0,
    first,
  };
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const buf = readFileSync(path.join(entry.parentPath, entry.name));
    const rel = toPosix(path.relative(dir, path.join(entry.parentPath, entry.name)));
    // A gzip copy (scripts/service-worker.mjs) is downloaded instead of its file, never as well, so
    // the first load counts the plain file alone (the conservative one).
    if (rel.endsWith('.gz') && existsSync(path.join(dir, rel.slice(0, -3)))) {
      out.gzCopies++;
      out.gzBytes += buf.length;
      continue;
    }
    out.files++;
    out.raw += buf.length;
    const source = /\.(glb|png)$/.test(entry.name) ? packFileByHash.get(sha256(buf)) : undefined;
    out.distFiles.push({ rel, bytes: buf.length, ...(source ? { source } : {}) });
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

/** How many modules the check names, and the smallest growth it names against main. */
const TOP_MODULES = 15;
const GROWTH_MODULES = 10;
const GROWTH_MIN_BYTES = 512;

/**
 * The first-load module list the build wrote under `root` (scripts/first-load-modules.mjs), when it
 * names the same first-load scripts as `first` (the build in dist/), or the reason it is not used.
 */
function readModules(root, first) {
  const file = path.join(root, MODULES_FILE);
  if (!existsSync(file)) return { reason: `the build wrote no ${MODULES_FILE}` };
  try {
    const stats = JSON.parse(readFileSync(file, 'utf8'));
    if (!statsMatch(stats, first)) return { reason: `${MODULES_FILE} is from another build` };
    return { modules: stats.modules };
  } catch (err) {
    return { reason: `${MODULES_FILE} did not read: ${String(err)}` };
  }
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
    return {
      sha: base.slice(0, 7),
      jsGzip: m.jsGzip,
      seconds: (Date.now() - started) / 1000,
      modules: readModules(dir, m.first),
    };
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
const models = modelsByRegion(here.distFiles, regionOfSource);
const ownLine =
  [...models]
    .filter(([region]) => region !== SHARED)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([region, m]) => `${region} ${fmtBytes(m.bytes)}`)
    .join(', ') || 'no region has its own models';
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
// The first load by module: the biggest, and against main, the ones that grew (lane F1).
const headModules = readModules(repoRoot, here.first);
const moduleSummary = [];
if ('modules' in headModules) {
  const top = moduleLines(biggestModules(headModules.modules, TOP_MODULES));
  console.log(`perf: the ${top.length} biggest first-load modules (estimated share of the gzip size):`);
  for (const line of top) console.log(`perf:   ${line}`);
  moduleSummary.push(`Biggest first-load modules (gzip share): ${top.slice(0, 5).join('; ')}`);
  const baseModules = 'jsGzip' in baseM ? baseM.modules : { reason: baseM.reason };
  if ('modules' in baseModules) {
    const grown = moduleLines(
      moduleGrowth(baseModules.modules, headModules.modules, {
        n: GROWTH_MODULES,
        minBytes: GROWTH_MIN_BYTES,
      }),
      true,
    );
    console.log(
      grown.length
        ? `perf: first-load modules grown by ${fmtBytes(GROWTH_MIN_BYTES)} or more against main:`
        : `perf: no first-load module grew by ${fmtBytes(GROWTH_MIN_BYTES)} or more against main`,
    );
    for (const line of grown) console.log(`perf:   ${line}`);
    if (grown.length) moduleSummary.push(`Grown against main: ${grown.join('; ')}`);
  } else console.log(`perf: first-load module growth against main not measured: ${baseModules.reason}`);
} else console.log(`perf: first-load modules not named: ${headModules.reason}`);

// The pull request's floor: a PR that grows the first load must leave PR_FLOOR_KB of headroom, on its
// own run and on the train run that lands it (the tree that reaches main).
const judged = floorJudgesRun(process.env);
const floor = floorProblem(fl, budget.jsGzipKB, judged);
if (floor) problems.push(floor);
const floorLine = judged
  ? `pull-request floor ${PR_FLOOR_KB} KB of first-load headroom (${process.env.GITHUB_EVENT_NAME} run): ${floor ? 'FAILED' : 'holds'}`
  : `pull-request floor ${PR_FLOOR_KB} KB: not applied (a push to main or a local run; the ${budget.jsGzipKB} KB budget alone)`;
console.log(`perf: ${floorLine}`);
examined(
  `${here.files} dist files: first-load JavaScript ${fmtBytes(here.jsGzip)} gzip in ${here.jsFiles} files ` +
    `(budget ${budget.jsGzipKB} KB, ${fmtBytes(Math.abs(fl.headroomBytes))} ${fl.headroomBytes >= 0 ? 'headroom' : 'over'}), ` +
    `lazy JavaScript ${fmtBytes(lazyGzip)} gzip in ${here.lazy.length} chunks, ` +
    `first load ${fmtBytes(here.raw)} (budget ${budget.firstLoadKB} KB; ${here.gzCopies} gzip copies, ` +
    `${fmtBytes(here.gzBytes)}, not counted), models in ${models.size} groups ` +
    `(${fmtBytes(models.get(SHARED)?.bytes ?? 0)} shared; own: ${ownLine}; ` +
    `one race's worst ${fmtBytes(worstRaceModelBytes(models))}, ` +
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
    ...moduleSummary,
  ];
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown({ size, probes }));
  } catch (err) {
    console.log(`perf: could not write the step summary: ${String(err)}`);
  }
}
if (problems.length || probeStatus !== 0) process.exit(1);
