// Main skips its suite only for a tree a green PR run tested, and gate accepts the skipped suite
// on that path alone (docs/engineering.md, "CI on GitHub Actions"; scripts/tested-tree.mjs).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_PREFIX,
  PROD_BUILD,
  SUITE,
  artifactName,
  candidates,
  decide,
  gateVerdict,
} from './tested-tree.mjs';

// The tree of #415's tested merge commit a149794 and of its squash 6c85ce4 (equal, checked on
// 2026-10-03 against the PR run's checkout log and `git rev-parse 6c85ce4^{tree}`).
const TREE = 'e4d5f9cffe2f2bf874375a01513e46bc58258c6c';
const REPO_ID = 1396654584;
const REPO = 'owner/throttlebrawl';

/** An artifact as `GET /repos/{repo}/actions/artifacts?name=` lists it (shape read from the real API). */
function artifact(over: Record<string, unknown> = {}, run: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: `${ARTIFACT_PREFIX}${TREE}`,
    expired: false,
    created_at: '2026-10-03T20:30:00Z',
    workflow_run: { id: 37151625352, repository_id: REPO_ID, head_repository_id: REPO_ID, ...run },
    ...over,
  };
}

const PR_RUN = {
  id: 37151625352,
  event: 'pull_request',
  path: '.github/workflows/ci.yml',
  html_url: 'https://example.invalid/run',
};

/** A fake GitHub API: the artifacts listing and runs by id. */
function api(artifacts: unknown[], runs: Record<number, unknown> = { [PR_RUN.id]: PR_RUN }) {
  const calls: string[] = [];
  const get = (p: string): Promise<unknown> => {
    calls.push(p);
    if (p.includes('/actions/artifacts?'))
      return Promise.resolve({ total_count: artifacts.length, artifacts });
    const m = /\/actions\/runs\/(\d+)$/.exec(p);
    if (m && runs[Number(m[1])]) return Promise.resolve(runs[Number(m[1])]);
    return Promise.reject(new Error(`GitHub API 404 for ${p}`));
  };
  return { get, calls };
}

describe('artifactName', () => {
  it('names the tree in full', () => {
    expect(artifactName(TREE)).toBe(`tested-tree-${TREE}`);
  });
  it('refuses anything but a full tree id', () => {
    expect(() => artifactName('e4d5f9c')).toThrow();
    expect(() => artifactName('')).toThrow();
  });
});

describe('candidates', () => {
  it('keeps a same-repo, unexpired record of exactly this tree', () => {
    expect(candidates([artifact()], TREE)).toHaveLength(1);
  });
  it("drops a fork's run, an expired record and another tree's record", () => {
    expect(candidates([artifact({}, { head_repository_id: 42 })], TREE)).toHaveLength(0);
    expect(candidates([artifact({ expired: true })], TREE)).toHaveLength(0);
    expect(candidates([artifact({ name: `${ARTIFACT_PREFIX}${'a'.repeat(40)}` })], TREE)).toHaveLength(0);
    expect(candidates([artifact({ name: 'dist' })], TREE)).toHaveLength(0);
  });
});

describe('decide', () => {
  it('skips the suite when a green PR run of ci.yml recorded this tree', async () => {
    const { get, calls } = api([artifact()]);
    const d = await decide(TREE, { repo: REPO, api: get });
    expect(d.skip).toBe(true);
    expect(d.reason).toContain('37151625352');
    expect(calls[0]).toBe(`/repos/${REPO}/actions/artifacts?name=tested-tree-${TREE}&per_page=100`);
  });

  it('runs the suite when no PR run recorded the tree (main moved, so the merged tree is new)', async () => {
    const { get } = api([]);
    expect((await decide(TREE, { repo: REPO, api: get })).skip).toBe(false);
  });

  it('runs the suite on any API error', async () => {
    const failing = () => Promise.reject(new Error('GitHub API 502'));
    const d = await decide(TREE, { repo: REPO, api: failing });
    expect(d.skip).toBe(false);
    expect(d.reason).toContain('502');
    // The run lookup failing is the same answer.
    const { get } = api([artifact()], {});
    expect((await decide(TREE, { repo: REPO, api: get })).skip).toBe(false);
  });

  it('only a pull_request run of ci.yml vouches: not a push run, not another workflow', async () => {
    for (const run of [
      { ...PR_RUN, event: 'push' },
      { ...PR_RUN, path: '.github/workflows/other.yml' },
    ]) {
      const { get } = api([artifact()], { [PR_RUN.id]: run });
      expect((await decide(TREE, { repo: REPO, api: get })).skip).toBe(false);
    }
  });

  it('a later record vouches when the newest one does not', async () => {
    const older = artifact({ id: 2, created_at: '2026-10-03T19:00:00Z' }, { id: 7 });
    const newer = artifact({ id: 3, created_at: '2026-10-03T21:00:00Z' }, { id: 8 });
    const { get, calls } = api([older, newer], {
      7: { ...PR_RUN, id: 7 },
      8: { ...PR_RUN, id: 8, event: 'push' },
    });
    expect((await decide(TREE, { repo: REPO, api: get })).skip).toBe(true);
    expect(calls.slice(1)).toEqual([`/repos/${REPO}/actions/runs/8`, `/repos/${REPO}/actions/runs/7`]);
  });
});

type Needs = Record<string, { result?: string; outputs?: Record<string, string> }>;
const suitePath = (over: Needs = {}): Needs => ({
  plan: { result: 'success', outputs: { skip: 'false' } },
  'static-unit': { result: 'success' },
  sim: { result: 'success' },
  browser: { result: 'success' },
  'prod-build': { result: 'skipped' },
  ...over,
});
const skipPath = (over: Needs = {}): Needs => ({
  plan: { result: 'success', outputs: { skip: 'true' } },
  'static-unit': { result: 'skipped' },
  sim: { result: 'skipped' },
  browser: { result: 'skipped' },
  'prod-build': { result: 'success' },
  ...over,
});

describe('gateVerdict', () => {
  it('is green on a PR: plan skipped, the suite green', () => {
    const v = gateVerdict(suitePath({ plan: { result: 'skipped', outputs: {} } }));
    expect(v).toMatchObject({ ok: true, path: 'suite' });
  });

  it('is green on a main push that ran the suite', () => {
    expect(gateVerdict(suitePath())).toMatchObject({ ok: true, path: 'suite' });
  });

  it('is green on the skip path: plan said skip, suite skipped, prod-build green', () => {
    expect(gateVerdict(skipPath())).toMatchObject({ ok: true, path: 'skip' });
  });

  it('fails a failed, cancelled or skipped suite job on the suite path', () => {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      for (const job of SUITE) {
        const v = gateVerdict(suitePath({ [job]: { result } }));
        expect(v.ok, `${job} ${result}`).toBe(false);
        expect(v.problems.join(' ')).toContain(job);
      }
    }
  });

  it('a skipped suite passes only when plan ran green and said skip=true', () => {
    const skipped = {
      'static-unit': { result: 'skipped' },
      sim: { result: 'skipped' },
      browser: { result: 'skipped' },
    };
    // A PR whose suite was skipped (for example, cancelled before it started) is red.
    expect(gateVerdict(suitePath({ ...skipped, plan: { result: 'skipped', outputs: {} } })).ok).toBe(false);
    // plan failed: its jobs were skipped as dependents, which is not the skip path.
    expect(gateVerdict(suitePath({ ...skipped, plan: { result: 'failure', outputs: {} } })).ok).toBe(false);
    expect(
      gateVerdict(suitePath({ ...skipped, plan: { result: 'cancelled', outputs: { skip: 'true' } } })).ok,
    ).toBe(false);
    // plan said no: the suite must have run.
    expect(gateVerdict(suitePath({ ...skipped })).ok).toBe(false);
  });

  it('fails the skip path when prod-build failed, was cancelled or did not run', () => {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      expect(gateVerdict(skipPath({ [PROD_BUILD]: { result } })).ok, result).toBe(false);
    }
    expect(gateVerdict(skipPath({ [PROD_BUILD]: {} })).ok).toBe(false);
  });

  it('fails the skip path when a suite job ran anyway, red or green', () => {
    expect(gateVerdict(skipPath({ sim: { result: 'failure' } })).ok).toBe(false);
    expect(gateVerdict(skipPath({ sim: { result: 'success' } })).ok).toBe(false);
  });

  it('fails a missing job', () => {
    const needs = suitePath();
    delete needs.browser;
    expect(gateVerdict(needs).ok).toBe(false);
    expect(gateVerdict({}).ok).toBe(false);
  });
});

describe('ci.yml wiring', () => {
  const ci = readFileSync(path.join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

  it("gate needs every job its verdict reads, so none can drop out of the gate's view", () => {
    const m = /\n {2}gate:\n(?: {4}.*\n)*? {4}needs: \[([^\]]*)\]/.exec(ci);
    expect(m, 'gate needs: line').not.toBeNull();
    const needs = (m?.[1] ?? '').split(',').map((s) => s.trim());
    expect(needs.sort()).toEqual(['plan', ...SUITE, PROD_BUILD].sort());
  });

  it('every suite job and prod-build waits on plan, and deploy-prod still needs gate', () => {
    for (const job of [...SUITE, PROD_BUILD]) {
      const block = new RegExp(`\\n {2}${job}:\\n(?: {4}.*\\n)*? {4}needs: \\[plan\\]`);
      expect(block.test(ci), job).toBe(true);
    }
    expect(/\n {2}deploy-prod:\n(?: {4}.*\n)*? {4}needs: \[gate\]/.test(ci)).toBe(true);
  });
});
