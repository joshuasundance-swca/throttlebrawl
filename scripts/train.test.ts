// The bundle train's logic (docs/engineering.md, "The bundle train"): routing, eligibility, the
// bundle order, when main lets a train depart, assembly (on a real git repo), the landing
// invariant, the split plan, status posting, the failure comments, and the workflows' wiring
// (one shared suite, the quick check's size, and who may write). The fixtures follow the real
// producers: the GraphQL listing's shape and the failing-test lines are copied from this repo's
// own API answers and CI logs (2026-10-02).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  TRAIN_IDENT,
  assemble,
  blameComment,
  capOf,
  clip,
  conflictComment,
  cutShort,
  decide,
  eligibility,
  failingTests,
  failureReport,
  fenceSafe,
  hasMarker,
  isDocsOnly,
  loadConfig,
  mainGate,
  normalizePr,
  postInOrder,
  postStatus,
  prList,
  prNumbersFromTitles,
  readConfig,
  redSuiteJobs,
  route,
  selectBundle,
  stateOf,
  withCap,
  workflowCommand,
} from './train.mjs';

const REPO = 'owner/game';
const sha = (c: string) => c.repeat(40);

describe('config and routing', () => {
  it('reads .github/train.json, falling back to defaults for anything out of range', () => {
    expect(readConfig('{}')).toEqual({ live: false, cap: 8, landingMinutes: 10, mainWaitMinutes: 15 });
    expect(readConfig('{"live": true, "cap": 4, "landingMinutes": 5, "mainWaitMinutes": 0}')).toEqual({
      live: true,
      cap: 4,
      landingMinutes: 5,
      mainWaitMinutes: 0,
    });
    expect(readConfig('{"live": "yes", "cap": 0, "landingMinutes": 2.5}')).toMatchObject({
      live: false,
      cap: 8,
      landingMinutes: 10,
    });
  });

  it('finds the escape hatch in the title or the body, in any case', () => {
    expect(hasMarker('infra: x [full-gate]', '')).toBe(true);
    expect(hasMarker('x', 'please run the [FULL-GATE] here')).toBe(true);
    expect(hasMarker('full-gate', 'full gate')).toBe(false);
    expect(hasMarker(undefined, undefined)).toBe(false);
  });

  it('counts only docs/, changes/ and .md files as docs-only, and nothing as not docs-only', () => {
    expect(
      isDocsOnly([
        'docs/engineering.md',
        'changes/2026-10-02-x.md',
        'AGENTS.md',
        'THIRD_PARTY_ASSETS.md',
        'tools/gis/README.md',
      ]),
    ).toBe(true);
    expect(isDocsOnly(['docs/diagram.svg'])).toBe(true);
    expect(isDocsOnly(['docs/x.md', 'src/main.ts'])).toBe(false);
    expect(isDocsOnly(['packs/base/pack.json'])).toBe(false);
    expect(isDocsOnly([])).toBe(false);
  });

  const pr = { live: true, fork: false, author: 'someone', title: 't', body: '', files: ['src/a.ts'] };
  it('sends an ordinary PR to the train', () => {
    expect(route(pr).path).toBe('train');
  });
  it('keeps the full gate when the train is off, for forks, Dependabot, the escape hatch and CI changes', () => {
    expect(route({ ...pr, live: false }).path).toBe('full');
    expect(route({ ...pr, fork: true }).path).toBe('full');
    expect(route({ ...pr, author: 'dependabot[bot]' }).path).toBe('full');
    expect(route({ ...pr, body: 'x [full-gate]' }).path).toBe('full');
    const ci = route({ ...pr, files: ['src/a.ts', '.github/workflows/ci.yml', '.github/train.json'] });
    expect(ci.path).toBe('full');
    expect(ci.reason).toContain('.github/workflows/ci.yml and 1 more');
  });
  it('gives a docs-only PR its gate from the quick check, and runs everything when unsure', () => {
    expect(route({ ...pr, files: ['docs/a.md', 'changes/2026-10-02-a.md'] }).path).toBe('docs');
    expect(route({ ...pr, files: [] }).path).toBe('full');
  });
});

describe('state in the gate status', () => {
  it('carries the cap at the end of a pending description, within 140 characters', () => {
    const long = withCap('x'.repeat(300), 4);
    expect(long.length).toBe(140);
    expect(long.endsWith('... [cap 4]')).toBe(true);
    expect(capOf(long)).toBe(4);
    expect(capOf('riding train 12: main abc1234 + #1 #2 [cap 2]')).toBe(2);
    expect(capOf('no cap here')).toBeNull();
    expect(clip('abc', 3)).toBe('abc');
    expect(clip('abcd', 3)).toBe('...');
  });

  it('reads none, pending (with its cap, clamped to the configured one), success and failure', () => {
    expect(stateOf(null, 8)).toEqual({ kind: 'none', cap: 8 });
    expect(stateOf({ state: 'pending', description: withCap('waits', 2) }, 8)).toEqual({
      kind: 'pending',
      cap: 2,
    });
    expect(stateOf({ state: 'pending', description: withCap('waits', 16) }, 8)).toEqual({
      kind: 'pending',
      cap: 8,
    });
    expect(stateOf({ state: 'pending', description: 'someone else' }, 8)).toEqual({
      kind: 'pending',
      cap: 8,
    });
    expect(stateOf({ state: 'pending', description: withCap('x', 0) }, 8).cap).toBe(1);
    expect(stateOf({ state: 'success', description: '' }, 8).kind).toBe('success');
    expect(stateOf({ state: 'failure', description: '' }, 8).kind).toBe('failure');
    expect(stateOf({ state: 'error', description: '' }, 8).kind).toBe('failure');
  });

  it('lists PRs, shortened to fit', () => {
    expect(prList([1, 2, 3])).toBe('#1 #2 #3');
    expect(prList([101, 102, 103, 104, 105, 106], 20)).toBe('#101 #102 +4 more');
  });
});

// One node as the PR listing query returns it (shape copied from this repo's GraphQL answer).
function node(o: {
  number: number;
  head: string;
  quick?: { conclusion: string; status?: string; startedAt?: string; app?: string }[];
  gateRun?: boolean;
  gate?: { state: string; description: string };
  draft?: boolean;
  auto?: boolean;
  repo?: string;
  title?: string;
  oid?: string;
  totalCount?: number;
}) {
  const checks = (o.quick ?? []).map((q) => ({
    __typename: 'CheckRun',
    name: 'quick',
    status: q.status ?? 'COMPLETED',
    conclusion: q.conclusion,
    startedAt: q.startedAt ?? '2026-10-02T17:07:51Z',
    checkSuite: { app: { slug: q.app ?? 'github-actions' } },
  }));
  const contexts = [
    {
      __typename: 'CheckRun',
      name: 'auto-merge',
      status: 'COMPLETED',
      conclusion: 'SKIPPED',
      startedAt: '2026-10-02T16:35:09Z',
      checkSuite: { app: { slug: 'github-actions' } },
    },
    {
      __typename: 'CheckRun',
      name: 'static and unit',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      startedAt: '2026-10-02T17:07:51Z',
      checkSuite: { app: { slug: 'github-actions' } },
    },
    ...checks,
    ...(o.gateRun
      ? [
          {
            __typename: 'CheckRun',
            name: 'gate',
            status: 'COMPLETED',
            conclusion: 'FAILURE',
            startedAt: '2026-10-02T17:20:00Z',
            checkSuite: { app: { slug: 'github-actions' } },
          },
        ]
      : []),
    ...(o.gate
      ? [
          {
            __typename: 'StatusContext',
            context: 'gate',
            state: o.gate.state.toUpperCase(),
            description: o.gate.description,
          },
        ]
      : []),
  ];
  return {
    number: o.number,
    isDraft: o.draft ?? false,
    title: o.title ?? 'render: rails only on bridges',
    body: '',
    author: { login: 'maintainer' },
    headRefOid: o.head,
    headRepository: { nameWithOwner: o.repo ?? REPO },
    autoMergeRequest: o.auto === false ? null : { mergeMethod: 'SQUASH' },
    commits: {
      nodes: [
        {
          commit: {
            oid: o.oid ?? o.head,
            statusCheckRollup: { contexts: { totalCount: o.totalCount ?? contexts.length, nodes: contexts } },
          },
        },
      ],
    },
  };
}

describe('eligibility', () => {
  const ok = { conclusion: 'SUCCESS' };
  const elig = (n: ReturnType<typeof node>) => eligibility(normalizePr(n), { repo: REPO, cap: 8 });

  it('takes a same-repo, ready, armed PR with a green quick check and no gate yet', () => {
    expect(elig(node({ number: 1, head: sha('a'), quick: [ok] }))).toEqual({
      ok: true,
      cap: 8,
      reason: 'new',
    });
  });

  it('keeps the cap a red bundle gave it', () => {
    expect(
      elig(
        node({
          number: 1,
          head: sha('a'),
          quick: [ok],
          gate: { state: 'pending', description: withCap('train 3 was red with 4 PRs; splits', 2) },
        }),
      ),
    ).toMatchObject({ ok: true, cap: 2 });
  });

  it('leaves out forks, drafts, unarmed PRs, the escape hatch and full-path heads', () => {
    expect(elig(node({ number: 1, head: sha('a'), quick: [ok], repo: 'fork/game' })).ok).toBe(false);
    expect(elig(node({ number: 1, head: sha('a'), quick: [ok], draft: true })).ok).toBe(false);
    expect(elig(node({ number: 1, head: sha('a'), quick: [ok], auto: false })).ok).toBe(false);
    expect(elig(node({ number: 1, head: sha('a'), quick: [ok], title: 'x [full-gate]' })).ok).toBe(false);
    expect(elig(node({ number: 1, head: sha('a'), quick: [ok], gateRun: true })).reason).toContain(
      'already has a gate check',
    );
  });

  it('needs the quick check green on the head commit, from GitHub Actions, the newest run counting', () => {
    expect(elig(node({ number: 1, head: sha('a') })).reason).toBe('its quick check is none');
    expect(elig(node({ number: 1, head: sha('a'), quick: [{ conclusion: 'FAILURE' }] })).ok).toBe(false);
    expect(
      elig(node({ number: 1, head: sha('a'), quick: [{ conclusion: '', status: 'IN_PROGRESS' }] })).reason,
    ).toBe('its quick check is pending');
    expect(
      elig(node({ number: 1, head: sha('a'), quick: [{ conclusion: 'SUCCESS', app: 'someone-else' }] })).ok,
    ).toBe(false);
    const rerun = [
      { conclusion: 'FAILURE', startedAt: '2026-10-02T17:00:00Z' },
      { conclusion: 'SUCCESS', startedAt: '2026-10-02T17:30:00Z' },
    ];
    expect(elig(node({ number: 1, head: sha('a'), quick: rerun })).ok).toBe(true);
    // A rollup for another commit than the head (a race in the API) counts as nothing.
    expect(elig(node({ number: 1, head: sha('a'), quick: [ok], oid: sha('b') })).ok).toBe(false);
  });

  it('never rides when the checks list was cut short (it could hide a gate failure)', () => {
    const cut = elig(node({ number: 1, head: sha('a'), quick: [ok], totalCount: 140 }));
    expect(cut.ok).toBe(false);
    expect(cut.reason).toContain('over 100');
  });

  it('leaves out heads that passed (landing) or failed a train', () => {
    expect(
      elig(
        node({
          number: 1,
          head: sha('a'),
          quick: [ok],
          gate: { state: 'success', description: 'passed train 3' },
        }),
      ).ok,
    ).toBe(false);
    expect(
      elig(
        node({
          number: 1,
          head: sha('a'),
          quick: [ok],
          gate: { state: 'failure', description: 'fails alone' },
        }),
      ).ok,
    ).toBe(false);
  });
});

describe('the bundle', () => {
  const e = (number: number, cap = 8) => ({ number, headSha: sha(String(number % 10)), cap });

  it('departs with whatever waits, oldest first, up to the cap', () => {
    expect(selectBundle([e(30), e(12), e(20)]).bundle.map((b) => b.number)).toEqual([12, 20, 30]);
    const ten = Array.from({ length: 10 }, (_, i) => e(100 + i));
    expect(selectBundle(ten).bundle.map((b) => b.number)).toEqual([100, 101, 102, 103, 104, 105, 106, 107]);
    expect(selectBundle([]).bundle).toEqual([]);
  });

  it('takes the smallest cap first: a red bundle splits before new PRs ride', () => {
    const { bundle, cap } = selectBundle([e(1), e(5, 2), e(3, 2), e(4, 2), e(2)]);
    expect(cap).toBe(2);
    expect(bundle.map((b) => b.number)).toEqual([3, 4]);
  });
});

describe('when main lets a train depart', () => {
  const run = (state: 'success' | 'failure' | 'pending' | 'none', attempt = 1) => ({
    id: 77,
    state,
    attempt,
  });

  it('departs on a green, running or unknown main, and when main has no run yet', () => {
    expect(mainGate(run('success'), false).go).toBe(true);
    expect(mainGate(run('pending'), false).go).toBe(true);
    expect(mainGate(run('none'), false).go).toBe(true);
    expect(mainGate(null, false).go).toBe(true);
  });

  it("waits on a red first attempt, and watches that run for rerun-main.yml's second attempt", () => {
    expect(mainGate(run('failure'), false)).toMatchObject({ go: false, watch: 77 });
    expect(mainGate(run('pending', 2), false)).toMatchObject({ go: false, watch: 77 });
  });

  it('waits for a fix on a second red attempt, watching nothing (the next main push starts a train)', () => {
    const g = mainGate(run('failure', 2), false);
    expect(g).toMatchObject({ go: false, watch: null });
    expect(g.why).toContain('[full-gate]');
  });

  it('a dry run departs whatever main is', () => {
    expect(mainGate(run('failure'), true).go).toBe(true);
    expect(mainGate(run('failure', 2), true).go).toBe(true);
  });
});

describe('assembly, on a real git repo', () => {
  let dir = '';
  // Git exports GIT_DIR, GIT_INDEX_FILE and friends to its hooks, and the pre-push hook runs this
  // file: with them inherited, these commands would act on the repo being pushed, not the temporary
  // one (on 2026-10-02 they rewrote the shared repo's user.email). So every GIT_* variable is
  // dropped, git may not walk up past the temporary folder, identity comes per command, nothing
  // writes git config, and no hooks run.
  const cleanEnv = () => {
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && v !== undefined) e[k] = v;
    e.GIT_CEILING_DIRECTORIES = path.dirname(dir);
    e.GIT_CONFIG_NOSYSTEM = '1';
    return e;
  };
  const SAFE = [
    '-c',
    'core.hooksPath=.no-hooks',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=train test',
    '-c',
    'user.email=train-test@users.noreply.github.com',
  ];
  const git = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync('git', [...SAFE, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...cleanEnv(), ...env },
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const ok = (...args: string[]) => {
    const r = git(args);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const commitFile = (file: string, text: string, msg: string) => {
    writeFileSync(path.join(dir, file), text);
    ok('add', file);
    ok('commit', '-q', '-m', msg);
    return ok('rev-parse', 'HEAD');
  };
  const heads: Record<string, string> = {};
  let base = '';

  // The config of the repo this file lives in (in a hook, the repo being pushed), read before any
  // git command here runs and again by the last test, which fails if it changed. branch.* entries
  // are left out: parallel lanes add them (git push -u, git checkout -b) while this runs. http.*
  // entries are left out too: on CI they hold the checkout's auth header, and a failing assertion
  // prints both snapshots.
  const realConfig = () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (!k.startsWith('GIT_') && v !== undefined) env[k] = v;
    const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      env,
    });
    if (common.status !== 0) return null; // not in a git checkout, so there is nothing to touch
    const file = path.join(common.stdout.trim(), 'config');
    const list = spawnSync('git', ['config', '--file', file, '--list'], { encoding: 'utf8', env });
    if (list.status !== 0) throw new Error(`cannot read ${file}: ${list.stderr}`);
    return list.stdout
      .split('\n')
      .filter((l) => l && !l.startsWith('branch.') && !l.startsWith('http.'))
      .sort()
      .join('\n');
  };
  const realBefore = realConfig();

  beforeAll(() => {
    // Under the checkout's own git-ignored cache (where scripts/check.mjs keeps its file lists),
    // not the OS temp folder: parallel lanes share the dev machine.
    const cache = path.join(import.meta.dirname, '..', 'node_modules', '.cache', 'throttlebrawl');
    mkdirSync(cache, { recursive: true });
    dir = realpathSync.native(mkdtempSync(path.join(cache, 'train-')));
    ok('init', '-q', '-b', 'main');
    // Refuse to go on unless git really is in the temporary repo.
    const gitDir = path.resolve(ok('rev-parse', '--absolute-git-dir')).toLowerCase();
    if (gitDir !== path.join(dir, '.git').toLowerCase())
      throw new Error(`git points at ${gitDir}, not ${dir}`);
    commitFile('a.txt', 'one\ntwo\nthree\n', 'base');
    base = ok('rev-parse', 'HEAD');
    for (const [name, file, text] of [
      ['p1', 'b.txt', 'b\n'],
      ['p2', 'c.txt', 'c\n'],
      ['p3', 'a.txt', 'one\ntwo\nTHREE\n'],
      ['p4', 'a.txt', 'one\ntwo\n3\n'], // conflicts with p3 only
    ] as const) {
      ok('checkout', '-q', '-b', name, base);
      heads[name] = commitFile(file, text, name);
    }
    ok('checkout', '-q', 'main');
    heads.p5 = commitFile('a.txt', 'ONE\ntwo\nthree\n', 'main moves');
    ok('checkout', '-q', '-b', 'p6', base);
    heads.p6 = commitFile('a.txt', 'uno\ntwo\nthree\n', 'p6'); // conflicts with main
    ok('checkout', '-q', 'main');
    // About 25 git processes: well under a second on CI, but over the 10 s default on a busy
    // Windows dev machine, where each spawn is slow. A guard against a hang, not a wait.
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('merges each head in order, deterministically, with the no-reply train identity', () => {
    const order = [heads.p1!, heads.p2!, heads.p3!];
    const first = assemble(git, base, order);
    const again = assemble(git, base, order);
    expect(again).toEqual(first);
    expect(first.merged).toEqual(order);
    expect(first.conflicts).toEqual([]);
    const parents = ok('log', '--format=%P', `${base}..${first.commit}`, '--first-parent').split('\n');
    expect(parents.map((p) => p.split(' ')[1])).toEqual([...order].reverse());
    expect(ok('log', '--format=%ae %ce', '-1', first.commit)).toBe(
      `${TRAIN_IDENT.email} ${TRAIN_IDENT.email}`,
    );
    // Another order is another history (the tree may match; the commits do not).
    expect(assemble(git, base, [heads.p2!, heads.p1!, heads.p3!]).commit).not.toBe(first.commit);
  });

  it('makes the same tree as merging with git merge', () => {
    const asm = assemble(git, base, [heads.p1!, heads.p2!, heads.p3!]);
    ok('checkout', '-q', '--detach', base);
    for (const h of [heads.p1!, heads.p2!, heads.p3!])
      ok('-c', 'commit.gpgsign=false', 'merge', '-q', '--no-edit', h);
    expect(ok('rev-parse', 'HEAD^{tree}')).toBe(asm.tree);
    ok('checkout', '-q', 'main');
  });

  it('drops a head that conflicts with an earlier one, and tells it apart from one that conflicts with main', () => {
    const r = assemble(git, base, [heads.p3!, heads.p4!, heads.p1!]);
    expect(r.merged).toEqual([heads.p3, heads.p1]);
    expect(r.conflicts).toEqual([{ head: heads.p4, with: 'bundle' }]);
    const m = assemble(git, heads.p5!, [heads.p6!, heads.p2!]);
    expect(m.conflicts).toEqual([{ head: heads.p6, with: 'main' }]);
    expect(m.merged).toEqual([heads.p2]);
  });

  // Last in this block, so it runs after every git command above.
  it("leaves the real repo's config exactly as it found it", () => {
    expect(realConfig()).toBe(realBefore);
  });
});

describe('the landing invariant (decide)', () => {
  const bundle = [
    { number: 11, headSha: sha('a'), cap: 8 },
    { number: 12, headSha: sha('b'), cap: 8 },
    { number: 13, headSha: sha('c'), cap: 8 },
  ];
  const base = sha('0');
  const nowOf = (b: typeof bundle) =>
    new Map(b.map((p) => [p.number, { headSha: p.headSha, draft: false, autoMerge: true }]));
  const input = { result: 'success', bundle, base, mainNow: base, now: nowOf(bundle), run: 42 };

  it('green on an unmoved main with every head unchanged: success on each, in order, and the next train', () => {
    const d = decide(input);
    expect(d.verdict).toBe('green');
    expect(d.statuses.map((s) => [s.number, s.state])).toEqual([
      [11, 'success'],
      [12, 'success'],
      [13, 'success'],
    ]);
    expect(d.statuses[0]!.description).toBe(`passed train 42: main ${base.slice(0, 7)} + #11 #12 #13`);
    expect(d.land).toEqual([11, 12, 13]);
    expect(d.dispatch).toBe(true);
  });

  it('main moved: no success for anyone, caps kept, and a new train', () => {
    const d = decide({ ...input, mainNow: sha('9') });
    expect(d.verdict).toBe('main-moved');
    expect(d.statuses.every((s) => s.state === 'pending' && capOf(s.description) === 8)).toBe(true);
    expect(d.land).toEqual([]);
    expect(d.dispatch).toBe(true);
  });

  it('a stale head (new push, closed, draft, auto-merge off): no success for anyone', () => {
    const cases = [
      new Map([...nowOf(bundle)].map(([n, v]) => [n, n === 12 ? { ...v, headSha: sha('d') } : v])),
      new Map([...nowOf(bundle)].filter(([n]) => n !== 12)),
      new Map([...nowOf(bundle)].map(([n, v]) => [n, n === 12 ? { ...v, draft: true } : v])),
      new Map([...nowOf(bundle)].map(([n, v]) => [n, n === 12 ? { ...v, autoMerge: false } : v])),
    ];
    for (const now of cases) {
      const d = decide({ ...input, now });
      expect(d.verdict).toBe('stale');
      expect(d.statuses.some((s) => s.state === 'success')).toBe(false);
      expect(d.statuses.map((s) => s.number)).toEqual([11, 13]); // nothing posted on the changed one
    }
  });

  it('never posts success unless the suite passed exactly that set on an unmoved main', () => {
    for (const result of ['success', 'failure', 'cancelled'])
      for (const moved of [false, true])
        for (const stale of [false, true]) {
          const now = stale ? new Map([...nowOf(bundle)].filter(([n]) => n !== 13)) : nowOf(bundle);
          const d = decide({ ...input, result, mainNow: moved ? sha('9') : base, now });
          const anySuccess = d.statuses.some((s) => s.state === 'success');
          expect(anySuccess).toBe(result === 'success' && !moved && !stale);
          for (const s of d.statuses) expect(s.description.length).toBeLessThanOrEqual(140);
        }
  });

  it('red bundle of n: each PR rides next with cap ceil(n/2)', () => {
    for (const [n, cap] of [
      [8, 4],
      [5, 3],
      [3, 2],
      [2, 1],
    ] as const) {
      const b = Array.from({ length: n }, (_, i) => ({ number: i + 1, headSha: sha(String(i)), cap: n }));
      const d = decide({ ...input, result: 'failure', bundle: b, now: nowOf(b) });
      expect(d.verdict).toBe('split');
      expect(d.statuses.map((s) => stateOf({ state: s.state, description: s.description }, 8))).toEqual(
        b.map(() => ({ kind: 'pending', cap })),
      );
    }
  });

  it('a lone PR that fails on a green main is the culprit; the own-branch suite says which kind', () => {
    const one = [bundle[0]!];
    const at = { ...input, result: 'failure', bundle: one, now: nowOf(one), mainCi: 'success' as const };
    expect(decide({ ...at, control: 'failure' }).blame).toEqual({ number: 11, sha: sha('a'), kind: 'own' });
    const comp = decide({ ...at, control: 'success' });
    expect(comp.blame?.kind).toBe('composition');
    expect(comp.statuses[0]).toMatchObject({ state: 'failure' });
    expect(comp.statuses[0]!.description).toContain('passes on its branch, fails on main');
    expect(decide({ ...at, control: 'cancelled' }).blame?.kind).toBe('unknown');
  });

  it('never blames a PR while main itself is red, and the train waits for main', () => {
    const one = [bundle[0]!];
    const d = decide({ ...input, result: 'failure', bundle: one, now: nowOf(one), mainCi: 'failure' });
    expect(d.verdict).toBe('main-red');
    expect(d.blame).toBeNull();
    expect(d.statuses).toEqual([expect.objectContaining({ state: 'pending' })]);
    expect(d.dispatch).toBe(false);
  });

  it('a cancelled or unfinished suite concludes nothing and sends no train', () => {
    const d = decide({ ...input, result: 'cancelled' });
    expect(d.verdict).toBe('unfinished');
    expect(d.dispatch).toBe(false);
    expect(d.statuses.every((s) => s.state === 'pending' && capOf(s.description) === 8)).toBe(true);
  });
});

// Trains in a row, as the workflow runs them: select from the statuses, run a fake suite on
// (main + bundle), decide, apply the statuses, land the passed set.
function simulate(o: { prs: number; fails: (tree: number[]) => boolean; maxTrains?: number }) {
  const status = new Map<number, { state: string; description: string } | null>();
  for (let n = 1; n <= o.prs; n++) status.set(n, null);
  const main: number[] = [];
  const tested: { main: number[]; set: number[] }[] = [];
  let trains = 0;
  for (; trains < (o.maxTrains ?? 50); trains++) {
    const eligible = [...status].flatMap(([number, s]) => {
      const st = stateOf(s, 8);
      return st.kind === 'none' || st.kind === 'pending'
        ? [{ number, headSha: sha(String(number % 10)), cap: st.cap }]
        : [];
    });
    const { bundle } = selectBundle(eligible);
    if (!bundle.length) break;
    const tree = [...main, ...bundle.map((b) => b.number)];
    const result = o.fails(tree) ? 'failure' : 'success';
    const control =
      bundle.length === 1 && result === 'failure'
        ? o.fails([bundle[0]!.number])
          ? 'failure'
          : 'success'
        : 'skipped';
    const now = new Map(bundle.map((b) => [b.number, { headSha: b.headSha, draft: false, autoMerge: true }]));
    const d = decide({
      result,
      control,
      bundle,
      base: sha('0'),
      mainNow: sha('0'),
      now,
      mainCi: 'success',
      run: trains + 1,
    });
    for (const s of d.statuses) status.set(s.number, { state: s.state, description: s.description });
    if (d.land.length) {
      tested.push({ main: [...main], set: d.land });
      main.push(...d.land);
    }
  }
  const failed = [...status].filter(([, s]) => s?.state === 'failure').map(([n]) => n);
  return { main, failed, trains, tested };
}

describe('the split plan, simulated', () => {
  it('8 PRs, all good: one train lands them all', () => {
    const r = simulate({ prs: 8, fails: () => false });
    expect(r.main).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.trains).toBe(1);
  });

  it('one bad PR anywhere in 8: the other 7 land, it alone fails, in a bounded number of trains', () => {
    for (let bad = 1; bad <= 8; bad++) {
      const r = simulate({ prs: 8, fails: (t) => t.includes(bad) });
      expect(r.failed).toEqual([bad]);
      expect(r.main.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].filter((n) => n !== bad));
      expect(r.trains).toBeLessThanOrEqual(8);
      // Every landed set is exactly a set the suite passed, on the main of that moment.
      for (const t of r.tested) expect([...t.main, ...t.set].includes(bad)).toBe(false);
    }
  });

  it('two bad PRs: both fail, everything else lands', () => {
    const r = simulate({ prs: 8, fails: (t) => t.includes(2) || t.includes(7) });
    expect(r.failed.sort()).toEqual([2, 7]);
    expect(r.main.sort((a, b) => a - b)).toEqual([1, 3, 4, 5, 6, 8]);
  });

  it('a composition failure: 6 fails only on top of 3; 3 lands first, then 6 fails as composition', () => {
    const r = simulate({ prs: 8, fails: (t) => t.includes(3) && t.includes(6) });
    expect(r.failed).toEqual([6]);
    expect(r.main).toContain(3);
  });

  it('a flake (red once, then green) still lands everything, in halves', () => {
    let calls = 0;
    const r = simulate({ prs: 8, fails: () => ++calls === 1 });
    expect(r.failed).toEqual([]);
    expect(r.main.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.trains).toBe(3);
  });

  it('a red bundle never rides more than four red trains per head commit (8, 4, 2, 1)', () => {
    const r = simulate({ prs: 8, fails: () => true, maxTrains: 100 });
    expect(r.failed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.trains).toBeLessThanOrEqual(1 + 2 + 4 + 8);
  });
});

describe('status posting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('posts the gate status to the head commit, with the train run as its link', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', REPO);
    vi.stubEnv('GH_TOKEN', 'test-token');
    vi.stubEnv('GITHUB_RUN_ID', '123');
    vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com');
    vi.stubEnv('GITHUB_API_URL', 'https://api.github.com');
    vi.stubEnv('TRAIN_RETRY_MS', '1');
    const calls: { url: string; init: RequestInit }[] = [];
    let fail = 1;
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (fail-- > 0) return Promise.resolve(new Response('busy', { status: 502 }));
      return Promise.resolve(
        new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }),
      );
    });
    await postStatus(sha('a'), 'success', 'x'.repeat(200));
    expect(calls).toHaveLength(2); // one retry after a 502
    const last = calls[1]!;
    expect(last.url).toBe(`https://api.github.com/repos/${REPO}/statuses/${sha('a')}`);
    expect(last.init.method).toBe('POST');
    const body = JSON.parse(typeof last.init.body === 'string' ? last.init.body : '{}') as Record<
      string,
      string
    >;
    expect(body).toMatchObject({
      state: 'success',
      context: 'gate',
      target_url: `https://github.com/${REPO}/actions/runs/123`,
    });
    expect(body.description).toHaveLength(140);
    await expect(postStatus('not-a-sha', 'success', 'x')).rejects.toThrow('not a commit id');
  });

  it('takes back successes already posted when a later post fails, so no untested subset lands', async () => {
    const posts: [string, string, string][] = [];
    const post = (s: string, state: string, d: string) => {
      if (s === sha('b') && state === 'success') return Promise.reject(new Error('API down'));
      posts.push([s, state, d]);
      return Promise.resolve();
    };
    const statuses = [
      { number: 1, sha: sha('a'), state: 'success', description: 'passed' },
      { number: 2, sha: sha('b'), state: 'success', description: 'passed' },
    ];
    await expect(
      postInOrder(
        statuses,
        [
          { number: 1, cap: 8 },
          { number: 2, cap: 8 },
        ],
        7,
        post,
      ),
    ).rejects.toThrow('API down');
    expect(posts.map(([s, state]) => [s, state])).toEqual([
      [sha('a'), 'success'],
      [sha('a'), 'pending'],
    ]);
    expect(capOf(posts[1]![2])).toBe(8);
  });
});

describe('what a red train says', () => {
  // Lines copied from this repo's CI logs on 2026-10-02 (sim 1/3 of run 37046646353's PR, and
  // browser 4/4), ANSI colours and timestamps included.
  const ESC = '\u001b';
  const log = [
    `2026-10-02T18:27:06.7278948Z  ${ESC}[31m❯${ESC}[39m ${ESC}[30m${ESC}[43m sim ${ESC}[49m${ESC}[39m tests/sim/cops-difficulty.test.ts ${ESC}[2m(${ESC}[22m${ESC}[2m3 tests${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[31m1 failed${ESC}[39m${ESC}[2m)${ESC}[22m`,
    `2026-10-02T18:27:28.7509747Z ${ESC}[41m${ESC}[1m FAIL ${ESC}[22m${ESC}[49m ${ESC}[30m${ESC}[43m sim ${ESC}[49m${ESC}[39m tests/sim/cops-difficulty.test.ts${ESC}[2m > ${ESC}[22mcops-2: the cop follows the difficulty preset${ESC}[2m > ${ESC}[22ma patrol cop's siren leads his arrival by at least the full lead`,
    "2026-10-02T18:31:36.3976819Z   1) [e2e] › tests/e2e/road-events.spec.ts:65:3 › pnw-a: the bot meets the race's road events, and they are drawn ",
    '2026-10-02T18:31:36.3989806Z   1 failed',
    "2026-10-02T18:31:36.3990424Z     [e2e] › tests/e2e/road-events.spec.ts:65:3 › pnw-a: the bot meets the race's road events, and they are drawn ",
    '2026-10-02T18:31:36.3990959Z   1 skipped',
    '2026-10-02T18:31:36.3990959Z   1 flaky',
    '2026-10-02T18:31:36.3990959Z     [e2e] › tests/e2e/ui-pause.spec.ts:10:1 › a flaky one ',
    '2026-10-02T18:31:36.3991174Z   38 passed (11.4m)',
    '2026-10-02T18:33:15.2193512Z e2e (slice 4/4, 14 files)  FAIL  38 browser tests passed, 1 failed (687.6s)',
    '2026-10-02T18:33:15.2193512Z perf                       FAIL  393 dist files: first-load JavaScript 503.2 KB gzip in 3 files (budget 500 KB)',
    '2026-10-02T18:33:15.2193512Z notes       NOT ACTIVE  on main there is no branch to compare',
  ].join('\n');

  it('finds the failing tests and the FAIL rows, not the flaky or passing ones', () => {
    expect(failingTests(log)).toEqual([
      "tests/sim/cops-difficulty.test.ts > cops-2: the cop follows the difficulty preset > a patrol cop's siren leads his arrival by at least the full lead",
      "[e2e] › tests/e2e/road-events.spec.ts:65:3 › pnw-a: the bot meets the race's road events, and they are drawn",
      'e2e (slice 4/4, 14 files): FAIL 38 browser tests passed, 1 failed (687.6s)',
      'perf: FAIL 393 dist files: first-load JavaScript 503.2 KB gzip in 3 files (budget 500 KB)',
    ]);
  });

  it('keeps log text inside its code fence', () => {
    expect(fenceSafe(['a ```bad``` b', 'c'], 1)).toBe("a '''bad''' b\n... and 1 more");
  });

  it('reads PR numbers from squash titles', () => {
    expect(
      prNumbersFromTitles(['combat: x (#303)\n\nbody (#1)', 'merge without number', 'career (#339)']),
    ).toEqual([303, 339]);
  });

  it('writes a comment that names the run, the failing tests and what to do', () => {
    const c = blameComment({
      kind: 'composition',
      sha: sha('a'),
      base: sha('b'),
      run: 9,
      url: 'https://github.com/o/g/actions/runs/5',
      failing: ['tests/sim/x.test.ts > a'],
      lacks: [303, 339],
      mainCi: 'success',
    });
    expect(c).toContain('<!-- bundle-train -->');
    expect(c).toContain('composition failure');
    expect(c).toContain('https://github.com/o/g/actions/runs/5');
    expect(c).toContain('#303 #339');
    expect(c).toContain('```text\ntests/sim/x.test.ts > a\n```');
    expect(c).toContain('merge origin/main');
    expect(
      blameComment({
        kind: 'own',
        sha: sha('a'),
        base: sha('b'),
        run: 9,
        url: 'u',
        failing: [],
        lacks: [],
        mainCi: 'pending',
      }),
    ).toContain('fails the full suite too');
    expect(conflictComment({ sha: sha('a'), base: sha('b'), run: 9, url: 'u' })).toContain(
      'merge origin/main',
    );
  });
});

// Fail fast (docs/engineering.md, "Fail fast on a PR") cancels the red job's own run, so the red
// job ends `cancelled` like its siblings, `gh run view --log-failed` prints only the gate's log, and
// the gate said only "suite is cancelled". The gate now names the red job, its failed step and its
// failing tests. The jobs below are trimmed from this repo's own API answer for PR run 37417692149
// (2026-10-06, a quick check whose unit slice 1 failed and cancelled the run).
describe('what a red PR run says', () => {
  const step = (name: string, conclusion: string, completed_at: string) => ({
    name,
    status: 'completed',
    conclusion,
    completed_at,
  });
  const jobs = [
    {
      id: 112119910216,
      name: 'suite / static',
      status: 'completed',
      conclusion: 'success',
      completed_at: '2026-10-06T05:18:53Z',
      steps: [
        step(
          "The quick check's static part (types, lint, format, packs, leak scan, size, notes, then the build and its size budget)",
          'success',
          '2026-10-06T05:18:50Z',
        ),
        step('Fail fast, cancel the rest of this PR run', 'skipped', '2026-10-06T05:18:50Z'),
      ],
    },
    {
      id: 112119910288,
      name: 'suite / unit (1/2)',
      status: 'completed',
      conclusion: 'cancelled',
      completed_at: '2026-10-06T05:20:13Z',
      steps: [
        step('Unit tests, one slice', 'failure', '2026-10-06T05:20:07Z'),
        step('Fail fast, cancel the rest of this PR run', 'success', '2026-10-06T05:20:11Z'),
      ],
    },
    {
      id: 112119910352,
      name: 'suite / unit (2/2)',
      status: 'completed',
      conclusion: 'cancelled',
      completed_at: '2026-10-06T05:21:32Z',
      steps: [
        step('Unit tests, one slice', 'cancelled', '2026-10-06T05:21:30Z'),
        step('Fail fast, cancel the rest of this PR run', 'skipped', '2026-10-06T05:21:30Z'),
      ],
    },
    {
      id: 112119911734,
      name: 'suite / browser (${{ matrix.shard }}/${{ strategy.job-total }})',
      status: 'completed',
      conclusion: 'skipped',
      completed_at: '2026-10-06T05:16:24Z',
      steps: [],
    },
    {
      id: 112121218792,
      name: 'quick',
      status: 'completed',
      conclusion: 'failure',
      completed_at: '2026-10-06T05:21:39Z',
      steps: [
        step('Every gate job passed, on the suite path or the skip path', 'failure', '2026-10-06T05:21:37Z'),
      ],
    },
  ];

  it('finds the red suite job by its failed step, though fail fast left it cancelled', () => {
    expect(redSuiteJobs(jobs)).toEqual([
      { id: 112119910288, name: 'suite / unit (1/2)', step: 'Unit tests, one slice', cancelled: true },
    ]);
    // The negative control: the job's own conclusion, the rule the train's report used, finds
    // nothing in a fail-fast run.
    expect(jobs.filter((j) => j.conclusion === 'failure' && /^suite \/ /.test(j.name))).toEqual([]);
  });

  it('finds a red job on a train too (no fail fast: it ends failure), first red first, never a control job', () => {
    const train = [
      {
        id: 2,
        name: 'suite / sim (3/6)',
        conclusion: 'failure',
        steps: [step('Seeded sim batch, one slice', 'failure', '2026-10-06T05:30:00Z')],
      },
      {
        id: 1,
        name: 'suite / browser (2/7)',
        conclusion: 'failure',
        steps: [step('Build, browser tests (one slice)', 'failure', '2026-10-06T05:20:00Z')],
      },
      {
        id: 3,
        name: 'control / sim (3/6)',
        conclusion: 'failure',
        steps: [step('Seeded sim batch, one slice', 'failure', '2026-10-06T05:10:00Z')],
      },
      { id: 4, name: 'suite / static', conclusion: 'failure', steps: [] },
    ];
    expect(redSuiteJobs(train)).toEqual([
      { id: 4, name: 'suite / static', step: '', cancelled: false },
      { id: 1, name: 'suite / browser (2/7)', step: 'Build, browser tests (one slice)', cancelled: false },
      { id: 2, name: 'suite / sim (3/6)', step: 'Seeded sim batch, one slice', cancelled: false },
    ]);
  });

  it('names the jobs a cancel cut short, for a red run with no failed step (a timeout, or a newer push)', () => {
    expect(cutShort(jobs)).toEqual(['suite / unit (2/2)']);
  });

  it('names the red job, its failed step, why it shows as cancelled, its failing tests and its log', () => {
    const r = failureReport(
      [
        {
          id: 112119910288,
          name: 'suite / unit (1/2)',
          step: 'Unit tests, one slice',
          cancelled: true,
          tests: [
            'src/render/interstate-roadside.test.ts > the kit > names every built rule',
            'unit tests (slice 1/2, 314 files): FAIL 3804 tests passed, 1 failed (313 files passed) (151.1s)',
          ],
        },
      ],
      ['suite / unit (2/2)'],
    );
    const text = r.lines.join('\n');
    expect(text).toContain('suite / unit (1/2)');
    expect(text).toContain('"Unit tests, one slice" failed');
    expect(text).toContain('fail fast');
    expect(text).toContain('src/render/interstate-roadside.test.ts > the kit > names every built rule');
    expect(text).toContain('gh run view --job 112119910288 --log');
    // A sibling the cancel cut short is not news when the red job is known.
    expect(text).not.toContain('suite / unit (2/2)');
    expect(r.summary).toContain(
      '```text\nsrc/render/interstate-roadside.test.ts > the kit > names every built rule\n',
    );
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0]).toMatch(/^::error title=red job%3A suite \/ unit \(1\/2\)::/);
    expect(r.annotations[0]).toContain('names every built rule%0Aunit tests');
  });

  // Main's run 37418801318 (2026-10-06, no fail fast on a push): browser 2/7 failed its build
  // (a download reset), and browser 5/7 hit its 10-minute timeout, which GitHub ends as cancelled
  // with no failed step. Both are news.
  it('beside a red job that did not fail fast, also names a job cut short (a timeout)', () => {
    const main = [
      {
        id: 112126240559,
        name: 'suite / browser (2/7)',
        status: 'completed',
        conclusion: 'failure',
        completed_at: '2026-10-06T05:43:25Z',
        steps: [step('Build, browser tests (one slice)', 'failure', '2026-10-06T05:43:24Z')],
      },
      {
        id: 112126240600,
        name: 'suite / browser (5/7)',
        status: 'completed',
        conclusion: 'cancelled',
        completed_at: '2026-10-06T05:52:14Z',
        steps: [step('Build, browser tests (one slice)', 'cancelled', '2026-10-06T05:52:13Z')],
      },
    ];
    const red = redSuiteJobs(main).map((j) => ({ ...j, tests: ['build: FAIL no dist/ (4.1s)'] }));
    expect(red.map((j) => j.name)).toEqual(['suite / browser (2/7)']);
    const r = failureReport(red, cutShort(main));
    const text = r.lines.join('\n');
    expect(text).toContain('suite / browser (2/7): "Build, browser tests (one slice)" failed\n');
    expect(text).toContain('Also cancelled while running, with no failed step: suite / browser (5/7).');
    expect(text).toContain('timeout');
    expect(r.annotations).toHaveLength(2);
    expect(r.annotations[1]).toMatch(/^::error title=cancelled while running::/);
  });

  it('says so when no suite job failed a step, and names the jobs a cancel cut short', () => {
    const r = failureReport([], ['suite / browser (5/7)']);
    expect(r.lines.join('\n')).toContain('No suite job of this run failed a step');
    expect(r.lines.join('\n')).toContain('suite / browser (5/7)');
    expect(r.lines.join('\n')).toContain('timeout');
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0]).toMatch(/^::error title=no red suite job::/);
  });

  it('a test name from a PR can never start a workflow command of its own', () => {
    const evil = 'tests/x.test.ts > a\n::add-mask::secret\r\n::stop-commands::x';
    const r = failureReport(
      [{ id: 7, name: 'suite / unit (1/2)', step: 'Unit tests, one slice', cancelled: true, tests: [evil] }],
      [],
    );
    // The runner reads a command at a line's start after trimming its leading spaces, so every
    // printed line from a log starts with "- ", and a test's own line breaks become spaces; the
    // annotation is one line.
    for (const line of r.lines.join('\n').split(/\r?\n|\r/)) expect(line.trimStart()).not.toMatch(/^::/);
    for (const a of r.annotations) expect(a).not.toMatch(/[\r\n]/);
    expect(r.annotations[0]).toContain('tests/x.test.ts > a ::add-mask::secret ::stop-commands::x');
    expect(r.summary).not.toMatch(/^\s*::/m);
    expect(workflowCommand('error', { title: 'a: b, c%' }, '50% done\nnext')).toBe(
      '::error title=a%3A b%2C c%25::50%25 done%0Anext',
    );
  });

  it('bounds the annotations: one per red job, at most five, each at most ten tests', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: i,
      name: `suite / sim (${i + 1}/6)`,
      step: 'Seeded sim batch, one slice',
      cancelled: false,
      tests: Array.from({ length: 15 }, (_, k) => `tests/sim/t${k}.test.ts > case`),
    }));
    const r = failureReport(many, []);
    expect(r.annotations).toHaveLength(5);
    // The failed step, ten tests and "... and 5 more".
    expect(r.annotations[0]!.split('%0A')).toHaveLength(12);
    expect(r.annotations[0]).toContain('%0A... and 5 more');
  });
});

// The workflows themselves, read as text (the repo has no YAML parser of its own): the suite is
// one file both callers share, the quick check stays small, a train never writes caches or runs
// PR code with a write token, and PR text never reaches a run: line.
describe('the workflows', () => {
  const wf = (name: string) =>
    readFileSync(path.join(import.meta.dirname, '..', '.github', 'workflows', name), 'utf8');
  const ci = wf('ci.yml');
  const suite = wf('suite.yml');
  const train = wf('train.yml');
  const kick = wf('train-kick.yml');
  /** The top-level jobs of a workflow: id to its block (every line indented 4 or more under it). */
  const jobs = (text: string) =>
    new Map(
      [...text.slice(text.indexOf('\njobs:\n')).matchAll(/^ {2}([\w-]+):\n((?:(?: {4}.*)?\n)*)/gm)].map(
        ([, id, block]) => [id ?? '', block ?? ''],
      ),
    );
  const SUITE_CALL = 'uses: ./.github/workflows/suite.yml';

  it('one suite: ci.yml and the train call suite.yml, and neither runs a test tier itself', () => {
    expect(jobs(ci).get('suite')).toContain(SUITE_CALL);
    expect(jobs(train).get('suite')).toContain(SUITE_CALL);
    expect(jobs(train).get('control')).toContain(SUITE_CALL);
    for (const text of [ci, train]) expect(text).not.toContain('npm run check');
    expect([...jobs(suite).keys()]).toEqual(['static', 'unit', 'sim', 'browser']);
  });

  // The landing invariant and the off switch also hang on these call sites: with `full: false`, or
  // with no heads to assemble, a gate or a train would go green on less than the whole suite on
  // exactly the bundle.
  it('the full path, main, every train and its control run the whole suite, on what the plan assembled', () => {
    expect(jobs(ci).get('suite')).toContain(
      "\n      full: ${{ github.event_name == 'push' || needs.route.outputs.path == 'full' }}\n",
    );
    const t = jobs(train);
    const ride = t.get('suite') ?? '';
    expect(ride).toMatch(/^ {4}needs: plan\n {4}if: needs\.plan\.outputs\.depart == 'true'\n/m);
    for (const line of [
      'full: true',
      'base: ${{ needs.plan.outputs.base }}',
      'heads: ${{ needs.plan.outputs.heads }}',
      'tree: ${{ needs.plan.outputs.tree }}',
    ])
      expect(ride, line).toContain(`\n      ${line}\n`);
    const control = t.get('control') ?? '';
    expect(control).toMatch(
      /^ {4}needs: \[plan, suite\]\n {4}if: always\(\) && needs\.plan\.outputs\.single != '' && needs\.suite\.result == 'failure'\n/m,
    );
    expect(control).toContain('\n      full: true\n');
    expect(control).toContain('\n      base: ${{ needs.plan.outputs.single }}\n');
    expect(control).not.toMatch(/^ {6}heads:/m);
    // Every suite job checks out base, then rebuilds the planned tree before anything installs.
    for (const [id, block] of jobs(suite)) {
      const steps = block.split(/\n {6}- /);
      expect(steps[1], id).toMatch(
        /^uses: actions\/checkout@\S+\n {8}with:\n {10}ref: \$\{\{ inputs\.base \}\}\n/,
      );
      expect(steps[2], id).toMatch(/^name: Assemble the train's tree\n {8}if: inputs\.heads != ''\n/);
      expect(steps[2], id).toContain(
        'run: node scripts/train.mjs assemble --base "$BASE" --heads "$HEADS" --tree "$TREE"',
      );
    }
  });

  it("the report runs after every departed train, red or green, and reads the suite's own result", () => {
    const report = jobs(train).get('report') ?? '';
    expect(report).toMatch(
      /^ {4}needs: \[plan, suite, control\]\n {4}if: always\(\) && needs\.plan\.outputs\.depart == 'true'\n/m,
    );
    expect(report).toContain('\n          TRAIN_RESULT: ${{ needs.suite.result }}\n');
    expect(report).toContain('\n          TRAIN_CONTROL: ${{ needs.control.result }}\n');
    expect(report).toContain('\n          TRAIN_BUNDLE: ${{ needs.plan.outputs.bundle }}\n');
    expect(report).toContain('\n          TRAIN_BASE: ${{ needs.plan.outputs.base }}\n');
  });

  it('the quick check is static (with the build and size budget) plus the unit slices, at most 3 jobs', () => {
    const j = jobs(suite);
    for (const id of ['sim', 'browser']) expect(j.get(id), id).toMatch(/^ {4}if: inputs\.full$/m);
    for (const id of ['static', 'unit']) expect(j.get(id), id).not.toMatch(/^ {4}if:/m);
    const unitSlices = /shard: \[([^\]]*)\]/.exec(j.get('unit') ?? '')?.[1]?.split(',') ?? [];
    expect(1 + unitSlices.length).toBeLessThanOrEqual(3);
    const stat = j.get('static') ?? '';
    expect(stat).toMatch(/if: \$\{\{ !inputs\.full \}\}\n {8}run: npm run check -- --tier static,budget\n/);
    expect(stat).toMatch(/if: inputs\.full\n {8}run: npm run check -- --tier static\n/);
  });

  it('every cache save in the suite waits on save-caches, and a train passes false', () => {
    const saves = [
      ...suite.matchAll(/- name: [^\n]*\n((?: {8}.*\n)*?) {8}uses: actions\/cache(?:\/save)?@/g),
    ];
    expect(saves.length).toBeGreaterThanOrEqual(4); // npm x4, Playwright, Chromium's packages
    for (const [, head] of saves) expect(head, head).toMatch(/if: .*inputs\.save-caches/);
    for (const id of ['suite', 'control']) {
      const block = jobs(train).get(id) ?? '';
      expect(block, id).toContain('save-caches: false');
      expect(block, id).toMatch(/permissions:\n {6}contents: read\n {4}uses:/);
    }
    expect(jobs(ci).get('suite')).toContain('save-caches: true');
  });

  it('one source of gate: the aggregate is named quick only on the train path, and the train has no gate job', () => {
    const agg = jobs(ci).get('aggregate') ?? '';
    expect(agg).toMatch(
      /^ {4}name: \$\{\{ needs\.route\.outputs\.path == 'train' && 'quick' \|\| 'gate' \}\}$/m,
    );
    expect(jobs(ci).has('gate')).toBe(false);
    expect(train).not.toMatch(/name: gate\b/);
  });

  it('only main-code jobs of the train can write, and they run main, never a bundle', () => {
    expect(train).toMatch(/\npermissions: \{\}\n/);
    expect(train).not.toContain('pull_request_target');
    for (const [id, block] of jobs(train)) {
      const writes = /: write$/m.test(block);
      if (!writes) continue;
      expect(block, id).not.toContain(SUITE_CALL);
      expect(block, id).not.toMatch(/npm (?:ci|run)/);
      for (const ref of block.matchAll(/^ {10}ref: (.+)$/gm)) expect(ref[1], id).toBe('${{ github.sha }}');
    }
    // The PR listing (GraphQL statusCheckRollup) reads check runs: plan and report need it.
    for (const id of ['plan', 'report']) expect(jobs(train).get(id), id).toContain('checks: read');
    expect(kick).toMatch(/\npermissions: \{\}\n/);
    expect(kick).toContain('types: [auto_merge_enabled, ready_for_review]');
    expect(train).toContain('workflows: [ci, train-kick]');
  });

  it('no run: line expands an expression other than the matrix slice: PR text and inputs go through env', () => {
    /** Every run: block's text, the inline line or the indented lines under `run: |`. */
    const runs = (text: string) =>
      [...text.matchAll(/^( +)(?:- )?run: (?:\|\n((?:\1 {2,}.*\n|[ \t]*\n)*)|(.*)\n)/gm)].map(
        (m) => m[2] ?? m[3] ?? '',
      );
    for (const [name, text] of [
      ['ci.yml', ci],
      ['suite.yml', suite],
      ['train.yml', train],
      ['train-kick.yml', kick],
    ] as const) {
      const blocks = runs(text);
      expect(blocks.length, name).toBeGreaterThan(0);
      for (const b of blocks)
        for (const [expr] of b.matchAll(/\$\{\{[^}]*\}\}/g))
          expect(expr, `${name}: ${expr}`).toMatch(/^\$\{\{ (?:matrix\.shard|strategy\.job-total) \}\}$/);
    }
  });

  // A red PR run (docs/engineering.md, "Fail fast on a PR"): the gate's log is all that
  // `gh run view --log-failed` prints, so the gate names the red job and its failing tests there,
  // in its summary and in an annotation. It reads the run's jobs and logs, so it needs actions: read,
  // and never a write token: on a PR the gate's run holds PR code's results.
  it("a red run's gate names the red job and its failing tests, right after its verdict, with a read-only token", () => {
    const agg = jobs(ci).get('aggregate') ?? '';
    expect(agg).toMatch(/^ {4}permissions:\n {6}actions: read\n {6}contents: read\n {4}steps:\n/m);
    expect(agg).not.toMatch(/: write$/m);
    const steps = agg.split(/\n {6}- /);
    const verdict = steps.findIndex((s) => s.startsWith('name: Every gate job passed'));
    const names = steps.findIndex((s) => s.includes('run: node scripts/train.mjs failures'));
    expect(verdict, 'the verdict step').toBeGreaterThan(0);
    expect(steps[verdict]).toMatch(/\n {8}id: verdict\n/);
    expect(names, 'the naming step follows the verdict').toBe(verdict + 1);
    const step = steps[names] ?? '';
    // Only when the verdict itself is red (not on a green gate, not when the checkout failed),
    // and it can never hold the gate up or change its colour.
    expect(step).toContain("\n        if: failure() && steps.verdict.outcome == 'failure'\n");
    expect(step).toContain('\n        continue-on-error: true\n');
    expect(step).toMatch(/\n {8}timeout-minutes: [12]\n/);
    expect(step).toContain('\n          GH_TOKEN: ${{ github.token }}\n');
    // The tree record after it still needs a green verdict: no status function in its if:.
    const record = steps.find((s) => s.startsWith('name: Record the tree this PR run tested')) ?? '';
    expect(record).toMatch(/\n {8}if: github\.event_name == 'pull_request' && /);
  });

  it('the fail-fast step names its own job in an annotation before it cancels the run', () => {
    for (const [id, block] of jobs(suite)) {
      const steps = block.split(/\n {6}- /);
      const last = steps[steps.length - 1] ?? '';
      expect(last, id).toMatch(/^name: Fail fast, cancel the rest of this PR run\n/);
      // The job's display name, as its name: line gives it (the job id alone drops the slice).
      const display = /^ {4}name: (.+)$/m.exec(block)?.[1];
      expect(display, id).toBeDefined();
      expect(last, id).toContain(`\n          RED_JOB: ${display}\n`);
      const named = last.indexOf('::error title=fail-fast::$RED_JOB ');
      expect(named, id).toBeGreaterThan(-1);
      expect(named, id).toBeLessThan(last.indexOf('gh run cancel'));
    }
  });

  it("train.mjs knows the gate's failures command", () => {
    const env = { ...process.env };
    for (const k of ['GITHUB_REPOSITORY', 'GH_TOKEN', 'GITHUB_TOKEN']) delete env[k];
    const res = spawnSync(process.execPath, [path.join(import.meta.dirname, 'train.mjs'), 'failures'], {
      env,
      encoding: 'utf8',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('GITHUB_REPOSITORY is not set');
    expect(res.stderr).not.toContain('usage');
  });

  it('the checked-in switch reads cleanly', () => {
    const cfg = loadConfig();
    expect(typeof cfg.live).toBe('boolean');
    expect(cfg).toMatchObject({ cap: 8, landingMinutes: 10, mainWaitMinutes: 15 });
  });
});
