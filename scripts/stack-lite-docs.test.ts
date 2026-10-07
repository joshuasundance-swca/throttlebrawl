// The rule for a lane that needs another lane's unmerged work (AGENTS.md, docs/engineering.md and the
// lane-run.js template): build on the parent's branch, open the PR against main only after the parent
// has merged. A rule like this goes stale without a failing build, so each page's statement of it is
// read back against the pieces that make it true (ci.yml, scripts/train.mjs, the repo settings the
// engineering page records), and each checker is shown to find a planted fault (the negative
// controls), so a green run says the check can see.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRS_QUERY } from './train.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const agents = read('AGENTS.md');
const engineering = read('docs/engineering.md');
const ciYml = read('.github/workflows/ci.yml');
const trainSource = flat(read('scripts/train.mjs'));
const laneRun = read('.claude/workflows/lane-run.js');

// ---------------------------------------------------------------------------------------------
// Checkers (each is run on the real page and on a planted fault)

const level = (line: string) => /^(#{1,6}) /.exec(line)?.[1]?.length ?? 0;

/** The text under a heading, up to the next heading of the same or a higher level. */
function section(md: string, title: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => level(l) > 0 && l.replace(/^#+ /, '').trim() === title);
  if (start < 0) return '';
  const depth = level(lines[start] ?? '');
  const end = lines.findIndex((l, i) => i > start && level(l) > 0 && level(l) <= depth);
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** A top-level bullet of a page, by its bold lead-in, up to the next bullet, heading or blank line. */
function bullet(md: string, lead: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`- **${lead}`));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^(- |#|$)/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join(' ');
}

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens. */
const slug = (heading: string) =>
  heading
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

/** The relative links of a block that point at no file, or at an anchor the file does not have. */
function brokenLinks(block: string, from: string): string[] {
  const broken: string[] = [];
  for (const m of block.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1] ?? '';
    if (/^[a-z]+:/i.test(target)) continue;
    const [file = '', anchor] = target.split('#');
    const abs = path.join(root, path.dirname(from), file);
    if (!existsSync(abs)) {
      broken.push(target);
      continue;
    }
    if (anchor && /\.md$/.test(abs)) {
      const slugs = read(path.relative(root, abs))
        .split('\n')
        .filter((l) => level(l) > 0)
        .map((l) => slug(l.replace(/^#+ /, '')));
      if (!slugs.includes(anchor)) broken.push(target);
    }
  }
  return broken;
}

/** The claims a block of text lacks, by name: each claim is a pattern it must match. */
const gaps = (text: string, claims: [string, RegExp][]) =>
  claims.filter(([, re]) => !re.test(flat(text))).map(([name]) => name);

/** An instruction that points a PR at another lane's branch, rebases onto the parent or force-pushes. */
const unsafeAdvice = (text: string) =>
  [
    /open (?:your|the|a) PR against (?:the |its )?(?:parent|<parent>)/i,
    /--base (?:lane|<parent)/,
    /\bgit rebase\b/,
    /\bgit push\b[^.]*--force/,
  ]
    .filter((re) => re.test(flat(text)))
    .map(String);

// ---------------------------------------------------------------------------------------------

const RULE: [string, RegExp][] = [
  ['branches from the parent branch, untracked', /`git switch --no-track -c <your branch> origin\/<parent>`/],
  ['pushes with -u, never bare', /`git push -u origin HEAD`.*never a bare `git push`/],
  ['bounded wait', /still not merged after 8 hours, push your branch, report it blocked and end/],
  ['builds and tests there', /build and run your tests there/],
  ['opens the PR against main', /open your PR against `main`/i],
  ['only after the parent is MERGED', /only after the parent's PR is MERGED/],
  ['then merges origin/main in', /merge `origin\/main` into your branch/],
  ['never a rebase', /never a rebase/],
  ['never a force-push', /never a force-push/],
  ['re-runs its tests', /re-run your tests/],
  ['arms auto-merge as usual', /arm auto-merge as usual/],
  [
    'merges the parent again when it changes',
    /If the parent changes after you branched, merge its branch again/,
  ],
  ['rebuilds on main when the parent is CLOSED', /CLOSED unmerged, rebuild on `main`/],
  ['never opens a PR against a lane branch', /Never open a PR against another lane's branch/],
];

describe("AGENTS.md: a lane that needs another lane's unmerged work", () => {
  const rule = bullet(agents, "A lane that needs another lane's unmerged work");

  it('is in "Runs: lanes, one keeper, one live check", states every piece of the rule, and advises nothing unsafe', () => {
    expect(rule).not.toBe('');
    expect(flat(section(agents, 'Runs: lanes, one keeper, one live check'))).toContain(flat(rule));
    expect(gaps(rule, RULE)).toEqual([]);
    expect(unsafeAdvice(rule)).toEqual([]);
  });

  it("is tagged [decided] with the maintainer's words, and says gh stack was not taken", () => {
    expect(flat(rule)).toContain(
      '`[decided]` (the maintainer, 2026-10-06: "Proceed as recommended without gh stack at this time.")',
    );
  });

  it('links to the mechanics, and the link resolves', () => {
    expect(rule).toContain('](docs/engineering.md#lanes-that-build-on-another-lane)');
    expect(brokenLinks(rule, 'AGENTS.md')).toEqual([]);
  });

  it('control: the checkers find each planted fault', () => {
    const good = flat(rule);
    expect(gaps(good.replace('never a rebase', 'then rebase'), RULE)).toEqual(['never a rebase']);
    expect(
      gaps(good.replace("only after the parent's PR is MERGED", 'once the parent looks done'), RULE),
    ).toEqual(['only after the parent is MERGED']);
    expect(gaps(good.replace('never a force-push', 'a force-push is fine'), RULE)).toEqual([
      'never a force-push',
    ]);
    expect(
      gaps(good.replace("Never open a PR against another lane's branch", 'Open it early'), RULE),
    ).toEqual(['never opens a PR against a lane branch']);
    expect(gaps('', RULE)).toHaveLength(RULE.length);
    expect(
      unsafeAdvice('Open your PR against the parent lane branch, then git rebase onto main'),
    ).toHaveLength(2);
    expect(unsafeAdvice('git push --force-with-lease origin lane/x/y')).toHaveLength(1);
    expect(brokenLinks('[x](docs/engineering.md#no-such-lane-heading)', 'AGENTS.md')).toEqual([
      'docs/engineering.md#no-such-lane-heading',
    ]);
    expect(bullet('- **Other** x\n- **Wanted** y\n', 'Wanted')).toBe('- **Wanted** y');
    expect(bullet('- **Other** x\n', 'Wanted')).toBe('');
  });
});

const ENGINEERING_CLAIMS: [string, RegExp][] = [
  ['branches from the parent, untracked', /`git switch --no-track -c <your branch> origin\/<parent>`/],
  ['pushes with -u', /`git push -u origin HEAD`/],
  ['bounded wait', /still open after 8 hours \(red, or stuck\), push your branch, report it blocked and end/],
  ['waits for the merge', /only after the parent's PR is MERGED/],
  ['merges main in', /`git merge origin\/main` into your branch/],
  ['no rebase, no force-push', /Never a rebase and never a force-push/],
  ['parent CLOSED', /If the parent's PR is CLOSED unmerged, rebuild on `main`/],
  ['no PR against a lane branch', /Never open a PR against another lane's branch/],
  ['ci.yml reason', /`pull_request` with `branches: \[main\]` and the default activity types/],
  ['edited event reason', /gets no CI, and changing a PR's base \(the "edited" event\) starts none/],
  ['train reason', /`baseRefName: "main"` \(`openPrs\(\)` in `scripts\/train\.mjs`\)/],
  [
    'protection reason',
    /is on `main` only\. Auto-merge armed on a PR aimed at a lane branch would merge it at once, with no checks/,
  ],
  ['branch deletion reason', /deletes a merged PR's branch .* retargets PRs based on it to `main`/],
  [
    'stacked PRs reason',
    /stacked PRs need CI and train changes, and add CI load, which is the bottleneck, for no gain an agent lane needs/,
  ],
  [
    'gh stack deferred',
    /`gh stack` extension \(github\/gh-stack\) was considered and deferred `\[decided\]`/,
  ],
  [
    'cascade rebase reason',
    /cascade rebase and force-with-lease push conflict with the never-rebase and never-force-push rules/,
  ],
  ['train sees main only', /CI and the train only see PRs into `main`/],
  [
    'merge path reason',
    /its merge lands the whole stack at once, directly or through GitHub's merge queue, never through the train/,
  ],
  ['revisit', /Revisit if the repo ever adopts the merge queue/],
  ['template', /`needs`/],
  ['test', /`scripts\/stack-lite-docs\.test\.ts`/],
];

describe('docs/engineering.md: lanes that build on another lane', () => {
  const part = section(engineering, 'Lanes that build on another lane');

  it('is a subsection of "Parallel agent lanes", makes every claim, and advises nothing unsafe', () => {
    expect(part).not.toBe('');
    expect(section(engineering, 'Parallel agent lanes')).toContain('### Lanes that build on another lane');
    expect(gaps(part, ENGINEERING_CLAIMS)).toEqual([]);
    expect(unsafeAdvice(part)).toEqual([]);
  });

  it('gives reasons that are true of the repo as it stands', () => {
    // ci.yml: a pull_request trigger on main only, with the default activity types
    const trigger = /\n {2}pull_request:\n((?: {4}.*\n)+)/.exec(ciYml)?.[1] ?? '';
    expect(trigger).toMatch(/branches: \[main\]/);
    expect(trigger).not.toMatch(/types:/);
    // the train lists only PRs into main
    expect(PRS_QUERY).toContain('baseRefName: "main"');
    expect(trainSource).toContain('async function openPrs()');
    // the settings the page's other section records: merged branches deleted, gate required, no merge queue
    const settings = section(engineering, 'Branch protection and auto-merge');
    expect(settings).toContain('**Automatically delete head branches on**');
    expect(settings).toMatch(/Require the status check `gate`/);
    expect(settings).toMatch(/Merge queues would handle that safely/);
  });

  it('links the template and the test, and its links resolve', () => {
    expect(part).toContain('](../.claude/workflows/lane-run.js)');
    expect(existsSync(path.join(root, 'scripts/stack-lite-docs.test.ts'))).toBe(true);
    expect(brokenLinks(part, 'docs/engineering.md')).toEqual([]);
  });

  it('control: a page that dropped a reason or the deferral is found, and a missing section is empty', () => {
    expect(
      gaps(part.replace('CI and the train only see PRs into `main`', 'nothing else'), ENGINEERING_CLAIMS),
    ).toEqual(['train sees main only']);
    expect(
      gaps(part.replace('Revisit if the repo ever adopts the merge queue', ''), ENGINEERING_CLAIMS),
    ).toEqual(['revisit']);
    expect(gaps(part.replace('would merge it at once', 'waits for checks'), ENGINEERING_CLAIMS)).toEqual([
      'protection reason',
    ]);
    expect(gaps('', ENGINEERING_CLAIMS)).toHaveLength(ENGINEERING_CLAIMS.length);
    expect(section('## Other\nx\n', 'Lanes that build on another lane')).toBe('');
    // the ci.yml and train checks can fail: a trigger with another branch list, a query with no base
    expect(/branches: \[main\]/.test('pull_request:\n    branches: [main, "lane/**"]\n')).toBe(false);
    expect('query { pullRequests(states: OPEN) }').not.toContain('baseRefName: "main"');
  });
});

const TEMPLATE_CLAIMS: [string, RegExp][] = [
  ['accepts needs', /needs\? \}/],
  ['awaits the parent', /parent = await runLane\(lanes\.find\(\(x\) => x\.key === l\.needs\)\)/],
  [
    'branches from the parent PR head, untracked',
    /git switch --no-track -c <your branch> origin\/<that PR\\?'s head branch>/,
  ],
  ['pushes with -u', /push with git push -u origin HEAD/],
  ['PR only after MERGED', /open your own PR against main only after that PR is MERGED/],
  ['merges main in', /after merging origin\/main into your branch/],
  ['keeper keeps watching', /A lane that needs another lane opens its PR only once/],
  ['rejects a bad needs', /needs must be the key of another lane in this run/],
  ['rejects a cycle', /needs makes a cycle/],
];

describe('lane-run.js: the template builds a dependent lane on its parent', () => {
  it('lets a lane name the lane it needs, starts it after that lane, and tells it the rule', () => {
    expect(gaps(laneRun, TEMPLATE_CLAIMS)).toEqual([]);
    // it waits for the parent before taking a pool slot, so a waiting lane never holds one
    expect(laneRun.indexOf('parent = await runLane')).toBeGreaterThan(0);
    expect(laneRun.indexOf('parent = await runLane')).toBeLessThan(
      laneRun.indexOf('await acquire();\n  try'),
    );
    // it never tells a lane to open its PR against the parent's branch
    expect(unsafeAdvice(laneRun)).toEqual([]);
    expect(flat(laneRun)).not.toMatch(/--base/);
  });

  it('control: a template that opens the PR early, or never checks a cycle, is found', () => {
    expect(
      gaps(laneRun.replace('only after that PR is MERGED', 'as soon as you are done'), TEMPLATE_CLAIMS),
    ).toEqual(['PR only after MERGED']);
    expect(gaps(laneRun.replace('needs makes a cycle', 'ok'), TEMPLATE_CLAIMS)).toEqual(['rejects a cycle']);
    expect(unsafeAdvice('gh pr create --base lane/x/y')).toHaveLength(1);
    // the order check can fail: a slot taken before the parent is awaited
    const early = 'await acquire();\n  try {}\n  parent = await runLane(x)';
    expect(early.indexOf('parent = await runLane')).toBeGreaterThan(early.indexOf('await acquire();\n  try'));
  });
});
