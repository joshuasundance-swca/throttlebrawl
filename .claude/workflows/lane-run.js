export const meta = {
  name: 'lane-run',
  description:
    'Build independent branches, then hand explicit results to the coordinator for integration and one live check',
  whenToUse:
    'For useful independent work only: pass args { lanes: [{ key, brief, ownedPaths, needs?, model?, effort? }], builderModel, builderEffort?, reportDirectory, maxBuilders? }. reportDirectory is an absolute ignored directory in the launch checkout. The coordinator owns CI, landing and the live check.',
  phases: [{ title: 'Build', detail: 'independent worktrees; ready branches and evidence' }],
};

/* global args, agent, parallel, phase, log -- provided by the Claude Code workflow runtime */
// Every agent already has AGENTS.md loaded. This script holds the run's shape only; rules live in AGENTS.md.
// No absolute paths, usernames or machine names here: the repo is public.

const lanes = args && Array.isArray(args.lanes) ? args.lanes : [];
if (!lanes.length) throw new Error('args.lanes must be a non-empty array of { key, brief }');
const builderModel = args && args.builderModel;
if (typeof builderModel !== 'string' || !builderModel.trim())
  throw new Error('args.builderModel must explicitly name the execution model');
const builderEffort = args.builderEffort ?? 'medium';
const REPORTS = args.reportDirectory;
if (
  typeof REPORTS !== 'string' ||
  !/^(?:[a-z]:[\\/]|\/)/i.test(REPORTS) ||
  REPORTS.split(/[\\/]/).includes('..')
)
  throw new Error('args.reportDirectory must be an absolute launch-checkout report directory');
const reportPath = (key) => REPORTS.replace(/[\\/]+$/, '') + '/' + key + '-report.md';
const normalPath = (p) => String(p).replace(/\\/g, '/');
const POOL = args.maxBuilders ?? 2;
if (!Number.isInteger(POOL) || POOL < 1 || POOL > 5)
  throw new Error('args.maxBuilders must be an integer from 1 to 5, within the active harness capacity');
const seen = new Set();
const ownership = [];
for (const l of lanes) {
  if (!l || !/^[a-z0-9][a-z0-9-]*$/.test(String(l.key)) || typeof l.brief !== 'string' || !l.brief.trim()) {
    throw new Error('each lane needs a lowercase key (letters, digits, dashes) and a non-empty brief');
  }
  if (seen.has(l.key)) throw new Error('duplicate lane key: ' + l.key);
  seen.add(l.key);
  if (!Array.isArray(l.ownedPaths) || !l.ownedPaths.length)
    throw new Error('lane ' + l.key + ': ownedPaths must name files or folders');
  for (const p of l.ownedPaths) {
    if (
      typeof p !== 'string' ||
      !p.trim() ||
      /[\\:*?]|^\//.test(p) ||
      p.split('/').some((s) => s === '..' || s === '.')
    )
      throw new Error('lane ' + l.key + ': ownedPaths must be literal repo-relative files or folders');
    const key = p.replace(/\/+$/, '').toLowerCase();
    if (
      !key ||
      ownership.some((x) => x.key === key || x.key.startsWith(key + '/') || key.startsWith(x.key + '/'))
    )
      throw new Error('lane ' + l.key + ': ownedPaths overlap another allocation');
    ownership.push({ key, lane: l.key });
  }
  if (typeof (l.model ?? builderModel) !== 'string' || !(l.model ?? builderModel).trim())
    throw new Error('lane ' + l.key + ': model must name an execution model');
  if (!['low', 'medium', 'high'].includes(l.effort ?? builderEffort))
    throw new Error('lane ' + l.key + ': effort must be low, medium or high');
}
// A lane may name one lane it `needs` (that lane's unmerged work). It starts when the parent lane has
// finished, builds on the parent's ready branch, then hands back without waiting for its merge
// (AGENTS.md, "A lane that needs another lane's unmerged work").
for (const l of lanes) {
  if (l.needs === undefined) continue;
  if (typeof l.needs !== 'string' || !seen.has(l.needs) || l.needs === l.key)
    throw new Error('lane ' + l.key + ': needs must be the key of another lane in this run');
  const chain = new Set([l.key]);
  for (let k = l.needs; k; k = (lanes.find((x) => x.key === k) || {}).needs) {
    if (chain.has(k)) throw new Error('lane ' + l.key + ': needs makes a cycle');
    chain.add(k);
  }
}

const LANE_OUT = {
  type: 'object',
  properties: {
    prs: { type: 'array', items: { type: 'integer' } },
    branch: { type: 'string' },
    ready: { type: 'boolean' },
    reportPath: { type: 'string' },
    summary: { type: 'string', maxLength: 900 },
    worktree: { type: 'string' },
    head: { type: 'string' },
    base: { type: 'string' },
    checks: { type: 'array', items: { type: 'string' } },
    diagnostics: { type: 'array', items: { type: 'string' } },
    missingWork: { type: 'array', items: { type: 'string' } },
    processes: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'prs',
    'branch',
    'ready',
    'reportPath',
    'summary',
    'worktree',
    'head',
    'base',
    'checks',
    'diagnostics',
    'missingWork',
    'processes',
  ],
};
let running = 0;
const waiters = [];
async function acquire() {
  if (running < POOL) {
    running++;
    return;
  }
  await new Promise((r) => waiters.push(r));
}
function release() {
  const next = waiters.shift();
  // Hand the reserved slot directly to a waiter; a new dependent must not steal it.
  if (next) next();
  else running--;
}

// An agent call may have edited files before throwing. The coordinator reconciles any failure
// before redispatch; matching error text is never proof that no worker started.
function hasHandoff(r, key) {
  return (
    r &&
    r.ready === true &&
    r.branch &&
    r.worktree &&
    /^[a-f0-9]{40}$/.test(r.head) &&
    /^[a-f0-9]{40}$/.test(r.base) &&
    normalPath(r.reportPath) === normalPath(reportPath(key)) &&
    ['checks', 'diagnostics', 'missingWork', 'processes'].every((k) => Array.isArray(r[k]))
  );
}

function lanePrompt(l, parent) {
  const onParent = parent
    ? '; this lane needs lane ' +
      l.needs +
      "'s ready branch " +
      parent.branch +
      ': build on that branch with git switch --no-track -c <your branch> <parent branch>. Build and test, then return your ready branch and report. Do not open a dependent PR or wait for the merge in this worker. The coordinator opens it against main only after the parent is MERGED, after merging origin/main into your branch and rerunning affected checks.'
    : '';
  return (
    'Follow AGENTS.md (already loaded); your task: ' +
    l.brief.trim() +
    onParent +
    "; you are not alone in the codebase: do not revert another lane's edits. Own only " +
    l.ownedPaths.join(', ') +
    '. No browser or dev server. Write your full report to ' +
    reportPath(l.key) +
    " in the launch checkout before returning; if that boundary refuses the write, report not ready. Include owned files, check results, diagnostic paths and running process IDs/stop commands in that report. Return the exact worktree, branch, head/base, readiness, PRs if any, report path, checks, diagnostics, missingWork and processes. Follow your harness's push boundary; a dependent ready branch is a handoff, not a reason to wait for CI."
  );
}

phase('Build');
const laneRuns = new Map(); // key -> promise of that lane's result, so a dependent lane can await its parent
function runLane(l) {
  if (!laneRuns.has(l.key)) laneRuns.set(l.key, runLaneOnce(l));
  return laneRuns.get(l.key);
}
async function runLaneOnce(l) {
  // Wait for the parent before taking a pool slot, so a waiting lane never holds one.
  let parent = null;
  if (l.needs) {
    parent = await runLane(lanes.find((x) => x.key === l.needs));
    if (!parent.ready || !parent.branch || !parent.reportPath)
      return {
        key: l.key,
        prs: [],
        branch: '',
        ready: false,
        reportPath: '',
        summary: 'not started: lane ' + l.needs + ' supplied no ready branch and report',
      };
  }
  await acquire();
  try {
    const r = await agent(lanePrompt(l, parent), {
      label: 'lane ' + l.key,
      phase: 'Build',
      model: l.model ?? builderModel,
      effort: l.effort ?? builderEffort,
      isolation: 'worktree',
      schema: LANE_OUT,
    });
    return r
      ? { ...r, key: l.key, ownedPaths: l.ownedPaths, ready: Boolean(hasHandoff(r, l.key)) }
      : {
          key: l.key,
          prs: [],
          branch: '',
          ready: false,
          reportPath: '',
          summary: 'no result (skipped or died)',
        };
  } catch (e) {
    return {
      key: l.key,
      prs: [],
      branch: '',
      ready: false,
      reportPath: '',
      summary: 'error: ' + String(e).slice(0, 300),
    };
  } finally {
    release();
  }
}
const built = (await parallel(lanes.map((l) => () => runLane(l)))).filter(Boolean);
const missing = built.filter((r) => !r.ready || !r.branch || !r.reportPath).map((r) => r.key);
if (missing.length) log('lanes without ready branches and evidence: ' + missing.join(', '));
// Returning from this workflow means only that the build phase ended. It is never integration acceptance.
return {
  lanes: built,
  integrationRequired: true,
  liveCheckRequired: true,
  evidenceVerificationRequired: true,
  missing,
};
