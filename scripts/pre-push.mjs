#!/usr/bin/env node
// The pre-push hook (package.json, simple-git-hooks; docs/engineering.md "Pre-commit hooks and leak
// scan"): the typecheck, plus the unit tests scripts/push-plan.mjs picks from the files the branch
// changes since its merge base with origin/main. Both run at once and both must pass.
//
//   node scripts/pre-push.mjs              what the hook runs
//   node scripts/pre-push.mjs --dry-run    print the plan, run nothing
//
// PREPUSH_BASE and PREPUSH_HEAD (default origin/main and HEAD) name the range, for measuring a past
// push. Vitest gets two workers unless VITEST_MAX_WORKERS is set, so parallel lanes don't starve
// each other (AGENTS.md, the dev machine).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { examined, git, refExists, repoRoot, splitZ } from './lib.mjs';
import { planPush } from './push-plan.mjs';

const dryRun = process.argv.includes('--dry-run');
const base = process.env.PREPUSH_BASE ?? 'origin/main';
const head = process.env.PREPUSH_HEAD ?? 'HEAD';

let plan;
if (refExists(base)) {
  const mergeBase = git(['merge-base', base, head]).trim();
  // Deleted files name no test to run; a deleted config file is still a config change.
  const changed = splitZ(git(['diff', '--name-only', '-z', '--no-renames', mergeBase, head]));
  plan = planPush(changed, (f) => existsSync(path.join(repoRoot, f)));
  plan.reason += ` since ${base} (${mergeBase.slice(0, 7)})`;
} else {
  plan = { mode: 'full', tests: [], reason: `cannot find ${base}, so every unit test` };
}

const vitest = [path.join(repoRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--project', 'unit'];
const testSummary = /^\s*(Test Files|Tests) /;
const steps = [
  { name: 'typecheck', args: [path.join(repoRoot, 'scripts/typecheck.mjs')], keep: /\[examined\]|errors/ },
];
if (plan.mode === 'full') steps.push({ name: 'unit tests (all)', args: vitest, keep: testSummary });
if (plan.mode === 'files' && plan.tests.length) {
  const name = `unit tests (${plan.tests.length} files)`;
  steps.push({ name, args: [...vitest, ...plan.tests], keep: testSummary });
}

const testLine =
  plan.mode === 'full'
    ? 'the whole unit tier'
    : plan.tests.length
      ? `${plan.tests.length} unit test file(s): ${plan.tests.join(' ')}`
      : 'no unit test file';
examined(`pre-push: ${plan.reason}; typecheck, and ${testLine}`);
if (dryRun) process.exit(0);

const env = { ...process.env, VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? '2' };
const results = await Promise.all(
  steps.map(
    (step) =>
      new Promise((resolve) => {
        const t0 = Date.now();
        const child = spawn(process.execPath, step.args, { cwd: repoRoot, env });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        child.on('close', (code) => resolve({ ...step, code, out, secs: (Date.now() - t0) / 1000 }));
      }),
  ),
);

let failed = false;
for (const r of results) {
  const ok = r.code === 0;
  failed ||= !ok;
  // A passing step prints its summary lines only; a failing one prints everything.
  const lines = ok ? r.out.split(/\r?\n/).filter((l) => r.keep.test(l)) : [r.out];
  console.log(`pre-push: ${r.name} ${ok ? 'passed' : 'FAILED'} in ${r.secs.toFixed(1)} s`);
  for (const l of lines) console.log(`  ${l.trim()}`);
}
if (failed) process.exit(1);
