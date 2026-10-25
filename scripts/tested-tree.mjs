#!/usr/bin/env node
// Main skips its suite when the pushed tree was already tested (docs/engineering.md, "CI on GitHub
// Actions"). Main's bounded preflight imports decide; ci.yml's acceptance gate uses this CLI:
//
//   node scripts/tested-tree.mjs decide [--tree <tree sha>]   (standalone exact-proof lookup)
//   node scripts/tested-tree.mjs gate                          (the `gate` job; reads NEEDS)
//
// Existing `tested-tree-<tree>` artifacts locate candidate runs; their name/payload cannot prove
// acceptance. Only a main train qualifies: independently observe its exact-attempt official plan
// log's full tree, guarded record/upload success, complete jobs and stable source identity. The
// official record's seven-day age cap cannot be extended by a substitute artifact. Full-PR and
// weak name/run-shape-only evidence conservatively retain the full suite.
//
// `decide` prints one plain line and writes `skip=true|false` and `tree=<sha>` to $GITHUB_OUTPUT.
// Trains must run main's workflow, not a feature branch's. Any doubt (no artifact, an API error,
// a fork's run, a run of another workflow) means
// `skip=false`: main runs the whole suite, as before. It exits 0 either way.
// `gate` prints each job's result and exits 1 unless the run is green on one of its two paths.
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { git } from './lib.mjs';

export const ARTIFACT_PREFIX = 'tested-tree-';
/** The workflow's existing seven-day retention also bounds independently verified evidence. */
export const PROOF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TREE = /^[0-9a-f]{40}$/;
const positiveId = (id) => Number.isSafeInteger(id) && id > 0;

/** The artifact a passed full suite uploads for the tree it tested. */
export function artifactName(/** @type {string} */ tree) {
  if (!TREE.test(tree)) throw new Error(`tested-tree: not a full tree id: ${tree}`);
  return `${ARTIFACT_PREFIX}${tree}`;
}

/**
 * @typedef {{ id: number, name: string, expired: boolean, created_at?: string,
 *   workflow_run?: { id?: number, repository_id?: number, head_repository_id?: number } }} Artifact
 * @typedef {{ id: number, event: string, path: string, head_branch?: string, html_url?: string }} Run
 */

/**
 * The artifacts that can vouch for `tree`, newest first: the exact name, not expired, and made by a
 * run whose head is this repository (a fork's run never vouches for main).
 * @param {Artifact[]} artifacts
 * @param {string} tree
 */
export function candidates(artifacts, tree) {
  const name = artifactName(tree);
  return artifacts
    .filter(
      (a) =>
        a.name === name &&
        a.expired === false &&
        positiveId(a.workflow_run?.id) &&
        positiveId(a.workflow_run?.repository_id) &&
        a.workflow_run.head_repository_id === a.workflow_run.repository_id,
    )
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
}

/** Only the existing main-code train plan/report boundary can independently vouch for a tree. */
export function runVouches(/** @type {Run} */ run) {
  return (
    run.path === '.github/workflows/train.yml' &&
    run.head_branch === 'main' &&
    ['workflow_run', 'workflow_dispatch'].includes(run.event)
  );
}

/** @typedef {(path: string, options?: { raw?: boolean }) => Promise<any>} ProofApi */

/** Stable main-code source/attempt identity, independent of a run's changing landing status. */
export function trainRunIdentity(/** @type {any} */ run, /** @type {string} */ repo) {
  if (
    !run ||
    !positiveId(run.id) ||
    !positiveId(run.run_attempt) ||
    !positiveId(run.workflow_id) ||
    !TREE.test(run.head_sha ?? '') ||
    !runVouches(run) ||
    !positiveId(run.repository?.id) ||
    run.head_repository?.id !== run.repository.id ||
    run.repository.full_name !== repo ||
    run.head_repository.full_name !== repo
  )
    return null;
  return JSON.stringify([
    run.id,
    run.run_attempt,
    run.workflow_id,
    run.path,
    run.event,
    run.head_branch,
    run.head_sha,
    run.repository.id,
    repo,
  ]);
}

/** Complete, stable-count collections; every page and row must be observed unambiguously. */
async function collection(/** @type {ProofApi} */ api, /** @type {string} */ url, /** @type {string} */ key) {
  /** @type {any[]} */
  const rows = [];
  const ids = new Set();
  let total;
  for (let page = 1; page <= 100; page++) {
    const result = await api(`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (
      !Number.isSafeInteger(result?.total_count) ||
      result.total_count < 0 ||
      (total !== undefined && total !== result.total_count) ||
      !Array.isArray(result[key]) ||
      result[key].length > 100
    )
      throw new Error('incomplete collection');
    total = result.total_count;
    for (const row of result[key]) {
      if (!positiveId(row?.id) || ids.has(row.id)) throw new Error('ambiguous collection');
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === total) return rows;
    if (rows.length > total || result[key].length !== 100) throw new Error('incomplete page');
  }
  throw new Error('collection exceeds readable pages');
}

/** Explicit same-attempt job rows, also used by the train's skipped-suite observation. */
export async function completeAttemptJobs(
  /** @type {ProofApi} */ api,
  /** @type {string} */ repo,
  /** @type {number} */ runId,
  /** @type {number} */ attempt,
) {
  if (!positiveId(runId) || !positiveId(attempt)) throw new Error('invalid attempt identity');
  const jobs = await collection(api, `/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs`, 'jobs');
  if (
    jobs.some(
      (job) =>
        job.run_id !== runId ||
        job.run_attempt !== attempt ||
        typeof job.name !== 'string' ||
        !job.name ||
        typeof job.status !== 'string' ||
        !job.status ||
        (job.conclusion !== null && (typeof job.conclusion !== 'string' || !job.conclusion)),
    )
  )
    throw new Error('malformed or mismatched jobs');
  return jobs;
}

/** Strict UTC service timestamps, including the seven fractional digits seen in completed logs. */
function timestamp(/** @type {unknown} */ value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value))
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
    ? parsed
    : null;
}

/** A locator is never authority: derive the requested tree from trusted official producer work. */
async function officialProof(
  /** @type {any} */ run,
  /** @type {string} */ tree,
  /** @type {string} */ repo,
  /** @type {ProofApi} */ api,
  /** @type {() => number} */ now,
) {
  const identity = trainRunIdentity(run, repo);
  if (!identity) return false;
  const jobs = await completeAttemptJobs(api, repo, run.id, run.run_attempt);
  const plans = jobs.filter((j) => j.name === 'plan');
  const reports = jobs.filter((j) => j.name === 'report');
  if (plans.length !== 1 || reports.length !== 1) return false;
  const plan = plans[0];
  const report = reports[0];
  if (
    plan.status !== 'completed' ||
    plan.conclusion !== 'success' ||
    !['in_progress', 'completed'].includes(report.status) ||
    !Array.isArray(report.steps)
  )
    return false;
  const names = ['Record the tree this train tested', 'Upload the tested train tree'];
  const chosen = names.map((name) => report.steps.filter((/** @type {any} */ step) => step?.name === name));
  if (chosen.some((steps) => steps.length !== 1)) return false;
  const [record, upload] = chosen.map((steps) => steps[0]);
  if (
    [record, upload].some(
      (step) => step.status !== 'completed' || step.conclusion !== 'success' || !positiveId(step.number),
    ) ||
    record.number >= upload.number
  )
    return false;
  const finishedPlan = timestamp(plan.completed_at);
  const times = [record.started_at, record.completed_at, upload.started_at, upload.completed_at].map(
    (value) => timestamp(value) ?? NaN,
  );
  const current = now();
  if (
    !Number.isFinite(current) ||
    finishedPlan === null ||
    times.some((t) => !Number.isFinite(t) || t > current) ||
    times[0] < finishedPlan ||
    times[1] < times[0] ||
    times[2] < times[1] ||
    times[3] < times[2] ||
    current - times[1] > PROOF_MAX_AGE_MS
  )
    return false;
  const log = await api(`/repos/${repo}/actions/jobs/${plan.id}/logs`, { raw: true });
  if (typeof log !== 'string') return false;
  const markers = log.split(/\r?\n/).filter((line) => /\btree=/.test(line));
  if (markers.length !== 1) return false;
  const match = /^(\S+) tree=([0-9a-f]{40})$/.exec(markers[0]);
  const loggedAt = timestamp(match?.[1]);
  if (!match || match[2] !== tree || loggedAt === null || loggedAt > finishedPlan) return false;
  const unchanged = identity === trainRunIdentity(await api(`/repos/${repo}/actions/runs/${run.id}`), repo);
  const finished = now();
  return (
    unchanged && Number.isFinite(finished) && finished >= current && finished - times[1] <= PROOF_MAX_AGE_MS
  );
}

/**
 * The artifact only locates a main run; its official plan/report independently prove the tree.
 * @param {string} tree
 * @param {{ repo: string, api: ProofApi, now?: () => number }} o
 * @returns {Promise<{ skip: boolean, reason: string, unavailable?: boolean }>}
 */
export async function decide(tree, { repo, api, now = Date.now }) {
  const short = tree.slice(0, 7);
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('invalid repository');
    const list = await collection(
      api,
      `/repos/${repo}/actions/artifacts?name=${artifactName(tree)}`,
      'artifacts',
    );
    for (const a of candidates(list, tree)) {
      const run = await api(`/repos/${repo}/actions/runs/${a.workflow_run?.id}`);
      if (
        run?.id === a.workflow_run?.id &&
        run.repository?.id === a.workflow_run?.repository_id &&
        (await officialProof(run, tree, repo, api, now))
      ) {
        return {
          skip: true,
          reason: `tree ${short}: train run ${run.id} recorded this exact tree after its full suite passed; skipping the suite (https://github.com/${repo}/actions/runs/${run.id})`,
        };
      }
    }
  } catch {
    return {
      skip: false,
      unavailable: true,
      reason: `tree ${short}: proof observation unavailable or incomplete; running the whole suite`,
    };
  }
  return {
    skip: false,
    reason: `tree ${short}: no current official main-train proof vouches for it; running the whole suite`,
  };
}

/**
 * The suite: one job of ci.yml that calls suite.yml (static, unit, sim and browser, or the quick
 * check), which runs on every PR and on a push whose tree was not tested. A called workflow's job
 * succeeds only when every job inside it succeeded or was skipped by its own `if:`.
 */
export const SUITE = ['suite'];
/** The push-only job of the skip path: identity leak scan and the prod-stamped build. */
export const PROD_BUILD = 'prod-build';

/**
 * The aggregate's verdict from `toJSON(needs)`. Two green shapes, nothing else:
 * - the suite path: plan succeeded or was skipped (a PR), route succeeded or was skipped (a push),
 *   the suite succeeded with coverage matching its route, and prod-build was skipped;
 * - the skip path, only when plan ran and said skip=true: the suite was skipped, and prod-build
 *   succeeded.
 * A failed, cancelled or missing job fails the gate on either path.
 * @param {Record<string, { result?: string, outputs?: Record<string, string> }>} needs
 */
export function gateVerdict(needs) {
  const skip = needs.plan?.result === 'success' && needs.plan?.outputs?.skip === 'true';
  /** @type {string[]} */
  const problems = [];
  const want = (/** @type {string} */ job, /** @type {string[]} */ ok) => {
    const got = needs[job]?.result ?? 'missing';
    if (!ok.includes(got)) problems.push(`${job} is ${got}, needs ${ok.join(' or ')}`);
  };
  want('plan', ['success', 'skipped']);
  want('route', ['success', 'skipped']);
  for (const job of SUITE) want(job, skip ? ['skipped'] : ['success']);
  want(PROD_BUILD, skip ? ['success'] : ['skipped']);
  if (!skip && needs.suite?.result === 'success') {
    const route = needs.route;
    const expected =
      route?.result === 'skipped' && needs.plan?.result === 'success'
        ? 'full' // a main push
        : route?.result === 'success' && needs.plan?.result === 'skipped'
          ? route.outputs?.path === 'full'
            ? 'full'
            : ['train', 'docs'].includes(route.outputs?.path ?? '')
              ? 'quick'
              : null
          : null;
    if (!expected)
      problems.push(`route path is ${route?.outputs?.path ?? 'missing'}, cannot establish suite coverage`);
    else if (needs.suite.outputs?.coverage !== expected)
      problems.push(`suite coverage is ${needs.suite.outputs?.coverage ?? 'missing'}, needs ${expected}`);
  }
  return { ok: problems.length === 0, path: skip ? 'skip' : 'suite', problems };
}

/** GitHub REST GET: the job's token through fetch on CI, else the signed-in `gh` CLI. */
async function apiGet(/** @type {string} */ p, { raw = false } = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    const base = process.env.GITHUB_API_URL || 'https://api.github.com';
    const res = await fetch(`${base}${p}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${p}`);
    return raw ? res.text() : res.json();
  }
  // No shell: gh is a real executable on Windows too, and a shell would split the path at `&`.
  const r = spawnSync('gh', ['api', p.replace(/^\//, '')], { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`gh api ${p}: ${r.stderr.trim()}`);
  return raw ? r.stdout : JSON.parse(r.stdout);
}

async function main(/** @type {string[]} */ argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'gate') {
    const needs = JSON.parse(process.env.NEEDS ?? '{}');
    for (const [job, v] of Object.entries(needs)) console.log(`${job}: ${v?.result}`);
    const v = gateVerdict(needs);
    if (v.ok) {
      console.log(`gate: green on the ${v.path} path`);
      return;
    }
    for (const p of v.problems) console.log(`::error title=gate::${p}`);
    process.exit(1);
  }
  if (cmd === 'decide') {
    const at = rest.indexOf('--tree');
    const tree = at >= 0 ? rest[at + 1] : git(['rev-parse', 'HEAD^{tree}']).trim();
    const repo = process.env.GITHUB_REPOSITORY;
    if (!tree || !TREE.test(tree) || !repo) {
      console.error('usage: GITHUB_REPOSITORY=<owner>/<repo> tested-tree.mjs decide [--tree <full tree id>]');
      process.exit(1);
    }
    const { skip, reason } = await decide(tree, { repo, api: apiGet });
    console.log(reason);
    console.log(`skip=${skip}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\ntree=${tree}\n`);
    return;
  }
  console.error('usage: tested-tree.mjs decide [--tree <sha>] | gate');
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
