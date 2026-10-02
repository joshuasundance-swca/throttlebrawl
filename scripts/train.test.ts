// The bundle train's logic (docs/engineering.md, "The bundle train"): routing, eligibility, the
// bundle order, assembly (on a real git repo), the landing invariant, the split plan, status
// posting and the failure comments. The fixtures follow the real producers: the GraphQL listing's
// shape and the failing-test lines are copied from this repo's own API answers and CI logs
// (2026-10-02).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  TRAIN_IDENT,
  assemble,
  blameComment,
  capOf,
  clip,
  conflictComment,
  decide,
  eligibility,
  failingTests,
  fenceSafe,
  hasMarker,
  isDocsOnly,
  normalizePr,
  postInOrder,
  postStatus,
  prList,
  prNumbersFromTitles,
  readConfig,
  route,
  selectBundle,
  stateOf,
  withCap,
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

  beforeAll(() => {
    dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'train-')));
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
  });
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
