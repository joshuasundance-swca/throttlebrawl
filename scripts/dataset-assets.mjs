// Dataset assets (run W-Q, interview 2026-10-02: "Real models now"; docs/engineering.md, "Big and
// generated assets"; docs/architecture.md, "Asset manifest"). Big files, real rider and bike models
// first, live in the public Hugging Face dataset repo that `assets.lock.json` names, pinned to one
// exact commit. Nothing big is committed to git.
//
// - `npm run assets:fetch` downloads every pinned file into `.cache/assets/<path>` (git-ignored) and
//   checks its sha256; a file already cached with the right hash is not downloaded again, so an
//   offline machine with a warm cache keeps building.
// - `npm run assets:verify` checks the lock (paths, packs, regions, no id that a pack also bakes) and
//   every cached file's sha256.
// - The build bakes them in: `datasetAssetsPlugin()` serves `virtual:dataset-assets`, the manifest
//   rows (`source: 'dataset'`), and emits each file into `dist/assets/ds/<region>/`, fetching any
//   that are not cached yet. The game then loads them from its own origin like any baked file, so
//   offline play and the service worker work the same (interview round 7: "what about offline play?").
// - A file's dataset path is `<packId>/<path under the pack's assets/>`, so its asset id is the same
//   id a pack entry's `modelAsset` would name (docs/content-packs.md, "Asset references").
// - `region` (a region id, or none for files every region uses) lets the size budget count models
//   per region, and lets a region's models load only when a race there starts.
// Node built-ins only.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const LOCK_FILE = 'assets.lock.json';
export const CACHE_DIR = '.cache/assets';
/** Where the build writes dataset files, under dist/. */
export const DIST_DIR = 'assets/ds';
/** Files with no region (every region uses them) count under this name. */
export const SHARED = 'shared';
export const VIRTUAL_ID = 'virtual:dataset-assets';

/** The allowed formats (docs/content-packs.md, "Asset references"): nothing executable. */
const KIND = {
  glb: () => 'mesh',
  png: (id) => (id.startsWith('textures/') ? 'texture' : 'image'),
  webp: (id) => (id.startsWith('textures/') ? 'texture' : 'image'),
  ogg: (id) => (id.startsWith('audio/music/') ? 'music-stem' : 'audio'),
  opus: (id) => (id.startsWith('audio/music/') ? 'music-stem' : 'audio'),
  json: () => 'data-page',
  bin: () => 'data-page',
};

const REPO_RE = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.([a-z0-9]+)$/;

/**
 * @typedef {{ path: string, bytes: number, sha256: string, region?: string, note?: string }} LockFile
 * @typedef {{ formatVersion: 1, repo: string, repoType: 'dataset', revision: string, files: LockFile[] }} Lock
 */

/** @param {Uint8Array} bytes @returns {string} */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Git's blob id of some bytes. The Hub reports it as `oid` for a file kept in plain git (the small
 * models are; checked against the live dataset on 2026-10-02: marker-cube.glb's oid is its blob id).
 * @param {Uint8Array} bytes @returns {string}
 */
export const gitBlobSha1 = (bytes) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

/**
 * What the dataset holds at one revision, by path: the Hub's paths-info answer (a path it lacks is
 * left out). An entry is `{ type, oid, size, path, lfs?: { oid, size } }`; `lfs.oid` is the sha256 of
 * a file kept in LFS, and `oid` is the git blob id of one kept in plain git.
 */
export async function remoteFiles(lock, revision, paths, fetchFn = fetch) {
  const out = new Map();
  const url = `https://huggingface.co/api/datasets/${lock.repo}/paths-info/${revision}`;
  for (let i = 0; i < paths.length; i += 50) {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: paths.slice(i, i + 50) }),
    });
    if (!res.ok) throw new Error(`could not list the dataset at ${revision.slice(0, 7)}: HTTP ${res.status}`);
    for (const info of await res.json()) if (info?.type === 'file') out.set(info.path, info);
  }
  return out;
}

/**
 * Which pinned files an upload must send: each one the dataset lacks, or holds with other bytes
 * (a changed file at an existing path). Compared by content, never by path alone: an LFS file by its
 * sha256, a plain-git one by the git blob id of the cached bytes. `bytesOf(file)` gives the cached
 * bytes that match the pin, or null.
 */
export function uploadPlan(lock, remote, bytesOf) {
  const upload = [];
  const problems = [];
  let same = 0;
  for (const file of lock.files) {
    const info = remote.get(file.path);
    const bytes = bytesOf(file);
    let holds;
    if (!info) holds = false;
    else if (info.lfs) holds = info.lfs.oid === file.sha256 && info.lfs.size === file.bytes;
    else if (info.size !== file.bytes) holds = false;
    else holds = bytes ? info.oid === gitBlobSha1(bytes) : null;
    if (holds) same++;
    else if (holds === null)
      problems.push(
        `${file.path}: not cached, so it cannot be compared with the dataset (npm run assets:fetch)`,
      );
    else if (!bytes)
      problems.push(
        `${file.path}: the dataset ${info ? 'holds other bytes' : 'lacks it'} and it is not cached with its pinned sha256`,
      );
    else upload.push({ file, why: info ? 'changed' : 'new' });
  }
  return { upload, same, problems };
}

/** Checks a parsed lock file. Returns the problems in plain words (empty when it is valid). */
export function lockProblems(lock) {
  const problems = [];
  if (!lock || typeof lock !== 'object') return ['the lock is not a JSON object'];
  if (lock.formatVersion !== 1) problems.push('formatVersion must be 1');
  if (typeof lock.repo !== 'string' || !REPO_RE.test(lock.repo))
    problems.push('repo must be "<owner>/<name>"');
  if (lock.repoType !== 'dataset') problems.push('repoType must be "dataset"');
  if (typeof lock.revision !== 'string' || !SHA1_RE.test(lock.revision))
    problems.push('revision must be an exact 40-character commit id, never a branch');
  if (!Array.isArray(lock.files)) return [...problems, 'files must be a list'];
  const seen = new Set();
  for (const [i, f] of lock.files.entries()) {
    const where = `files[${i}]`;
    if (!f || typeof f !== 'object') {
      problems.push(`${where} is not an object`);
      continue;
    }
    const m = typeof f.path === 'string' ? PATH_RE.exec(f.path) : null;
    if (!m) problems.push(`${where}.path must be "<packId>/<lower-case path>.<ext>" with no ".." or spaces`);
    else if (f.path.split('/').includes('..') || f.path.includes('/./'))
      problems.push(`${where}.path must not climb folders`);
    else if (!(m[1] in KIND)) problems.push(`${where}.path: .${m[1]} is not an allowed format`);
    if (typeof f.path === 'string') {
      if (seen.has(f.path)) problems.push(`${where}.path ${f.path} is listed twice`);
      seen.add(f.path);
    }
    if (!Number.isInteger(f.bytes) || f.bytes <= 0)
      problems.push(`${where}.bytes must be a positive integer`);
    if (typeof f.sha256 !== 'string' || !SHA256_RE.test(f.sha256))
      problems.push(`${where}.sha256 must be 64 lower-case hex digits`);
    if (f.region !== undefined && (typeof f.region !== 'string' || !SLUG_RE.test(f.region)))
      problems.push(`${where}.region must be a region id`);
    const extra = Object.keys(f).filter((k) => !['path', 'bytes', 'sha256', 'region', 'note'].includes(k));
    if (extra.length) problems.push(`${where} has unknown fields: ${extra.join(', ')}`);
  }
  return problems;
}

/** The pack id, asset id and extension a dataset path names. */
export function splitPath(datasetPath) {
  const slash = datasetPath.indexOf('/');
  const packId = datasetPath.slice(0, slash);
  const rest = datasetPath.slice(slash + 1);
  const ext = /\.([a-z0-9]+)$/.exec(rest)?.[1] ?? '';
  return { packId, id: rest.replace(/\.[^./]+$/, ''), ext };
}

/** The public download URL of a pinned file (no token: the dataset is public). */
export function resolveUrl(lock, datasetPath) {
  const enc = datasetPath.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/datasets/${lock.repo}/resolve/${lock.revision}/${enc}`;
}

/** Where the build writes a file: dist-relative, grouped by region, named by its content. */
export function distFileName(file) {
  const { ext } = splitPath(file.path);
  const base = path.posix.basename(file.path, `.${ext}`);
  return `${DIST_DIR}/${file.region ?? SHARED}/${base}-${file.sha256.slice(0, 8)}.${ext}`;
}

/** The asset manifest row for a file (the core `AssetIndexEntry` shape, plus its region). */
export function manifestRow(file, url) {
  const { packId, id, ext } = splitPath(file.path);
  const row = {
    id,
    kind: KIND[ext](id),
    source: 'dataset',
    path: url,
    bytes: file.bytes,
    hash: file.sha256,
    packId,
  };
  if (file.region) row.region = file.region;
  return row;
}

/** @param {string} root @returns {{ lock: Lock, problems: string[] } | { lock: null, problems: string[] }} */
export function readLock(root) {
  const file = path.join(root, LOCK_FILE);
  if (!existsSync(file)) return { lock: null, problems: [`${LOCK_FILE} is missing`] };
  let lock;
  try {
    lock = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { lock: null, problems: [`${LOCK_FILE} is not valid JSON: ${String(err)}`] };
  }
  return { lock, problems: lockProblems(lock) };
}

export function writeLock(root, lock) {
  lock.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  writeFileSync(path.join(root, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
}

export const cachePath = (root, datasetPath) => path.join(root, CACHE_DIR, ...datasetPath.split('/'));

/** The cached bytes of a file when they match the lock, else null. */
export function cachedBytes(root, file) {
  const p = cachePath(root, file.path);
  if (!existsSync(p)) return null;
  const bytes = readFileSync(p);
  return bytes.length === file.bytes && sha256(bytes) === file.sha256 ? bytes : null;
}

/**
 * Makes sure one pinned file is in the cache with the right hash, downloading it when it is not.
 * Returns its bytes and whether it was downloaded. Throws, in plain words, on any failure.
 */
export async function ensureCached(root, lock, file, fetchFn = fetch) {
  const have = cachedBytes(root, file);
  if (have) return { bytes: have, downloaded: false };
  const url = resolveUrl(lock, file.path);
  let res;
  try {
    res = await fetchFn(url);
  } catch (err) {
    throw new Error(`could not download ${file.path} (offline?): ${String(err?.cause?.code ?? err)}`, {
      cause: err,
    });
  }
  if (!res.ok) throw new Error(`could not download ${file.path}: HTTP ${res.status} from ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = sha256(bytes);
  if (got !== file.sha256 || bytes.length !== file.bytes)
    throw new Error(
      `${file.path} from revision ${lock.revision.slice(0, 7)} has sha256 ${got.slice(0, 12)}… and ` +
        `${bytes.length} bytes; the lock pins ${file.sha256.slice(0, 12)}… and ${file.bytes} bytes`,
    );
  const p = cachePath(root, file.path);
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.part-${process.pid}`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, p);
  return { bytes, downloaded: true };
}

/** The region ids the packs declare (`packs/<pack>/regions/<id>/`). */
export function packRegions(root) {
  const out = new Set();
  const packs = path.join(root, 'packs');
  if (!existsSync(packs)) return out;
  for (const pack of readdirSync(packs)) {
    const regions = path.join(packs, pack, 'regions');
    if (!existsSync(regions)) continue;
    for (const r of readdirSync(regions)) if (statSync(path.join(regions, r)).isDirectory()) out.add(r);
  }
  return out;
}

/**
 * Checks the lock against the repo: every file's pack exists, every region is a real region, and no
 * asset id is also baked by its pack (one id, one file).
 */
export function repoProblems(root, lock) {
  const problems = [];
  const regions = packRegions(root);
  for (const f of lock.files) {
    const { packId } = splitPath(f.path);
    if (!existsSync(path.join(root, 'packs', packId, 'pack.json')))
      problems.push(`${f.path}: there is no pack "${packId}" under packs/`);
    else if (existsSync(path.join(root, 'packs', packId, 'assets', ...f.path.split('/').slice(1))))
      problems.push(`${f.path}: packs/${packId}/assets/ already bakes this asset id; keep one`);
    if (f.region && !regions.has(f.region))
      problems.push(`${f.path}: region "${f.region}" is not a region in packs/ (${[...regions].join(', ')})`);
  }
  return problems;
}

/**
 * Model bytes per region in a build: dataset models under `assets/ds/<region>/`, and every other
 * model (the base pack's baked scenery) as shared. `files` are dist-relative posix paths with sizes.
 */
export function modelsByRegion(files) {
  const out = new Map();
  for (const f of files) {
    if (!f.rel.endsWith('.glb')) continue;
    const m = new RegExp(`^${DIST_DIR}/([^/]+)/`).exec(f.rel);
    const region = m?.[1] ?? SHARED;
    const cur = out.get(region) ?? { files: 0, bytes: 0 };
    cur.files++;
    cur.bytes += f.bytes;
    out.set(region, cur);
  }
  return out;
}

/** The largest download one race needs in models: the shared ones plus its region's. */
export function worstRaceModelBytes(byRegion) {
  const shared = byRegion.get(SHARED)?.bytes ?? 0;
  let worst = 0;
  for (const [region, v] of byRegion) if (region !== SHARED) worst = Math.max(worst, v.bytes);
  return shared + worst;
}

/**
 * The Vite plugin. `virtual:dataset-assets` exports the manifest rows. In a build, each file is
 * fetched into the cache if needed, checked, and emitted at `distFileName`; the row's path is that
 * file, which the manifest resolves against the page. In dev and tests, rows point at the cache and
 * the dev server serves it (a file not fetched yet just falls back to its stand-in).
 */
export function datasetAssetsPlugin({ root, fetchFn } = {}) {
  const resolved = `\0${VIRTUAL_ID}`;
  let isBuild = false;
  let base = root;
  return {
    name: 'throttlebrawl:dataset-assets',
    configResolved(config) {
      isBuild = config.command === 'build';
      base = root ?? config.root;
    },
    resolveId: (source) => (source === VIRTUAL_ID ? resolved : null),
    async load(id) {
      if (id !== resolved) return null;
      this.addWatchFile?.(path.join(base, LOCK_FILE));
      const { lock, problems } = readLock(base);
      if (problems.length) this.error(`${LOCK_FILE}: ${problems.join('; ')}`);
      const rows = [];
      for (const file of lock.files) {
        if (!isBuild) {
          rows.push(manifestRow(file, `${CACHE_DIR}/${file.path}`));
          continue;
        }
        let bytes;
        try {
          ({ bytes } = await ensureCached(base, lock, file, fetchFn));
        } catch (err) {
          this.error(`dataset asset: ${String(err?.message ?? err)} (npm run assets:fetch)`);
        }
        const fileName = distFileName(file);
        this.emitFile({ type: 'asset', fileName, source: bytes });
        rows.push(manifestRow(file, fileName));
      }
      return `export default ${JSON.stringify(rows)};`;
    },
    configureServer(server) {
      const prefix = `/${CACHE_DIR}/`;
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (!url.startsWith(prefix)) return next();
        const rel = decodeURIComponent(url.slice(prefix.length));
        if (rel.split('/').includes('..')) return next();
        const p = path.join(base, CACHE_DIR, ...rel.split('/'));
        if (!existsSync(p)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(readFileSync(p));
      });
    },
  };
}
