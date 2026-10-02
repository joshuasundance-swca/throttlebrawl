import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// W-P "fill the world" (maintainer, 2026-10-01b: "traffic and people: more cars both ways,
// pedestrians, cyclists, joggers, dogs, life that reacts to the player"; "UNIQUE REGIONAL FLAVOR
// EVERYWHERE"). In a real browser, for each region: race there with the bot, and the road carries
// that region's own traffic (Keys golf carts and convertibles, Pacific Northwest kayak wagons and
// log trucks, San Francisco robotaxis and e-bikes), its people stand at the roadside, the frame is
// not blank and stays inside the draw budget, and nothing logs an error. Which kinds spawn, and how
// they behave, is the sim tier's job (src/sim/traffic/regional.test.ts, src/sim/peds/reactions.test.ts).

interface Handle {
  snapshot(): { tick: number; entities: { kind: string; contentId: string }[] } | null;
  events(): readonly { type: string; data: Record<string, unknown> }[];
  setBot(on: boolean): void;
  rendererStats(): { drawCalls: number; triangles: number; renderer: string };
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as {
  drawCallsMax: number;
  trianglesMax: number;
};

/** Each region's W-P vehicles (and a few of its older locals), by content id. */
const REGIONS = [
  {
    slug: 'keys',
    chip: '#region-base-florida-keys',
    vehicles: [
      'base:rental-convertible',
      'base:golf-cart',
      'base:beach-cruiser',
      'base:pickup-towing-boat',
      'base:snowbird-rv',
    ],
  },
  {
    slug: 'pnw',
    chip: '#region-region-pnw-pacific-northwest',
    vehicles: [
      'region-pnw:wagon-with-kayaks',
      'region-pnw:muddy-pickup',
      'region-pnw:rain-cape-cyclist',
      'region-pnw:motorhome',
      'region-pnw:log-truck',
      'region-pnw:mossy-wagon',
    ],
  },
  {
    slug: 'sf',
    chip: '#region-region-sf-san-francisco',
    vehicles: [
      'region-sf:dawdle-robotaxi',
      'region-sf:delivery-e-bike',
      'region-sf:e-scooter-rider',
      'region-sf:rideshare-hatchback',
      'region-sf:startup-shuttle',
    ],
  },
];

for (const region of REGIONS) {
  test(`a ${region.slug} race carries the region's own traffic and people, inside the draw budget`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
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
    await page.locator(region.chip).click();
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-race').click();
    await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });

    // Watch the road for a while: every vehicle and pedestrian kind on it.
    const seen = { vehicles: new Set<string>(), peds: new Set<string>(), peak: 0 };
    const look = async () => {
      const now = await page.evaluate(() => {
        const snap = (window as TestWindow).__game?.snapshot();
        return snap ? { tick: snap.tick, entities: snap.entities.map((e) => [e.kind, e.contentId]) } : null;
      });
      let peds = 0;
      for (const [kind, id] of now?.entities ?? []) {
        if (kind === 'vehicle' && id) seen.vehicles.add(id);
        if (kind === 'ped' && id) {
          seen.peds.add(id);
          peds++;
        }
      }
      seen.peak = Math.max(seen.peak, peds);
      return now?.tick ?? 0;
    };
    await expect
      .poll(
        async () => {
          await look();
          return region.vehicles.some((v) => seen.vehicles.has(v)) && seen.peds.size > 0;
        },
        { timeout: 120_000, intervals: [1000] },
      )
      .toBe(true);
    const tick = await look();
    const reacts = await page.evaluate(
      () => (window as TestWindow).__game?.events().filter((e) => e.type === 'pedReact').length ?? 0,
    );
    const regional = region.vehicles.filter((v) => seen.vehicles.has(v));
    console.log(
      `[print] ${region.slug} by tick ${tick}: regional vehicles ${regional.join(', ')}; ` +
        `all vehicles ${[...seen.vehicles].sort().join(', ')}; people ${[...seen.peds].sort().join(', ')} ` +
        `(up to ${seen.peak} at once); pedReact events in the last step ${reacts}`,
    );
    expect(regional.length).toBeGreaterThan(0);
    expect(seen.peds.size).toBeGreaterThan(0);

    mkdirSync('test-results/screenshots', { recursive: true });
    const png = await page
      .locator('canvas#game')
      .screenshot({ path: `test-results/screenshots/traffic-regions-${region.slug}.png` });
    const { variance } = await pixelStats(page, png);
    const stats = await page.evaluate(() => (window as TestWindow).__game?.rendererStats() ?? null);
    console.log(`[print] ${region.slug}: variance ${variance.toFixed(1)}, ${JSON.stringify(stats)}`);
    expect(variance, 'the frame is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);
    expect(stats?.drawCalls ?? Infinity).toBeLessThanOrEqual(budget.drawCallsMax);
    expect(stats?.triangles ?? Infinity).toBeLessThanOrEqual(budget.trianglesMax);
    expect(problems).toEqual([]);
  });
}
