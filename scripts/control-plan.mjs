// Diagnostic branch controls never accept a tree. Uncertainty retains the full control suite.
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { selectControlJobs } from './control-selection.mjs';
import { suiteJobs } from './shard-plan.mjs';

const SHA = /^[0-9a-f]{40}$/;
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const full = (reason) => ({ scope: 'full', selection: null, jobs: [], reason });

export function controlInventory(shape) {
  for (const tier of ['unit', 'sim', 'e2e'])
    if (!integer(shape?.[tier]?.slices)) throw new Error('invalid suite inventory');
  return [
    'suite / static',
    ...['unit', 'sim', 'browser'].flatMap((tier) => {
      const total = shape[tier === 'browser' ? 'e2e' : tier].slices;
      return Array.from({ length: total }, (_, i) => `suite / ${tier} (${i + 1}/${total})`);
    }),
  ];
}

/** Complete current-attempt jobs, bounded by requests and monotonic time. API is injectable. */
export async function collectControlPlan({
  repo,
  sha,
  runId,
  attempt,
  shape,
  api,
  now = () => performance.now(),
  budgetMs = 45_000,
}) {
  const deadline = now() + budgetMs;
  let requests = 0;
  const get = async (path) => {
    const remaining = deadline - now();
    if (++requests > 12 || remaining <= 0) throw new Error('observation budget exhausted');
    const value = await api(path, AbortSignal.timeout(Math.max(1, Math.floor(Math.min(5_000, remaining)))));
    if (now() >= deadline) throw new Error('observation deadline passed');
    return value;
  };
  try {
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') ||
      !SHA.test(sha ?? '') ||
      !integer(runId) ||
      !integer(attempt)
    )
      return full('invalid run identity');
    const expectedNames = controlInventory(shape);
    const root = `/repos/${repo}/actions/runs/${runId}`;
    const validRun = (run) =>
      run?.id === runId &&
      run.run_attempt === attempt &&
      run.head_sha === sha &&
      run.head_branch === 'main' &&
      run.path === '.github/workflows/train.yml' &&
      run.repository?.full_name === repo &&
      run.head_repository?.full_name === repo;
    if (!validRun(await get(root))) return full('run identity did not match');
    const jobs = [];
    let total;
    for (let page = 1; ; page++) {
      const data = await get(`${root}/attempts/${attempt}/jobs?per_page=100&page=${page}`);
      if (
        !Number.isSafeInteger(data?.total_count) ||
        data.total_count < 0 ||
        !Array.isArray(data.jobs) ||
        data.jobs.length > 100 ||
        (total !== undefined && data.total_count !== total)
      )
        return full('unstable job collection');
      total = data.total_count;
      jobs.push(...data.jobs);
      if (jobs.length > total) return full('job collection exceeded total');
      if (jobs.length === total) break;
      if (data.jobs.length !== 100) return full('job collection was truncated');
    }
    if (!validRun(await get(root))) return full('run identity changed during observation');
    const chosen = selectControlJobs({ expectedNames, runId, attempt, totalCount: total, jobs });
    if (chosen.scope !== 'targeted') return full(chosen.reason);
    const totals = { unit: shape.unit.slices, sim: shape.sim.slices, browser: shape.e2e.slices };
    const selection = {
      static: chosen.jobs.includes('suite / static'),
      unit: [],
      sim: [],
      browser: [],
      totals,
    };
    for (const tier of ['unit', 'sim', 'browser'])
      for (let i = 1; i <= totals[tier]; i++)
        if (chosen.jobs.includes(`suite / ${tier} (${i}/${totals[tier]})`)) selection[tier].push(i);
    return { ...chosen, selection };
  } catch {
    return full('observation unavailable or incomplete');
  }
}

async function main() {
  let result = full('observation unavailable');
  const token = process.env.GH_TOKEN;
  if (token) {
    try {
      result = await collectControlPlan({
        repo: process.env.GITHUB_REPOSITORY,
        sha: process.env.GITHUB_SHA,
        runId: Number(process.env.GITHUB_RUN_ID),
        attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        shape: suiteJobs(readFileSync(new URL('../.github/workflows/suite.yml', import.meta.url), 'utf8')),
        api: async (path, signal) => {
          const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
            headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
            signal,
          });
          if (!response.ok) throw new Error('API unavailable');
          return response.json();
        },
      });
    } catch {
      /* Unreadable canonical workflow retains full diagnostics. */
    }
  }
  console.log(`branch control: ${result.scope}`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `scope=${result.scope}\nselection=${result.selection ? JSON.stringify(result.selection) : ''}\njobs=${JSON.stringify(result.jobs)}\n`,
    );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
