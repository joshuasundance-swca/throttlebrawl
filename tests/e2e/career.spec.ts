import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// The career in the browser (run W-R; docs/milestones/M4.md, ui-4: "browser tests walk a new career
// from the first launch into event 1 without a menu in between (race-first), then through a
// purchase"). A new device's first tap starts the Keys career's first race with its objective and
// a learn-by-riding prompt on the screen; quitting lands on the career map (region tabs, the map
// drawn from the region's roads, ten event cards in tiers); the garage sells paint and shows the
// backup code; another region's map draws once its roads are in; nothing overflows at phone size.
// The second test rides the first race to its results with the dev bot and sees the map claim
// its roads.

interface Handle {
  state(): string;
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
  setSeed(seed: number): void;
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __raceFirst?: boolean;
  __game?: Handle;
  __menuSeen?: boolean;
};

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

async function shot(page: Page, name: string) {
  mkdirSync('test-results/career', { recursive: true });
  await page.screenshot({ path: `test-results/career/${name}.png` });
}

/** Every visible text element inside `root` sits on the screen and does not overflow its box. */
async function expectNoOverflow(page: Page, root: string, where: string) {
  const found = await page.evaluate((sel) => {
    const out: string[] = [];
    let examined = 0;
    const vw = window.innerWidth;
    for (const e of document.querySelectorAll<HTMLElement>(`${sel} *`)) {
      if (!e.checkVisibility()) continue;
      const own = [...e.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim() !== '');
      if (!own) continue;
      examined++;
      const r = e.getBoundingClientRect();
      const name = `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''} "${(e.textContent ?? '').trim().slice(0, 30)}"`;
      // The screen scrolls downwards; nothing may leave it sideways.
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${name} leaves the screen sideways`);
      if (getComputedStyle(e).display !== 'inline' && e.tagName !== 'TEXTAREA') {
        if (e.scrollWidth > e.clientWidth + 1) out.push(`${name} overflows sideways`);
        if (e.scrollHeight > e.clientHeight + 1) out.push(`${name} overflows downwards`);
      }
    }
    return { out, examined };
  }, root);
  console.log(`${where}: ${found.examined} text elements checked for overflow`);
  expect(found.examined).toBeGreaterThan(0);
  expect(found.out, where).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as TestWindow;
    w.__GAME_TEST__ = true;
    w.__raceFirst = true;
    w.__menuSeen = false;
    // Record whether the menu is ever on screen (race-first: it must not be).
    const watch = () => {
      const menu = document.getElementById('menu');
      if (!menu) return false;
      new MutationObserver(() => {
        if (!menu.hidden) w.__menuSeen = true;
      }).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
      return true;
    };
    const poll = setInterval(() => {
      if (watch()) clearInterval(poll);
    }, 5);
  });
});

test('race-first into the first event, then the career map, the garage and the backup code', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = watchErrors(page);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
  expect(await page.evaluate(() => (window as TestWindow).__menuSeen)).toBe(false);
  // The event's objective under the position badge, and the first prompt once the bike sits still.
  await expect(page.locator('#hud-objective')).toHaveText('FINISH');
  await expect(page.locator('#career-prompt')).toContainText('THUMB UP', { timeout: 10_000 });
  await shot(page, 'race-first');

  // The pause screen's network map marks the player (run W-S; interview, 2026-10-02: "map on pause").
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-map')).toBeVisible();
  await expect(page.locator('#pause-map circle.here')).toHaveCount(1);
  await shot(page, 'pause-map');
  // Quit: the career map.
  await page.locator('#pause-quit').click();
  await expect(page.locator('#career')).toBeVisible();
  await expect(page.locator('#hud-objective')).toBeHidden();
  await expect(page.locator('.career-tabs button')).toHaveCount(3);
  await expect(page.locator('.career-node')).toHaveCount(10);
  await expect(page.locator('#career-cash')).toHaveText('$500');
  // The region's side gig (run W-S).
  await expect(page.locator('#career-gig')).toContainText('SIDE GIG');
  // The map draws the Keys' roads, with the event pins on them.
  await expect(page.locator('.career-map').first()).toBeVisible();
  const roads = await page.locator('.career-map polyline.road').count();
  const pins = await page.locator('.career-map .pin').count();
  console.log(`career map: ${roads} roads, ${pins} pins drawn`);
  expect(roads).toBeGreaterThan(5);
  expect(pins).toBeGreaterThan(0);
  await expectNoOverflow(page, '#career', 'career map, phone landscape');
  await shot(page, 'map');

  // A locked event says why; the open one rides.
  await page.locator('#career-node-sunburn-hunt').click();
  await expect(page.locator('.career-detail')).toContainText('Win The Shakedown first.');
  await expect(page.locator('#career-ride')).toBeDisabled();
  await page.locator('#career-node-shakedown').click();
  await expect(page.locator('.career-detail')).toContainText('Finish the race.');
  // The stream's poster on the card: the four faces in the field, a beef line each (run W-S).
  await expect(page.locator('.career-detail .show-face')).toHaveCount(4);
  await expect(page.locator('.career-detail .show-chyron')).toContainText('GOLDEN HOUR');
  await expect(page.locator('#career-ride')).toBeEnabled();
  await shot(page, 'event-card');

  // The garage: a paint bought with the starting cash, the backup code.
  await page.locator('#career-tab-garage').click();
  await expect(page.locator('.career-garage')).toContainText('Rustbucket 400');
  await expect(page.locator('[data-bike="base:streetfighter-750"]')).toHaveAttribute('data-state', 'locked');
  await page.locator('#garage-paint-flamingo-pink').click();
  await expect(page.locator('#career-cash')).toHaveText('$200');
  await expect(page.locator('.career-wallet .swatch')).toBeVisible();
  await page.locator('#career-code-copy').click();
  await expect(page.locator('#career-code')).toHaveValue(/^EC1\.[pz]\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  const code = await page.locator('#career-code').inputValue();
  await page.locator('#career-code').fill('EC1.p.garbage.00000000');
  await page.locator('#career-code-load').click();
  await expect(page.locator('.career-msg')).toContainText('did not load');
  // The real code loads back: the same cash.
  await page.locator('#career-code').fill(code);
  await page.locator('#career-code-load').click();
  await expect(page.locator('.career-msg')).toContainText('Loaded: $200');
  await expectNoOverflow(page, '#career', 'garage, phone landscape');
  await shot(page, 'garage');

  // Another region: its map draws once its roads are in.
  await page.locator('#career-tab-map').click();
  await page.locator('#career-region-pacific-northwest').click();
  await expect(page.locator('.career-head .title')).toHaveText('The Fir County Circuit');
  await expect(page.locator('.career-map figcaption').filter({ hasText: 'Chuckanut' })).toBeVisible({
    timeout: 30_000,
  });
  // The start tap went fullscreen; a window resize needs it left first (platform-phone.spec.ts).
  await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
  await page.setViewportSize({ width: 412, height: 915 });
  await expectNoOverflow(page, '#career', 'career map, phone portrait');
  await shot(page, 'map-portrait');
  expect(problems).toEqual([]);
});

test('the first event ridden to its results: won, paid, and its roads claimed on the map', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const problems = watchErrors(page);
  await page.goto('./');
  await page.evaluate(() => (window as TestWindow).__game?.setSeed(3));
  await page.locator('#start-screen').click();
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await expect(page.locator('#career-results')).toBeVisible({ timeout: 360_000 });
  await expect(page.locator('#career-results-title')).toHaveText('WON');
  await expect(page.locator('#career-results-cash')).toContainText('place');
  await expect(page.locator('#career-results')).toContainText('claimed on the map');
  // The Keys rag's front page: a headline built from the race (run W-S).
  await expect(page.locator('#career-paper')).toHaveClass(/paper-rag/);
  await expect(page.locator('#career-paper .paper-headline')).not.toBeEmpty();
  console.log(`paper: ${await page.locator('#career-paper .paper-headline').textContent()}`);
  await expectNoOverflow(page, '#career-results', 'results, phone landscape');
  await shot(page, 'results');
  await page.locator('#career-results-map').click();
  await expect(page.locator('#career')).toBeVisible();
  await expect(page.locator('#career-node-shakedown')).toHaveAttribute('data-state', 'won');
  await expect(page.locator('#career-node-sunburn-hunt')).toHaveAttribute('data-state', 'open');
  await expect(page.locator('.career-head .career-tally')).toContainText('won 1/10');
  expect(await page.locator('.career-map polyline.road.claimed').count()).toBeGreaterThan(0);
  await shot(page, 'map-after-win');
  expect(problems).toEqual([]);
});
