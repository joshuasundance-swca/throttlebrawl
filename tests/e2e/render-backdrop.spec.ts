import { expect, test, type Page, type Response } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { frames } from './lockstep';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

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
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

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

async function race(page: Page, c: (typeof CASES)[number], look: string): Promise<Set<string>> {
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
  await page.locator('#start-screen').click();
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
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 420, null, {
    timeout: 120_000,
  });
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
      const fetched = await race(page, c, look);
      await expect.poll(() => fetched.has(c.network), { timeout: 30_000 }).toBe(true);
      const region = c.slug.split('-')[0] as keyof typeof NETWORK_CHUNKS;
      // The menu shows the Keys road behind it, so the Keys backdrop may load before a pick; the
      // other regions' must not.
      const others = Object.entries(NETWORK_CHUNKS)
        .filter(([k]) => k !== region && k !== 'keys')
        .flatMap(([, ids]) => ids);
      expect(
        others.filter((id) => fetched.has(id)),
        "another region's backdrop was fetched",
      ).toEqual([]);
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
    }
    expect(problems).toEqual([]);
  });
}

// The backdrop's far floors (far land and water) must never paint over the near world. A verifier
// found San Francisco's far ground drawn as a flat haze-coloured sheet over the bay beside the
// road (W-P, verify-skyline mustFix 1): San Francisco's own road, seed 3, bot, around tick 700, at
// the phone's landscape size. The bay lies right of the road there. This shoots that frame and
// checks the bay patch is sea, not the haze: it must stand well apart from the sky (whose colour
// is the haze's in the Classic look) at the top of the same frame.

/** Mean RGB of rectangles of a PNG, decoded in the page. */
async function means(
  page: Page,
  png: Buffer,
  rects: readonly (readonly [number, number, number, number])[],
): Promise<[number, number, number][]> {
  return page.evaluate(
    async ([b64, rs]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      return rs.map(([x0, y0, x1, y1]) => {
        const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
        const sum = [0, 0, 0];
        for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += data[i + k] ?? 0;
        const n = data.length / 4;
        return [sum[0]! / n, sum[1]! / n, sum[2]! / n] as [number, number, number];
      });
    },
    [png.toString('base64'), rects] as const,
  );
}

test("San Francisco's far ground leaves the bay beside the road as sea (seed 3, tick 700, Classic)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    const record = {
      format: 'settings',
      version: 1,
      build: 'e2e',
      savedAt: '2026-10-01T00:00:00.000Z',
      data: { look: 'classic' },
    };
    localStorage.setItem('mbrawl:settings', JSON.stringify(record));
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#region-region-sf-san-francisco').click();
  await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    g?.setSeed(3);
    g?.setBot(true);
  });
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 700, null, {
    timeout: 180_000,
  });
  await page.locator('#hud-pause').click();
  // Hide the pause screen so the frame itself is shot.
  await page.addStyleTag({
    content: 'body *{visibility:hidden!important} canvas#game{visibility:visible!important}',
  });
  await frames(page, 2); // the style is painted
  mkdirSync('test-results/screenshots', { recursive: true });
  const png = await page
    .locator('canvas#game')
    .screenshot({ path: 'test-results/screenshots/backdrop-sf-floor-bay.png' });
  const [bay, sky] = await means(page, png, [
    [770, 300, 900, 360],
    [300, 8, 600, 40],
  ]);
  const apart = Math.abs(bay![0] - sky![0]) + Math.abs(bay![1] - sky![1]) + Math.abs(bay![2] - sky![2]);
  console.log(
    `[print] bay ${bay!.map(Math.round).join(',')}, sky ${sky!.map(Math.round).join(',')}, apart ${apart.toFixed(0)}`,
  );
  // The near bay (about 94,115,111 with no backdrop) against the haze sky (about 210,213,216); the
  // bad frame drew the bay as the haze itself (about 211,214,217).
  expect(apart, 'the bay beside the road is drawn as the haze').toBeGreaterThan(120);
});
