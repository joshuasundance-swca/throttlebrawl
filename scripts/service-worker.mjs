// The offline worker's build step (docs/engineering.md, "Deploy: game Space and staging Space",
// Offline; roadmap M5). The worker's code is src/platform/sw.ts, built on its own as `sw.js` beside
// index.html (a fixed name: a page registers its worker by URL). Once the build has written every
// file, this step puts the worker's config in front of its code: this build's cache name and the
// list of every file the build wrote but the worker (the public/ files too), so the worker caches
// the whole build after the first load. changelog.json is written after the build
// (scripts/changelog-build.mjs), so the worker keeps it the first time the page reads it instead.
//
// It also writes a gzip copy (`<file>.gz`) beside every JavaScript, JSON and model file under
// assets/ (playtest 4 run B's live check, punch item 8): the game's host sends every file as stored,
// with no Content-Encoding whatever the browser accepts, so the worker downloads the copy and
// unpacks it itself (offline-worker.ts). The page's own first load still gets the plain files.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** The worker's file name; src/platform/index.ts registers the same one (SERVICE_WORKER_FILE). */
export const SW_FILE = 'sw.js';
/** The worker's entry module. */
const SW_ENTRY = 'src/platform/sw.ts';
/** src/platform/offline-worker.ts's CACHE_PREFIX (a unit test holds them equal). */
const CACHE_PREFIX = 'offline-';
/** Files under this folder carry a content hash in their name: their name is their check. */
const HASHED_DIR = 'assets/';
/** A page's entry script: Vite's `<script type="module" ... src="./assets/index-<hash>.js">`. */
const ENTRY_SCRIPT = /<script\b[^>]*\btype="module"[^>]*\bsrc="(?:\.\/)?([^"]+)"/;
/** A tag by which a page loads a file itself: a script's src, or a preload's or module preload's href. */
const PAGE_LOADS =
  /<script\b[^>]*\bsrc="(?:\.\/)?([^"]+)"|<link\b(?=[^>]*\brel="?(?:module)?preload\b)[^>]*\bhref="(?:\.\/)?([^"]+)"/g;
/** The page the worker's first-load list is read from. */
const PAGE = 'index.html';
/**
 * The files under assets/ that get a gzip copy, by extension, in name order. Audio and images are
 * compressed already (gzip saves under 10% on the build's Ogg files). [default]
 */
export const GZIP_EXTENSIONS = ['.glb', '.js', '.json'];
/** A gzip copy's suffix. */
const GZIP_SUFFIX = '.gz';

/** Page-relative posix paths. */
const posix = (/** @type {string} */ p) => p.split('\\').join('/');
/** Whether the build writes a gzip copy of this page-relative posix path. */
const gzipped = (/** @type {string} */ rel) =>
  rel.startsWith(HASHED_DIR) && GZIP_EXTENSIONS.some((ext) => rel.endsWith(ext));

/**
 * The gzip copy of every file that gets one, at its path plus `.gz`.
 * @param {readonly { path: string, bytes: Uint8Array }[]} files
 * @returns {{ path: string, bytes: Uint8Array }[]}
 */
export function gzipCopies(files) {
  return files
    .filter((f) => gzipped(posix(f.path)))
    .map((f) => ({ path: `${f.path}${GZIP_SUFFIX}`, bytes: gzipSync(f.bytes, { level: 9 }) }));
}

/**
 * How the worker's install tells that a file without a content hash in its name is this build's
 * (offline-worker.ts's FileCheck; playtest 4 run A, mustFix 2: a deploy during the install handed it
 * the next build's page). A page must contain its own entry script, renamed whenever the build
 * changes, because the game's host adds a script of its own to HTML; any other file, its SHA-256.
 * @param {{ path: string, bytes: Uint8Array }} f
 * @returns {{ contains: string } | { sha256: string }}
 */
function fileCheck(f) {
  if (!f.path.endsWith('.html')) return { sha256: createHash('sha256').update(f.bytes).digest('hex') };
  const entry = ENTRY_SCRIPT.exec(Buffer.from(f.bytes).toString('utf8'))?.[1];
  if (!entry)
    throw new Error(`${f.path} loads no entry script, so the offline worker cannot tell it is this build's`);
  return { contains: entry };
}

/**
 * The built files under assets/ that the page loads itself (its entry script, module preloads and
 * preloads), in name order: a first visit's page has these in the browser's HTTP cache, stored under
 * the Origin header its module and `crossorigin` requests carry (playtest 4 run B fix check, punch
 * item 1; offline-worker.ts).
 * @param {{ path: string, bytes: Uint8Array } | undefined} page
 * @param {ReadonlySet<string>} built
 */
function pageLoads(page, built) {
  if (!page) return [];
  const html = Buffer.from(page.bytes).toString('utf8');
  const loads = [...html.matchAll(PAGE_LOADS)].map((m) => m[1] ?? m[2] ?? '');
  return [...new Set(loads)].filter((rel) => rel.startsWith(HASHED_DIR) && built.has(rel)).sort();
}

/**
 * The worker's config for one build: its cache name (the build id and a hash of every file's path
 * and bytes, so any change in the build names a new cache), every file but the worker and the gzip
 * copies, as page-relative posix paths in name order, the check of each file outside assets/, the
 * extensions whose files under assets/ have a gzip copy, and the files under assets/ the page loads
 * itself.
 * @param {string} buildId
 * @param {readonly { path: string, bytes: Uint8Array }[]} files every file the build wrote
 * @returns {{ cache: string, files: string[], checks: Record<string, { contains: string } | { sha256: string }>, gzip: string[], firstLoad: string[] }}
 */
export function workerConfig(buildId, files) {
  const all = files.map((f) => ({ path: posix(f.path), bytes: f.bytes }));
  const names = new Set(all.map((f) => f.path));
  const listed = all
    .filter((f) => f.path !== SW_FILE)
    .filter((f) => !(f.path.endsWith(GZIP_SUFFIX) && names.has(f.path.slice(0, -GZIP_SUFFIX.length))))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const f of listed) {
    hash.update(`${f.path}\0${f.bytes.length}\0`);
    hash.update(f.bytes);
  }
  return {
    cache: `${CACHE_PREFIX}${buildId}-${hash.digest('hex').slice(0, 12)}`,
    files: listed.map((f) => f.path),
    checks: Object.fromEntries(
      listed.filter((f) => !f.path.startsWith(HASHED_DIR)).map((f) => [f.path, fileCheck(f)]),
    ),
    gzip: [...GZIP_EXTENSIONS],
    firstLoad: pageLoads(
      listed.find((f) => f.path === PAGE),
      new Set(listed.map((f) => f.path)),
    ),
  };
}

/**
 * The worker's file: its config as `self.__OFFLINE__`, then its built code.
 * @param {{ cache: string, files: readonly string[], checks: Record<string, unknown>, gzip?: readonly string[], firstLoad?: readonly string[] }} config
 * @param {string} code
 */
export function workerSource(config, code) {
  return `self.__OFFLINE__=${JSON.stringify(config)};\n${code}`;
}

/** Every file under `dir`, with its path relative to it. */
function filesIn(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const full = path.join(e.parentPath, e.name);
      return { path: path.relative(dir, full), bytes: readFileSync(full) };
    });
}

/**
 * A Vite plugin: builds the worker beside the page and hands it the build's file list.
 * @param {{ root: string, buildId: string }} opts
 */
export function serviceWorkerPlugin({ root, buildId }) {
  return {
    name: 'throttlebrawl:service-worker',
    apply: /** @type {const} */ ('build'),
    buildStart() {
      this.emitFile({ type: 'chunk', id: path.join(root, SW_ENTRY), fileName: SW_FILE });
    },
    writeBundle: {
      order: /** @type {const} */ ('post'),
      sequential: true,
      /** @param {{ dir?: string }} options */
      handler(options) {
        const dir = options.dir ?? path.join(root, 'dist');
        const file = path.join(dir, SW_FILE);
        const files = filesIn(dir);
        const config = workerConfig(buildId, files);
        writeFileSync(file, workerSource(config, readFileSync(file, 'utf8')));
        for (const copy of gzipCopies(files)) writeFileSync(path.join(dir, copy.path), copy.bytes);
      },
    },
  };
}
