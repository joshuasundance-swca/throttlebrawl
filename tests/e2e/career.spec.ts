import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { careerPicks, qualifyIn } from './packs-on-disk';

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

// What the screens should show is read from the packs on disk, never copied from them (docs/
// engineering.md, "Assert the rule, not today's content"): the careers in chapter order, the first
// one's opening event and the event it opens, its starting cash, bike, paints and shop, and the next
// career's name and first map panel (packs-on-disk.ts, `careerPicks`).
const {
  careers: CAREERS,
  first: FIRST,
  next: NEXT,
  opening: OPENING,
  openingEvent: OPENING_EVENT,
  waiting: WAITING,
  paint: PAINT,
  laterBike: LATER_BIKE,
  startingBikeName,
  nextPanel: NEXT_PANEL,
} = careerPicks();
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const bare = (key: string) => key.slice(key.indexOf(':') + 1);

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
  // The opening event is a race to the line: its badge asks to finish, or to finish in the top N.
  expect(OPENING_EVENT.kind).toBe('classic-race');
  await expect(page.locator('#hud-objective')).toHaveText(/^(FINISH|TOP \d+)$/);
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
  // A region tab per career.
  await expect(page.locator('.career-tabs button')).toHaveCount(CAREERS.length);
  // A career map holds at least ten events (the count is the career file's, not this spec's).
  await expect(page.locator('.career-node').nth(9)).toBeAttached();
  await expect(page.locator('#career-cash')).toHaveText(money(FIRST.startingCash));
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

  // A locked event says why, naming the event it waits on; the open one rides.
  await page.locator(`#career-node-${WAITING.id}`).click();
  await expect(page.locator('.career-detail')).toContainText(`Win ${OPENING_EVENT.name} first.`);
  await expect(page.locator('#career-ride')).toBeDisabled();
  await page.locator(`#career-node-${OPENING.id}`).click();
  await expect(page.locator('.career-detail')).toContainText(/Finish (the race|in the top \d+)\./);
  // The stream's poster on the card: up to four faces from the field, a beef line each (run W-S),
  // under the event's time of day.
  const riders = (OPENING_EVENT['field'] as { riders?: string[] } | undefined)?.riders ?? [];
  await expect(page.locator('.career-detail .show-face')).toHaveCount(Math.min(4, riders.length));
  const time = OPENING_EVENT['timeOfDay'];
  const light = typeof time === 'string' ? time : '';
  expect(light, 'the opening event names its time of day').not.toBe('');
  await expect(page.locator('.career-detail .show-chyron')).toContainText(
    light.replace(/-/g, ' ').toUpperCase(),
  );
  await expect(page.locator('#career-ride')).toBeEnabled();
  await shot(page, 'event-card');

  // The garage: the starting bike, a later tier's bike still shut, a paint bought with the starting
  // cash, the backup code.
  await page.locator('#career-tab-garage').click();
  await expect(page.locator('.career-garage')).toContainText(startingBikeName);
  await expect(page.locator(`[data-bike="${qualifyIn(FIRST.pack, LATER_BIKE.bike)}"]`)).toHaveAttribute(
    'data-state',
    'locked',
  );
  const left = money(FIRST.startingCash - PAINT.priceCash);
  await page.locator(`#garage-paint-${PAINT.id}`).click();
  await expect(page.locator('#career-cash')).toHaveText(left);
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
  await expect(page.locator('.career-msg')).toContainText(`Loaded: ${left}`);
  await expectNoOverflow(page, '#career', 'garage, phone landscape');
  await shot(page, 'garage');

  // Another region: its map draws once its roads are in.
  await page.locator('#career-tab-map').click();
  await page.locator(`#career-region-${bare(NEXT.region).replace(/[^a-z0-9-]/gi, '-')}`).click();
  await expect(page.locator('.career-head .title')).toHaveText(NEXT.name);
  // Exactly the panel of the network that holds its first event (a whole caption, not a part of one).
  const exactly = new RegExp(`^${NEXT_PANEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  await expect(page.locator('.career-map figcaption').filter({ hasText: exactly })).toBeVisible({
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
  // First place is WON; a finish below first clears the opening race (it asks only to finish).
  await expect(page.locator('#career-results-title')).toHaveText(
    /^(WON|\d+(ST|ND|RD|TH) OF \d+\. CLEARED\.)$/,
  );
  await expect(page.locator('#career-results-cash')).toContainText('place');
  // A negative line (repairs, the fine) puts the minus before the dollar sign (wave A live check).
  await expect(page.locator('#career-results-cash')).not.toContainText('$-');
  await expect(page.locator('#career-results')).toContainText('claimed on the map');
  // The Keys rag's front page: a headline built from the race (run W-S).
  await expect(page.locator('#career-paper')).toHaveClass(/paper-rag/);
  await expect(page.locator('#career-paper .paper-headline')).not.toBeEmpty();
  console.log(`paper: ${await page.locator('#career-paper .paper-headline').textContent()}`);
  await expectNoOverflow(page, '#career-results', 'results, phone landscape');
  await shot(page, 'results');
  await page.locator('#career-results-map').click();
  await expect(page.locator('#career')).toBeVisible();
  await expect(page.locator(`#career-node-${OPENING.id}`)).toHaveAttribute('data-state', 'won');
  await expect(page.locator(`#career-node-${WAITING.id}`)).toHaveAttribute('data-state', 'open');
  await expect(page.locator('.career-head .career-tally')).toContainText(/won 1\/\d+/);
  expect(await page.locator('.career-map polyline.road.claimed').count()).toBeGreaterThan(0);
  await shot(page, 'map-after-win');
  expect(problems).toEqual([]);
});
