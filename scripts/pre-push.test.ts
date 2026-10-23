// Exercise the actual hook with controlled child streams: no compiler, unit tier or timed waits.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './lib.mjs';

type Step = 'typecheck' | 'units';
type Outcome = 'pass' | 'fail' | 'signal';
interface Scenario {
  first?: Step;
  typecheck?: Outcome;
  units?: Outcome;
  typeOnly?: boolean;
  dryRun?: boolean;
  workers?: string;
}

const output = {
  typecheck: {
    stdout: '[examined] fake configs checked\r\ntypecheck: 0 errors\r\ntype detail\n',
    stderr: 'typecheck stderr diagnostic\n',
  },
  units: {
    stdout: 'unit runner banner\r\n Test Files 1 passed\r\n Tests 2 passed\r\nunit detail\n',
    stderr: 'units stderr diagnostic\n',
  },
};

function runHook(scenario: Scenario = {}) {
  const scratch = path.join(repoRoot, 'scratch');
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(path.join(scratch, 'pre-push-feedback-'));
  const preload = path.join(directory, 'children.cjs');
  // Only async spawn is replaced. Planning still uses real, read-only Git commands. Unknown
  // commands throw rather than accidentally running an expensive test/typecheck subprocess.
  writeFileSync(
    preload,
    `
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const path = require('node:path');
const scenario = ${JSON.stringify(scenario)};
const output = ${JSON.stringify(output)};
const children = new Map();
const expected = scenario.typeOnly ? 1 : 2;
function finish(name) {
  const child = children.get(name);
  console.log('fixture: close ' + name);
  const text = output[name].stdout;
  // Split summary lines across chunks and include stderr, just as real children can.
  child.stdout.emit('data', Buffer.from(text.slice(0, 11)));
  child.stdout.emit('data', Buffer.from(text.slice(11)));
  child.stderr.emit('data', Buffer.from(output[name].stderr));
  const outcome = scenario[name] ?? 'pass';
  child.emit('close', outcome === 'signal' ? null : outcome === 'fail' ? 7 : 0,
    outcome === 'signal' ? 'SIGTERM' : null);
}
childProcess.spawn = (executable, args, options) => {
  const name = args[0] === path.join(options.cwd, 'scripts/typecheck.mjs') ? 'typecheck'
    : args[0] === path.join(options.cwd, 'node_modules/vitest/vitest.mjs') ? 'units' : null;
  if (!name || executable !== process.execPath || children.has(name))
    throw new Error('unexpected child command');
  if (name === 'units' && JSON.stringify(args.slice(1)) !==
      JSON.stringify(['run', '--project', 'unit'])) throw new Error('unexpected unit arguments');
  console.log('fixture: start ' + name + ' workers=' + options.env.VITEST_MAX_WORKERS);
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  children.set(name, child);
  if (children.size === expected) queueMicrotask(() => {
    const first = scenario.typeOnly ? 'typecheck' : scenario.first ?? 'typecheck';
    finish(first);
    if (!scenario.typeOnly) queueMicrotask(() => {
      // The first close's promise reactions have run; the sibling is still open here.
      console.log('fixture: sibling still open');
      finish(first === 'typecheck' ? 'units' : 'typecheck');
    });
  });
  return child;
};
syncBuiltinESMExports();
`,
  );
  try {
    const env = { ...process.env };
    delete env.VITEST_MAX_WORKERS;
    if (scenario.workers !== undefined) env.VITEST_MAX_WORKERS = scenario.workers;
    // An invalid ref selects the full-tier fallback without touching Git state. HEAD..HEAD
    // instead names no tests, covering the typecheck-only path with a real resolved ref.
    env.PREPUSH_BASE = scenario.typeOnly ? 'HEAD' : 'refs/pre-push-test/missing';
    env.PREPUSH_HEAD = 'HEAD';
    const result = spawnSync(
      process.execPath,
      [
        '--require',
        preload,
        path.join(repoRoot, 'scripts/pre-push.mjs'),
        ...(scenario.dryRun ? ['--dry-run'] : []),
      ],
      { cwd: repoRoot, env, encoding: 'utf8' },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    return { status: result.status, stdout: result.stdout };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const name = (step: Step) => (step === 'typecheck' ? 'typecheck' : 'unit tests (all)');

function expectCompletionOrder(stdout: string, first: Step) {
  const firstClose = stdout.indexOf(`fixture: close ${first}`);
  for (const step of ['typecheck', 'units']) {
    const start = stdout.indexOf(`fixture: start ${step} workers=2`);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThan(firstClose);
  }
  const siblingOpen = stdout.indexOf('fixture: sibling still open');
  const firstSummary = stdout.indexOf(`pre-push: ${name(first)} `);
  expect(firstSummary).toBeGreaterThan(firstClose);
  expect(firstSummary).toBeLessThan(siblingOpen);
  const second: Step = first === 'typecheck' ? 'units' : 'typecheck';
  expect(stdout.indexOf(`pre-push: ${name(second)} `)).toBeGreaterThan(siblingOpen);
}

describe('pre-push completion feedback', () => {
  it.each<Step>(['typecheck', 'units'])('prints %s as it finishes while its sibling is open', (first) => {
    const { status, stdout } = runHook({ first });
    expect(status).toBe(0);
    expectCompletionOrder(stdout, first);
    expect(stdout).toContain('typecheck passed in ');
    expect(stdout).toContain('unit tests (all) passed in ');
    expect(stdout).toContain('[examined] fake configs checked');
    expect(stdout).toContain('typecheck: 0 errors');
    expect(stdout).toContain('  Test Files 1 passed');
    expect(stdout).toContain('  Tests 2 passed');
    expect(stdout).not.toMatch(/type detail|unit detail|runner banner|stderr diagnostic/);
  });

  const failures = (['typecheck', 'units'] as const).flatMap((failed) =>
    (['fail', 'signal'] as const).flatMap((outcome) =>
      (['typecheck', 'units'] as const).map((first) => ({ failed, outcome, first })),
    ),
  );
  it.each(failures)(
    'waits for both steps when $failed has $outcome ($first first)',
    ({ failed, outcome, first }) => {
      const { status, stdout } = runHook({ first, [failed]: outcome });
      expect(status).toBe(1);
      expectCompletionOrder(stdout, first);
      expect(stdout).toContain(`pre-push: ${name(failed)} FAILED in `);
      expect(stdout).toContain(`  ${(output[failed].stdout + output[failed].stderr).trim()}\n`);
      const passed: Step = failed === 'typecheck' ? 'units' : 'typecheck';
      expect(stdout).toContain(`pre-push: ${name(passed)} passed in `);
      expect(stdout).not.toContain(`${passed} stderr diagnostic`);
    },
  );

  it('prints only the plan on a dry run, without starting either child', () => {
    const { status, stdout } = runHook({ dryRun: true });
    expect(status).toBe(0);
    expect(stdout).toContain('typecheck, and the whole unit tier');
    expect(stdout).not.toContain('fixture:');
    expect(stdout).not.toContain('passed in');
  });

  it('keeps a no-test plan typecheck-only and preserves an explicit worker override', () => {
    const { status, stdout } = runHook({ typeOnly: true, workers: '1' });
    expect(status).toBe(0);
    expect(stdout).toContain('typecheck, and no unit test file');
    expect(stdout).toContain('fixture: start typecheck workers=1');
    expect(stdout).toContain('pre-push: typecheck passed in ');
    expect(stdout).not.toContain('fixture: start units');
  });
});
