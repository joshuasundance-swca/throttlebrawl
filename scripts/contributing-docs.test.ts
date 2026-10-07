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
const ciYml = read('.github/workflows/ci.yml');
const agents = read('AGENTS.md');

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

/**
 * Every gate text the script can post, as the literal words it is built from, a "..." in place of
 * each value it fills in (the train number, a commit, a PR list, a job name, a reason). The texts are
 * the template strings that start "train ${run}", "riding train ${run}" or "passed train ${run}";
 * `${where}` is spelled out in its four forms and a text built by `withPark` gets its tail.
 */
function postedGateTexts(source: string): string[] {
  const wheres = [
    'passes on its branch, fails on main',
    'passes on its branch, timed out on main',
    'fails alone on main',
    'timed out alone on main',
  ];
  return [...source.matchAll(/(withPark\()?`((?:riding |passed )?train \$\{run\}[^`]*)`/g)].flatMap((m) => {
    const text = (m[2] ?? '') + (m[1] ? '; rides once main is past ${base} [cap 1]' : '');
    const forms = text.includes('${where}') ? wheres.map((w) => text.replace('${where}', w)) : [text];
    return forms.map((f) => f.replace(/\$\{[^}]*\}/g, '...'));
  });
}

/** The posted texts that no quoted phrase of the page covers: all its literal pieces occur in the text, in order. */
function postedNotInPage(posted: string[], list: { phrase: string; pieces: string[] }[]): string[] {
  const covers = (pieces: string[], text: string) => {
    let from = 0;
    for (const p of pieces.map((q) => q.replace(/^\W+|\W+$/g, ''))) {
      const at = text.indexOf(p, from);
      if (at < 0) return false;
      from = at + p.length;
    }
    return true;
  };
  return posted.filter((text) => !list.some(({ pieces }) => covers(pieces, text)));
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

  // The other way round: a line the script can post and the page leaves out is as stale as a quote the
  // script no longer writes. (The trainSource has its whitespace collapsed, so the literals are on one line.)
  // What AGENTS.md allows `[full-gate]` for (a keeper's fix for a red main, a change the maintainer asks
  // to land alone), who the numbered steps are for, and the one case where `plan` posts nothing.
  it('limits `[full-gate]` to what AGENTS.md allows, says up front who skips the steps, and what a red main does', () => {
    const text = contributing.replace(/\s+/g, ' ');
    const useIt = /\*\*When to use `\[full-gate\]`\.\*\*([^]*?)(?=- \*\*Forks)/.exec(contributing)?.[1] ?? '';
    expect(useIt).toMatch(/fixes a red `main`/);
    expect(useIt).toMatch(/maintainer asks/);
    expect(useIt).not.toMatch(/train\.mjs/);
    const intro = (landing.split('\n1. ')[0] ?? '').replace(/\s+/g, ' ');
    for (const skipper of [/fork/i, /Dependabot/, /\.github\//, /docs-only/, /\[full-gate\]/])
      expect(intro, String(skipper)).toMatch(skipper);
    expect(intro).toMatch(/cannot arm auto-merge/);
    expect(landing).toMatch(/whose `plan` job ran/);
    expect(text).toMatch(/`main` is red[^.]*posts no notes/);
    expect(text).toMatch(/no per-PR lines/);
  });

  it('keeps step 3 for every PR from a branch of this repo but Dependabot: only a fork is merged by a maintainer', () => {
    // Auto-merge is the only thing that merges a same-repo PR (gate is the only required check and only
    // Dependabot's own workflow arms for anyone), so a page that lets a docs-only, .github/ or [full-gate]
    // PR skip arming leaves it green and unmerged for ever.
    const intro = (landing.split('\n1. ')[0] ?? '').replace(/\s+/g, ' ');
    expect(intro).not.toMatch(/skip steps 2 to 6/);
    expect(intro).toMatch(/every PR from a branch of this repo except a Dependabot PR arms auto-merge/i);
    const useIt = (
      /\*\*When to use `\[full-gate\]`\.\*\*([^]*?)(?=- \*\*Forks)/.exec(contributing)?.[1] ?? ''
    ).replace(/\s+/g, ' ');
    expect(useIt).not.toMatch(/nothing for you to do/);
    expect(useIt).toMatch(/gh pr update-branch/);
  });

  it('has a row for every `gate` text the script can post', () => {
    const posted = postedGateTexts(trainSource);
    expect(posted.length).toBeGreaterThanOrEqual(12);
    const gates = quotedPhrases(section(contributing, 'What `gate` says'));
    expect(postedNotInPage(posted, gates)).toEqual([]);
  });

  it('says what the " [cap N]" ending of a pending `gate` line means', () => {
    const text = contributing.replace(/\s+/g, ' ');
    expect(text).toMatch(/\[cap N\]/);
    expect(text).toMatch(/\[cap N\][^.]*: N is the most PRs of a bundle/);
    expect(trainSource).toContain('` [cap ${cap}]`');
  });

  it('control: a row deleted from the page, or a text the script gains, is found', () => {
    const posted = postedGateTexts(trainSource);
    const gates = quotedPhrases(section(contributing, 'What `gate` says'));
    const without = (phrase: RegExp) => gates.filter((g) => !phrase.test(g.phrase));
    expect(postedNotInPage(posted, without(/is red; waits/))).toEqual([
      expect.stringContaining('is red; waits'),
    ]);
    expect(postedNotInPage(posted, without(/passes on its branch, fails/)).length).toBeGreaterThan(0);
    expect(postedNotInPage(posted, without(/waits for the next train/)).length).toBeGreaterThan(0);
    expect(postedNotInPage([...posted, 'train ...: the bundle exploded'], gates)).toEqual([
      'train ...: the bundle exploded',
    ]);
    expect(postedGateTexts('const a = 1;')).toEqual([]);
    expect(postedGateTexts('x(`train ${run}: ${where} ${b7}; see the PR comment`)')).toHaveLength(4);
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
    expect(size).toMatchObject({ unit: 3, sim: 8, browser: 8, all: 20 });
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

// ---------------------------------------------------------------------------------------------
// The precision residue the final review of #620 left: each claim below was true only in part, so each
// is pinned to the code that decides it, and to a planted fault the check must find.

/** The number words ci.yml's header uses for the suite's slices. */
const words: Record<string, number> = { six: 6, seven: 7, eight: 8, nine: 9 };

/** What a comment says about the suite's slices ("sim in seven, browser in eight"), as numbers. */
function slicesInWords(text: string) {
  const m = /sim in (\w+), browser in (\w+)/.exec(text);
  return { sim: words[m?.[1] ?? ''] ?? Number(m?.[1]), browser: words[m?.[2] ?? ''] ?? Number(m?.[2]) };
}

/** The "N on the full gate" push cost AGENTS.md quotes. */
const fullGatePushCost = (text: string) => Number(/(\d+) on the full gate/.exec(text)?.[1]);

describe('CONTRIBUTING.md: the final review of #620, one claim at a time', () => {
  const text = contributing.replace(/\s+/g, ' ');
  const landing = section(contributing, 'How a pull request lands');
  const flat = (md: string) => md.replace(/\s+/g, ' ');
  const bullet = (start: string) =>
    flat(new RegExp(`- \\*\\*${start}([^]*?)(?=\\n- \\*\\*|\\n\\n[A-Z]|$)`).exec(contributing)?.[0] ?? '');

  it('says how the cap falls as the code does: half the red bundle, rounded up, or straight to 1', () => {
    const cap = flat(/A pending line ends with[^]*?(?=\n###)/.exec(contributing)?.[0] ?? '');
    expect(cap).not.toMatch(/8, 4, 2, 1/);
    expect(cap).toMatch(/half[^.]*size[^.]*rounded up/);
    expect(cap).toMatch(/bundle of 3 gives 2/);
    expect(cap).toMatch(/straight to 1/);
    // The code: the halving, the example's arithmetic, and the cases that write cap 1.
    expect(trainSource).toContain('const cap = Math.ceil(bundle.length / 2);');
    expect(Math.ceil(3 / 2)).toBe(2);
    expect(trainSource).toContain('main ${b7} is red; waits`, 1)');
    expect(trainSource).toContain('timed out; rides once more alone`, 1)');
    // control: the old sentence and a page that leaves the cases out are found
    expect('halves each time a bundle your PR rode in is red (8, 4, 2, 1)').toMatch(/8, 4, 2, 1/);
    expect('the cap becomes half the size, rounded up').not.toMatch(/straight to 1/);
  });

  it('says a red quick check gives no `gate`, and keeps the advice to push', () => {
    const row = flat(/\| `not waiting for a train: \.\.\.`[^\n]*/.exec(contributing)?.[0] ?? '');
    expect(row).not.toMatch(/quick check is red, so its own CI run gives/);
    expect(row).toMatch(/red quick check[^|]*no `gate`|quick check is red[^|]*no `gate`/);
    expect(row).toMatch(/push a commit/);
    // The code: a red quick check is "not eligible", and a `gate` check run comes from the full or docs path only.
    expect(trainSource).toContain("if (pr.quick !== 'success') return no(`its quick check is ${pr.quick}`)");
    expect(trainSource).toContain("if (pr.gateCheck) return no('its head commit already has a gate check");
    // control
    expect('or its quick check is red, so its own CI run gives `gate`').toMatch(
      /quick check is red, so its own CI run gives/,
    );
  });

  it('says an unarmed docs-only or full-path PR has no `train` line, and where the reason is instead', () => {
    const step3 = steps(landing).find((s) => /^3\. /.test(s)) ?? '';
    expect(step3).toMatch(/on the train path/);
    expect(step3).toMatch(/docs-only or full-path PR[^.]*no `train` line/);
    expect(step3).toMatch(/plan log[^.]*auto-merge is not armed/);
    // The code: arming is asked about before the `gate` check run, so the plan log names it; and
    // noteFor posts a note only for a PR that would ride once armed.
    const asked = (what: string) => trainSource.indexOf(what);
    expect(asked("no('auto-merge is not armed')")).toBeGreaterThan(0);
    expect(asked("no('auto-merge is not armed')")).toBeLessThan(
      asked("no('its head commit already has a gate check"),
    );
    expect(trainSource).toContain('{ ...pr, draft: false, autoMerge: true }');
    // control
    expect('Without it, a green PR waits for ever, and its `train` line says so.').not.toMatch(
      /no `train` line/,
    );
  });

  it('says a docs-only PR never rides a train and can land while `main` is red', () => {
    const useIt = flat(
      /\*\*When to use `\[full-gate\]`\.\*\*([^]*?)(?=- \*\*Forks)/.exec(contributing)?.[1] ?? '',
    );
    expect(useIt).toMatch(/Every other PR on the train path leaves it out/);
    expect(useIt).toMatch(/docs-only PR never rides a train[^.]*land while `main` is red/);
    // The code: the docs path is decided before the train's switch, so a docs-only PR never gets a train.
    const docsOnly = { fork: false, author: 'a', title: 't', body: '', files: ['docs/a.md'] };
    expect(route({ ...docsOnly, live: true }).path).toBe('docs');
    expect(route({ ...docsOnly, live: false }).path).toBe('docs');
    // control
    expect('Every other PR leaves it out, even while `main` is red: it waits').not.toMatch(
      /on the train path/,
    );
  });

  it('says the gate is posted while a PR rides or waits and on failure, not only on success', () => {
    const gate = flat(/- \*\*`gate`\*\* is[^]*?(?=\n- \*\*Where)/.exec(contributing)?.[0] ?? '');
    expect(gate).toMatch(/pending[^.]*rides or waits/);
    expect(gate).toMatch(/success[^.]*full suite has passed/);
    expect(gate).toMatch(/failure/);
    // The code posts all three states on `gate`.
    for (const state of ['pending', 'success', 'failure']) expect(trainSource).toContain(`state: '${state}'`);
    // control
    expect('once the full suite has passed on a bundle that holds your PR').not.toMatch(/pending/);
  });

  it('says what the plan log holds while `main` is red: the `main is` line, then one line, no per-PR lines', () => {
    const why = steps(section(landing, 'How to see why a PR waits')).find((s) => /^3\. /.test(s)) ?? '';
    expect(why).toMatch(/While `main` is red the log has no per-PR lines/);
    expect(why).toMatch(/first line, `plan: main is [^`]*`/);
    expect(why).toMatch(/nobody departs/i);
    // The code: that line is logged before the red-main return, and the return comes before the per-PR lines.
    const at = (s: string) => trainSource.indexOf(s);
    expect(at('`plan: main is ${base}; its own ci run:')).toBeGreaterThan(0);
    expect(at('`plan: main is ${base}; its own ci run:')).toBeLessThan(at('Nobody departs.`'));
    expect(at('Nobody departs.`')).toBeLessThan(at("'eligible' : 'not eligible'"));
    // control
    expect('only one line saying that `main` is red and that nobody departs').not.toMatch(/`plan: main is/);
  });

  it('says `gh pr checks` shows the text in the description column, the second one in a terminal', () => {
    expect(text).not.toMatch(/in its last column/);
    expect(text).toMatch(/description column/);
    expect(text).toMatch(/second column[^.]*terminal|terminal[^.]*second column/);
    // control
    expect('with that text in its last column').toMatch(/in its last column/);
  });

  it('says a `train` line appears only for a PR that has not ridden, and what starts a plan', () => {
    const why = steps(section(landing, 'How to see why a PR waits')).find((s) => /^2\. /.test(s)) ?? '';
    expect(why).toMatch(/never ridden|has not ridden/);
    expect(why).toMatch(/armed|ready for review/);
    expect(trainSource).toContain('cur || stateOf(pr.gateStatus, cap).kind');
    expect(read('.github/workflows/train-kick.yml')).toContain(
      'types: [auto_merge_enabled, ready_for_review]',
    );
    // control
    expect('which is when a CI run or a train finishes.').not.toMatch(/ready for review/);
  });

  it('says the docs-only and full-path PRs still arm auto-merge, in the "Which path" bullets', () => {
    for (const start of ['A docs-only change', 'The full path']) {
      const b = bullet(start);
      expect(b, start).toMatch(/arm auto-merge all the same \(step 3\)/);
    }
    expect(bullet('A docs-only change')).toMatch(/never rides a train/);
    // control
    expect(bullet('An ordinary change')).not.toMatch(/all the same/);
  });

  it('never tells a reader to arm a Dependabot PR: the workflow arms the safe ones, the rest wait for review', () => {
    const autoMerge = read('.github/workflows/dependabot-auto-merge.yml').replace(/\s*#\s*/g, ' ');
    expect(autoMerge).toMatch(/Majors[^.]*stay open for a person or agent to review/);
    expect(autoMerge).toMatch(/minor or patch version, arm GitHub's auto-merge/);
    const armsDependabot = (text: string) =>
      /arm auto-merge all the same/.test(text) && !/fork or Dependabot|Dependabot or a fork/.test(text);
    expect(armsDependabot(flat(bullet('The full path'))), 'the full-path bullet').toBe(false);
    expect(flat(bullet('Dependabot'))).toMatch(
      /minor and patch[^.]*armed for you[^.]*rest stay unarmed[^.]*review/,
    );
    const intro = flat(landing.split('\n1. ')[0] ?? '');
    expect(intro).toMatch(/Every PR from a branch of this repo except a Dependabot PR arms auto-merge/);
    // control: the sentence #620 shipped is found
    expect(armsDependabot('Unless it is from a fork, arm auto-merge all the same (step 3)')).toBe(true);
  });

  it("says that on a fork the first red job's cancel is refused, so the run goes on", () => {
    const after = flat(/A new push gives the PR[^]*?(?=\n###)/.exec(contributing)?.[0] ?? '');
    expect(after).toMatch(/first red job cancels the rest of that run/);
    expect(after).toMatch(/fork[^.]*cancel[^.]*refused[^.]*(?:goes|go|runs?|continues?) on/);
    expect(suiteYml).toContain(
      "A fork's token is read-only, so there the cancel is refused and the other jobs run on",
    );
    // control
    expect('its first red job cancels the rest of that run to free the runners').not.toMatch(/refused/);
  });
});

describe('AGENTS.md and ci.yml: the numbers and the link the #620 review found stale', () => {
  it("quotes the full gate's push cost as the suite makes it: the route job, every suite job and the aggregate", () => {
    const size = suiteSize(suiteYml);
    expect(fullGatePushCost(agents)).toBe(size.all + 2);
    // control: the old number, and the arithmetic of a different suite
    expect(fullGatePushCost('5 jobs on the quick check, 18 on the full gate')).toBe(18);
    expect(suiteSize('shard: [1, 2]\nshard: [1, 2, 3]\nshard: [1, 2, 3, 4]').all + 2).toBe(12);
  });

  it("says in ci.yml's header the slices suite.yml has", () => {
    const size = suiteSize(suiteYml);
    const head = ciYml.split('\n').slice(0, 6).join(' ').replace(/#/g, ' ').replace(/\s+/g, ' ');
    expect(slicesInWords(head)).toEqual({ sim: size.sim, browser: size.browser });
    // control
    expect(slicesInWords('sim in six, browser in seven')).toEqual({ sim: 6, browser: 7 });
  });

  it('links CONTRIBUTING.md from AGENTS.md, and the link resolves', () => {
    expect(agents).toContain('](CONTRIBUTING.md');
    expect(brokenLinks(agents, 'AGENTS.md')).toEqual([]);
    // control: a link to a missing page is found
    expect(brokenLinks('[x](CONTRIBUTING-nope.md)', 'AGENTS.md')).toEqual(['CONTRIBUTING-nope.md']);
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
