import { expect, test } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { openQuickPlay } from './menu-navigation';

// narrative-1 in the real build: a rival barks at race start on the top ticker (playtest 3, the
// maintainer: "The black and white text pop-ups block the actual game"), a tag that names the
// speaker and a line from the base pack's bark sets with its content reference. The real strip's
// replacement/clear state is driven by its public test hook. Exact dwell, voice-tail and held-item
// expiry are injected-clock checks in ticker.test.ts; they are not wall-time browser guarantees.

interface BarkSetFile {
  id: string;
  lines: { id: string; text: string }[];
}
const LINES = new Map<string, string>();
for (const f of readdirSync('packs/base/barks')) {
  const set = JSON.parse(readFileSync(`packs/base/barks/${f}`, 'utf8')) as BarkSetFile;
  for (const l of set.lines) LINES.set(`base:bark-set/${set.id}#${l.id}`, l.text);
}

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { setBot(on: boolean): void };
  __uiTicker?: (
    items: { cls: string; text: string; tag?: string; contentRef?: string }[],
    hold?: boolean,
  ) => void;
};

test('a race-start rival bark is readable, and ticker replacement and clear use active state', async ({
  page,
}) => {
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
  await expect(page.locator('#menu-quick-play')).toBeVisible();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await openQuickPlay(page);
  await page.locator('#menu-race').click();

  const bubble = page.locator('#hud-ticker.up[data-cls="bark"]');
  await expect(bubble).toBeVisible({ timeout: 10_000 });
  // Everything about the painted line is read in one go, while it is up: a slow software-rendered
  // screenshot can outlast a 2 s bark, so nothing is measured after the screenshot.
  const seen = await bubble.evaluate((el) => {
    // Judged at rest: the strip's 100 ms fade-in can still be running on the frame it turns visible.
    for (const a of el.getAnimations()) a.finish();
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
      active: el.classList.contains('up'),
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
  expect(seen.active).toBe(true);
  expect(seen.fontSize).toBeGreaterThanOrEqual(12);
  expect(seen.fontSize).toBeLessThanOrEqual(15);
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/narrative-ticker.png' });

  // A bark-filtered locator cannot inspect another class replacing it. Clearing also leaves
  // hidden/data attributes unchanged until the fade timer fires. Read the stable root and .up,
  // with both old-oracle failures as negative controls, in one synchronous browser task.
  const transition = await page.evaluate(
    ({ ref, speaker, text }) => {
      const root = document.getElementById('hud-ticker');
      const replace = (window as TestWindow).__uiTicker;
      if (!root || !replace) throw new Error('Ticker and its public test hook are required');
      const original = { cls: 'bark', tag: speaker, text, contentRef: ref };
      const originalActive = () =>
        root.classList.contains('up') && root.dataset['cls'] === 'bark' && root.dataset['contentRef'] === ref;
      replace([original]);
      const activeBefore = originalActive();
      replace([{ cls: 'system', text: 'Replacement control' }]);
      const originalAfterReplacement = originalActive();
      const replacementActive = root.classList.contains('up') && root.dataset['cls'] === 'system';
      const oldLocatorMissesReplacement = document.querySelector('#hud-ticker[data-cls="bark"]') === null;
      replace([original]);
      const activeAgain = originalActive();
      replace([]);
      return {
        activeBefore,
        originalAfterReplacement,
        replacementActive,
        oldLocatorMissesReplacement,
        activeAgain,
        upAfterClear: root.classList.contains('up'),
        legacyGhostAfterClear:
          !root.hidden && root.dataset['cls'] === 'bark' && root.dataset['contentRef'] === ref,
      };
    },
    { ref, speaker, text },
  );
  expect(transition).toEqual({
    activeBefore: true,
    originalAfterReplacement: false,
    replacementActive: true,
    oldLocatorMissesReplacement: true,
    activeAgain: true,
    upAfterClear: false,
    legacyGhostAfterClear: true,
  });
  // The old black-on-white bubble is gone for good.
  await expect(page.locator('#bark-bubble')).toHaveCount(0);
  expect(problems).toEqual([]);
});
