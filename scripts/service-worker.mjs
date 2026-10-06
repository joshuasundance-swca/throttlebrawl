// The offline worker's build step (docs/engineering.md, "Deploy: game Space and staging Space",
// Offline; roadmap M5). The worker's code is src/platform/sw.ts, built on its own as `sw.js` beside
// index.html (a fixed name: a page registers its worker by URL). Once the build has written every
// file, this step puts the worker's config in front of its code: this build's cache name and the
// list of every file the build wrote but the worker (the public/ files too), so the worker caches
// the whole build after the first load. changelog.json is written after the build
// (scripts/changelog-build.mjs), so the worker keeps it the first time the page reads it instead.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The worker's file name; src/platform/index.ts registers the same one (SERVICE_WORKER_FILE). */
export const SW_FILE = 'sw.js';
/** The worker's entry module. */
const SW_ENTRY = 'src/platform/sw.ts';
/** src/platform/offline-worker.ts's CACHE_PREFIX (a unit test holds them equal). */
const CACHE_PREFIX = 'offline-';

/**
 * The worker's config for one build: its cache name (the build id and a hash of every file's path
 * and bytes, so any change in the build names a new cache) and every file but the worker, as
 * page-relative posix paths in name order.
 * @param {string} buildId
 * @param {readonly { path: string, bytes: Uint8Array }[]} files every file the build wrote
 * @returns {{ cache: string, files: string[] }}
 */
export function workerConfig(buildId, files) {
  const listed = files
    .map((f) => ({ path: f.path.split('\\').join('/'), bytes: f.bytes }))
    .filter((f) => f.path !== SW_FILE)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const f of listed) {
    hash.update(`${f.path}\0${f.bytes.length}\0`);
    hash.update(f.bytes);
  }
  return {
    cache: `${CACHE_PREFIX}${buildId}-${hash.digest('hex').slice(0, 12)}`,
    files: listed.map((f) => f.path),
  };
}

/**
 * The worker's file: its config as `self.__OFFLINE__`, then its built code.
 * @param {{ cache: string, files: readonly string[] }} config
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
        const config = workerConfig(buildId, filesIn(dir));
        writeFileSync(file, workerSource(config, readFileSync(file, 'utf8')));
      },
    },
  };
}
