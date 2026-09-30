import { expect, test } from '@playwright/test';

// `?debug=1` (docs/milestones/M1.md, dev-2): an overlay with frames per second, frame time, the
// renderer string and the measured display refresh rate. It must show real numbers during a race
// and stay out of the way of touches.

test('?debug=1 shows fps, frame time, sim step, refresh rate and the renderer', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    (window as Window & { __GAME_TEST__?: boolean }).__GAME_TEST__ = true;
  });
  await page.goto('./?debug=1');
  const overlay = page.locator('#debug-overlay');
  await expect(overlay).toBeVisible();
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await page.waitForFunction(
    () =>
      ((window as Window & { __game?: { snapshot(): { tick: number } | null } }).__game?.snapshot()?.tick ??
        0) > 180,
  );
  await page.waitForTimeout(600); // the overlay refreshes four times a second
  const text = await overlay.innerText();
  console.log(`debug overlay: ${text.replace(/\n/g, ' | ')}`);
  expect(text).toMatch(
    /^\d+ fps · frame \d+\.\d ms \(p95 \d+\.\d\) · sim \d+\.\d\d ms p95 · \d+ Hz display · \d+ draws · /,
  );
  expect(Number(/^(\d+) fps/.exec(text)?.[1])).toBeGreaterThan(0);
  expect(Number(/ (\d+) draws/.exec(text)?.[1])).toBeGreaterThan(0);
  // The second line is the renderer string, the same one the renderer reports.
  const renderer = await page.evaluate(
    () =>
      (window as Window & { __game?: { rendererStats(): { renderer: string } } }).__game?.rendererStats()
        .renderer ?? '',
  );
  expect(renderer.length).toBeGreaterThan(0);
  expect(text.split('\n')[1]).toBe(renderer);
  // It never takes touches.
  expect(await overlay.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
});
