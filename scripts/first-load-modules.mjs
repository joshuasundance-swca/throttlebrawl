// The first-load JavaScript by module (lane F1; docs/engineering.md, perf check). The budget counts
// chunks, and a chunk's growth does not say whose it is: the sim chunk grew 9.7 KB gzip in a day
// across three PRs before anyone looked. The build writes each first-load module's share of its
// chunk's gzip size to .cache/first-load-modules.json (git-ignored, never shipped), and
// scripts/perf.mjs prints the biggest modules and, against main's build, the ones that grew.
//
// A module's share: its chunk's gzip size, split over the chunk's modules in proportion to each
// one's own code gzipped alone. gzip does not split exactly (a module compresses against its
// neighbours), so a share is an estimate, but the shares of a chunk add up to the chunk, and the
// chunks to the first-load figure the budget counts.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { firstLoadScripts } from './first-load.mjs';
import { fmtBytes } from './lib.mjs';

/** Where the build writes the list, under the repo root. */
export const MODULES_FILE = '.cache/first-load-modules.json';

const gzip = (code) => gzipSync(Buffer.from(code), { level: 9 }).length;

/**
 * A module id as a repo-relative posix path (`src/ui/index.ts`); a package's as its path from the
 * last `node_modules/` (main's merge base builds under .cache/ and finds the packages up the tree);
 * anything else as it is.
 */
function shortId(id, root) {
  const pkg = /[\\/](node_modules[\\/](?!.*[\\/]node_modules[\\/]).+)$/.exec(id);
  if (pkg) return (pkg[1] ?? '').split(/[\\/]/).join('/');
  const rel = path.relative(root, id.replace(/\?.*$/, ''));
  const out = rel.startsWith('..') || path.isAbsolute(rel) ? id : rel;
  return out.split(path.sep).join('/').replace(/^\0/, '');
}

/**
 * The first-load chunks of a built bundle (Rolldown's output, keyed by file name) and each of their
 * modules' share of the chunk's gzip size. `root` makes the ids repo-relative.
 * @param {Record<string, any>} bundle
 * @param {string} root
 * @returns {{ chunks: { file: string, name: string, gzip: number }[], modules: { id: string, chunk: string, bytes: number }[] }}
 */
export function firstLoadModuleStats(bundle, root) {
  const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName === 'index.html');
  if (!html) return { chunks: [], modules: [] };
  const byName = new Map(
    Object.values(bundle)
      .filter((f) => f.type === 'chunk')
      .map((c) => [c.fileName, c]),
  );
  const first = firstLoadScripts(String(html.source), (p) => byName.get(p)?.code ?? '');
  const chunks = [];
  const modules = [];
  for (const file of [...first].sort()) {
    const c = byName.get(file);
    if (!c) continue;
    const total = gzip(c.code);
    chunks.push({ file, name: c.name, gzip: total });
    const own = Object.entries(c.modules)
      .filter(([, m]) => m.code)
      .map(([id, m]) => ({ id: shortId(id, root), gz: gzip(m.code) }));
    const sum = own.reduce((n, m) => n + m.gz, 0);
    for (const m of own) modules.push({ id: m.id, chunk: file, bytes: sum ? (total * m.gz) / sum : 0 });
  }
  return { chunks, modules };
}

/** True when the list names exactly the first-load scripts measured in dist/ (not an older build's). */
export function statsMatch(stats, firstLoadFiles) {
  const files = new Set(stats.chunks.map((c) => c.file));
  return files.size === firstLoadFiles.size && [...firstLoadFiles].every((f) => files.has(f));
}

/** @typedef {{ id: string, chunk: string, bytes: number }} ModuleShare */
/** @typedef {ModuleShare & { base: number, delta: number }} ModuleGrowth */

/**
 * The `n` biggest modules, biggest first.
 * @param {readonly ModuleShare[]} modules
 * @param {number} n
 * @returns {ModuleShare[]}
 */
export function biggestModules(modules, n) {
  return [...modules].sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1)).slice(0, n);
}

/**
 * The modules that grew against `base` by at least `minBytes` (a new module grew from 0), biggest
 * growth first, at most `n`. A module is matched by id, whatever chunk it moved to.
 * @param {readonly ModuleShare[]} base
 * @param {readonly ModuleShare[]} head
 * @param {{ n: number, minBytes: number }} limits
 * @returns {ModuleGrowth[]}
 */
export function moduleGrowth(base, head, { n, minBytes }) {
  /** @param {readonly ModuleShare[]} list */
  const sum = (list) => {
    /** @type {Map<string, number>} */
    const out = new Map();
    for (const m of list) out.set(m.id, (out.get(m.id) ?? 0) + m.bytes);
    return out;
  };
  const was = sum(base);
  const chunkOf = new Map(head.map((m) => [m.id, m.chunk]));
  return [...sum(head)]
    .map(([id, bytes]) => ({ id, chunk: chunkOf.get(id) ?? '', bytes, base: was.get(id) ?? 0 }))
    .map((m) => ({ ...m, delta: m.bytes - m.base }))
    .filter((m) => m.delta >= minBytes)
    .sort((a, b) => b.delta - a.delta || (a.id < b.id ? -1 : 1))
    .slice(0, n);
}

const chunkLabel = (file) =>
  path.posix
    .basename(file)
    .replace(/-[\w-]{8}\.js$/, '')
    .replace(/\.js$/, '');

/** One line per module: `12.3 KB  src/ui/index.ts (index)`, or with `growth`, `+1.2 KB  ... (index; 3.4 KB on main)`. */
export function moduleLines(modules, growth = false) {
  return modules.map((m) =>
    growth
      ? `+${fmtBytes(Math.round(m.delta))}  ${m.id} (${chunkLabel(m.chunk)}; ${fmtBytes(Math.round(m.base))} on main)`
      : `${fmtBytes(Math.round(m.bytes))}  ${m.id} (${chunkLabel(m.chunk)})`,
  );
}

/** The Vite plugin: after the bundle is written, the list goes to MODULES_FILE. Build only. */
export function firstLoadModulesPlugin({ root }) {
  return {
    name: 'throttlebrawl:first-load-modules',
    apply: 'build',
    writeBundle(_options, bundle) {
      const stats = firstLoadModuleStats(bundle, root);
      const out = path.join(root, MODULES_FILE);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(stats)}\n`);
    },
  };
}
