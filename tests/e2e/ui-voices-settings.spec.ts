import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Run W-O (maintainer, 2026-10-01: "Extend 'cut this' to voice lines; add a Voices volume and an
// off switch"): the Sound tab draws the Voices slider at 80% and a "Voices on" switch, checked, for
// a new save. The switch silences the voices bus (audio's own bus target) and keeps the slider's
// level; both survive a reload. Drawn at the phone's landscape and portrait sizes.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __app?: { presentation(): { audio: { busTargets: { voices: number } } } };
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
});

const voicesBus = (page: Page) =>
  page.evaluate(() => (window as TestWindow).__app?.presentation().audio.busTargets.voices ?? -1);

async function soundTab(page: Page) {
  await page.locator('#start-screen').click();
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-sound').click();
}

async function shot(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/ui-voices-${name}.png` });
}

/** The visible box of an element, or null. */
const box = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const e = document.querySelector<HTMLElement>(s);
    if (!e || !e.checkVisibility()) return null;
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
  }, sel);

/**
 * Controls and row labels on the Sound tab that another drawn element overlaps: the build stamp in
 * the corner, or a control or label of another row. Measured as box overlap, because the UI ignores
 * the pointer outside its controls, so hit-testing cannot see a label drawn under the stamp.
 */
const covered = (page: Page) =>
  page.evaluate(() => {
    const pane = '#settings-pane-sound';
    const items = [
      ...document.querySelectorAll<HTMLElement>(
        `${pane} input, ${pane} button, ${pane} .setting-label, ${pane} .toggles label, ${pane} output`,
      ),
    ].filter((e) => e.checkVisibility());
    const stamp = document.getElementById('build-stamp');
    const others = stamp && stamp.checkVisibility() ? [stamp] : [];
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const out: string[] = [];
    for (const e of items) {
      const r = e.getBoundingClientRect();
      for (const o of others)
        if (hit(r, o.getBoundingClientRect())) out.push(`${e.id || e.textContent} under #${o.id}`);
    }
    return out;
  });

test('a new save: the Voices slider at 80% and Voices on; off silences the voices bus and survives a reload', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('./');
  await soundTab(page);

  // Rendered: the slider reads 80%, the switch is on and labelled, and both sit on the screen.
  await expect(page.locator('#settings-volume-voices')).toBeVisible();
  await expect(page.locator('#settings-volume-voices-value')).toHaveText('80%');
  await expect(page.locator('#settings-voicesOn')).toBeVisible();
  await expect(page.locator('#settings-voicesOn')).toBeChecked();
  await expect(page.locator('[data-setting="voicesOn"]')).toContainText('Voices on');
  for (const sel of ['#settings-volume-voices', '[data-setting="voicesOn"]']) {
    const b = await box(page, sel);
    expect(b, `${sel} is drawn`).not.toBeNull();
    if (b)
      expect(b.right <= b.vw && b.bottom <= b.vh && b.left >= 0 && b.top >= 0, `${sel} on screen`).toBe(true);
  }
  expect(await covered(page), 'nothing draws over the Sound tab').toEqual([]);
  // 0.8 through audio's squared taper.
  expect(await voicesBus(page)).toBeCloseTo(0.64, 5);
  await shot(page, 'sound-landscape');

  // Off: the voices bus goes silent and the slider keeps its level.
  await page.locator('#settings-voicesOn').uncheck();
  expect(await voicesBus(page)).toBe(0);
  await expect(page.locator('#settings-volume-voices-value')).toHaveText('80%');
  // The slider moved while off stays silent too.
  await page.locator('#settings-volume-voices').fill('50');
  await expect(page.locator('#settings-volume-voices-value')).toHaveText('50%');
  expect(await voicesBus(page)).toBe(0);

  // Kept across a reload: still off, still 50%, still silent.
  await page.reload();
  await soundTab(page);
  await expect(page.locator('#settings-voicesOn')).not.toBeChecked();
  await expect(page.locator('#settings-volume-voices-value')).toHaveText('50%');
  expect(await voicesBus(page)).toBe(0);

  // On again: the bus returns to the slider's level.
  await page.locator('#settings-voicesOn').check();
  expect(await voicesBus(page)).toBeCloseTo(0.25, 5);
  expect(problems).toEqual([]);
});

// A phone held upright shows the rotate screen once the start tap lands (platform/), so the
// portrait size is drawn as a 412-wide window with a fine pointer, where the game does not ask.
test.describe('portrait', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: false, hasTouch: false });
  test('the Sound tab with the voices rows fits a 412x915 portrait screen', async ({ page }) => {
    await page.goto('./');
    await soundTab(page);
    for (const sel of [
      '#settings-volume-voices',
      '#settings-volume-voices-value',
      '[data-setting="voicesOn"]',
    ]) {
      const b = await box(page, sel);
      expect(b, `${sel} is drawn`).not.toBeNull();
      if (b) expect(b.right <= b.vw + 0.5 && b.left >= -0.5, `${sel} inside the width`).toBe(true);
    }
    expect(await covered(page), 'nothing draws over the Sound tab').toEqual([]);
    await shot(page, 'sound-portrait');
  });
});
