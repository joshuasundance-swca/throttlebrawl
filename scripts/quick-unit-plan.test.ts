import { describe, expect, it } from 'vitest';
import { planPushFromRevisions } from './push-plan.mjs';
import { planQuickUnits } from './quick-unit-plan.mjs';
import { planTier } from './shard-plan.mjs';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const inventory = ['src/ui/sample.test.ts', 'scripts/example.test.ts', 'tools/other.test.ts'];
function fixture(changed = ['src/ui/sample.ts'], available = inventory) {
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return args.at(-1) === 'HEAD^{commit}' ? head : base;
    if (args[0] === 'rev-list') return `${head} ${base} ${'c'.repeat(40)}\n`;
    if (args[0] === 'diff') return changed.length ? `${changed.join('\0')}\0` : '';
    throw new Error('unexpected revision read');
  };
  return { calls, git, exists: (file: string) => available.includes(file), inventory: available };
}

describe('train-quick named-unit adapter', () => {
  it('reuses the planner on the immutable checked-out first-parent comparison', () => {
    const f = fixture(['src/ui/sample.ts', 'scripts/example.test.ts', 'src/ui/sample.test.ts']);
    const expected = planPushFromRevisions(
      ['src/ui/sample.ts', 'scripts/example.test.ts', 'src/ui/sample.test.ts'],
      f.exists,
      base,
      head,
      () => {
        throw new Error('no manifest required');
      },
    );
    const selected = planQuickUnits(f);
    expect(selected).toMatchObject({ mode: 'files', tests: expected.tests, base, head });
    expect(f.calls).toEqual([
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      ['rev-parse', '--verify', `${head}^1^{commit}`],
      ['rev-list', '--parents', '-n', '1', head],
      ['diff', '--name-only', '-z', '--no-renames', base, head, '--'],
    ]);
    const shards = planTier('unit', selected.tests, 3);
    const files = shards.flatMap((s: { files: string[] }) => s.files);
    expect(files.sort()).toEqual(expected.tests);
    expect(new Set(files).size).toBe(files.length);
    expect(shards.some((s: { files: string[] }) => s.files.length === 0)).toBe(true);
  });

  it('distinguishes a validated no-match from absent comparison evidence and omits deleted tests', () => {
    for (const changed of [['src/ui/unnamed.ts'], ['src/ui/deleted.test.ts'], ['docs/example.md']]) {
      expect(planQuickUnits(fixture(changed))).toMatchObject({ mode: 'files', tests: [], base, head });
    }
    expect(planQuickUnits(fixture([])).mode).toBe('full');
  });

  it('keeps generic content selection equal to the existing bounded planner without unrelated units', () => {
    const changed = ['packs/future-pack/regions/new-county/routes/loop.json'];
    const unrelated = 'src/ui/unrelated.test.ts';
    const f = fixture(changed, [
      'src/app/career-content.test.ts',
      'tools/road/patrol-placement.test.ts',
      'tools/road/board-slots-on-land.test.ts',
      unrelated,
    ]);
    const expected = planPushFromRevisions(changed, f.exists, base, head, () => '');
    expect(expected.tests.length).toBeGreaterThan(0);
    const plan = planQuickUnits(f);
    expect(plan.mode).toBe('files');
    expect(plan.tests).toEqual(expected.tests);
    expect(plan.tests).not.toContain(unrelated);
  });

  it.each([
    'package.json',
    'package-lock.json',
    'vitest.config.ts',
    'tsconfig.sim.json',
    'tests/setup/sample.ts',
  ])('retains full units for %s even beside a named source', (file) => {
    expect(planQuickUnits(fixture([file, 'src/ui/sample.ts']))).toMatchObject({
      mode: 'full',
      tests: inventory,
    });
  });

  it('falls back on failed, missing and malformed revision/diff evidence', () => {
    for (const result of ['', 'not-a-commit']) {
      expect(planQuickUnits({ ...fixture(), git: () => result }).mode).toBe('full');
    }
    for (const failAt of ['rev-parse', 'diff']) {
      const f = fixture();
      expect(
        planQuickUnits({
          ...f,
          git: (args: string[]) => {
            if (args[0] === failAt) throw new Error('missing evidence');
            return f.git(args);
          },
        }).mode,
      ).toBe('full');
    }
    const f = fixture();
    expect(
      planQuickUnits({
        ...f,
        git: (args: string[]) => (args[0] === 'diff' ? 'src/ui/sample.ts' : f.git(args)),
      }).mode,
    ).toBe('full');
  });

  it('retains full units unless the checkout is a two-parent merge with the resolved first parent', () => {
    for (const parents of [
      `${head} ${base}`,
      `${head} ${'c'.repeat(40)} ${base}`,
      `${head} ${base} invalid`,
    ]) {
      const f = fixture();
      expect(
        planQuickUnits({ ...f, git: (args: string[]) => (args[0] === 'rev-list' ? parents : f.git(args)) })
          .mode,
      ).toBe('full');
    }
  });

  it('does not silently drop existing named tests absent from the actual unit inventory', () => {
    const f = fixture();
    expect(planQuickUnits({ ...f, inventory: ['tools/other.test.ts'] }).mode).toBe('full');
  });

  it('rejects malformed plans and selections outside the runner inventory', () => {
    for (const plan of [
      null,
      {},
      { mode: 'skip', tests: inventory, reason: 'bad' },
      { mode: 'files', tests: ['tests/sim/sample.test.ts'], reason: 'bad' },
      { mode: 'files', tests: ['src/ui/missing.test.ts'], reason: 'bad' },
      { mode: 'files', tests: [42], reason: 'bad' },
    ])
      // Deliberately cross the planner's type boundary to test runtime rejection.
      expect(
        planQuickUnits({
          ...fixture(),
          planner: () => plan as unknown as ReturnType<typeof planPushFromRevisions>,
        }).mode,
      ).toBe('full');
    expect(
      planQuickUnits({
        ...fixture(),
        planner: () => {
          throw new Error('planner failed');
        },
      }).mode,
    ).toBe('full');
    expect(
      planQuickUnits({
        ...fixture(),
        planner: () => ({ mode: 'files', tests: [inventory[0]!, inventory[0]!], reason: 'overlap' }),
      }),
    ).toMatchObject({ mode: 'files', tests: [inventory[0]] });
  });

  it('fails visibly when the full inventory itself is unavailable or invalid', () => {
    for (const files of [
      [],
      ['tests/sim/sample.test.ts'],
      ['../src/ui/sample.test.ts'],
      [inventory[0], inventory[0]],
    ]) {
      expect(() => planQuickUnits({ ...fixture(), inventory: files })).toThrow('unit inventory');
    }
  });
});
