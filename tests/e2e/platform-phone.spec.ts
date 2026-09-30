import { expect, test } from '@playwright/test';

// platform-1's browser acceptance (docs/milestones/M1.md): a failed orientation lock shows the
// rotate screen, and hiding the page pauses the race. Both run against the production build.

interface Handle {
  state(): string;
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

function watchProblems(page: import('@playwright/test').Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

test('a failed orientation lock on a portrait phone shows the rotate screen', async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    // The lock fails, as it does on a phone browser that refuses it.
    Object.defineProperty(screen.orientation, 'lock', {
      configurable: true,
      value: () => Promise.reject(new DOMException('lock refused by the test', 'NotSupportedError')),
    });
  });
  await page.goto('./');
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  console.log(`pointer coarse: ${coarse}`);
  await expect(page.locator('#rotate-screen')).toHaveCount(0);

  await page.locator('#start-screen').click();
  const rotate = page.locator('#rotate-screen');
  await expect(rotate).toBeVisible();
  await expect(rotate).toHaveText('Turn your phone sideways to ride.');
  expect(await page.evaluate(() => document.documentElement.dataset['rotate'])).toBe('needed');

  // Turning the phone sideways takes the screen away. (Headless Chromium grants fullscreen, and
  // a fullscreen window cannot be resized, so leave it first.)
  await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(rotate).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.dataset['rotate'])).toBe('ok');
  expect(problems).toEqual([]);
});

test('hiding the page pauses the race, and coming back lands on the pause screen', async ({ page }) => {
  const problems = watchProblems(page);
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30);

  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (h ? 'hidden' : 'visible'),
      });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  const tick = () => page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? -1);

  await setHidden(true);
  const pausedAt = await tick();
  await page.waitForTimeout(750);
  const later = await tick();
  console.log(`hidden: tick ${pausedAt} -> ${later} after 750 ms`);
  expect(later, 'no sim ticks while the page is hidden').toBe(pausedAt);
  expect(await page.evaluate(() => (window as TestWindow).__game?.state())).toBe('race');

  // A resume lands behind the pause menu, never straight back into the race (docs/architecture.md,
  // "Fixed timestep and the loop"): the race stays still until the player taps Resume.
  await setHidden(false);
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.waitForTimeout(500);
  const shownAt = await tick();
  console.log(`shown: pause screen up, tick ${shownAt}`);
  expect(shownAt, 'still paused behind the pause menu').toBe(pausedAt);

  await page.locator('#pause-resume').click();
  await page.waitForFunction(
    (t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > t + 30,
    pausedAt,
  );
  console.log(`resumed: tick ${await tick()}`);
  expect(problems).toEqual([]);
});
