import { expect, test, type Locator, type Page } from '@playwright/test';

// Playtest 1c item 8 (2026-09-30): on a phone, the pause screen's keyboard legend hid the "cut this"
// veto list ("Recently seen: tap one to cut it"); the M1-1b skeptic saw the list pushed almost
// entirely below a 915x412 screen once the Keyboard card was opened. Both must be reachable, with
// the legend OPEN, at phone landscape (915x412, touch) and at a tall narrow 412x915 view.
//
// A touch phone held upright shows platform/'s rotate screen instead of the game, by design, so the
// 412x915 case runs with a fine pointer (a narrow window), where the legend starts open anyway.
//
// "Reachable" here means: the legend's header, its last row, the list's title and its first row
// are all inside the viewport AT ONCE, with nothing drawn over their centres, and tapping the
// first row opens the "cut this" card.

interface Handle {
  setBot(on: boolean): void;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

async function pausedWithSeenItems(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible();
  // The bot rides until a bark, sign or billboard lands in the "recently seen" list.
  await expect(page.locator('#recently-seen .rs-item').first()).toBeAttached({ timeout: 60_000 });
  await page.locator('#hud-pause').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  return problems;
}

/** The element's box is fully inside the viewport and its centre is not covered by anything else. */
async function onScreenAndOnTop(page: Page, loc: Locator, name: string) {
  const view = page.viewportSize()!;
  const box = await loc.boundingBox();
  expect(box, `${name} has a box`).not.toBeNull();
  const b = box!;
  console.log(`${name}: y ${Math.round(b.y)}..${Math.round(b.y + b.height)} of ${view.height}`);
  expect(b.y, `${name} top is on screen`).toBeGreaterThanOrEqual(0);
  expect(b.x, `${name} left is on screen`).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height, `${name} bottom is on screen`).toBeLessThanOrEqual(view.height + 0.5);
  expect(b.x + b.width, `${name} right is on screen`).toBeLessThanOrEqual(view.width + 0.5);
  const hit = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });
  expect(hit, `${name} is not drawn over`).toBe(true);
}

async function checkBothReachable(page: Page, shot: string) {
  const legend = page.locator('#pause-keys');
  const grid = legend.locator('.keys-grid');
  if (!(await grid.isVisible())) await legend.locator('summary').click();
  await expect(grid).toBeVisible();
  await onScreenAndOnTop(page, legend.locator('summary'), 'legend header');
  await onScreenAndOnTop(page, grid.locator('div').last(), 'legend last row');
  const list = page.locator('#pause-screen #recently-seen');
  await onScreenAndOnTop(page, list.locator('.rs-title'), 'veto list title');
  const row = list.locator('.rs-item').first();
  await onScreenAndOnTop(page, row, 'veto list first row');
  // The pause menu's own buttons stay reachable too.
  for (const id of ['#pause-resume', '#pause-quit', '#pause-copy-report']) {
    await onScreenAndOnTop(page, page.locator(id), id);
  }
  await page.screenshot({ path: `test-results/${shot}.png` });
  // And the row works: one tap offers "cut this".
  await row.click();
  await expect(page.locator('#cut-menu')).toBeVisible();
  await page.locator('#cut-keep').click();
  await expect(page.locator('#cut-menu')).toBeHidden();
}

test.describe('phone landscape 915x412, touch', () => {
  test.use({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true });
  test('the opened keyboard legend and the cut-this list are both on screen', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await pausedWithSeenItems(page);
    // On a touch screen the legend starts folded; open it, as the skeptic did.
    await expect(page.locator('#pause-keys .keys-grid')).toBeHidden();
    await checkBothReachable(page, 'pause-phone-landscape');
    expect(problems).toEqual([]);
  });
});

test.describe('tall narrow 412x915, fine pointer', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: false, hasTouch: false });
  test('the open keyboard legend and the cut-this list are both on screen', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await pausedWithSeenItems(page);
    await checkBothReachable(page, 'pause-phone-portrait');
    expect(problems).toEqual([]);
  });
});
