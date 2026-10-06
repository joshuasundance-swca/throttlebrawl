import { expect, test } from '@playwright/test';

// Offline play and installing as an app (roadmap M5, launch polish; the maintainer: "Offline
// definitely preferable"). The rules: once the game has loaded, its worker has cached everything the
// page needed, so the game starts and races with the network off; and the menu's Install button
// shows only while the browser offers an install, with only its tap opening the prompt (it never
// nags). The worker's policy is unit-tested in src/platform/offline-worker.test.ts.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { snapshot(): { tick: number } | null; setBot(on: boolean): void };
};

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
    const cached = await page.evaluate(async () => {
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
        // through the worker, not cached up front.
        if (url.endsWith('/changelog.json')) continue;
        if (!(await caches.match(url, { ignoreVary: true }))) missing.push(url);
      }
      // A negative control: the same lookup finds nothing for a file the build never had.
      const control = await caches.match(`${location.origin}/no-such-file.js`);
      return { own, checked: loaded.length, missing, control: control !== undefined };
    });
    console.log(
      `[print] caches ${cached.own.join(', ')}; ${cached.checked} files the page loaded checked, ` +
        `${cached.missing.length} not cached`,
    );
    expect(cached.own).toHaveLength(1);
    expect(cached.checked).toBeGreaterThan(0);
    expect(cached.control).toBe(false);
    expect(cached.missing).toEqual([]);

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
