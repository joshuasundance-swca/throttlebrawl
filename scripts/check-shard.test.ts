// `npm run check -- --shard i/n` (CI's sim slices). These cases all stop before any step runs, so
// the test is quick: a malformed slice, or a slice of a tier with a step that does not shard,
// must fail loudly instead of quietly running less of the gate.
import { spawnSync } from 'node:child_process';
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

  it('names the sim tier among the known tiers', () => {
    const r = check('--tier', 'nope');
    expect(r.code).toBe(1);
    expect(r.err).toContain('static, unit, sim, browser');
  });
});
