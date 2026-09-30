import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// The browser bot race (M1 app-1 acceptance; dev-1 takes this file over and grows it): the stub
// bot rides a real race in the production build at the phone-landscape viewport, the race reaches
// results with a placing, the start, midway and finish screenshots are not blank, the player
// crosses the road's three edges with every mover valid at every tick, and the first draw-call,
// triangle and frame-time numbers are printed with the renderer string.

interface Checks {
  ticks: number;
  playerEdges: number[];
  invalidTicks: number;
  firstInvalid: string | null;
  events: Record<string, number>;
}
interface Stats {
  renderer: string;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  width: number;
  height: number;
}
interface Handle {
  state(): string;
  snapshot(): {
    tick: number;
    race: { routeLength: number };
    entities: { progress: number }[];
  } | null;
  playerId(): number;
  setBot(on: boolean): void;
  checks(): Checks;
  rendererStats(): Stats;
  frameStats(): { samples: number; p50: number; p95: number; max: number };
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as {
  drawCallsMax: number;
  trianglesMax: number;
};

test('the stub bot races to results with a placing at phone landscape', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  mkdirSync('test-results/screenshots', { recursive: true });
  const canvas = page.locator('canvas#game');
  const shots: Record<string, { variance: number; stats: Stats }> = {};
  const shoot = async (name: string) => {
    const png = await canvas.screenshot({ path: `test-results/screenshots/bot-race-${name}.png` });
    const { variance } = await pixelStats(page, png);
    shots[name] = {
      variance,
      stats: (await page.evaluate(() => (window as TestWindow).__game?.rendererStats() ?? null)) as Stats,
    };
    console.log(`${name}: variance ${variance.toFixed(1)}, ${JSON.stringify(shots[name].stats)}`);
    expect(variance, `the ${name} screenshot is not blank`).toBeGreaterThan(NOT_BLANK_VARIANCE);
    expect(shots[name].stats.drawCalls, `${name} draw calls`).toBeLessThanOrEqual(budget.drawCallsMax);
    expect(shots[name].stats.triangles, `${name} triangles`).toBeLessThanOrEqual(budget.trianglesMax);
  };

  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible();

  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 60);
  await shoot('start');
  await page.waitForFunction(
    () => {
      const g = (window as TestWindow).__game;
      const s = g?.snapshot();
      const me = g && s ? s.entities[g.playerId()] : undefined;
      return !!s && !!me && me.progress > s.race.routeLength / 2;
    },
    null,
    { timeout: 200_000, polling: 250 },
  );
  await shoot('midway');
  await expect(page.locator('#results')).toBeVisible({ timeout: 200_000 });
  await shoot('finish');

  const placing = (await page.locator('#results-place').textContent()) ?? '';
  console.log(`results: ${placing} · ${(await page.locator('#results-prize').textContent()) ?? ''}`);
  expect(placing).toMatch(/^\d+(st|nd|rd|th) of \d+$/);

  const checks = (await page.evaluate(() => (window as TestWindow).__game?.checks())) as Checks;
  console.log(`race checks: ${JSON.stringify(checks)}`);
  expect(checks.ticks).toBeGreaterThan(600);
  expect(checks.invalidTicks, checks.firstInvalid ?? '').toBe(0);
  // The main path's six edges (road-2: four roads and the two junctions' connector roads).
  expect(checks.playerEdges).toEqual([0, 1, 2, 3, 4, 5]);
  expect(checks.events['finish'] ?? 0).toBeGreaterThan(0);

  const frames = (await page.evaluate(() => (window as TestWindow).__game?.frameStats())) as ReturnType<
    Handle['frameStats']
  >;
  const renderer = shots['start']?.stats.renderer ?? '';
  console.log(`renderer: ${renderer}`);
  const perf = {
    scene: 'bot-race: skeleton track, 2 riders, start/midway/finish checkpoints',
    renderer,
    viewport: page.viewportSize(),
    checkpoints: Object.fromEntries(
      Object.entries(shots).map(([k, v]) => [
        k,
        { drawCalls: v.stats.drawCalls, triangles: v.stats.triangles },
      ]),
    ),
    frameMs: { samples: frames.samples, p50: frames.p50, p95: frames.p95, max: frames.max },
  };
  console.log(`perf: ${JSON.stringify(perf)}`);
  writeFileSync(
    `test-results/perf-bot-race-${testInfo.project.name}.json`,
    `${JSON.stringify(perf, null, 2)}\n`,
  );

  expect(problems, 'no console errors or page errors').toEqual([]);
});
