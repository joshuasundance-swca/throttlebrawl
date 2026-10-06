// The first-load module list (lane F1; docs/engineering.md, perf check): the build writes each
// first-load module's share of its chunk's gzip size, and the perf check names the biggest ones
// and, against main, the ones that grew, so the next growth shows by name in CI.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  biggestModules,
  firstLoadModuleStats,
  moduleGrowth,
  moduleLines,
  statsMatch,
} from './first-load-modules.mjs';

const gz = (s: string) => gzipSync(Buffer.from(s), { level: 9 }).length;
const noise = (seed: number, n: number) => {
  let x = seed;
  let out = '';
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out += String.fromCharCode(33 + (x % 90));
  }
  return out;
};

/** A built bundle: the page, its entry (two modules), a static import (one) and a lazy chunk. */
function bundle() {
  const big = `const a="${noise(1, 3000)}";`;
  const small = `const b="${noise(2, 300)}";`;
  const shared = `const c="${noise(3, 1200)}";`;
  return {
    'index.html': {
      type: 'asset',
      fileName: 'index.html',
      source: '<script type="module" crossorigin src="./assets/index-1.js"></script>',
    },
    'assets/index-1.js': {
      type: 'chunk',
      fileName: 'assets/index-1.js',
      name: 'index',
      code: `import"./shared-2.js";${big}${small}const l=()=>import("./lazy-3.js");`,
      modules: { '/r/src/app/index.ts': { code: big }, '/r/src/ui/index.ts': { code: small } },
    },
    'assets/shared-2.js': {
      type: 'chunk',
      fileName: 'assets/shared-2.js',
      name: 'shared',
      code: shared,
      modules: { '/r/node_modules/three/build/three.module.js': { code: shared } },
    },
    'assets/lazy-3.js': {
      type: 'chunk',
      fileName: 'assets/lazy-3.js',
      name: 'lazy',
      code: 'const z=1;',
      modules: { '/r/src/dev/index.ts': { code: 'const z=1;' } },
    },
  };
}

describe('firstLoadModuleStats', () => {
  it('splits each first-load chunk’s gzip size over its modules, and leaves the lazy chunks out', () => {
    const stats = firstLoadModuleStats(bundle(), '/r');
    expect(stats.chunks.map((c) => c.file).sort()).toEqual(['assets/index-1.js', 'assets/shared-2.js']);
    const ids = stats.modules.map((m) => m.id).sort();
    expect(ids).toEqual(['node_modules/three/build/three.module.js', 'src/app/index.ts', 'src/ui/index.ts']);
    // The shares of a chunk add up to its gzip size, and the bigger module takes the bigger share.
    const index = stats.chunks.find((c) => c.file === 'assets/index-1.js');
    const inIndex = stats.modules.filter((m) => m.chunk === 'assets/index-1.js');
    expect(inIndex.reduce((n, m) => n + m.bytes, 0)).toBeCloseTo(index?.gzip ?? -1, 6);
    expect(index?.gzip).toBe(gz(bundle()['assets/index-1.js'].code));
    const app = inIndex.find((m) => m.id === 'src/app/index.ts');
    const ui = inIndex.find((m) => m.id === 'src/ui/index.ts');
    expect((app?.bytes ?? 0) > (ui?.bytes ?? 0) * 3).toBe(true);
  });
});

describe('biggestModules and moduleGrowth', () => {
  const head = [
    { id: 'a', chunk: 'x', bytes: 5000 },
    { id: 'b', chunk: 'x', bytes: 9000 },
    { id: 'c', chunk: 'y', bytes: 300 },
    { id: 'new', chunk: 'y', bytes: 2000 },
  ];
  const base = [
    { id: 'a', chunk: 'x', bytes: 2000 },
    { id: 'b', chunk: 'x', bytes: 9100 },
    { id: 'c', chunk: 'y', bytes: 290 },
    { id: 'gone', chunk: 'y', bytes: 4000 },
  ];

  it('lists the biggest first, at most n', () => {
    expect(biggestModules(head, 2).map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('names the modules that grew or arrived, biggest growth first, above the threshold', () => {
    const grown = moduleGrowth(base, head, { n: 10, minBytes: 512 });
    expect(grown.map((g) => [g.id, g.delta])).toEqual([
      ['a', 3000],
      ['new', 2000],
    ]);
    expect(grown.find((g) => g.id === 'new')?.base).toBe(0);
  });

  it('negative control: the same list against itself names nothing', () => {
    expect(moduleGrowth(head, head, { n: 10, minBytes: 1 })).toEqual([]);
  });

  it('prints one line per module, in KB, with its chunk', () => {
    expect(moduleLines(biggestModules(head, 1))).toEqual(['8.8 KB  b (x)']);
    expect(moduleLines(moduleGrowth(base, head, { n: 1, minBytes: 1 }), true)).toEqual([
      '+2.9 KB  a (x; 2.0 KB on main)',
    ]);
  });
});

describe('statsMatch', () => {
  it('holds only when the list names the same first-load chunks as the build measured', () => {
    const stats = firstLoadModuleStats(bundle(), '/r');
    expect(statsMatch(stats, new Set(['assets/index-1.js', 'assets/shared-2.js']))).toBe(true);
    // A list from an older build (another entry chunk) is stale and is not shown.
    expect(statsMatch(stats, new Set(['assets/index-9.js', 'assets/shared-2.js']))).toBe(false);
  });
});
