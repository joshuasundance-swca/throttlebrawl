import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// W-P road events (the maintainer, 2026-10-01b: "events and set pieces: roadwork, crash scenes,
// parades, a farm truck shedding hay, speed traps"). In the real game, the bot races on seeds whose
// events come up early (found headless), and every piece is met on at least one route: a Pacific
// Northwest race with the hay truck and a speed trap, another with the Logger Days parade and
// roadwork, and San Francisco's robotaxi incident. (The Keys hand-made road has events only past
// 60% of the race, after its long shortcut stretch, too far in for this tier.) For each: the sim
// puts the piece's props on the road, render draws them (RendererStats.eventProps, with the warning
// sign's words), the frame with the piece ahead of the player is not blank, the draw stays inside
// the budget, and nothing logs an error.

interface Prop {
  kind: string;
  piece: string;
  x: number;
  z: number;
}
interface Handle {
  snapshot(): {
    tick: number;
    entities: { slot: number; x: number; z: number; heading: number }[];
    props?: Prop[];
  } | null;
  setBot(on: boolean): void;
  setSeed(seed: number): void;
  rendererStats(): {
    drawCalls: number;
    triangles: number;
    eventProps?: { total: number; byKind: Readonly<Record<string, number>>; signs: readonly string[] };
  };
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as {
  drawCallsMax: number;
  trianglesMax: number;
};

/** Seeds whose events come up early in the region's standard race (found headless). */
const RACES = [
  {
    slug: 'pnw-a',
    chip: '#region-region-pnw-pacific-northwest',
    seed: 2,
    pieces: { 'region-pnw:pnw-hay-spill': 'hayLoad', 'region-pnw:pnw-speed-trap': 'radar' },
  },
  {
    slug: 'pnw-b',
    chip: '#region-region-pnw-pacific-northwest',
    seed: 1,
    pieces: { 'region-pnw:pnw-logging-parade': 'floatDecor', 'region-pnw:pnw-roadwork': 'cone' },
  },
  {
    slug: 'sf',
    chip: '#region-region-sf-san-francisco',
    seed: 60,
    pieces: { 'region-sf:sf-crash-scene': 'flare' },
  },
] as const;

for (const race of RACES) {
  test(`${race.slug}: the bot meets the race's road events, and they are drawn`, async ({ page }) => {
    test.setTimeout(240_000);
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
      await page.waitForFunction(
        ([p, k]) =>
          ((window as TestWindow).__game?.snapshot()?.props ?? []).some((x) => x.piece === p && x.kind === k),
        [piece, kind] as const,
        { timeout: 150_000 },
      );
      // ...and render draws them, the warning sign with its words.
      const drawn = await page.evaluate(
        () => (window as TestWindow).__game?.rendererStats().eventProps ?? null,
      );
      expect(drawn?.byKind[kind] ?? 0, `${piece}: ${kind} drawn`).toBeGreaterThan(0);
      expect(
        (drawn?.signs ?? []).some((s) => s.length > 0),
        `${piece}: its sign`,
      ).toBe(true);
      // The player rides up to it: one of its props 10 to 80 m ahead, in front of the camera.
      await page.waitForFunction(
        (p) => {
          const snap = (window as TestWindow).__game?.snapshot();
          const me = snap?.entities.find((e) => e.slot === 0);
          if (!me) return false;
          // A model faces -z and turns by its heading: forward is (-sin, -cos).
          const fx = -Math.sin(me.heading);
          const fz = -Math.cos(me.heading);
          return (snap?.props ?? []).some((x) => {
            const dx = x.x - me.x;
            const dz = x.z - me.z;
            const ahead = dx * fx + dz * fz;
            return x.piece === p && ahead > 10 && ahead < 80 && Math.abs(dx * fz - dz * fx) < 25;
          });
        },
        piece,
        { timeout: 150_000 },
      );
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
