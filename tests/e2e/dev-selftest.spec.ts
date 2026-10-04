import { expect, test } from '@playwright/test';

// `?selftest=1` (docs/milestones/M1.md, dev-2; M1 exit criterion 7): the browser runs the fixed
// self-test race and compares its final hash with the one Node baked into the build. CI's
// Chromium must say MATCH. The page's panel is what the maintainer reads on the phone.

test('?selftest=1 runs the self-test race and says MATCH', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('./?selftest=1');
  const panel = page.locator('#selftest');
  // The panel appears only once the lazy dev/ and self-test chunks have loaded, which is slow on a
  // loaded software-rendering runner: a separate 5 s wait for it to appear timed out on main
  // (2026-10-04, #431's push; the next main commit passed with the same code). So the spec waits on
  // the page's own done signal, the panel's `data-status` (set when the race ends), under the one
  // 90 s hang guard, and then the panel must be visible.
  await expect(panel).toHaveAttribute('data-status', /^(MATCH|MISMATCH|not-built)$/, { timeout: 90_000 });
  await expect(panel).toBeVisible();
  const text = (await panel.innerText()).replace(/\s+/g, ' ');
  console.log(`self-test panel: ${text}`);
  expect(await panel.getAttribute('data-status')).toBe('MATCH');
  expect(text).toMatch(/build ([0-9a-f]{8}) · here \1 · 3600 ticks/);
  // The panel is readable: inside the viewport, light text on a dark box.
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  if (box && viewport) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
  expect(errors).toEqual([]);
});
