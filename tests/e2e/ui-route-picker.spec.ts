import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fastForwardDone } from './lockstep';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// Real roads as routes (the maintainer, 2026-10-01: "Yes, add as routes"). After the region, the
// menu offers a route: the region's hand-made road (picked by default), then each real road by its
// real name. Picking one and tapping Race races that road: the recording's header names it beside
// the seed, the frame is a real frame, and the bot rides it to the finish.

interface Checks {
  ticks: number;
  invalidTicks: number;
  firstInvalid: string | null;
  playerEdges: number[];
  events: Record<string, number>;
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: {
    snapshot(): { tick: number; entities: { kind: string; speed: number }[] } | null;
    state(): string;
    fastForward(until: (snap: { tick: number }) => boolean, opts?: { perFrame?: number }): void;
    fastForwarding(): boolean;
    lockstep(steps: number | null): void;
    setBot(on: boolean): void;
    setSeed(seed: number): void;
    checks(): Checks;
    debugFileText(): string;
    checkDebugFile(text: string): { ticks: number; checked: number; desync: unknown; keyMatches: boolean };
  };
};

const REPLAY_MARKER = '===== replay (one line of JSON) =====';

async function toMenu(page: Page) {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

/** The recording's header, from the debug file's replay line. */
async function header(
  page: Page,
): Promise<{ eventId?: string; seed?: number; config?: { event?: { routeId?: string } } }> {
  const text = await page.evaluate(() => (window as TestWindow).__game?.debugFileText() ?? '');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const replay = JSON.parse(lines[lines.indexOf(REPLAY_MARKER) + 1] ?? 'null') as {
    header?: { eventId?: string; seed?: number; config?: { event?: { routeId?: string } } };
  } | null;
  return replay?.header ?? {};
}

const chipNames = (page: Page) => page.locator('#route-picker button.route');

test('each region offers its own road first, then its real roads by name, and the menu fits the phone', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await toMenu(page);
  const picker = page.locator('#route-picker');
  // The Keys: the hand-made causeway road, the real Overseas Highway at Bahia Honda, and run W-S's
  // Key West network.
  await expect(picker).toBeVisible();
  await expect(chipNames(page)).toHaveText(['Causeway Sprint', 'Bahia Honda Run', 'Key West']);
  await expect(page.locator('#route-own')).toHaveAttribute('aria-checked', 'true');

  const regions = [
    {
      chip: '#region-region-pnw-pacific-northwest',
      routes: ['Fogline Run', 'Chuckanut Drive', 'Columbia River Highway', 'I-5 by Lake Samish'],
    },
    {
      chip: '#region-region-sf-san-francisco',
      // Run W-R: the hand-made downtown on its own network, offered after the real roads; run W-U's
      // Chinatown and North Beach and the mural alleys the same way (the picker lists routes by id).
      routes: [
        'Fogline Hill Sprint',
        'Russian Hill',
        'Twin Peaks',
        'Chinatown & North Beach',
        'Downtown',
        'Mural Alleys',
      ],
    },
  ];
  const view = page.viewportSize()!;
  mkdirSync('test-results/screenshots', { recursive: true });
  for (const r of regions) {
    await page.locator(r.chip).click();
    // The region's road data arrives, then its routes are offered, its own road picked.
    await expect(chipNames(page)).toHaveText(r.routes, { timeout: 30_000 });
    await expect(page.locator('#route-own')).toHaveAttribute('aria-checked', 'true');
    // Phone first: every chip is a full touch target, and the pickers and Race stay on screen.
    for (const b of await chipNames(page).all()) {
      const box = (await b.boundingBox())!;
      expect(box.height, 'a chip is at least 44 px tall').toBeGreaterThanOrEqual(44);
    }
    for (const loc of [page.locator('#region-picker'), picker, page.locator('#menu-race')]) {
      const box = (await loc.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(view.height);
    }
    // A real road's chip shows the real road or streets it follows.
    const real = chipNames(page).nth(1);
    await real.click();
    await expect(real).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#route-own')).toHaveAttribute('aria-checked', 'false');
    await expect(picker.locator('.route-blurb')).toHaveText(/^Real (road|streets): .+\. \d+\.\d km\.$/);
    await page.screenshot({
      path: `test-results/screenshots/route-picker-${r.routes[1]?.replace(/\W+/g, '-')}.png`,
    });
    // A real road's blurb takes the region blurb's place.
    await expect(page.locator('#region-picker .region-blurb')).toBeHidden();
  }
  // Back to the Keys: its own routes again, its own road picked (a pick belongs to its region).
  await page.locator('#region-base-florida-keys').click();
  await expect(chipNames(page)).toHaveText(['Causeway Sprint', 'Bahia Honda Run', 'Key West']);
  await expect(page.locator('#route-own')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#region-picker .region-blurb')).toBeVisible();
  expect(problems).toEqual([]);
});

test('a picked real road is raced to the finish by the bot, and the recording names it with the seed', async ({
  page,
}) => {
  // A hang guard. The real roads run 5 to 7.6 km, which took about 4.5 minutes of real time on CI;
  // the ride to the line now fast-forwards (the determinism run's R4).
  test.setTimeout(360_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await toMenu(page);
  await page.locator('#region-region-sf-san-francisco').click();
  const peaks = page.locator('#route-region-sf-osm-sf-twin-peaks-run');
  await expect(peaks).toBeVisible({ timeout: 30_000 });
  await peaks.click();
  await expect(peaks).toHaveAttribute('aria-checked', 'true');
  // A seed the bot finishes on (the race's outcome shifts whenever the sim changes: if this one
  // turns into a bust, pick another seed that finishes, as the bot race's seed lists do). W-P's
  // regional traffic moved seed 2 to a stall: a crash at a hairpin junction hands the bot back
  // facing the wrong way and it rides the route backward (a tumble follow-up in the W-P traffic
  // report). With W-P's road events on top as well, headless (drafts in) seeds 4 to 8 finish.
  const SEED = 8;
  await page.evaluate((s) => {
    const g = (window as TestWindow).__game;
    g?.setSeed(s);
    g?.setBot(true);
  }, SEED);
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 240, null, {
    timeout: 60_000,
  });

  // The recording names the real road beside the seed.
  const h = await header(page);
  console.log(`[print] header: event ${h.eventId}, route ${h.config?.event?.routeId}, seed ${h.seed}`);
  expect(h.eventId).toBe('region-sf:sf-hill-sprint');
  expect(h.config?.event?.routeId).toBe('region-sf:osm-sf-twin-peaks-run');
  expect(h.seed).toBe(SEED);
  mkdirSync('test-results/screenshots', { recursive: true });
  const png = await page
    .locator('canvas#game')
    .screenshot({ path: 'test-results/screenshots/route-twin-peaks.png' });
  const { variance } = await pixelStats(page, png);
  expect(variance, 'the frame is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);

  // The bot rides it to the line, fast-forwarded (240 ticks a drawn frame) instead of in real time:
  // the race is the same tick for tick, only fewer frames are drawn on the way.
  await page.evaluate(() => (window as TestWindow).__game?.fastForward(() => false));
  await fastForwardDone(page, 'Twin Peaks to the line');
  await expect(page.locator('#results')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (window as TestWindow).__game?.lockstep(null));
  const placing = (await page.locator('#results-place').textContent()) ?? '';
  const checks = (await page.evaluate(() => (window as TestWindow).__game?.checks())) as Checks;
  console.log(
    `[print] Twin Peaks, seed ${SEED}: ${placing}; ${checks.ticks} ticks, edges ${checks.playerEdges.join('>')}`,
  );
  expect(placing, 'the bot finished (a placing, not a bust)').toMatch(/^\d+(st|nd|rd|th) of \d+$/);
  expect(checks.invalidTicks, checks.firstInvalid ?? '').toBe(0);
  // Every road of the route, ending on the last (a crash may throw the bot back across a join).
  expect([...new Set(checks.playerEdges)].sort()).toEqual([0, 1, 2]);
  expect(checks.playerEdges[checks.playerEdges.length - 1]).toBe(2);
  expect(checks.events['finish'] ?? 0).toBeGreaterThan(0);

  // The recording replays to the same hashes against a fresh sim.
  const text = await page.evaluate(() => (window as TestWindow).__game?.debugFileText() ?? '');
  const replay = await page.evaluate((t) => (window as TestWindow).__game?.checkDebugFile(t) ?? null, text);
  console.log(`[print] replay: ${replay?.ticks} ticks, ${replay?.checked} hashes compared`);
  expect(replay?.desync ?? null).toBeNull();
  expect(replay?.keyMatches).toBe(true);
  expect(problems).toEqual([]);
});
