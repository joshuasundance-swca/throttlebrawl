// The offline service worker's policy (docs/architecture.md, "Asset manifest"; docs/engineering.md,
// "Deploy: game Space and staging Space", Offline). The maintainer: "Offline definitely preferable".
// sw.ts is the worker's entry; this file is its logic behind `OfflineEnv`, so the unit tests drive
// it with an in-memory cache and a fake network. The build step (scripts/service-worker.mjs)
// hands the worker its config: this build's cache name and every file the build wrote.
//
// - Install: every file of the build goes into this build's cache, so a loaded game plays with the
//   network off. A content-hashed file (everything under assets/: its name changes whenever its
//   bytes do) crosses over from an older build's cache when it is there, so a deploy downloads only
//   what changed. A file that fails is fetched again the first time the game asks for it; only the
//   page itself must cache, or the worker would have nothing to open offline.
// - Activate: older builds' caches go; the worker takes the open page at once.
// - Requests, inside the worker's folder only: the page, changelog.json and the web manifest are
//   network-first with a NETWORK_TIMEOUT_MS fallback to the cache, so a deploy is played at the next
//   launch and a weak signal never hangs one; everything else is cache-first. Other sites, other
//   folders and anything but a GET are left to the browser.
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

/** What the build step hands the worker. */
export interface OfflineConfig {
  /** This build's cache: CACHE_PREFIX, the build id and a hash of the build's bytes. */
  cache: string;
  /** Every file of the build but the worker, relative to the worker's folder. */
  files: readonly string[];
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
  install(): Promise<void>;
  activate(): Promise<void>;
  /** The answer to a request, or null to leave it to the browser. */
  respond(req: WorkerRequest): Promise<Response> | null;
}

/** A response worth keeping: a full, same-origin success (never a redirect or an error page). */
const keepable = (res: Response) => res.ok && (res.type === 'basic' || res.type === 'default');

export function createOfflineWorker(env: OfflineEnv, config: OfflineConfig): OfflineWorker {
  const abs = (rel: string) => new URL(rel, env.scope).href;
  const cache = () => env.caches.open(config.cache);

  const cacheFile = async (rel: string) => {
    const url = abs(rel);
    const store = await cache();
    if (rel.startsWith(HASHED_DIR)) {
      const old = await env.caches.match(url);
      if (old) return store.put(url, old);
    }
    // Hashed files may come from the HTTP cache (the page fetched most of them already); the rest
    // are checked with the server, so the page cached is this build's.
    const res = await env.fetch(url, rel.startsWith(HASHED_DIR) ? {} : { cache: 'no-cache' });
    if (!keepable(res)) throw new Error(`${rel}: HTTP ${res.status}`);
    return store.put(url, res);
  };

  /** Fetches and keeps a copy; a failed or unkeepable answer is passed on as it is. */
  const fetchAndKeep = async (req: WorkerRequest, key: string) => {
    const res = await env.fetch(req);
    if (keepable(res)) {
      const copy = res.clone();
      await (await cache()).put(key, copy);
    }
    return res;
  };

  const networkFirst = async (req: WorkerRequest, key: string): Promise<Response> => {
    const net = fetchAndKeep(req, key);
    const timedOut = env.delay(NETWORK_TIMEOUT_MS).then(() => null);
    const first = await Promise.race([net.catch(() => null), timedOut]);
    if (first) return first;
    const cached = (await (await cache()).match(key)) ?? (await env.caches.match(key));
    // Nothing cached: the network is the only hope, however slow.
    return cached ?? net;
  };

  const cacheFirst = async (req: WorkerRequest, key: string): Promise<Response> => {
    const hit = await (await cache()).match(key);
    if (hit) return hit;
    try {
      return await fetchAndKeep(req, key);
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
      const failed: string[] = [];
      const lane = async () => {
        for (let rel = queue.shift(); rel !== undefined; rel = queue.shift()) {
          const file = rel;
          await cacheFile(file).catch(() => failed.push(file));
        }
      };
      await Promise.all(Array.from({ length: INSTALL_LANES }, lane));
      if (failed.includes(PAGE) || !(await (await cache()).match(abs(PAGE))))
        throw new Error(`the offline cache has no ${PAGE}; the worker is not installed`);
    },

    async activate() {
      for (const name of await env.caches.keys())
        if (name.startsWith(CACHE_PREFIX) && name !== config.cache) await env.caches.delete(name);
    },

    respond(req) {
      if (req.method !== 'GET' || !req.url.startsWith(env.scope)) return null;
      if (req.mode === 'navigate') return networkFirst(req, abs(PAGE));
      const url = new URL(req.url);
      const rel = url.href.slice(env.scope.length).split(/[?#]/)[0] ?? '';
      return NETWORK_FIRST.has(rel) ? networkFirst(req, abs(rel)) : cacheFirst(req, url.href);
    },
  };
}
