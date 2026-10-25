import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { routeMain, PREFLIGHT_MS, POLL_MS, REQUEST_CAP, OUTPUT_RESERVE_MS } from './main-preflight.mjs';

const repo = 'owner/game';
const original = 'a'.repeat(40);
const successor = 'b'.repeat(40);
const tree = 'c'.repeat(40);
const identity = { id: 10, full_name: repo };
const ci = { id: 20, path: '.github/workflows/ci.yml', state: 'active' };
const train = { id: 21, path: '.github/workflows/train.yml', state: 'active' };
const PROOF_NOW = Date.parse('2026-10-23T16:00:00Z');
const proofStamp = (offset: number) => new Date(PROOF_NOW + offset).toISOString();
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
    answer?: (path: string) => Json | string | undefined;
  } = {},
) {
  let time = 0;
  let headReads = 0;
  let detailReads = 0;
  const calls: string[] = [];
  const sleeps: number[] = [];
  const chosen = options.run ?? run;
  const read = (path: string): Json | string => {
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
    if (path.endsWith('/actions/runs/40'))
      return {
        id: 40,
        event: 'workflow_dispatch',
        path: train.path,
        head_branch: 'main',
        head_sha: original,
        run_attempt: 1,
        workflow_id: train.id,
        repository: identity,
        head_repository: identity,
      };
    if (path.includes('/actions/runs/40/attempts/1/jobs?'))
      return {
        total_count: 2,
        jobs: [
          {
            id: 41,
            run_id: 40,
            run_attempt: 1,
            name: 'plan',
            status: 'completed',
            conclusion: 'success',
            completed_at: proofStamp(-3000),
          },
          {
            id: 42,
            run_id: 40,
            run_attempt: 1,
            name: 'report',
            status: 'in_progress',
            conclusion: null,
            steps: [
              {
                name: 'Record the tree this train tested',
                number: 2,
                status: 'completed',
                conclusion: 'success',
                started_at: proofStamp(-2000),
                completed_at: proofStamp(-1500),
              },
              {
                name: 'Upload the tested train tree',
                number: 3,
                status: 'completed',
                conclusion: 'success',
                started_at: proofStamp(-1000),
                completed_at: proofStamp(-500),
              },
            ],
          },
        ],
      };
    if (path.endsWith('/actions/jobs/41/logs')) return `${proofStamp(-4000)} tree=${tree}\n`;
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
  const api = (path: string): Promise<Json | string> => Promise.resolve().then(() => read(path));
  return {
    api,
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
        wallNow: () => PROOF_NOW,
        sleep: (ms: number) => {
          sleeps.push(ms);
          time += ms;
          return Promise.resolve();
        },
      }),
  };
}

describe('main preflight preserves acceptance while skipping superseded work', () => {
  it('retries a complete empty descendant observation before fully validating its pending run', async () => {
    const pending = { ...run, status: 'pending' };
    const s = scenario({
      run: pending,
      answer: (p) =>
        p.includes(`/workflows/${ci.id}/runs?`) && s.now() === 0
          ? { total_count: 0, workflow_runs: [] }
          : undefined,
    });
    expect(await s.route()).toMatchObject({ path: 'superseded', skip: false, successor, run: run.id });
    expect(s.sleeps).toEqual([POLL_MS]);
    expect(s.calls.filter((p) => p.endsWith('/branches/main'))).toHaveLength(3);
    expect(s.calls.filter((p) => p.includes('/compare/'))).toHaveLength(2);
    expect(s.calls.filter((p) => p.endsWith(`/actions/runs/${run.id}`))).toHaveLength(3);
    expect(s.calls.length).toBeLessThanOrEqual(REQUEST_CAP);
  });

  it('keeps permanent empty observations unaccepted within the original request and time bounds', async () => {
    const s = scenario({
      answer: (p) =>
        p.includes(`/workflows/${ci.id}/runs?`) ? { total_count: 0, workflow_runs: [] } : undefined,
    });
    expect(await s.route()).toMatchObject({ path: 'full', skip: false, reason: 'request-cap' });
    expect(s.sleeps.length).toBeGreaterThan(0);
    expect(s.calls.some((p) => p.endsWith(`/actions/runs/${run.id}`))).toBe(false);
    expect(s.calls.length).toBeLessThanOrEqual(REQUEST_CAP);
    expect(s.now()).toBeLessThanOrEqual(PREFLIGHT_MS - OUTPUT_RESERVE_MS);
  });

  it.each(['time', 'requests'])('does not start empty-run grace without enough %s', async (budget) => {
    const s = scenario({
      answer: (p) => {
        if (budget === 'requests' && p.includes('/actions/artifacts?')) {
          // Complete proof pages leave too few requests for another descendant decision
          // after the empty successor observation below, rather than exhausting earlier.
          const page = Number(new URL(p, 'https://api.invalid').searchParams.get('page'));
          return {
            total_count: (REQUEST_CAP - 7) * 100,
            artifacts: Array.from({ length: 100 }, (_, i) => ({ id: page * 100 + i, name: 'unrelated' })),
          };
        }
        if (!p.includes(`/workflows/${ci.id}/runs?`)) return undefined;
        if (budget === 'time') s.advance(PREFLIGHT_MS - OUTPUT_RESERVE_MS - POLL_MS);
        return { total_count: 0, workflow_runs: [] };
      },
    });
    expect(await s.route()).toMatchObject({
      path: 'full',
      skip: false,
      reason: budget === 'time' ? 'poll-deadline' : 'request-cap',
    });
    expect(s.calls.filter((p) => p.includes(`/workflows/${ci.id}/runs?`))).toHaveLength(1);
    expect(s.sleeps).toEqual([]);
    expect(s.calls.length).toBeLessThanOrEqual(REQUEST_CAP);
  });

  it('uses newly read main and ancestry if another descendant appears during empty-run grace', async () => {
    const latest = 'd'.repeat(40);
    const s = scenario({
      headAt: () => (s.now() === 0 ? successor : latest),
      run: { ...run, head_sha: latest },
      answer: (p) =>
        p.includes(`/workflows/${ci.id}/runs?`) && s.now() === 0
          ? { total_count: 0, workflow_runs: [] }
          : undefined,
    });
    expect(await s.route()).toMatchObject({ path: 'superseded', skip: false, successor: latest });
    expect(s.calls.some((p) => p.endsWith(`/compare/${original}...${latest}`))).toBe(true);
    expect(s.calls.some((p) => p.includes(`head_sha=${latest}`))).toBe(true);
  });

  it('does not retain stale descendant evidence when main returns to the original during grace', async () => {
    const s = scenario({
      headAt: () => (s.now() === 0 ? successor : original),
      answer: (p) =>
        p.includes(`/workflows/${ci.id}/runs?`) ? { total_count: 0, workflow_runs: [] } : undefined,
    });
    expect(await s.route()).toMatchObject({ path: 'full', skip: false, reason: 'no-eligible-active-train' });
    expect(s.sleeps).toEqual([POLL_MS]);
    expect(s.calls.some((p) => p.endsWith(`/actions/runs/${run.id}`))).toBe(false);
  });

  it('requires proven ancestry again after empty-run grace', async () => {
    const s = scenario({
      answer: (p) => {
        if (p.includes(`/workflows/${ci.id}/runs?`) && s.now() === 0)
          return { total_count: 0, workflow_runs: [] };
        if (p.includes('/compare/') && s.now() > 0) return { status: 'diverged' };
        return undefined;
      },
    });
    expect(await s.route()).toMatchObject({ path: 'full', skip: false, reason: 'unproven-forward-ancestry' });
  });

  it.each([
    { head_sha: original },
    { event: 'pull_request' },
    { workflow_id: 999 },
    { repository: { ...identity, id: 999 } },
    { head_repository: { ...identity, id: 999 } },
    { run_attempt: 0 },
    { status: 'completed', conclusion: 'cancelled' },
    { status: 'completed', conclusion: 'failure' },
  ])('does not relax successor eligibility after an empty observation %j', async (over) => {
    const s = scenario({
      run: { ...run, ...over },
      answer: (p) =>
        p.includes(`/workflows/${ci.id}/runs?`) && s.now() === 0
          ? { total_count: 0, workflow_runs: [] }
          : undefined,
    });
    expect(await s.route()).toMatchObject({ path: 'full', skip: false });
    expect(s.sleeps).toEqual([POLL_MS]);
  });

  it('rejects routing-only success after an empty successor observation', async () => {
    const s = scenario({
      run: { ...run, status: 'completed', conclusion: 'success' },
      answer: (p) => {
        if (p.includes(`/workflows/${ci.id}/runs?`) && s.now() === 0)
          return { total_count: 0, workflow_runs: [] };
        if (p.includes('/jobs?'))
          return {
            total_count: 1,
            jobs: [
              { id: 60, run_id: run.id, name: 'routing summary', status: 'completed', conclusion: 'success' },
            ],
          };
        return undefined;
      },
    });
    expect(await s.route()).toMatchObject({ path: 'full', skip: false, reason: 'successor-gate-not-proven' });
  });

  it.each(['unavailable', 'incomplete', 'changed attempt', 'changed final run', 'changed final main'])(
    'fails closed on %s evidence following empty-run grace',
    async (kind) => {
      const s = scenario({
        headAt: () => (kind === 'changed final main' && s.now() > POLL_MS ? 'd'.repeat(40) : successor),
        detailAt: (read) => {
          if (kind === 'changed attempt') return { ...run, run_attempt: 2 };
          if (kind === 'changed final run' && read > 1)
            return { ...run, status: 'completed', conclusion: 'cancelled' };
          if (kind === 'changed final main' && read === 2) s.advance(1);
          return run;
        },
        answer: (p) => {
          if (!p.includes(`/workflows/${ci.id}/runs?`)) return undefined;
          if (s.now() === 0) return { total_count: 0, workflow_runs: [] };
          if (kind === 'unavailable') throw new Error('API unavailable');
          if (kind === 'incomplete') return { total_count: 1, workflow_runs: [] };
          return undefined;
        },
      });
      expect(await s.route()).toMatchObject({ path: 'full', skip: false });
      expect(s.sleeps).toEqual([POLL_MS]);
      expect(s.calls.length).toBeLessThanOrEqual(REQUEST_CAP);
    },
  );

  it.each(['queued', 'pending'])(
    'fully revalidates a late %s descendant within the existing request cap',
    async (status) => {
      const s = scenario({
        activeTrain: true,
        run: { ...run, status },
        headAt: () => (s.now() < 40_000 ? original : successor),
      });
      expect(await s.route()).toEqual({
        path: 'superseded',
        skip: false,
        successor,
        run: run.id,
        tree,
        reason: 'last-observed eligible descendant CI',
      });
      expect(s.calls.filter((p) => p.endsWith(`/actions/runs/${run.id}`))).toHaveLength(3);
      expect(s.calls.length).toBeLessThanOrEqual(REQUEST_CAP);
      expect(s.now()).toBe(40_000);
    },
  );

  it('reserves the complete successful-descendant gate lookup at the last poll', async () => {
    const s = scenario({
      activeTrain: true,
      run: { ...run, status: 'completed', conclusion: 'success' },
      headAt: () => (s.now() < 80_000 ? original : successor),
    });
    expect(await s.route()).toMatchObject({ path: 'superseded', skip: false });
    expect(s.calls.some((p) => p.includes('/attempts/1/jobs?'))).toBe(true);
    expect(s.calls.length).toBeLessThanOrEqual(REQUEST_CAP);
    expect(s.now()).toBe(80_000);
  });

  it('can validate complete second-page descendant and gate records at the last poll', async () => {
    const complete = { ...run, status: 'completed', conclusion: 'success' };
    const s = scenario({
      activeTrain: true,
      run: complete,
      headAt: () => (s.now() < 80_000 ? original : successor),
      answer: (p) => {
        if (p.includes(`/workflows/${ci.id}/runs?`))
          return {
            total_count: 101,
            workflow_runs: p.endsWith('page=2')
              ? [complete]
              : Array.from({ length: 100 }, (_, i) => ({
                  ...complete,
                  id: i + 100,
                  created_at: '2026-10-19T18:00:00Z',
                })),
          };
        if (p.includes('/jobs?'))
          return {
            total_count: 101,
            jobs: p.endsWith('page=2')
              ? [
                  {
                    id: 60,
                    run_id: run.id,
                    run_attempt: 1,
                    name: 'gate',
                    status: 'completed',
                    conclusion: 'success',
                  },
                ]
              : Array.from({ length: 100 }, (_, i) => ({
                  id: i + 100,
                  run_id: run.id,
                  run_attempt: 1,
                  name: `routing ${i}`,
                  status: 'completed',
                  conclusion: 'success',
                })),
          };
        return undefined;
      },
    });
    expect(await s.route()).toMatchObject({ path: 'superseded', skip: false });
    expect(s.calls).toHaveLength(REQUEST_CAP);
    expect(s.calls.filter((p) => p.endsWith(`/actions/runs/${run.id}`))).toHaveLength(3);
  });

  it.each(['changed total', 'duplicate', 'request cap'])(
    'fails closed on late successor pagination uncertainty: %s',
    async (kind) => {
      const s = scenario({
        activeTrain: true,
        headAt: () => (s.now() < 80_000 ? original : successor),
        answer: (p) => {
          if (!p.includes(`/workflows/${ci.id}/runs?`)) return undefined;
          const page = Number(new URL(p, 'https://api.invalid').searchParams.get('page'));
          return {
            total_count: kind === 'request cap' ? 1001 : kind === 'changed total' && page === 2 ? 102 : 101,
            workflow_runs:
              page === 1 || kind === 'request cap'
                ? Array.from({ length: 100 }, (_, i) => ({ ...run, id: page * 100 + i }))
                : [{ ...run, id: 100 }],
          };
        },
      });
      expect(await s.route()).toMatchObject({
        path: 'full',
        skip: false,
        reason: kind === 'request cap' ? 'request-cap' : 'lookup-failed',
      });
      expect(s.calls.length).toBeLessThanOrEqual(REQUEST_CAP);
    },
  );

  it('still checks for an exact proof published while the observed train finishes', async () => {
    const s = scenario({
      head: original,
      activeTrain: true,
      answer: (p) =>
        p.includes('/actions/artifacts?') && s.now() >= 40_000
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
          : undefined,
    });
    expect(await s.route()).toMatchObject({ path: 'tested', skip: true });
    expect(s.now()).toBeLessThanOrEqual(PREFLIGHT_MS - OUTPUT_RESERVE_MS);
    expect(s.calls.length).toBeLessThanOrEqual(REQUEST_CAP);
  });

  it('distinguishes request allowance, polling deadline and lookup failure without raw errors', async () => {
    const capped = scenario({
      answer: (p) => {
        if (!p.includes('/actions/artifacts?')) return undefined;
        const page = Number(new URL(p, 'https://api.invalid').searchParams.get('page'));
        return {
          total_count: REQUEST_CAP * 100 + 1,
          artifacts: Array.from({ length: 100 }, (_, i) => ({ id: page * 100 + i, name: 'unrelated' })),
        };
      },
    });
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

  it('passes raw log reads through the same abort-aware, body-consuming request boundary', async () => {
    const s = scenario({ proof: true });
    const observations: { path: string; signal: AbortSignal; raw: boolean }[] = [];
    const result = await routeMain({
      sha: original,
      tree,
      repo,
      now: () => 0,
      wallNow: () => PROOF_NOW,
      api: (path: string, signal: AbortSignal, options: { raw: boolean }) => {
        observations.push({ path, signal, raw: options.raw });
        return s.api(path);
      },
    });
    expect(result).toMatchObject({ path: 'tested', skip: true });
    const logs = observations.filter((o) => o.path.endsWith('/logs'));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ raw: true });
    expect(logs[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(observations.filter((o) => !o.path.endsWith('/logs')).every((o) => !o.raw)).toBe(true);
  });

  it('aborts an unfinished text-log response within the existing request deadline', async () => {
    vi.useFakeTimers();
    try {
      const s = scenario({ proof: true });
      let logSignal: AbortSignal | undefined;
      const pending = routeMain({
        sha: original,
        tree,
        repo,
        now: () => Date.now(),
        wallNow: () => PROOF_NOW,
        api: (path: string, signal: AbortSignal) => {
          if (path.endsWith('/logs')) {
            logSignal = signal;
            return new Promise(() => {});
          }
          return s.api(path);
        },
      });
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ path: 'full', reason: 'request-deadline' });
      expect(logSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
    { status: 'completed', conclusion: 'failure' },
    { status: 'pending', conclusion: 'success' },
    { status: 'waiting' },
    { status: 'requested' },
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

  it.each([
    { status: 'completed', conclusion: 'cancelled' },
    { status: 'completed', conclusion: 'failure' },
    { run_attempt: 2 },
    { workflow_id: 999 },
    { head_repository: { ...identity, id: 999 } },
  ])('fails closed when a late pending descendant changes during revalidation %j', async (over) => {
    const pending = { ...run, status: 'pending' };
    const s = scenario({
      activeTrain: true,
      run: pending,
      headAt: () => (s.now() < 40_000 ? original : successor),
      detailAt: (read) => (read > 1 ? { ...pending, ...over } : pending),
    });
    expect(await s.route()).toMatchObject({
      path: 'full',
      skip: false,
      reason: 'successor-revalidation-unproven',
    });
    expect(s.calls.length).toBeLessThanOrEqual(REQUEST_CAP);
  });

  it('does not supersede when main changes again after the late descendant lookup', async () => {
    const s = scenario({
      activeTrain: true,
      headAt: (read) => (s.now() < 40_000 ? original : read > 5 ? 'd'.repeat(40) : successor),
    });
    expect(await s.route()).toMatchObject({
      path: 'full',
      skip: false,
      reason: 'successor-revalidation-unproven',
    });
  });

  it('does not accept a stale train observation when it ends without a merge or exact proof', async () => {
    const s = scenario({ head: original, activeTrain: true });
    expect(await s.route()).toMatchObject({ path: 'full', skip: false, reason: 'poll-deadline' });
    expect(s.now()).toBe(80_000);
    expect(s.calls.filter((p) => p.includes(`/workflows/${train.id}/runs?`))).toHaveLength(2);
    expect(s.calls.filter((p) => p.includes('/actions/artifacts?'))).toHaveLength(2);
  });

  it('fails closed on an API error during late descendant revalidation', async () => {
    let details = 0;
    const s = scenario({
      activeTrain: true,
      headAt: () => (s.now() < 40_000 ? original : successor),
      before: (p) => {
        if (p.endsWith(`/actions/runs/${run.id}`) && ++details === 2) throw new Error('API unavailable');
      },
    });
    expect(await s.route()).toMatchObject({ path: 'full', skip: false, reason: 'lookup-failed' });
  });

  it('requires an unchanged attempt between successor listing and its first detail read', async () => {
    const s = scenario({ detailAt: () => ({ ...run, run_attempt: 2 }) });
    expect(await s.route()).toMatchObject({
      path: 'full',
      skip: false,
      reason: 'successor-metadata-mismatch',
    });
  });

  it('reports unproven revalidation for malformed successor metadata', async () => {
    const s = scenario({ detailAt: (read) => (read > 1 ? {} : run) });
    expect(await s.route()).toMatchObject({
      path: 'full',
      skip: false,
      reason: 'successor-revalidation-unproven',
    });
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
