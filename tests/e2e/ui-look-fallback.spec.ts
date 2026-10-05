import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Run W-O, items 1 and 2 (maintainer, 2026-10-01: "ink+60s but may change later"):
// - a new save starts on the Ink + 60s film look (Classic stays in the switch);
// - when the frames stay slow for a sustained stretch of a race on an ink look, a non-blocking note
//   offers a one-tap switch to Classic, the pause menu carries it too, and "No thanks" is remembered.
// The slow frames are forced through the real loop with the test hook `window.__slowFrameMs` (a
// busy wait in every rendered frame). The ink look's frame rate on the phone is unverified.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __slowFrameMs?: number;
  __lookFallbackWatch?: boolean;
  __game?: { state(): string; snapshot(): { tick: number } | null; setBot(on: boolean): void };
  __app?: { presentation(): { look: string } };
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    // The watch is off under the test flag unless a spec turns it on (app/index.ts, lookWatchOn).
    (window as TestWindow).__lookFallbackWatch = true;
  });
});

async function shot(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/ui-look-${name}.png` });
}

const look = (page: Page) => page.evaluate(() => (window as TestWindow).__app?.presentation().look ?? '');
const saved = (page: Page) =>
  page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? '';
      if (k.endsWith(':settings'))
        return (JSON.parse(localStorage.getItem(k) ?? 'null') as { data?: Record<string, unknown> } | null)
          ?.data;
    }
    return undefined;
  });

/** From the menu into a bot race, past its first ticks. */
async function race(page: Page) {
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => {
    const g = (window as TestWindow).__game;
    return g?.state() === 'race' && (g.snapshot()?.tick ?? 0) > 10;
  });
}
const slowFrames = (page: Page, ms: number) =>
  page.evaluate((v) => ((window as TestWindow).__slowFrameMs = v), ms);

/** The offer's buttons: on screen, finger-sized, and the top element at their centres. */
const offerButtons = (page: Page, card: string) =>
  page.evaluate((sel) => {
    return [...document.querySelectorAll<HTMLElement>(`${sel} button`)].map((b) => {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        id: b.id,
        inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        height: r.height,
        uncovered: !!top && (top === b || b.contains(top)),
      };
    });
  }, card);

test('a new save starts on Ink + 60s film; slow frames offer Classic, in the race and the pause menu', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('./');
  await page.locator('#start-screen').click();
  expect(await look(page)).toBe('kodak');
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-display').click();
  await expect(page.locator('#settings-look [data-value="kodak"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#settings-look [data-value="classic"]')).toBeVisible();
  await page.locator('#settings-back').click();

  await race(page);
  await expect(page.locator('#look-offer')).toBeHidden();
  const t0 = Date.now();
  await slowFrames(page, 60);
  await expect(page.locator('#look-offer')).toBeVisible({ timeout: 40_000 });
  console.log(`look offer up ${((Date.now() - t0) / 1000).toFixed(1)} s after the slow frames began`);
  await expect(page.locator('#look-offer')).toContainText('Classic');
  await expect(page.locator('#hud-ticker'), 'the strip does not repeat the toast').not.toContainText(
    /slow frames/i,
  );
  await slowFrames(page, 0);
  const buttons = await offerButtons(page, '#look-offer');
  console.log(`race offer buttons: ${JSON.stringify(buttons)}`);
  expect(buttons.map((b) => b.id)).toEqual(['look-offer-classic', 'look-offer-dismiss']);
  for (const b of buttons) {
    expect(b.inView && b.uncovered, `${b.id} on screen and uncovered`).toBe(true);
    expect(b.height).toBeGreaterThanOrEqual(40);
  }
  // Non-blocking: the race runs on under it.
  const tick = await page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? 0);
  await page.waitForFunction((t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > t + 30, tick);
  await shot(page, 'offer-landscape');

  // The pause menu carries it; Switch to Classic there switches the look at once and saves it.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-look-offer')).toBeVisible();
  await expect(page.locator('#look-offer'), 'the toast does not show through the pause screen').toBeHidden();
  for (const b of await offerButtons(page, '#pause-look-offer'))
    expect(b.inView && b.uncovered, `${b.id} on the pause screen`).toBe(true);
  await shot(page, 'offer-pause');
  await page.locator('#pause-look-offer-classic').click();
  expect(await look(page)).toBe('classic');
  await expect(page.locator('#pause-look-offer')).toBeHidden();
  expect((await saved(page))?.['look']).toBe('classic');

  // Kept across a reload, and the Look row shows it.
  await page.reload();
  await page.locator('#start-screen').click();
  expect(await look(page)).toBe('classic');
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-display').click();
  await expect(page.locator('#settings-look [data-value="classic"]')).toHaveAttribute('aria-pressed', 'true');
  expect(problems).toEqual([]);
});

test('"No thanks" is remembered: slow frames never offer again', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await race(page);
  await slowFrames(page, 60);
  await expect(page.locator('#look-offer')).toBeVisible({ timeout: 40_000 });
  await page.locator('#look-offer-dismiss').click();
  await expect(page.locator('#look-offer')).toBeHidden();
  expect(await saved(page)).toMatchObject({ look: 'kodak', lookFallbackDismissed: true });
  expect(await look(page)).toBe('kodak');

  // After a reload, a slow race on the ink look stays quiet.
  await page.reload();
  await page.locator('#start-screen').click();
  await race(page);
  await slowFrames(page, 60);
  // eslint-disable-next-line no-restricted-syntax -- the look fallback's watch judges slow frames over wall time by design
  await page.waitForTimeout(15_000);
  await expect(page.locator('#look-offer')).toBeHidden();
  await expect(page.locator('#pause-look-offer')).toBeHidden();
});

// The controls use forced slow frames too: a software-rendered runner's own frame rate on the ink
// look is too slow to serve as "smooth" (PR #232's first CI run offered on it), so smooth-frame
// behaviour is covered by the watch's unit tests (look-fallback.test.ts).
test('the controls: forced slow frames never offer on Classic, nor with the watch left off', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'mbrawl:settings',
      JSON.stringify({
        format: 'settings',
        version: 1,
        build: 'e2e',
        savedAt: '2026-10-01T00:00:00.000Z',
        data: { look: 'classic' },
      }),
    );
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  expect(await look(page)).toBe('classic');
  await race(page);
  await slowFrames(page, 60);
  // eslint-disable-next-line no-restricted-syntax -- the look fallback's watch judges slow frames over wall time by design
  await page.waitForTimeout(15_000);
  await expect(page.locator('#look-offer')).toBeHidden();

  // Under the test flag the watch is off unless a spec turns it on (other specs' long races).
  await page.addInitScript(() => {
    (window as TestWindow).__lookFallbackWatch = false;
    localStorage.removeItem('mbrawl:settings');
  });
  await page.reload();
  await page.locator('#start-screen').click();
  expect(await look(page)).toBe('kodak');
  await race(page);
  await slowFrames(page, 60);
  // eslint-disable-next-line no-restricted-syntax -- the look fallback's watch judges slow frames over wall time by design
  await page.waitForTimeout(15_000);
  await expect(page.locator('#look-offer')).toBeHidden();
});

// A phone held upright shows the rotate screen once the race starts (platform/), so the portrait
// size is a 412-wide window with a fine pointer, where the game does not ask.
test.describe('portrait', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: false, hasTouch: false });
  test('the offer fits a 412x915 portrait screen', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('./');
    await page.locator('#start-screen').click();
    await race(page);
    await slowFrames(page, 60);
    await expect(page.locator('#look-offer')).toBeVisible({ timeout: 40_000 });
    await slowFrames(page, 0);
    for (const b of await offerButtons(page, '#look-offer'))
      expect(b.inView && b.uncovered, `${b.id} on screen and uncovered`).toBe(true);
    await shot(page, 'offer-portrait');
  });
});
