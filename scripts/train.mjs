#!/usr/bin/env node
// The bundle train (docs/engineering.md, "The bundle train"). [decided] (the maintainer,
// 2026-10-02: "Yes, build it"; parked as a draft that day, and revived on 2026-10-05: "Revive the
// train instead of limiting parallel lanes"): every PR gets a quick check; ready PRs ride a train
// together, and the full suite runs ONCE on the combination. Green: they all land. Red: the
// bundle splits to find the culprit, and the rest still land. Main keeps running the full suite
// after every landing, as a backstop.
//
//   node scripts/train.mjs route       ci.yml on a pull request: which path the PR takes
//                                      (train: the quick check now, the full suite in a train;
//                                      docs: the quick check is its gate; full: the full gate,
//                                      per PR, as before the train)
//   node scripts/train.mjs plan        train.yml: who rides, and the tree they make together
//   node scripts/train.mjs assemble --base <sha> --heads "<sha> ..." [--tree <sha>]
//                                      every job of a train's suite: rebuild exactly that tree
//   node scripts/train.mjs announce    train.yml: "riding" statuses, and conflicts
//   node scripts/train.mjs report      train.yml: post the results, wait for the landing, and
//                                      send the next train
//   node scripts/train.mjs failures    ci.yml's gate, when it is red: name the red suite jobs and
//                                      their failing tests (fail fast leaves the red job cancelled)
//
// THE LANDING INVARIANT. A set of PRs gets `gate` = success only if exactly (main when the train
// departed + that set, merged in that order) passed the full suite, AND main has not moved since,
// AND every PR of the set still has the head commit that was tested (and is open, not a draft,
// with auto-merge armed). Anything else posts no success, and a new train departs.
//
// STATE. A PR's place in the train lives in the `gate` commit status on its head commit, the one
// check branch protection requires: no status = new; pending = waiting or riding, and its
// description ends with "[cap N]", the biggest bundle it may ride in next; success = passed (auto-
// merge lands it); failure = failed or conflicts (a new push rides again). A new push is a new
// head commit with no status, so it simply waits for a later train. Nothing else is stored: every
// train run plans from scratch, so a waiting run that GitHub's concurrency group replaces with a
// newer one loses nothing.
//
// RED. A red bundle of n PRs drops each of them to cap ceil(n/2), so the next trains test the
// older half first, on the then-current main, and whatever passes lands. A PR that fails alone on
// the current main (cap 1) gets `gate` = failure and a comment naming the failing tests; a second
// suite on its own branch says whether it fails there too or only on top of what landed (a
// composition failure). Each red strictly lowers a head commit's cap (8, 4, 2, 1), so a commit
// rides at most four red trains before it lands or fails.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, stripVTControlCharacters } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CONTEXT = 'gate';
export const QUICK = 'quick';
export const CONFIG_FILE = '.github/train.json';
export const MARKER = /\[full-gate\]/i;
const SHA = /^[0-9a-f]{40}$/;
/** Conclusions of main's own ci run that mean main is red. A cancelled run was superseded. */
const RED = new Set(['failure', 'timed_out', 'startup_failure']);
/** The train's merge commits: a no-reply identity, so the leak scan's identity check accepts them. */
export const TRAIN_IDENT = {
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
};

// ---------------------------------------------------------------------------------------------
// Config and routing

/**
 * .github/train.json. `live` false keeps every PR on the full per-PR gate (the train only plans,
 * in a dry run). Out-of-range numbers fall back to the defaults.
 * @param {string} text
 */
export function readConfig(text) {
  const raw = JSON.parse(text);
  const whole = (/** @type {unknown} */ v, /** @type {number} */ d, /** @type {number} */ min) =>
    Number.isInteger(v) && /** @type {number} */ (v) >= min ? /** @type {number} */ (v) : d;
  return {
    live: raw.live === true,
    cap: whole(raw.cap, 8, 1),
    landingMinutes: whole(raw.landingMinutes, 10, 1),
    mainWaitMinutes: whole(raw.mainWaitMinutes, 15, 0),
  };
}

export function loadConfig(dir = root) {
  const file = path.join(dir, CONFIG_FILE);
  return readConfig(existsSync(file) ? readFileSync(file, 'utf8') : '{}');
}

/** The escape hatch: "[full-gate]" in the PR's title or body asks for the full per-PR gate. */
export function hasMarker(title = '', body = '') {
  return MARKER.test(title ?? '') || MARKER.test(body ?? '');
}

const DOCS = [/^docs\//, /^changes\//, /\.md$/];
/** A change needs no sim or browser tier when every file it touches is under docs/, changes/ or a .md file. */
export function isDocsOnly(/** @type {string[]} */ files) {
  return files.length > 0 && files.every((f) => DOCS.some((re) => re.test(f)));
}

/**
 * Which path a pull request takes.
 * @param {{ live: boolean, fork: boolean, author: string, title: string, body: string, files: string[] }} pr
 * @returns {{ path: 'train' | 'docs' | 'full', reason: string }}
 */
export function route({ live, fork, author, title, body, files }) {
  if (!live)
    return {
      path: 'full',
      reason: `the train is off (${CONFIG_FILE}), so every PR runs the full gate itself`,
    };
  if (fork) return { path: 'full', reason: 'a PR from a fork runs the full gate itself' };
  if (author === 'dependabot[bot]')
    return { path: 'full', reason: 'a Dependabot PR runs the full gate itself' };
  if (hasMarker(title, body)) return { path: 'full', reason: 'the PR asks for the full gate ([full-gate])' };
  const ci = files.filter((f) => f.startsWith('.github/'));
  if (ci.length)
    return {
      path: 'full',
      reason: `it changes CI itself (${ci[0]}${ci.length > 1 ? ` and ${ci.length - 1} more` : ''}), and a train runs main's workflows, not the PR's`,
    };
  if (files.length === 0)
    return { path: 'full', reason: 'no changed files found; when unsure, run everything' };
  if (isDocsOnly(files))
    return {
      path: 'docs',
      reason: `docs only (${files.length} file(s) under docs/, changes/ or *.md): the quick check is its gate`,
    };
  return {
    path: 'train',
    reason: `${files.length} changed file(s): the quick check now, the full suite in a train`,
  };
}

// ---------------------------------------------------------------------------------------------
// State in the `gate` status

const CAP_TOKEN = / \[cap (\d+)\]$/;
const MAX_DESCRIPTION = 140;

/** Shortens text to n characters, ending with "..." when cut. */
export function clip(/** @type {string} */ text, n = MAX_DESCRIPTION) {
  return text.length <= n ? text : `${text.slice(0, n - 3)}...`;
}

/** A pending description that carries the PR's cap, within GitHub's 140 characters. */
export function withCap(/** @type {string} */ text, /** @type {number} */ cap) {
  const tail = ` [cap ${cap}]`;
  return clip(text, MAX_DESCRIPTION - tail.length) + tail;
}

export function capOf(/** @type {string | undefined} */ description) {
  const m = CAP_TOKEN.exec(description ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * A head commit's place in the train, from its latest `gate` status.
 * @param {{ state: string, description: string } | null} status
 * @param {number} cap the configured cap (an old, bigger cap is clamped to it)
 */
export function stateOf(status, cap) {
  if (!status) return { kind: 'none', cap };
  if (status.state === 'pending')
    return { kind: 'pending', cap: Math.max(1, Math.min(capOf(status.description) ?? cap, cap)) };
  if (status.state === 'success') return { kind: 'success', cap: 0 };
  return { kind: 'failure', cap: 0 }; // failure, or error
}

/** "#1 #2 #3", shortened to fit. */
export function prList(/** @type {number[]} */ numbers, max = 60) {
  const all = numbers.map((n) => `#${n}`);
  let out = '';
  for (const [i, s] of all.entries()) {
    const next = out ? `${out} ${s}` : s;
    const rest = all.length - i - 1;
    if (next.length + (rest ? ` +${rest} more`.length : 0) > max) return `${out} +${all.length - i} more`;
    out = next;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Who rides

/**
 * One open PR from the GraphQL listing (see PRS_QUERY), flattened.
 * @param {any} node
 */
export function normalizePr(node) {
  const commit = node.commits?.nodes?.[0]?.commit;
  const rollup = commit?.oid === node.headRefOid ? commit?.statusCheckRollup?.contexts : null;
  /** @type {any[]} */
  const contexts = rollup?.nodes ?? [];
  // A list cut short could hide a `gate` failure, so a PR whose list is longer than one page
  // never rides (eligibility says why).
  const truncated = Number(rollup?.totalCount ?? contexts.length) > contexts.length;
  const runs = contexts.filter(
    (/** @type {any} */ c) => c.__typename === 'CheckRun' && c.checkSuite?.app?.slug === 'github-actions',
  );
  const latest = (/** @type {string} */ name) =>
    runs
      .filter((/** @type {any} */ r) => r.name === name)
      .sort((/** @type {any} */ a, /** @type {any} */ b) =>
        String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')),
      )[0];
  const quick = latest(QUICK);
  const status = contexts.find(
    (/** @type {any} */ c) => c.__typename === 'StatusContext' && c.context === CONTEXT,
  );
  return {
    number: /** @type {number} */ (node.number),
    draft: Boolean(node.isDraft),
    title: String(node.title ?? ''),
    body: String(node.body ?? ''),
    author: String(node.author?.login ?? ''),
    headSha: String(node.headRefOid),
    headRepo: String(node.headRepository?.nameWithOwner ?? ''),
    autoMerge: node.autoMergeRequest != null,
    quick: quick
      ? quick.status === 'COMPLETED'
        ? String(quick.conclusion ?? '').toLowerCase()
        : 'pending'
      : 'none',
    gateCheck: Boolean(latest(CONTEXT)),
    truncated,
    gateStatus: status
      ? { state: String(status.state).toLowerCase(), description: String(status.description ?? '') }
      : null,
  };
}

/**
 * Can this PR ride the next train? Same repo, not a draft, auto-merge armed, no escape-hatch
 * marker, a green quick check on its head commit, no `gate` check run there (one source of `gate`
 * per head commit), and its `gate` status absent or pending.
 * @param {ReturnType<typeof normalizePr>} pr
 * @param {{ repo: string, cap: number }} o
 * @returns {{ ok: true, cap: number, reason: string } | { ok: false, reason: string }}
 */
export function eligibility(pr, { repo, cap }) {
  const no = (/** @type {string} */ reason) => ({ ok: /** @type {const} */ (false), reason });
  if (pr.headRepo !== repo) return no('from a fork (it runs the full gate itself)');
  if (pr.draft) return no('a draft');
  if (!pr.autoMerge) return no('auto-merge is not armed');
  if (hasMarker(pr.title, pr.body)) return no('asks for the full gate ([full-gate])');
  if (pr.truncated) return no('its head commit has over 100 checks and statuses, too many to read safely');
  if (pr.gateCheck) return no('its head commit already has a gate check (the full or docs path)');
  if (pr.quick !== 'success') return no(`its quick check is ${pr.quick}`);
  const s = stateOf(pr.gateStatus, cap);
  if (s.kind === 'success') return no('passed a train (landing)');
  if (s.kind === 'failure') return no('failed a train or conflicts (a new push rides again)');
  return { ok: true, cap: s.cap, reason: s.kind === 'pending' ? `waiting, cap ${s.cap}` : 'new' };
}

/**
 * The next bundle: the PRs with the smallest cap (a red bundle's halves go first), oldest (lowest
 * number) first, at most that many. It departs with whatever is eligible; it never waits to fill.
 * @param {{ number: number, headSha: string, cap: number }[]} eligible
 */
export function selectBundle(eligible) {
  if (!eligible.length) return { bundle: [], cap: 0 };
  const sorted = [...eligible].sort((a, b) => a.number - b.number);
  const cap = Math.min(...sorted.map((e) => e.cap));
  return { bundle: sorted.filter((e) => e.cap === cap).slice(0, cap), cap };
}

/**
 * May a train depart, given main's own newest ci run (a push) on main's newest commit? A red
 * bundle on a red main would say nothing about its PRs, so the train waits while main is red.
 * rerun-main.yml re-runs a red first attempt once (a flake); `watch` then names the run whose
 * re-run the train's wait-main job watches before it sends the next train itself (whether a run
 * re-run with GitHub's own token fires workflow_run is unverified). A dry run always departs.
 * @param {{ id: number, state: 'success' | 'failure' | 'pending' | 'none', attempt: number } | null} main
 * @param {boolean} dry
 * @returns {{ go: true, why: string } | { go: false, watch: number | null, why: string }}
 */
export function mainGate(main, dry) {
  if (dry || !main) return { go: true, why: main ? 'a dry run' : 'main has no ci run of its own yet' };
  if (main.state === 'failure' && main.attempt === 1)
    return {
      go: false,
      watch: main.id,
      why: `main is red (ci run ${main.id}); rerun-main.yml re-runs its failed jobs once, in case it was a flake, and the train waits for that attempt`,
    };
  if (main.state === 'failure')
    return {
      go: false,
      watch: null,
      why: `main is red again on attempt ${main.attempt} (ci run ${main.id}); the train waits for a fix, which the keeper lands with [full-gate]`,
    };
  if (main.state === 'pending' && main.attempt > 1)
    return {
      go: false,
      watch: main.id,
      why: `main failed and its failed jobs are running again (ci run ${main.id}, attempt ${main.attempt}); the train waits for that result`,
    };
  return { go: true, why: `main's own ci run is ${main.state}` };
}

// ---------------------------------------------------------------------------------------------
// The tree a train tests

/**
 * Merges each head onto base in order, without a working tree (`git merge-tree --write-tree`, the
 * same merge machinery as `git merge`), and records each step as a merge commit with a fixed
 * identity and date, so every job that runs this with the same inputs makes the same commits and
 * the same tree. A head that does not merge cleanly is left out: `with` says whether it conflicts
 * with main itself or only with an earlier head of this bundle.
 * @param {(args: string[], env?: Record<string, string>) => { status: number | null, stdout: string, stderr: string }} run git
 * @param {string} base
 * @param {string[]} heads
 */
export function assemble(run, base, heads) {
  const ok = (/** @type {string[]} */ args, /** @type {Record<string, string>} */ env = {}) => {
    const r = run(args, env);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  const when = `@${ok(['show', '-s', '--format=%ct', base])} +0000`;
  const env = {
    GIT_AUTHOR_NAME: TRAIN_IDENT.name,
    GIT_AUTHOR_EMAIL: TRAIN_IDENT.email,
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_NAME: TRAIN_IDENT.name,
    GIT_COMMITTER_EMAIL: TRAIN_IDENT.email,
    GIT_COMMITTER_DATE: when,
  };
  const mergeTree = (/** @type {string} */ a, /** @type {string} */ b) => {
    const r = run(['merge-tree', '--write-tree', '--no-messages', a, b]);
    if (r.status !== 0 && r.status !== 1)
      throw new Error(`git merge-tree ${a} ${b} failed: ${r.stderr.trim()}`);
    return { clean: r.status === 0, tree: r.stdout.trim().split('\n')[0] ?? '' };
  };
  let commit = ok(['rev-parse', '--verify', `${base}^{commit}`]);
  /** @type {string[]} */
  const merged = [];
  /** @type {{ head: string, with: 'main' | 'bundle' }[]} */
  const conflicts = [];
  for (const head of heads) {
    const m = mergeTree(commit, head);
    if (m.clean) {
      commit = ok(
        ['commit-tree', '--no-gpg-sign', m.tree, '-p', commit, '-p', head, '-m', `train: merge ${head}`],
        env,
      );
      merged.push(head);
    } else {
      conflicts.push({ head, with: mergeTree(base, head).clean ? 'bundle' : 'main' });
    }
  }
  return { commit, tree: ok(['rev-parse', `${commit}^{tree}`]), merged, conflicts };
}

// ---------------------------------------------------------------------------------------------
// What a finished train posts

/**
 * The report's decision, from what the train tested and what is true now.
 * @param {object} o
 * @param {string} o.result the suite's result ('success', 'failure', 'cancelled', ...)
 * @param {string} [o.control] a lone PR's own-branch suite result, when it ran
 * @param {{ number: number, headSha: string, cap: number }[]} o.bundle the PRs that rode, in order
 * @param {string} o.base main when the train departed
 * @param {string} o.mainNow main now
 * @param {Map<number, { headSha: string, draft: boolean, autoMerge: boolean }>} o.now the bundle's PRs that are open now
 * @param {'success' | 'failure' | 'pending' | 'none'} [o.mainCi] main's own ci run on base (read only for a lone PR that failed)
 * @param {number} o.run the train's run number
 */
export function decide({ result, control = 'skipped', bundle, base, mainNow, now, mainCi = 'none', run }) {
  const b7 = base.slice(0, 7);
  /** @type {{ number: number, sha: string, state: 'pending' | 'success' | 'failure', description: string }[]} */
  const statuses = [];
  const waitAll = (/** @type {string} */ why, skip = new Set()) => {
    for (const p of bundle)
      if (!skip.has(p.number))
        statuses.push({
          number: p.number,
          sha: p.headSha,
          state: 'pending',
          description: withCap(`train ${run}: ${why}; waits for the next train`, p.cap),
        });
  };
  const base_ = {
    statuses,
    land: /** @type {number[]} */ ([]),
    blame: /** @type {null | { number: number, sha: string, kind: 'own' | 'composition' | 'unknown' }} */ (
      null
    ),
  };

  if (result !== 'success' && result !== 'failure') {
    waitAll(`did not finish (${result})`);
    return {
      ...base_,
      verdict: 'unfinished',
      dispatch: false,
      why: `the suite's result is ${result}, so nothing is concluded; the next trigger plans again`,
    };
  }
  const changed = bundle.filter((p) => {
    const n = now.get(p.number);
    return !n || n.headSha !== p.headSha || n.draft || !n.autoMerge;
  });
  if (changed.length) {
    const names = prList(
      changed.map((p) => p.number),
      30,
    );
    waitAll(`${names} changed`, new Set(changed.map((p) => p.number)));
    return {
      ...base_,
      verdict: 'stale',
      dispatch: true,
      why: `${names} changed during the train (a new push, closed, a draft or auto-merge off), so the tested set is not what would land`,
    };
  }
  if (mainNow !== base) {
    waitAll(`main moved`);
    return {
      ...base_,
      verdict: 'main-moved',
      dispatch: true,
      why: `main moved from ${b7} to ${mainNow.slice(0, 7)} during the train, so nothing tested is what would land`,
    };
  }
  if (result === 'success') {
    const desc = `passed train ${run}: main ${b7} + ${prList(bundle.map((p) => p.number))}`;
    for (const p of bundle)
      statuses.push({ number: p.number, sha: p.headSha, state: 'success', description: clip(desc) });
    return {
      ...base_,
      land: bundle.map((p) => p.number),
      verdict: 'green',
      dispatch: true,
      why: `main ${b7} + ${prList(
        bundle.map((p) => p.number),
        200,
      )} passed the full suite`,
    };
  }
  if (bundle.length > 1) {
    const cap = Math.ceil(bundle.length / 2);
    for (const p of bundle)
      statuses.push({
        number: p.number,
        sha: p.headSha,
        state: 'pending',
        description: withCap(`train ${run} was red with ${bundle.length} PRs; splits`, cap),
      });
    return {
      ...base_,
      verdict: 'split',
      dispatch: true,
      why: `a bundle of ${bundle.length} was red, so each rides next in a bundle of at most ${cap}`,
    };
  }
  const [p] = /** @type {[{ number: number, headSha: string, cap: number }]} */ (bundle);
  if (mainCi === 'failure') {
    statuses.push({
      number: p.number,
      sha: p.headSha,
      state: 'pending',
      description: withCap(`train ${run}: main ${b7} is red; waits`, 1),
    });
    return {
      ...base_,
      verdict: 'main-red',
      dispatch: false,
      why: `#${p.number} failed alone, but main ${b7} is red on its own, so nothing is blamed; the train waits for main`,
    };
  }
  const kind = control === 'success' ? 'composition' : control === 'failure' ? 'own' : 'unknown';
  const where = kind === 'composition' ? 'passes on its branch, fails on main' : 'fails alone on main';
  statuses.push({
    number: p.number,
    sha: p.headSha,
    state: 'failure',
    description: clip(`train ${run}: ${where} ${b7}; see the PR comment`),
  });
  return {
    ...base_,
    blame: { number: p.number, sha: p.headSha, kind },
    verdict: 'culprit',
    dispatch: true,
    why: `#${p.number} failed alone on main ${b7} (${kind})`,
  };
}

/**
 * The failing tests and check rows in a job log: Vitest's "FAIL <file> > <test>" lines,
 * Playwright's "N failed" list, and the FAIL rows of npm run check's summary.
 * @param {string} log
 */
export function failingTests(log) {
  /** @type {string[]} */
  const out = [];
  let inFailed = false;
  for (const raw of log.split(/\r?\n/)) {
    const line = stripVTControlCharacters(raw).replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/, '');
    if (/^\s+\d+ failed\s*$/.test(line)) {
      inFailed = true;
      continue;
    }
    if (inFailed) {
      const m = /^\s{4,}(\[[\w-]+\] › .*?)\s*$/.exec(line);
      if (m?.[1]) {
        out.push(m[1]);
        continue;
      }
      inFailed = false;
    }
    let m = /^\s*FAIL\s+(?:\S+\s+)?(\S+\.(?:test|spec)\.[cm]?[jt]s\b.*?)\s*$/.exec(line);
    if (m?.[1]) out.push(m[1]);
    else if ((m = /^(\S.*?)\s{2,}FAIL\b\s*(.*?)\s*$/.exec(line)))
      out.push(`${m[1]}: FAIL ${m[2] ?? ''}`.trim());
  }
  return [...new Set(out)];
}

/** Text from a log, safe inside a ```text fence in a comment: no backtick runs, bounded. */
export function fenceSafe(/** @type {string[]} */ lines, max = 25) {
  const shown = lines.slice(0, max).map((l) => clip(l.replaceAll('`', "'"), 300));
  if (lines.length > max) shown.push(`... and ${lines.length - max} more`);
  return shown.join('\n');
}

/**
 * A workflow command line (`::error title=...::message`), escaped the runner's way, so a message
 * read from a log is always one line and can never end the command early.
 * @param {string} cmd
 * @param {Record<string, string>} props
 * @param {string} message
 */
export function workflowCommand(cmd, props, message) {
  const data = (/** @type {string} */ s) =>
    s.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  const prop = (/** @type {string} */ s) => data(s).replaceAll(':', '%3A').replaceAll(',', '%2C');
  const p = Object.entries(props)
    .map(([k, v]) => `${k}=${prop(v)}`)
    .join(',');
  return `::${cmd}${p ? ` ${p}` : ''}::${data(message)}`;
}

/**
 * @typedef {{ id?: unknown, name?: unknown, conclusion?: unknown, completed_at?: unknown,
 *   steps?: { name?: unknown, status?: unknown, conclusion?: unknown, completed_at?: unknown }[] }} ApiJob
 */

/**
 * The suite jobs of a run that went red, first red first: a step failed, or the job itself
 * failed. Fail fast (a PR run) cancels the red job's own run, so the red job ends `cancelled`
 * like its siblings and only its failed step tells it apart. Only the suite's own jobs
 * (`suite / ...`), never a train's control suite.
 * @param {ApiJob[]} jobs the run's jobs, as the API lists them
 */
export function redSuiteJobs(jobs) {
  return jobs
    .flatMap((job) => {
      const name = String(job.name ?? '');
      if (!/^suite \/ /.test(name)) return [];
      const step = (job.steps ?? []).find((s) => s.conclusion === 'failure');
      if (!step && job.conclusion !== 'failure') return [];
      return [
        {
          at: String(step?.completed_at ?? job.completed_at ?? ''),
          job: {
            id: Number(job.id),
            name,
            step: step ? String(step.name ?? '') : '',
            cancelled: job.conclusion === 'cancelled',
          },
        },
      ];
    })
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((r) => r.job);
}

/**
 * The suite jobs a cancel cut short: they ended `cancelled` while a step was running. With no red
 * job, that is a job that hit its timeout-minutes (GitHub ends it cancelled), or every job when a
 * newer push replaced the run.
 * @param {ApiJob[]} jobs
 */
export function cutShort(jobs) {
  return jobs
    .filter(
      (j) =>
        /^suite \/ /.test(String(j.name ?? '')) &&
        j.conclusion === 'cancelled' &&
        (j.steps ?? []).some((s) => s.conclusion === 'cancelled'),
    )
    .map((j) => String(j.name));
}

/**
 * What a red run's gate says: each red suite job, its failed step and its failing tests, for the
 * gate's log (what `gh run view --log-failed` prints), its job summary and its annotations (one per
 * red job, at most five, each at most ten tests; GitHub keeps ten error annotations per step).
 * Test names come from PR code's logs: each is put on one line, and every printed line starts with
 * text, never with "::", so none can be read as a workflow command.
 * @param {{ id: number, name: string, step: string, cancelled: boolean, tests: string[], note?: string }[]} red
 * @param {string[]} cut the jobs a cancel cut short (cutShort). Beside a red job that fail fast
 *   left cancelled they are its siblings, which it cancelled, and are left out; otherwise (a push
 *   to main, a train, a fork) each one is news: a timeout, or a matrix's own fail-fast.
 */
export function failureReport(red, cut) {
  const oneLine = (/** @type {string} */ s) => clip(s.replace(/[\r\n]+/g, ' ').trim(), 300);
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const md = [];
  /** @type {string[]} */
  const annotations = [];
  if (red.length === 0) {
    const why =
      'A job that hits its timeout-minutes ends cancelled, with no failed step, and so does every job when a newer push replaces the run.';
    lines.push('No suite job of this run failed a step.');
    if (cut.length) lines.push(`Cancelled while running: ${cut.join(', ')}.`);
    lines.push(why);
    md.push('**No suite job of this run failed a step.**', '');
    if (cut.length) md.push(`Cancelled while running: ${cut.map((c) => `\`${c}\``).join(', ')}.`, '');
    md.push(why);
    annotations.push(
      workflowCommand(
        'error',
        { title: 'no red suite job' },
        `${cut.length ? `Cancelled while running: ${cut.join(', ')}. ` : ''}${why}`,
      ),
    );
    return { lines, summary: md.join('\n'), annotations };
  }
  for (const [i, job] of red.entries()) {
    const tests = job.tests.map(oneLine);
    const what = job.step ? `"${job.step}" failed` : 'failed';
    const shown = job.cancelled
      ? ' (the job shows as cancelled: fail fast cancelled this PR run, the red job included, to free its runners)'
      : '';
    lines.push(`${job.name}: ${what}${shown}`);
    for (const t of tests) lines.push(`  - ${t}`);
    if (!tests.length) lines.push(`  - no test names in its log${job.note ? ` (${oneLine(job.note)})` : ''}`);
    lines.push(`  - its log: gh run view --job ${job.id} --log`);
    md.push(`**${job.name}**: ${what}${shown}.`, '');
    if (tests.length) md.push('```text', fenceSafe(tests, 25), '```', '');
    md.push(`Its log: \`gh run view --job ${job.id} --log\``, '');
    if (i < 5) {
      const listed = tests.slice(0, 10);
      if (tests.length > 10) listed.push(`... and ${tests.length - 10} more`);
      annotations.push(
        workflowCommand(
          'error',
          { title: `red job: ${job.name}` },
          [`${what}.`, ...listed].join('\n') || what,
        ),
      );
    }
  }
  const alsoCut = red.some((j) => j.cancelled) ? [] : cut;
  if (alsoCut.length) {
    const also = `Also cancelled while running, with no failed step: ${alsoCut.join(', ')}. A job that hits its timeout-minutes ends that way, and so do a red job's siblings when its matrix fails fast.`;
    lines.push(also);
    md.push(also);
    annotations.push(workflowCommand('error', { title: 'cancelled while running' }, also));
  }
  return { lines, summary: md.join('\n'), annotations };
}

/** The squash commits' PR numbers, from their titles ("... (#123)"). */
export function prNumbersFromTitles(/** @type {string[]} */ titles) {
  return titles.flatMap((t) => {
    const m = /\(#(\d+)\)\s*$/.exec(t.split('\n')[0] ?? '');
    return m ? [Number(m[1])] : [];
  });
}

export const COMMENT_TAG = '<!-- bundle-train -->';

/**
 * The comment on a PR that failed alone.
 * @param {{ kind: 'own' | 'composition' | 'unknown', sha: string, base: string, run: number, url: string, failing: string[], lacks: number[], mainCi: string }} o
 */
export function blameComment({ kind, sha, base, run, url, failing, lacks, mainCi }) {
  const head =
    kind === 'composition'
      ? `**Bundle train ${run}: this PR passes on its own branch but fails on top of main.** It is a composition failure with what landed on main since your branch.`
      : `**Bundle train ${run}: this PR fails alone on main.**`;
  const lines = [
    COMMENT_TAG,
    head,
    '',
    `- Tested: main \`${base.slice(0, 7)}\` + this PR (\`${sha.slice(0, 7)}\`), the full suite: static, unit, sim, browser and perf, exactly as main runs it. [The train's run](${url}).`,
    kind === 'own'
      ? `- Its own branch (\`${sha.slice(0, 7)}\`, without the newer main) fails the full suite too, so the failure is in this PR.`
      : kind === 'composition'
        ? `- Its own branch (\`${sha.slice(0, 7)}\`, without the newer main) passes the full suite.`
        : '- Its own branch was not tested (that suite did not finish).',
    `- Main's own CI on \`${base.slice(0, 7)}\`: ${mainCi === 'success' ? 'green' : mainCi === 'pending' ? 'still running' : 'no finished run'}.`,
  ];
  if (lacks.length) lines.push(`- Main has PRs your branch does not: ${prList(lacks, 400)}.`);
  lines.push(
    '',
    failing.length ? 'Failing:' : 'The failing tests could not be read from the logs; open the run.',
    '',
  );
  if (failing.length) lines.push('```text', fenceSafe(failing), '```', '');
  lines.push(
    kind === 'composition'
      ? 'To fix: merge origin/main into your branch, reproduce the failing tests, fix them, and push. A new push rides a later train by itself.'
      : 'To fix: reproduce the failing tests, fix them, and push. A new push rides a later train by itself. If it looks like a flake, push again (an empty commit is fine).',
  );
  return lines.join('\n');
}

/** The comment on a PR that conflicts with main. */
export function conflictComment(
  /** @type {{ sha: string, base: string, run: number, url: string }} */ { sha, base, run, url },
) {
  return [
    COMMENT_TAG,
    `**Bundle train ${run}: this PR conflicts with main.**`,
    '',
    `Its head (\`${sha.slice(0, 7)}\`) does not merge cleanly onto main \`${base.slice(0, 7)}\`. [The train's run](${url}).`,
    '',
    'To fix: merge origin/main into your branch, resolve the conflicts, and push. A new push rides a later train by itself.',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// GitHub

const env = process.env;
const repo = () => {
  const r = env.GITHUB_REPOSITORY ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error('GITHUB_REPOSITORY is not set');
  return r;
};
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const runUrl = () =>
  `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo()}/actions/runs/${env.GITHUB_RUN_ID}`;
const runNumber = () => Number(env.GITHUB_RUN_NUMBER ?? 0);

/**
 * @param {string} method
 * @param {string} url
 * @param {unknown} [body]
 * @param {{ retry?: boolean, raw?: boolean }} [o]
 */
async function api(method, url, body, { retry = method === 'GET', raw = false } = {}) {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) throw new Error('GH_TOKEN is not set');
  const full = url.startsWith('https://') ? url : `${env.GITHUB_API_URL ?? 'https://api.github.com'}${url}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(full, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      if (res.status === 204) return null;
      return raw ? res.text() : res.json();
    }
    const text = (await res.text()).slice(0, 300);
    if (retry && attempt < 3 && (res.status >= 500 || res.status === 429)) {
      await sleep(Number(env.TRAIN_RETRY_MS ?? 3000) * attempt);
      continue;
    }
    throw new Error(`${method} ${url}: ${res.status} ${text}`);
  }
}

export const PRS_QUERY = `query ($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: "main", first: 50, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number isDraft title body
        author { login }
        headRefOid
        headRepository { nameWithOwner }
        autoMergeRequest { mergeMethod }
        commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100) { totalCount nodes {
          __typename
          ... on CheckRun { name status conclusion startedAt checkSuite { app { slug } } }
          ... on StatusContext { context state description }
        } } } } } }
      }
    }
  }
}`;

async function openPrs() {
  const [owner, name] = repo().split('/');
  /** @type {ReturnType<typeof normalizePr>[]} */
  const prs = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    /** @type {any} */
    const res = await api(
      'POST',
      '/graphql',
      { query: PRS_QUERY, variables: { owner, name, after } },
      { retry: true },
    );
    if (res.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(res.errors).slice(0, 300)}`);
    const conn = res.data.repository.pullRequests;
    prs.push(...conn.nodes.map(normalizePr));
    if (!conn.pageInfo.hasNextPage) return prs;
    after = conn.pageInfo.endCursor;
  }
  throw new Error('more than 1000 open PRs');
}

async function mainSha() {
  /** @type {any} */
  const ref = await api('GET', `/repos/${repo()}/git/ref/heads/main`);
  return String(ref.object.sha);
}

/** main's own newest ci run (a push) on a commit, or null. */
async function mainCiRun(/** @type {string} */ sha) {
  /** @type {any} */
  const res = await api(
    'GET',
    `/repos/${repo()}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=10`,
  );
  const runs = [...(res.workflow_runs ?? [])].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
  const r = runs[0];
  return r
    ? {
        id: Number(r.id),
        status: String(r.status),
        conclusion: String(r.conclusion ?? ''),
        attempt: Number(r.run_attempt ?? 1),
      }
    : null;
}

/** 'success', 'failure', 'pending' (not finished) or 'none' (no run, or cancelled). */
function ciState(/** @type {Awaited<ReturnType<typeof mainCiRun>>} */ r) {
  if (!r) return 'none';
  if (r.status !== 'completed') return 'pending';
  if (r.conclusion === 'success') return 'success';
  return RED.has(r.conclusion) ? 'failure' : 'none';
}

export async function postStatus(
  /** @type {string} */ sha,
  /** @type {string} */ state,
  /** @type {string} */ description,
) {
  if (!SHA.test(sha)) throw new Error(`not a commit id: ${sha}`);
  await api(
    'POST',
    `/repos/${repo()}/statuses/${sha}`,
    { state, context: CONTEXT, description: clip(description), target_url: runUrl() },
    { retry: true },
  );
}

async function comment(/** @type {number} */ number, /** @type {string} */ body) {
  await api('POST', `/repos/${repo()}/issues/${number}/comments`, { body });
}

/**
 * Posts the statuses in bundle order. If one fails, the successes already posted are taken back
 * (pending again, best effort) before the error is thrown: a success on only part of a passed
 * bundle would land a subset nobody tested.
 * @param {{ number: number, sha: string, state: string, description: string }[]} statuses
 * @param {{ number: number, cap: number }[]} bundle
 * @param {number} run
 * @param {(sha: string, state: string, description: string) => Promise<void>} post
 */
export async function postInOrder(statuses, bundle, run, post) {
  /** @type {typeof statuses} */
  const posted = [];
  try {
    for (const s of statuses) {
      await post(s.sha, s.state, s.description);
      posted.push(s);
    }
  } catch (err) {
    for (const s of posted.filter((x) => x.state === 'success')) {
      const cap = bundle.find((b) => b.number === s.number)?.cap ?? 1;
      await post(
        s.sha,
        'pending',
        withCap(`train ${run}: posting failed; waits for the next train`, cap),
      ).catch(() => {});
    }
    throw err;
  }
}

/** This run attempt's jobs (a PR run has about 22, a train with its control about 40). */
async function runJobs() {
  /** @type {ApiJob[]} */
  const jobs = [];
  for (let page = 1; page <= 5; page++) {
    /** @type {any} */
    const res = await api(
      'GET',
      `/repos/${repo()}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT ?? 1}/jobs?per_page=100&page=${page}`,
    );
    jobs.push(...(res.jobs ?? []));
    if (jobs.length >= Number(res.total_count ?? 0) || !(res.jobs ?? []).length) break;
  }
  return jobs;
}

/** The red suite jobs among a run's jobs, each with the failing tests its log names. */
async function redFromRun(/** @type {ApiJob[]} */ jobs) {
  /** @type {Parameters<typeof failureReport>[0]} */
  const out = [];
  for (const job of redSuiteJobs(jobs)) {
    try {
      const log = /** @type {string} */ (
        await api('GET', `/repos/${repo()}/actions/jobs/${job.id}/logs`, undefined, { raw: true })
      );
      out.push({ ...job, tests: failingTests(log) });
    } catch (err) {
      const note = `its log could not be read: ${err instanceof Error ? err.message.slice(0, 80) : err}`;
      out.push({ ...job, tests: [], note });
    }
  }
  return out;
}

/** The failing tests of this run's failed suite jobs, read from their logs. */
async function failingFromRun() {
  /** @type {string[]} */
  const out = [];
  for (const job of await redFromRun(await runJobs())) {
    if (job.tests.length) out.push(...job.tests);
    else out.push(`${job.name}: failed (${job.note ?? 'no test names in its log'})`);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------
// Commands

/** @param {string[]} args @param {Record<string, string>} [extra] */
function gitRun(args, extra = {}) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    env: { ...env, ...extra },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** @param {Record<string, string>} values */
function output(values) {
  for (const [k, v] of Object.entries(values)) {
    if (/[\r\n]/.test(v)) throw new Error(`output ${k} has a line break`);
    console.log(`${k}=${v}`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`);
  }
}
const summary = (/** @type {string} */ md) => {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`);
};

function fetchCommits(/** @type {string[]} */ shas) {
  for (const s of shas) if (!SHA.test(s)) throw new Error(`not a commit id: ${s}`);
  const r = gitRun(['fetch', '--no-tags', '--quiet', 'origin', ...shas]);
  if (r.status !== 0) throw new Error(`git fetch failed: ${r.stderr.trim()}`);
}

function cmdRoute() {
  const cfg = loadConfig();
  const diff = gitRun(['diff', '--name-only', '--no-renames', '-z', 'HEAD^1', 'HEAD']);
  if (diff.status !== 0)
    throw new Error(`cannot list the PR's files (checkout needs fetch-depth 2): ${diff.stderr.trim()}`);
  const files = diff.stdout.split('\0').filter(Boolean);
  const r = route({
    live: cfg.live,
    fork: (env.PR_HEAD_REPO ?? '') !== repo(),
    author: env.PR_AUTHOR ?? '',
    title: env.PR_TITLE ?? '',
    body: env.PR_BODY ?? '',
    files,
  });
  console.log(`route: ${r.path}: ${r.reason}`);
  summary(`**Route: ${r.path}.** ${r.reason}.`);
  output({ path: r.path });
}

async function cmdPlan() {
  const cfg = loadConfig();
  const dry = env.TRAIN_DRY_RUN === 'true';
  const out = {
    depart: 'false',
    post: 'false',
    base: '',
    heads: '',
    tree: '',
    commit: '',
    bundle: '[]',
    conflicts: '[]',
    single: '',
    wait_main: '',
  };
  const say = (/** @type {string} */ s) => {
    console.log(`plan: ${s}`);
    summary(s);
  };
  if (!cfg.live && !dry) {
    say(`The train is off (${CONFIG_FILE}): every PR runs the full gate itself. Nothing to do.`);
    return output(out);
  }
  const base = await mainSha();
  const main = await mainCiRun(base);
  const mainState = ciState(main);
  console.log(
    `plan: main is ${base}; its own ci run: ${main ? `${main.id} attempt ${main.attempt}, ${main.status} ${main.conclusion}` : 'none'} (${mainState})`,
  );
  const gate = mainGate(main ? { id: main.id, state: mainState, attempt: main.attempt } : null, dry);
  if (!gate.go) {
    if (gate.watch !== null) Object.assign(out, { wait_main: String(gate.watch), base });
    say(`Main \`${base.slice(0, 7)}\`: ${gate.why}. Nobody departs.`);
    return output(out);
  }
  const prs = await openPrs();
  /** @type {{ number: number, headSha: string, cap: number }[]} */
  let bundle;
  if (dry && (env.TRAIN_PRS ?? '').trim()) {
    const wanted = (env.TRAIN_PRS ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    bundle = wanted.map((n) => {
      const pr = prs.find((p) => p.number === n);
      if (!pr || pr.headRepo !== repo()) throw new Error(`dry run: #${n} is not an open PR from this repo`);
      return { number: n, headSha: pr.headSha, cap: wanted.length };
    });
    say(`Dry run with the PRs asked for, in that order: ${prList(wanted, 400)}.`);
  } else {
    const rows = prs.map((pr) => ({ pr, e: eligibility(pr, { repo: repo(), cap: cfg.cap }) }));
    for (const { pr, e } of rows)
      console.log(
        `plan: #${pr.number} ${pr.headSha.slice(0, 7)}: ${e.ok ? 'eligible' : 'not eligible'}, ${e.reason}`,
      );
    const eligible = rows.flatMap(({ pr, e }) =>
      e.ok ? [{ number: pr.number, headSha: pr.headSha, cap: e.cap }] : [],
    );
    bundle = selectBundle(eligible).bundle;
    console.log(`plan: ${eligible.length} of ${prs.length} open PRs are eligible`);
  }
  if (!bundle.length) {
    say('Nobody is waiting for the train.');
    return output(out);
  }
  fetchCommits([base, ...bundle.map((p) => p.headSha)]);
  const asm = assemble(
    gitRun,
    base,
    bundle.map((p) => p.headSha),
  );
  const rode = bundle.filter((p) => asm.merged.includes(p.headSha));
  const conflicts = asm.conflicts.map((c) => {
    const p = /** @type {{ number: number, headSha: string, cap: number }} */ (
      bundle.find((b) => b.headSha === c.head)
    );
    const earlier = rode
      .filter((r) => r.number !== p.number && bundle.indexOf(r) < bundle.indexOf(p))
      .map((r) => r.number);
    return { number: p.number, headSha: p.headSha, cap: p.cap, with: c.with, earlier };
  });
  for (const c of conflicts)
    console.log(
      `plan: #${c.number} conflicts with ${c.with === 'main' ? 'main' : `an earlier PR of this bundle (${prList(c.earlier)})`}; it does not ride`,
    );
  Object.assign(out, {
    depart: rode.length ? 'true' : 'false',
    post: !dry && (rode.length || conflicts.length) ? 'true' : 'false',
    base,
    heads: rode.map((p) => p.headSha).join(' '),
    tree: asm.tree,
    commit: asm.commit,
    bundle: JSON.stringify(rode),
    conflicts: JSON.stringify(conflicts),
    single: rode.length === 1 ? /** @type {{ headSha: string }} */ (rode[0]).headSha : '',
  });
  say(
    rode.length
      ? `${dry ? 'Dry run: ' : ''}Train departs: main \`${base.slice(0, 7)}\` + ${prList(
          rode.map((p) => p.number),
          400,
        )} (cap ${Math.max(...rode.map((p) => p.cap))}), tree \`${asm.tree.slice(0, 7)}\`.`
      : 'Every waiting PR conflicts; nobody rides.',
  );
  output(out);
}

function cmdAssemble() {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: { base: { type: 'string' }, heads: { type: 'string' }, tree: { type: 'string' } },
  });
  const base = values.base ?? '';
  const heads = (values.heads ?? '').split(/\s+/).filter(Boolean);
  if (!SHA.test(base) || !heads.length)
    throw new Error('usage: train.mjs assemble --base <sha> --heads "<sha> ..." [--tree <sha>]');
  fetchCommits([base, ...heads]);
  const asm = assemble(gitRun, base, heads);
  if (asm.conflicts.length)
    throw new Error(
      `the plan merged these cleanly, but here ${asm.conflicts.map((c) => c.head.slice(0, 7)).join(', ')} conflicted`,
    );
  if (values.tree && values.tree !== asm.tree)
    throw new Error(`assembled tree ${asm.tree} is not the planned ${values.tree}`);
  const co = gitRun(['checkout', '--detach', '--quiet', asm.commit]);
  if (co.status !== 0) throw new Error(`git checkout ${asm.commit} failed: ${co.stderr.trim()}`);
  console.log(
    `[train] main ${base.slice(0, 7)} + ${heads.length} PR head(s) -> commit ${asm.commit.slice(0, 7)}, tree ${asm.tree}${values.tree ? ' (the planned tree)' : ''}`,
  );
}

/** @returns {{ number: number, headSha: string, cap: number }[]} */
const readBundle = (/** @type {string | undefined} */ s) => JSON.parse(s || '[]');

async function cmdAnnounce() {
  const bundle = readBundle(env.TRAIN_BUNDLE);
  /** @type {{ number: number, headSha: string, cap: number, with: string, earlier: number[] }[]} */
  const conflicts = JSON.parse(env.TRAIN_CONFLICTS || '[]');
  const base = env.TRAIN_BASE ?? '';
  const run = runNumber();
  for (const p of bundle)
    await postStatus(
      p.headSha,
      'pending',
      withCap(
        `riding train ${run}: main ${base.slice(0, 7)} + ${prList(
          bundle.map((b) => b.number),
          50,
        )}`,
        p.cap,
      ),
    );
  for (const c of conflicts) {
    if (c.with === 'main') {
      await postStatus(
        c.headSha,
        'failure',
        `train ${run}: conflicts with main ${base.slice(0, 7)}; merge origin/main and push`,
      );
      await comment(c.number, conflictComment({ sha: c.headSha, base, run, url: runUrl() }));
    } else {
      await postStatus(
        c.headSha,
        'pending',
        withCap(`train ${run}: conflicts with ${prList(c.earlier, 30)}; waits`, c.cap),
      );
    }
  }
  console.log(`announce: ${bundle.length} riding, ${conflicts.length} conflicting`);
}

async function cmdReport() {
  const cfg = loadConfig();
  const dry = env.TRAIN_DRY_RUN === 'true';
  const bundle = readBundle(env.TRAIN_BUNDLE);
  const base = env.TRAIN_BASE ?? '';
  const run = runNumber();
  const result = env.TRAIN_RESULT ?? '';
  const control = env.TRAIN_CONTROL || 'skipped';
  const say = (/** @type {string} */ s) => {
    console.log(`report: ${s}`);
    summary(s);
  };

  const mainNow = await mainSha();
  const open = await openPrs();
  const now = new Map(
    open.map((p) => [p.number, { headSha: p.headSha, draft: p.draft, autoMerge: p.autoMerge }]),
  );
  /** @type {'success' | 'failure' | 'pending' | 'none'} */
  let mainCi = 'none';
  if (result === 'failure' && bundle.length === 1 && mainNow === base) {
    // Blame needs main itself green: wait for main's own run on base if it is still going.
    const deadline = Date.now() + cfg.mainWaitMinutes * 60_000;
    for (;;) {
      mainCi = /** @type {typeof mainCi} */ (ciState(await mainCiRun(base)));
      if (mainCi !== 'pending' || Date.now() > deadline || dry) break;
      console.log(`report: main's own ci run on ${base.slice(0, 7)} is still running; waiting`);
      await sleep(30_000);
    }
  }
  const d = decide({ result, control, bundle, base, mainNow, now, mainCi, run });
  say(`**${d.verdict}**: ${d.why}.`);
  const failing = result === 'failure' ? await failingFromRun() : [];
  if (failing.length) summary(['Failing:', '```text', fenceSafe(failing, 40), '```'].join('\n'));
  /** @type {string | null} */
  let blameBody = null;
  if (d.blame) {
    let lacks = /** @type {number[]} */ ([]);
    try {
      /** @type {any} */
      const cmp = await api('GET', `/repos/${repo()}/compare/${d.blame.sha}...${base}`);
      lacks = prNumbersFromTitles(
        (cmp.commits ?? []).map((/** @type {any} */ c) => String(c.commit?.message ?? '')),
      );
    } catch (err) {
      console.log(
        `report: could not compare the branch with main: ${err instanceof Error ? err.message : err}`,
      );
    }
    blameBody = blameComment({
      kind: d.blame.kind,
      sha: d.blame.sha,
      base,
      run,
      url: runUrl(),
      failing,
      lacks,
      mainCi,
    });
  }
  for (const s of d.statuses)
    console.log(
      `report: ${dry ? 'would post' : 'posts'} gate=${s.state} on #${s.number} ${s.sha.slice(0, 7)}: ${s.description}`,
    );
  if (blameBody)
    console.log(`report: ${dry ? 'would comment' : 'comments'} on #${d.blame?.number}:\n${blameBody}`);
  if (dry) {
    say(`Dry run: posted nothing${d.dispatch ? ' (a live train would send the next train now)' : ''}.`);
    return;
  }
  await postInOrder(d.statuses, bundle, run, postStatus);
  if (d.blame && blameBody) await comment(d.blame.number, blameBody);
  if (d.land.length) await awaitLanding(d.land, bundle, cfg.landingMinutes, run);
  if (d.dispatch) {
    await api(
      'POST',
      `/repos/${repo()}/actions/workflows/train.yml/dispatches`,
      { ref: 'main' },
      { retry: true },
    );
    say('Sent the next train (it plans from scratch).');
  }
}

/**
 * Waits until every PR that passed has merged. One that has not merged in time gets its success
 * taken back (pending again), so it can never land later on a main it was not tested on.
 */
async function awaitLanding(
  /** @type {number[]} */ land,
  /** @type {{ number: number, headSha: string, cap: number }[]} */ bundle,
  /** @type {number} */ minutes,
  /** @type {number} */ run,
) {
  const deadline = Date.now() + minutes * 60_000;
  const waiting = new Set(land);
  const closed = new Set();
  while (waiting.size && Date.now() < deadline) {
    for (const n of [...waiting]) {
      /** @type {any} */
      const pr = await api('GET', `/repos/${repo()}/pulls/${n}`);
      if (pr.merged_at) {
        console.log(`report: #${n} merged at ${pr.merged_at}`);
        waiting.delete(n);
      } else if (pr.state === 'closed') {
        console.log(`report: #${n} was closed without merging`);
        waiting.delete(n);
        closed.add(n);
      }
    }
    if (waiting.size) await sleep(15_000);
  }
  for (const n of [...waiting, ...closed]) {
    const p = bundle.find((b) => b.number === n);
    if (p)
      await postStatus(
        p.headSha,
        'pending',
        withCap(`train ${run}: passed, but did not land; waits for the next train`, p.cap),
      );
    console.log(`report: #${n} did not land; its success is taken back`);
  }
  if (!waiting.size && !closed.size) {
    /** @type {any} */
    const head = await api('GET', `/repos/${repo()}/commits/main`);
    const tree = String(head.commit?.tree?.sha ?? '');
    const tested = env.TRAIN_TREE ?? '';
    console.log(
      `report: main is now ${String(head.sha).slice(0, 7)}; its tree ${tree === tested ? 'is exactly the tested tree' : `(${tree.slice(0, 7)}) differs from the tested tree (${tested.slice(0, 7)}): another merge landed, or the squash order changed the result; main's own CI checks it`}`,
    );
  }
}

/**
 * ci.yml's gate, when its verdict is red: name the red suite jobs, their failed steps and their
 * failing tests in the gate's own log, its job summary and its annotations. Under fail fast the red
 * job ends cancelled like its siblings, and `gh run view --log-failed` prints only the gate's log.
 */
async function cmdFailures() {
  const jobs = await runJobs();
  const red = await redFromRun(jobs);
  const r = failureReport(red, cutShort(jobs));
  for (const line of r.lines) console.log(line);
  summary(r.summary);
  for (const a of r.annotations) console.log(a);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'route') return cmdRoute();
  if (cmd === 'plan') return cmdPlan();
  if (cmd === 'assemble') return cmdAssemble();
  if (cmd === 'announce') return cmdAnnounce();
  if (cmd === 'report') return cmdReport();
  if (cmd === 'failures') return cmdFailures();
  console.error('usage: node scripts/train.mjs route | plan | assemble | announce | report | failures');
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`train: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
