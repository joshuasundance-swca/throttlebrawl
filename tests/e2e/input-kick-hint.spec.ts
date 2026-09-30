import { expect, test } from '@playwright/test';

// Playtest 1 (2026-09-30), item 3: "Can't kick". The attack button carries a visible kick hint,
// drawn inside the button on the phone-landscape touch layout.

type TestWindow = Window & { __GAME_TEST__?: boolean };

test('the attack button shows a kick hint inside it', async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  const button = page.locator('#touch-attack');
  const hint = page.locator('#touch-kick-hint');
  await expect(button).toBeVisible();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('▼ kick');
  const b = (await button.boundingBox())!;
  const h = (await hint.boundingBox())!;
  const painted = await hint.evaluate((node) => {
    const s = getComputedStyle(node);
    return { color: s.color, opacity: Number(s.opacity), fontSize: parseFloat(s.fontSize) };
  });
  console.log(`kick hint: ${JSON.stringify({ button: b, hint: h, painted })}`);
  expect(painted.opacity).toBeGreaterThan(0.5);
  expect(painted.fontSize).toBeGreaterThanOrEqual(9);
  expect(h.x).toBeGreaterThanOrEqual(b.x);
  expect(h.y).toBeGreaterThanOrEqual(b.y);
  expect(h.x + h.width).toBeLessThanOrEqual(b.x + b.width);
  expect(h.y + h.height).toBeLessThanOrEqual(b.y + b.height);
  await button.screenshot({ path: 'test-results/output/kick-hint.png' });
});
