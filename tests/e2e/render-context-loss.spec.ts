import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// render-1 (docs/milestones/M1.md): a browser test that forces a WebGL context loss sees the scene
// come back. It loses the game canvas's context with WEBGL_lose_context mid-race, checks that the
// context really is lost, restores it, and requires the rendered canvas to be a real scene again
// (not blank, and drawing as many calls as before the loss).

interface Stats {
  renderer: string;
  drawCalls: number;
  triangles: number;
}
interface Handle {
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
  rendererStats(): Stats;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

test('the scene comes back after a forced WebGL context loss', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  mkdirSync('test-results/screenshots', { recursive: true });
  const canvas = page.locator('canvas#game');

  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 120);

  const before = await pixelStats(
    page,
    await canvas.screenshot({ path: 'test-results/screenshots/render-context-before.png' }),
  );
  const statsBefore = (await page.evaluate(() => (window as TestWindow).__game?.rendererStats())) as Stats;
  console.log(`before loss: variance ${before.variance.toFixed(1)}, ${JSON.stringify(statsBefore)}`);
  expect(before.variance).toBeGreaterThan(NOT_BLANK_VARIANCE);

  // Lose the context through the same WebGL2 context the game renders with.
  await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas#game');
    const gl = c?.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context is not available');
    (window as unknown as { __loseExt: WEBGL_lose_context }).__loseExt = ext;
    ext.loseContext();
  });
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLCanvasElement>('canvas#game')?.getContext('webgl2')?.isContextLost() ===
      true,
  );
  console.log('context lost: isContextLost() === true');

  await page.evaluate(() =>
    (window as unknown as { __loseExt: WEBGL_lose_context }).__loseExt.restoreContext(),
  );
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLCanvasElement>('canvas#game')?.getContext('webgl2')?.isContextLost() ===
      false,
  );
  // Let a few frames render on the new context.
  const tickAtRestore = await page.evaluate<number>(
    () => (window as TestWindow).__game?.snapshot()?.tick ?? 0,
  );
  await page.waitForFunction(
    (t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > t + 30,
    tickAtRestore,
  );

  const after = await pixelStats(
    page,
    await canvas.screenshot({ path: 'test-results/screenshots/render-context-after.png' }),
  );
  const statsAfter = (await page.evaluate(() => (window as TestWindow).__game?.rendererStats())) as Stats;
  console.log(`after restore: variance ${after.variance.toFixed(1)}, ${JSON.stringify(statsAfter)}`);
  expect(after.variance, 'the restored scene is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);
  // The HUD alone over an empty canvas measured ~260 here; the scene measured ~2570 both times.
  expect(after.variance, 'the restored scene looks like the scene before the loss').toBeGreaterThan(
    before.variance * 0.5,
  );
  // Riders move in and out of view, so allow a little slack against the pre-loss count.
  expect(statsAfter.drawCalls, 'the restored scene draws the road and riders again').toBeGreaterThanOrEqual(
    Math.floor(statsBefore.drawCalls * 0.75),
  );
  expect(statsAfter.renderer).not.toBe('');
  expect(problems, 'no console errors or page errors').toEqual([]);
});
