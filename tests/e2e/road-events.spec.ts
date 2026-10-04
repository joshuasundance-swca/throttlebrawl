import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fastForwardDone, frames } from './lockstep';
import { NOT_BLANK_VARIANCE, pixelStats } from './pixels';

// W-P road events (the maintainer, 2026-10-01b: "events and set pieces: roadwork, crash scenes,
// parades, a farm truck shedding hay, speed traps"). In the real game, the bot races the region's
// free-play race and every piece below is met: the Pacific Northwest's hay truck, roadwork, speed
// trap and Logger Days parade, and San Francisco's robotaxi incident. (The Keys hand-made road has
// events only past 60% of the race, after its long shortcut stretch, too far in for this tier.)
// For each: the sim puts the piece's props on the road, render draws them
// (RendererStats.eventProps, with the warning sign's words), the frame with the piece ahead of the
// player is not blank, the draw stays inside the budget, and nothing logs an error.
//
// Which seed brings which piece is not named here. Each region rides seeds 1, 2, 3 and on, in order
// (the seed-search rule, docs/engineering.md: the same build always uses the same seeds, and each
// one used is printed), and meets every wanted piece that comes up, until all have been met. A
// content change that reshuffles the races (new pieces in a pool, a longer start: #391, #414) moves
// the search on to later seeds instead of failing the spec. It fails when no seed in the search
// brings a piece, which is a real "this piece never comes up any more" signal. (Headless with the
// dev bot on 2026-10-04: seeds 1, 2 and 5 meet the four Pacific Northwest pieces, seed 3 the crash.)
//
// The race fast-forwards between those moments (the test handle's fastForward over the loop's
// lockstep; the determinism run's R4): 240 ticks a drawn frame until a wanted piece's props are
// live, again until one is within APPROACH_M ahead, then 4 ticks a frame, every frame drawn, until
// it is 10 to 80 m ahead. Each stop is the exact tick the condition first holds, so the waits are
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
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle; __aheadAt?: number | null };

/**
 * Where the fast ride stops short of the piece: the last stretch, 4 ticks a drawn frame, gives the
 * chase camera more than a second of race to catch up before the screenshot. [default]
 */
const APPROACH_M = 160;
/** Seeds each region tries, from 1, before a piece counts as never coming up (a bound, as firstSeed's). */
const SEARCH_SEEDS = 16;
/**
 * A wanted piece not live by this tick counts as not in this seed's race, and the search moves on.
 * Headless, the pieces go live 1,500 to 4,400 ticks in (rarely later). [default]
 */
const LIVE_BY_TICK = 5_400;
/** A live piece that never comes 10 to 80 m ahead within this many ticks was passed: next seed. */
const RIDE_UP_TICKS = 1_800;

const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as {
  drawCallsMax: number;
  trianglesMax: number;
};

/** Each region's free-play race and the pieces to meet in it, by the prop kind that marks each. */
const REGIONS = [
  {
    slug: 'pnw',
    chip: '#region-region-pnw-pacific-northwest',
    pieces: {
      'region-pnw:pnw-hay-spill': 'hayLoad',
      'region-pnw:pnw-roadwork': 'cone',
      'region-pnw:pnw-speed-trap': 'radar',
      'region-pnw:pnw-logging-parade': 'floatDecor',
    },
  },
  {
    slug: 'sf',
    chip: '#region-region-sf-san-francisco',
    pieces: { 'region-sf:sf-crash-scene': 'flare' },
  },
] as const;

/** Starts the region's free-play race on `seed`, with the bot riding. */
async function startRace(page: Page, chip: string, seed: number): Promise<void> {
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator(chip).click();
  await page.evaluate((s) => {
    const g = (window as TestWindow).__game;
    g?.setSeed(s);
    g?.setBot(true);
  }, seed);
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
}

/**
 * Rides up to a live piece (one of its props 10 to 80 m ahead, in front of the camera) and checks
 * the frame there. False when the player passes it first (a race where it went live behind the
 * player): the search then tries the next seed.
 */
async function meet(
  page: Page,
  slug: string,
  seed: number,
  piece: string,
  liveTick: number,
): Promise<boolean> {
  const deadline = liveTick + RIDE_UP_TICKS;
  // Fast to APPROACH_M short of it, then frame by frame (4 ticks each) for the last stretch.
  for (const [near, far, perFrame] of [
    [10, APPROACH_M, 240],
    [10, 80, 4],
  ] as const) {
    await page.evaluate(
      ([p, lo, hi, n, by]) => {
        const w = window as TestWindow;
        w.__aheadAt = null;
        w.__game?.fastForward(
          (s) => {
            const snap = s as unknown as Snap;
            const me = snap.entities.find((e) => e.slot === 0);
            if (!me) return false;
            // A model faces -z and turns by its heading: forward is (-sin, -cos).
            const fx = -Math.sin(me.heading);
            const fz = -Math.cos(me.heading);
            const ahead = (snap.props ?? []).some((x) => {
              const dx = x.x - me.x;
              const dz = x.z - me.z;
              const along = dx * fx + dz * fz;
              return x.piece === p && along > lo && along < hi && Math.abs(dx * fz - dz * fx) < 25;
            });
            if (ahead) w.__aheadAt = snap.tick;
            return ahead || snap.tick > by;
          },
          { perFrame: n, then: 4 },
        );
      },
      [piece, near, far, perFrame, deadline] as const,
    );
    await fastForwardDone(page, `${slug} seed ${seed} ${piece} ${near} to ${far} m ahead`);
    const aheadAt = await page.evaluate(() => (window as TestWindow).__aheadAt ?? null);
    if (aheadAt === null) {
      console.log(`[road-events] ${slug} seed ${seed}: ${piece} was passed, not met; the search goes on`);
      return false;
    }
  }
  const inRace = await page.evaluate(() => (window as TestWindow).__game?.state());
  expect(inRace, 'the race was still on when the piece came up').toBe('race');
  await frames(page, 1); // drawn
  const png = await page
    .locator('canvas#game')
    .screenshot({ path: `test-results/screenshots/road-events-${slug}-${piece.split(':')[1]}.png` });
  const { variance } = await pixelStats(page, png);
  const stats = await page.evaluate(() => (window as TestWindow).__game?.rendererStats() ?? null);
  console.log(
    `[print] ${slug} seed ${seed} ${piece}: variance ${variance.toFixed(1)}, draw calls ${stats?.drawCalls}, ` +
      `triangles ${stats?.triangles}, props ${JSON.stringify(stats?.eventProps?.byKind)}, signs ${JSON.stringify(stats?.eventProps?.signs)}`,
  );
  expect(variance, 'the frame is not blank').toBeGreaterThan(NOT_BLANK_VARIANCE);
  expect(stats?.drawCalls ?? Infinity).toBeLessThanOrEqual(budget.drawCallsMax);
  expect(stats?.triangles ?? Infinity).toBeLessThanOrEqual(budget.trianglesMax);
  return true;
}

for (const region of REGIONS) {
  test(`${region.slug}: the bot meets the region's road events, and they are drawn`, async ({ page }) => {
    test.setTimeout(600_000); // a hang guard over the whole seed search
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    await page.addInitScript(() => {
      (window as TestWindow).__GAME_TEST__ = true;
    });
    mkdirSync('test-results/screenshots', { recursive: true });

    const wanted = Object.entries(region.pieces);
    const met = new Map<string, number>();
    for (let seed = 1; seed <= SEARCH_SEEDS && met.size < wanted.length; seed++) {
      await startRace(page, region.chip, seed);
      // Pieces this race showed but the player rode past: not looked for again in this race.
      const passed = new Set<string>();
      for (;;) {
        const left = wanted.filter(([p]) => !met.has(p) && !passed.has(p));
        if (left.length === 0) break;
        // A wanted piece goes live as the leading racer closes in: its props appear in the snapshot.
        await page.evaluate(
          ([l, by]) =>
            (window as TestWindow).__game?.fastForward((s) => {
              const props = (s as unknown as Snap).props ?? [];
              return s.tick >= by || props.some((x) => l.some(([p, k]) => x.piece === p && x.kind === k));
            }),
          [left, LIVE_BY_TICK] as const,
        );
        const tick = await fastForwardDone(page, `${region.slug} seed ${seed}: a wanted piece live`);
        const live = await page.evaluate((l) => {
          const g = (window as TestWindow).__game;
          const props = g?.state() === 'race' ? (g.snapshot()?.props ?? []) : [];
          return l.find(([p, k]) => props.some((x) => x.piece === p && x.kind === k)) ?? null;
        }, left);
        if (!live) break; // nothing more in this seed's race
        const [piece, kind] = live;
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
        if (await meet(page, region.slug, seed, piece, tick)) met.set(piece, seed);
        else passed.add(piece);
      }
    }
    console.log(
      `[road-events] ${region.slug}: ${[...met].map(([p, s]) => `${p.split(':')[1]} on seed ${s}`).join(', ') || 'nothing met'}`,
    );
    const never = wanted.map(([p]) => p).filter((p) => !met.has(p));
    expect(never, `pieces no seed from 1 to ${SEARCH_SEEDS} brought up and showed`).toEqual([]);
    expect(problems).toEqual([]);
  });
}
