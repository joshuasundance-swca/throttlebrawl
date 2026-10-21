import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { routeMain, PREFLIGHT_MS, REQUEST_CAP, OUTPUT_RESERVE_MS } from './main-preflight.mjs';

const repo = 'owner/game';
const original = 'a'.repeat(40);
const successor = 'b'.repeat(40);
const tree = 'c'.repeat(40);
const identity = { id: 10, full_name: repo };
const ci = { id: 20, path: '.github/workflows/ci.yml', state: 'active' };
const train = { id: 21, path: '.github/workflows/train.yml', state: 'active' };
const run = {
  id: 30,
  workflow_id: ci.id,
  path: ci.path,
  event: 'push',
  head_branch: 'main',
  head_sha: successor,
  repository: identity,
  head_repository: identity,
  status: 'queued',
  conclusion: null,
  run_attempt: 1,
  created_at: '2026-10-20T18:00:00Z',
};

type Json = Record<string, unknown>;
function scenario(
  options: {
    head?: string;
    run?: Json;
    compare?: Json;
    proof?: boolean;
    activeTrain?: boolean;
    before?: (path: string, calls: string[]) => void;
    headAt?: (read: number) => string;
    detailAt?: (read: number) => Json;
    answer?: (path: string) => Json | undefined;
  } = {},
) {
  let time = 0;
  let headReads = 0;
  let detailReads = 0;
  const calls: string[] = [];
  const sleeps: number[] = [];
  const chosen = options.run ?? run;
  const read = (path: string): Json => {
    calls.push(path);
    options.before?.(path, calls);
    const answer = options.answer?.(path);
    if (answer) return answer;
    if (path.includes('/actions/artifacts?'))
      return options.proof
        ? {
            total_count: 1,
            artifacts: [
              {
                id: 1,
                name: `tested-tree-${tree}`,
                expired: false,
                workflow_run: { id: 40, repository_id: 10, head_repository_id: 10 },
              },
            ],
          }
        : { total_count: 0, artifacts: [] };
    if (path.endsWith('/actions/runs/40')) return { id: 40, event: 'pull_request', path: ci.path };
    if (path === `/repos/${repo}`) return identity;
    if (path.endsWith('/actions/workflows/ci.yml')) return ci;
    if (path.endsWith('/actions/workflows/train.yml')) return train;
    if (path.endsWith('/branches/main')) {
      headReads++;
      return { name: 'main', commit: { sha: options.headAt?.(headReads) ?? options.head ?? successor } };
    }
    if (path.includes('/compare/'))
      return (
        options.compare ?? {
          status: 'ahead',
          ahead_by: 1,
          behind_by: 0,
          base_commit: { sha: original },
          merge_base_commit: { sha: original },
        }
      );
    if (path.includes(`/actions/workflows/${ci.id}/runs?`))
      return { total_count: 1, workflow_runs: [chosen] };
    if (path.includes(`/actions/workflows/${train.id}/runs?`)) {
      const active = options.activeTrain && path.includes('status=in_progress');
      return {
        total_count: active ? 1 : 0,
        workflow_runs: active
          ? [
              {
                ...run,
                id: 50,
                workflow_id: train.id,
                path: train.path,
                event: 'workflow_run',
                head_sha: original,
                status: 'in_progress',
              },
            ]
          : [],
      };
    }
    if (path.endsWith(`/actions/runs/${String(chosen.id)}`)) {
      detailReads++;
      return options.detailAt?.(detailReads) ?? chosen;
    }
    if (path.includes('/attempts/1/jobs?'))
      return {
        total_count: 1,
        jobs: [
          {
            id: 60,
            run_id: chosen.id,
            run_attempt: 1,
            name: 'gate',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      };
    throw new Error(`unexpected GET ${path}`);
  };
  const api = (path: string): Promise<Json> => Promise.resolve().then(() => read(path));
  return {
    calls,
    sleeps,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
    route: () =>
      routeMain({
        sha: original,
        tree,
        repo,
        api,
        now: () => time,
        sleep: (ms: number) => {
          sleeps.push(ms);
          time += ms;
          return Promise.resolve();
        },
      }),
  };
}

describe('main preflight preserves acceptance while skipping superseded work', () => {
  it('distinguishes request allowance, polling deadline and lookup failure without raw errors', async () => {
    const capped = scenario({ head: original, activeTrain: true });
    expect(await capped.route()).toMatchObject({ path: 'full', skip: false, reason: 'request-cap' });
    expect(capped.calls).toHaveLength(REQUEST_CAP);
    const deadline = scenario({ before: () => deadline.advance(PREFLIGHT_MS) });
    expect(await deadline.route()).toMatchObject({ path: 'full', reason: 'deadline' });
    const polling = scenario({
      head: original,
      activeTrain: true,
      before: (_, calls) => {
        if (calls.length === 7) polling.advance(80_000);
      },
    });
    expect(await polling.route()).toMatchObject({ path: 'full', reason: 'poll-deadline' });
    expect(polling.sleeps).toEqual([]);
    const failed = scenario({
      before: () => {
        throw new Error('private API response');
      },
    });
    expect(await failed.route()).toMatchObject({ path: 'full', reason: 'lookup-failed' });
    expect(await scenario({ head: original }).route()).toMatchObject({ reason: 'no-eligible-active-train' });
    expect(await scenario({ run: { ...run, event: 'pull_request' } }).route()).toMatchObject({
      path: 'full',
      reason: 'successor-eligibility-unproven',
    });
  });
  it.each([
    { expired: undefined },
    { expired: null },
    { workflow_run: { id: 40, repository_id: null, head_repository_id: null } },
  ])('does not accept malformed exact-proof metadata %j', async (over) => {
    const s = scenario({
      head: original,
      answer: (p) =>
        p.includes('/actions/artifacts?')
          ? {
              total_count: 1,
              artifacts: [
                {
                  id: 1,
                  name: `tested-tree-${tree}`,
                  expired: false,
                  workflow_run: { id: 40, repository_id: 10, head_repository_id: 10 },
                  ...over,
                },
              ],
            }
          : undefined,
    });
    expect(await s.route()).toMatchObject({ path: 'full', skip: false });
  });
  it('takes an existing exact proof immediately, even for an older accepted commit', async () => {
    const s = scenario({ proof: true });
    expect(await s.route()).toMatchObject({ path: 'tested', skip: true });
    expect(s.calls.some((p) => p.endsWith('/branches/main'))).toBe(false);
    expect(s.sleeps).toEqual([]);
  });

  it('leaves current unrecorded main on its full backstop without a train', async () => {
    const s = scenario({ head: original });
    expect(await s.route()).toMatchObject({ path: 'full', skip: false });
    expect(s.sleeps).toEqual([]);
  });

  it('identifies a queued exact successor without accepting the old tree', async () => {
    const s = scenario();
    expect(await s.route()).toMatchObject({ path: 'superseded', skip: false, successor, run: run.id });
    expect(s.calls.filter((p) => p.endsWith(`/actions/runs/${run.id}`)).length).toBeGreaterThan(1);
  });

  it.each([
    { head_sha: original },
    { event: 'pull_request' },
    { head_branch: 'topic' },
    { workflow_id: 999 },
    { path: '.github/workflows/other.yml' },
    { repository: { ...identity, id: 999 } },
    { head_repository: { ...identity, id: 999 } },
    { status: 'completed', conclusion: 'cancelled' },
    { status: 'unknown' },
    { run_attempt: 0 },
  ])('does not trust mismatched or unsupported successor metadata %j', async (over) => {
    expect(await scenario({ run: { ...run, ...over } }).route()).toMatchObject({ path: 'full', skip: false });
  });

  it.each(['identical', 'behind', 'diverged'])('requires proven forward ancestry (%s)', async (status) => {
    expect(await scenario({ compare: { status } }).route()).toMatchObject({ path: 'full' });
  });

  it('accepts a completed successor only through its actual successful gate', async () => {
    const s = scenario({ run: { ...run, status: 'completed', conclusion: 'success' } });
    expect(await s.route()).toMatchObject({ path: 'superseded' });
    expect(s.calls.some((p) => p.includes('/attempts/1/jobs?'))).toBe(true);
  });

  it('falls back when movement or cancellation is observed during final revalidation', async () => {
    expect(
      await scenario({ headAt: (read) => (read > 1 ? 'd'.repeat(40) : successor) }).route(),
    ).toMatchObject({ path: 'full' });
    expect(
      await scenario({
        detailAt: (read) => (read > 1 ? { ...run, status: 'completed', conclusion: 'cancelled' } : run),
      }).route(),
    ).toMatchObject({ path: 'full' });
  });

  it('ends a stalled-train delay at the original deadline or request cap', async () => {
    const s = scenario({ head: original, activeTrain: true });
    expect(await s.route()).toMatchObject({ path: 'full' });
    expect(s.sleeps.length).toBeGreaterThan(0);
    expect(s.now()).toBeLessThanOrEqual(PREFLIGHT_MS - OUTPUT_RESERVE_MS);
    expect(s.calls.length).toBeLessThanOrEqual(REQUEST_CAP);
  });

  it('uses full acceptance on API errors instead of seeking another skip reason', async () => {
    const s = scenario({
      before: () => {
        throw new Error('API unavailable');
      },
    });
    expect(await s.route()).toMatchObject({ path: 'full' });
    expect(s.calls).toHaveLength(1);
  });

  it('bounds a response that never settles without waiting on real time', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const result = routeMain({
        sha: original,
        tree,
        repo,
        now: () => Date.now(),
        sleep: () => Promise.resolve(),
        api: (_: string, abort: AbortSignal) => {
          signal = abort;
          return new Promise(() => {});
        },
      });
      await vi.runAllTimersAsync();
      expect(await result).toMatchObject({ path: 'full', reason: 'request-deadline' });
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { base_commit: { sha: successor } },
    { merge_base_commit: { sha: successor } },
    { ahead_by: 0 },
    { behind_by: 1 },
    { ahead_by: 1.5 },
  ])('rejects inconsistent ancestry details %j', async (over) => {
    const s = scenario({
      compare: {
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        base_commit: { sha: original },
        merge_base_commit: { sha: original },
        ...over,
      },
    });
    expect(await s.route()).toMatchObject({ path: 'full' });
  });

  it.each(
    [
      [],
      [{ id: 60, run_id: run.id, name: 'routing summary', status: 'completed', conclusion: 'success' }],
      [{ id: 60, run_id: run.id, name: 'gate', status: 'completed', conclusion: 'skipped' }],
      [{ id: 60, run_id: run.id, run_attempt: 2, name: 'gate', status: 'completed', conclusion: 'success' }],
    ].map((jobs) => ({ jobs })),
  )('requires actual acceptance in the same attempt, not successful routing (%j)', async ({ jobs }) => {
    const s = scenario({
      run: { ...run, status: 'completed', conclusion: 'success' },
      answer: (p) => (p.includes('/jobs?') ? { total_count: jobs.length, jobs } : undefined),
    });
    expect(await s.route()).toMatchObject({ path: 'full' });
  });

  it('does not hide a newer failed run behind an old successful one', async () => {
    const failed = {
      ...run,
      id: 31,
      created_at: '2026-10-20T18:01:00Z',
      status: 'completed',
      conclusion: 'failure',
    };
    const s = scenario({
      run: failed,
      answer: (p) =>
        p.includes(`/workflows/${ci.id}/runs?`)
          ? {
              total_count: 2,
              workflow_runs: [{ ...run, status: 'completed', conclusion: 'success' }, failed],
            }
          : undefined,
    });
    expect(await s.route()).toMatchObject({ path: 'full' });
  });

  it('refuses incomplete successor pages instead of claiming latest', async () => {
    const s = scenario({
      answer: (p) =>
        p.includes(`/workflows/${ci.id}/runs?`) ? { total_count: 2, workflow_runs: [run] } : undefined,
    });
    expect(await s.route()).toMatchObject({ path: 'full' });
  });

  it('stops after a malformed proof collection, without seeking supersession', async () => {
    const s = scenario({
      answer: (p) => (p.includes('/actions/artifacts?') ? { total_count: 1, artifacts: [] } : undefined),
    });
    expect(await s.route()).toMatchObject({ path: 'full' });
    expect(s.calls).toHaveLength(1);
  });

  it('finds an exact proof on a complete second page', async () => {
    const s = scenario({
      answer: (p) => {
        if (!p.includes('/actions/artifacts?')) return undefined;
        return {
          total_count: 101,
          artifacts: p.endsWith('page=2')
            ? [
                {
                  id: 1,
                  name: `tested-tree-${tree}`,
                  expired: false,
                  workflow_run: { id: 40, repository_id: 10, head_repository_id: 10 },
                },
              ]
            : Array.from({ length: 100 }, (_, i) => ({ id: i + 2, name: 'unrelated' })),
        };
      },
    });
    expect(await s.route()).toMatchObject({ path: 'tested', skip: true });
    expect(s.calls.filter((p) => p.includes('/actions/artifacts?'))).toHaveLength(2);
    expect(s.calls.some((p) => p.endsWith('/branches/main'))).toBe(false);
  });

  it('does not trust a changed successor attempt', async () => {
    const s = scenario({ detailAt: (read) => ({ ...run, run_attempt: read > 1 ? 2 : 1 }) });
    expect(await s.route()).toMatchObject({ path: 'full' });
  });

  it('fails closed on duplicate or incomplete latest-attempt job pages', async () => {
    const gate = {
      id: 60,
      run_id: run.id,
      run_attempt: 1,
      name: 'gate',
      status: 'completed',
      conclusion: 'success',
    };
    for (const jobs of [
      { total_count: 2, jobs: [gate] },
      { total_count: 2, jobs: [gate, gate] },
    ]) {
      const s = scenario({
        run: { ...run, status: 'completed', conclusion: 'success' },
        answer: (p) => (p.includes('/jobs?') ? jobs : undefined),
      });
      expect(await s.route()).toMatchObject({ path: 'full' });
    }
  });

  it('does not extend the original budget when an API body consumes the remaining time', async () => {
    const s = scenario({ before: () => s.advance(PREFLIGHT_MS) });
    expect(await s.route()).toMatchObject({ path: 'full' });
    expect(s.calls).toHaveLength(1);
  });

  it('CLI with no token falls back full without requiring git or gh on PATH', () => {
    const out = execFileSync(
      process.execPath,
      [new URL('./main-preflight.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          GH_TOKEN: '',
          GITHUB_TOKEN: '',
          GITHUB_SHA: original,
          GITHUB_REPOSITORY: repo,
          PATH: '',
          GITHUB_OUTPUT: '',
        },
      },
    );
    expect(out.trim()).toBe('main preflight: full\nmain preflight reason: missing-token');
  });

  it('CLI exposes a fixed lookup reason without thrown API text', () => {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const script = new URL('./main-preflight.mjs', import.meta.url);
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `globalThis.fetch = () => { throw new Error('private API response'); }; process.argv[1] = ${JSON.stringify(script.pathname.replace(/^\/(\w:)/, '$1'))}; await import(${JSON.stringify(script.href)});`,
      ],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          GH_TOKEN: 'test-placeholder',
          GITHUB_SHA: sha,
          GITHUB_REPOSITORY: repo,
          GITHUB_OUTPUT: '',
        },
      },
    );
    expect(out.trim()).toBe('main preflight: full\nmain preflight reason: lookup-failed');
  });
});
