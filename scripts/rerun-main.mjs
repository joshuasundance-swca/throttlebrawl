// Re-run a red main once (rerun-main.yml; docs/engineering.md, "A red main is re-run once"). When a
// push run of ci on main ends red on its FIRST attempt and that commit is still main's head, this
// re-runs its failed jobs once (GitHub re-runs their dependents too: gate, then deploy-prod and
// release when it goes green). Red means either:
// - the run failed (a failed step anywhere), or
// - the run was cancelled only because a job hit its timeout-minutes. GitHub ends a timed-out job
//   `cancelled`, not `failure`, and then the whole run concludes `cancelled` (main run 37423758824,
//   2026-10-06: browser 5/7 timed out, the gate failed, the run concluded cancelled, and this rule's
//   old form, failure only, skipped it). The runner's annotation on the job's check run is what
//   tells a timeout from a person's cancel: "The job has exceeded the maximum execution time of
//   10m0s". A failed-jobs re-run includes the cancelled jobs: main run 37418801318's attempt 2 ran
//   its timed-out browser (5/7) again beside its failed browser (2/7).
// A run cancelled any other way is left alone: a person cancelled it, or a newer push replaced it
// while it waited (then it has no jobs at all).
//
// It runs from main's own newest commit (a workflow_run event checks out the default branch), never
// from the run it judges, and reads that run only through the API. Its token can re-run workflows
// (actions: write), read check annotations (checks: read) and read the repo (contents: read).
//
//   node scripts/rerun-main.mjs   (env: GH_TOKEN, REPO, RUN_ID, RUN_SHA, RUN_URL)
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TIMEOUT = /has exceeded the maximum execution time/;

/** Whether a job's check-run annotations say it hit its timeout-minutes (not a plain cancel). */
export function hitTimeout(/** @type {string[]} */ messages) {
  return messages.some((m) => TIMEOUT.test(m));
}

const RED = new Set(['failure', 'cancelled', 'timed_out']);

/**
 * Whether to re-run main's ci run, and why, in one line for the flake ledger.
 * @param {{ run: { id: number, sha: string, attempt: number, status: string, conclusion: string },
 *   mainHead: string, jobs: { name: string, conclusion: string, timedOut: boolean }[] }} o
 *   `run` as it is now (not as the event saw it); `jobs` are its first attempt's, each cancelled one
 *   with whether its annotations say it timed out.
 * @returns {{ rerun: boolean, why: string }}
 */
export function rerunDecision({ run, mainHead, jobs }) {
  const short = run.sha.slice(0, 7);
  const red = jobs.filter((j) => RED.has(j.conclusion)).map((j) => j.name);
  const named = red.length ? red.join(', ') : 'none';
  const no = (/** @type {string} */ why) => ({
    rerun: false,
    why: `main ${short} (ci run ${run.id}): not re-run, ${why}`,
  });
  if (run.attempt !== 1 || run.status !== 'completed')
    return no(`it is already on attempt ${run.attempt} (${run.status}). Red jobs on attempt 1: ${named}.`);
  if (run.conclusion !== 'failure' && run.conclusion !== 'cancelled')
    return no(`it concluded ${run.conclusion || 'nothing'}, not failure or a timeout.`);
  if (mainHead !== run.sha)
    return no(`main has moved on to ${mainHead.slice(0, 7)}, whose own run decides. Red jobs: ${named}.`);
  if (run.conclusion === 'cancelled') {
    const cancelled = jobs.filter((j) => j.conclusion === 'cancelled');
    const timed = cancelled.filter((j) => j.timedOut).map((j) => j.name);
    const other = cancelled.filter((j) => !j.timedOut).map((j) => j.name);
    if (timed.length === 0)
      return no(
        `it was cancelled and no job hit its timeout: a person cancelled it, or a newer push replaced it while it waited. Cancelled jobs: ${other.join(', ') || 'none'}.`,
      );
    if (other.length)
      return no(
        `besides the timeout of ${timed.join(', ')}, it was cancelled by hand too (${other.join(', ')} ended cancelled with no timeout).`,
      );
    return {
      rerun: true,
      why: `main ${short} (ci run ${run.id}): re-running its red jobs once (${named}); ${timed.join(', ')} hit its timeout-minutes. If attempt 2 is green, the slice plan or the runner was slow: refresh tests/timings.json or add a slice, the re-run only hides it.`,
    };
  }
  return {
    rerun: true,
    why: `main ${short} (ci run ${run.id}): re-running its failed jobs once (${named}). If attempt 2 is green, a test flaked: fix the test, the re-run only hides it.`,
  };
}

// ---------------------------------------------------------------------------------------------
// GitHub

const env = process.env;

/**
 * @param {string} method
 * @param {string} url
 */
async function api(method, url) {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) throw new Error('GH_TOKEN is not set');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${env.GITHUB_API_URL ?? 'https://api.github.com'}${url}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return res.status === 204 || method !== 'GET' ? null : res.json();
    const text = (await res.text()).slice(0, 300);
    if (method === 'GET' && attempt < 3 && (res.status >= 500 || res.status === 429)) {
      await new Promise((r) => setTimeout(r, 3000 * attempt));
      continue;
    }
    throw new Error(`${method} ${url}: ${res.status} ${text}`);
  }
}

/**
 * The run as it is now, its first attempt's jobs (each cancelled one with its timeout flag) and
 * main's head: everything rerunDecision reads.
 * @param {string} repo
 * @param {number} id
 * @param {string} sha
 */
export async function gather(repo, id, sha) {
  /** @type {any} */
  const r = await api('GET', `/repos/${repo}/actions/runs/${id}`);
  /** @type {any} */
  const listed = await api('GET', `/repos/${repo}/actions/runs/${id}/attempts/1/jobs?per_page=100`);
  const jobs = [];
  for (const j of listed.jobs ?? []) {
    const conclusion = String(j.conclusion ?? '');
    let timedOut = false;
    if (conclusion === 'cancelled') {
      /** @type {any} */
      const notes = await api('GET', `/repos/${repo}/check-runs/${j.id}/annotations?per_page=50`);
      timedOut = hitTimeout((notes ?? []).map((/** @type {any} */ a) => String(a.message ?? '')));
    }
    jobs.push({ name: String(j.name ?? ''), conclusion, timedOut });
  }
  /** @type {any} */
  const main = await api('GET', `/repos/${repo}/branches/main`);
  return {
    run: {
      id,
      sha,
      attempt: Number(r.run_attempt ?? 1),
      status: String(r.status ?? ''),
      conclusion: String(r.conclusion ?? ''),
    },
    mainHead: String(main?.commit?.sha ?? ''),
    jobs,
  };
}

async function cli() {
  const repo = env.REPO ?? env.GITHUB_REPOSITORY ?? '';
  const id = Number(env.RUN_ID);
  const sha = env.RUN_SHA ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isInteger(id) || !/^[0-9a-f]{40}$/.test(sha))
    throw new Error('REPO, RUN_ID and RUN_SHA must be set');
  const d = rerunDecision(await gather(repo, id, sha));
  if (d.rerun) await api('POST', `/repos/${repo}/actions/runs/${id}/rerun-failed-jobs`);
  const line = `${d.why}${env.RUN_URL ? ` ${env.RUN_URL}` : ''}`;
  // The line names jobs from main's own workflow files, never PR text; still, it starts with text.
  console.log(`::notice title=rerun-main::${line.replace(/[\r\n%]/g, ' ')}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  cli().catch((err) => {
    console.error(`rerun-main: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
