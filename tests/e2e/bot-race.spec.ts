import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// The browser bot race (docs/milestones/M1.md, dev-1; docs/engineering.md, "Bot playthrough"):
// the BotController rides a real race in the production build at the phone-landscape viewport,
// driving the player slot through the input layer's action state. The race reaches results with
// a placing, the start, midway and finish screenshots are not blank, every mover is valid at every
// tick, and the draw-call, triangle and frame-time numbers are printed with the renderer string.
//
// Assertions switch on with the feature that makes them possible, and print ACTIVE or NOT ACTIVE
// with the reason, so a switched-off check never reads as a pass:
// - an attack connects: on since combat-1. Whether the bot's punch lands in ONE seeded race is luck
//   of the pack (combat's kick shove flipped seed 1 once), so it is asked across ATTACK_SEEDS run
//   headless in the page plus this browser race: at least ATTACK_MIN_CONNECTS of them connect
//   (the shared batch connects in about 9 races of 10);
// - the bot took the shortcut: active once the bot's route has a split zone onto a shortcut
//   (road-2's boat-ramp cut) or its road offers a `shortcut` lane.

interface Checks {
  ticks: number;
  playerEdges: number[];
  invalidTicks: number;
  firstInvalid: string | null;
  events: Record<string, number>;
  playerHits: number;
  bot: {
    attackPresses: number;
    skipTicks: number;
    shortcutTicks: number;
    shortcutSeenTicks: number;
    shortcutApproachTicks: number;
    trafficDodges: number;
    engagements: number;
  };
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
  debugFileText(): string;
  checkDebugFile(text: string): {
    ticks: number;
    checked: number;
    desync: { tick: number } | null;
    keyMatches: boolean;
    summary: string;
  };
  botAttackRuns(seeds: readonly number[]): AttackRun[];
}
interface AttackRun {
  seed: number;
  ticks: number;
  hits: number;
  attackPresses: number;
  attackStarts: number;
  over: boolean;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

/** Extra seeds for the "an attack connects" check, run headless in the page after the race. */
const ATTACK_SEEDS = [2, 3, 4, 5, 6, 7];
/** How many of the browser race plus ATTACK_SEEDS must land a hit. */
const ATTACK_MIN_CONNECTS = 3;

const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as {
  drawCallsMax: number;
  trianglesMax: number;
};

test('the bot races to results with a placing at phone landscape', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
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
  // A placing, or Busted: the batch rule (dev-1). The seeded race's outcome shifts whenever the
  // sim changes (rider contact turned seed 1 into a bust), and both end on the results screen.
  expect(placing).toMatch(/^(\d+(st|nd|rd|th) of \d+|Busted)$/);

  const checks = (await page.evaluate(() => (window as TestWindow).__game?.checks())) as Checks;
  console.log(`race checks: ${JSON.stringify(checks)}`);
  expect(checks.ticks).toBeGreaterThan(600);
  expect(checks.invalidTicks, checks.firstInvalid ?? '').toBe(0);
  // Crossed at least one junction, and never went back to an edge it had left.
  expect(checks.playerEdges.length).toBeGreaterThanOrEqual(2);
  expect(new Set(checks.playerEdges).size).toBe(checks.playerEdges.length);
  // The race ended: someone finished, or the bot was busted (a bust ends the race at once).
  expect((checks.events['finish'] ?? 0) + (checks.events['bust'] ?? 0)).toBeGreaterThan(0);

  // The browser path: when the bot pressed attack through the input layer, the sim answered.
  if (checks.bot.attackPresses > 0)
    expect(checks.events['attackStart'] ?? 0, 'the sim answers attacks').toBeGreaterThan(0);
  // Combat is in (combat-1): across several seeded races the bot fights and connects. One seed
  // alone flips with any sim change, so the expectation is an aggregate.
  const runs = (await page.evaluate(
    (seeds) => (window as TestWindow).__game?.botAttackRuns(seeds) ?? [],
    ATTACK_SEEDS,
  )) as AttackRun[];
  const all = [
    { seed: 1, hits: checks.playerHits, attackPresses: checks.bot.attackPresses, where: 'browser' },
    ...runs.map((r) => ({ ...r, where: `headless, ${r.ticks} ticks` })),
  ];
  const connected = all.filter((r) => r.hits > 0).length;
  console.log(
    `[assert] an attack connects: ACTIVE (${connected} of ${all.length} seeded races connect, need ${ATTACK_MIN_CONNECTS}): ` +
      all.map((r) => `seed ${r.seed} (${r.where}) ${r.hits} hits / ${r.attackPresses} presses`).join('; '),
  );
  expect(runs, 'every headless seed ran').toHaveLength(ATTACK_SEEDS.length);
  expect(
    all.reduce((n, r) => n + r.attackPresses, 0),
    'the bot pressed attack (it fights, not just rides)',
  ).toBeGreaterThan(0);
  expect(connected, 'the bot connects in enough seeded races').toBeGreaterThanOrEqual(ATTACK_MIN_CONNECTS);
  if (checks.bot.shortcutApproachTicks > 0 || checks.bot.shortcutSeenTicks > 0) {
    console.log(
      `[assert] the bot took the shortcut: ACTIVE (${checks.bot.shortcutApproachTicks} ticks lining up, ${checks.bot.shortcutTicks} ticks on it)`,
    );
    expect(checks.bot.shortcutTicks, 'the bot took the shortcut').toBeGreaterThan(0);
  } else {
    console.log(
      '[assert] the bot took the shortcut: NOT ACTIVE (its route has no split zone and its road no shortcut lane)',
    );
  }

  // M2 dev-4: "the bot lands a takedown" is asserted across the shared seeded batch
  // (tests/sim/dev-presets.test.ts), where one seed's luck cannot flip it; this race only prints.
  console.log(
    `[print] takedowns in this race: ${checks.events['takedown'] ?? 0} (asserted over the seeded batch, not one seed)`,
  );

  // dev-3: the finished race's debug file replays, from its own header, to every stored hash and
  // to the final hash taken when the race ended.
  const replayCheck = await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    if (!g) return null;
    const text = g.debugFileText();
    return { ...g.checkDebugFile(text), hasEnd: text.includes('"end":{"tick":') };
  });
  console.log(
    `[assert] the debug file replays the whole race: ${JSON.stringify({ ...replayCheck, summary: undefined })}`,
  );
  expect(replayCheck?.hasEnd, 'the recording was closed with the final hash').toBe(true);
  expect(replayCheck?.desync ?? null).toBeNull();
  expect(replayCheck?.ticks).toBe(checks.ticks);
  expect(replayCheck?.checked ?? 0).toBeGreaterThan(checks.ticks / 60);

  const frames = (await page.evaluate(() => (window as TestWindow).__game?.frameStats())) as ReturnType<
    Handle['frameStats']
  >;
  const renderer = shots['start']?.stats.renderer ?? '';
  console.log(`renderer: ${renderer}`);
  const perf = {
    scene: `bot-race: base event, ${(await page.evaluate(() => (window as TestWindow).__game?.snapshot()?.entities.length)) ?? 0} movers at the finish, start/midway/finish checkpoints`,
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
