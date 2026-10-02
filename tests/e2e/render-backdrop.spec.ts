import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
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
  keys: ['keys-m1', 'osm-keys-bahia-honda'],
  pnw: ['pnw-c1', 'osm-pnw-chuckanut', 'osm-pnw-gorge'],
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

async function race(page: Page, c: (typeof CASES)[number], look: string): Promise<Set<string>> {
  const fetched = new Set<string>();
  page.on('response', (res) => {
    const file = new URL(res.url()).pathname.split('/').pop() ?? '';
    for (const id of Object.values(NETWORK_CHUNKS).flat())
      if (file.startsWith(`${id}-`) && file.endsWith('.js') && res.ok()) fetched.add(id);
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
      const others = Object.entries(NETWORK_CHUNKS)
        .filter(([k]) => k !== region)
        .flatMap(([, ids]) => ids);
      expect(
        others.filter((id) => fetched.has(id)),
        "another region's backdrop was fetched",
      ).toEqual([]);
      // The backdrop's own chunks arrive, then build in one go: give it a few frames.
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
