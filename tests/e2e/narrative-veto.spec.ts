import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// narrative-2 in the real build (docs/milestones/M2.md, narrative-2, "Automated acceptance"):
// - a long-press (500 ms or more) on a rival's bark on the top ticker opens "cut this" with the line on it,
//   and confirming cuts it: the content reference is then in the copied debug report;
// - a touch held on the ticker where it overlaps the stick zone is ignored mid-race, so the ticker
//   never steals a steering thumb; a touch on its part outside the zones works;
// - the pause screen's "recently seen" list cuts a line in two taps, and the report lists it too.
// The race is ridden by the stub bot. The billboard long-press in the paused scene waits for
// app-4's wire from render's pickContentAt.
// The press is timed by ui's manual long-press clock (`__uiLongPressManual`, `__uiLongPress`,
// docs/architecture.md, "Testing seams"), not by the wall: a press is held for 500 ms by
// advancing the clock 500 ms, so a slow runner's frame rate cannot make the spec flake. The
// 500 ms rule itself is unit-tested (src/ui/narrative/long-press.ts, bubble-press.test.ts).

interface Handle {
  setBot(on: boolean): void;
}
interface PressClock {
  advance(ms: number): void;
  pending(): number;
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __uiLongPressManual?: boolean;
  __uiLongPress?: PressClock;
  __game?: Handle;
  __copied?: string[];
};

/** The long-press threshold (VETO_LONG_PRESS_MS, docs/architecture.md, "The gesture"). */
const LONG_PRESS_MS = 500;

interface SeenBubble {
  ref: string;
  text: string;
  left: number;
  right: number;
  x: number;
  y: number;
}

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

async function startRace(page: Page) {
  await page.addInitScript(() => {
    const w = window as TestWindow;
    w.__GAME_TEST__ = true;
    w.__uiLongPressManual = true;
    w.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          w.__copied?.push(text);
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
}

/** The bark on the ticker now, or the next one (not `except`): its line, reference and box. */
async function nextBubble(page: Page, except = ''): Promise<SeenBubble> {
  const bubble = page.locator('#hud-ticker[data-cls="bark"]');
  await expect(async () => {
    await expect(bubble).toBeVisible();
    expect(await bubble.getAttribute('data-content-ref')).not.toBe(except);
  }).toPass({ timeout: 40_000 });
  return bubble.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      ref: el.getAttribute('data-content-ref') ?? '',
      text: el.querySelector('.ticker-text')?.textContent ?? '',
      left: r.left,
      right: r.right,
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    };
  });
}

/** Moves the long-press clock on by `ms` and returns how many presses are still timing before it. */
async function advancePress(page: Page, ms: number): Promise<number> {
  return page.evaluate((ms) => {
    const clock = (window as TestWindow).__uiLongPress;
    if (!clock) throw new Error('no __uiLongPress: the manual long-press clock is not installed');
    const pending = clock.pending();
    clock.advance(ms);
    return pending;
  }, ms);
}

/**
 * A synthetic touch held at (x, y) for `ms` of the long-press clock (the window-level watcher sees it
 * like a real one). Returns how many presses were timing while it was held: 1 if the watcher took
 * the touch for a possible cut, 0 if it ignored it (the stick zone).
 */
async function holdTouch(page: Page, x: number, y: number, ms: number): Promise<number> {
  const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true };
  await page.evaluate((init) => window.dispatchEvent(new PointerEvent('pointerdown', init)), init);
  const timing = await advancePress(page, ms);
  await page.evaluate((init) => window.dispatchEvent(new PointerEvent('pointerup', init)), init);
  return timing;
}

async function copiedReport(page: Page, button: string): Promise<string> {
  const before = await page.evaluate(() => (window as TestWindow).__copied?.length ?? 0);
  await page.locator(button).click();
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__copied?.length ?? 0))
    .toBeGreaterThan(before);
  return page.evaluate(() => (window as TestWindow).__copied?.at(-1) ?? '');
}

test('long-pressing a bark on the ticker cuts the line, and the copied debug report lists it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await startRace(page);
  const menu = page.locator('#cut-menu');

  // The stick zone is the left 0.9 × the short side of the screen (packs/base/hud). A touch held on
  // the ticker inside it is steering, not a cut.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const stickRight = 0.9 * Math.min(viewport.width, viewport.height);
  const first = await nextBubble(page);
  expect(first.left + 10).toBeLessThan(stickRight);
  expect(await holdTouch(page, first.left + 10, first.y, 10 * LONG_PRESS_MS)).toBe(0);
  await expect(menu).toHaveCount(0);

  // A mouse held still for 500 ms on a fresh bark: "cut this", with the line on the card. A tick
  // short of the threshold it is still closed.
  const seen = await nextBubble(page, first.ref);
  console.log(`bubble ${seen.ref}: "${seen.text}"`);
  expect(seen.ref).toMatch(/^base:bark-set\/[a-z0-9-]+#[a-z0-9-]+$/);
  await page.mouse.move(seen.x, seen.y);
  await page.mouse.down();
  expect(await advancePress(page, LONG_PRESS_MS - 1)).toBe(1);
  await expect(menu).toHaveCount(0);
  await advancePress(page, 1);
  await expect(menu).toBeVisible();
  await page.mouse.up();
  await expect(menu).toHaveAttribute('data-content-ref', seen.ref);
  await expect(menu.locator('.cut-label')).toContainText(seen.text);
  const box = await menu.boundingBox();
  expect(box).toBeTruthy();
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeGreaterThan(60);
  }
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/narrative-cut-menu.png' });
  await page.locator('#cut-confirm').click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#cut-done')).toContainText('Cut');
  const still = await page
    .locator('#hud-ticker')
    .evaluate((el) => !(el as HTMLElement).hidden && el.getAttribute('data-content-ref'));
  expect(still).not.toBe(seen.ref);

  // A touch on the ticker's part outside the stick and attack zones works mid-race.
  const third = await nextBubble(page, seen.ref);
  const outside = Math.max(third.x, stickRight + 10);
  expect(outside).toBeLessThan(third.right - 4);
  expect(await holdTouch(page, outside, third.y, LONG_PRESS_MS)).toBe(1);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-content-ref', third.ref);
  await page.locator('#cut-keep').click();
  await expect(menu).toBeHidden();

  // The flag reached the settings record: the copied report lists it, and only the cut one.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  const report = await copiedReport(page, '#pause-copy-report');
  const line = report.split('\n').find((l) => l.includes('vetoes')) ?? '';
  console.log(line);
  expect(line).toContain(seen.ref);
  expect(line).not.toContain(third.ref);
  expect(problems).toEqual([]);
});

test('the pause screen lists what you saw, and two taps cut a line into the report', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await startRace(page);
  const seen = await nextBubble(page);
  await page.keyboard.press('Escape');
  const list = page.locator('#pause-screen #recently-seen');
  await expect(list).toBeVisible();
  const row = list.locator(`.rs-item[data-content-ref="${seen.ref}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(seen.text);
  // Painted inside the screen, and the pause buttons stay reachable.
  const rowBox = await row.boundingBox();
  const viewport = page.viewportSize();
  expect(rowBox && viewport && rowBox.y + rowBox.height <= viewport.height).toBeTruthy();
  await expect(page.locator('#pause-resume')).toBeInViewport();
  await page.screenshot({ path: 'test-results/screenshots/narrative-recently-seen.png' });

  // Two taps: the row, then "Cut this".
  await row.click();
  await page.locator('#cut-confirm').click();
  await expect(page.locator('#cut-menu')).toBeHidden();
  await expect(row).toHaveCount(0);
  const report = await copiedReport(page, '#pause-copy-report');
  const line = report.split('\n').find((l) => l.includes('vetoes')) ?? '';
  console.log(line);
  expect(line).toContain(seen.ref);
  expect(problems).toEqual([]);
});
