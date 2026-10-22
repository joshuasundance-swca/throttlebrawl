import { expect, test, type Page, type Response } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fastForwardDone } from './lockstep';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';
import { enterReloadedMenu, openQuickPlay } from './menu-navigation';

// The backdrop (W-P "fill the world", the maintainer, 2026-10-01b: "distance and skyline: hills,
// mountains, city skylines, water, bridges on the horizon"). In a real browser at the phone's
// landscape size, for each region, on its own road and on a real road: race there with the bot in
// the default ink + 60s film look and in Classic. The region's backdrop data is fetched (only that
// region's: a Keys race never downloads San Francisco's skyline), the frame is not blank, it stays
// inside the draw budget with the backdrop on screen, and nothing logs an error. What the backdrop
// builds, and where, is the unit tier's job (src/render/backdrop/backdrop.test.ts).

interface Handle {
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
  setSeed(seed: number): void;
  rendererStats(): { drawCalls: number; triangles: number; renderer: string };
  fastForward(
    until: (snap: { tick: number }) => boolean,
    opts?: { perFrame?: number; then?: number | null },
  ): void;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle; __bayFloorPatched?: number };

const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as {
  drawCallsMax: number;
  trianglesMax: number;
};

/** Each region's backdrop network files, by the start of their chunk names in the build. */
const NETWORK_CHUNKS = {
  keys: ['keys-m1', 'osm-keys-bahia-honda', 'osm-keys-key-west'],
  pnw: ['pnw-c1', 'osm-pnw-chuckanut', 'osm-pnw-gorge', 'osm-pnw-samish'],
  sf: ['sf-hills', 'osm-sf-russian-hill', 'osm-sf-twin-peaks'],
} as const;

const CASES = [
  { slug: 'keys', chip: '#region-base-florida-keys', route: null, network: 'keys-m1' },
  { slug: 'pnw', chip: '#region-region-pnw-pacific-northwest', route: null, network: 'pnw-c1' },
  {
    slug: 'pnw-gorge',
    chip: '#region-region-pnw-pacific-northwest',
    route: '#route-region-pnw-osm-gorge-run',
    network: 'osm-pnw-gorge',
  },
  { slug: 'sf', chip: '#region-region-sf-san-francisco', route: null, network: 'sf-hills' },
  {
    slug: 'sf-twin-peaks',
    chip: '#region-region-sf-san-francisco',
    route: '#route-region-sf-osm-sf-twin-peaks-run',
    network: 'osm-sf-twin-peaks',
  },
] as const;

const LOOKS = ['kodak', 'classic'] as const;

/**
 * True when the browser got the file: a 200, or a 304 (Not Modified). Each case races twice on one
 * page (one look, then the next), and `vite preview` serves chunks as `no-cache` with an ETag, so
 * the second load may revalidate the chunk it already holds and Playwright reports that response
 * as a 304, whose `ok()` is false. Counting only `ok()` dropped the fetch at random on the second
 * look (the Classic run of pnw-gorge, pnw and sf, always at the fetch poll below).
 */
const arrived = (res: Response): boolean => res.ok() || res.status() === 304;

/** The tick the races fast-forward to before they ride on at 4 ticks a frame. */
const FAST_TO = 300;

/**
 * Rides the race on to past tick `to`: fast to FAST_TO (the handle's fastForward over the loop's
 * lockstep), then 4 ticks a drawn frame, the loop's real-time cap, so the last stretch (30 frames
 * to tick 420, 100 to tick 700) is drawn as a slow runner draws it in real time and the camera and
 * the backdrop's streaming settle over those frames. The race is the same tick for tick at any
 * lockstep: the frame shot past `to` is the one a real-time ride shows there. The timeouts are hang
 * guards.
 */
async function rideTo(page: Page, to: number): Promise<void> {
  await page.evaluate((t) => {
    (window as TestWindow).__game?.fastForward((s) => s.tick >= t, { then: 4 });
  }, FAST_TO);
  await fastForwardDone(page, `to tick ${FAST_TO}, then 4 ticks a frame to ${to}`);
  await page.waitForFunction((t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > t, to, {
    timeout: 120_000,
  });
}

async function race(
  page: Page,
  c: (typeof CASES)[number],
  look: string,
  afterRace = false,
): Promise<Set<string>> {
  const fetched = new Set<string>();
  page.on('response', (res) => {
    const file = new URL(res.url()).pathname.split('/').pop() ?? '';
    for (const id of Object.values(NETWORK_CHUNKS).flat())
      if (file.startsWith(`${id}-`) && file.endsWith('.js') && arrived(res)) fetched.add(id);
  });
  await page.addInitScript((lk) => {
    (window as TestWindow).__GAME_TEST__ = true;
    const record = {
      format: 'settings',
      version: 1,
      build: 'e2e',
      savedAt: '2026-10-01T00:00:00.000Z',
      data: { look: lk },
    };
    localStorage.setItem('mbrawl:settings', JSON.stringify(record));
  }, look);
  await page.goto('./');
  if (afterRace) await enterReloadedMenu(page);
  else await page.locator('#start-screen').click();
  await openQuickPlay(page);
  await page.locator(c.chip).click();
  if (c.route) {
    const r = page.locator(c.route);
    await expect(r).toBeVisible({ timeout: 30_000 });
    await r.click();
  }
  await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    g?.setSeed(3);
    g?.setBot(true);
  });
  await openQuickPlay(page);
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
  await rideTo(page, 420);
  return fetched;
}

for (const c of CASES) {
  test(`${c.slug}: the region's backdrop loads (only its own) and draws inside the budget in every look`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    for (const look of LOOKS) {
      const fetched = await race(page, c, look, look !== LOOKS[0]);
      await expect.poll(() => fetched.has(c.network), { timeout: 30_000 }).toBe(true);
      // The backdrop's own chunks arrive, then build in one go: give it a few frames.
      // eslint-disable-next-line no-restricted-syntax -- debt: the backdrop's chunks fetch and build asynchronously with no ready signal yet; wait on one once render exposes it
      await page.waitForTimeout(1500);
      mkdirSync('test-results/screenshots', { recursive: true });
      const png = await page
        .locator('canvas#game')
        .screenshot({ path: `test-results/screenshots/backdrop-${c.slug}-${look}.png` });
      const { variance } = await pixelStats(page, png);
      const stats = await page.evaluate(() => (window as TestWindow).__game?.rendererStats() ?? null);
      console.log(`[print] ${c.slug} ${look}: variance ${variance.toFixed(1)}, ${JSON.stringify(stats)}`);
      expect(variance, 'the frame is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);
      expect(stats?.drawCalls ?? Infinity).toBeLessThanOrEqual(budget.drawCallsMax);
      expect(stats?.triangles ?? Infinity).toBeLessThanOrEqual(budget.trianglesMax);
      const region = c.slug.split('-')[0] as keyof typeof NETWORK_CHUNKS;
      // The menu shows the Keys road behind it, so the Keys backdrop may load before a pick; the
      // other regions' must not. Checked last, after the frame's wait, so a wrong fetch started
      // with the race (which fast-forwards to its frame) has had as long as it can to show.
      const others = Object.entries(NETWORK_CHUNKS)
        .filter(([k]) => k !== region && k !== 'keys')
        .flatMap(([, ids]) => ids);
      expect(
        others.filter((id) => fetched.has(id)),
        "another region's backdrop was fetched",
      ).toEqual([]);
    }
    expect(problems).toEqual([]);
  });
}

// The backdrop's far floors (far land and water) must never paint over the near world. A verifier
// found San Francisco's far ground drawn as a flat haze-coloured sheet over the bay beside the
// road (W-P, verify-skyline mustFix 1): San Francisco's own road, seed 3, bot, around tick 700, at
// the phone's landscape size. The bay lies right of the road there. Foreground figures can cover
// part of it, and the sky need not equal the haze at every light. Check visible sea chroma in the
// original bay area, with the historical broken floor shader as a rendered negative control.

/** Visible water chroma, allowing lighting/fog variation and foreground occlusion. */
async function bayWater(page: Page, png: Buffer): Promise<{ water: number; pixels: number; share: number }> {
  const region = JSON.parse(readFileSync('packs/region-sf/regions/san-francisco/region.json', 'utf8')) as {
    timeOfDayOptions: { id: string; palette: { water: string; fog: string } }[];
  };
  const palette = region.timeOfDayOptions.find((light) => light.id === 'golden-hour')?.palette;
  if (!palette) throw new Error('SF golden-hour water/fog palette is required for this scene');
  const chroma = (hex: string) => {
    const rgb = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    const sum = rgb.reduce((a, b) => a + b, 0);
    return rgb.map((value) => value / sum);
  };
  const water = chroma(palette.water);
  const fog = chroma(palette.fog);
  expect(water, 'the selected water and haze must have distinct chroma').not.toEqual(fog);
  return page.evaluate(
    async ([b64, water, fog]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      // The original regression's bay area. Do not move the rectangle to dodge a foreground actor.
      const { data } = ctx.getImageData(770, 300, 130, 60);
      let matches = 0;
      for (let i = 0; i < data.length; i += 4) {
        const rgb = [data[i]!, data[i + 1]!, data[i + 2]!];
        const sum = rgb.reduce((a, b) => a + b, 0);
        if (!sum) continue;
        const distance = (colour: number[]) =>
          rgb.reduce((d, value, k) => d + (value / sum - colour[k]!) ** 2, 0);
        if (distance(water) < distance(fog)) matches++;
      }
      const pixels = data.length / 4;
      return { water: matches, pixels, share: matches / pixels };
    },
    [png.toString('base64'), water, fog] as const,
  );
}

test("San Francisco's far ground leaves visible sea and rejects the historical floor defect", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const minimumShare = 0.05; // visible area, not a whole-rectangle mean or a measured minimum
  await page.addInitScript(() => {
    const broken = new URL(location.href).searchParams.get('bayFloorControl') === 'broken';
    localStorage.clear();
    (window as TestWindow).__GAME_TEST__ = true;
    (window as TestWindow).__bayFloorPatched = 0;
    if (broken) {
      const original = Object.getOwnPropertyDescriptor(WebGL2RenderingContext.prototype, 'shaderSource')
        ?.value as WebGL2RenderingContext['shaderSource'] | undefined;
      if (!original) throw new Error('missing native WebGL shaderSource for negative control');
      WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
        const branch = 'if (aInfo.y > 0.5)';
        if (source.includes(branch)) {
          if (source.split(branch).length !== 2) throw new Error('ambiguous backdrop floor control');
          (window as TestWindow).__bayFloorPatched!++;
          source = source.replace(branch, 'if (false)');
        }
        original.call(this, shader, source);
      };
    }
    const record = {
      format: 'settings',
      version: 1,
      build: 'e2e',
      savedAt: '2026-10-01T00:00:00.000Z',
      data: { look: 'classic', raceOptions: { timeOfDay: 'golden-hour' } },
    };
    localStorage.setItem('mbrawl:settings', JSON.stringify(record));
  });
  for (const broken of [false, true]) {
    await page.goto(`./?bayFloorControl=${broken ? 'broken' : 'normal'}`);
    await page.locator('#start-screen').click();
    await openQuickPlay(page);
    await page.locator('#region-region-sf-san-francisco').click();
    await page.evaluate(() => {
      const g = (window as TestWindow).__game;
      g?.setSeed(3);
      g?.setBot(true);
    });
    await openQuickPlay(page);
    await page.locator('#menu-race').click();
    await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
    await rideTo(page, 700);
    await page.locator('#hud-pause').click();
    // Hide the pause screen so the frame itself is shot.
    await page.addStyleTag({
      content: 'body *{visibility:hidden!important} canvas#game{visibility:visible!important}',
    });
    mkdirSync('test-results/screenshots', { recursive: true });
    const png = await page.locator('canvas#game').screenshot({
      path: `test-results/screenshots/backdrop-sf-floor-bay-${broken ? 'broken' : 'normal'}.png`,
    });
    const visible = await bayWater(page, png);
    const patched = await page.evaluate(() => (window as TestWindow).__bayFloorPatched ?? 0);
    console.log(
      `[print] bay ${broken ? 'broken floor' : 'normal'}: ${JSON.stringify({ ...visible, patched })}`,
    );
    if (broken) {
      expect(patched, 'negative control actually replaced the floor shader branch').toBeGreaterThan(0);
      expect(visible.share, 'historical floor defect must fail the visible-water rule').toBeLessThanOrEqual(
        minimumShare,
      );
    } else
      expect(visible.share, 'the bay retains visible water despite foreground figures').toBeGreaterThan(
        minimumShare,
      );
  }
});
