import { describe, expect, it } from 'vitest';
import { collectControlPlan, controlInventory } from './control-plan.mjs';

const repo = 'owner/game';
const sha = 'a'.repeat(40);
const shape = { unit: { slices: 2 }, sim: { slices: 2 }, e2e: { slices: 3 } };
const names = controlInventory(shape);
const run = {
  id: 42,
  run_attempt: 1,
  head_sha: sha,
  head_branch: 'main',
  path: '.github/workflows/train.yml',
  repository: { full_name: repo },
  head_repository: { full_name: repo },
};
const rows = names.map((name: string, i: number) => ({
  id: i + 1,
  name,
  run_id: 42,
  run_attempt: 1,
  status: 'completed',
  conclusion: i === names.length - 2 ? 'failure' : 'success',
}));
function fixture(options: { page?: (page: number) => unknown; after?: object; error?: boolean } = {}) {
  let reads = 0;
  const calls: string[] = [];
  const api = (path: string) => {
    calls.push(path);
    if (options.error) throw new Error('unavailable');
    if (!path.includes('/jobs?')) return Promise.resolve(++reads === 1 ? run : (options.after ?? run));
    const page = Number(new URL(`https://example.test${path}`).searchParams.get('page'));
    return Promise.resolve(options.page?.(page) ?? { total_count: rows.length, jobs: rows });
  };
  return { api, calls };
}
const input = { repo, sha, runId: 42, attempt: 1, shape };
describe('branch control planning', () => {
  it('selects the failed original shard without renumbering it or selecting perf', async () => {
    const f = fixture();
    const plan = await collectControlPlan({ ...input, api: f.api });
    expect(plan).toMatchObject({ scope: 'targeted', jobs: [names.at(-2)] });
    expect(plan.selection).toEqual({
      static: false,
      unit: [],
      sim: [],
      browser: [2],
      totals: { unit: 2, sim: 2, browser: 3 },
    });
    expect(f.calls.filter((path) => !path.includes('/jobs?'))).toHaveLength(2);
  });
  it('collects every page and binds the final complete inventory', async () => {
    const filler = Array.from({ length: 103 }, (_, i) => ({ ...rows[0], id: 100 + i, name: `other ${i}` }));
    const all = [...filler, ...rows];
    const f = fixture({
      page: (page) => ({ total_count: all.length, jobs: all.slice((page - 1) * 100, page * 100) }),
    });
    expect(await collectControlPlan({ ...input, api: f.api })).toMatchObject({ scope: 'targeted' });
    expect(f.calls.filter((path) => path.includes('/jobs?'))).toHaveLength(2);
  });
  it.each([
    ['attempt changed', { after: { ...run, run_attempt: 2 } }],
    ['head changed', { after: { ...run, head_sha: 'b'.repeat(40) } }],
    ['wrong repository', { after: { ...run, repository: { full_name: 'other/game' } } }],
    ['API unavailable', { error: true }],
    ['truncated collection', { page: () => ({ total_count: rows.length + 1, jobs: rows }) }],
    ['duplicate collection', { page: () => ({ total_count: rows.length + 1, jobs: [...rows, rows[0]] }) }],
  ] as const)('falls back to full controls for %s', async (_label, options) => {
    expect(await collectControlPlan({ ...input, api: fixture(options).api })).toMatchObject({
      scope: 'full',
      selection: null,
    });
  });
  it('bounds collection and conservatively falls back when the request budget expires', async () => {
    let time = 0;
    const f = fixture();
    const api = async (path: string) => {
      time += 10_000;
      return f.api(path);
    };
    expect(await collectControlPlan({ ...input, api, now: () => time, budgetMs: 5_000 })).toMatchObject({
      scope: 'full',
    });
    expect(f.calls).toHaveLength(1);
  });
});
