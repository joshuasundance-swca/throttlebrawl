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

/** One dynamic import: its specifier, where it starts and ends, and its enclosing `loadChunk(` paren (or -1). */
interface DynamicImport {
  spec: string;
  at: number;
  end: number;
  call: number;
}

/** The dynamic imports in `source` (type-only `typeof import(...)` left out). */
function dynamicImports(source: string): DynamicImport[] {
  const out: DynamicImport[] = [];
  const re = /(?<![\w$.])import\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (/typeof\s*$/.test(source.slice(Math.max(0, m.index - 12), m.index))) continue;
    out.push({
      spec: m[2] ?? '',
      at: m.index,
      end: m.index + m[0].length,
      call: enclosingLoadChunk(source, m.index),
    });
  }
  return out;
}

/** The dynamic imports in `source` that no `loadChunk(...)` call encloses, as their specifiers. */
function unguardedImports(source: string): string[] {
  return dynamicImports(source)
    .filter((i) => i.call < 0)
    .map((i) => i.spec);
}

/**
 * The guarded imports that are not their call's whole load, `loadChunk('name', () => import('./x'))`
 * (polish batch K's check, mustFix 1): the retry imports the chunk's own URL again and hands back
 * that module in place of what `load` returns, so a load that is a `Promise.all`, or an import with a
 * `.then`, would get the wrong thing back.
 */
function partLoads(source: string): string[] {
  return dynamicImports(source)
    .filter((i) => i.call >= 0)
    .filter(
      (i) =>
        !/^\s*(['"`])[^'"`]*\1\s*,\s*\(\)\s*=>\s*$/.test(source.slice(i.call + 1, i.at)) ||
        !/^\s*,?\s*\)/.test(source.slice(i.end)),
    )
    .map((i) => i.spec);
}

/** The open paren of a `loadChunk(` call (or a local `chunk(` alias) that encloses `at`, or -1. */
function enclosingLoadChunk(source: string, at: number): number {
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
        return i;
      // Leaving an enclosing bracket: keep looking outward, through the statement it belongs to.
    } else if (ch === ';' && depth === 0) return -1;
  }
  return -1;
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

  it("finds a load that is more than one import, and passes `() => import('./x')` (the negative control)", () => {
    expect(
      partLoads(
        "void chunk('backdrop', () => Promise.all([import('./builder'), files()])).then(build);\n" +
          "void loadChunk('water', () => import('./water').then((m) => m.floors)).then(use);\n" +
          "void loadChunk('vehicles', () => import('./vehicles'))\n  .then((m) => use(m));\n" +
          "void chunk('x', () =>\n  import('./x'),\n).then(use);\n" +
          "void chunk('layout', loadLayout).then(use);",
      ),
    ).toEqual(['./builder', './water']);
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

  it("each loadChunk's load is one import, so its retry by the chunk's URL stands in for it", () => {
    const files = Object.keys(SOURCES).sort();
    const found: string[] = [];
    let guarded = 0;
    for (const file of files) {
      const source = SOURCES[file] ?? '';
      guarded += dynamicImports(source).filter((i) => i.call >= 0).length;
      for (const spec of partLoads(source)) found.push(`${file}: import('${spec}')`);
    }
    console.log(`[print] ${guarded} guarded imports read; part of a bigger load: ${JSON.stringify(found)}`);
    expect(guarded).toBeGreaterThan(15);
    expect(found).toEqual([]);
  });
});
