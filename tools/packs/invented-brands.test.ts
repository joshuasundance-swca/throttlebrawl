import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Satire invents its brands (docs/tone-guide.md: "No real brands, logos or company names in
// satire"; maintainer, 2026-10-01b: "invents its brands (no real company names or logos)"). No test
// can prove a name is invented, so this one remembers every pack name a review found to be a real
// product or business, and fails if one comes back in any pack file. Add to the list whenever a
// review finds another; the fix is renaming the brand in the pack, never deleting the entry.
const FOUND_REAL: readonly { name: RegExp; found: string }[] = [
  {
    // Run W-P's verifier: a search for the SF billboard's brand finds a business selling
    // prompting solutions under that name and several prompt tools called the same.
    name: /prompt[\s_-]*loom/i,
    found: 'run W-P verifier, 2026-10-01',
  },
  {
    // Run W-P's traffic lane: the SF robotaxi brand first shipped as Dawdle, and a search found
    // apps and businesses under that name (an AI app, a route planner, a games marketplace).
    name: /\bdawdle\b/i,
    found: 'run W-P traffic lane, 2026-10-02',
  },
];

// Real marks near the places playtest 3 brings in (the maintainer, round 1: "Duval St, downtown
// Portland, Golden Gate"; "Brands and businesses stay invented"): businesses, attractions, products
// and trademarked signs that a Key West, Portland or San Francisco lane could reach for. They must
// never appear in any pack text (signs, billboards, barks, names, landing lines, smashables,
// scenes). Matched case-insensitively with any run of whitespace between words, so a hard-wrapped
// phrase still matches. Place names stay fine as flavor ("Real place and road names are fine as
// flavor" [decided]): the Golden Gate is a place; the bridge district's own name is not. San
// Francisco's transit service is left off: a shipped pirate-radio track names it as part of the city.
const REAL_MARKS: readonly string[] = [
  'Pier 39',
  'Transamerica',
  'Margaritaville',
  'Sloppy Joe',
  'Conch Tour Train',
  'Conch Train',
  'White Stag',
  'TriMet',
  'MAX Light Rail',
  'Voodoo',
  "Powell's",
  'Stumptown',
  'Ghirardelli',
  'Oracle Park',
  'Hemingway',
  'Keep Portland Weird',
  'Full House',
  'Golden Gate Bridge Highway',
  'Weather Machine',
  // Playtest 4 (P4-16, Duval as a party street): the real bars, events and crawls of Key West that a
  // party-street lane could reach for. The street's shops and bars are invented.
  'Captain Tony',
  "Hog's Breath",
  'Green Parrot',
  'Irish Kevin',
  'Fat Tuesday',
  'Schooner Wharf',
  'Fantasy Fest',
  'Duval Crawl',
];

/** A mark as a pattern: case-insensitive, any whitespace between its words, whole words only. */
function markPattern(mark: string): RegExp {
  const words = mark
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]?"));
  return new RegExp(`(?<![A-Za-z0-9])${words.join('\\s+')}(?![A-Za-z0-9])`, 'i');
}

/** Every string in a parsed JSON value, object keys included. */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => [k, ...stringsOf(v)]);
  return [];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsonFiles(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

describe('pack brands are invented', () => {
  const files = jsonFiles(path.join(root, 'packs'));

  it('reads the pack files', () => {
    console.log(`[examined] ${files.length} pack JSON files against ${FOUND_REAL.length} known real names`);
    expect(files.length).toBeGreaterThan(50);
  });

  it('no pack file names a brand a review found to be real', () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const { name, found } of FOUND_REAL) {
        if (name.test(text)) hits.push(`${path.relative(root, f)}: ${String(name)} (${found})`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('pack text names no real mark near the playtest 3 places', () => {
  const files = jsonFiles(path.join(root, 'packs'));

  it('matches a mark across case, curly apostrophes and hard-wrapped whitespace, and whole words only', () => {
    expect(markPattern('Pier 39').test('PIER\n   39 EXIT')).toBe(true);
    expect(markPattern("Powell's").test('powell’s books')).toBe(true);
    expect(markPattern('Voodoo').test('voodoos')).toBe(false);
    expect(markPattern('Golden Gate Bridge Highway').test('THE GOLDEN GATE')).toBe(false);
  });

  it('no pack file names one', () => {
    const hits: string[] = [];
    const patterns = REAL_MARKS.map((mark) => ({ mark, re: markPattern(mark) }));
    let strings = 0;
    for (const f of files) {
      // Every string in the file, keys included, as parsed: a "\n" inside a JSON string is a real
      // line break here, so a hard-wrapped mark still matches.
      for (const s of stringsOf(JSON.parse(readFileSync(f, 'utf8')))) {
        strings++;
        for (const { mark, re } of patterns)
          if (re.test(s)) hits.push(`${path.relative(root, f)}: ${mark} in "${s}"`);
      }
    }
    console.log(
      `[examined] ${strings} strings in ${files.length} pack JSON files against ${REAL_MARKS.length} real marks`,
    );
    expect(hits).toEqual([]);
  });
});
