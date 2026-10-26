/// <reference types="vite/client" />
// A cop on a road with no shoulder never holds his lane at a crawl while nobody is beside him
// (2026-10-26, Eagle Point). The rule "never stand still in a travel lane: below the crawl, head for
// the shoulder and keep rolling until clear of it" (sim/cops/step.ts) left a cop with no shoulder to
// reach crawling on at CRAWL_MPS for good: on Eagle Point's one-lane, one-way park loops a patrol cop
// who had pulled out ahead of the player held the cars behind him, and the player behind them, at
// about 4 m/s (the dev bot's Survey Run: 2 of 4 seeds past their time limit, one 3 minutes at a walk).
// Now, ahead of his man or with nobody to chase, he rides on at his patrol pace; behind his man he
// still slows to the crawl, as before. Measured on main's own Quick Play Survey Run with the dev bot.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { registryFromGlob } from '../../src/content';
import { blankActions, botInput, createBot } from '../../src/dev/bot';
import { createSimWithWorld } from '../../src/sim/create';
import { COP_CHASING, CRAWL_MPS, copsState, gapAlongRoute, sideLanes } from '../../src/sim/cops';

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const EVENT = 'region-clinton:clinton-mara-survey-run';
const SEEDS = [1, 2, 3, 4];
const TICKS = 200 * 60;

/** One bot ride: each cop's longest crawl in a shoulderless lane ahead of his man (or with none), and the player's longest slow spell. */
function ride(seed: number) {
  const c = buildSimConfig(REG, streamForEvent(REG, EVENT), {
    seed,
    eventId: EVENT,
    playerBike: 'base:rustbucket-400',
  });
  const { sim, world } = createSimWithWorld(c);
  const player = world.movers.find((m) => c.riders[m.riderIndex]?.role === 'player')!;
  const bot = createBot();
  const st = copsState(world);
  const crawl = new Map<number, number>();
  let worstCrawl = 0;
  let shoulderless = 0;
  let slow = 0;
  let worstSlow = 0;
  while (!sim.isOver() && sim.tick < TICKS) {
    const a = blankActions();
    bot.drive(sim.snapshot(), player.id, c.route, a);
    sim.step([botInput(a)]);
    for (const id of st.cops) {
      const cop = world.movers[id];
      if (!cop || cop.mode !== 'Road') continue;
      const noShoulder = !sideLanes(c, cop.pos).shoulder;
      if (noShoulder) shoulderless++;
      const target = st.phase[id] === COP_CHASING ? world.movers[st.target[id] ?? -1] : undefined;
      const aheadOrAlone = !target || gapAlongRoute(c, cop, target) < -10;
      // A man who is down is his to bust: waiting on him is the bust's rule (sim/cops), and it ends as he
      // gets up (3.5 and 4.5 s on seeds 2 and 4, 2026-10-26), so it is not a crawl that holds the race.
      const targetDown = !!target && (target.mode === 'Tumble' || target.mode === 'OnFoot');
      // A car just ahead in his lane is a reason to slow (traffic has the last word); his own crawl is not.
      const carAhead = world.movers.some(
        (m) =>
          m.kind === 'vehicle' &&
          m.pos.edge === cop.pos.edge &&
          m.pos.dir === cop.pos.dir &&
          (m.pos.s - cop.pos.s) * cop.pos.dir > 0 &&
          (m.pos.s - cop.pos.s) * cop.pos.dir < 40 &&
          Math.abs(m.pos.d - cop.pos.d) < 2,
      );
      const crawling =
        noShoulder &&
        aheadOrAlone &&
        !targetDown &&
        !carAhead &&
        st.phase[id] !== 0 &&
        cop.speed <= CRAWL_MPS + 0.5;
      const n = crawling ? (crawl.get(id) ?? 0) + 1 : 0;
      crawl.set(id, n);
      worstCrawl = Math.max(worstCrawl, n);
    }
    slow = player.mode === 'Road' && player.speed < 5 ? slow + 1 : 0;
    worstSlow = Math.max(worstSlow, slow);
  }
  return { seed, worstCrawl, shoulderless, worstSlow, ticks: sim.tick };
}

describe('cops on a road with no shoulder (Eagle Point)', () => {
  it('never crawl on in the lane ahead of their man, so the race behind them is not held at a walk', () => {
    const runs = SEEDS.map(ride);
    process.stdout.write(
      `[examined] ${EVENT}, dev bot on the Rustbucket, seeds ${SEEDS.join(',')}: ${runs
        .map(
          (r) =>
            `seed ${r.seed}: worst cop crawl ${r.worstCrawl} ticks over ${r.shoulderless} shoulderless cop ticks, player slow ${r.worstSlow} ticks, ${r.ticks} ticks`,
        )
        .join('; ')}\n`,
    );
    // The check can see the case: cops do ride shoulderless lanes here.
    for (const r of runs) expect(r.shoulderless, `seed ${r.seed}`).toBeGreaterThan(600);
    // At most a second or two at the crawl while he gathers speed, never a crawl that lasts.
    for (const r of runs)
      expect(r.worstCrawl, `seed ${r.seed}: a cop crawling ahead`).toBeLessThanOrEqual(120);
    // And the rider behind him is never held at a walk for long (10 s; a fall and remount is shorter).
    for (const r of runs)
      expect(r.worstSlow, `seed ${r.seed}: the player held at a walk`).toBeLessThanOrEqual(600);
  }, 180_000);
});
