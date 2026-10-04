import { expect, test } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';

// narrative-1 in the real build: a rival barks at race start on the top ticker (playtest 3, the
// maintainer: "The black and white text pop-ups block the actual game"), a tag that names the
// speaker and a line from the base pack's bark sets with its content reference, and goes away after
// max(2 s, characters / 15 per second). The race is ridden by the stub bot.

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

test('a rival barks at race start in a readable ticker line that then goes away', async ({ page }) => {
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

  const bubble = page.locator('#hud-ticker[data-cls="bark"]');
  await expect(bubble).toBeVisible({ timeout: 10_000 });
  const shownAt = Date.now();
  // Everything about the painted line is read in one go, while it is up: a slow software-rendered
  // screenshot can outlast a 2 s bark, so nothing is measured after the screenshot.
  const seen = await bubble.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      ref: el.getAttribute('data-content-ref') ?? '',
      speaker: el.querySelector('.ticker-tag')?.textContent ?? '',
      text: el.querySelector('.ticker-text')?.textContent ?? '',
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

  // Painted, not just present: the strip has a real box on screen, inside the viewport, one slot
  // (at most 44 px) tall, never the old tall white plate.
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(20);
  expect(box.height).toBeLessThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(seen.opacity).toBe('1');
  expect(seen.visibility).toBe('visible');
  expect(seen.fontSize).toBeGreaterThanOrEqual(12);
  expect(seen.fontSize).toBeLessThanOrEqual(15);
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/narrative-ticker.png' });

  const durationS = Math.max(2, [...text].length / 15);
  // A voiced line (the maintainer, 2026-10-01: "Voices go in") keeps its subtitle up until the voice
  // finishes, and the next rival's bark may then follow it straight away: the line goes away when
  // the strip hides or shows another line.
  await expect
    .poll(
      () =>
        bubble.evaluate(
          (el: HTMLElement, first: string) =>
            el.hidden || el.dataset['cls'] !== 'bark' || el.getAttribute('data-content-ref') !== first,
          ref,
        ),
      { timeout: durationS * 1000 + 6000, intervals: [100] },
    )
    .toBe(true);
  const shownS = (Date.now() - shownAt) / 1000;
  console.log(`bark up about ${shownS.toFixed(2)} s (expected ${durationS.toFixed(2)} s)`);
  expect(shownS).toBeGreaterThan(durationS - 1);
  // The old black-on-white bubble is gone for good.
  await expect(page.locator('#bark-bubble')).toHaveCount(0);
  expect(problems).toEqual([]);
});
