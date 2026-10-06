// `npm run check -- --shard i/n` (CI's sim and browser slices). These cases all stop before any step runs, so
// the test is quick: a malformed slice, or a slice of a tier with a step that does not shard,
// must fail loudly instead of quietly running less of the gate.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, 'check.mjs');
const check = (...args: string[]) => {
  const res = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { code: res.status, err: res.stderr };
};

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
