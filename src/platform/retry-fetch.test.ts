import { describe, expect, it } from 'vitest';
import { recoverStaleBuild, type StaleBuildPage } from './stale-build';
import {
  FETCH_LANES,
  PACE_QUIET_MS,
  RETRY_AFTER_CAP_MS,
  RETRY_DELAYS_MS,
  retryingFetch,
  watchFetches,
} from './index';

// A failed data, map, model or kit fetch is tried again a few times before the page gives up
// (polish lane K2; playtest 4 run A's second fix check: San Francisco's map file failed once, with no
// deploy, and the region sat with 0 routes for 15 s because nothing tried again; run B saw the host
// answer 429 twice just after a deploy). The host here is scripted, and the clock is a list of the
// waits the retry asked for: nothing waits on real time.

const SCOPE = 'https://game.example/sub/';
const MAP = `${SCOPE}assets/osm-sf-lombard-flats-C3eDycHy.json`;

type Step = number | 'network' | { status: number; retryAfter: string };

/** A host that answers each URL from its script (one step per request), then 200 forever. */
function scripted(script: Record<string, Step[]>) {
  const asked: string[] = [];
  const left = new Map(Object.entries(script).map(([k, v]) => [k, [...v]]));
  const fetchFn = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    const step = left.get(url)?.shift() ?? 200;
    if (step === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    const status = typeof step === 'number' ? step : step.status;
    const headers: Record<string, string> =
      typeof step === 'object' ? { 'Retry-After': step.retryAfter } : {};
    return Promise.resolve(new Response(status === 200 ? '{"ok":true}' : 'no', { status, headers }));
  }) as typeof fetch;
  return { fetchFn, asked };
}

function retrying(script: Record<string, Step[]>, over: { online?: boolean; now?: number } = {}) {
  const host = scripted(script);
  const waits: number[] = [];
  const fetchFn = retryingFetch(host.fetchFn, {
    scope: SCOPE,
    online: () => over.online ?? true,
    now: () => over.now ?? 0,
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  return { fetchFn, waits, asked: host.asked };
}

describe('retryingFetch: a build file that fails is tried again', () => {
  it('a 429 then success answers 200 after one wait', async () => {
    const t = retrying({ [MAP]: [429] });
    const res = await t.fetchFn(MAP);
    expect(res.status).toBe(200);
    expect(t.asked).toHaveLength(2);
    expect(t.waits).toEqual([RETRY_DELAYS_MS[0]]);
  });

  it('a 500 then success answers 200', async () => {
    const t = retrying({ [MAP]: [500] });
    expect((await t.fetchFn(MAP)).status).toBe(200);
    expect(t.asked).toHaveLength(2);
  });

  it('a dropped connection then success answers 200', async () => {
    const t = retrying({ [MAP]: ['network'] });
    expect((await t.fetchFn(MAP)).status).toBe(200);
    expect(t.asked).toHaveLength(2);
  });

  it('backs off longer each time, and gives up after the last wait with the last answer', async () => {
    const t = retrying({ [MAP]: [503, 503, 503, 503, 503] });
    const res = await t.fetchFn(MAP);
    expect(res.status).toBe(503);
    expect(t.asked).toHaveLength(RETRY_DELAYS_MS.length + 1);
    expect(t.waits).toEqual([...RETRY_DELAYS_MS]);
    expect([...t.waits]).toEqual([...t.waits].sort((a, b) => a - b));
  });

  it('a permanent network failure rejects with the original error after the same tries', async () => {
    const t = retrying({ [MAP]: ['network', 'network', 'network', 'network', 'network'] });
    await expect(t.fetchFn(MAP)).rejects.toThrow(/Failed to fetch/);
    expect(t.asked).toHaveLength(RETRY_DELAYS_MS.length + 1);
  });

  it('waits for a 429s Retry-After (seconds) when it asks for longer than the backoff', async () => {
    const t = retrying({ [MAP]: [{ status: 429, retryAfter: '3' }] });
    expect((await t.fetchFn(MAP)).status).toBe(200);
    expect(t.waits).toEqual([3000]);
  });

  it('waits for a Retry-After given as a date', async () => {
    const at = new Date(Date.UTC(2026, 9, 6, 12, 0, 0));
    const t = retrying(
      { [MAP]: [{ status: 429, retryAfter: new Date(at.getTime() + 2000).toUTCString() }] },
      { now: at.getTime() },
    );
    expect((await t.fetchFn(MAP)).status).toBe(200);
    expect(t.waits).toEqual([2000]);
  });

  it('never answers sooner than the backoff, whatever a short Retry-After says', async () => {
    const t = retrying({ [MAP]: [{ status: 429, retryAfter: '0' }] });
    await t.fetchFn(MAP);
    expect(t.waits).toEqual([RETRY_DELAYS_MS[0]]);
  });

  it('gives up at once on a Retry-After longer than the cap (the player can retry later)', async () => {
    const t = retrying({
      [MAP]: [{ status: 429, retryAfter: String(RETRY_AFTER_CAP_MS / 1000 + 1) }],
    });
    const res = await t.fetchFn(MAP);
    expect(res.status).toBe(429);
    expect(t.asked).toHaveLength(1);
    expect(t.waits).toEqual([]);
  });

  // The control: answers that are not worth another try, and files that are not the build's.
  it('control: a 404 or 410 for a build file is not retried (the stale-build rule)', async () => {
    for (const status of [404, 410]) {
      const t = retrying({ [MAP]: [status] });
      expect((await t.fetchFn(MAP)).status).toBe(status);
      expect(t.asked).toHaveLength(1);
      expect(t.waits).toEqual([]);
    }
  });

  it('control: a 403 is not retried, and a success is asked for once', async () => {
    const t = retrying({ [MAP]: [403] });
    expect((await t.fetchFn(MAP)).status).toBe(403);
    expect(t.asked).toHaveLength(1);
    const ok = retrying({});
    expect((await ok.fetchFn(MAP)).status).toBe(200);
    expect(ok.asked).toHaveLength(1);
  });

  it('control: a file outside assets/ (the changelog, sw.js) and a non-GET are not retried', async () => {
    const other = `${SCOPE}sw.js`;
    const t = retrying({ [other]: [500], [MAP]: [500] });
    expect((await t.fetchFn(other)).status).toBe(500);
    expect((await t.fetchFn(MAP, { method: 'POST' })).status).toBe(500);
    expect((await t.fetchFn('https://elsewhere.example/assets/a.json')).status).toBe(200);
    expect(t.asked).toHaveLength(3);
    expect(t.waits).toEqual([]);
  });

  it('control: with the network off, or an aborted request, it does not wait and try again', async () => {
    const off = retrying({ [MAP]: ['network'] }, { online: false });
    await expect(off.fetchFn(MAP)).rejects.toThrow(/Failed to fetch/);
    expect(off.asked).toHaveLength(1);
    const ctl = new AbortController();
    ctl.abort();
    const aborted = retrying({ [MAP]: ['network'] });
    await expect(aborted.fetchFn(MAP, { signal: ctl.signal })).rejects.toThrow();
    expect(aborted.asked).toHaveLength(1);
  });

  it('reads relative addresses and Request objects the way the page does', async () => {
    const t = retrying({ [MAP]: [502] });
    expect((await t.fetchFn(new Request(MAP))).status).toBe(200);
    expect(t.asked).toHaveLength(2);
    const r = retrying({ [MAP]: [502] });
    expect((await r.fetchFn('assets/osm-sf-lombard-flats-C3eDycHy.json')).status).toBe(200);
  });
});

describe('with the stale-build watch', () => {
  it('a 404 reaches the stale-build watch at once, a 503 only after its retries', async () => {
    const host = scripted({ [MAP]: [404], [`${SCOPE}assets/b.json`]: [503, 503, 503, 503] });
    const win = { fetch: host.fetchFn };
    const waits: number[] = [];
    win.fetch = retryingFetch(host.fetchFn, {
      scope: SCOPE,
      online: () => true,
      now: () => 0,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    const answers: string[] = [];
    const page: StaleBuildPage = {
      win: new EventTarget(),
      scope: SCOPE,
      online: () => true,
      storage: null,
      reload: () => undefined,
      fetch: win.fetch,
      canReload: () => true,
    };
    const stale = recoverStaleBuild(page, 'abc1234');
    watchFetches(win, SCOPE, (url, status) => {
      answers.push(`${status} ${url}`);
      stale.answered(url, status);
    });
    await win.fetch(MAP);
    await win.fetch(`${SCOPE}assets/b.json`);
    await stale.idle();
    expect(answers).toEqual([`404 ${MAP}`, `503 ${SCOPE}assets/b.json`]);
    // The 404 went straight to the watch (no waits for it); the 503 was tried four times first.
    expect(host.asked.filter((u) => u === MAP)).toHaveLength(1);
    expect(host.asked.filter((u) => u.endsWith('b.json'))).toHaveLength(RETRY_DELAYS_MS.length + 1);
    expect(waits).toEqual([...RETRY_DELAYS_MS]);
  });
});

// Polish batch E's check, punch item 2: with "Retry in 30 s" on the card, a new pick or a Race tap
// asked the host for all 34 of San Francisco's map files at once (68 to 102 to 136 asks in 0.1 s):
// only the card's Retry honoured the wait. The wait is the loader's now: until the host's Retry-After
// has passed, a build file is not asked for. A wait under the cap is waited out; a longer one answers
// at once with the host's own 429 and the wait that is left, so the card counts the same wait down.
describe('retryingFetch: the host asked for a wait', () => {
  function clocked(script: Record<string, Step[]>) {
    const host = scripted(script);
    const clock = { now: 1_000_000 };
    const waits: number[] = [];
    const fetchFn = retryingFetch(host.fetchFn, {
      scope: SCOPE,
      online: () => true,
      now: () => clock.now,
      wait: (ms) => {
        waits.push(ms);
        clock.now += ms;
        return Promise.resolve();
      },
    });
    return { fetchFn, waits, asked: host.asked, clock };
  }
  const OTHER = `${SCOPE}assets/osm-sf-hills-run-D4fEzyHz.json`;

  it('asks the host nothing until a long wait has passed, and answers 429 with the wait that is left', async () => {
    const t = clocked({ [MAP]: [{ status: 429, retryAfter: '30' }] });
    expect((await t.fetchFn(MAP)).status).toBe(429);
    expect(t.asked).toHaveLength(1);
    // 10 s later: a new pick (another file) and a Race tap (the same file) ask nothing.
    t.clock.now += 10_000;
    for (const url of [OTHER, MAP]) {
      const res = await t.fetchFn(url);
      expect(res.status, url).toBe(429);
      expect(res.headers.get('Retry-After'), url).toBe('20');
    }
    expect(t.asked, 'nothing asked during the wait').toHaveLength(1);
    // After the wait the host is asked again.
    t.clock.now += 20_000;
    expect((await t.fetchFn(OTHER)).status).toBe(200);
    expect(t.asked).toEqual([MAP, OTHER]);
  });

  it('waits out a short wait before asking, whoever asks', async () => {
    const t = clocked({ [MAP]: [{ status: 429, retryAfter: '3' }] });
    expect((await t.fetchFn(MAP)).status).toBe(200);
    expect(t.waits).toEqual([3000]);
    // A wait left over from another file's answer is waited out before this one is asked.
    const u = clocked({ [MAP]: [{ status: 429, retryAfter: '30' }] });
    await u.fetchFn(MAP);
    u.clock.now += 25_000;
    expect((await u.fetchFn(OTHER)).status).toBe(200);
    expect(u.waits).toEqual([5000]);
    expect(u.asked).toEqual([MAP, OTHER]);
  });

  it('control: an answer with no Retry-After holds nothing back', async () => {
    const t = clocked({ [MAP]: [503, 503, 503, 503] });
    expect((await t.fetchFn(MAP)).status).toBe(503);
    expect((await t.fetchFn(OTHER)).status).toBe(200);
    expect(t.asked.filter((u) => u === OTHER)).toHaveLength(1);
    expect(t.waits).toEqual([...RETRY_DELAYS_MS]);
  });

  it('control: a file outside assets/ is never held back', async () => {
    const t = clocked({ [MAP]: [{ status: 429, retryAfter: '30' }] });
    await t.fetchFn(MAP);
    expect((await t.fetchFn(`${SCOPE}sw.js`)).status).toBe(200);
    expect(t.asked).toEqual([MAP, `${SCOPE}sw.js`]);
  });
});

// Polish batch F's check, punch item 5: picking San Francisco asked the host for its 34 map files at
// once, and the host answered some of them 429; #650 then paced every pick at FETCH_LANES. Polish
// batch O's check, punch item 1: that pacing made region data 2 to 3 times later (San Francisco's
// route chips 3,373 to 4,433 ms after the tap, against 1,450), and the real host gave 0 429s in 8
// picks with or without it. So the loader paces only once the host has asked: no cap until a 429 (or
// a 503 with a Retry-After), then FETCH_LANES at a time and the host's wait, easing back once
// PACE_QUIET_MS has passed with no such answer.
describe('retryingFetch: a region pick is paced only once the host asks', () => {
  const pick = (name: string) =>
    Array.from({ length: 34 }, (_, i) => `${SCOPE}assets/osm-${name}-file-${i}.json`);
  const FILES = pick('sf');
  /** Lets every promise the page has settle (no clock: the host answers when the test says). */
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  /**
   * A host whose answers wait until the test lets them through; it counts requests in flight. Each
   * entry of `answers` is the next answer given (a status, with a Retry-After when it is an object);
   * after them, 200.
   */
  function gated(answers: (number | { status: number; retryAfter: string })[] = []) {
    const clock = { now: 1_000_000 };
    const pending: (() => void)[] = [];
    const asked: { url: string; at: number; inFlight: number }[] = [];
    let inFlight = 0;
    const inner = ((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      inFlight++;
      asked.push({ url, at: clock.now, inFlight });
      return new Promise<Response>((resolve) => {
        pending.push(() => {
          inFlight--;
          const next = answers.shift() ?? 200;
          const status = typeof next === 'number' ? next : next.status;
          const headers: Record<string, string> =
            typeof next === 'object' ? { 'Retry-After': next.retryAfter } : {};
          resolve(new Response(status === 200 ? '{"ok":true}' : 'slow down', { status, headers }));
        });
      });
    }) as typeof fetch;
    const waits: number[] = [];
    const fetchFn = retryingFetch(inner, {
      scope: SCOPE,
      online: () => true,
      now: () => clock.now,
      wait: (ms) => {
        waits.push(ms);
        clock.now += ms;
        return Promise.resolve();
      },
    });
    /** Answers the oldest request in flight, then lets the page's promises settle. */
    const answerOne = async () => {
      pending.shift()?.();
      await settle();
    };
    const answerAll = async () => {
      while (pending.length) await answerOne();
    };
    return { fetchFn, asked, waits, clock, answerOne, answerAll, inFlight: () => inFlight };
  }

  it('a pick with no 429 asks for all its files at once (main paced it at FETCH_LANES)', async () => {
    const t = gated();
    const all = Promise.all(FILES.map((url) => t.fetchFn(url)));
    await settle();
    console.log(`[print] no 429: ${t.inFlight()} of ${FILES.length} files in flight at once`);
    // The negative control is main's loader, which held this at FETCH_LANES (4).
    expect(t.inFlight()).toBe(FILES.length);
    await t.answerAll();
    expect((await all).map((r) => r.status)).toEqual(FILES.map(() => 200));
    expect(t.asked).toHaveLength(FILES.length);
  });

  it("a 429 brings the host's wait, then the pacing, for the files still to ask", async () => {
    const t = gated([{ status: 429, retryAfter: '2' }]);
    const first = Promise.all(FILES.map((url) => t.fetchFn(url)));
    await settle();
    expect(t.inFlight()).toBe(FILES.length);
    const before = t.clock.now;
    // The first answer is the host's 429 with Retry-After: 2.
    await t.answerOne();
    // Another pick just after it: nothing of it is asked inside the wait, then FETCH_LANES at a time.
    const PNW = pick('pnw');
    const second = Promise.all(PNW.map((url) => t.fetchFn(url)));
    await settle();
    await t.answerAll();
    expect((await first).map((r) => r.status)).toEqual(FILES.map(() => 200));
    expect((await second).map((r) => r.status)).toEqual(PNW.map(() => 200));
    const inside = t.asked.filter((a) => a.at < before + 2000);
    const later = t.asked.filter((a) => a.at >= before + 2000);
    const mostLater = Math.max(...later.map((a) => a.inFlight));
    console.log(
      `[print] 429 path: ${t.asked.length} asks; ${inside.length} before the wait had passed (the first pick, already out); first wait ${t.waits[0]} ms; after it, at most ${mostLater} in flight`,
    );
    expect(inside.map((a) => a.url)).toEqual(FILES);
    expect(t.waits[0]).toBe(2000);
    // The 429'd file again, and the whole second pick, after the wait, paced.
    expect(later.map((a) => a.url).sort()).toEqual([FILES[0], ...PNW].sort());
    expect(mostLater).toBeLessThanOrEqual(FETCH_LANES);
  });

  it('eases back once PACE_QUIET_MS has passed with no 429: the next pick goes at once again', async () => {
    expect(PACE_QUIET_MS).toBeGreaterThan(0);
    const t = gated([429]);
    const first = Promise.all(FILES.map((url) => t.fetchFn(url)));
    await settle();
    await t.answerAll();
    await first;
    // Inside the quiet spell, still paced.
    const PNW = pick('pnw');
    const second = Promise.all(PNW.map((url) => t.fetchFn(url)));
    await settle();
    expect(t.inFlight()).toBe(FETCH_LANES);
    await t.answerAll();
    await second;
    // After it, no cap.
    t.clock.now += PACE_QUIET_MS;
    const KEYS = pick('keys');
    const third = Promise.all(KEYS.map((url) => t.fetchFn(url)));
    await settle();
    expect(t.inFlight()).toBe(KEYS.length);
    await t.answerAll();
    expect((await third).map((r) => r.status)).toEqual(KEYS.map(() => 200));
  });

  it('a 503 with a Retry-After brings the pacing too; a 503 or 500 without one does not', async () => {
    for (const [answer, paced] of [
      [{ status: 503, retryAfter: '0' }, true],
      [503, false],
      [500, false],
    ] as const) {
      const t = gated([answer]);
      const first = Promise.all(FILES.map((url) => t.fetchFn(url)));
      await settle();
      await t.answerAll();
      await first;
      const PNW = pick('pnw');
      const second = Promise.all(PNW.map((url) => t.fetchFn(url)));
      await settle();
      expect(t.inFlight(), JSON.stringify(answer)).toBe(paced ? FETCH_LANES : PNW.length);
      await t.answerAll();
      await second;
    }
  });

  it('control: a file outside assets/ is never queued behind paced files', async () => {
    const t = gated([429]);
    const first = Promise.all(FILES.map((url) => t.fetchFn(url)));
    await settle();
    await t.answerAll();
    await first;
    const files = Promise.all(pick('pnw').map((url) => t.fetchFn(url)));
    await settle();
    void t.fetchFn(`${SCOPE}sw.js`);
    expect(t.inFlight()).toBe(FETCH_LANES + 1);
    await t.answerAll();
    await files;
  });
});
