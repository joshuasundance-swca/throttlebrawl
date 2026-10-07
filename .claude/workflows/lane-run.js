export const meta = {
  name: 'lane-run',
  description:
    'Build independent branches, then hand explicit results to the coordinator for integration and one live check',
  whenToUse:
    'Pass args { lanes: [{ key, brief, needs? }], builderModel, maxBuilders? }. The coordinator selects the execution model and owns CI, landing and the live check.',
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
const POOL = args.maxBuilders ?? 2;
if (!Number.isInteger(POOL) || POOL < 1 || POOL > 5)
  throw new Error('args.maxBuilders must be an integer from 1 to 5, within the active harness capacity');
const seen = new Set();
for (const l of lanes) {
  if (!l || !/^[a-z0-9][a-z0-9-]*$/.test(String(l.key)) || typeof l.brief !== 'string' || !l.brief.trim()) {
    throw new Error('each lane needs a lowercase key (letters, digits, dashes) and a non-empty brief');
  }
  if (seen.has(l.key)) throw new Error('duplicate lane key: ' + l.key);
  seen.add(l.key);
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

const REPORTS = 'scratch/m2/lanes/';
const LANE_OUT = {
  type: 'object',
  properties: {
    prs: { type: 'array', items: { type: 'integer' } },
    branch: { type: 'string' },
    ready: { type: 'boolean' },
    reportPath: { type: 'string' },
    summary: { type: 'string', maxLength: 900 },
  },
  required: ['prs', 'branch', 'ready', 'reportPath', 'summary'],
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

// Worktree creation sometimes fails when many start at once; retry those, nothing else.
async function withRetry(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i < 2 && /WorktreeIsolation|git metadata/i.test(String(e))) {
        log('worktree creation failed; retrying');
        continue;
      }
      throw e;
    }
  }
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
    "; do not edit another lane's files. No browser or dev server. Write your report to " +
    REPORTS +
    l.key +
    "-report.md before returning. Return your exact branch, readiness, PRs if any and report path. Follow your harness's push boundary; a dependent ready branch is a handoff, not a reason to wait for CI."
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
    const r = await withRetry(() =>
      agent(lanePrompt(l, parent), {
        label: 'lane ' + l.key,
        phase: 'Build',
        model: builderModel,
        effort: 'high',
        isolation: 'worktree',
        schema: LANE_OUT,
      }),
    );
    return r
      ? { ...r, key: l.key }
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
  missing,
};
