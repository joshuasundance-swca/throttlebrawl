import { expect, test, type Page } from '@playwright/test';

// Roadmap M5, the A16 speed pass (docs/architecture.md, "Quality tiers and dynamic resolution"):
// through the real loop and renderer, frames that stay slow step the scene's resolution down (never
// under the readable floor) and, on Auto, drop the quality tier and keep it for the device; a pinned
// tier holds while the resolution moves inside it. The governor's own rules (rising again, the
// budget, hysteresis) are unit-tested frame by frame in src/render/quality.test.ts. Slow frames are
// forced with `window.__slowFrameMs` (a busy wait in every drawn frame). Not phone-verified.

interface Quality {
  setting: string;
  tier: string;
  scale: number;
  pixelRatio: number;
  on: boolean;
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __dynamicResolution?: boolean;
  __slowFrameMs?: number;
  __game?: { state(): string; snapshot(): { tick: number } | null; setBot(on: boolean): void };
  __app?: { presentation(): { display: { quality: Quality } } };
};

/** The governor is off under the test flag unless a spec turns it on (app/index.ts, qualityOn). */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    (window as TestWindow).__dynamicResolution = true;
  });
});

const quality = (page: Page) =>
  page.evaluate(() => (window as TestWindow).__app?.presentation().display.quality ?? null);

async function race(page: Page) {
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => {
    const g = (window as TestWindow).__game;
    return g?.state() === 'race' && (g.snapshot()?.tick ?? 0) > 10;
  });
}

test('slow frames soften the picture to the readable floor and drop the Auto tier, kept for the device', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('./');
  await page.locator('#start-screen').click();
  const start = await quality(page);
  console.log(`quality at the menu: ${JSON.stringify(start)}`);
  expect(start).toMatchObject({ setting: 'auto', tier: 'high', scale: 1, on: true });
  const fullRatio = start?.pixelRatio ?? 0;
  const floor = Math.min(fullRatio, 0.75);

  await race(page);
  await page.evaluate(() => ((window as TestWindow).__slowFrameMs = 60));
  // A hang guard, not a deadline: the governor judges frame time, which these frames supply.
  await page.waitForFunction(
    () => {
      const q = (window as TestWindow).__app?.presentation().display.quality;
      return q?.tier === 'low';
    },
    undefined,
    { timeout: 60_000 },
  );
  const low = await quality(page);
  console.log(`quality after slow frames: ${JSON.stringify(low)}`);
  expect(low?.pixelRatio).toBeLessThan(fullRatio);
  expect(low?.pixelRatio).toBeGreaterThanOrEqual(floor - 1e-9);
  const stored = await page.evaluate(() => localStorage.getItem('mbrawl:quality'));
  expect(JSON.parse(stored ?? 'null')).toEqual({ tier: 'low' });

  // The next session starts on the tier this device settled on.
  await page.evaluate(() => ((window as TestWindow).__slowFrameMs = 0));
  await page.reload();
  await page.locator('#start-screen').click();
  expect(await quality(page)).toMatchObject({ setting: 'auto', tier: 'low' });
  expect(problems).toEqual([]);
});

test('a pinned tier holds under slow frames while the resolution steps down inside it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'mbrawl:settings',
      JSON.stringify({
        format: 'settings',
        version: 1,
        build: 'e2e',
        savedAt: '2026-10-05T00:00:00.000Z',
        data: { qualityTier: 'high' },
      }),
    );
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  const start = await quality(page);
  expect(start).toMatchObject({ setting: 'high', tier: 'high', scale: 1 });
  await race(page);
  await page.evaluate(() => ((window as TestWindow).__slowFrameMs = 60));
  await page.waitForFunction(
    () => ((window as TestWindow).__app?.presentation().display.quality.scale ?? 1) <= 0.75,
    undefined,
    { timeout: 60_000 },
  );
  // Past the frames Auto would need to drop a tier (4 more judged windows of 0.5 s at the floor).
  const tick = await page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? 0);
  await page.waitForFunction((t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > t + 240, tick, {
    timeout: 60_000,
  });
  const held = await quality(page);
  console.log(`pinned high after slow frames: ${JSON.stringify(held)}`);
  expect(held).toMatchObject({ setting: 'high', tier: 'high', scale: 0.75 });
  expect(held?.pixelRatio).toBeLessThan(start?.pixelRatio ?? 0);
});
