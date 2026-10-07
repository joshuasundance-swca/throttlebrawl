#!/usr/bin/env node
// Main skips its suite when the pushed tree was already tested (docs/engineering.md, "CI on GitHub
// Actions"). Two steps of ci.yml use this file:
//
//   node scripts/tested-tree.mjs decide [--tree <tree sha>]   (the `plan` job, push to main only)
//   node scripts/tested-tree.mjs gate                          (the `gate` job; reads NEEDS)
//
// A green full PR gate, or a train after its full suite passes and before it posts merge-enabling
// statuses, uploads an artifact named `tested-tree-<tree>`, where <tree> is the tree of
// the merge commit that run tested (GitHub's merge of the PR head into main at the push). The
// squash commit GitHub writes on merge has that same tree whenever main has not moved since: 60 of
// 60 squash merges checked on 2026-10-03 matched git's own merge of (main before the squash, PR
// head). The run API exposes neither the merge commit nor `base.sha`, and timestamps flip at the
// edges, so the PR run records the tree it tested and main looks it up by name, repo-wide.
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
const TREE = /^[0-9a-f]{40}$/;

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
        !a.expired &&
        typeof a.workflow_run?.id === 'number' &&
        a.workflow_run.repository_id !== undefined &&
        a.workflow_run.head_repository_id === a.workflow_run.repository_id,
    )
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
}

/** Full PR checks and main's full train can record a tested tree; quick checks cannot. */
export function runVouches(/** @type {Run} */ run) {
  return (
    (run.event === 'pull_request' && run.path === '.github/workflows/ci.yml') ||
    (run.path === '.github/workflows/train.yml' &&
      run.head_branch === 'main' &&
      ['workflow_run', 'workflow_dispatch'].includes(run.event))
  );
}

/**
 * Looks `tree` up. `api(path)` returns the parsed JSON of a GitHub REST GET.
 * @param {string} tree
 * @param {{ repo: string, api: (path: string) => Promise<any> }} o
 * @returns {Promise<{ skip: boolean, reason: string }>}
 */
export async function decide(tree, { repo, api }) {
  const short = tree.slice(0, 7);
  let list;
  try {
    list = await api(`/repos/${repo}/actions/artifacts?name=${artifactName(tree)}&per_page=100`);
  } catch (err) {
    return { skip: false, reason: `tree ${short}: lookup failed (${message(err)}); running the whole suite` };
  }
  const found = candidates(list?.artifacts ?? [], tree);
  if (found.length === 0) {
    return {
      skip: false,
      reason: `tree ${short}: no full PR or train recorded this tree; running the whole suite`,
    };
  }
  for (const a of found) {
    let run;
    try {
      run = await api(`/repos/${repo}/actions/runs/${a.workflow_run?.id}`);
    } catch (err) {
      return {
        skip: false,
        reason: `tree ${short}: run lookup failed (${message(err)}); running the whole suite`,
      };
    }
    if (runVouches(run)) {
      return {
        skip: true,
        reason: `tree ${short}: ${run.path === '.github/workflows/train.yml' ? 'train' : 'PR'} run ${run.id} recorded this exact tree after its full suite passed; skipping the suite (${run.html_url ?? ''})`,
      };
    }
  }
  return {
    skip: false,
    reason: `tree ${short}: no trusted full PR or main train vouches for it; running the whole suite`,
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
 *   the suite succeeded, and prod-build was skipped;
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
  return { ok: problems.length === 0, path: skip ? 'skip' : 'suite', problems };
}

function message(/** @type {unknown} */ err) {
  return err instanceof Error ? err.message : String(err);
}

/** GitHub REST GET: the job's token through fetch on CI, else the signed-in `gh` CLI. */
async function apiGet(/** @type {string} */ p) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    const base = process.env.GITHUB_API_URL || 'https://api.github.com';
    const res = await fetch(`${base}${p}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${p}`);
    return res.json();
  }
  // No shell: gh is a real executable on Windows too, and a shell would split the path at `&`.
  const r = spawnSync('gh', ['api', p.replace(/^\//, '')], { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`gh api ${p}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
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
