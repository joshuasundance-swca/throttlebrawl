import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fastForwardDone, frames } from './lockstep';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// W-P road events (the maintainer, 2026-10-01b: "events and set pieces: roadwork, crash scenes,
// parades, a farm truck shedding hay, speed traps"). In the real game, the bot races on seeds whose
// events come up early (found headless), and every piece is met on at least one route: a Pacific
// Northwest race with the hay truck and roadwork, another with the Logger Days parade and a speed
// trap, and San Francisco's robotaxi incident. (The Keys hand-made road has events only past
// 60% of the race, after its long shortcut stretch, too far in for this tier.) For each: the sim
// puts the piece's props on the road, render draws them (RendererStats.eventProps, with the warning
// sign's words), the frame with the piece ahead of the player is not blank, the draw stays inside
// the budget, and nothing logs an error.
//
// The race fast-forwards between those moments (the test handle's fastForward over the loop's
// lockstep; the determinism run's R4): 240 ticks a drawn frame until the piece's props are live,
// again until one is within APPROACH_M ahead, then 4 ticks a frame, every frame drawn, until it
// is 10 to 80 m ahead. Each stop is the exact tick the condition first holds, so the waits are
// hang guards and the race is the same tick for tick on every runner.

interface Prop {
  kind: string;
  piece: string;
  x: number;
  z: number;
}
interface Snap {
  tick: number;
  entities: { slot: number; x: number; z: number; heading: number }[];
  props?: Prop[];
}
interface Handle {
  snapshot(): Snap | null;
  // The condition gets the sim's whole snapshot; each spec casts it to the fields it reads.
  fastForward(
    until: (snap: { tick: number }) => boolean,
    opts?: { perFrame?: number; then?: number | null },
  ): void;
  fastForwarding(): boolean;
  state(): string;
  setBot(on: boolean): void;
  setSeed(seed: number): void;
  rendererStats(): {
    drawCalls: number;
    triangles: number;
    eventProps?: { total: number; byKind: Readonly<Record<string, number>>; signs: readonly string[] };
  };
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

/**
 * Where the fast ride stops short of the piece: the last stretch, 4 ticks a drawn frame, gives the
 * chase camera more than a second of race to catch up before the screenshot. [default]
 */
const APPROACH_M = 160;

const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as {
  drawCallsMax: number;
  trianglesMax: number;
};

/**
 * Seeds whose events come up early in the region's standard race (found headless), each race's
 * pieces in the order the bot meets them. Run W-T's moving events (#391) added pieces to both
 * regions' pools, which reshuffled every seed's pick, so the seeds were found again with the dev bot
 * headless on #391 merged with main (the keeper, 2026-10-03; the old seeds still give the old pieces
 * on main): Pacific Northwest seed 32, the hay truck at tick 1682 and roadwork at 2388; seed 12, the
 * parade at 1723 and a speed trap at 3503; San Francisco seed 4, the crash scene at 1473.
 */
const RACES = [
  {
    slug: 'pnw-a',
    chip: '#region-region-pnw-pacific-northwest',
    seed: 32,
    pieces: { 'region-pnw:pnw-hay-spill': 'hayLoad', 'region-pnw:pnw-roadwork': 'cone' },
  },
  {
    slug: 'pnw-b',
    chip: '#region-region-pnw-pacific-northwest',
    seed: 12,
    pieces: { 'region-pnw:pnw-logging-parade': 'floatDecor', 'region-pnw:pnw-speed-trap': 'radar' },
  },
  {
    slug: 'sf',
    chip: '#region-region-sf-san-francisco',
    seed: 4,
    pieces: { 'region-sf:sf-crash-scene': 'flare' },
  },
] as const;

for (const race of RACES) {
  test(`${race.slug}: the bot meets the race's road events, and they are drawn`, async ({ page }) => {
    test.setTimeout(240_000); // a hang guard
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
    await page.locator(race.chip).click();
    await page.evaluate((seed) => {
      const g = (window as TestWindow).__game;
      g?.setSeed(seed);
      g?.setBot(true);
    }, race.seed);
    await page.locator('#menu-race').click();
    await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
    mkdirSync('test-results/screenshots', { recursive: true });

    const wanted = Object.entries(race.pieces);
    for (const [piece, kind] of wanted) {
      // The piece goes live as the leading racer closes in: its props appear in the snapshot...
      await page.evaluate(
        ([p, k]) =>
          (window as TestWindow).__game?.fastForward((s) =>
            ((s as unknown as Snap).props ?? []).some((x) => x.piece === p && x.kind === k),
          ),
        [piece, kind] as const,
      );
      await fastForwardDone(page, `${race.slug} ${piece} live`);
      await frames(page, 1); // drawn
      // ...and render draws them, the warning sign with its words.
      const drawn = await page.evaluate(
        () => (window as TestWindow).__game?.rendererStats().eventProps ?? null,
      );
      expect(drawn?.byKind[kind] ?? 0, `${piece}: ${kind} drawn`).toBeGreaterThan(0);
      expect(
        (drawn?.signs ?? []).some((s) => s.length > 0),
        `${piece}: its sign`,
      ).toBe(true);
      // The player rides up to it: one of its props 10 to 80 m ahead, in front of the camera. Fast
      // to APPROACH_M short of it, then frame by frame (4 ticks each) for the last stretch.
      for (const [near, far, perFrame] of [
        [10, APPROACH_M, 240],
        [10, 80, 4],
      ] as const) {
        await page.evaluate(
          ([p, lo, hi, n]) =>
            (window as TestWindow).__game?.fastForward(
              (s) => {
                const snap = s as unknown as Snap;
                const me = snap.entities.find((e) => e.slot === 0);
                if (!me) return false;
                // A model faces -z and turns by its heading: forward is (-sin, -cos).
                const fx = -Math.sin(me.heading);
                const fz = -Math.cos(me.heading);
                return (snap.props ?? []).some((x) => {
                  const dx = x.x - me.x;
                  const dz = x.z - me.z;
                  const ahead = dx * fx + dz * fz;
                  return x.piece === p && ahead > lo && ahead < hi && Math.abs(dx * fz - dz * fx) < 25;
                });
              },
              { perFrame: n, then: 4 },
            ),
          [piece, near, far, perFrame] as const,
        );
        await fastForwardDone(page, `${race.slug} ${piece} ${near} to ${far} m ahead`);
      }
      const inRace = await page.evaluate(() => (window as TestWindow).__game?.state());
      expect(inRace, 'the race was still on when the piece came up').toBe('race');
      await frames(page, 1); // drawn
      const png = await page
        .locator('canvas#game')
        .screenshot({ path: `test-results/screenshots/road-events-${race.slug}-${piece.split(':')[1]}.png` });
      const { variance } = await pixelStats(page, png);
      const stats = await page.evaluate(() => (window as TestWindow).__game?.rendererStats() ?? null);
      console.log(
        `[print] ${race.slug} ${piece}: variance ${variance.toFixed(1)}, draw calls ${stats?.drawCalls}, ` +
          `triangles ${stats?.triangles}, props ${JSON.stringify(stats?.eventProps?.byKind)}, signs ${JSON.stringify(stats?.eventProps?.signs)}`,
      );
      expect(variance, 'the frame is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);
      expect(stats?.drawCalls ?? Infinity).toBeLessThanOrEqual(budget.drawCallsMax);
      expect(stats?.triangles ?? Infinity).toBeLessThanOrEqual(budget.trianglesMax);
    }
    expect(problems).toEqual([]);
  });
}
