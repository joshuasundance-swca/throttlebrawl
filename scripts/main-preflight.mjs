import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { decide } from './tested-tree.mjs';
import { hasSuccessfulMainGate } from './main-acceptance.mjs';

export const PREFLIGHT_MS = 90_000;
export const REQUEST_MS = 5_000;
export const POLL_MS = 10_000;
export const REQUEST_CAP = 24;
export const OUTPUT_RESERVE_MS = 1_000;

const SHA = /^[0-9a-f]{40}$/;
const positive = (n) => Number.isSafeInteger(n) && n > 0;

/**
 * A bounded routing decision, never an acceptance verdict. A superseded tree stays unaccepted.
 * api must consume the response body before resolving and honor the supplied abort signal.
 * Clock/sleep injection lets tests drive the whole availability window without wall-clock waits.
 * @param {any} o
 */
export async function routeMain(o) {
  const now = o.now ?? (() => performance.now());
  const sleep = o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const end = o.deadline ?? now() + PREFLIGHT_MS - OUTPUT_RESERVE_MS;
  const full = { path: 'full', skip: false, reason: 'full acceptance required', tree: o.tree };
  const fallback = (reason) => ({ ...full, reason });
  let failureReason = 'lookup-failed';
  let requests = 0;
  let failed = false;
  const remaining = () => end - now();
  async function get(path) {
    if (failed) throw new Error('preflight budget');
    if (requests >= REQUEST_CAP || remaining() <= 0) {
      failureReason = requests >= REQUEST_CAP ? 'request-cap' : 'deadline';
      throw new Error('preflight budget');
    }
    requests++;
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        o.api(path, controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => {
              failureReason = remaining() <= 0 ? 'deadline' : 'request-deadline';
              controller.abort();
              reject(new Error('preflight request deadline'));
            },
            Math.min(REQUEST_MS, remaining()),
          );
        }),
      ]);
      if (remaining() <= 0) {
        failureReason = 'deadline';
        throw new Error('preflight deadline');
      }
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  // Complete collections only: an endpoint filter or a full first page is not a latest/absence proof.
  async function collection(path, key) {
    const rows = [];
    const ids = new Set();
    let total;
    for (let page = 1; ; page++) {
      const value = await get(`${path}&per_page=100&page=${page}`);
      if (
        !Number.isSafeInteger(value?.total_count) ||
        value.total_count < 0 ||
        (total !== undefined && total !== value.total_count) ||
        !Array.isArray(value[key])
      )
        throw new Error('incomplete collection');
      total = value.total_count;
      for (const row of value[key]) {
        if (!positive(row?.id) || ids.has(row.id)) throw new Error('ambiguous collection');
        ids.add(row.id);
        rows.push(row);
      }
      if (rows.length === total) return rows;
      if (rows.length > total || value[key].length !== 100) throw new Error('incomplete page');
    }
  }
  async function proof() {
    const result = await decide(o.tree, {
      repo: o.repo,
      api: async (path) => {
        if (path.includes('/actions/artifacts?')) {
          const base = path.replace('&per_page=100', '');
          try {
            return { artifacts: await collection(base, 'artifacts') };
          } catch (error) {
            failed = true;
            throw error;
          }
        }
        return get(path);
      },
    });
    if (failed) throw new Error('proof lookup failed');
    return result.skip;
  }
  try {
    if (!SHA.test(o.sha) || !SHA.test(o.tree) || !/^[\w.-]+\/[\w.-]+$/.test(o.repo))
      return fallback('invalid-input');
    if (await proof()) return { ...full, path: 'tested', skip: true, reason: 'exact tested-tree proof' };
    const base = `/repos/${o.repo}`;
    const repository = await get(base);
    const workflow = await get(`${base}/actions/workflows/ci.yml`);
    if (
      !positive(repository?.id) ||
      repository.full_name !== o.repo ||
      !positive(workflow?.id) ||
      workflow.path !== '.github/workflows/ci.yml' ||
      workflow.state !== 'active'
    )
      return fallback('ineligible-repository-or-workflow');
    const sameRepo = (r) => r?.id === repository.id && r.full_name === o.repo;
    const validRun = (r, sha, wf = workflow, event = 'push') =>
      positive(r?.id) &&
      positive(r.run_attempt) &&
      Number.isFinite(Date.parse(r.created_at)) &&
      r.workflow_id === wf.id &&
      r.path === wf.path &&
      r.event === event &&
      r.head_branch === 'main' &&
      r.head_sha === sha &&
      sameRepo(r.repository) &&
      sameRepo(r.head_repository);
    const pending = (r) => ['queued', 'in_progress'].includes(r.status) && r.conclusion === null;
    const head = async () => {
      const branch = await get(`${base}/branches/main`);
      if (branch?.name !== 'main' || !SHA.test(branch.commit?.sha)) throw new Error('invalid main head');
      return branch.commit.sha;
    };
    let train;
    for (;;) {
      const successor = await head();
      if (successor !== o.sha) {
        const compare = await get(`${base}/compare/${o.sha}...${successor}`);
        if (
          compare?.status !== 'ahead' ||
          compare.behind_by !== 0 ||
          !positive(compare.ahead_by) ||
          compare.base_commit?.sha !== o.sha ||
          compare.merge_base_commit?.sha !== o.sha
        )
          return fallback('unproven-forward-ancestry');
        const runs = await collection(
          `${base}/actions/workflows/${workflow.id}/runs?event=push&head_sha=${successor}`,
          'workflow_runs',
        );
        if (!runs.length || runs.some((r) => !validRun(r, successor)))
          return fallback('successor-eligibility-unproven');
        runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
        const listed = runs[0];
        const chosen = await get(`${base}/actions/runs/${listed.id}`);
        if (
          !validRun(chosen, successor) ||
          chosen.id !== listed.id ||
          chosen.run_attempt !== listed.run_attempt
        )
          return fallback('successor-metadata-mismatch');
        if (!pending(chosen)) {
          if (chosen.status !== 'completed' || chosen.conclusion !== 'success')
            return fallback('successor-not-pending-or-successful');
          const jobs = await collection(
            `${base}/actions/runs/${chosen.id}/attempts/${chosen.run_attempt}/jobs?filter=all`,
            'jobs',
          );
          if (
            jobs.some(
              (j) =>
                j.run_id !== chosen.id ||
                (j.run_attempt !== undefined && j.run_attempt !== chosen.run_attempt),
            ) ||
            !hasSuccessfulMainGate(jobs)
          )
            return fallback('successor-gate-not-proven');
        }
        const unchanged = (r) =>
          validRun(r, successor) &&
          r.id === chosen.id &&
          r.run_attempt === chosen.run_attempt &&
          r.status === chosen.status &&
          r.conclusion === chosen.conclusion;
        if (
          !unchanged(await get(`${base}/actions/runs/${chosen.id}`)) ||
          (await head()) !== successor ||
          !unchanged(await get(`${base}/actions/runs/${chosen.id}`))
        )
          return fallback('successor-changed');
        return {
          ...full,
          path: 'superseded',
          reason: 'last-observed eligible descendant CI',
          successor,
          run: chosen.id,
        };
      }
      // An active main train grants time for merges/proof publication, never acceptance itself.
      train ??= await get(`${base}/actions/workflows/train.yml`);
      if (!positive(train?.id) || train.path !== '.github/workflows/train.yml' || train.state !== 'active')
        return fallback('ineligible-train-workflow');
      let active = false;
      for (const status of ['queued', 'in_progress']) {
        const runs = await collection(
          `${base}/actions/workflows/${train.id}/runs?branch=main&status=${status}`,
          'workflow_runs',
        );
        if (
          runs.some(
            (r) =>
              validRun(r, r.head_sha, train, r.event) &&
              SHA.test(r.head_sha) &&
              ['workflow_run', 'workflow_dispatch'].includes(r.event) &&
              pending(r),
          )
        )
          active = true;
      }
      if (!active || requests >= REQUEST_CAP || remaining() <= POLL_MS)
        return fallback(
          !active ? 'no-eligible-active-train' : requests >= REQUEST_CAP ? 'request-cap' : 'poll-deadline',
        );
      await sleep(POLL_MS);
      if (await proof()) return { ...full, path: 'tested', skip: true, reason: 'exact tested-tree proof' };
    }
  } catch {
    return fallback(failureReason);
  }
}

async function main() {
  const deadline = performance.now() + PREFLIGHT_MS - OUTPUT_RESERVE_MS;
  const sha = process.env.GITHUB_SHA;
  let result = { path: 'full', skip: false, tree: '', reason: 'invalid-input' };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) result.reason = 'missing-token';
  if (SHA.test(sha ?? '') && token) {
    result.reason = 'local-tree-unavailable';
    const local = spawnSync('git', ['show', '-s', '--format=%H%n%T', 'HEAD'], {
      encoding: 'utf8',
      timeout: Math.max(1, Math.floor(deadline - performance.now())),
    });
    const [head, tree] = (local.stdout ?? '').trim().split(/\r?\n/);
    if (!local.error && local.status === 0 && head === sha && SHA.test(tree ?? '')) {
      result = await routeMain({
        sha,
        tree,
        repo: process.env.GITHUB_REPOSITORY,
        deadline,
        api: async (path, signal) => {
          const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
            headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
            signal,
          });
          if (!response.ok) throw new Error('API unavailable');
          return response.json();
        },
      });
    }
  }
  // Fixed strings and validated hashes only; API/error text never becomes a workflow command.
  console.log(`main preflight: ${result.path}`);
  console.log(`main preflight reason: ${result.reason}`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `path=${result.path}\nskip=${result.skip}\ntree=${result.tree}\n`,
    );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
