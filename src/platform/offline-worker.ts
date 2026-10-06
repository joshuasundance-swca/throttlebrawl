// The offline service worker's policy (docs/architecture.md, "Asset manifest"; docs/engineering.md,
// "Deploy: game Space and staging Space", Offline). The maintainer: "Offline definitely preferable".
// sw.ts is the worker's entry; this file is its logic behind `OfflineEnv`, so the unit tests drive
// it with an in-memory cache and a fake network. The build step (scripts/service-worker.mjs)
// hands the worker its config: this build's cache name, every file the build wrote, and how to tell
// that a file without a content hash in its name is this build's.
//
// - Install: all or nothing, and only this build's files (playtest 4 run A's live check: a deploy
//   that landed during a tab's install left 650 of 668 files cached, and offline the landmark chunk
//   failed). Every file of the build goes into this build's cache, so a loaded game plays with the
//   network off. A content-hashed file (everything under assets/: its name changes whenever its
//   bytes do) crosses over from an older build's cache when it is there, so a deploy downloads only
//   what changed; a file without one must pass its check (its SHA-256, or for the page its own
//   entry script). Any file that fails (a 404 once a deploy has replaced the build, bytes of another
//   build, a connection dropped twice) fails the install and drops this build's half-filled cache,
//   so the worker never takes the page with a hole in it; the browser keeps the last worker and
//   tries again at the next launch, when the host serves the newer build's worker.
// - Activate: older builds' caches go; the worker takes the open page at once.
// - Requests, inside the worker's folder only: the page, changelog.json and the web manifest are
//   network-first with a NETWORK_TIMEOUT_MS fallback to the cache, so a deploy is played at the next
//   launch and a weak signal never hangs one; everything else is cache-first. Only the changelog
//   (written after the build, so not in its list) is kept from the network: what a newer build's
//   page fetches online is passed on, never mixed into this build's cache. The page leaves out its
//   `rel=preload` hints: Chrome will not use a preload a worker answered ("cross-world service
//   worker resource mismatch") and fetches the file again. Other sites, other folders and anything
//   but a GET are left to the browser.
// - Gzip copies (playtest 4 run B's live check, punch item 8): the game's host sends every file as
//   stored, with no Content-Encoding whatever the browser accepts, so a phone downloaded each script
//   whole. The build stores `<file>.gz` beside each file under assets/ whose extension the config's
//   `gzip` lists (scripts/service-worker.mjs). For those files the install takes the copy the
//   browser's HTTP cache already holds (the page loaded it), else downloads the gzip copy and
//   unpacks it (DecompressionStream), and caches the file itself under its own name; a request the
//   cache misses (a newer build's chunk, played online) is answered the same way. A copy that is
//   missing, not gzip or does not unpack falls back to the plain file, so nothing worse than today's
//   download can happen. The page's own first load, before the worker, still gets the plain files.
//
// It must import nothing at run time: sw.ts is built as its own classic script, and a module the
// page shares would become a shared chunk the worker cannot load.

/** Every cache this worker owns starts with this; others on the origin are never touched. */
export const CACHE_PREFIX = 'offline-';
/** How long a network-first request waits before the cache answers instead. [default] */
export const NETWORK_TIMEOUT_MS = 3000;
/** Files under this folder carry a content hash in their name (Vite's and the dataset assets'). */
const HASHED_DIR = 'assets/';
/** Files fetched network-first (besides page loads), relative to the worker's folder. */
const NETWORK_FIRST = new Set(['', 'index.html', 'changelog.json', 'manifest.webmanifest']);
/** The page the worker opens for any page load in its folder. */
const PAGE = 'index.html';
/** How many files the install downloads at once: the game's own requests keep a lane. [default] */
const INSTALL_LANES = 4;
/** A `<link rel=preload>` tag (not `modulepreload`) and the white space after it. */
const PRELOAD_LINK = /<link\b[^>]*\brel=["']?preload\b[^>]*>\s*/gi;
/** A gzip copy's suffix (scripts/service-worker.mjs). */
const GZIP_SUFFIX = '.gz';
/** The header on a file the worker unpacked from its gzip copy (a live check reads it). */
export const GZIP_MARK = 'x-offline-from';
/** The type a file unpacked from its copy is served with, by extension. */
const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
};

/**
 * How the install tells that a file without a content hash in its name is this build's: the SHA-256
 * of its bytes (hex), or, for a page, a text it must contain: its own entry script's path. The game's
 * host adds a script of its own to HTML, so a page's bytes are never the build's.
 */
export type FileCheck = { sha256: string } | { contains: string };

/** What the build step hands the worker. */
export interface OfflineConfig {
  /** This build's cache: CACHE_PREFIX, the build id and a hash of the build's bytes. */
  cache: string;
  /** Every file of the build but the worker, relative to the worker's folder. */
  files: readonly string[];
  /** The check of every file in `files` outside assets/. */
  checks: Readonly<Record<string, FileCheck>>;
  /** The extensions whose files under assets/ have a gzip copy; none when absent (older builds). */
  gzip?: readonly string[];
}

/** The part of a fetch event's request the policy reads; the real `Request` is passed through. */
export interface WorkerRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
}

/** One cache, keyed by absolute URL. */
export interface OfflineCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

/** The worker's CacheStorage. `match` searches every cache. */
export interface OfflineCaches {
  open(name: string): Promise<OfflineCache>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
  match(key: string): Promise<Response | undefined>;
}

export interface OfflineEnv {
  /** The registration's scope: the folder the page and the worker sit in, ending in `/`. */
  scope: string;
  caches: OfflineCaches;
  fetch(req: WorkerRequest | string, init?: RequestInit): Promise<Response>;
  /** Resolves after `ms`; the tests fire it by hand. */
  delay(ms: number): Promise<void>;
}

export interface OfflineWorker {
  /** Caches the whole build, or rejects and leaves no cache of it. */
  install(): Promise<void>;
  activate(): Promise<void>;
  /** The answer to a request, or null to leave it to the browser. */
  respond(req: WorkerRequest): Promise<Response> | null;
}

/** A response worth keeping: a full, same-origin success (never a redirect or an error page). */
const keepable = (res: Response) => res.ok && (res.type === 'basic' || res.type === 'default');

async function sha256Hex(res: Response): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await res.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether a response is this build's file, by its check. */
async function passes(res: Response, check: FileCheck): Promise<boolean> {
  return 'sha256' in check
    ? (await sha256Hex(res)) === check.sha256
    : (await res.text()).includes(check.contains);
}

/**
 * The file `rel` from the host's answer for its gzip copy, served as that file; null when the copy
 * is not usable (missing, not gzip, does not unpack). The game's host sends the copy's raw bytes; a
 * host that labels it `Content-Encoding: gzip` (Vite's preview server) has the browser unpack it.
 */
async function fromGzipCopy(res: Response, rel: string): Promise<Response | null> {
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  let body: ArrayBuffer;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const unpacked = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    body = await new Response(unpacked).arrayBuffer();
  } else if (/\bgzip\b/i.test(res.headers.get('content-encoding') ?? '')) {
    body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } else return null;
  const ext = rel.slice(rel.lastIndexOf('.'));
  return new Response(body, {
    status: 200,
    headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream', [GZIP_MARK]: 'gzip' },
  });
}

/** The page without its `rel=preload` hints; any other answer as it is. */
async function withoutPreloads(res: Response): Promise<Response> {
  if (!res.ok) return res;
  const html = await res.clone().text();
  const page = html.replace(PRELOAD_LINK, '');
  if (page === html) return res;
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(page, { status: res.status, statusText: res.statusText, headers });
}

export function createOfflineWorker(env: OfflineEnv, config: OfflineConfig): OfflineWorker {
  const abs = (rel: string) => new URL(rel, env.scope).href;
  const cache = () => env.caches.open(config.cache);
  const listed = new Set(config.files);

  /** A keepable answer, after one more try on a dropped connection; anything else throws. */
  const download = async (rel: string, init: RequestInit) => {
    const url = abs(rel);
    const res = await env
      .fetch(url, init)
      .catch(() => env.fetch(url, init))
      .catch((err: unknown) => {
        throw new Error(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      });
    if (!keepable(res)) throw new Error(`${rel}: HTTP ${res.status}`);
    return res;
  };

  /** Whether `rel` has a gzip copy this worker can unpack. */
  const hasCopy = (rel: string) =>
    typeof DecompressionStream === 'function' &&
    rel.startsWith(HASHED_DIR) &&
    (config.gzip ?? []).some((ext) => rel.endsWith(ext));

  /** The file `rel` from its gzip copy, or null when that fails in any way (one try). */
  const viaCopy = (rel: string): Promise<Response | null> =>
    env
      .fetch(`${abs(rel)}${GZIP_SUFFIX}`)
      .then((res) => fromGzipCopy(res, rel))
      .catch(() => null);

  /** A content-hashed file for the install: the HTTP cache's copy, its gzip copy, else the file. */
  const downloadHashed = async (rel: string): Promise<Response> => {
    if (hasCopy(rel)) {
      // The page loaded most first-load files already: take them from the HTTP cache, stale or not
      // (a hashed name never changes its bytes), instead of downloading them again.
      const held = await env
        .fetch(abs(rel), { cache: 'only-if-cached', mode: 'same-origin' })
        .catch(() => null);
      if (held && keepable(held)) return held;
      const unpacked = await viaCopy(rel);
      if (unpacked) return unpacked;
    }
    // Without a copy, hashed files may still come from the HTTP cache (revalidated).
    return download(rel, {});
  };

  const cacheFile = async (rel: string) => {
    const url = abs(rel);
    const store = await cache();
    if (rel.startsWith(HASHED_DIR)) {
      const old = await env.caches.match(url);
      return store.put(url, old ?? (await downloadHashed(rel)));
    }
    // The rest are checked with the server, then against the build's own check.
    const check = config.checks[rel];
    if (!check) throw new Error(`${rel}: no check in the worker's config`);
    const res = await download(rel, { cache: 'no-cache' });
    if (!(await passes(res.clone(), check))) throw new Error(`${rel}: not this build's (a deploy landed)`);
    return store.put(url, res);
  };

  /** Network first; only a file outside the build's list (the changelog) is kept from it. */
  const networkFirst = async (req: WorkerRequest, rel: string): Promise<Response> => {
    const key = abs(rel);
    const net = env.fetch(req).then(async (res) => {
      if (!listed.has(rel) && keepable(res)) await (await cache()).put(key, res.clone());
      return res;
    });
    const timedOut = env.delay(NETWORK_TIMEOUT_MS).then(() => null);
    const first = await Promise.race([net.catch(() => null), timedOut]);
    if (first) return first;
    const cached = (await (await cache()).match(key)) ?? (await env.caches.match(key));
    // Nothing cached: the network is the only hope, however slow.
    return cached ?? net;
  };

  /**
   * This build's copy, else the network's answer (from the file's gzip copy when it has one),
   * passed on without keeping it.
   */
  const cacheFirst = async (req: WorkerRequest, key: string, rel: string): Promise<Response> => {
    const hit = await (await cache()).match(key);
    if (hit) return hit;
    const unpacked = hasCopy(rel) ? await viaCopy(rel) : null;
    if (unpacked) return unpacked;
    try {
      return await env.fetch(req);
    } catch (err) {
      // An older build's copy (the page may still be that build's) beats a failed load.
      const old = await env.caches.match(key);
      if (old) return old;
      throw err;
    }
  };

  return {
    async install() {
      const queue = [...config.files];
      /** Each failure's reason; the lanes stop taking files once there is one. */
      const failed: string[] = [];
      const lane = async () => {
        for (let rel = queue.shift(); rel !== undefined && failed.length === 0; rel = queue.shift()) {
          const file = rel;
          await cacheFile(file).catch((err: unknown) =>
            failed.push(err instanceof Error ? err.message : `${file}: failed`),
          );
        }
      };
      await Promise.all(Array.from({ length: INSTALL_LANES }, lane));
      if (failed.length === 0) return;
      await env.caches.delete(config.cache);
      throw new Error(`the offline cache is incomplete (${failed.join('; ')}); the worker is not installed`);
    },

    async activate() {
      for (const name of await env.caches.keys())
        if (name.startsWith(CACHE_PREFIX) && name !== config.cache) await env.caches.delete(name);
    },

    respond(req) {
      if (req.method !== 'GET' || !req.url.startsWith(env.scope)) return null;
      if (req.mode === 'navigate') return networkFirst(req, PAGE).then(withoutPreloads);
      const url = new URL(req.url);
      const rel = url.href.slice(env.scope.length).split(/[?#]/)[0] ?? '';
      return NETWORK_FIRST.has(rel) ? networkFirst(req, rel || PAGE) : cacheFirst(req, url.href, rel);
    },
  };
}
