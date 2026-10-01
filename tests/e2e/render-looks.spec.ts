import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { grainShare, NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// Playtest 1b item 6 (render/looks): the maintainer's favourite look, "Ink + 1960s film" (`kodak`),
// is a playable look next to `classic`, switchable in Settings. In a real browser:
// - both looks draw a real scene; kodak's film grain shows in the pixels and classic's flat
//   shading has none, and the switch works live in the middle of a race;
// - the look is render only: the same seeded bot race records the same replay hashes in both;
// - the kodak look's offscreen target comes back after a forced WebGL context loss.

interface Handle {
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
  rendererStats(): { drawCalls: number };
  debugFileText(): string;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

/** Starts the game with a saved look (none: the default), the bot racing. */
async function race(page: Page, look?: string) {
  await page.addInitScript((lk) => {
    (window as TestWindow).__GAME_TEST__ = true;
    if (lk) {
      const record = {
        format: 'settings',
        version: 1,
        build: 'e2e',
        savedAt: '2026-09-30T00:00:00.000Z',
        data: { look: lk },
      };
      localStorage.setItem('mbrawl:settings', JSON.stringify(record));
    }
  }, look);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
}

const tick = (page: Page) => page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? 0);
const waitTick = (page: Page, t: number) =>
  page.waitForFunction((n) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) >= n, t, {
    timeout: 120_000,
  });

async function frame(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  const png = await page
    .locator('canvas#game')
    .screenshot({ path: `test-results/screenshots/looks-${name}.png` });
  const stats = await pixelStats(page, png);
  const grain = await grainShare(page, png);
  console.log(
    `${name}: luminance mean ${stats.mean.toFixed(1)}, variance ${stats.variance.toFixed(0)}, grain ${grain.toFixed(3)}`,
  );
  return { ...stats, grain };
}

/** Pause, Settings > Display > Look, back, resume: the path a player takes mid-race. */
async function pickLook(page: Page, look: 'classic' | 'kodak') {
  await page.keyboard.press('Escape');
  await page.locator('#pause-controls').click();
  await page.locator('#settings-tab-display').click();
  await page.locator(`#settings-look button[data-value="${look}"]`).click();
  await expect(page.locator(`#settings-look button[data-value="${look}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('#settings-back').click();
  await page.locator('#pause-resume').click();
}

test('both looks draw a real scene; the ink + film look has film grain and switches live mid-race', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = watchErrors(page);
  await race(page);
  await waitTick(page, 150);
  const classic = await frame(page, 'classic');
  expect(classic.variance, 'classic is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);

  await pickLook(page, 'kodak');
  await waitTick(page, (await tick(page)) + 30);
  const kodak = await frame(page, 'kodak');
  expect(kodak.variance, 'kodak is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);
  // Flat shading has almost no small neighbour steps; the grain puts them nearly everywhere.
  expect(classic.grain, 'classic has no film grain').toBeLessThan(0.15);
  expect(kodak.grain, 'kodak has film grain').toBeGreaterThan(0.4);

  await pickLook(page, 'classic');
  await waitTick(page, (await tick(page)) + 30);
  const back = await frame(page, 'classic-again');
  expect(back.variance).toBeGreaterThan(NOT_BLANK_VARIANCE);
  expect(back.grain, 'switching back removes the grain').toBeLessThan(0.15);
  expect(problems).toEqual([]);
});

test('the look is render only: the same seeded bot race records the same replay hashes in both looks', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const hashesOf = async (look: 'classic' | 'kodak') => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await race(page, look);
    await waitTick(page, 610);
    const text = await page.evaluate(() => (window as TestWindow).__game?.debugFileText() ?? '');
    await context.close();
    const m = /"hashes":(\[[^\]]*\])/.exec(text);
    return JSON.parse(m?.[1] ?? '[]') as { tick: number; hash: number }[];
  };
  const classic = await hashesOf('classic');
  const kodak = await hashesOf('kodak');
  const upTo = (h: { tick: number }[]) => h.filter((x) => x.tick <= 600);
  console.log(`replay hashes compared: ${upTo(classic).length} checkpoints (ticks 0 to 600), every 60 ticks`);
  expect(upTo(classic).length).toBe(11);
  expect(upTo(kodak)).toEqual(upTo(classic));
});

test('the ink + film look comes back after a forced WebGL context loss', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await race(page, 'kodak');
  await waitTick(page, 120);
  const before = await frame(page, 'kodak-before-loss');
  expect(before.grain).toBeGreaterThan(0.4);
  await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>('canvas#game')?.getContext('webgl2');
    (window as unknown as { __lose?: WEBGL_lose_context | null | undefined }).__lose =
      gl?.getExtension('WEBGL_lose_context');
    (window as unknown as { __lose?: WEBGL_lose_context | null | undefined }).__lose?.loseContext();
  });
  await page.waitForTimeout(300);
  const lost = await page.evaluate(
    () =>
      document.querySelector<HTMLCanvasElement>('canvas#game')?.getContext('webgl2')?.isContextLost() ??
      false,
  );
  expect(lost, 'the context really was lost').toBe(true);
  await page.evaluate(() =>
    (window as unknown as { __lose?: WEBGL_lose_context | null | undefined }).__lose?.restoreContext(),
  );
  const at = await tick(page);
  await waitTick(page, at + 60);
  const after = await frame(page, 'kodak-after-loss');
  expect(after.variance, 'the scene is back').toBeGreaterThan(NOT_BLANK_VARIANCE);
  expect(after.grain, 'still the kodak look').toBeGreaterThan(0.4);
  expect(problems.filter((p) => !/context/i.test(p))).toEqual([]);
});
