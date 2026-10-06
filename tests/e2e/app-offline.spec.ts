import { createHash } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';

// Offline play and installing as an app (roadmap M5, launch polish; the maintainer: "Offline
// definitely preferable"). The rules: once the game has loaded, its worker has cached everything the
// page needed, so the game starts and races with the network off; and the menu's Install button
// shows only while the browser offers an install, with only its tap opening the prompt (it never
// nags). The worker's policy is unit-tested in src/platform/offline-worker.test.ts.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { snapshot(): { tick: number } | null; setBot(on: boolean): void; state(): string };
};

/** platform/stale-build.ts's STALE_BUILD_KEY: the build a tab reloaded from. */
const STALE_BUILD_KEY = 'throttlebrawl:stale-chunk-reload';
/** The tab's page loads, counted in its session (a reload keeps the session). */
const LOADS_KEY = 'e2e-offline-loads';
/** The worker file's cache name, which names its build (scripts/service-worker.mjs). */
const WORKER_CACHE = /"cache":"offline-([^"]+)-([0-9a-f]{12})"/;

/** Test mode, and a count of the tab's page loads. */
async function countLoads(page: Page) {
  await page.addInitScript((key) => {
    (window as TestWindow).__GAME_TEST__ = true;
    sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? '0') + 1));
  }, LOADS_KEY);
}
const loadsOf = (page: Page) => page.evaluate((key) => Number(sessionStorage.getItem(key)), LOADS_KEY);

/** The build the host's worker file names, read with the test's own request (no route). */
async function hostBuild(page: Page): Promise<string> {
  const text = await (await page.request.get('sw.js')).text();
  const id = WORKER_CACHE.exec(text)?.[1];
  if (!id) throw new Error('sw.js names no build');
  return id;
}

/** A host that has deployed another build: its worker file names it (the rest is this build's). */
async function workerOfAnotherBuild(route: Route) {
  const res = await route.fetch();
  const body = (await res.text()).replace(WORKER_CACHE, '"cache":"offline-d3pl0y0-$2"');
  await route.fulfill({ response: res, body });
}

/** The tab's worker caches: ours, and every same-origin file the page loaded that none holds. */
async function cacheOfLoadedFiles(page: Page) {
  return page.evaluate(async () => {
    const own = (await caches.keys()).filter((n) => n.startsWith('offline-'));
    const loaded = [
      ...new Set(
        performance
          .getEntriesByType('resource')
          .map((e) => e.name.split('#')[0] ?? '')
          .filter((u) => u.startsWith(location.origin)),
      ),
    ];
    const missing: string[] = [];
    for (const url of loaded) {
      // changelog.json is written after the build, so it is kept the first time the page reads it
      // through the worker, not cached up front; the worker file is never cached.
      if (url.endsWith('/changelog.json') || url.endsWith('/sw.js')) continue;
      if (!(await caches.match(url, { ignoreVary: true }))) missing.push(url);
    }
    // A negative control: the same lookup finds nothing for a file the build never had.
    const control = await caches.match(`${location.origin}/no-such-file.js`);
    return { own, checked: loaded.length, missing, control: control !== undefined };
  });
}

test.describe('offline', () => {
  // Every other spec blocks service workers (playwright.config.ts); this one needs the game's.
  test.use({ serviceWorkers: 'allow' });

  test('a loaded game starts and races with the network off', async ({ page, context }) => {
    test.setTimeout(240_000);
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(err.message));
    // Playtest 4 run A, punch item 11: once the worker had the page, Chrome logged 5 warnings for each
    // of the 37 preloaded files ("not used because it is a cross-world service worker resource
    // mismatch"). The worker's page leaves the preload hints out.
    const preloadWarnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning' && /preload/i.test(m.text())) preloadWarnings.push(m.text());
    });
    const preloadLinks = () => page.evaluate(() => document.querySelectorAll('link[rel="preload"]').length);
    await page.addInitScript(() => {
      (window as TestWindow).__GAME_TEST__ = true;
    });
    await page.goto('./');
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    // The control: the first load, before the worker, has the build's preload hints.
    const firstLoadPreloads = await preloadLinks();
    expect(firstLoadPreloads).toBeGreaterThan(0);

    // The worker caches the whole build, then takes the page.
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
      timeout: 120_000,
      polling: 250,
    });
    const cached = await cacheOfLoadedFiles(page);
    console.log(
      `[print] caches ${cached.own.join(', ')}; ${cached.checked} files the page loaded checked, ` +
        `${cached.missing.length} not cached`,
    );
    expect(cached.own).toHaveLength(1);
    expect(cached.checked).toBeGreaterThan(0);
    expect(cached.control).toBe(false);
    expect(cached.missing).toEqual([]);

    // Playtest 4 run B's live check, punch item 8: the game's host sends files uncompressed, so the
    // worker downloads each script's, JSON file's and model's gzip copy and unpacks it. The files the
    // page had not loaded came that way, and each unpacks to the plain file, byte for byte.
    const unpacked = await page.evaluate(async (mark) => {
      const own = (await caches.keys()).find((n) => n.startsWith('offline-'));
      const store = own ? await caches.open(own) : null;
      const out: { url: string; type: string }[] = [];
      for (const req of store ? await store.keys() : []) {
        const res = await store?.match(req);
        if (res?.headers.get(mark) === 'gzip')
          out.push({ url: req.url, type: res.headers.get('content-type') ?? '' });
      }
      return out;
    }, 'x-offline-from');
    const byExt = (ext: string) => unpacked.filter((u) => u.url.endsWith(ext));
    console.log(
      `[print] unpacked from gzip copies: ${byExt('.js').length} scripts, ${byExt('.json').length} JSON, ` +
        `${byExt('.glb').length} models`,
    );
    expect(byExt('.js').length).toBeGreaterThan(0);
    expect(byExt('.json').length).toBeGreaterThan(0);
    for (const u of byExt('.js')) expect(u.type, u.url).toMatch(/^text\/javascript/);
    const sample = byExt('.js')[0]?.url ?? '';
    const fromCache = await page.evaluate(async (url) => {
      const res = await caches.match(url, { ignoreVary: true });
      if (!res) return 'not cached';
      const digest = await crypto.subtle.digest('SHA-256', await res.arrayBuffer());
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    }, sample);
    // The plain file, straight from the server (the test's own request, not the worker's).
    const plainFile = await (await page.request.get(sample)).body();
    expect(fromCache, sample).toBe(createHash('sha256').update(plainFile).digest('hex'));

    await context.setOffline(true);
    // Proof the network really is off for the page and its worker: a file the cache does not hold
    // fails to load (online, the preview server would answer it with a 404).
    const probe = await page.evaluate(() =>
      fetch(`no-such-file-${String(performance.timeOrigin)}.txt`).then(
        (r) => `answered ${r.status}`,
        () => 'failed',
      ),
    );
    expect(probe).toBe('failed');

    preloadWarnings.length = 0;
    await page.reload();
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    const workerPreloads = await preloadLinks();
    console.log(
      `[print] preload hints: ${firstLoadPreloads} on the first load, ${workerPreloads} from the worker`,
    );
    expect(workerPreloads).toBe(0);
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-race').click();
    await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 120, null, {
      timeout: 120_000,
    });
    const tick = await page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? 0);
    console.log(`[print] offline race reached tick ${tick}`);
    expect(problems).toEqual([]);
    expect(preloadWarnings).toEqual([]);
  });

  // Playtest 4 run A fix check, new mustFix 2b and punch item 1, with a simulated deploy (the preview
  // serves one build, so the deploy is routes): a deploy lands while the worker is installing and
  // the player is racing. The install fails (all or nothing), and the host's worker file names
  // another build. The tab must not reload mid-race; it reloads once on the way back to the menu, and
  // the reloaded page's worker caches its whole build, so an offline relaunch opens and races.
  test('a deploy during the install: no reload mid-race, one reload after it, then a whole cache offline', async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    await countLoads(page);
    let deployed = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = () => resolve()));
    let heldUrl: string | null = null;
    let probes = 0;
    let gone = 0;
    await context.route('**/sw.js', async (route) => {
      const req = route.request();
      if (!req.serviceWorker() && req.resourceType() === 'fetch') probes++;
      if (deployed) await workerOfAnotherBuild(route);
      else await route.continue();
    });
    await context.route('**/assets/**', async (route) => {
      // The worker's first download waits for the deploy, so the deploy lands mid-install.
      if (heldUrl === null && route.request().serviceWorker()) {
        heldUrl = route.request().url();
        await held;
      }
      if (!deployed) return route.continue();
      gone++;
      return route.fulfill({ status: 404, body: 'Not Found' });
    });

    await page.goto('./');
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-race').click();
    await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 60, null, {
      timeout: 120_000,
    });
    await expect.poll(() => heldUrl, { timeout: 120_000 }).not.toBeNull();

    // The deploy lands: the old build's files answer 404 and the worker file names another build.
    deployed = true;
    release();
    // The install fails: no worker, no cache. The page asks the host which build it serves.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            return reg?.installing || reg?.waiting || reg?.active ? 'a worker' : 'none';
          }),
        { timeout: 120_000 },
      )
      .toBe('none');
    await expect.poll(() => probes, { timeout: 60_000 }).toBeGreaterThan(0);
    // Ten more seconds of race (600 sim ticks): still racing, never reloaded, no offer over the race.
    const askedAt = await page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? 0);
    await page.waitForFunction(
      (from) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > from + 600,
      askedAt,
      { timeout: 120_000 },
    );
    expect(await page.evaluate(() => (window as TestWindow).__game?.state())).toBe('race');
    expect(await loadsOf(page)).toBe(1);
    await expect(page.locator('#reload-offer')).toBeHidden();
    console.log(
      `[print] held ${String(heldUrl)}; ${gone} old-build files answered 404; ${probes} questions to the host`,
    );

    // The deploy is complete (the preview serves its one build again). Quitting to the menu reloads
    // the tab once.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    const reloaded = page.waitForEvent('load', { timeout: 60_000 });
    await page.keyboard.press('Escape');
    await page.locator('#pause-quit').click();
    await reloaded;
    expect(await loadsOf(page)).toBe(2);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), STALE_BUILD_KEY)).toBe(
      await hostBuild(page),
    );

    // The reloaded page's worker caches the whole build and takes the page.
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
      timeout: 120_000,
      polling: 250,
    });
    const cached = await cacheOfLoadedFiles(page);
    console.log(
      `[print] after the reload: caches ${cached.own.join(', ')}; ${cached.missing.length} not cached`,
    );
    expect(cached.own).toHaveLength(1);
    expect(cached.missing).toEqual([]);

    // An offline relaunch opens from that cache and races.
    await context.setOffline(true);
    await page.reload();
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-race').click();
    await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 120, null, {
      timeout: 120_000,
    });
    expect(await loadsOf(page)).toBe(3);
  });
});

// Playtest 4 run A fix check, new mustFix 2a: online, a deploy had renamed San Francisco's map files;
// picking the region fetched 4 of them, all 404, and nothing reloaded (#584 heard only lazy chunks).
// Service workers are blocked here, as in every other spec: the page fetches from the host itself.
test('a region whose map files a deploy renamed reloads the tab once to the current build', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await countLoads(page);
  const build = await hostBuild(page);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();

  // The deploy lands: San Francisco's map files answer 404, and the host's worker file names another
  // build. (That the same 404s reload nothing while the host serves this build is unit-tested in
  // src/platform/stale-build.test.ts.)
  const gone: string[] = [];
  await page.route(
    (url) => /\/assets\/(osm-)?sf-[\w-]+\.json$/.test(url.pathname),
    (route) => {
      gone.push(route.request().url());
      return route.fulfill({ status: 404, body: 'Not Found' });
    },
  );
  await page.route('**/sw.js', workerOfAnotherBuild);
  const reloaded = page.waitForEvent('load', { timeout: 60_000 });
  await page.locator('#region-region-sf-san-francisco').click();
  await reloaded;
  console.log(`[print] ${gone.length} San Francisco map files answered 404 before the reload`);
  expect(gone.length).toBeGreaterThan(0);
  expect(await loadsOf(page)).toBe(2);
  // Remembered: this tab never reloads from this build again.
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STALE_BUILD_KEY)).toBe(build);
});

test('the menu offers Install only while the browser does, and only its tap opens the prompt', async ({
  page,
}) => {
  type InstallWindow = Window & { __prompted?: number; __prevented?: boolean };
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  const install = page.locator('#menu-install');
  // A headless browser offers no install: the button is not there to tap.
  await expect(install).toBeHidden();

  // The browser offers one (Chrome's beforeinstallprompt, as it fires it).
  await page.evaluate(() => {
    const w = window as InstallWindow;
    w.__prompted = 0;
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: () => {
        w.__prompted = (w.__prompted ?? 0) + 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(e);
    w.__prevented = e.defaultPrevented;
  });
  const before = await page.evaluate(() => {
    const w = window as InstallWindow;
    return { prompted: w.__prompted, prevented: w.__prevented };
  });
  // The browser's own banner is held back, and nothing prompts by itself.
  expect(before).toEqual({ prompted: 0, prevented: true });
  await expect(install).toBeVisible();

  await install.click();
  expect(await page.evaluate(() => (window as InstallWindow).__prompted)).toBe(1);
  // Answered once; the browser offers again on a later visit if the player said no.
  await expect(install).toBeHidden();
});
