// rerun-main.yml's decision (docs/engineering.md, "A red main is re-run once"): which first attempts
// of main's ci it re-runs, and the workflow's wiring. The job fixtures follow this repo's own API
// answers: main run 37423758824 (85c747dd, 2026-10-06) concluded `cancelled` because
// `suite / browser (5/7)` hit its 10-minute timeout, and the gate then failed; its job's check-run
// annotations read "The job has exceeded the maximum execution time of 10m0s" and "The operation
// was canceled.". rerun-main skipped it (run 37426413327), since it acted only on `failure`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hitTimeout, rerunDecision } from './rerun-main.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const TIMEOUT_NOTES = [
  'The job has exceeded the maximum execution time of 10m0s',
  'The operation was canceled.',
  '1 e2e file(s) have no measured CI time in tests/timings.json, so each is planned as 75 s',
];
const CANCEL_NOTES = ['The operation was canceled.'];

const ok = (name: string) => ({ name, conclusion: 'success', timedOut: false });
const timedOut = (name: string) => ({ name, conclusion: 'cancelled', timedOut: true });
const cancelled = (name: string) => ({ name, conclusion: 'cancelled', timedOut: false });
const failed = (name: string) => ({ name, conclusion: 'failure', timedOut: false });

const run = (conclusion: string, o: { attempt?: number; status?: string } = {}) => ({
  id: 37423758824,
  sha: SHA,
  attempt: o.attempt ?? 1,
  status: o.status ?? 'completed',
  conclusion,
});

/** Main run 37423758824's red: one slice timed out, so the gate failed and the run concluded cancelled. */
const timeoutJobs = [ok('suite / sim (1/6)'), timedOut('suite / browser (5/7)'), failed('gate')];

describe('a timed-out job, from its annotations', () => {
  it('reads the runner\'s "exceeded the maximum execution time" annotation as a timeout', () => {
    expect(hitTimeout(TIMEOUT_NOTES)).toBe(true);
  });

  it('a plain cancel (a person, or a newer push) is not a timeout', () => {
    expect(hitTimeout(CANCEL_NOTES)).toBe(false);
    expect(hitTimeout([])).toBe(false);
  });
});

describe('which first attempts it re-runs', () => {
  it("a failed first attempt on main's head, as before", () => {
    const d = rerunDecision({
      run: run('failure'),
      mainHead: SHA,
      jobs: [failed('suite / unit (1/2)'), failed('gate')],
    });
    expect(d).toMatchObject({ rerun: true });
    expect(d.why).toContain('suite / unit (1/2)');
  });

  it('a first attempt red only from a timed-out job (it concludes cancelled, not failure)', () => {
    const d = rerunDecision({ run: run('cancelled'), mainHead: SHA, jobs: timeoutJobs });
    expect(d).toMatchObject({ rerun: true });
    expect(d.why).toContain('suite / browser (5/7)');
    expect(d.why).toContain('timeout');
  });

  it('not a cancelled run with no timed-out job: a person cancelled it', () => {
    const d = rerunDecision({
      run: run('cancelled'),
      mainHead: SHA,
      jobs: [ok('suite / static'), cancelled('suite / browser (2/7)'), cancelled('suite / sim (3/6)')],
    });
    expect(d.rerun).toBe(false);
    expect(d.why).toContain('no job hit its timeout');
  });

  it('not a waiting run a newer push replaced (no jobs at all)', () => {
    const d = rerunDecision({ run: run('cancelled'), mainHead: SHA, jobs: [] });
    expect(d.rerun).toBe(false);
    expect(d.why).toContain('no job hit its timeout');
  });

  it('not when a job was also cancelled without a timeout (somebody cancelled the run too)', () => {
    const d = rerunDecision({
      run: run('cancelled'),
      mainHead: SHA,
      jobs: [...timeoutJobs, cancelled('suite / browser (6/7)')],
    });
    expect(d.rerun).toBe(false);
    expect(d.why).toContain('suite / browser (6/7)');
  });

  it('only once: never a second attempt, timed out or failed', () => {
    expect(
      rerunDecision({ run: run('cancelled', { attempt: 2 }), mainHead: SHA, jobs: timeoutJobs }).rerun,
    ).toBe(false);
    expect(
      rerunDecision({ run: run('failure', { attempt: 2 }), mainHead: SHA, jobs: timeoutJobs }).rerun,
    ).toBe(false);
  });

  it('not a run that is running again (someone re-ran it already)', () => {
    expect(
      rerunDecision({ run: run('cancelled', { status: 'in_progress' }), mainHead: SHA, jobs: timeoutJobs })
        .rerun,
    ).toBe(false);
  });

  it("not when main has moved on: the newer commit's own run decides", () => {
    const d = rerunDecision({ run: run('cancelled'), mainHead: OTHER, jobs: timeoutJobs });
    expect(d.rerun).toBe(false);
    expect(d.why).toContain('bbbbbbb');
  });

  it('not a green run, nor any other conclusion', () => {
    for (const c of ['success', 'skipped', 'neutral', 'startup_failure', 'action_required'])
      expect(rerunDecision({ run: run(c), mainHead: SHA, jobs: timeoutJobs }).rerun, c).toBe(false);
  });
});

describe('rerun-main.yml wiring', () => {
  const yml = readFileSync(
    path.join(import.meta.dirname, '..', '.github', 'workflows', 'rerun-main.yml'),
    'utf8',
  );
  const job = yml.slice(yml.indexOf('\njobs:'));

  it('wakes on a failed or a cancelled first attempt of a push to main, never a PR run', () => {
    expect(yml).toMatch(/\n {4}workflows: \[ci\]\n {4}types: \[completed\]\n {4}branches: \[main\]\n/);
    const cond = /\n {4}if: >-\n((?: {6}.*\n)+)/.exec(job)?.[1] ?? '';
    expect(cond).toContain("github.event.workflow_run.event == 'push'");
    expect(cond).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(cond).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    expect(cond).toContain('github.event.workflow_run.run_attempt == 1');
    expect(cond).toContain(
      "(github.event.workflow_run.conclusion == 'failure' || github.event.workflow_run.conclusion == 'cancelled')",
    );
  });

  it("runs main's own decision script, with a token that can re-run runs and read checks, nothing more", () => {
    expect(yml).toMatch(/\npermissions: \{\}\n/);
    expect(job).toMatch(
      /\n {4}permissions:\n {6}actions: write\n {6}checks: read\n {6}contents: read\n {4}env:/,
    );
    expect(job).not.toMatch(/: write$(?<!actions: write)/m);
    // The checkout is main's newest commit (a workflow_run event's own), not the run it judges.
    const checkout = /\n {6}- uses: actions\/checkout@v\d+\n((?: {8}.*\n)+)/.exec(job)?.[1] ?? '';
    expect(checkout).toContain('persist-credentials: false');
    expect(checkout).toContain('sparse-checkout: scripts');
    expect(checkout).not.toContain('ref:');
    expect(job).toMatch(/\n {8}run: node scripts\/rerun-main\.mjs\n/);
    for (const v of ['GH_TOKEN', 'REPO', 'RUN_ID', 'RUN_SHA', 'RUN_URL'])
      expect(job).toMatch(new RegExp(`\\n {6}${v}: `));
  });

  it('no run: line expands an expression: everything goes through env', () => {
    for (const m of job.matchAll(/^ +(?:- )?run: (.*)$/gm)) expect(m[1]).not.toContain('${{');
  });
});
