// The page's own reads of the offline worker's caches, before that worker controls the page (polish
// batch F's check, punch item 1: on a first visit 30 files crossed the wire twice). On a first visit
// the page is nobody's until the worker's install has cached the whole build (offline-worker.ts: all
// or nothing), so every file the page asks for meanwhile goes to the network, even one the install
// has already put in its cache: three models and a script were downloaded by the install as their
// gzip copies, then again by the page as the plain files. A content-hashed file (anything under
// assets/) never changes its bytes, so whichever cache holds it holds the right file: the page takes
// it from there instead, and asks the network only on a miss. A page a worker controls is left alone
// (the worker answers it), and so is anything that is not a GET of a file under assets/.
//
// A module script (`import()`) is the browser's own request, which no fetch wrapper sees: the
// install asks for those as the plain files on a first visit instead (offline-worker.ts), so the
// page's import revalidates the stored copy (a 304) whichever came first.
//
// Like offline-worker.ts it imports nothing: the page and the worker must share no chunk.

/** The content-hashed files of a build (stale-build.ts's BUILD_DIR). */
const BUILD_DIR = 'assets/';

/** What the read needs from the page; the real one or a test's stand-in. */
export interface PageCacheEnv {
  /** The page's folder, which its build's files sit under, ending in `/`. */
  scope: string;
  /** Whether a worker controls the page now (it then answers every request itself). */
  controlled(): boolean;
  /** Every cache on the page's origin, searched for this URL (`caches.match`, ignoring Vary). */
  match(url: string): Promise<Response | undefined>;
}

/**
 * `inner` behind a look in the offline caches: while no worker controls the page, a GET of a file
 * under assets/ that a cache holds is answered from it, without the network. A cache that cannot be
 * read is a miss.
 */
export function readsOfflineCaches(inner: typeof fetch, env: PageCacheEnv): typeof fetch {
  const buildDir = new URL(BUILD_DIR, env.scope).href;
  /** The absolute URL of a GET under assets/, or null for anything else. */
  const cacheable = (input: RequestInfo | URL, init?: RequestInit): string | null => {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (
        init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
      ).toUpperCase();
      const url = new URL(raw, env.scope).href;
      return method === 'GET' && url.startsWith(buildDir) ? (url.split('#')[0] ?? url) : null;
    } catch {
      return null;
    }
  };
  return async (input, init) => {
    const url = env.controlled() ? null : cacheable(input, init);
    if (url !== null) {
      const hit = await env.match(url).catch(() => undefined);
      if (hit?.ok) return hit;
    }
    return inner(input, init);
  };
}
