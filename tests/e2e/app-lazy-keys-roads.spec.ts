import { expect, test, type Page } from '@playwright/test';

// Run W-P: the Keys' real-road data (the Bahia Honda run, built from map data) is not in the
// first-load JavaScript any more. The app fetches it after boot, the route picker then offers it,
// and both a Keys race on the hand-made road and one on Bahia Honda record under a replay key that
// the page itself re-derives (the Keys' content hash covers the real roads either way).

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: {
    snapshot(): { tick: number } | null;
    setBot(on: boolean): void;
    setSeed(seed: number): void;
    debugFileText(): string;
    checkDebugFile(text: string): { ticks: number; checked: number; desync: unknown; keyMatches: boolean };
  };
};

const REPLAY_MARKER = '===== replay (one line of JSON) =====';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
});

/** The scripts the page loaded, and whether any of them carries the Bahia Honda road data. */
async function scriptsCarryBahia(page: Page): Promise<{ scripts: number; carry: string[] }> {
  return page.evaluate(async () => {
    const urls = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /\.js(\?|$)/.test(n));
    const carry: string[] = [];
    for (const u of urls) {
      // A road's own name from osm-big-pine-bend.json: only the road data file holds it.
      if ((await (await fetch(u)).text()).includes('Big Pine Bend')) carry.push(u);
    }
    return { scripts: urls.length, carry };
  });
}

const fetchedRoads = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name.split('/').pop() ?? '')
      .filter((n) => /^osm-.*\.json$/.test(n))
      .map((n) => n.replace(/-[\w-]{8}\.json$/, '')),
  );

async function raceAndCheck(page: Page, seed: number) {
  await page.evaluate((s) => {
    const g = (window as TestWindow).__game;
    g?.setSeed(s);
    g?.setBot(true);
  }, seed);
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 120, null, {
    timeout: 60_000,
  });
  const text = await page.evaluate(() => (window as TestWindow).__game?.debugFileText() ?? '');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const replay = JSON.parse(lines[lines.indexOf(REPLAY_MARKER) + 1] ?? 'null') as {
    header?: { config?: { event?: { routeId?: string } } };
  } | null;
  const check = await page.evaluate((t) => (window as TestWindow).__game?.checkDebugFile(t) ?? null, text);
  return { routeId: replay?.header?.config?.event?.routeId, check };
}

test('the Keys real roads load after boot, outside the first-load scripts, and race under a stable key', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(err.message));
  await page.goto('./');
  await page.locator('#start-screen').click();
  // Offered once its data is in (fetched in the background at boot).
  const bahia = page.locator('#route-base-osm-bahia-honda-run');
  await expect(bahia).toBeVisible({ timeout: 30_000 });
  const fetched = await fetchedRoads(page);
  console.log(`[print] real-road files fetched at boot: ${fetched.sort().join(', ')}`);
  expect(fetched).toEqual(
    expect.arrayContaining(['osm-bahia-honda-run', 'osm-keys-bahia-honda', 'osm-big-pine-bend']),
  );
  // Region packs' real roads are not fetched until their region is picked.
  expect(fetched.some((n) => n.startsWith('osm-chuckanut') || n.startsWith('osm-sf-'))).toBe(false);
  const scripts = await scriptsCarryBahia(page);
  console.log(
    `[print] ${scripts.scripts} scripts checked; carrying Bahia Honda data: ${scripts.carry.length}`,
  );
  expect(scripts.scripts).toBeGreaterThan(0);
  expect(scripts.carry).toEqual([]);

  // The hand-made road: the recording's key is the one the page derives now.
  const own = await raceAndCheck(page, 4);
  expect(own.routeId).not.toBe('base:osm-bahia-honda-run');
  expect(own.check?.keyMatches).toBe(true);
  expect(own.check?.desync ?? null).toBeNull();

  // Bahia Honda, from the menu.
  await page.keyboard.press('Escape');
  await page.locator('#pause-quit').click();
  await bahia.click();
  await expect(bahia).toHaveAttribute('aria-checked', 'true');
  const real = await raceAndCheck(page, 4);
  expect(real.routeId).toBe('base:osm-bahia-honda-run');
  expect(real.check?.keyMatches).toBe(true);
  expect(real.check?.desync ?? null).toBeNull();
  expect(problems).toEqual([]);
});
