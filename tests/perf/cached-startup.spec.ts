import { createHash } from 'node:crypto';
import { expect, test, type Route } from '@playwright/test';
import { openQuickPlay } from '../e2e/menu-navigation';
import { cacheOfLoadedFiles } from '../e2e/offline-cache';

// M5's production cached-start budget runs with the existing isolated perf tier.
// Keep every functional/error control and the exact five-second first-visible bound.
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __offlineVisible?: Record<string, number>;
  __game?: { snapshot(): { tick: number } | null; setBot(on: boolean): void; state(): string };
};

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
  const testMode = await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-quick-play')).toBeVisible();
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
  // worker downloads each JSON file's and model's gzip copy and unpacks it. The files the page had
  // not loaded came that way, and each unpacks to the plain file, byte for byte. Scripts are the
  // exception on a first visit (polish batch F, punch item 1; offline-worker.ts): the install asks
  // for each one plain, so the page's own import of it revalidates instead of downloading it twice.
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
  // (The JSON and model counts are the control: the same scan finds the copies the install took.)
  expect(byExt('.js')).toEqual([]);
  expect(byExt('.json').length).toBeGreaterThan(0);
  expect(byExt('.glb').length).toBeGreaterThan(0);
  for (const u of byExt('.json')) expect(u.type, u.url).toMatch(/^application\/json/);
  const sample = byExt('.json')[0]?.url ?? '';
  const fromCache = await page.evaluate(async (url) => {
    const res = await caches.match(url, { ignoreVary: true });
    if (!res) return 'not cached';
    const digest = await crypto.subtle.digest('SHA-256', await res.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }, sample);
  // The plain file, straight from the server (the test's own request, not the worker's).
  const plainFile = await (await page.request.get(sample)).body();
  expect(fromCache, sample).toBe(createHash('sha256').update(plainFile).digest('hex'));

  // Measure the player's boot path, not main.ts's extra test-only DEV/sim prerequisites.
  await testMode.dispose();
  const readiness = await page.addInitScript(() => {
    const w = window as TestWindow;
    w.__offlineVisible = {};
    const observed = new Set<Element>();
    const selectors = ['#start-screen', '#menu-quick-play'];
    const intersections = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (
          !entry.isIntersecting ||
          entry.boundingClientRect.width <= 0 ||
          entry.boundingClientRect.height <= 0
        )
          continue;
        const key = `#${entry.target.id}`;
        if (w.__offlineVisible && w.__offlineVisible[key] === undefined) w.__offlineVisible[key] = entry.time;
      }
    });
    const find = () => {
      for (const selector of selectors) {
        const target = document.querySelector(selector);
        if (target && !observed.has(target)) {
          observed.add(target);
          intersections.observe(target);
        }
      }
      if (observed.size === selectors.length) mutations.disconnect();
    };
    const mutations = new MutationObserver(find);
    mutations.observe(document, { childList: true, subtree: true });
    find();
  });

  // A host error is a failed return too: the installed game must beat an HTTP503 page.
  const entry = new URL(page.url());
  const entryRoute = (url: URL) => url.origin === entry.origin && url.pathname === entry.pathname;
  let errorsAnswered = 0;
  await context.route(entryRoute, async (route) => {
    if (!route.request().serviceWorker()) return route.continue();
    errorsAnswered++;
    return route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Host unavailable</h1>' });
  });
  const errorReturn = await page.reload();
  expect(errorReturn?.fromServiceWorker()).toBe(true);
  expect(errorReturn?.status()).toBe(200);
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-quick-play')).toBeVisible();
  expect(errorsAnswered).toBeGreaterThan(0);
  await context.unroute(entryRoute);

  // M5 offline-1: a network request that never answers must not hang cached startup.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let heldRequests = 0;
  const completions: Promise<void>[] = [];
  let cleaning = false;
  const cleanupHandled: string[] = [];
  const heldRoute = (route: Route) => {
    if (!route.request().serviceWorker()) return route.continue();
    heldRequests++;
    const completion = held
      .then(() => route.continue())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        // The worker's timeout may have retired its network request before intentional release.
        if (!cleaning || !message.includes('Route is already handled!')) throw error;
        cleanupHandled.push(message);
      });
    completions.push(completion);
    return completion;
  };
  await context.route(entryRoute, heldRoute);
  let bodyError: unknown;
  let bodyFailed = false;
  const cleanupProblems: unknown[] = [];
  try {
    const slowReturn = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(slowReturn?.fromServiceWorker()).toBe(true);
    await expect(page.locator('#start-screen')).toBeVisible();
    await page.waitForFunction(
      () => (window as TestWindow).__offlineVisible?.['#start-screen'] !== undefined,
    );
    const timing = await page.evaluate(() => ({
      firstVisible: (window as TestWindow).__offlineVisible?.['#start-screen'],
      readAt: performance.now(),
      menuVisible: (window as TestWindow).__offlineVisible?.['#menu-quick-play'],
      testMode: (window as TestWindow).__GAME_TEST__ === true,
      navigation: performance.getEntriesByType('navigation').map((entry) => {
        const nav = entry as PerformanceNavigationTiming;
        return {
          workerStart: nav.workerStart,
          requestStart: nav.requestStart,
          responseStart: nav.responseStart,
          responseEnd: nav.responseEnd,
          domInteractive: nav.domInteractive,
          domContentLoaded: nav.domContentLoadedEventEnd,
        };
      }),
    }));
    console.log(
      `[print] production cached boot with network held: ${JSON.stringify(timing)}; ${heldRequests} held requests`,
    );
    expect(timing.testMode).toBe(false);
    expect(timing.menuVisible, 'hidden menu is not reported visible by the observer').toBeUndefined();
    expect(heldRequests).toBeGreaterThan(0);
    // M5 offline-1 measures the rendered start screen, including loading and initialization.
    expect(timing.firstVisible).toBeLessThan(5000);
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-quick-play')).toBeVisible();
    await page.waitForFunction(
      () => (window as TestWindow).__offlineVisible?.['#menu-quick-play'] !== undefined,
    );
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  } finally {
    cleaning = true;
    release();
    const drained = await Promise.allSettled(completions);
    try {
      await context.unroute(entryRoute, heldRoute);
    } catch (error) {
      cleanupProblems.push(error);
    }
    console.log(`[print] late handled route cleanup: ${JSON.stringify(cleanupHandled)}`);
    const failures = drained.filter((entry) => entry.status === 'rejected');
    for (const failure of failures) cleanupProblems.push(failure.reason as unknown);
    if (cleanupProblems.length) console.error('unexpected held-route cleanup failures', cleanupProblems);
  }
  if (bodyFailed) throw bodyError;
  if (cleanupProblems.length) throw new AggregateError(cleanupProblems, 'Held-route cleanup failed');

  // The original offline-race control still needs its deterministic sim hooks.
  await readiness.dispose();
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
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
  await expect(page.locator('#menu-quick-play')).toBeVisible();
  const workerPreloads = await preloadLinks();
  console.log(
    `[print] preload hints: ${firstLoadPreloads} on the first load, ${workerPreloads} from the worker`,
  );
  expect(workerPreloads).toBe(0);
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await openQuickPlay(page);
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 120, null, {
    timeout: 120_000,
  });
  const tick = await page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? 0);
  console.log(`[print] offline race reached tick ${tick}`);
  expect(problems).toEqual([]);
  expect(preloadWarnings).toEqual([]);
});
