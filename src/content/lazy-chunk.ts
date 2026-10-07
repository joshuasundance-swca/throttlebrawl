// A lazy code chunk's import, the loader's rule for code as retry-fetch.ts is for data (polish batch
// F's check, punch item 4). A deploy in the middle of a race renames every file of the build, so the
// open tab's next `import()` answers 404: render/'s landmark chunk did, and the race got two uncaught
// "Failed to fetch dynamically imported module" errors and drew no landmark. Every lazy import the
// game makes mid-race goes through `loadChunk`:
// - it is tried once more, after a short wait (a dropped connection on the phone);
// - when both tries fail it is said once (a console warning, never an uncaught error) and resolves
//   null, so the caller keeps its stand-in (no landmark, the classic look) and the race goes on;
// - a build whose files are gone is platform/stale-build.ts's to handle: Vite's import wrapper
//   (its preload helper) fires `vite:preloadError` on the window for each failed try before the
//   error reaches here, the watch asks the host which build it serves, and a reload to the new one
//   waits for the race's end and is offered on the result screen (the transient-card rule).
//
// The retry asks the network again (polish batch K's check, mustFix 1). A browser keeps a failed
// `import()` under its URL: in Chromium the same import again fails at once and sends no request
// (1 request for 3 imports, live), so a retry of the same `() => import('./x')` never left the page.
// The retry imports the chunk's own URL, which the browser names in the failure ("Failed to fetch
// dynamically imported module: <url>"; Firefox words it "error loading ..."), with a `retry` query: a
// URL the module map has never seen, which the host serves as the same file. That is safe because
// the failed module never ran, so the page never holds two copies of it. Each new ask of a chunk that
// failed again uses a new number; a chunk fetched again is kept here, and a later load of it (whose
// plain import fails at once from the map) takes that module with no wait and no request. A failure
// that names no URL on the page's origin (WebKit's "Importing a module script failed.") tries the
// same import once more, as before.
//
// The caller passes the import itself (`() => import('./landmarks')`), so the bundler still splits
// the chunk and wraps each try. It must be ONE `import()` whose module the caller uses as it comes
// (no `.then`, no `Promise.all`), because the retry stands in for it with the same module from the
// new URL; src/render/lazy-imports.test.ts holds the call sites to that.

/** The wait before the second try (ms). [default] */
export const CHUNK_RETRY_MS = 1000;

/** The query a retried chunk's URL carries, so the browser asks the host again. [default] */
export const RETRY_PARAM = 'retry';

/** How a chunk's two tries wait, say they failed and fetch again; the real ones, or a test's stand-ins. */
export interface ChunkEnv {
  wait(ms: number): Promise<void>;
  warn(message: string, err: unknown): void;
  /** The module at a full URL (the browser's own `import()`; Vite leaves it alone). */
  importUrl(url: string): Promise<unknown>;
  /** The page's origin: only a chunk of the game's own is fetched again by its URL. */
  origin(): string;
}

const browserChunkEnv: ChunkEnv = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  warn: (message, err) => console.warn(message, err),
  importUrl: (url) => import(/* @vite-ignore */ url) as Promise<unknown>,
  origin: () => (typeof location === 'undefined' ? '' : location.origin),
};

/** The words Chromium and Firefox put before a failed module's URL. */
const FAILED_IMPORT = /dynamically imported module:?\s+(\S+)/i;

/**
 * The URL of the module a failed `import()` names, without a retry query; null when the failure
 * names none on `origin` (WebKit's words name no URL).
 */
export function failedChunkUrl(err: unknown, origin: string): string | null {
  const said = FAILED_IMPORT.exec(err instanceof Error ? err.message : String(err))?.[1];
  if (!said) return null;
  let url: URL;
  try {
    url = new URL(said);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  url.searchParams.delete(RETRY_PARAM);
  url.hash = '';
  return url.href;
}

/** Per environment: each chunk URL's retries so far, and its retry in flight or fetched. */
interface Retries {
  count: Map<string, number>;
  fetched: Map<string, Promise<unknown>>;
}
const retriesOf = new WeakMap<ChunkEnv, Retries>();

function retries(env: ChunkEnv): Retries {
  let r = retriesOf.get(env);
  if (!r) {
    r = { count: new Map(), fetched: new Map() };
    retriesOf.set(env, r);
  }
  return r;
}

/** The chunk at `url` imported again under a URL the browser has not tried; shared while in flight. */
function fetchAgain(env: ChunkEnv, url: string): Promise<unknown> {
  const r = retries(env);
  const held = r.fetched.get(url);
  if (held) return held;
  const n = (r.count.get(url) ?? 0) + 1;
  r.count.set(url, n);
  const fresh = new URL(url);
  fresh.searchParams.set(RETRY_PARAM, String(n));
  const p = env.importUrl(fresh.href);
  r.fetched.set(url, p);
  // A retry that failed is forgotten, so the next ask fetches under a new number.
  p.catch(() => r.fetched.delete(url));
  return p;
}

/**
 * The module `load` imports, tried twice (the second time from the network, by a new URL); null
 * when both tries fail (said once as a warning). It never rejects, so `void loadChunk(...).then(...)`
 * leaves no uncaught error.
 */
export async function loadChunk<T>(
  name: string,
  load: () => Promise<T>,
  env: ChunkEnv = browserChunkEnv,
): Promise<T | null> {
  let first: unknown;
  try {
    return await load();
  } catch (err) {
    first = err; // tried once more below
  }
  const url = failedChunkUrl(first, env.origin());
  try {
    // A chunk fetched again already (or being fetched): its module, at once.
    const held = url ? retries(env).fetched.get(url) : undefined;
    if (held) return (await held) as T;
    await env.wait(CHUNK_RETRY_MS);
    return url ? ((await fetchAgain(env, url)) as T) : await load();
  } catch (err) {
    env.warn(`the ${name} chunk did not load; the game goes on without it`, err);
    return null;
  }
}
