import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_LABEL, creditsView, entryTitle, inline, parseCredits, plain, viewText } from '../src/ui/credits';
import { assembleCredits, collectCredits, parseLedger, provenanceSources } from './credits.mjs';
import { repoRoot } from './lib.mjs';

// The credits rule (roadmap M5, "check the credits"): everything the ledger (THIRD_PARTY_ASSETS.md)
// logs is on the in-game credits page, every AI-made item says so, and the licence texts the
// licences require can be read there. The page is generated from the repo (scripts/credits.mjs),
// so these tests read the real files; none of them holds a list, a count or a copied line of text.

const TABLE = (rows: string[]) =>
  [
    '# Third-party assets',
    '',
    'Intro words.',
    '',
    '| Asset | Source | Licence | AI-generated | Used in |',
    '| ----- | ------ | ------- | ------------ | ------- |',
    ...rows,
  ].join('\n');
const row = (asset: string, ai = 'No') => `| ${asset} | a source | MIT | ${ai} | somewhere |`;

describe('the ledger reader', () => {
  it('reads every row, flags the AI-made ones, and keeps rows after a split in the table', () => {
    const md = TABLE([
      row('One'),
      row('Two', '**Yes**: scripted'),
      '',
      row('Three', 'yes'),
      'A notice.',
      row('Four'),
    ]);
    const got = parseLedger(md);
    expect(got.entries.map((e) => [e.asset, e.ai])).toEqual([
      ['One', false],
      ['Two', true],
      ['Three', true],
      ['Four', false],
    ]);
    expect(got.notices).toEqual(['A notice.']);
  });

  it('fails the build on a row it cannot credit, rather than dropping it', () => {
    expect(() => parseLedger(TABLE(['| only | four | cells | No |']))).toThrow(/4 cells/);
    expect(() => parseLedger(TABLE([row('Odd', 'Maybe')]))).toThrow(/Yes or No/);
  });
});

describe('the credits data', () => {
  const pack = (over: Partial<Parameters<typeof assembleCredits>[0]['packs'][number]> = {}) => ({
    id: 'p',
    manifest: {
      license: 'MIT',
      licenseRules: [] as { spdx: string; attribution: string; licenseFile?: string }[],
    },
    files: {} as Record<string, string>,
    sources: [] as ReturnType<typeof provenanceSources>,
    ...over,
  });
  const base = { ledger: TABLE([row('One')]), repoLicense: 'MIT text', software: [] };

  it('refuses a road source whose licence has no text anywhere on the page', () => {
    const sources = [{ name: 'Some map', attribution: '(c) Them', spdx: 'ODbL-1.0', url: null }];
    expect(() => assembleCredits({ ...base, packs: [pack({ sources })] })).toThrow(/ODbL-1.0/);
  });

  it('refuses a licence file the pack names but does not have', () => {
    const rule = { spdx: 'ODbL-1.0', attribution: '(c) Them', licenseFile: 'LICENSES/x.txt' };
    expect(() => assembleCredits({ ...base, packs: [pack({ manifest: { licenseRules: [rule] } })] })).toThrow(
      /missing/,
    );
  });

  it('shows a public-domain source without needing a licence text', () => {
    const sources = [
      { name: 'Gov', attribution: 'Data by Gov.', spdx: 'LicenseRef-US-Public-Domain', url: null },
    ];
    expect(assembleCredits({ ...base, packs: [pack({ sources })] }).attributions.map((a) => a.text)).toEqual([
      'Gov: Data by Gov.',
    ]);
  });
});

describe('the inline words of a ledger cell', () => {
  it('turns links, bold and code into runs and keeps the rest as written', () => {
    expect(inline('See [OSM](https://example.org/c) and **Yes** in `a/b`, ok')).toEqual([
      { text: 'See ' },
      { text: 'OSM', href: 'https://example.org/c' },
      { text: ' and ' },
      { text: 'Yes', bold: true },
      { text: ' in ' },
      { text: 'a/b', code: true },
      { text: ', ok' },
    ]);
  });

  it('keeps a link to a file of the repo as its words, not a link', () => {
    expect(inline('see [the guide](docs/guide.md).')).toEqual([
      { text: 'see ' },
      { text: 'the guide' },
      { text: '.' },
    ]);
  });

  it('names a row by its asset up to the first bracket or colon', () => {
    expect(entryTitle('Palm models, 3 variants (`models/scenery/palms`)')).toBe('Palm models, 3 variants');
    expect(entryTitle('Bike models: the first batch')).toBe('Bike models');
    expect(entryTitle('Plain')).toBe('Plain');
  });
});

// ---- The real repo ------------------------------------------------------------------------------

const tree = path.join(repoRoot);
const credits = collectCredits(tree);
const parsed = parseCredits(JSON.parse(JSON.stringify(credits)));
if (!parsed) throw new Error('the credits data does not parse');
const view = creditsView(parsed);
const shown = viewText(view);

/** The ledger's rows read here on their own (a plain scan of the file), so a row the builder drops shows. */
const ledgerRows = readFileSync(path.join(tree, 'THIRD_PARTY_ASSETS.md'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.startsWith('|'))
  .map((l) =>
    l
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim()),
  )
  .filter((c) => c[0]?.toLowerCase() !== 'asset' && !c.every((x) => /^:?-{3,}:?$/.test(x)));

interface ProvenanceFile {
  provenance?: { sources?: { attribution?: string }[] };
}

/** Every pack on disk, read here on its own (the builder walks the same folders). */
const packs = readdirSync(path.join(tree, 'packs'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(tree, 'packs', e.name, 'pack.json')))
  .map((e) => ({
    id: e.name,
    manifest: JSON.parse(readFileSync(path.join(tree, 'packs', e.name, 'pack.json'), 'utf8')) as {
      licenseRules?: { spdx: string; attribution: string; licenseFile?: string }[];
    },
  }));

/** The baked road files (networks, roads, routes) of every pack. */
function regionJsonFiles(): string[] {
  return packs.flatMap((p) =>
    readdirSync(path.join(tree, 'packs', p.id, 'regions'), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => path.join(e.parentPath, e.name))
      .filter((f) => /[\\/](networks|roads|routes)[\\/]/.test(f)),
  );
}

describe('the credits of this repo', () => {
  it('has the ledger rows to check', () => {
    expect(ledgerRows.length).toBeGreaterThan(0);
  });

  it('credits every asset the ledger logs, in the ledger order', () => {
    expect(view.entries).toHaveLength(ledgerRows.length);
    ledgerRows.forEach((cells, i) => {
      const entry = view.entries[i];
      const asset = plain(inline(cells[0] ?? ''));
      expect(
        plain(entry?.details.find((d) => d.label === 'What')?.segs ?? []),
        `row ${i + 1}: ${entryTitle(asset)}`,
      ).toBe(asset);
      expect(plain(entry?.details.find((d) => d.label === 'Source')?.segs ?? [])).toBe(
        plain(inline(cells[1] ?? '')),
      );
      expect(plain(entry?.details.find((d) => d.label === 'Licence')?.segs ?? [])).toBe(
        plain(inline(cells[2] ?? '')),
      );
    });
  });

  it('labels every AI-made asset, and only those', () => {
    ledgerRows.forEach((cells, i) => {
      const madeByAi = /^\**yes/i.test(cells[3] ?? '');
      expect(view.entries[i]?.ai, `row ${i + 1} ${entryTitle(cells[0] ?? '')}`).toBe(madeByAi);
    });
    // The label is part of what the page shows, for an AI-made entry only.
    const one = (ai: boolean) =>
      viewText(
        creditsView(
          parseCredits({ format: 1, entries: [{ asset: 'x', source: 's', licence: 'l', ai }] }) as never,
        ),
      );
    expect(one(true)).toContain(AI_LABEL);
    expect(one(false)).not.toContain(AI_LABEL);
  });

  it('shows the notices the ledger carries (the voice models carry attributions of their own)', () => {
    const lines = readFileSync(path.join(tree, 'THIRD_PARTY_ASSETS.md'), 'utf8').split(/\r?\n/);
    const afterTable = lines
      .slice(lines.findIndex((l) => l.startsWith('|')))
      .filter((l) => l.trim() !== '' && !l.startsWith('|') && !l.startsWith('#'));
    expect(afterTable.length).toBeGreaterThan(0);
    for (const line of afterTable) expect(shown).toContain(plain(inline(line)));
  });

  it('shows every attribution the packs ask for, and every credit their road files carry', () => {
    for (const pack of packs) {
      for (const r of pack.manifest.licenseRules ?? [])
        expect(shown, `${pack.id}: ${r.attribution}`).toContain(r.attribution);
    }
    const credited = new Set<string>();
    for (const file of regionJsonFiles()) {
      const sources = (JSON.parse(readFileSync(file, 'utf8')) as ProvenanceFile).provenance?.sources ?? [];
      for (const s of sources) if (s.attribution) credited.add(s.attribution);
    }
    expect(credited.size, 'the road files carry credits to check').toBeGreaterThan(0);
    for (const attribution of credited) expect(shown, attribution).toContain(attribution);
  });

  it('puts every licence file a pack names on the page, byte for byte', () => {
    for (const pack of packs) {
      for (const r of pack.manifest.licenseRules ?? []) {
        if (!r.licenseFile) continue;
        const text = readFileSync(path.join(tree, 'packs', pack.id, r.licenseFile), 'utf8').trim();
        expect(
          view.licences.some((l) => l.id === r.spdx && l.text === text),
          `${pack.id}: ${r.licenseFile}`,
        ).toBe(true);
      }
    }
  });

  it('shows the text of every licence the ledger names that needs one shown (ODbL, MIT)', () => {
    const named = ledgerRows.map((c) => c[2] ?? '').join(' ');
    if (/ODbL/.test(named))
      expect(view.licences.some((l) => l.id === 'ODbL-1.0' && l.text.length > 1000)).toBe(true);
    if (/\bMIT\b/.test(named))
      expect(view.licences.some((l) => l.id === 'MIT' && /Permission is hereby granted/.test(l.text))).toBe(
        true,
      );
  });

  it('shows the licence of every npm package the game ships, with its own text', () => {
    const pkg = JSON.parse(readFileSync(path.join(tree, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      const got = view.software.find((s) => s.title.startsWith(`${name} `));
      expect(got, name).toBeDefined();
      expect(got?.text.length, `${name}: licence text`).toBeGreaterThan(100);
    }
  });
});
