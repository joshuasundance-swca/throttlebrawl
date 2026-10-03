import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// narrative-2 in the real build (docs/milestones/M2.md, narrative-2, "Automated acceptance"):
// - a long-press (500 ms or more) on a rival's bark bubble opens "cut this" with the line on it,
//   and confirming cuts it: the content reference is then in the copied debug report;
// - a touch held on the bubble where it overlaps the stick zone is ignored mid-race, so the bubble
//   never steals a steering thumb; a touch on its part outside the zones works;
// - the pause screen's "recently seen" list cuts a line in two taps, and the report lists it too.
// The race is ridden by the stub bot. The billboard long-press in the paused scene waits for
// app-4's wire from render's pickContentAt.

interface Handle {
  setBot(on: boolean): void;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle; __copied?: string[] };

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

/** The bubble on screen now, or the next one (not `except`): its line, reference and box. */
async function nextBubble(page: Page, except = ''): Promise<SeenBubble> {
  const bubble = page.locator('#bark-bubble');
  await expect(async () => {
    await expect(bubble).toBeVisible();
    expect(await bubble.getAttribute('data-content-ref')).not.toBe(except);
  }).toPass({ timeout: 40_000 });
  return bubble.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      ref: el.getAttribute('data-content-ref') ?? '',
      text: el.querySelector('.bark-text')?.textContent ?? '',
      left: r.left,
      right: r.right,
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    };
  });
}

/** A synthetic touch held at (x, y) for `ms` (the window-level watcher sees it like a real one). */
async function holdTouch(page: Page, x: number, y: number, ms: number) {
  await page.evaluate(
    ({ x, y, ms }) => {
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
        // eslint-disable-next-line no-restricted-syntax -- a long-press hold: the veto's threshold is wall time by design
        setTimeout(() => {
          window.dispatchEvent(new PointerEvent('pointerup', init));
          done();
        }, ms),
      );
    },
    { x, y, ms },
  );
}

async function copiedReport(page: Page, button: string): Promise<string> {
  const before = await page.evaluate(() => (window as TestWindow).__copied?.length ?? 0);
  await page.locator(button).click();
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__copied?.length ?? 0))
    .toBeGreaterThan(before);
  return page.evaluate(() => (window as TestWindow).__copied?.at(-1) ?? '');
}

test('long-pressing a bark bubble cuts the line, and the copied debug report lists it', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await startRace(page);
  const menu = page.locator('#cut-menu');

  // The stick zone is the left 0.9 × the short side of the screen (packs/base/hud). A touch held on
  // the bubble inside it is steering, not a cut.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const stickRight = 0.9 * Math.min(viewport.width, viewport.height);
  const first = await nextBubble(page);
  expect(first.left + 10).toBeLessThan(stickRight);
  await holdTouch(page, first.left + 10, first.y, 600);
  await expect(menu).toHaveCount(0);

  // A mouse held still for 650 ms on a fresh bubble: "cut this", with the line on the card. The
  // bubble stays up while pressed, whatever its own time says.
  const seen = await nextBubble(page, first.ref);
  console.log(`bubble ${seen.ref}: "${seen.text}"`);
  expect(seen.ref).toMatch(/^base:bark-set\/[a-z0-9-]+#[a-z0-9-]+$/);
  await page.mouse.move(seen.x, seen.y);
  await page.mouse.down();
  // eslint-disable-next-line no-restricted-syntax -- a long-press hold: the veto's threshold is wall time by design
  await page.waitForTimeout(650);
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
    .locator('#bark-bubble')
    .evaluate((el) => !(el as HTMLElement).hidden && el.getAttribute('data-content-ref'));
  expect(still).not.toBe(seen.ref);

  // A touch on the bubble's part outside the stick and attack zones works mid-race.
  const third = await nextBubble(page, seen.ref);
  const outside = Math.max(third.x, stickRight + 10);
  expect(outside).toBeLessThan(third.right - 4);
  await holdTouch(page, outside, third.y, 600);
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
