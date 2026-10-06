#!/usr/bin/env node
// npm run check: the whole gate, in CI order (docs/engineering.md, "The gate").
//   npm run check                    every tier
//   npm run check -- --tier static   one tier (CI runs static, unit, and each sim and browser slice
//                                    as parallel jobs)
//   npm run check -- --tier sim --shard 1/2
//                                    one slice of a tier: the unit tests, the sim batch or the
//                                    browser tests. The
//                                    test runner lists the tier's files and scripts/shard-plan.mjs
//                                    splits them by their measured CI seconds; every file lands in
//                                    exactly one slice. A step marked everySlice (the build) runs
//                                    whole in every slice.
//   npm run check -- --tier browser,perf --shard 4/4
//                                    several tiers in one go, sharing one build: CI's last browser
//                                    slice runs its e2e files, then perf (lastSliceOnly) on the same
//                                    build.
//   npm run check -- --tier static,budget
//                                    the static part of the quick check a PR gets before the bundle
//                                    train (docs/engineering.md, "The bundle train"): the static
//                                    tier, then the build and its size budget (perf --size-only).
//
// Every step must print what it examined, and an active step that examined nothing fails: a
// check that looked at nothing reads exactly like a pass. A step whose subject does not exist
// yet (no packs/, no seeded-race batch) is listed as NOT ACTIVE with the reason, never as a pass;
// it switches itself on when the lane that owns it adds its files.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fmtBytes, git, refExists, repoRoot, treeFiles } from './lib.mjs';
import { dependabotOnlyCommits } from './notes.mjs';
import {
  JOB_SHARE,
  overLine,
  planTier,
  readSuiteJobs,
  SUITE_FILE,
  TIMINGS_FILE,
  unmeasured,
} from './shard-plan.mjs';

const stripAnsi = (s) => stripVTControlCharacters(s);
const lastExamined = (out) => [...out.matchAll(/^\[examined\] (.*)$/gm)].pop()?.[1] ?? '';
const firstNumber = (s) => Number(/(\d+)/.exec(s)?.[1] ?? 0);

function fromExamined(out) {
  const text = lastExamined(out);
  return { n: firstNumber(text), text: text || 'printed no [examined] line' };
}
function fromVitest(out) {
  const m = /^\s*Tests\s+(?:(\d+) failed \| )?(\d+) passed/m.exec(out);
  const files = /Test Files\s+(?:\d+ failed \| )?(\d+) passed/.exec(out)?.[1] ?? '0';
  const failed = m?.[1] ? `, ${m[1]} failed` : '';
  return { n: Number(m?.[2] ?? 0), text: `${m?.[2] ?? 0} tests passed${failed} (${files} files passed)` };
}
function fromPlaywright(out) {
  const passed = /(\d+) passed/.exec(out)?.[1];
  const failed = /(\d+) failed/.exec(out)?.[1];
  const flaky = /(\d+) flaky/.exec(out)?.[1];
  const renderer = /renderer: (.*)/.exec(out)?.[1];
  const bad = [failed && `${failed} failed`, flaky && `${flaky} flaky`].filter(Boolean).join(', ');
  return {
    n: Number(passed ?? 0),
    text: `${passed ?? 0} browser tests passed${bad ? `, ${bad}` : ''}${renderer ? `; ${renderer.trim()}` : ''}`,
  };
}
/** How many test files Vitest ran (passed, failed or skipped): the total in "Test Files ... (N)". */
const vitestFiles = (out) => Number(/Test Files\s+[^\n]*\((\d+)\)/.exec(out)?.[1] ?? -1);
/** How many tests Playwright started: "Running N tests using W workers". */
const playwrightRunning = (out) => Number(/Running (\d+) tests? using/.exec(out)?.[1] ?? -1);
function fromDist() {
  const dist = path.join(repoRoot, 'dist');
  if (!existsSync(dist)) return { n: 0, text: 'no dist/' };
  let n = 0;
  let bytes = 0;
  for (const e of readdirSync(dist, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    n++;
    bytes += statSync(path.join(e.parentPath, e.name)).size;
  }
  return { n, text: `${n} files in dist/, ${fmtBytes(bytes)}` };
}

const onMainPush = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main';
const localBranch = () => git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }).trim();
const hasFiles = (prefix, re) => treeFiles().some((f) => f.startsWith(prefix) && re.test(f));

const STEPS = [
  { tier: 'static', name: 'types', script: 'typecheck', count: fromExamined },
  { tier: 'static', name: 'lint', script: 'lint', count: fromExamined },
  { tier: 'static', name: 'format', script: 'format:check', count: fromExamined },
  {
    tier: 'static',
    name: 'packs',
    script: 'packs:check',
    count: fromExamined,
    active: () =>
      hasFiles('packs/', /./) || 'packs/ does not exist yet (app-1 adds packs/base, content-1 the validator)',
  },
  { tier: 'static', name: 'leak scan', script: 'leakscan:all', count: fromExamined },
  { tier: 'static', name: 'size', script: 'sizecheck', count: fromExamined },
  {
    tier: 'static',
    name: 'notes',
    script: 'notes:check',
    count: fromExamined,
    active: () => {
      if (onMainPush || localBranch() === 'main')
        return 'on main there is no branch to compare (notes ride in the PR)';
      const base = process.env.NOTES_BASE ?? 'origin/main';
      if (!refExists(base)) return true; // notes:check reports the missing base itself
      const mergeBase = git(['merge-base', base, 'HEAD']).trim();
      const bot = dependabotOnlyCommits(git, mergeBase, process.env.NOTES_PR_AUTHOR);
      return bot
        ? `a Dependabot PR (${bot} Dependabot-only commit(s)) carries no note (docs/engineering.md, Dependabot)`
        : true;
    },
  },
  // The unit tests shard like the sim batch (CI's unit slices since 2026-10-05).
  { tier: 'unit', name: 'unit tests', script: 'test', count: fromVitest, shardable: 'unit' },
  {
    tier: 'sim',
    name: 'sim batch',
    script: 'test:sim',
    shardable: 'sim',
    count: fromVitest,
    active: () =>
      hasFiles('tests/sim/', /\.test\.ts$/) ||
      'no seeded-race batch yet (dev-1 adds tests/sim/batch.ts and its tests)',
  },
  // The build belongs to both browser tiers. A job that runs both (`--tier browser,perf`, CI's last
  // browser slice) or the whole gate builds once; a job with one of them builds its own. It is
  // `build:dist`, the build without `build`'s own typecheck: the static tier's types step checks the
  // same three configs, and every browser slice repeating it cost each CI slice about 10 s.
  // The budget tier (the quick check, docs/engineering.md "The bundle train") builds too.
  {
    tier: ['browser', 'perf', 'budget'],
    name: 'build',
    script: 'build:dist',
    count: fromDist,
    everySlice: true,
  },
  { tier: 'browser', name: 'e2e', script: 'e2e', count: fromPlaywright, shardable: 'e2e' },
  // perf never shards: its probes time frames one at a time on an otherwise idle runner. In a
  // sharded run it may only ride in the last slice, after that slice's e2e files, as in ci.yml; the
  // slice plan leaves that slice room for it.
  { tier: 'perf', name: 'perf', script: 'perf', count: fromExamined, lastSliceOnly: true },
  // The size budget alone (first-load JavaScript and its pull-request floor, the whole first load,
  // per-region models), without the throttled probes: seconds, so the quick check catches a PR
  // that crosses it. perf checks the same budget, so in a run with perf this step stands down.
  {
    tier: 'budget',
    name: 'size budget',
    script: 'perf',
    args: ['--size-only'],
    count: fromExamined,
    active: () =>
      (tiers !== null && !tiers.includes('perf')) || 'perf checks the same size budget in this run',
  },
];

/**
 * The test files of a shardable step, as its runner lists them (so a slice plan covers exactly
 * what the unsharded run would run), with each file's test count where the runner prints it.
 * Vitest writes its list to a JSON file, not stdout: a 325-line list read through a pipe came back
 * cut short on CI (2026-10-05, the unit tier's plan test planned 249 of 325 files), and a short list
 * plans a short slice set that no slice-level check can notice.
 */
function runnerFiles(kind) {
  const listFile = path.join(
    repoRoot,
    'node_modules',
    '.cache',
    'throttlebrawl',
    `vitest-list-${kind}-${process.pid}.json`,
  );
  const cmd =
    kind === 'e2e'
      ? ['playwright', 'test', '--list', '--project=e2e']
      : ['vitest', 'list', '--project', kind, '--filesOnly', `--json=${listFile}`];
  if (kind !== 'e2e') mkdirSync(path.dirname(listFile), { recursive: true });
  const res = spawnSync('npx', ['--no-install', ...cmd], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    shell: process.platform === 'win32',
  });
  const out = stripAnsi(`${res.stdout ?? ''}`);
  if (res.status !== 0) {
    console.error(
      `check: could not list the ${kind} files (npx ${cmd.join(' ')}):\n${out}${res.stderr ?? ''}`,
    );
    process.exit(1);
  }
  const tests = new Map();
  if (kind === 'e2e') {
    for (const m of out.matchAll(/\[e2e\] › (\S+?):\d+:\d+ › /g)) {
      const f = m[1].replaceAll('\\', '/');
      tests.set(f, (tests.get(f) ?? 0) + 1);
    }
  } else {
    const listed = JSON.parse(readFileSync(listFile, 'utf8'));
    rmSync(listFile, { force: true });
    for (const { file } of listed) {
      const f = path.relative(repoRoot, file).split(path.sep).join('/');
      tests.set(f, (tests.get(f) ?? 0) + 1);
    }
  }
  return { files: [...tests.keys()].sort(), tests };
}

function run(script, args = []) {
  return new Promise((resolve) => {
    const npmArgs = ['run', script, ...(args.length ? ['--', ...args] : [])];
    const child = spawn('npm', npmArgs, { cwd: repoRoot, shell: process.platform === 'win32' });
    let out = '';
    const onData = (stream) => (chunk) => {
      out += chunk.toString();
      stream.write(chunk);
    };
    child.stdout.on('data', onData(process.stdout));
    child.stderr.on('data', onData(process.stderr));
    child.on('close', (code) => resolve({ code: code ?? 1, out: stripAnsi(out) }));
  });
}

const TIER_NAMES = ['static', 'unit', 'sim', 'browser', 'perf', 'budget'];
const tierArg = process.argv.indexOf('--tier');
const tier = tierArg > -1 ? (process.argv[tierArg + 1] ?? '') : null;
const tiers = tier === null ? null : tier.split(',');
const unknown = tiers?.filter((t) => !TIER_NAMES.includes(t)) ?? [];
const steps = STEPS.filter((s) => !tiers || [s.tier].flat().some((t) => tiers.includes(t)));
if (unknown.length || steps.length === 0) {
  console.error(`check: unknown tier ${unknown.join(',') || tier} (${TIER_NAMES.join(', ')})`);
  process.exit(1);
}
// --shard i/n runs one slice of the shardable steps: their runner lists the tier's files, and
// scripts/shard-plan.mjs splits them by measured CI seconds into n slices, each file in exactly
// one. Every other step must run whole in each slice (everySlice: the build) or be perf in the
// last slice (lastSliceOnly), so a slice can never quietly drop a step.
const shardArg = process.argv.indexOf('--shard');
const shard = shardArg > -1 ? (process.argv[shardArg + 1] ?? '') : null;
let slice = null;
if (shard !== null) {
  const m = /^(\d+)\/(\d+)$/.exec(shard);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) {
    console.error(`check: --shard wants i/n with 1 <= i <= n, got "${shard}"`);
    process.exit(1);
  }
  slice = { i: Number(m[1]), n: Number(m[2]) };
  if (
    !tiers ||
    !steps.some((s) => s.shardable) ||
    steps.some((s) => !s.shardable && !s.everySlice && !s.lastSliceOnly)
  ) {
    console.error('check: --shard needs a --tier whose steps all shard (unit, sim, browser)');
    process.exit(1);
  }
  if (slice.i !== slice.n && steps.some((s) => s.lastSliceOnly)) {
    console.error(
      `check: perf rides only in the last slice (${slice.n}/${slice.n}), which the slice plan leaves room for`,
    );
    process.exit(1);
  }
}

/**
 * The files of this slice for a shardable step, printed with the plan's numbers. With --plan,
 * every slice's files are printed instead (which slice runs my test?), and nothing runs.
 */
const planOnly = process.argv.includes('--plan');
function sliceOf(step) {
  const { files, tests } = runnerFiles(step.shardable);
  const plan = planTier(step.shardable, files, slice.n);
  const mine = plan[slice.i - 1];
  const total = [...tests.values()].reduce((a, b) => a + b, 0);
  const testsIn = (list) => list.reduce((a, f) => a + (tests.get(f) ?? 0), 0);
  console.log(
    `\n${step.name}: slice ${slice.i}/${slice.n} runs ${mine.files.length} of ${files.length} files` +
      (step.shardable === 'e2e' ? `, ${testsIn(mine.files)} of ${total} tests` : '') +
      `; planned job seconds per slice, setup included: ${plan.map((p) => p.predicted).join(' / ')} (scripts/shard-plan.mjs)`,
  );
  // A slice planned past its share of the job's timeout runs into the timeout on a slow runner.
  // Only for the slice count suite.yml runs; a local --plan with another count is a what-if.
  const jobs = readSuiteJobs();
  const job = jobs?.[step.shardable];
  if (job && job.slices === slice.n) {
    const over = overLine(plan, job.timeout);
    if (over.length > 0) {
      const text =
        `${step.name}: ${over.map((o) => `slice ${o.slice}/${slice.n} is planned at ${o.predicted} s`).join(', ')}, ` +
        `past ${Math.round(JOB_SHARE * 100)}% of its ${job.timeout} s timeout (${over[0]?.line} s). Refresh ` +
        `${TIMINGS_FILE} or add a slice in ${SUITE_FILE}.`;
      console.log(process.env.GITHUB_ACTIONS ? `::warning title=slice plan::${text}` : `warning: ${text}`);
    }
  }
  // A file the timing table does not know is planned at an estimate; say so, so a new slow test
  // cannot quietly overload a slice. On CI it is also an annotation on the run's summary.
  const missing = unmeasured(step.shardable, files);
  if (missing.files.length > 0) {
    const text =
      `${missing.files.length} ${step.name} file(s) have no measured CI time in ${TIMINGS_FILE}, so each is planned ` +
      `as ${Math.round(missing.seconds)} s (the table's mean): ${missing.files.join(', ')}. Slices may be uneven ` +
      `until the table is refreshed: node scripts/timings.mjs <green run id>...`;
    console.log(process.env.GITHUB_ACTIONS ? `::warning title=slice plan::${text}` : `warning: ${text}`);
  }
  for (const [k, s] of (planOnly ? plan : [mine]).entries()) {
    if (planOnly)
      console.log(`[slice ${k + 1}/${slice.n}] ${s.files.length} files, about ${s.predicted} s of job on CI`);
    for (const f of s.files) console.log(`  ${f}`);
  }
  if (mine.files.length === 0) {
    console.error(`check: slice ${slice.i}/${slice.n} of ${step.name} got no files; use fewer slices`);
    process.exit(1);
  }
  return { files: mine.files, tests: step.shardable === 'e2e' ? testsIn(mine.files) : null };
}

if (planOnly) {
  if (!slice) {
    console.error('check: --plan prints a slice plan, so it needs --shard i/n');
    process.exit(1);
  }
  for (const step of steps) if (step.shardable) sliceOf(step);
  // Let stdout drain first: process.exit drops writes still queued for a pipe.
  await new Promise((resolve) => process.stdout.write('', resolve));
  process.exit(0);
}

const rows = [];
let failed = false;
for (const step of steps) {
  const active = step.active ? step.active() : true;
  if (active !== true) {
    rows.push([step.name, 'NOT ACTIVE', active]);
    continue;
  }
  const planned = slice && step.shardable ? sliceOf(step) : null;
  const args = planned ? planned.files : (step.args ?? []);
  const label = planned
    ? `${step.name} (slice ${slice.i}/${slice.n}, ${planned.files.length} files)`
    : step.name;
  const shown = planned ? ` -- <${args.length} files>` : args.length ? ` -- ${args.join(' ')}` : '';
  console.log(`\n=== ${label}: npm run ${step.script}${shown} ===`);
  const started = Date.now();
  const { code, out } = await run(step.script, args);
  const { n, text } = step.count(out);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  let result = code === 0 ? 'pass' : 'FAIL';
  if (code === 0 && n === 0) result = 'FAIL (examined nothing)';
  // The runner must have run exactly the slice: every planned file (Vitest), every listed test of
  // them (Playwright), so a filter that matched more or fewer files cannot pass unnoticed.
  if (planned && code === 0) {
    const vitest = step.shardable !== 'e2e';
    const ran = vitest ? vitestFiles(out) : playwrightRunning(out);
    const want = vitest ? planned.files.length : planned.tests;
    if (ran !== want) result = `FAIL (ran ${ran}, the slice planned ${want} ${vitest ? 'files' : 'tests'})`;
  }
  if (result !== 'pass') failed = true;
  rows.push([label, result, `${text} (${secs}s)`]);
}

const scope = tiers
  ? ` (${tiers.join(' and ')} tier${tiers.length > 1 ? 's' : ''}${shard ? `, slice ${shard}` : ''})`
  : '';
console.log(`\n=== gate summary${scope} ===`);
const w = Math.max(...rows.map((r) => r[0].length));
const w2 = Math.max(...rows.map((r) => r[1].length));
for (const [name, result, text] of rows) console.log(`${name.padEnd(w)}  ${result.padEnd(w2)}  ${text}`);
console.log(failed ? '\ngate: RED' : '\ngate: green');
process.exit(failed ? 1 : 0);
