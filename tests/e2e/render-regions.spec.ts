import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// The region build-out (W-O, the maintainer, 2026-10-01: "better visuals and experience"). In a
// real browser, for each region: race there with the bot, and the region's own Blender models are
// fetched, and only that region's (a Keys race never downloads San Francisco's houses: the models
// load when a race in their region starts). The frame is not blank and stays inside the draw
// budget with the new scenery on screen, and nothing logs an error. The scenery's placement is the
// unit tier's job (src/render/regions.test.ts).

interface Handle {
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
  rendererStats(): { drawCalls: number; triangles: number; renderer: string };
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as {
  drawCallsMax: number;
  trianglesMax: number;
};

/** The region models, by the start of their file name in the build. */
const REGION_MODELS = [
  'conifers',
  'sawmill',
  'trestle-bent',
  'row-houses',
  'fog-banks',
  'cable-car',
  'pnw-roadside',
] as const;

const REGIONS = [
  { slug: 'keys', chip: '#region-base-florida-keys', wants: [] as string[] },
  {
    slug: 'pnw',
    chip: '#region-region-pnw-pacific-northwest',
    wants: ['conifers', 'sawmill', 'trestle-bent', 'pnw-roadside'],
  },
  { slug: 'sf', chip: '#region-region-sf-san-francisco', wants: ['row-houses', 'fog-banks', 'cable-car'] },
];

for (const region of REGIONS) {
  test(`a ${region.slug} race loads its own region models and only those, and draws inside the budget`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    const fetched = new Set<string>();
    page.on('response', (res) => {
      const file = new URL(res.url()).pathname.split('/').pop() ?? '';
      const model = REGION_MODELS.find((m) => file.startsWith(`${m}-`) || file === `${m}.glb`);
      if (model && file.endsWith('.glb') && res.ok()) fetched.add(model);
    });
    await page.addInitScript(() => {
      (window as TestWindow).__GAME_TEST__ = true;
    });
    await page.goto('./');
    await page.locator('#start-screen').click();
    await page.locator(region.chip).click();
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-race').click();
    await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 300, null, {
      timeout: 90_000,
    });
    // The models arrive in the background: wait for every one the region wants.
    await expect.poll(() => region.wants.filter((m) => !fetched.has(m)), { timeout: 30_000 }).toEqual([]);
    console.log(`[print] ${region.slug}: region models fetched: ${[...fetched].sort().join(', ') || 'none'}`);
    expect([...fetched].sort()).toEqual([...region.wants].sort());

    mkdirSync('test-results/screenshots', { recursive: true });
    const png = await page
      .locator('canvas#game')
      .screenshot({ path: `test-results/screenshots/render-regions-${region.slug}.png` });
    const { variance } = await pixelStats(page, png);
    const stats = await page.evaluate(() => (window as TestWindow).__game?.rendererStats() ?? null);
    console.log(`[print] ${region.slug}: variance ${variance.toFixed(1)}, ${JSON.stringify(stats)}`);
    expect(variance, 'the frame is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);
    expect(stats?.drawCalls ?? Infinity).toBeLessThanOrEqual(budget.drawCallsMax);
    expect(stats?.triangles ?? Infinity).toBeLessThanOrEqual(budget.trianglesMax);
    expect(problems).toEqual([]);
  });
}
