import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// The scaffold's browser boot test (M1 infra-1): the page loads, a WebGL2 context exists, the
// renderer string is printed, there are no console errors and the canvas is not blank.
// E2E_EXPECT_STAMP (optional) must appear in the build stamp, e.g. the commit a deploy should serve.
test('boots with WebGL2, a stamp and a non-blank canvas', async ({ page }, testInfo) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()} ${res.url()}`);
  });

  await page.goto('./');
  const canvas = page.locator('canvas#game');
  await expect(canvas).toBeVisible();

  const renderer = await page.evaluate(() => {
    const c = document.querySelector('canvas#game');
    if (!(c instanceof HTMLCanvasElement)) return null;
    const gl = c.getContext('webgl2');
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  });
  expect(renderer, 'a WebGL2 context exists on the game canvas').not.toBeNull();
  console.log(`renderer: ${renderer}`);

  const stamp = page.locator('#build-stamp');
  await expect(stamp).toHaveText(/^throttlebrawl · (prod|staging|dev) · \S+ · [0-9a-f]{7}$/);
  const expected = process.env.E2E_EXPECT_STAMP;
  if (expected) await expect(stamp).toContainText(expected);
  console.log(`stamp: ${await stamp.textContent()}`);

  const png = await canvas.screenshot();
  mkdirSync('test-results/screenshots', { recursive: true });
  await canvas.screenshot({ path: `test-results/screenshots/boot-${testInfo.project.name}.png` });
  const stats = await pixelStats(page, png);
  console.log(
    `canvas: ${stats.pixels} px, luminance mean ${stats.mean.toFixed(1)}, variance ${stats.variance.toFixed(1)}`,
  );
  expect(stats.variance, 'the canvas is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);

  expect(problems, 'no console errors, page errors or failed requests').toEqual([]);
});
