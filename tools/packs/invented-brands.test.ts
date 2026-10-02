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
