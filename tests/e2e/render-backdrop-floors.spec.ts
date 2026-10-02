import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// The backdrop's far floors (far land and water) must never paint over the near world. A verifier
// found San Francisco's far ground drawn as a flat haze-coloured sheet over the bay beside the
// road (W-P, verify-skyline mustFix 1): San Francisco's own road, seed 3, bot, around tick 700, at
// the phone's landscape size. The bay lies right of the road there. This shoots that frame and
// checks the bay patch is sea, not the haze: it must stand well apart from the sky (whose colour
// is the haze's in the Classic look) at the top of the same frame.

interface Handle {
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
  setSeed(seed: number): void;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

/** Mean RGB of two rectangles of a PNG, decoded in the page. */
async function means(
  page: Page,
  png: Buffer,
  rects: readonly (readonly [number, number, number, number])[],
): Promise<[number, number, number][]> {
  return page.evaluate(
    async ([b64, rs]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      return rs.map(([x0, y0, x1, y1]) => {
        const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
        const sum = [0, 0, 0];
        for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += data[i + k] ?? 0;
        const n = data.length / 4;
        return [sum[0]! / n, sum[1]! / n, sum[2]! / n] as [number, number, number];
      });
    },
    [png.toString('base64'), rects] as const,
  );
}

test("San Francisco's far ground leaves the bay beside the road as sea (seed 3, tick 700, Classic)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    const record = {
      format: 'settings',
      version: 1,
      build: 'e2e',
      savedAt: '2026-10-01T00:00:00.000Z',
      data: { look: 'classic' },
    };
    localStorage.setItem('mbrawl:settings', JSON.stringify(record));
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#region-region-sf-san-francisco').click();
  await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    g?.setSeed(3);
    g?.setBot(true);
  });
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 700, null, {
    timeout: 180_000,
  });
  await page.locator('#hud-pause').click();
  // Hide the pause screen so the frame itself is shot.
  await page.addStyleTag({
    content: 'body *{visibility:hidden!important} canvas#game{visibility:visible!important}',
  });
  await page.waitForTimeout(500);
  mkdirSync('test-results/screenshots', { recursive: true });
  const png = await page
    .locator('canvas#game')
    .screenshot({ path: 'test-results/screenshots/backdrop-sf-floor-bay.png' });
  const [bay, sky] = await means(page, png, [
    [770, 300, 900, 360],
    [300, 8, 600, 40],
  ]);
  const apart = Math.abs(bay![0] - sky![0]) + Math.abs(bay![1] - sky![1]) + Math.abs(bay![2] - sky![2]);
  console.log(
    `[print] bay ${bay!.map(Math.round).join(',')}, sky ${sky!.map(Math.round).join(',')}, apart ${apart.toFixed(0)}`,
  );
  // The near bay (about 94,115,111 with no backdrop) against the haze sky (about 210,213,216); the
  // bad frame drew the bay as the haze itself (about 211,214,217).
  expect(apart, 'the bay beside the road is drawn as the haze').toBeGreaterThan(120);
});
