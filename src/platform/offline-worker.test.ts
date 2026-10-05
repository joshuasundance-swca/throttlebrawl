import { describe, expect, it } from 'vitest';
import {
  CACHE_PREFIX,
  createOfflineWorker,
  NETWORK_TIMEOUT_MS,
  type OfflineCache,
  type OfflineCaches,
  type OfflineEnv,
  type WorkerRequest,
} from './offline-worker';

// The offline service worker's policy (docs/architecture.md, "Asset manifest"; docs/engineering.md,
// "Deploy", Offline): after the first load the whole build is cached, so a loaded game plays with
// the network off; a deploy never serves the previous build's page while the network answers;
// content-hashed files are cache-first and cross over from the last build's cache instead of being
// downloaded again; and nothing outside the game's own folder is touched. The browser half (the
// game loads and races with the network off) is tests/e2e/app-offline.spec.ts.

const SCOPE = 'https://game.example/sub/';

/** An in-memory CacheStorage keyed by URL, as the worker uses it. */
function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const cacheOf = (name: string): OfflineCache => {
    let store = stores.get(name);
    if (!store) stores.set(name, (store = new Map<string, Response>()));
    const s = store;
    return {
      match: (key) => Promise.resolve(s.get(key)?.clone()),
      put: (key, res) => {
        s.set(key, res);
        return Promise.resolve();
      },
    };
  };
  const caches: OfflineCaches = {
    open: (name) => Promise.resolve(cacheOf(name)),
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name) => Promise.resolve(stores.delete(name)),
    match: (key) => {
      for (const s of stores.values()) {
        const hit = s.get(key);
        if (hit) return Promise.resolve(hit.clone());
      }
      return Promise.resolve(undefined);
    },
  };
  return { caches, stores };
}

interface NetOptions {
  /** URLs the network fails (offline, or a dropped connection). */
  down?: (url: string) => boolean;
  /** URLs whose answer never comes until the test releases it. */
  hang?: (url: string) => boolean;
}

/** A network serving `body of <url>`, recording every URL it was asked for. */
function network(opts: NetOptions = {}) {
  const asked: string[] = [];
  const hung: (() => void)[] = [];
  const fetchFn = (req: WorkerRequest | string) => {
    const url = typeof req === 'string' ? req : req.url;
    asked.push(url);
    const answer = () =>
      opts.down?.(url)
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response(`body of ${url}`, { status: 200 }));
    if (opts.hang?.(url))
      return new Promise<Response>((resolve, reject) => hung.push(() => void answer().then(resolve, reject)));
    return answer();
  };
  return { fetchFn, asked, release: () => hung.splice(0).forEach((f) => f()) };
}

/** A timer the test fires by hand: no test waits on the clock. */
function manualDelay() {
  const timers: { ms: number; fire: () => void }[] = [];
  const delay = (ms: number) => new Promise<void>((resolve) => timers.push({ ms, fire: resolve }));
  return { delay, timers, fireAll: () => timers.splice(0).forEach((t) => t.fire()) };
}

function setup(
  files: string[],
  cacheName: string,
  net: ReturnType<typeof network>,
  shared?: ReturnType<typeof memoryCaches>,
) {
  const mem = shared ?? memoryCaches();
  const timer = manualDelay();
  const env: OfflineEnv = { scope: SCOPE, caches: mem.caches, fetch: net.fetchFn, delay: timer.delay };
  return { worker: createOfflineWorker(env, { cache: cacheName, files }), mem, timer };
}

const get = (path: string, mode = 'cors'): WorkerRequest => ({
  url: new URL(path, SCOPE).href,
  method: 'GET',
  mode,
});
const text = async (r: Promise<Response> | null) => (r ? (await r).text() : null);
/** Lets every pending promise step run (no clock involved). */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const BUILD = [
  'index.html',
  'manifest.webmanifest',
  'icon-192.png',
  'assets/index-AAA.js',
  'assets/ds/keys/clip-1234abcd.opus',
];

describe('the offline worker', () => {
  it('caches every file of the build at install, so each one is served with the network off', async () => {
    const online = network();
    const { worker, mem } = setup(BUILD, `${CACHE_PREFIX}b1`, online);
    await worker.install();
    expect(mem.stores.get(`${CACHE_PREFIX}b1`)?.size).toBe(BUILD.length);

    // The same caches, the network gone.
    const offline = network({ down: () => true });
    const { worker: off } = setup(BUILD, `${CACHE_PREFIX}b1`, offline, mem);
    for (const f of BUILD.filter((f) => f !== 'index.html'))
      expect(await text(off.respond(get(f))), f).toBe(`body of ${SCOPE}${f}`);
    // A launch with the network off opens the cached page, whatever address it was opened at.
    for (const page of ['', 'index.html', 'index.html?debug=1'])
      expect(await text(off.respond(get(page, 'navigate'))), page).toBe(`body of ${SCOPE}index.html`);
  });

  it('fails the install when the page itself does not cache, and survives any other file failing', async () => {
    const pageDown = setup(BUILD, `${CACHE_PREFIX}b1`, network({ down: (u) => u.endsWith('index.html') }));
    await expect(pageDown.worker.install()).rejects.toThrow(/index\.html/);

    const clipDown = setup(BUILD, `${CACHE_PREFIX}b1`, network({ down: (u) => u.endsWith('.opus') }));
    await clipDown.worker.install();
    expect(clipDown.mem.stores.get(`${CACHE_PREFIX}b1`)?.size).toBe(BUILD.length - 1);
  });

  it("takes the last build's content-hashed files from its cache and downloads only the new ones", async () => {
    const first = network();
    const { mem } = setup(BUILD, `${CACHE_PREFIX}b1`, first);
    await setup(BUILD, `${CACHE_PREFIX}b1`, first, mem).worker.install();

    const next = [
      'index.html',
      'manifest.webmanifest',
      'icon-192.png',
      'assets/index-BBB.js',
      'assets/ds/keys/clip-1234abcd.opus',
    ];
    const second = network();
    await setup(next, `${CACHE_PREFIX}b2`, second, mem).worker.install();
    // Hashed names never change bytes, so the clip crosses over; the new script and every file
    // without a content hash in its name (the page, the manifest, the icon) come from the network.
    expect(second.asked.map((u) => u.slice(SCOPE.length)).sort()).toEqual(
      ['assets/index-BBB.js', 'icon-192.png', 'index.html', 'manifest.webmanifest'].sort(),
    );
    expect(mem.stores.get(`${CACHE_PREFIX}b2`)?.size).toBe(next.length);
  });

  it("drops older builds' caches on activate and leaves caches it does not own alone", async () => {
    const net = network();
    const mem = memoryCaches();
    await mem.caches.open(`${CACHE_PREFIX}old`);
    await mem.caches.open('someone-elses');
    const { worker } = setup(BUILD, `${CACHE_PREFIX}new`, net, mem);
    await worker.install();
    await worker.activate();
    expect((await mem.caches.keys()).sort()).toEqual([`${CACHE_PREFIX}new`, 'someone-elses']);
  });

  it('asks the network first for the page, so a deploy is played at once, and keeps the answer for later', async () => {
    const mem = memoryCaches();
    await setup(BUILD, `${CACHE_PREFIX}b1`, network(), mem).worker.install();
    const net = network();
    const { worker } = setup(BUILD, `${CACHE_PREFIX}b1`, net, mem);
    net.asked.length = 0;
    const page = worker.respond(get('index.html', 'navigate'));
    expect(await text(page)).toBe(`body of ${SCOPE}index.html`);
    expect(net.asked).toEqual([`${SCOPE}index.html`]);
    // The changelog and the manifest are network-first too (the what's-new card reads the newest).
    for (const f of ['changelog.json', 'manifest.webmanifest']) {
      net.asked.length = 0;
      await text(worker.respond(get(f)));
      expect(net.asked, f).toEqual([`${SCOPE}${f}`]);
    }
    // ...and the changelog, never precached, is there with the network off afterwards.
    const { worker: off } = setup(BUILD, `${CACHE_PREFIX}b1`, network({ down: () => true }), mem);
    expect(await text(off.respond(get('changelog.json')))).toBe(`body of ${SCOPE}changelog.json`);
  });

  it(`opens the cached page after ${NETWORK_TIMEOUT_MS} ms on a network that does not answer`, async () => {
    const mem = memoryCaches();
    await setup(BUILD, `${CACHE_PREFIX}b1`, network(), mem).worker.install();
    const slow = network({ hang: () => true });
    const { worker, timer } = setup(BUILD, `${CACHE_PREFIX}b1`, slow, mem);
    let settled = false;
    const page = worker.respond(get('', 'navigate'));
    void page?.then(() => (settled = true));
    await flush();
    expect(settled, 'still waiting on the network before the timeout').toBe(false);
    expect(timer.timers.map((t) => t.ms)).toEqual([NETWORK_TIMEOUT_MS]);
    timer.fireAll();
    expect(await text(page)).toBe(`body of ${SCOPE}index.html`);
  });

  it('serves content-hashed files from the cache without asking the network', async () => {
    const mem = memoryCaches();
    await setup(BUILD, `${CACHE_PREFIX}b1`, network(), mem).worker.install();
    const net = network();
    const { worker } = setup(BUILD, `${CACHE_PREFIX}b1`, net, mem);
    expect(await text(worker.respond(get('assets/index-AAA.js')))).toBe(
      `body of ${SCOPE}assets/index-AAA.js`,
    );
    expect(net.asked).toEqual([]);
    // A file the install missed is fetched once, then kept.
    await text(worker.respond(get('assets/late-CCC.json')));
    await text(worker.respond(get('assets/late-CCC.json')));
    expect(net.asked).toEqual([`${SCOPE}assets/late-CCC.json`]);
  });

  it('leaves other sites, other folders and anything but a GET to the browser', () => {
    const { worker } = setup(BUILD, `${CACHE_PREFIX}b1`, network());
    expect(
      worker.respond({
        url: 'https://huggingface.co/datasets/x/resolve/main/a.glb',
        method: 'GET',
        mode: 'cors',
      }),
    ).toBeNull();
    expect(
      worker.respond({ url: 'https://game.example/other/index.html', method: 'GET', mode: 'navigate' }),
    ).toBeNull();
    expect(worker.respond({ ...get('assets/index-AAA.js'), method: 'POST' })).toBeNull();
  });
});
