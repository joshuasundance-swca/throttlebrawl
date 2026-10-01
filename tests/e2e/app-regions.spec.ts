import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// The regions in the real game (playtest 1c item 6, 2026-09-30: "Pnw and sf first then others";
// docs/content-packs.md, "Region packs at runtime"). For each region pack: pick its chip on the
// menu's region picker, press Race with the bot riding, and the race starts in that region. The
// region's road data arrives as fetched JSON files, the field has the region's locals, the frame
// is not blank and stays inside the draw budget, and the debug file's recording names the region's
// event and replays against a fresh sim to identical hashes. The bot riding each region's race to
// the line is the sim tier's job (tests/sim/app-regions.test.ts, the same loader headless): a
// full race in a software-rendered browser takes minutes per region.

interface Handle {
  state(): string;
  snapshot(): {
    tick: number;
    entities: { kind: string; contentId: string; speed: number }[];
  } | null;
  setBot(on: boolean): void;
  rendererStats(): { drawCalls: number; triangles: number; renderer: string };
  debugFileText(): string;
  checkDebugFile(text: string): {
    ticks: number;
    checked: number;
    desync: { tick: number } | null;
    keyMatches: boolean;
  };
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

const REPLAY_MARKER = '===== replay (one line of JSON) =====';
const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as {
  drawCallsMax: number;
  trianglesMax: number;
};

const REGIONS = [
  {
    chip: '#region-region-pnw-pacific-northwest',
    name: 'The Pacific Northwest',
    event: 'region-pnw:pnw-fogline-run',
    locals: ['region-pnw:old-growth', 'region-pnw:juniper-moss', 'region-pnw:deputy-lindqvist'],
    roadFile: /\/pnw-[a-z-]+-[\w-]+\.json$/,
  },
  {
    chip: '#region-region-sf-san-francisco',
    name: 'San Francisco',
    event: 'region-sf:sf-hill-sprint',
    locals: ['region-sf:pivot', 'region-sf:gripman-gus', 'region-sf:officer-meter'],
    roadFile: /\/sf-[a-z-]+-[\w-]+\.json$/,
  },
];

test('the picker offers the Keys, the Pacific Northwest and San Francisco, the Keys picked', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#region-picker')).toBeVisible();
  const chips = page.locator('#region-picker .region');
  await expect(chips).toHaveText(['The Keys', 'The Pacific Northwest', 'San Francisco']);
  await expect(page.locator('#region-base-florida-keys')).toHaveAttribute('aria-checked', 'true');
});

for (const region of REGIONS) {
  test(`picking ${region.name} races there: its road, its locals, a real frame and a replayable recording`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    const roadFetches: string[] = [];
    page.on('request', (req) => {
      if (region.roadFile.test(new URL(req.url()).pathname)) roadFetches.push(req.url());
    });
    await page.addInitScript(() => {
      (window as TestWindow).__GAME_TEST__ = true;
    });
    await page.goto('./');
    await page.locator('#start-screen').click();
    await page.locator(region.chip).click();
    await expect(page.locator(region.chip)).toHaveAttribute('aria-checked', 'true');
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-race').click();
    await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 240, null, {
      timeout: 60_000,
    });

    // The race is the region's: its field and its fetched road.
    const riders = await page.evaluate(
      () =>
        (window as TestWindow).__game
          ?.snapshot()
          ?.entities.filter((e) => e.kind === 'rider')
          .map((e) => e.contentId) ?? [],
    );
    console.log(
      `[print] ${region.name}: riders ${riders.join(', ')}; ${roadFetches.length} road files fetched`,
    );
    expect(riders).toEqual(expect.arrayContaining(region.locals));
    expect(roadFetches.length, 'the region road data was fetched').toBeGreaterThan(0);

    // A real frame, inside the draw budget.
    mkdirSync('test-results/screenshots', { recursive: true });
    const slug = region.event.split(':')[0] ?? 'region';
    const png = await page
      .locator('canvas#game')
      .screenshot({ path: `test-results/screenshots/app-regions-${slug}.png` });
    const { variance } = await pixelStats(page, png);
    const stats = await page.evaluate(() => (window as TestWindow).__game?.rendererStats() ?? null);
    console.log(`[print] ${region.name}: variance ${variance.toFixed(1)}, ${JSON.stringify(stats)}`);
    expect(variance, 'the frame is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);
    expect(stats?.drawCalls ?? Infinity).toBeLessThanOrEqual(budget.drawCallsMax);
    expect(stats?.triangles ?? Infinity).toBeLessThanOrEqual(budget.trianglesMax);
    const moving = await page.evaluate(() => {
      const g = (window as TestWindow).__game;
      return g?.snapshot()?.entities.find((e) => e.kind === 'rider' && e.speed > 5) !== undefined;
    });
    expect(moving, 'riders are moving').toBe(true);

    // The recording names the region's event and replays to identical hashes.
    const text = await page.evaluate(() => (window as TestWindow).__game?.debugFileText() ?? '');
    const lines = text.split('\n');
    const replay = JSON.parse(lines[lines.indexOf(REPLAY_MARKER) + 1] ?? 'null') as {
      header?: { eventId?: string; seed?: number };
    } | null;
    expect(replay?.header?.eventId).toBe(region.event);
    const check = await page.evaluate((t) => (window as TestWindow).__game?.checkDebugFile(t) ?? null, text);
    console.log(`[print] ${region.name}: replay ${check?.ticks} ticks, ${check?.checked} hashes compared`);
    expect(check?.desync ?? null).toBeNull();
    expect(check?.keyMatches).toBe(true);
    expect(check?.checked ?? 0).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
}
