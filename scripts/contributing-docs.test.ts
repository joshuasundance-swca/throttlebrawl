// The pages a first-time contributor or a coding agent reads to learn how a PR lands: CONTRIBUTING.md,
// the README's status, and the plain-words summary at the top of docs/engineering.md's train section.
// A page like this goes stale without a failing build, so each claim it makes is read back against the
// code or workflow that decides it (scripts/train.mjs, suite.yml), and each checker is shown to
// find a planted fault (the negative controls), so a green run says the check can see.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTE_ARMED, NOTE_DRAFT, NOTE_MERGED, NOTE_UNARMED, isDocsOnly, route } from './train.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');
const contributing = read('CONTRIBUTING.md');
const readme = read('README.md');
const engineering = read('docs/engineering.md');
const trainSource = read('scripts/train.mjs').replace(/\s+/g, ' ');
const suiteYml = read('.github/workflows/suite.yml');

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

/** The numbered steps ("1. ...", with their wrapped lines) of a block. */
function steps(block: string): string[] {
  return block
    .split(/\n(?=\d+\. )/)
    .filter((s) => /^\d+\. /.test(s))
    .map((s) => s.replace(/\s+/g, ' ').trim());
}

/** The patterns no step matches in order (an empty list when every one is covered, in order). */
function missingInOrder(list: string[], patterns: RegExp[]): string[] {
  const missing: string[] = [];
  let from = 0;
  for (const p of patterns) {
    const at = list.findIndex((s, i) => i >= from && p.test(s));
    if (at < 0) missing.push(String(p));
    else from = at;
  }
  return missing;
}

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens. */
const slug = (heading: string) =>
  heading
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

/** The relative links of a page that point at no file, or at an anchor the file does not have. */
function brokenLinks(md: string, from: string): string[] {
  const broken: string[] = [];
  for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1] ?? '';
    if (/^(?:[a-z]+:|#)/i.test(target) && !target.startsWith('#')) continue;
    const [file = '', anchor] = target.split('#');
    const abs = file ? path.join(root, path.dirname(from), file) : path.join(root, from);
    if (!existsSync(abs)) {
      broken.push(target);
      continue;
    }
    if (anchor && /\.md$/.test(abs)) {
      const slugs = readFileSync(abs, 'utf8')
        .split('\n')
        .filter((l) => level(l) > 0)
        .map((l) => slug(l.replace(/^#+ /, '')));
      if (!slugs.includes(anchor)) broken.push(target);
    }
  }
  return broken;
}

/**
 * The quoted phrases of a table of what a status says ("`riding train N: main abc1234 + #1 #2`"),
 * each cut at its placeholders into the literal pieces it must be built from.
 */
function quotedPhrases(block: string): { phrase: string; pieces: string[] }[] {
  const firstCells = block
    .split('\n')
    .filter((l) => l.startsWith('  | `') || l.startsWith('| `'))
    .map((l) => /\|\s*(.*?)\s*\|/.exec(l)?.[1] ?? '');
  return firstCells.flatMap((cell) =>
    [...cell.matchAll(/`([^`]+)`/g)].map((m) => {
      const phrase = m[1] ?? '';
      const pieces = phrase
        .split(/\.\.\.|\bN\b|abc1234|#1 #2|#a #b/)
        .map((p) => p.trim())
        .filter((p) => p.length > 3);
      return { phrase, pieces };
    }),
  );
}

/**
 * The phrases with a piece the script's own text does not hold. The script builds some of its words
 * ("fails" or "timed out" before "alone on main"), so the text is read with both spelled out.
 */
function phrasesNotInSource(list: { phrase: string; pieces: string[] }[], source: string): string[] {
  const text = `${source.replaceAll('${red}', 'fails')} ${source.replaceAll('${red}', 'timed out')}`;
  return list
    .filter(({ pieces }) => !pieces.every((p) => text.includes(p.replace(/^\W+|\W+$/g, ''))))
    .map((p) => p.phrase);
}

/** What a page says about the suite's size: "sim in 7, browser in 8" and "N suite jobs". */
function claimedSuiteSize(md: string) {
  const slices = /sim in (\d+), browser in (\d+)/.exec(md);
  const jobs = [...md.matchAll(/(\d+) suite jobs/g)].map((m) => Number(m[1]));
  return { sim: Number(slices?.[1]), browser: Number(slices?.[2]), jobs };
}

/** How many slices each matrix of suite.yml has, read from its `shard: [...]` lists, in file order. */
function suiteSize(yml: string) {
  const lists = [...yml.matchAll(/shard: \[([^\]]*)\]/g)].map((m) => (m[1] ?? '').split(',').length);
  const [unit = 0, sim = 0, browser = 0] = lists;
  return { unit, sim, browser, all: 1 + unit + sim + browser };
}

/** Absolute user paths, e-mail addresses that are not no-reply ones, and user names of the dev machine. */
function leaks(text: string): string[] {
  return [
    ...text.matchAll(/[A-Za-z]:\\Users\\\S+|\/Users\/\S+|\/home\/\S+/g),
    ...[...text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].filter((m) => !/noreply/i.test(m[0])),
  ].map((m) => m[0]);
}

// ---------------------------------------------------------------------------------------------

describe('CONTRIBUTING.md: how a PR lands', () => {
  const landing = section(contributing, 'How a pull request lands');
  const list = steps(landing);
  // The brief's order: the quick check, arming auto-merge, the train batches and runs the full suite
  // once, green lands, red splits and comments.
  const order = [
    /quick/i,
    /gh pr merge --auto --squash/,
    /train/i,
    /full suite[^.]*\bonce\b|\bonce\b[^.]*full suite/i,
    /green[^.]*(lands|merges)|(lands|merges)[^.]*green/i,
    /red[^.]*split/i,
    /comment/i,
  ];

  it('has a numbered section of plain steps, in the order a PR goes through them', () => {
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.length).toBeLessThanOrEqual(10);
    expect(missingInOrder(list, order)).toEqual([]);
  });

  it('control: the checker finds a missing step and a step out of order', () => {
    expect(
      missingInOrder(
        list.filter((s) => !/gh pr merge/.test(s)),
        order,
      ),
    ).toContain(String(/gh pr merge --auto --squash/));
    expect(missingInOrder([...list].reverse(), order).length).toBeGreaterThan(0);
    expect(steps('no steps here\n- a bullet')).toEqual([]);
    expect(section('# A\ntext\n## B\nx\n# C\ny', 'A')).toContain('x');
    expect(section('# A\ntext\n## B\nx\n# C\ny', 'Z')).toBe('');
  });

  it('says what `quick` and `gate` mean, where to read the gate text, and how to see why a PR waits', () => {
    const text = contributing.replace(/\s+/g, ' ');
    for (const [what, re] of [
      ['quick is the fast check, not a licence to merge', /`quick`[^.]*(fast|first|few)/i],
      ['gate is the one required check', /`gate`[^.]*(required|only check|one check)/i],
      ['the gate text is read with gh pr checks', /gh pr checks <?[#\w]+>?/],
      ['the train line says why it waits', /`train`[^.]*(why|waiting|waits)/i],
      ['the plan log of the train run', /\bplan\b[^.]*\blog\b|\blog\b[^.]*\bplan\b/i],
      ['the escape hatch and when to use it', /use\s+`?\[full-gate\]/i],
      ['a red main', /main`? is red|red main/i],
      ['forks', /fork/i],
      ['first-time contributors may need approval to run CI', /approv/i],
      ['Dependabot', /Dependabot/],
      ['docs-only', /docs-only/i],
      ['.github/', /\.github\//],
      ['where to start', /README\.md/],
    ] as const)
      expect(text, what).toMatch(re);
    for (const target of ['AGENTS.md', 'docs/engineering.md', 'docs/architecture.md'])
      expect(contributing, target).toContain(`](${target}`);
  });

  it('quotes the `train` notes and the `gate` lines the script writes, in the words it writes them', () => {
    const notes = quotedPhrases(section(contributing, 'What `train` says'));
    const gates = quotedPhrases(section(contributing, 'What `gate` says'));
    expect(notes.length).toBeGreaterThanOrEqual(5);
    expect(gates.length).toBeGreaterThanOrEqual(8);
    expect(phrasesNotInSource(notes, trainSource)).toEqual([]);
    expect(phrasesNotInSource(gates, trainSource)).toEqual([]);
    // The constants the notes come from start with the quoted words.
    for (const note of [NOTE_UNARMED, NOTE_DRAFT, NOTE_ARMED])
      expect(contributing, note).toContain(note.split(' (')[0]);
    expect(NOTE_MERGED).toMatch(/^merged/);
  });

  it('control: the quote checker finds words the script does not write', () => {
    const planted = quotedPhrases(
      '| `train N: the bundle exploded ...` | x | y |\n| `riding train N: main abc1234 + #1 #2` | x | y |\n| `waiting: arm auto-merge ...` | x | y |',
    );
    expect(planted.map((p) => p.pieces.length)).toEqual([2, 2, 1]);
    expect(phrasesNotInSource(planted, trainSource)).toEqual(['train N: the bundle exploded ...']);
    expect(quotedPhrases('no table')).toEqual([]);
  });

  // Each kind of PR the page names, through the router that decides it: the page's claims, run.
  it('sends each kind of PR down the path the page says, with the train on or off', () => {
    const pr = { live: true, fork: false, author: 'someone', title: 't', body: '', files: ['src/a.ts'] };
    const docs = ['docs/a.md', 'changes/2026-10-06-a.md'];
    const kinds: [string, Partial<typeof pr>, 'full' | 'train' | 'docs'][] = [
      ['an ordinary change', {}, 'train'],
      ['a docs-only change', { files: docs }, 'docs'],
      ['a fork', { fork: true }, 'full'],
      ['Dependabot', { author: 'dependabot[bot]' }, 'full'],
      ['a change under .github/', { files: ['.github/workflows/ci.yml'] }, 'full'],
      ['[full-gate] in the title', { title: 'fix [full-gate]' }, 'full'],
      ['[full-gate] alone on a line of the body', { body: 'why\n[full-gate]\n' }, 'full'],
      ['a sentence that names the marker', { body: 'a [full-gate] change would help' }, 'train'],
    ];
    for (const [what, over, path] of kinds) {
      expect(route({ ...pr, ...over }).path, what).toBe(path);
      // The train off changes nothing but the ordinary change (the page tells the same story).
      expect(route({ ...pr, ...over, live: false }).path, `${what}, train off`).toBe(
        path === 'train' ? 'full' : path,
      );
    }
    const text = contributing.replace(/\s+/g, ' ');
    expect(text).toMatch(/alone on a line/i);
    expect(text).toMatch(/sentence[^.]*does not count/i);
  });

  // #575 ran the full suite for a docs-only PR while the train was off, because the old router asked
  // about the switch before it asked about docs. The old order, planted:
  it('control: the old router (the switch before docs) disagrees with the page on a docs-only PR', () => {
    const oldRoute = (o: Parameters<typeof route>[0]) =>
      o.fork || o.live === false ? 'full' : route(o).path;
    const pr = { live: false, fork: false, author: 'someone', title: 't', body: '', files: ['docs/a.md'] };
    expect(route(pr).path).toBe('docs');
    expect(oldRoute(pr)).toBe('full');
  });

  it('lists as shipping exactly the places the router counts as shipping', () => {
    const shipped = /none of them ships[^:]*:\s*\n\s*\n\s*(`[^\n]*)/i.exec(contributing)?.[1] ?? '';
    const named = [...shipped.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
    expect(named).toEqual(
      expect.arrayContaining([
        'README.md',
        'THIRD_PARTY_ASSETS.md',
        'space/',
        'public/',
        'src/',
        'packs/',
        'tests/',
      ]),
    );
    const sample = (n: string) => (n.endsWith('/') ? `${n}x.md` : n);
    for (const n of named) expect(isDocsOnly(['docs/a.md', sample(n)]), n).toBe(false);
    // control: a place that does not ship is caught
    expect(isDocsOnly(['docs/a.md', sample('docs/')])).toBe(true);
  });

  it('keeps personal details out (it is public)', () => {
    expect(leaks(contributing)).toEqual([]);
    expect(leaks(readme)).toEqual([]);
    expect(leaks(section(engineering, 'The bundle train').slice(0, 6000))).toEqual([]);
    // control (the planted paths are built in pieces so the leak scan does not see them here)
    const winHome = ['C:', 'Users', 'someone', 'x'].join('\\');
    const unixHome = ['', 'home', 'me', 'y'].join('/');
    expect(leaks(`see ${winHome} and ${unixHome} or me@example.com`)).toHaveLength(3);
    expect(leaks('12345+name@users.noreply.github.com')).toEqual([]);
  });
});

describe('README: what the game is now', () => {
  it('no longer calls the build a test screen, says plainly what works, and links CONTRIBUTING.md', () => {
    expect(readme).not.toMatch(/test screen|coloured|colored/i);
    const text = readme.replace(/\s+/g, ' ');
    expect(text).toMatch(/work in progress/i);
    expect(text).toMatch(/playable/i);
    expect(text).toContain('](CONTRIBUTING.md)');
    expect(text).toContain('](AGENTS.md)');
    expect(text).toMatch(/not (?:been )?(?:launched|released)|before (?:the )?(?:public )?launch/i);
  });

  it('only claims what the code has: a career, a garage and its fighting, and a road with traffic', () => {
    for (const dir of ['src/career', 'src/sim', 'src/road'])
      expect(existsSync(path.join(root, dir)), dir).toBe(true);
    expect(existsSync(path.join(root, 'src/career/garage.ts'))).toBe(true);
    expect(readme).toMatch(/career/i);
    expect(readme).toMatch(/traffic/i);
  });
});

describe('docs/engineering.md: the train section opens in plain words', () => {
  const train = section(engineering, 'The bundle train');
  const head = train.split('**Why.**')[0] ?? '';

  it('puts a plain-words summary of the whole route before the reasons and the detail', () => {
    expect(head).toMatch(/In plain words/i);
    const text = head.replace(/\s+/g, ' ');
    for (const [what, re] of [
      ['the quick check', /quick check/i],
      ['arming auto-merge', /arm(?:s|ed|ing)? auto-merge/i],
      ['the train combines PRs and runs the full suite once', /once/i],
      ['green lands', /(?:lands|merges)/i],
      ['red splits', /split/i],
      ['the two status lines', /`train`[^.]*`gate`|`gate`[^.]*`train`/],
      ['the escape hatch', /\[full-gate\]/],
      ['the paths', /docs/i],
      ['forks', /fork/i],
      ['the pointer to CONTRIBUTING', /CONTRIBUTING\.md/],
    ] as const)
      expect(text, what).toMatch(re);
    expect(train.indexOf('In plain words')).toBeLessThan(train.indexOf('**The switch.**'));
  });

  it('control: a section with the summary after the detail, or none, is found', () => {
    const planted = '## S\n**Why.** x\n\n> **In plain words.** later\n';
    expect((section(planted + '## T\n', 'S').split('**Why.**')[0] ?? '').match(/In plain words/i)).toBeNull();
    expect(section('## S\n', 'S').split('**Why.**')[0]).toBe('');
  });

  it('counts the suite as suite.yml does', () => {
    const size = suiteSize(suiteYml);
    expect(size).toMatchObject({ unit: 2, sim: 7, browser: 8, all: 18 });
    for (const [name, text] of [
      ['the train section', train],
      ['the CI section', section(engineering, 'CI on GitHub Actions')],
      ['CONTRIBUTING.md', contributing],
    ] as const) {
      const claimed = claimedSuiteSize(text);
      if (!Number.isNaN(claimed.sim))
        expect(claimed, name).toMatchObject({ sim: size.sim, browser: size.browser });
      for (const jobs of claimed.jobs) expect(jobs, `${name}: suite jobs`).toBe(size.all);
    }
    // control: the sizes the doc had before the slices grew
    expect(claimedSuiteSize('suite (static, unit in 2 slices, sim in 6, browser in 7)')).toMatchObject({
      sim: 6,
      browser: 7,
    });
    expect(suiteSize('a: [1]\nshard: [1, 2]\nshard: [1, 2, 3]\nshard: [1, 2, 3, 4]').all).toBe(10);
  });
});

describe('links', () => {
  it('every relative link of the README, CONTRIBUTING.md and the train section resolves, anchor included', () => {
    expect(brokenLinks(readme, 'README.md')).toEqual([]);
    expect(brokenLinks(contributing, 'CONTRIBUTING.md')).toEqual([]);
    expect(brokenLinks(section(engineering, 'The bundle train'), 'docs/engineering.md')).toEqual([]);
  });

  it('control: a missing file and a missing anchor are found, a web link is not checked', () => {
    expect(
      brokenLinks(
        '[a](docs/nope.md) [b](docs/engineering.md#no-such-heading) [c](docs/engineering.md#the-bundle-train) [d](https://example.com/x)\n',
        'README.md',
      ),
    ).toEqual(['docs/nope.md', 'docs/engineering.md#no-such-heading']);
    expect(slug('The gate: definition of done')).toBe('the-gate-definition-of-done');
    expect(slug('What `train` says')).toBe('what-train-says');
  });
});
