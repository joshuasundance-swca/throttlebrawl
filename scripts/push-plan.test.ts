// What the pre-push hook tests (scripts/push-plan.mjs, docs/engineering.md "Pre-commit hooks and
// leak scan"): nothing for a docs-only push, the whole unit tier when a dependency or config file
// changed, and otherwise only the unit test files the push names: the test files it changed and the
// tests named after the source files it changed. CI runs every test on the PR.
import { describe, expect, it } from 'vitest';
import { planPush } from './push-plan.mjs';

/** A fake tree: the test files that exist. */
const tree = (...files: string[]) => {
  const set = new Set(files);
  return (f: string) => set.has(f);
};

describe('planPush', () => {
  it('runs no tests for a push of docs, notes and Markdown only', () => {
    const plan = planPush(
      ['docs/engineering.md', 'changes/2026-10-03-x.md', 'AGENTS.md', 'docs/playtests/README.md'],
      tree(),
    );
    expect(plan.mode).toBe('skip');
    expect(plan.tests).toEqual([]);
  });

  it('runs the whole unit tier when a dependency or config file changed', () => {
    for (const f of [
      'package.json',
      'package-lock.json',
      'vitest.config.ts',
      'vite.config.ts',
      'tsconfig.json',
      'tsconfig.sim.json',
      'tests/setup/base-roads.ts',
    ]) {
      const plan = planPush(['src/render/verge.ts', f], tree('src/render/verge.test.ts'));
      expect(plan.mode, f).toBe('full');
      expect(plan.reason, f).toContain(f);
    }
  });

  it('runs the changed unit test files and the tests named after changed source files', () => {
    const plan = planPush(
      [
        'src/render/verge.test.ts',
        'src/render/scenery.ts',
        'src/sim/cops/index.ts',
        'scripts/notes.mjs',
        'tools/road/tracks/pnw-c1.ts',
        'packs/region-pnw/region.json',
        'changes/2026-10-03-x.md',
      ],
      tree(
        'src/render/verge.test.ts',
        'src/render/scenery.test.ts',
        'src/sim/cops/cops.test.ts',
        'src/sim/cops/heat.test.ts',
        'scripts/notes.test.ts',
      ),
    );
    expect(plan.mode).toBe('files');
    expect(plan.tests).toEqual([
      'scripts/notes.test.ts',
      'src/render/scenery.test.ts',
      'src/render/verge.test.ts',
      'src/sim/cops/cops.test.ts',
    ]);
  });

  it('leaves out tests outside the unit project (sim batch, browser specs) and deleted test files', () => {
    const plan = planPush(
      ['tests/sim/events-setpieces.test.ts', 'tests/e2e/road-events.spec.ts', 'src/render/gone.test.ts'],
      tree(),
    );
    expect(plan.mode).toBe('files');
    expect(plan.tests).toEqual([]);
  });

  it('runs nothing for a push with no files', () => {
    expect(planPush([], tree()).mode).toBe('skip');
  });

  it('accepts Windows-style separators', () => {
    const plan = planPush(['src\\render\\verge.ts'], tree('src/render/verge.test.ts'));
    expect(plan.tests).toEqual(['src/render/verge.test.ts']);
  });
});
