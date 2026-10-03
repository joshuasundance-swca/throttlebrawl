import { expect, test } from '@playwright/test';
import { frames } from './lockstep';

/**
 * How long "the race stands still" is watched: drawn frames, the loop's own unit (it was 500 and
 * 750 ms of wall time, about 4 to 10 frames on a software-rendered CI runner). A running race
 * steps at least one tick in every frame or two at 60 Hz, and up to 4 a frame when slow.
 */
const STILL_FRAMES = 30;

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
  await frames(page, STILL_FRAMES);
  const later = await tick();
  console.log(`hidden: tick ${pausedAt} -> ${later} after ${STILL_FRAMES} drawn frames`);
  expect(later, 'no sim ticks while the page is hidden').toBe(pausedAt);
  expect(await page.evaluate(() => (window as TestWindow).__game?.state())).toBe('race');

  // A resume lands behind the pause menu, never straight back into the race (docs/architecture.md,
  // "Fixed timestep and the loop"): the race stays still until the player taps Resume.
  await setHidden(false);
  await expect(page.locator('#pause-screen')).toBeVisible();
  await frames(page, STILL_FRAMES);
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

// platform-2 (docs/milestones/M2.md): pagehide on its own (a tab swiped away, a bfcache entry)
// pauses the race too, and coming back through pageshow lands on the pause screen. The
// "recording written" half of the acceptance waits for replay-2 and app-4's wiring.
test('pagehide pauses the race, and pageshow lands on the pause screen', async ({ page }) => {
  const problems = watchProblems(page);
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30);
  const tick = () => page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? -1);

  // The page stays visible: only pagehide fires, so the pause comes from it alone.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  const pausedAt = await tick();
  await frames(page, STILL_FRAMES);
  const later = await tick();
  console.log(`pagehide: tick ${pausedAt} -> ${later} after ${STILL_FRAMES} drawn frames`);
  expect(later, 'no sim ticks after pagehide').toBe(pausedAt);
  expect(await page.evaluate(() => (window as TestWindow).__game?.state())).toBe('race');

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#pause-screen')).toBeVisible();
  await frames(page, STILL_FRAMES);
  expect(await tick(), 'still paused behind the pause menu').toBe(pausedAt);

  await page.locator('#pause-resume').click();
  await page.waitForFunction(
    (t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > t + 30,
    pausedAt,
  );
  expect(problems).toEqual([]);
});
