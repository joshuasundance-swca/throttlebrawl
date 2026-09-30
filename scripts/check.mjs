#!/usr/bin/env node
// npm run check: the whole gate, in CI order (docs/engineering.md, "The gate").
//   npm run check                    every tier
//   npm run check -- --tier static   one tier (CI runs static, unit and browser as parallel jobs)
//
// Every step must print what it examined, and an active step that examined nothing fails: a
// check that looked at nothing reads exactly like a pass. A step whose subject does not exist
// yet (no packs/, no seeded-race batch) is listed as NOT ACTIVE with the reason, never as a pass;
// it switches itself on when the lane that owns it adds its files.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fmtBytes, git, refExists, repoRoot, treeFiles } from './lib.mjs';
import { dependabotOnlyCommits } from './notes.mjs';

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
  { tier: 'unit', name: 'unit tests', script: 'test', count: fromVitest },
  {
    tier: 'unit',
    name: 'sim batch',
    script: 'test:sim',
    count: fromVitest,
    active: () =>
      hasFiles('tests/sim/', /\.test\.ts$/) ||
      'no seeded-race batch yet (dev-1 adds tests/sim/batch.ts and its tests)',
  },
  { tier: 'browser', name: 'build', script: 'build', count: fromDist },
  { tier: 'browser', name: 'e2e', script: 'e2e', count: fromPlaywright },
  { tier: 'browser', name: 'perf', script: 'perf', count: fromExamined },
];

function run(script) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', script], { cwd: repoRoot, shell: process.platform === 'win32' });
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

const tierArg = process.argv.indexOf('--tier');
const tier = tierArg > -1 ? process.argv[tierArg + 1] : null;
const steps = STEPS.filter((s) => !tier || s.tier === tier);
if (steps.length === 0) {
  console.error(`check: unknown tier ${tier} (static, unit, browser)`);
  process.exit(1);
}

const rows = [];
let failed = false;
for (const step of steps) {
  const active = step.active ? step.active() : true;
  if (active !== true) {
    rows.push([step.name, 'NOT ACTIVE', active]);
    continue;
  }
  console.log(`\n=== ${step.name}: npm run ${step.script} ===`);
  const started = Date.now();
  const { code, out } = await run(step.script);
  const { n, text } = step.count(out);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  let result = code === 0 ? 'pass' : 'FAIL';
  if (code === 0 && n === 0) result = 'FAIL (examined nothing)';
  if (result !== 'pass') failed = true;
  rows.push([step.name, result, `${text} (${secs}s)`]);
}

console.log(`\n=== gate summary${tier ? ` (${tier} tier)` : ''} ===`);
const w = Math.max(...rows.map((r) => r[0].length));
const w2 = Math.max(...rows.map((r) => r[1].length));
for (const [name, result, text] of rows) console.log(`${name.padEnd(w)}  ${result.padEnd(w2)}  ${text}`);
console.log(failed ? '\ngate: RED' : '\ngate: green');
process.exit(failed ? 1 : 0);
