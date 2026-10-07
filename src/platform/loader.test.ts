import { describe, expect, it } from 'vitest';
import { FETCH_LANES, loaderFetch, useLoader, type LoaderEnv } from './index';
import { readsOfflineCaches } from './page-cache';
import { retryingFetch } from './retry-fetch';

// The page's loader for build files: the offline caches' read (page-cache.ts) around the retry and
// its pacing (retry-fetch.ts). The clock is a number the test sets: the times below are polish batch
// O's live check's, in ms from navigation, as labels; nothing waits on real time.

const SCOPE = 'https://game.example/sub/';
const file = (name: string) => `${SCOPE}assets/${name}`;
/** Lets every promise the page has settle. */
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

/** A host whose answers wait for the test, a cache the install fills, and the loader's env. */
function world(answers: (number | { status: number; retryAfter: string })[] = []) {
  const clock = { now: 0 };
  const pending: (() => void)[] = [];
  const asked: string[] = [];
  let inFlight = 0;
  const network = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    inFlight++;
    return new Promise<Response>((resolve) => {
      pending.push(() => {
        inFlight--;
        const next = answers.shift() ?? 200;
        const status = typeof next === 'number' ? next : next.status;
        const headers: Record<string, string> =
          typeof next === 'object' ? { 'Retry-After': next.retryAfter } : {};
        resolve(new Response(status === 200 ? `network: ${url}` : 'slow down', { status, headers }));
      });
    });
  }) as typeof fetch;
  const cache = new Map<string, string>();
  const looked: string[] = [];
  const env = {
    scope: SCOPE,
    online: () => true,
    now: () => clock.now,
    wait: (ms) => {
      clock.now += ms;
      return Promise.resolve();
    },
    controlled: () => false,
    match: (url) => {
      looked.push(url);
      const body = cache.get(url);
      return Promise.resolve(body === undefined ? undefined : new Response(body));
    },
  } satisfies LoaderEnv;
  const answerOne = async () => {
    pending.shift()?.();
    await settle();
  };
  const answerAll = async () => {
    while (pending.length) await answerOne();
  };
  return { clock, network, asked, cache, looked, env, answerOne, answerAll, inFlight: () => inFlight };
}

// Polish batch O's check, mustFix 2: #650's "each file once" still sent 1 or 2 models across the wire
// twice on every first visit (8,196 to 27,044 extra bytes; box-truck, cop-moto). The page read the
// cache at 3,544 ms (a miss), its request then waited for a lane, the install downloaded the model's
// gzip copy at 6,428 ms, and the page's own fetch went out at 6,804 ms. The loader reads the cache
// again once the request is about to go out.
describe('the loader: a model the install caches while the request waits for a lane', () => {
  const COP_MOTO = file('ds/cop-moto-Ab12Cd34.glb');
  const BUSY = Array.from({ length: FETCH_LANES + 1 }, (_, i) => file(`osm-sf-file-${i}.json`));

  /** The check's timing, through `fetchFn` (the page's fetch) over `w`'s network and cache. */
  async function firstVisit(w: ReturnType<typeof world>, fetchFn: typeof fetch) {
    // A region's files go out; the host answers the first 429, so the rest are paced.
    const region = Promise.all(BUSY.map((url) => fetchFn(url)));
    await settle();
    await w.answerOne();
    expect(w.inFlight()).toBe(FETCH_LANES);
    // 3,544 ms: the page asks for the model; the cache misses and the request waits for a lane.
    w.clock.now = 3544;
    const model = fetchFn(COP_MOTO);
    await settle();
    expect(w.asked).not.toContain(COP_MOTO);
    // 6,428 ms: the worker's install puts the model (from its gzip copy) in its cache.
    w.clock.now = 6428;
    w.cache.set(COP_MOTO, 'glTF from the install');
    // 6,804 ms: lanes come free; the model's request is about to go out.
    w.clock.now = 6804;
    await w.answerAll();
    await region;
    return (await model).text();
  }

  it('reads the cache again when its lane comes, and asks the network nothing for it', async () => {
    const w = world([429]);
    const body = await firstVisit(w, loaderFetch(w.network, w.env));
    console.log(
      `[print] cop-moto: cache read ${w.looked.filter((u) => u === COP_MOTO).length} times, network asked ${w.asked.filter((u) => u === COP_MOTO).length} times`,
    );
    expect(body).toBe('glTF from the install');
    expect(w.asked.filter((u) => u === COP_MOTO)).toHaveLength(0);
    expect(w.looked.filter((u) => u === COP_MOTO)).toHaveLength(2);
  });

  it("control: main's loader (one cache read, before the line) downloads it a second time", async () => {
    const w = world([429]);
    const mains = readsOfflineCaches(retryingFetch(w.network, w.env), w.env);
    const body = await firstVisit(w, mains);
    expect(body).toBe(`network: ${COP_MOTO}`);
    expect(w.asked.filter((u) => u === COP_MOTO)).toHaveLength(1);
  });

  it('a cache hit is answered at once, before any wait the host asked for', async () => {
    const w = world([{ status: 429, retryAfter: '30' }]);
    const fetchFn = loaderFetch(w.network, w.env);
    const first = fetchFn(BUSY[0] ?? '');
    await settle();
    await w.answerOne();
    expect((await first).status).toBe(429);
    w.cache.set(COP_MOTO, 'glTF from the install');
    expect(await (await fetchFn(COP_MOTO)).text()).toBe('glTF from the install');
    expect(w.asked).toEqual([BUSY[0]]);
  });
});

// Polish batch O's check, punch item 3: the boot's 37 Keys road files went out within 7 ms with none
// of the loader's rules (main.ts fetched them before startOffline wrapped window.fetch). The loader
// now wraps the page's fetch once, before boot fetches anything; startOffline's call finds it there.
describe("the loader: the boot's road files go through it", () => {
  const ROADS = Array.from({ length: 37 }, (_, i) => file(`keys-road-${i}-Zz9.json`));

  it('wraps the page fetch once: a 429 on a boot road file is waited out and tried again, and paces what follows', async () => {
    const w = world([{ status: 429, retryAfter: '2' }]);
    const win = { fetch: w.network };
    useLoader(win, w.env);
    const wrapped = win.fetch;
    w.cache.set(ROADS[36] ?? '', '{"cached":true}');
    const boot = Promise.all(ROADS.map((url) => win.fetch(url)));
    await settle();
    // No 429 yet: all but the cached one at once.
    expect(w.inFlight()).toBe(ROADS.length - 1);
    await w.answerAll();
    const statuses = (await boot).map((r) => r.status);
    expect(statuses).toEqual(ROADS.map(() => 200));
    // The 429'd file was asked again after the host's wait; the cached one never.
    expect(w.asked.filter((u) => u === ROADS[0])).toHaveLength(2);
    expect(w.asked).not.toContain(ROADS[36]);
    expect(w.clock.now).toBeGreaterThanOrEqual(2000);
    // startOffline's own call later leaves it as it is, so a region pick shares the boot's pacing.
    useLoader(win, w.env);
    expect(win.fetch).toBe(wrapped);
    const pick = Promise.all(Array.from({ length: 10 }, (_, i) => win.fetch(file(`osm-sf-file-${i}.json`))));
    await settle();
    expect(w.inFlight()).toBe(FETCH_LANES);
    await w.answerAll();
    await pick;
  });

  it("control: the page's own fetch (main's boot) hands the 429 straight to the caller", async () => {
    const w = world([{ status: 429, retryAfter: '2' }]);
    const win = { fetch: w.network };
    const boot = Promise.all(ROADS.map((url) => win.fetch(url)));
    await settle();
    await w.answerAll();
    expect((await boot).map((r) => r.status)).toContain(429);
    expect(w.asked).toHaveLength(ROADS.length);
  });
});
