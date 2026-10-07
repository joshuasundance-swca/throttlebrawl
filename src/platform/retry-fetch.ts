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
// The host's wait is the loader's (polish batch E's check, punch item 2: with "Retry in 30 s" on the
// did-not-load card, a new pick or a Race tap asked for all 34 of a region's map files at once). Once
// an answer has asked for a wait, no build file is asked for until it has passed: a request inside a
// wait no longer than the cap waits it out first, and one inside a longer wait answers at once with a
// 429 of its own whose Retry-After is the wait that is left, so every load path says the same wait.
//
// Paced once the host asks (polish batch F's check, punch item 5: picking San Francisco asked for its
// 34 map files at once, and the host answered some 429; polish batch O's check, punch item 1: pacing
// every pick made region data 2 to 3 times later, San Francisco's route chips 3.4 to 4.4 s after the
// tap against 1.5 s, while the real host gave 0 429s in 8 picks with or without it). A build file is
// asked for at once until the host answers a 429, or a 503 with a Retry-After; from then until
// PACE_QUIET_MS has passed with no such answer (counted from the end of its wait), no more than
// FETCH_LANES build files are asked for at a time. A request holds its lane until the host's answer
// arrives (its headers; the body is the caller's) and then hands it to the next in line, and a 429
// that asks for a wait holds every file still in line until it has passed (the wait above).
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
/** How many build files are asked for at a time once the host asked for pacing. [default] */
export const FETCH_LANES = 4;
/** How long the pacing lasts after the host's last 429 (or 503 with a Retry-After) and its wait (ms). [default] */
export const PACE_QUIET_MS = 30_000;
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

/** The answer given, without asking the host, inside a wait it asked for (`leftMs` of it left). */
const heldBack = (leftMs: number): Response =>
  new Response(null, {
    status: 429,
    statusText: 'Too Many Requests',
    headers: { 'Retry-After': String(Math.ceil(leftMs / 1000)) },
  });

/**
 * Lanes for requests: unlimited while `paced()` is false, else `count` (the requests already out
 * count against it), handed on in the order they were asked for.
 */
function lanes(count: number, paced: () => boolean) {
  let busy = 0;
  const line: (() => void)[] = [];
  const room = () => !paced() || busy < count;
  return {
    take: (): Promise<void> => {
      if (line.length === 0 && room()) {
        busy++;
        return Promise.resolve();
      }
      return new Promise((resolve) => line.push(resolve));
    },
    give: () => {
      busy--;
      for (let next = line[0]; next && room(); next = line[0]) {
        line.shift();
        busy++;
        next();
      }
    },
  };
}

export function retryingFetch(inner: typeof fetch, env: RetryEnv): typeof fetch {
  const buildDir = new URL(BUILD_DIR, env.scope).href;
  /** Until when (env.now's clock) the host asked not to be asked for a build file again. */
  let holdUntil = -Infinity;
  /** Until when (env.now's clock) build files are paced: the host asked to be asked less at once. */
  let pacedUntil = -Infinity;
  const lane = lanes(FETCH_LANES, () => env.now() < pacedUntil);
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
    /** How far this request's own last wait reached: a wait it already sat through is not sat again. */
    let waitedTo = -Infinity;
    const pause = (ms: number) => {
      waitedTo = env.now() + ms;
      return env.wait(ms);
    };
    /**
     * Waits out any wait the host asked for (this answer's, or another file's), then for a lane, and
     * again for a wait asked for while it stood in line; null once it holds a lane with no wait left.
     * A wait longer than the cap is answered at once with the wait that is left, asking nothing.
     */
    const ready = async (): Promise<Response | null> => {
      for (;;) {
        const left = holdUntil - Math.max(env.now(), waitedTo);
        if (left > RETRY_AFTER_CAP_MS) return heldBack(left);
        if (left > 0) await pause(left);
        await lane.take();
        if (holdUntil - Math.max(env.now(), waitedTo) <= 0) return null;
        lane.give();
      }
    };
    for (let attempt = 0; ; attempt++) {
      const backoff = RETRY_DELAYS_MS[attempt];
      const held = await ready();
      if (held) return held;
      let res: Response;
      try {
        res = await inner(input, init);
      } catch (err) {
        lane.give();
        if (backoff === undefined || init?.signal?.aborted || !env.online()) throw err;
        await pause(backoff);
        continue;
      }
      // The wait this answer asks for holds the line before its lane is handed on.
      const retry = worthRetrying(res.status);
      const asked = retry ? retryAfterMs(res, env.now()) : null;
      if (asked !== null && asked > 0) holdUntil = Math.max(holdUntil, env.now() + asked);
      if (res.status === 429 || (res.status === 503 && asked !== null))
        pacedUntil = Math.max(pacedUntil, env.now() + Math.max(asked ?? 0, 0) + PACE_QUIET_MS);
      lane.give();
      if (!retry) return res;
      if (backoff === undefined || (asked !== null && asked > RETRY_AFTER_CAP_MS)) return res;
      // This answer is dropped, so its body is not left half-read.
      void res.body?.cancel().catch(() => undefined);
      await pause(Math.max(backoff, asked ?? 0));
    }
  };
}
