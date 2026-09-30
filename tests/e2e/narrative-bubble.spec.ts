import { expect, test } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';

// narrative-1 in the real build: a rival barks at race start in a text bubble that names the
// speaker, shows a line from the base pack's bark sets with its content reference, and goes
// away after max(2 s, characters / 15 per second). The race is ridden by the stub bot.

interface BarkSetFile {
  id: string;
  lines: { id: string; text: string }[];
}
const LINES = new Map<string, string>();
for (const f of readdirSync('packs/base/barks')) {
  const set = JSON.parse(readFileSync(`packs/base/barks/${f}`, 'utf8')) as BarkSetFile;
  for (const l of set.lines) LINES.set(`base:bark-set/${set.id}#${l.id}`, l.text);
}

type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: { setBot(on: boolean): void } };

test('a rival barks at race start in a readable bubble that then goes away', async ({ page }) => {
  test.setTimeout(60_000);
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
  await expect(bubble).toBeVisible({ timeout: 10_000 });
  const shownAt = Date.now();
  // Everything about the painted bubble is read in one go, while it is up: a slow software-rendered
  // screenshot can outlast a 2 s bubble, so nothing is measured after the screenshot.
  const seen = await bubble.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      ref: el.getAttribute('data-content-ref') ?? '',
      speaker: el.querySelector('.bark-speaker')?.textContent ?? '',
      text: el.querySelector('.bark-text')?.textContent ?? '',
      box: { x: r.x, y: r.y, width: r.width, height: r.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      opacity: s.opacity,
      visibility: s.visibility,
      fontSize: parseFloat(s.fontSize),
    };
  });
  const { ref, speaker, text, box, viewport } = seen;
  console.log(`bark: ${speaker}: "${text}" (${ref}); box ${JSON.stringify(box)}`);
  expect(LINES.get(ref), `${ref} is a base-pack line`).toBe(text);
  expect(ref).toMatch(/#.+-start-/);
  expect(speaker.length).toBeGreaterThan(0);

  // Painted, not just present: the bubble has a real box on screen, inside the viewport.
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(30);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(seen.opacity).toBe('1');
  expect(seen.visibility).toBe('visible');
  expect(seen.fontSize).toBeGreaterThanOrEqual(18);
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/narrative-bubble.png' });

  const durationS = Math.max(2, [...text].length / 15);
  await expect(bubble).toBeHidden({ timeout: durationS * 1000 + 2000 });
  const shownS = (Date.now() - shownAt) / 1000;
  console.log(`bubble up about ${shownS.toFixed(2)} s (expected ${durationS.toFixed(2)} s)`);
  expect(shownS).toBeGreaterThan(durationS - 1);
  expect(problems).toEqual([]);
});
