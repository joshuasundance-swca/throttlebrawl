// A build file's fetch that fails is tried again a few times before the page gives up (polish lane
// K2; docs/engineering.md, "Deploy: game Space and staging Space", Offline). The playtest 4 run A
// fix batch's second live check found San Francisco's one failed map file, with no deploy, left 0
// routes for 15 s: nothing tried again, because the host still served the build, so the stale-build
// watch (stale-build.ts) had nothing to reload to. Run B's check saw the host answer 429 twice just
// after a deploy. The page's `fetch` is wrapped once (platform/index.ts), so every caller gets it:
// content/'s map and pack data, assets/' models and kits, audio/'s voices.
//
// What is tried again: a GET of a file under the build's `assets/` that fails to connect, or answers
// 408, 425, 429 or any 5xx; each time after a longer wait (RETRY_DELAYS_MS), and after the answer's
// Retry-After when that is longer. A Retry-After beyond RETRY_AFTER_CAP_MS gives up at once: the host
// said not to come back soon, and the player's Retry button (app/) can ask later.
//
// What is not: a 404 or 410 (a build file the host no longer has: stale-build.ts's rule, which
// reloads to the build the host serves; retrying it would only delay that), any other 4xx, a file
// outside `assets/`, a request with the network off or that the caller aborted. When it gives up it
// hands back the last answer (or rethrows the last error) untouched, so callers' own failure paths
// (a fallback stand-in, a message) work as before.
//
// Like stale-build.ts it imports nothing: the page and the worker must share no chunk.

/** The waits before each new try: three tries after the first (ms). [default] */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1500, 4000];
/** The longest Retry-After it waits out; a longer one gives up at once (ms). [default] */
export const RETRY_AFTER_CAP_MS = 8000;
/** The content-hashed files of a build (stale-build.ts's BUILD_DIR). */
const BUILD_DIR = 'assets/';

/** What the retry needs from the page; the real one or a test's stand-in. */
export interface RetryEnv {
  /** The page's folder, which its build's files sit under, ending in `/`. */
  scope: string;
  online(): boolean;
  /** Resolves after `ms` (a test's resolves at once and records the wait). */
  wait(ms: number): Promise<void>;
  /** The clock in ms, for a Retry-After given as a date. */
  now(): number;
}

/** Answers worth another try: the host or its edge was busy or briefly down, not "no such file". */
const worthRetrying = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);

/**
 * The wait a Retry-After value asks for, in ms (whole seconds, or an HTTP date counted from `now`);
 * null when there is none that can be read. app/'s did-not-load card reads it too (load-retry.ts).
 */
export function retryAfterMsOf(value: string | null | undefined, now: number): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** The wait a response's Retry-After asks for, in ms; null when it has none that can be read. */
const retryAfterMs = (res: Response, now: number): number | null =>
  retryAfterMsOf(res.headers.get('Retry-After'), now);

export function retryingFetch(inner: typeof fetch, env: RetryEnv): typeof fetch {
  const buildDir = new URL(BUILD_DIR, env.scope).href;
  const eligible = (input: RequestInfo | URL, init?: RequestInit): boolean => {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
      return method.toUpperCase() === 'GET' && new URL(raw, env.scope).href.startsWith(buildDir);
    } catch {
      return false;
    }
  };
  return async (input, init) => {
    if (!eligible(input, init)) return inner(input, init);
    for (let attempt = 0; ; attempt++) {
      const backoff = RETRY_DELAYS_MS[attempt];
      let res: Response;
      try {
        res = await inner(input, init);
      } catch (err) {
        if (backoff === undefined || init?.signal?.aborted || !env.online()) throw err;
        await env.wait(backoff);
        continue;
      }
      if (backoff === undefined || !worthRetrying(res.status)) return res;
      const asked = retryAfterMs(res, env.now());
      if (asked !== null && asked > RETRY_AFTER_CAP_MS) return res;
      // This answer is dropped, so its body is not left half-read.
      void res.body?.cancel().catch(() => undefined);
      await env.wait(Math.max(backoff, asked ?? 0));
    }
  };
}
