import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// narrative-2 in the real build: a long-press (500 ms or more) on a rival's bark bubble opens
// "cut this" with the line on it; confirming cuts it and says so. A touch on the bubble mid-race is
// ignored while the narrative does not know where the stick and attack zones are, so the bubble
// can never steal a steering thumb. The race is ridden by the stub bot. (The flag reaching the
// settings record and the copied debug report needs ui/'s wire, a follow-up: see the lane report.)

type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: { setBot(on: boolean): void } };

test('long-pressing a bark bubble offers "cut this", and cutting it confirms', async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();

  const bubble = page.locator('#bark-bubble');
  // The bubble on screen now, or the next one: its line, reference and centre.
  const nextBubble = async () => {
    await expect(bubble).toBeVisible({ timeout: 30_000 });
    return bubble.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        ref: el.getAttribute('data-content-ref') ?? '',
        text: el.querySelector('.bark-text')?.textContent ?? '',
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
      };
    });
  };

  // A touch held on the bubble mid-race: ignored (no zones known), and nothing else happens.
  const touched = await nextBubble();
  await page.evaluate(({ x, y }) => {
    const init = {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: x,
      clientY: y,
      bubbles: true,
    };
    window.dispatchEvent(new PointerEvent('pointerdown', init));
    return new Promise<void>((done) =>
      setTimeout(() => {
        window.dispatchEvent(new PointerEvent('pointerup', init));
        done();
      }, 600),
    );
  }, touched);
  await expect(page.locator('#cut-menu')).toHaveCount(0);

  // A fresh bubble for the mouse, so its own time cannot run out before the press starts.
  await expect(bubble).toBeHidden({ timeout: 10_000 });
  const seen = await nextBubble();
  console.log(`bubble ${seen.ref}: "${seen.text}" at ${Math.round(seen.x)},${Math.round(seen.y)}`);
  expect(seen.ref).toMatch(/^base:bark-set\/[a-z0-9-]+#[a-z0-9-]+$/);

  // A mouse held still for 650 ms: "cut this", with the line on the card. The bubble stays up
  // while pressed, whatever its own time says.
  await page.mouse.move(seen.x, seen.y);
  await page.mouse.down();
  await page.waitForTimeout(650);
  const menu = page.locator('#cut-menu');
  await expect(menu).toBeVisible();
  await page.mouse.up();
  await expect(menu).toHaveAttribute('data-content-ref', seen.ref);
  await expect(menu.locator('.cut-label')).toContainText(seen.text);
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  if (box && viewport) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeGreaterThan(60);
  }
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/narrative-cut-menu.png' });

  await page.locator('#cut-confirm').click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#cut-done')).toBeVisible();
  await expect(page.locator('#cut-done')).toContainText('Cut');
  // The cut line is gone from the screen at once.
  const still = await bubble.evaluate(
    (el) => !(el as HTMLElement).hidden && el.getAttribute('data-content-ref'),
  );
  expect(still).not.toBe(seen.ref);
  expect(problems).toEqual([]);
});
