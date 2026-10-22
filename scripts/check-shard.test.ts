// `npm run check -- --shard i/n` (CI's sim and browser slices). These cases all stop before any step runs, so
// the test is quick: a malformed slice, or a slice of a tier with a step that does not shard,
// must fail loudly instead of quietly running less of the gate.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, 'check.mjs');
const check = (...args: string[]) => {
  const res = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { code: res.status, err: res.stderr };
};

// Exercise the real CLI and its runner/count path using generic runner/revision observations.
// No fixture process runs Vitest, a browser, npm or a gate tier.
const scratch = path.resolve(import.meta.dirname, '../scratch');
mkdirSync(scratch, { recursive: true });
const fixtureDir = mkdtempSync(path.join(scratch, 'quick-unit-cli-'));
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));
const preload = path.join(fixtureDir, 'runner.mjs');
writeFileSync(
  preload,
  `
import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
const f = JSON.parse(process.env.QUICK_FIXTURE);
const head = 'b'.repeat(40), base = 'a'.repeat(40);
const exists = fs.existsSync;
fs.existsSync = (file) => f.inventory.some((name) => path.resolve(name) === String(file)) || exists(file);
cp.spawnSync = (cmd, args) => {
  if (cmd === 'git') {
    let stdout;
    if (args[0] === 'rev-parse') stdout = args.at(-1) === 'HEAD^{commit}' ? head : base;
    if (args[0] === 'rev-list') stdout = head + ' ' + base + ' ' + 'c'.repeat(40);
    if (args[0] === 'diff') stdout = f.changed.length ? f.changed.join('\\0') + '\\0' : '';
    return { status: stdout === undefined ? 1 : 0, stdout, stderr: '' };
  }
  if (cmd === 'npx') {
    if (f.listFails) return { status: 1, stdout: '', stderr: 'fixture inventory unavailable' };
    fs.writeFileSync(args.find((a) => a.startsWith('--json=')).slice(7), JSON.stringify(f.inventory.map((file) => ({ file: path.resolve(file) }))));
    return { status: 0, stdout: '', stderr: '' };
  }
  throw new Error('unexpected command ' + cmd);
};
cp.spawn = (cmd, args) => {
  fs.writeFileSync(process.env.QUICK_RUNNER_ARGS, JSON.stringify(args));
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  process.nextTick(() => {
    const count = f.ran ?? args.slice(args.indexOf('--') + 1).length;
    child.stdout.write('Test Files ' + count + ' passed (' + count + ')\\nTests 1 passed (1)\\n');
    child.emit('close', 0);
  });
  return child;
};
syncBuiltinESMExports();
`,
);

let fixtureNumber = 0;
function controlledUnit(
  fixture: { inventory: string[]; changed: string[]; ran?: number; listFails?: boolean },
  named = true,
  shard = '1/3',
) {
  const argsFile = path.join(fixtureDir, `args-${fixtureNumber++}.json`);
  const res = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(preload).href,
      script,
      '--tier',
      'unit',
      '--shard',
      shard,
      ...(named ? ['--quick-named-units'] : []),
    ],
    {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, QUICK_FIXTURE: JSON.stringify(fixture), QUICK_RUNNER_ARGS: argsFile },
    },
  );
  let args: string[] | null = null;
  try {
    args = JSON.parse(readFileSync(argsFile, 'utf8')) as string[];
  } catch {
    /* runner did not start */
  }
  return { ...res, args };
}

describe('check train-quick unit execution', () => {
  const inventory = ['src/ui/sample.test.ts', 'tools/unrelated.test.ts'];
  it('runs only the exact selected files and retains actual/planned count auditing', () => {
    const fixture = { inventory, changed: ['src/ui/sample.ts'] };
    const result = controlledUnit(fixture);
    expect(result.status, result.stderr).toBe(0);
    expect(result.args).toEqual(['run', 'test', '--', inventory[0]]);
    expect(result.stdout).toContain('selected 1 of 2 unit files');
    const mismatch = controlledUnit({ ...fixture, ran: 2 });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stdout).toContain('FAIL (ran 2, the slice planned 1 files)');
  });
  it('reports validated empty selections and shards without ever invoking an unfiltered runner', () => {
    for (const result of [
      controlledUnit({ inventory, changed: ['src/ui/unnamed.ts'] }),
      controlledUnit({ inventory, changed: ['src/ui/sample.ts'] }, true, '3/3'),
    ]) {
      expect(result.status, result.stderr).toBe(0);
      expect(result.args).toBeNull();
      expect(result.stdout).toContain('NO SELECTED WORK');
      expect(result.stdout).not.toContain('tests passed');
    }
  });
  it('retains ordinary empty-shard failure, including uncertain quick comparisons', () => {
    for (const named of [false, true]) {
      const result = controlledUnit({ inventory, changed: [] }, named, '3/3');
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('got no files');
      expect(result.args).toBeNull();
    }
    const unavailable = controlledUnit({ inventory, changed: ['src/ui/sample.ts'], listFails: true });
    expect(unavailable.status).toBe(1);
    expect(unavailable.stderr).toContain('could not list the unit files');
    expect(unavailable.args).toBeNull();
  });
  it('refuses narrow execution outside a standalone unit shard', () => {
    for (const args of [
      ['--tier', 'unit'],
      ['--tier', 'unit,sim', '--shard', '1/3'],
    ]) {
      const result = check(...args, '--quick-named-units');
      expect(result.code).toBe(1);
      expect(result.err).toContain('requires an ordinary quick unit shard');
    }
    for (const env of [{ SUITE_FULL: 'true' }, { DIAGNOSTIC_CONTROL: 'true' }, { CONTROL_SELECTION: '{}' }]) {
      const result = spawnSync(
        process.execPath,
        [script, '--tier', 'unit', '--shard', '1/3', '--quick-named-units'],
        {
          encoding: 'utf8',
          env: { ...process.env, ...env },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('requires an ordinary quick unit shard');
    }
  });
});

describe('check --shard', () => {
  it('refuses a slice of a tier whose steps do not all shard', () => {
    const r = check('--tier', 'static', '--shard', '1/2');
    expect(r.code).toBe(1);
    expect(r.err).toContain('--shard needs a --tier whose steps all shard');
  });

  it('refuses a slice with no tier (the whole gate does not shard)', () => {
    const r = check('--shard', '1/2');
    expect(r.code).toBe(1);
    expect(r.err).toContain('--shard needs a --tier');
  });

  it.each(['0/2', '3/2', '1-2', ''])('refuses the malformed slice "%s"', (slice) => {
    const r = check('--tier', 'sim', '--shard', slice);
    expect(r.code).toBe(1);
    expect(r.err).toContain('--shard wants i/n');
  });

  it('refuses a slice of perf, which never shards (its probes time frames one at a time)', () => {
    const r = check('--tier', 'perf', '--shard', '1/2');
    expect(r.code).toBe(1);
    expect(r.err).toContain('--shard needs a --tier whose steps all shard');
  });

  it('checks a browser slice the same way', () => {
    const r = check('--tier', 'browser', '--shard', '2/1');
    expect(r.code).toBe(1);
    expect(r.err).toContain('--shard wants i/n');
  });

  it('names the sim, perf and budget tiers among the known tiers', () => {
    const r = check('--tier', 'nope');
    expect(r.code).toBe(1);
    expect(r.err).toContain('static, unit, sim, browser, perf, budget');
  });

  it('refuses a slice of the budget tier (the quick check builds and measures once)', () => {
    const r = check('--tier', 'static,budget', '--shard', '1/2');
    expect(r.code).toBe(1);
    expect(r.err).toContain('--shard needs a --tier whose steps all shard');
  });

  it('refuses a tier list with an unknown tier in it, even beside known ones', () => {
    const r = check('--tier', 'static,nope');
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown tier nope');
  });

  it('lets perf ride only in the last browser slice, which the slice plan leaves room for', () => {
    const r = check('--tier', 'browser,perf', '--shard', '1/4');
    expect(r.code).toBe(1);
    expect(r.err).toContain('perf rides only in the last slice (4/4)');
  });

  // End to end, through the runners' own file lists: the slices of each tier, as check prints them
  // with --plan, cover every test file on disk exactly once.
  it.each([
    ['sim', '3', 'tests/sim', /\.test\.ts$/],
    ['browser', '4', 'tests/e2e', /\.(spec|test)\.ts$/],
  ] as const)(
    'plans %s slices (n = %s) that hold every test file on disk exactly once',
    (tier, n, dir, re) => {
      const res = spawnSync(process.execPath, [script, '--tier', tier, '--shard', `1/${n}`, '--plan'], {
        encoding: 'utf8',
      });
      expect(res.status, res.stderr).toBe(0);
      const slices = res.stdout.split(/^\[slice \d+\/\d+\].*$/m).slice(1);
      expect(slices).toHaveLength(Number(n));
      const planned = slices.flatMap((s) => [...s.matchAll(/^ {2}(\S+)$/gm)].map((m) => m[1]));
      for (const s of slices) expect(s.trim(), 'no empty slice').not.toBe('');
      const onDisk = readdirSync(path.resolve(import.meta.dirname, '..', dir), { recursive: true })
        .map((f) => `${dir}/${String(f).replaceAll('\\', '/')}`)
        .filter((f) => re.test(f))
        .sort();
      expect(onDisk.length).toBeGreaterThan(10);
      expect(new Set(planned).size, 'no file in two slices').toBe(planned.length);
      expect([...planned].sort()).toEqual(onDisk);
    },
    60_000,
  );

  // The unit tests shard too since 2026-10-05: one job took 435 s, with its slowest file 337 s.
  it('plans unit slices that hold every unit test file on disk exactly once', () => {
    const res = spawnSync(process.execPath, [script, '--tier', 'unit', '--shard', '1/2', '--plan'], {
      encoding: 'utf8',
    });
    expect(res.status, res.stderr).toBe(0);
    const slices = res.stdout.split(/^\[slice \d+\/\d+\].*$/m).slice(1);
    expect(slices).toHaveLength(2);
    const planned = slices.flatMap((s) => [...s.matchAll(/^ {2}(\S+)$/gm)].map((m) => m[1]));
    for (const s of slices) expect(s.trim(), 'no empty slice').not.toBe('');
    const onDisk = ['src', 'scripts', 'tools']
      .flatMap((dir) =>
        readdirSync(path.resolve(import.meta.dirname, '..', dir), { recursive: true })
          .map((f) => `${dir}/${String(f).replaceAll('\\', '/')}`)
          .filter((f) => f.endsWith('.test.ts') && !f.includes('/node_modules/')),
      )
      .sort();
    expect(onDisk.length).toBeGreaterThan(100);
    expect(new Set(planned).size, 'no file in two slices').toBe(planned.length);
    expect([...planned].sort()).toEqual(onDisk);
  }, 60_000);

  it('still refuses perf alone in a slice, even the last one', () => {
    const r = check('--tier', 'perf', '--shard', '2/2');
    expect(r.code).toBe(1);
    expect(r.err).toContain('--shard needs a --tier whose steps all shard');
  });
});
