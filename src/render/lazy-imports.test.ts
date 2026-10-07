import { describe, expect, it } from 'vitest';

// Polish batch F's check, punch item 4: a deploy mid-race made the landmark chunk answer 404, and
// `requestLandmarks`'s bare `void import('./landmarks').then(...)` left two uncaught errors and no
// landmark. Every lazy import the game makes during a race goes through content/'s `loadChunk`
// (caught, tried once more, said once; a build whose files are gone is the stale-build watch's, which
// Vite's preload error tells), so this holds every `import()` in render/, which loads its parts as
// a race's road arrives, and the race HUD's heat badge to it. Type-only `typeof import(...)` is not
// an import.

/** render/'s shipped files and ui/'s entry, as text (keyed by path, `./` being src/render/). */
const SOURCES = {
  ...import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts', '!./**/*test-util*.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob<string>('../ui/index.ts', { query: '?raw', import: 'default', eager: true }),
};

/** The dynamic imports in `source` that no `loadChunk(...)` call encloses, as their specifiers. */
function unguardedImports(source: string): string[] {
  const out: string[] = [];
  const re = /(?<![\w$.])import\(\s*(['"`])([^'"`]+)\1/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (/typeof\s*$/.test(source.slice(Math.max(0, m.index - 12), m.index))) continue;
    if (!enclosedByLoadChunk(source, m.index)) out.push(m[2] ?? '');
  }
  return out;
}

/** Whether an open paren of a `loadChunk(` call (or a local `chunk(` alias) encloses `at`. */
function enclosedByLoadChunk(source: string, at: number): boolean {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === ')' || ch === ']' || ch === '}') depth++;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) {
        depth--;
        continue;
      }
      if (
        ch === '(' &&
        /\b(?:loadChunk|chunk)\s*(?:<[^()]*>)?\s*$/.test(source.slice(Math.max(0, i - 40), i))
      )
        return true;
      // Leaving an enclosing bracket: keep looking outward, through the statement it belongs to.
    } else if (ch === ';' && depth === 0) return false;
  }
  return false;
}

describe("a race's lazy imports (polish batch F's check, punch item 4)", () => {
  it('finds a bare import, and passes one inside loadChunk (the negative control)', () => {
    expect(unguardedImports("void import('./landmarks').then(async (m) => { use(m); });")).toEqual([
      './landmarks',
    ]);
    expect(unguardedImports("void import('./a').then(f).catch(() => undefined);")).toEqual(['./a']);
    expect(
      unguardedImports(
        "void loadChunk('landmarks', () => import('./landmarks')).then((m) => { if (m) use(m); });\n" +
          "void chunk('backdrop', () => Promise.all([import('./builder'), files()])).then(build);\n" +
          "let m: typeof import('./models') | null = null;",
      ),
    ).toEqual([]);
  });

  it("every import() in render/, and the race HUD's heat badge, goes through loadChunk", () => {
    const files = Object.keys(SOURCES).sort();
    const found: string[] = [];
    for (const file of files) {
      const bare = unguardedImports(SOURCES[file] ?? '');
      // ui/'s other lazy views load with the menus, never mid-race: only the heat badge is held here.
      for (const spec of file === '../ui/index.ts' ? bare.filter((s) => s === './heat-badge') : bare)
        found.push(`${file}: import('${spec}')`);
    }
    console.log(`[print] ${files.length} files read; unguarded imports: ${JSON.stringify(found)}`);
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('./index.ts');
    expect(files).toContain('../ui/index.ts');
    expect(found).toEqual([]);
  });
});
