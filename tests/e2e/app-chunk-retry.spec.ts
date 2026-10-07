import { expect, test, type Page, type Route } from '@playwright/test';
import { fastForwardDone } from './lockstep';

// A lazy chunk whose import failed is fetched again (polish batch K's check, mustFix 1). Chromium keeps
// a failed `import()` under its URL: on the live game, after a dropped or 404 first request, the 2nd and
// 3rd imports of the chunk threw at once with 1 request in all, so `loadChunk`'s retry and render/'s ask
// at the next road never reached the network, and the part stayed missing until a reload. The retry now
// imports the chunk's own URL with a `retry` query (src/content/lazy-chunk.ts).
//
// The chunk here is render/'s race parts (src/render/race-parts.ts: the race's effects, speed lines, rain
// and road-event props), which the renderer asks for as it starts and again at each road and each race
// start while it is missing (src/render/chunk-gate.ts; a rematch on the same road sets no new road,
// polish batch O's check, mustFix 1); `rendererStats().eventProps` is there only once it is in. The routes count every request
// for it that reaches the host. Service workers are blocked (playwright.config.ts), so the page asks the
// host itself.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: {
    setBot(on: boolean): void;
    state(): string;
    fastForward(until: () => boolean, opts?: { perFrame?: number }): void;
    rendererStats?(): { eventProps?: { total: number } };
  };
};

/** The race parts' chunk, plain or retried. */
const RACE_PARTS = /\/assets\/race-parts-[\w-]+\.js(\?.*)?$/;
/** The worker file's cache name, which names its build (scripts/service-worker.mjs). */
const WORKER_CACHE = /"cache":"offline-([^"]+)-([0-9a-f]{12})"/;

const isRetry = (url: string) => new URL(url).searchParams.has('retry');
const nameOf = (url: string) => url.replace(/^.*\/assets\//, '');

/** Whether the race parts' chunk is in (render/ leaves `eventProps` out until it is). */
const racePartsIn = (page: Page) =>
  page.evaluate(() => {
    const g = (window as TestWindow).__game;
    return typeof g?.rendererStats === 'function' && g.rendererStats().eventProps !== undefined;
  });

async function toMenu(page: Page) {
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

async function rideToTheEnd(page: Page, what: string) {
  await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    g?.setBot(true);
    g?.fastForward(() => false, { perFrame: 1200 });
  });
  await fastForwardDone(page, what);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
});

test('the control: a failed import is kept, so importing the same URL again sends nothing; a retry query loads', async ({
  page,
}) => {
  // The old retry imported the same URL again. The heat badge's chunk is one the menu never loads.
  const worker = await (await page.request.get('sw.js')).text();
  const rel = /assets\/heat-badge-[\w-]+\.js/.exec(worker)?.[0];
  expect(rel, 'the build lists the heat badge chunk').toBeTruthy();
  const hits: string[] = [];
  await page.route(
    (url) => url.pathname.endsWith(`/${rel}`),
    (route: Route) => {
      hits.push(route.request().url());
      return hits.length === 1 ? route.abort('failed') : route.continue();
    },
  );
  await toMenu(page);
  const out = await page.evaluate(
    async (url) => {
      const tryImport = (u: string) =>
        import(/* @vite-ignore */ u).then(
          () => 'ok',
          (e: unknown) => `threw: ${String(e instanceof Error ? e.message : e).slice(0, 60)}`,
        );
      return {
        first: await tryImport(url),
        second: await tryImport(url),
        third: await tryImport(url),
        retried: await tryImport(`${url}?retry=1`),
      };
    },
    new URL(rel ?? '', page.url()).href,
  );
  console.log(`[print] ${rel}: ${JSON.stringify(out)}; requests ${JSON.stringify(hits.map(nameOf))}`);
  expect(out.first).toMatch(/^threw/);
  expect(out.second).toMatch(/^threw/);
  expect(out.third).toMatch(/^threw/);
  expect(out.retried).toBe('ok');
  // One request for three imports of the plain URL; the retry query's import reached the host.
  expect(hits.filter((u) => !isRetry(u))).toHaveLength(1);
  expect(hits.filter(isRetry)).toHaveLength(1);
});

test('a chunk whose first request dropped is fetched again, and its part appears', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const hits: string[] = [];
  let dropped = 0;
  await page.route(
    (url) => RACE_PARTS.test(url.href),
    (route: Route) => {
      const url = route.request().url();
      hits.push(url);
      if (dropped === 0 && !isRetry(url)) {
        dropped++;
        return route.abort('failed'); // a dropped connection, once
      }
      return route.continue();
    },
  );
  await toMenu(page);
  await expect.poll(() => racePartsIn(page), { timeout: 60_000 }).toBe(true);
  console.log(`[print] race parts requests: ${JSON.stringify(hits.map(nameOf))}`);
  expect(dropped).toBe(1);
  // The plain URL was asked once (the dropped request); the part came from the retry's own request.
  expect(hits.filter((u) => !isRetry(u))).toHaveLength(1);
  expect(hits.filter(isRetry)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('a chunk the host no longer has: each race asks the host again, and after a deploy the result offers the reload', async ({
  page,
}) => {
  test.setTimeout(400_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let deployed = false;
  let probes = 0;
  await page.route('**/sw.js', async (route: Route) => {
    if (route.request().resourceType() === 'fetch') probes++;
    if (!deployed) return route.continue();
    // A host that has deployed another build: its worker file names it.
    const res = await route.fetch();
    const body = (await res.text()).replace(WORKER_CACHE, '"cache":"offline-d3pl0y0-$2"');
    return route.fulfill({ response: res, body });
  });
  const hits: string[] = [];
  await page.route(
    (url) => RACE_PARTS.test(url.href),
    (route: Route) => {
      hits.push(route.request().url());
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' });
    },
  );
  const retries = () => hits.filter(isRetry).length;

  await toMenu(page);
  // As the renderer starts: the chunk and its retry answer 404, the stale-build watch asks the host,
  // and the host still serves this build, so nothing reloads.
  await expect.poll(retries, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => probes, { timeout: 60_000 }).toBeGreaterThan(0);

  // The control race (no deploy): the race's road asks again with a new URL, and the result offers
  // nothing, because a missing file the host's build still lists is no deploy.
  let before = retries();
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
  await expect.poll(retries, { timeout: 60_000 }).toBeGreaterThan(before);
  await rideToTheEnd(page, 'the control race, to its end');
  await expect(page.locator('#results')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#reload-offer')).toBeHidden();
  expect(await racePartsIn(page)).toBe(false);
  console.log(
    `[print] control race: requests ${JSON.stringify(hits.map(nameOf))}; ${probes} questions to the host`,
  );

  // The deploy lands. Race again from the result screen, a rematch on the same road (no new road): the
  // race start's ask fails again, the watch hears it and the host names another build, so the result
  // offers the reload.
  deployed = true;
  before = retries();
  await page.locator('#results-race').click();
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
  await expect.poll(retries, { timeout: 60_000 }).toBeGreaterThan(before);
  await rideToTheEnd(page, 'the race after the deploy, to its end');
  await expect(page.locator('#results')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#reload-offer')).toBeVisible();
  await expect(page.locator('#reload-offer .reload-offer-text')).toHaveText(
    'The game was updated while you raced. It reloads when you go back to the menu.',
  );
  const retried = hits.filter(isRetry).map((u) => new URL(u).searchParams.get('retry'));
  console.log(`[print] after the deploy: requests ${JSON.stringify(hits.map(nameOf))}; ${probes} questions`);
  // Every ask was a request with a new number, never the failure the browser keeps.
  expect(new Set(retried).size).toBe(retried.length);
  expect(errors).toEqual([]);
});
