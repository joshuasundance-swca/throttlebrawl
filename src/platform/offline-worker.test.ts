import { describe, expect, it } from 'vitest';
import {
  CACHE_PREFIX,
  createOfflineWorker,
  NETWORK_TIMEOUT_MS,
  type FileCheck,
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
//
// Each build's install is all or nothing and holds only that build's files (playtest 4 run A's live
// check, mustFix 2: a deploy that landed during a tab's install left 650 of 668 files cached, and
// offline the landmark chunk failed). A file that fails, or a file without a content hash in its
// name whose bytes are not this build's, fails the install: the browser keeps the last worker, and
// this build's half-filled cache is dropped.

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

/** The test build's page: it loads its own entry script, as Vite's index.html does. */
const PAGE_BODY = '<!doctype html><script type="module" crossorigin src="./assets/index-AAA.js"></script>';
/** What the test network answers for a URL. */
const bodyOf = (url: string) => (url === `${SCOPE}index.html` ? PAGE_BODY : `body of ${url}`);

/** A network serving `body of <url>` (the page for index.html), recording every URL it was asked for. */
function network(opts: NetOptions = {}) {
  const asked: string[] = [];
  const hung: (() => void)[] = [];
  const fetchFn = (req: WorkerRequest | string) => {
    const url = typeof req === 'string' ? req : req.url;
    asked.push(url);
    const answer = () =>
      opts.down?.(url)
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response(bodyOf(url), { status: 200 }));
    if (opts.hang?.(url))
      return new Promise<Response>((resolve, reject) => hung.push(() => void answer().then(resolve, reject)));
    return answer();
  };
  return { fetchFn, asked, release: () => hung.splice(0).forEach((f) => f()) };
}

/**
 * A static host serving one build at a time, as the game Space does: each deploy replaces every
 * file, so a file only the older build had answers 404. `deployAfter(n, next)` lands a deploy just
 * after the host has answered its n-th request (a merge landing during a tab's install).
 */
function host(first: Record<string, string>) {
  let site = first;
  const asked: string[] = [];
  let pending: { after: number; next: Record<string, string> } | null = null;
  const fetchFn = (req: WorkerRequest | string) => {
    const url = typeof req === 'string' ? req : req.url;
    asked.push(url);
    // The folder's own address answers with its page, as a static host's does.
    const body = site[url.slice(SCOPE.length).split(/[?#]/)[0] || 'index.html'];
    if (pending && asked.length >= pending.after) {
      site = pending.next;
      pending = null;
    }
    return Promise.resolve(
      body === undefined ? new Response('Not Found', { status: 404 }) : new Response(body, { status: 200 }),
    );
  };
  return {
    fetchFn,
    asked,
    deploy: (next: Record<string, string>) => void (site = next),
    deployAfter: (after: number, next: Record<string, string>) => void (pending = { after, next }),
  };
}

/** A timer the test fires by hand: no test waits on the clock. */
function manualDelay() {
  const timers: { ms: number; fire: () => void }[] = [];
  const delay = (ms: number) => new Promise<void>((resolve) => timers.push({ ms, fire: resolve }));
  return { delay, timers, fireAll: () => timers.splice(0).forEach((t) => t.fire()) };
}

/** The page's check: the entry script it loads (scripts/service-worker.mjs makes the real one). */
const entryOf = (html: string) => /<script\b[^>]*\bsrc="(?:\.\/)?([^"]+)"/.exec(html)?.[1] ?? '<none>';
async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The build step's checks for the files without a content hash in their name, from the bytes `body`
 * gives each: a page must contain its entry script, any other file must match its SHA-256.
 */
async function checksOf(files: readonly string[], body: (rel: string) => string) {
  const checks: Record<string, FileCheck> = {};
  for (const rel of files.filter((f) => !f.startsWith('assets/')))
    checks[rel] = rel.endsWith('.html')
      ? { contains: entryOf(body(rel)) }
      : { sha256: await sha256(body(rel)) };
  return checks;
}

async function setup(
  files: string[],
  cacheName: string,
  net: { fetchFn: OfflineEnv['fetch'] },
  shared?: ReturnType<typeof memoryCaches>,
  given?: Record<string, FileCheck>,
) {
  const checks = given ?? (await checksOf(files, (rel) => bodyOf(`${SCOPE}${rel}`)));
  const mem = shared ?? memoryCaches();
  const timer = manualDelay();
  const env: OfflineEnv = { scope: SCOPE, caches: mem.caches, fetch: net.fetchFn, delay: timer.delay };
  return { worker: createOfflineWorker(env, { cache: cacheName, files, checks }), mem, timer };
}

/** A build as the host holds it: its page preloads a road file and loads its own entry script. */
function siteBuild(entry: string, extra: Record<string, string>): Record<string, string> {
  return {
    'index.html':
      '<!doctype html><html><head>' +
      '<link rel="preload" as="fetch" crossorigin href="./assets/road-R1.json">\n' +
      '<link rel="modulepreload" crossorigin href="./assets/sim-S1.js">' +
      `<script type="module" crossorigin src="./${entry}"></script></head><body></body></html>`,
    'manifest.webmanifest': '{"name":"throttlebrawl"}',
    'icon-192.png': 'png bytes',
    [entry]: `entry ${entry}`,
    'assets/sim-S1.js': 'sim',
    'assets/road-R1.json': '{"road":1}',
    ...extra,
  };
}
const kits = (id: string) =>
  Object.fromEntries(['a', 'b', 'c', 'd'].map((k) => [`assets/kit-${k}-${id}.js`, `kit ${k}`]));
const BUILD_X = siteBuild('assets/index-XXX.js', {
  'assets/landmarks-XXX.js': 'x landmarks',
  ...kits('XXX'),
});
// A docs-only deploy: no game code changed, but the build id in the entry renames the lazy chunks.
const BUILD_Y = siteBuild('assets/index-YYY.js', {
  'assets/landmarks-YYY.js': 'y landmarks',
  ...kits('YYY'),
});
const filesOf = (build: Record<string, string>) => Object.keys(build).sort();
/** A worker for `build`, on `net`, with the checks its build step would hand it. */
const workerFor = (
  build: Record<string, string>,
  cacheName: string,
  net: { fetchFn: OfflineEnv['fetch'] },
  shared?: ReturnType<typeof memoryCaches>,
) =>
  checksOf(filesOf(build), (rel) => build[rel] ?? '').then((c) =>
    setup(filesOf(build), cacheName, net, shared, c),
  );

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
/** What one cache holds: each key relative to the scope, with its body. */
async function contents(mem: ReturnType<typeof memoryCaches>, name: string) {
  const out: Record<string, string> = {};
  for (const [key, res] of mem.stores.get(name) ?? [])
    out[key.slice(SCOPE.length)] = await res.clone().text();
  return out;
}

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
    const { worker, mem } = await setup(BUILD, `${CACHE_PREFIX}b1`, online);
    await worker.install();
    expect(mem.stores.get(`${CACHE_PREFIX}b1`)?.size).toBe(BUILD.length);

    // The same caches, the network gone.
    const offline = network({ down: () => true });
    const { worker: off } = await setup(BUILD, `${CACHE_PREFIX}b1`, offline, mem);
    for (const f of BUILD.filter((f) => f !== 'index.html'))
      expect(await text(off.respond(get(f))), f).toBe(`body of ${SCOPE}${f}`);
    // A launch with the network off opens the cached page, whatever address it was opened at.
    for (const page of ['', 'index.html', 'index.html?debug=1'])
      expect(await text(off.respond(get(page, 'navigate'))), page).toBe(PAGE_BODY);
  });

  it('fails the whole install when any file does not cache, and leaves no half-filled cache', async () => {
    const pageDown = await setup(
      BUILD,
      `${CACHE_PREFIX}b1`,
      network({ down: (u) => u.endsWith('index.html') }),
    );
    await expect(pageDown.worker.install()).rejects.toThrow(/index\.html/);
    expect(pageDown.mem.stores.has(`${CACHE_PREFIX}b1`)).toBe(false);

    const clipDown = await setup(BUILD, `${CACHE_PREFIX}b1`, network({ down: (u) => u.endsWith('.opus') }));
    await expect(clipDown.worker.install()).rejects.toThrow(/clip-1234abcd\.opus/);
    expect(clipDown.mem.stores.has(`${CACHE_PREFIX}b1`)).toBe(false);
  });

  it('tries a dropped connection once more before it fails the install', async () => {
    let drops = 1;
    const flaky = network({ down: (u) => u.endsWith('.opus') && drops-- > 0 });
    const { worker, mem } = await setup(BUILD, `${CACHE_PREFIX}b1`, flaky);
    await worker.install();
    expect(mem.stores.get(`${CACHE_PREFIX}b1`)?.size).toBe(BUILD.length);
    expect(flaky.asked.filter((u) => u.endsWith('.opus'))).toHaveLength(2);
  });

  it("takes the last build's content-hashed files from its cache and downloads only the new ones", async () => {
    const first = network();
    const { mem } = await setup(BUILD, `${CACHE_PREFIX}b1`, first);
    await (await setup(BUILD, `${CACHE_PREFIX}b1`, first, mem)).worker.install();

    const next = [
      'index.html',
      'manifest.webmanifest',
      'icon-192.png',
      'assets/index-BBB.js',
      'assets/ds/keys/clip-1234abcd.opus',
    ];
    const second = network();
    await (await setup(next, `${CACHE_PREFIX}b2`, second, mem)).worker.install();
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
    const { worker } = await setup(BUILD, `${CACHE_PREFIX}new`, net, mem);
    await worker.install();
    await worker.activate();
    expect((await mem.caches.keys()).sort()).toEqual([`${CACHE_PREFIX}new`, 'someone-elses']);
  });

  it('asks the network first for the page, so a deploy is played at once, and keeps the changelog for later', async () => {
    const mem = memoryCaches();
    await (await setup(BUILD, `${CACHE_PREFIX}b1`, network(), mem)).worker.install();
    const net = network();
    const { worker } = await setup(BUILD, `${CACHE_PREFIX}b1`, net, mem);
    net.asked.length = 0;
    const page = worker.respond(get('index.html', 'navigate'));
    expect(await text(page)).toBe(PAGE_BODY);
    expect(net.asked).toEqual([`${SCOPE}index.html`]);
    // The changelog and the manifest are network-first too (the what's-new card reads the newest).
    for (const f of ['changelog.json', 'manifest.webmanifest']) {
      net.asked.length = 0;
      await text(worker.respond(get(f)));
      expect(net.asked, f).toEqual([`${SCOPE}${f}`]);
    }
    // ...and the changelog, written after the build and never precached, is there with the network
    // off afterwards.
    const { worker: off } = await setup(BUILD, `${CACHE_PREFIX}b1`, network({ down: () => true }), mem);
    expect(await text(off.respond(get('changelog.json')))).toBe(`body of ${SCOPE}changelog.json`);
  });

  it(`opens the cached page after ${NETWORK_TIMEOUT_MS} ms on a network that does not answer`, async () => {
    const mem = memoryCaches();
    await (await setup(BUILD, `${CACHE_PREFIX}b1`, network(), mem)).worker.install();
    const slow = network({ hang: () => true });
    const { worker, timer } = await setup(BUILD, `${CACHE_PREFIX}b1`, slow, mem);
    let settled = false;
    const page = worker.respond(get('', 'navigate'));
    void page?.then(() => (settled = true));
    await flush();
    expect(settled, 'still waiting on the network before the timeout').toBe(false);
    expect(timer.timers.map((t) => t.ms)).toEqual([NETWORK_TIMEOUT_MS]);
    timer.fireAll();
    expect(await text(page)).toBe(PAGE_BODY);
  });

  it('serves content-hashed files from the cache without asking the network', async () => {
    const mem = memoryCaches();
    await (await setup(BUILD, `${CACHE_PREFIX}b1`, network(), mem)).worker.install();
    const net = network();
    const { worker } = await setup(BUILD, `${CACHE_PREFIX}b1`, net, mem);
    expect(await text(worker.respond(get('assets/index-AAA.js')))).toBe(
      `body of ${SCOPE}assets/index-AAA.js`,
    );
    expect(net.asked).toEqual([]);
    // A file that is not this build's (a newer page's chunk) is passed on from the network, never
    // kept in this build's cache.
    expect(await text(worker.respond(get('assets/late-CCC.json')))).toBe(
      `body of ${SCOPE}assets/late-CCC.json`,
    );
    await text(worker.respond(get('assets/late-CCC.json')));
    expect(net.asked).toEqual([`${SCOPE}assets/late-CCC.json`, `${SCOPE}assets/late-CCC.json`]);
    expect(mem.stores.get(`${CACHE_PREFIX}b1`)?.size).toBe(BUILD.length);
  });

  it('leaves other sites, other folders and anything but a GET to the browser', async () => {
    const { worker } = await setup(BUILD, `${CACHE_PREFIX}b1`, network());
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

describe('a deploy during the install (playtest 4 run A, mustFix 2)', () => {
  it("fails build X's install when a deploy lands part way, and leaves no partial cache", async () => {
    // Control: with no deploy in its window, the same install caches all of build X.
    const calm = await workerFor(BUILD_X, `${CACHE_PREFIX}x`, host(BUILD_X));
    await calm.worker.install();
    expect(await contents(calm.mem, `${CACHE_PREFIX}x`)).toEqual(
      Object.fromEntries(filesOf(BUILD_X).map((rel) => [rel, BUILD_X[rel]])),
    );

    // The deploy lands after the host has answered 3 of the install's requests: X's renamed chunks
    // now 404, and the page the host answers is Y's.
    const mem = memoryCaches();
    await mem.caches.open(`${CACHE_PREFIX}w`); // the last worker's cache, still in charge
    const site = host(BUILD_X);
    site.deployAfter(3, BUILD_Y);
    const { worker } = await workerFor(BUILD_X, `${CACHE_PREFIX}x`, site, mem);
    await expect(worker.install()).rejects.toThrow(/not installed/);
    // No hole-filled cache, so X's worker never takes the page, and the last worker's cache stays.
    expect([...mem.stores.keys()]).toEqual([`${CACHE_PREFIX}w`]);

    // The next launch registers Y's worker (the host now serves Y's sw.js): it caches all of Y.
    const next = await workerFor(BUILD_Y, `${CACHE_PREFIX}y`, site, mem);
    await next.worker.install();
    expect(await contents(mem, `${CACHE_PREFIX}y`)).toEqual(
      Object.fromEntries(filesOf(BUILD_Y).map((rel) => [rel, BUILD_Y[rel]])),
    );
  });

  it("never caches another build's page or manifest, even when every hashed file still answers", async () => {
    // The page is Y's (its entry is Y's), the hashed files are all X's: still not build X.
    const pageY = { ...BUILD_X, 'index.html': BUILD_Y['index.html'] ?? '' };
    const a = await workerFor(BUILD_X, `${CACHE_PREFIX}x`, host(pageY));
    await expect(a.worker.install()).rejects.toThrow(/index\.html/);
    expect(a.mem.stores.has(`${CACHE_PREFIX}x`)).toBe(false);

    const manifestY = { ...BUILD_X, 'manifest.webmanifest': '{"name":"throttlebrawl","v":2}' };
    const b = await workerFor(BUILD_X, `${CACHE_PREFIX}x`, host(manifestY));
    await expect(b.worker.install()).rejects.toThrow(/manifest\.webmanifest/);
  });

  it('accepts the page the host serves with its own script added (the game Space does)', async () => {
    const page = BUILD_X['index.html'] ?? '';
    const served = page.replace(
      '<head>',
      '<head><script>window.huggingface={variables:{"SPACE_CREATOR_USER_ID":"0"}};</script>',
    );
    const { worker, mem } = await workerFor(
      BUILD_X,
      `${CACHE_PREFIX}x`,
      host({ ...BUILD_X, 'index.html': served }),
    );
    await worker.install();
    expect((await contents(mem, `${CACHE_PREFIX}x`))['index.html']).toBe(served);
  });

  it("keeps build X's cache build X's while a newer build is played online", async () => {
    const mem = memoryCaches();
    const site = host(BUILD_X);
    const { worker } = await workerFor(BUILD_X, `${CACHE_PREFIX}x`, site, mem);
    await worker.install();
    await worker.activate();
    site.deploy(BUILD_Y);

    // Online, a launch plays the newest build, its chunks passed on from the network.
    expect(await text(worker.respond(get('', 'navigate')))).toContain('assets/index-YYY.js');
    expect(await text(worker.respond(get('assets/landmarks-YYY.js')))).toBe('y landmarks');
    await text(worker.respond(get('manifest.webmanifest')));
    // ...and X's cache still holds exactly build X, so an offline launch opens X with every chunk.
    expect(await contents(mem, `${CACHE_PREFIX}x`)).toEqual(
      Object.fromEntries(filesOf(BUILD_X).map((rel) => [rel, BUILD_X[rel]])),
    );
  });
});

describe('the page the worker serves', () => {
  it('leaves out the preload hints, which the browser cannot use from a worker, and caches the page as served', async () => {
    const mem = memoryCaches();
    const site = host(BUILD_X);
    await (await workerFor(BUILD_X, `${CACHE_PREFIX}x`, site, mem)).worker.install();
    for (const online of [true, false]) {
      const net = online ? site : network({ down: () => true });
      const { worker } = await workerFor(BUILD_X, `${CACHE_PREFIX}x`, net, mem);
      const page = (await text(worker.respond(get('', 'navigate')))) ?? '';
      // Chrome refuses a `rel=preload` answered by a service worker ("cross-world service worker
      // resource mismatch") and fetches the file again: a wasted request and 5 warnings each.
      expect(page, `online ${online}`).not.toContain('rel="preload"');
      expect(page, `online ${online}`).toContain(
        '<link rel="modulepreload" crossorigin href="./assets/sim-S1.js">',
      );
      expect(page, `online ${online}`).toContain(
        '<script type="module" crossorigin src="./assets/index-XXX.js">',
      );
    }
    // The cached page is the host's, byte for byte.
    expect((await contents(mem, `${CACHE_PREFIX}x`))['index.html']).toBe(BUILD_X['index.html']);
    // Negative control: the host's own page has the hint.
    expect(BUILD_X['index.html']).toContain(
      '<link rel="preload" as="fetch" crossorigin href="./assets/road-R1.json">',
    );
  });
});
