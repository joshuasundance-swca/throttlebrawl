export const meta = {
  name: 'lane-run',
  description:
    'A throttlebrawl run: a pool of 5 build lanes that end at push, one keeper that lands every PR of the run and owns main, then one live check of the game link',
  whenToUse:
    'Launching a batch of build lanes. Pass args { lanes: [{ key, brief, needs? }], t0 } where t0 is an ISO time just before launch; PRs created after it belong to this run.',
  phases: [
    { title: 'Build', detail: 'pool of 5 lanes in worktrees; each ends at push' },
    { title: 'Keep', detail: 'one keeper lands every PR created after t0 and owns main' },
    { title: 'Check', detail: "one live check of the game link, in the run's one browser slot" },
  ],
};

/* global args, agent, parallel, phase, log -- provided by the Claude Code workflow runtime */
// Every agent already has AGENTS.md loaded. This script holds the run's shape only; rules live in AGENTS.md.
// No absolute paths, usernames or machine names here: the repo is public.

const lanes = args && Array.isArray(args.lanes) ? args.lanes : [];
const T0 = args && typeof args.t0 === 'string' ? args.t0 : '';
if (!lanes.length) throw new Error('args.lanes must be a non-empty array of { key, brief }');
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(T0))
  throw new Error('args.t0 must be an ISO UTC time such as 2026-10-03T17:10:00Z');
const seen = new Set();
for (const l of lanes) {
  if (!l || !/^[a-z0-9][a-z0-9-]*$/.test(String(l.key)) || typeof l.brief !== 'string' || !l.brief.trim()) {
    throw new Error('each lane needs a lowercase key (letters, digits, dashes) and a non-empty brief');
  }
  if (seen.has(l.key)) throw new Error('duplicate lane key: ' + l.key);
  seen.add(l.key);
}
// A lane may name one lane it `needs` (that lane's unmerged work). It starts when the parent lane has
// finished, builds on the parent's branch, and waits for the parent's merge only before it opens its PR
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
    reportPath: { type: 'string' },
    summary: { type: 'string', maxLength: 900 },
  },
  required: ['prs', 'reportPath', 'summary'],
};
const KEEP_OUT = {
  type: 'object',
  properties: {
    merged: { type: 'array', items: { type: 'integer' } },
    notMerged: { type: 'array', items: { type: 'string', maxLength: 300 } },
    mainGreen: { type: 'boolean' },
    liveSha: { type: 'string' },
    reportPath: { type: 'string' },
  },
  required: ['merged', 'notMerged', 'mainGreen', 'liveSha', 'reportPath'],
};
const CHECK_OUT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', maxLength: 200 },
    mustFix: { type: 'array', items: { type: 'string', maxLength: 500 } },
    unverified: { type: 'array', items: { type: 'string', maxLength: 300 } },
    reportPath: { type: 'string' },
  },
  required: ['verdict', 'mustFix', 'unverified', 'reportPath'],
};

// A pool of 5 lanes at a time.
const POOL = 5;
let running = 0;
const waiters = [];
async function acquire() {
  if (running < POOL) {
    running++;
    return;
  }
  await new Promise((r) => waiters.push(r));
  running++;
}
function release() {
  running--;
  const next = waiters.shift();
  if (next) next();
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
      "'s unmerged work (its PR: " +
      parent.prs.map((n) => '#' + n).join(', ') +
      "): follow the AGENTS.md rule for it: git switch --no-track -c <your branch> origin/<that PR's head branch> (gh pr view <n> --json headRefName,state), build and test there, push with git push -u origin HEAD, and open your own PR against main only after that PR is MERGED (wait synchronously), after merging origin/main into your branch"
    : '';
  return (
    'Follow AGENTS.md (already loaded); your task: ' +
    l.brief.trim() +
    onParent +
    '; write your report to ' +
    REPORTS +
    l.key +
    '-report.md; end at push'
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
    if (!parent.prs || !parent.prs.length)
      return {
        key: l.key,
        prs: [],
        reportPath: '',
        summary: 'not started: lane ' + l.needs + ' opened no PR',
      };
  }
  await acquire();
  try {
    const r = await withRetry(() =>
      agent(lanePrompt(l, parent), {
        label: 'lane ' + l.key,
        phase: 'Build',
        model: 'opus',
        effort: 'high',
        isolation: 'worktree',
        schema: LANE_OUT,
      }),
    );
    return r
      ? { ...r, key: l.key }
      : { key: l.key, prs: [], reportPath: '', summary: 'no result (skipped or died)' };
  } catch (e) {
    return { key: l.key, prs: [], reportPath: '', summary: 'error: ' + String(e).slice(0, 300) };
  } finally {
    release();
  }
}
const lanesP = parallel(lanes.map((l) => () => runLane(l)));

const keeperP = withRetry(() =>
  agent(
    'Follow AGENTS.md (already loaded). You are the KEEPER of this run, not a build lane (AGENTS.md, "Runs: lanes, one keeper, one live check").\n' +
      'Land every PR on a lane/* branch created after ' +
      T0 +
      ' (gh pr list --search "created:>' +
      T0 +
      '"), including PRs opened while you work; the build lanes end at push.\n' +
      "- A lane that needs another lane opens its PR only once that lane's PR has merged (AGENTS.md); keep watching for such PRs while any lane is still running.\n" +
      '- A PR red only because of main: once main is green, gh pr update-branch.\n' +
      '- A PR red on its own change: fix it on its branch; its lane report is in ' +
      REPORTS +
      "<key>-report.md (or in that lane's worktree).\n" +
      '- A conflict: merge origin/main and resolve it, keeping both intents. Contract PRs land first.\n' +
      '- Main red: fix it forward or revert the culprit, in one small PR.\n' +
      "Stop when no PR from this run has been open for 45 minutes, every one is merged or truly blocked (say why), and main is green. Then record main's CI run and the commit the live game serves.\n" +
      'Write your report to ' +
      REPORTS +
      'keeper-report.md.',
    {
      label: 'keeper',
      phase: 'Keep',
      model: 'opus',
      effort: 'high',
      isolation: 'worktree',
      schema: KEEP_OUT,
    },
  ),
)
  .then(
    (r) =>
      r || { merged: [], notMerged: ['keeper: no result'], mainGreen: false, liveSha: '', reportPath: '' },
  )
  .catch((e) => ({
    merged: [],
    notMerged: ['keeper error: ' + String(e).slice(0, 250)],
    mainGreen: false,
    liveSha: '',
    reportPath: '',
  }));

const [laneResults, keeper] = await Promise.all([lanesP, keeperP]);
const built = laneResults.filter(Boolean);
const failed = built.filter((r) => !r.prs || !r.prs.length).map((r) => r.key);
if (failed.length) log('lanes with no PR: ' + failed.join(', '));

phase('Check');
const check = await agent(
  'Follow AGENTS.md (already loaded). You are the ONE LIVE CHECK of this run: refute is your default; no fixes, no PRs.\n' +
    'What the run built: ' +
    JSON.stringify(
      built.map((r) => ({ lane: r.key, prs: r.prs, summary: String(r.summary).slice(0, 280) })),
    ).slice(0, 6000) +
    '\n' +
    'Keeper: ' +
    JSON.stringify(keeper).slice(0, 700) +
    '\n' +
    "The game link is in README.md. Wait until it serves origin/main's head (follow redirects; poll synchronously for up to 45 minutes).\n" +
    "You hold the run's one browser slot: drive ONE headless playwright-core Chromium with the GPU, from a throwaway script under scratch/, at a 915x412 touch viewport; never the Playwright MCP tools. Close it when done.\n" +
    'Ride each new feature the lanes report. List as mustFix only defects you reproduced, with steps; list what you could not check as unverified. Name the device, renderer and scene for any performance number.\n' +
    'Write your report to ' +
    REPORTS +
    'check-report.md.',
  { label: 'live check', phase: 'Check', model: 'opus', effort: 'xhigh', schema: CHECK_OUT },
).catch((e) => ({
  verdict: 'ERROR',
  mustFix: [],
  unverified: ['the whole check: ' + String(e).slice(0, 250)],
  reportPath: '',
}));

return { lanes: built, keeper, check };
