import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { grainShare, NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// Playtest 1b item 6 (render/looks): the maintainer's favourite look, "Ink + 1960s film" (`kodak`),
// is a playable look next to `classic`, switchable in Settings. In a real browser:
// - both looks draw a real scene; kodak's film grain shows in the pixels and classic's flat
//   shading has none, and the switch works live in the middle of a race;
// - the look is render only: the same seeded bot race records the same replay hashes in both;
// - the kodak look's offscreen target comes back after a forced WebGL context loss.
// Playtest 1c item 5 adds "Sun-bleached wasteland" (`wasteland`) and "Kodachrome brush" (`brush`) on
// the same ink pipeline: each draws, switches live, paints its own sky, and keeps the replay hashes.

/** Every look, in the settings row's order (render/looks LOOK_IDS). */
const LOOKS = ['classic', 'kodak', 'wasteland', 'brush'] as const;
type Look = (typeof LOOKS)[number];

interface Handle {
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
  setSeed(seed: number): void;
  freePlayTimeOfDay(seed: number): string;
  rendererStats(): { drawCalls: number };
  debugFileText(): string;
  lockstep(steps: number | null): void;
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

/**
 * Starts the game with a saved look (none: the default), the bot racing. With `light`, the race runs
 * on the first seed whose free-play time of day is that one (a region's sky colour, when its time of
 * day sets one, leans every look's sky toward it, so the skies' own colours read only at a known light).
 * With `steps`, the race rides the loop's lockstep at that many ticks a drawn frame, every frame
 * still drawn (as bot-race.spec.ts rides): the race is the same tick for tick at any lockstep.
 */
async function race(page: Page, look?: string, light?: string, steps?: number) {
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
  if (light) {
    const seed = await page.evaluate((want) => {
      const g = (window as TestWindow).__game;
      for (let s = 1; s <= 24; s++) if (g?.freePlayTimeOfDay(s) === want) return s;
      return null;
    }, light);
    expect(seed, `a seed in 1 to 24 races at ${light}`).not.toBeNull();
    await page.evaluate((s) => (window as TestWindow).__game?.setSeed(s!), seed);
  }
  await page.evaluate((n) => {
    const g = (window as TestWindow).__game;
    g?.setBot(true);
    if (n !== undefined) g?.lockstep(n);
  }, steps);
  await page.locator('#menu-race').click();
}

const tick = (page: Page) => page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? 0);
const waitTick = (page: Page, t: number) =>
  page.waitForFunction((n) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) >= n, t, {
    timeout: 120_000,
  });

async function frame(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  // The ticker strip (playtest 3) sits in the top-centre band the sky is sampled from, and the live
  // meter keeps it up most of the race, so it is hidden for the capture: this spec measures the scene.
  const png = await page.locator('canvas#game').screenshot({
    path: `test-results/screenshots/looks-${name}.png`,
    style: '#hud-ticker { visibility: hidden !important; }',
  });
  const stats = await pixelStats(page, png);
  const grain = await grainShare(page, png);
  const sky = await skyColour(page, png);
  console.log(
    `${name}: luminance mean ${stats.mean.toFixed(1)}, variance ${stats.variance.toFixed(0)}, grain ${grain.toFixed(3)}, sky rgb ${sky.map((v) => v.toFixed(0)).join(',')}`,
  );
  return { ...stats, grain, sky };
}

/** The mean colour of a strip of open sky: the top of the frame (the ticker hidden) and clear of the HUD corners. */
async function skyColour(page: Page, png: Buffer): Promise<[number, number, number]> {
  return page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const x0 = Math.floor(img.width * 0.3);
    const w = Math.floor(img.width * 0.4);
    const y0 = Math.floor(img.height * 0.02);
    const h = Math.floor(img.height * 0.08);
    const { data } = ctx.getImageData(x0, y0, w, h);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
    }
    const n = data.length / 4;
    return [r / n, g / n, b / n] as [number, number, number];
  }, png.toString('base64'));
}

/** Pause, Settings > Display > Look, back, resume: the path a player takes mid-race. */
async function pickLook(page: Page, look: Look) {
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

test('every look draws a real scene; the ink looks have film grain and switch live mid-race', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = watchErrors(page);
  // The default is Ink + 60s film since run W-O. The skies below are the looks' golden-hour skies.
  await race(page, 'classic', 'golden-hour');
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

  // Playtest 1c item 5: the two newer looks, picked the same way, mid-race.
  const skies = { classic: classic.sky, kodak: kodak.sky } as Record<Look, [number, number, number]>;
  for (const look of ['wasteland', 'brush'] as const) {
    await pickLook(page, look);
    await waitTick(page, (await tick(page)) + 30);
    const f = await frame(page, look);
    expect(f.variance, `${look} is not blank`).toBeGreaterThan(NOT_BLANK_VARIANCE);
    expect(f.grain, `${look} draws through the ink pass (grain)`).toBeGreaterThan(0.15);
    skies[look] = f.sky;
  }
  // Wasteland's flat sky is a burnt orange (red over green over blue, and darker than classic's);
  // brush's is a cream (blue well up).
  const [wr, wg, wb] = skies.wasteland;
  expect(wr > wg && wg > wb, 'wasteland sky is orange').toBe(true);
  expect(wg, 'burnt, not pale').toBeLessThan(skies.classic[1]);
  expect(skies.brush[2], 'brush sky is a cream').toBeGreaterThan(wb + 30);
  // Each new look paints its own sky, unlike every other look's. (Classic and kodak share a warm
  // golden-hour sky at the top of the frame; grain tells those two apart.)
  for (const a of ['wasteland', 'brush'] as const) {
    for (const b of LOOKS) {
      if (a === b) continue;
      const d = Math.hypot(...skies[a].map((v, i) => v - (skies[b][i] ?? 0)));
      expect(d, `${a} and ${b} skies differ`).toBeGreaterThan(25);
    }
  }

  await pickLook(page, 'classic');
  await waitTick(page, (await tick(page)) + 30);
  const back = await frame(page, 'classic-again');
  expect(back.variance).toBeGreaterThan(NOT_BLANK_VARIANCE);
  expect(back.grain, 'switching back removes the grain').toBeLessThan(0.15);
  expect(problems).toEqual([]);
});

test('the look is render only: the same seeded bot race records the same replay hashes in every look', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const hashesOf = async (look: Look) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // 8 ticks a drawn frame: the look under test still draws a frame after every 8 ticks (about 77
    // frames to tick 610), so anything a look's setup or draw wrote into the race would still show
    // in the hashes; only the wall time to tick 610 shrinks.
    await race(page, look, undefined, 8);
    await waitTick(page, 610);
    const text = await page.evaluate(() => (window as TestWindow).__game?.debugFileText() ?? '');
    await context.close();
    const m = /"hashes":(\[[^\]]*\])/.exec(text);
    return JSON.parse(m?.[1] ?? '[]') as { tick: number; hash: number }[];
  };
  const upTo = (h: { tick: number }[]) => h.filter((x) => x.tick <= 600);
  const classic = upTo(await hashesOf('classic'));
  expect(classic.length).toBe(11);
  for (const look of LOOKS.slice(1)) {
    expect(upTo(await hashesOf(look)), `${look} against classic`).toEqual(classic);
  }
  console.log(
    `replay hashes compared: ${classic.length} checkpoints (ticks 0 to 600, every 60) x ${LOOKS.length - 1} looks against classic`,
  );
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
  // eslint-disable-next-line no-restricted-syntax -- the browser reports a lost WebGL context asynchronously
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
