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
const suite = (result: string): Needs => Object.fromEntries(SUITE.map((job) => [job, { result }]));
const suitePath = (over: Needs = {}): Needs => ({
  plan: { result: 'success', outputs: { skip: 'false' } },
  route: { result: 'skipped' },
  ...suite('success'),
  'prod-build': { result: 'skipped' },
  ...over,
});
const skipPath = (over: Needs = {}): Needs => ({
  plan: { result: 'success', outputs: { skip: 'true' } },
  route: { result: 'skipped' },
  ...suite('skipped'),
  'prod-build': { result: 'success' },
  ...over,
});

describe('gateVerdict', () => {
  it('is green on a PR: plan skipped, route green, the suite green', () => {
    const v = gateVerdict(
      suitePath({ plan: { result: 'skipped', outputs: {} }, route: { result: 'success' } }),
    );
    expect(v).toMatchObject({ ok: true, path: 'suite' });
  });

  it('fails a PR whose route failed or was cancelled, even with the suite green', () => {
    for (const result of ['failure', 'cancelled']) {
      const v = gateVerdict(suitePath({ plan: { result: 'skipped', outputs: {} }, route: { result } }));
      expect(v.ok, result).toBe(false);
      expect(v.problems.join(' ')).toContain('route');
    }
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
    const skipped = suite('skipped');
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
    expect(gateVerdict(skipPath({ suite: { result: 'failure' } })).ok).toBe(false);
    expect(gateVerdict(skipPath({ suite: { result: 'success' } })).ok).toBe(false);
  });

  it('fails a missing job', () => {
    const needs = suitePath();
    delete needs.suite;
    expect(gateVerdict(needs).ok).toBe(false);
    expect(gateVerdict({}).ok).toBe(false);
  });
});

describe('ci.yml wiring', () => {
  const ci = readFileSync(path.join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

  it("the aggregate (gate) needs every job its verdict reads, so none can drop out of the gate's view", () => {
    const m = /\n {2}aggregate:\n(?: {4}.*\n)*? {4}needs: \[([^\]]*)\]/.exec(ci);
    expect(m, 'aggregate needs: line').not.toBeNull();
    const needs = (m?.[1] ?? '').split(',').map((s) => s.trim());
    expect(needs.sort()).toEqual(['plan', 'route', ...SUITE, PROD_BUILD].sort());
  });

  it('the suite waits on plan and route, prod-build on plan, and deploy-prod still needs the aggregate', () => {
    const wants: [string, string][] = [
      ...SUITE.map((job): [string, string] => [job, 'plan, route']),
      [PROD_BUILD, 'plan'],
      ['deploy-prod', 'aggregate'],
    ];
    for (const [job, needs] of wants) {
      const block = new RegExp(`\\n {2}${job}:\\n(?: {4}.*\\n)*? {4}needs: \\[${needs}\\]`);
      expect(block.test(ci), job).toBe(true);
    }
  });

  // A job skipped by its own `if:` is always upstream of deploy-prod and release now (prod-build on
  // the suite path, the suite on the skip path). A job `if:` without a status function gets an
  // implicit success(), which reads every ancestor and skips the job (GitHub docs, `needs`;
  // actions/runner#2205). So every job that needs another must open its `if:` with one.
  const jobs = () => {
    const body = ci.slice(ci.indexOf('\njobs:\n'));
    return [...body.matchAll(/^ {2}([\w-]+):\n((?:(?: {4}.*)?\n)*)/gm)].map(([, name, block]) => ({
      name: name ?? '',
      // Job level only: exactly four spaces, so a step's `if:` (eight) never matches.
      needs: /^ {4}needs: (.+)$/m.exec(block ?? '')?.[1],
      cond: /^ {4}if: (.+)$/m.exec(block ?? '')?.[1],
    }));
  };

  it('every job that needs another opens its if: with a status function, so a skipped ancestor never skips it', () => {
    const list = jobs();
    expect(list.map((j) => j.name)).toEqual(
      expect.arrayContaining(['plan', 'route', ...SUITE, PROD_BUILD, 'aggregate', 'deploy-prod', 'release']),
    );
    for (const job of list.filter((j) => j.needs)) {
      expect(job.cond, `${job.name} has an if:`).toBeDefined();
      expect(job.cond, job.name).toMatch(/^(?:\$\{\{ )?(?:!cancelled\(\) && |always\(\)(?: \}\})?$)/);
    }
  });

  // Fail fast on a PR (docs/engineering.md, "Fail fast on a PR"): the first red suite job cancels
  // the rest of its PR run, so a red PR stops holding runner slots other PRs need. A push to main
  // keeps running every job (a red slice never hides another's result there, and rerun-main
  // re-runs only the failed ones). The gate still reads a cancelled job as red. The suite's jobs
  // live in suite.yml, shared with the bundle train, which must never cancel its own run (its
  // control and report jobs come after the suite): so fail fast is an input only ci.yml sets.
  const wf = (name: string) =>
    readFileSync(path.join(import.meta.dirname, '..', '.github', 'workflows', name), 'utf8');
  const suite = wf('suite.yml');
  const train = wf('train.yml');
  const blockIn = (text: string, job: string) =>
    new RegExp(`\\n {2}${job}:\\n((?:(?: {4}.*)?\\n)*)`).exec(text)?.[1] ?? '';
  const jobBlock = (job: string) => blockIn(ci, job);
  const SUITE_JOBS = ['static', 'unit', 'sim', 'browser'];

  it('on a PR, a red suite job cancels the rest of its run, as its last step', () => {
    for (const job of SUITE_JOBS) {
      const block = blockIn(suite, job);
      expect(block, job).not.toBe('');
      // No permissions of its own: the job gets its caller's token (ci.yml grants actions: write).
      expect(block, `${job} permissions`).not.toMatch(/^ {4}permissions:/m);
      const steps = block.split(/\n {6}- /);
      const last = steps[steps.length - 1] ?? '';
      expect(last, `${job} last step`).toContain(
        "if: failure() && inputs.fail-fast && github.event_name == 'pull_request'",
      );
      expect(last, `${job} last step`).toContain('GH_TOKEN: ${{ github.token }}');
      expect(last, `${job} last step`).toMatch(
        /gh run cancel "\$GITHUB_RUN_ID" --repo "\$GITHUB_REPOSITORY" \|\| /,
      );
    }
    // A called workflow's own permissions could only lower its caller's token, and the cancel
    // needs the caller's actions: write.
    expect(suite).not.toMatch(/^permissions:/m);
  });

  it('every matrix fails fast only when the caller asks, and only ci.yml asks, on a PR', () => {
    const matrices = SUITE_JOBS.filter((job) => /^ {4}strategy:$/m.test(blockIn(suite, job)));
    expect(matrices.sort()).toEqual(['browser', 'sim', 'unit']);
    for (const job of matrices)
      expect(blockIn(suite, job), job).toContain('      fail-fast: ${{ inputs.fail-fast }}\n');
    expect(suite).not.toMatch(/fail-fast: (?:false|true)/);
    expect(suite).toMatch(/\n {6}fail-fast:\n(?: {8}.*\n)*? {8}type: boolean\n {8}default: false\n/);
    expect(jobBlock('suite')).toContain("      fail-fast: ${{ github.event_name == 'pull_request' }}\n");
    expect(train).not.toContain('fail-fast');
    expect(ci).not.toMatch(/fail-fast: (?:false|true)/);
  });

  it("only ci.yml's suite call gets an actions token, and the workflow default stays read-only", () => {
    expect(ci).toMatch(/\npermissions:\n {2}contents: read\n\n/);
    // Job-level permissions replace the workflow's, so contents: read must be restated.
    expect(jobBlock('suite')).toMatch(/^ {4}permissions:\n {6}actions: write\n {6}contents: read\n(?! {6})/m);
    for (const { name } of jobs()) {
      if (SUITE.includes(name)) continue;
      const block = jobBlock(name);
      expect(block, name).not.toContain('actions: write');
      expect(block, name).not.toContain('gh run cancel');
    }
    // The train's suite runs PR code, so it gets no write token (scripts/train.test.ts checks more).
    for (const job of ['suite', 'control'])
      expect(blockIn(train, job), job).toMatch(/^ {4}permissions:\n {6}contents: read\n {4}uses:/m);
  });

  it('deploy-prod and release check their own upstream result, not only the status function', () => {
    const byName = new Map(jobs().map((j) => [j.name, j.cond ?? '']));
    expect(byName.get('deploy-prod')).toContain("needs.aggregate.result == 'success'");
    expect(byName.get('release')).toContain("needs.deploy-prod.result == 'success'");
    expect(byName.get(PROD_BUILD)).toContain("needs.plan.result == 'success'");
  });

  // The deploy's gzip probe (docs/engineering.md, "Deploy"). It exists to report, so three things must
  // hold: it can never fail the deploy or touch a secret, and a failing probe must actually reach its
  // warning. Actions runs a bare `run:` as `bash -e {0}` with no pipefail, so `probe | tee` takes
  // tee's status and a failing probe is silent (reproduced in the review of the PR that added the
  // step): the step needs pipefail, and stderr in the pipe, or the "never served this build" line
  // never reaches the summary.
  it('the deploy gzip probe reports only, holds no secret, and a failing probe reaches its warning', () => {
    const deploy = jobBlock('deploy-prod');
    const step = deploy.split(/\n {6}- /).find((s) => s.startsWith('name: Probe the gzip copies'));
    expect(step, 'the probe step, inside deploy-prod').toBeDefined();
    const text = step ?? '';
    expect(text).toMatch(/^ {8}if: steps\.decide\.outputs\.deploy == 'true'$/m);
    expect(text).toMatch(/^ {8}continue-on-error: true$/m);
    const stepLimit = Number(/^ {8}timeout-minutes: (\d+)$/m.exec(text)?.[1]);
    const jobLimit = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(deploy)?.[1]);
    expect(stepLimit, 'the step has a limit').toBeGreaterThan(0);
    expect(stepLimit, 'inside the job limit').toBeLessThan(jobLimit);
    // No secret in the step's env or script: it is an unauthenticated read of a public Space.
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/HF_TOKEN/);
    // pipefail, from `shell: bash` (bash -eo pipefail) or set in the script...
    expect(text, 'pipefail').toMatch(/^ {8}shell: bash$|set -[a-z]*o pipefail/m);
    // ...and the pipe carries stderr, so the exit-2 line and a thrown error reach the summary.
    expect(text, 'runs the probe').toContain('gzip-probe.mjs');
    expect(text, 'stderr into the summary').toMatch(/2>&1\s*\\?\s*\| tee -a "\$GITHUB_STEP_SUMMARY"/);
  });

  it('only a full-path PR run records the tree it tested: the quick check never vouches for main', () => {
    const rec = /- name: Record the tree this PR run tested\n(?: {8}.*\n)*? {8}if: (.+)\n/.exec(ci);
    expect(rec, 'the record step').not.toBeNull();
    expect(rec?.[1]).toBe("github.event_name == 'pull_request' && needs.route.outputs.path == 'full'");
  });
});
