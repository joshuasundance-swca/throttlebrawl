// ai-2's seeded-race assertion (docs/milestones/M2.md, "ai-2 · Rivals who feel the hits"): a rival
// who noted a grudge against the player swings at them more often afterwards. tumble-2 notes the
// grudge (`grudgeNoted`, when a knocked-off rival gets up). Hard's wider pack is a scripted scene in
// src/sim/ai/ai.test.ts (the band's effect is smaller than seed-to-seed noise across a dozen bot
// races; see the ai-2 PR). The shared batch's replays cover "scripted races hash the same every run".
//
// Replaced for playtest 1 item 10's faster starter ([default] 2026-09-30, the riders-5 amendment):
// - The shared batch's before-and-after rates are still printed, whole-race and per minute the two
//   spent within hunting range, but no longer asserted. At the new speeds the batch holds only a
//   handful of grudges against the bot (4 to 6 in 50 races, against 12 to 13 at 85 mph), and those
//   compare unlike windows: "before" always ends with the fight that knocked the holder off, and
//   "after" ends when either finishes, so the rate tracked the finishing order and the fight that
//   caused the grudge, not the grudge.
// - What is asserted is the grudge's own effect, as an A/B on the real race: the same seeded race
//   run twice, identical until a racer-style rival first rides within 30 m of the player after 20 s;
//   then in one run it holds a grudge against the player (noteGrudge, the fact tumble-2 writes) and
//   in the other it does not. Over the next 60 s it must swing at the player more, and ride close
//   to them longer, with the grudge. A racer only hunts someone it holds a grudge against; a
//   heavy-hitter already hunts the player first, so a grudge changes nothing measurable for it.
//   M4 rivals-1 gave the four regulars their own styles, so "racer-style" now means any style that
//   does not hunt by itself (`plainHunter` below: Dial-Up the weaver and Chad the showboat in the
//   base race). With `ai.styleQuirks` on, the showboat is left out too: he will not take on a
//   player healthier than him, grudge or not.
import { beforeAll, describe, expect, it } from 'vitest';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { SimEvent } from '../../src/sim/api';
import { huntsByDefault, resolveProfile } from '../../src/sim/ai';
import { createSimWithWorld } from '../../src/sim/create';
import { noteGrudge } from '../../src/sim/world';
import { BATCH_TIMEOUT_MS, createBatchRace, simBatch, TRACE_EVERY_TICKS, type BatchResult } from './batch';

/** Hunting range: ai-2's widest seek range (10 m + 30 m at full aggression), metres of progress. */
const NEAR_M = 40;
/** The A/B's seeds, its window and "close" (a fight's distance), [default]. */
const AB_SEEDS = [1, 2, 3, 4, 5, 6];
const AB_WINDOW_TICKS = 60 * 60;
const AB_CLOSE_M = 6;

/** A style that hunts only whom it holds a grudge against, and picks no fights by looks (rivals-1). */
const plainHunter = (style: string, quirks: boolean): boolean =>
  !huntsByDefault(style) && !(quirks && resolveProfile(style, undefined).traits.showboat);

/**
 * One A/B run: the base race with the bot, until a racer-style rival first rides within 30 m of the
 * player after 20 s; then, with `grudge`, that rival notes a grudge against the player. Returns its
 * swings at the player and the seconds it rode within AB_CLOSE_M of them over the next 60 s.
 */
function grudgeRun(seed: number, grudge: boolean) {
  const { config, playerId, route } = createBatchRace(seed);
  const quirks = (config.tuning['ai.styleQuirks'] ?? 0) >= 0.5;
  const { sim, world } = createSimWithWorld(config);
  const bot = createBot();
  let snap = sim.snapshot();
  let t0 = -1;
  let holder = -1;
  let swings = 0;
  let closeTicks = 0;
  while (!sim.isOver() && (t0 < 0 ? sim.tick < 60 * 600 : sim.tick < t0 + AB_WINDOW_TICKS)) {
    const me = snap.entities[playerId];
    if (t0 < 0 && sim.tick >= 60 * 20 && me?.mode === 'Road') {
      for (const e of snap.entities) {
        const c = config.riders[e.id]?.controller;
        if (e.kind !== 'rider' || e.mode !== 'Road' || c?.kind !== 'ai' || !plainHunter(c.style, quirks))
          continue;
        if (Math.abs(e.progress - me.progress) > 30) continue;
        holder = e.id;
        t0 = sim.tick;
        if (grudge) noteGrudge(world, holder, playerId);
        break;
      }
    }
    const a = emptyActions();
    bot.drive(snap, playerId, route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    if (t0 < 0) continue;
    for (const e of sim.events())
      if (e.type === 'attackStart' && e.actor === holder && e.target === playerId) swings++;
    const h = snap.entities[holder];
    const p = snap.entities[playerId];
    if (h && p && !h.finished && !p.finished && Math.abs(h.progress - p.progress) <= AB_CLOSE_M) closeTicks++;
  }
  return { t0, holder, swings, closeS: closeTicks / 60 };
}

// Vitest hides console output of passing tests, so the summary goes straight to stdout.
const print = (line: string) => process.stdout.write(line + '\n');

describe('ai-2: a rival you knocked off comes after you (shared batch)', () => {
  let batch: BatchResult;
  beforeAll(async () => {
    batch = await simBatch();
  }, BATCH_TIMEOUT_MS);

  /**
   * Per grudge a rival noted against the player: its swings at them, and the minutes before and
   * after it, in all and within hunting range (both riding, within NEAR_M of each other).
   */
  function grudgeRates() {
    const route = createBatchRace(1).config.route; // one event, one route, for every seed
    const out: {
      seed: number;
      holder: number;
      before: number;
      after: number;
      minBefore: number;
      minAfter: number;
      nearBefore: number;
      nearAfter: number;
    }[] = [];
    for (const race of batch.races) {
      const pid = race.playerId;
      const done: Record<number, number> = {};
      for (const e of race.events)
        if (e.type === 'finish' && done[e.actor] === undefined) done[e.actor] = e.tick;
      for (const g of race.events) {
        if (g.type !== 'grudgeNoted' || g.target !== pid) continue;
        const holder = g.actor;
        // The fight is over once either of them is home (or the race ends).
        const end = Math.min(done[pid] ?? race.ticks, done[holder] ?? race.ticks, race.ticks);
        const swings = (e: SimEvent) => e.type === 'attackStart' && e.actor === holder && e.target === pid;
        const before = race.events.filter((e) => swings(e) && e.tick < g.tick).length;
        const after = race.events.filter((e) => swings(e) && e.tick >= g.tick && e.tick < end).length;
        // Trace samples every TRACE_EVERY_TICKS ticks where both ride within NEAR_M of each other.
        let nearBefore = 0;
        let nearAfter = 0;
        for (const sample of race.trace) {
          if (sample.tick >= end) break;
          const a = sample.movers[holder];
          const b = sample.movers[pid];
          if (!a || !b || a.mode !== 'Road' || b.mode !== 'Road') continue;
          const gap = route.progressAt(a.edge, a.s) - route.progressAt(b.edge, b.s);
          if (!(Math.abs(gap) <= NEAR_M)) continue;
          if (sample.tick < g.tick) nearBefore++;
          else nearAfter++;
        }
        out.push({
          seed: race.seed,
          holder,
          before,
          after,
          minBefore: g.tick / 3600,
          minAfter: Math.max(0, end - g.tick) / 3600,
          nearBefore: (nearBefore * TRACE_EVERY_TICKS) / 3600,
          nearAfter: (nearAfter * TRACE_EVERY_TICKS) / 3600,
        });
      }
    }
    return out;
  }

  it('prints the batch’s grudges against the player, before and after (not asserted)', () => {
    const rates = grudgeRates();
    const grudgeEvents = batch.races.reduce((n, r) => n + (r.eventCounts['grudgeNoted'] ?? 0), 0);
    if (rates.length === 0) {
      print(
        `[ai-2] NOT ACTIVE: ${batch.races.length} races, ${grudgeEvents} grudgeNoted events, none against the ` +
          `player (tumble-2 notes grudges; until it lands this check has nothing to examine)`,
      );
      return;
    }
    const sum = (f: (r: (typeof rates)[number]) => number) => rates.reduce((n, r) => n + f(r), 0);
    const per = (swings: number, min: number) => swings / Math.max(1e-9, min);
    const swingsBefore = sum((r) => r.before);
    const swingsAfter = sum((r) => r.after);
    const nearBefore = sum((r) => r.nearBefore);
    const nearAfter = sum((r) => r.nearAfter);
    const before = per(swingsBefore, nearBefore);
    const after = per(swingsAfter, nearAfter);
    print(
      `[ai-2] ${rates.length} grudges against the player over ${batch.races.length} races: ` +
        `holders swung at the player ${swingsBefore} times before and ${swingsAfter} after; ` +
        `within ${NEAR_M} m of the player ${nearBefore.toFixed(1)} min before (${before.toFixed(2)}/min) and ` +
        `${nearAfter.toFixed(1)} min after (${after.toFixed(2)}/min); whole race ` +
        `${per(
          swingsBefore,
          sum((r) => r.minBefore),
        ).toFixed(2)}/min before, ` +
        `${per(
          swingsAfter,
          sum((r) => r.minAfter),
        ).toFixed(2)}/min after`,
    );
  });

  it('a rival who holds a grudge against the player swings at them more, and rides closer (A/B)', () => {
    const rows: string[] = [];
    let swingsOff = 0;
    let swingsOn = 0;
    let closeOff = 0;
    let closeOn = 0;
    let examined = 0;
    for (const seed of AB_SEEDS) {
      const off = grudgeRun(seed, false);
      const on = grudgeRun(seed, true);
      // Both runs are the same race until the grudge: the same moment and the same rival.
      expect(on.t0, `seed ${seed}`).toBe(off.t0);
      expect(on.holder, `seed ${seed}`).toBe(off.holder);
      if (off.t0 < 0) continue;
      examined++;
      swingsOff += off.swings;
      swingsOn += on.swings;
      closeOff += off.closeS;
      closeOn += on.closeS;
      rows.push(
        `seed ${seed} rival ${off.holder}: ${off.swings}→${on.swings} swings, ${off.closeS.toFixed(1)}→${on.closeS.toFixed(1)} s close`,
      );
    }
    print(
      `[ai-2] grudge A/B over ${examined} races (60 s after a racer-style rival first rides within 30 m of the player): ` +
        `swings at the player ${swingsOff} without the grudge, ${swingsOn} with it; within ${AB_CLOSE_M} m ` +
        `${closeOff.toFixed(1)} s without, ${closeOn.toFixed(1)} s with. ${rows.join('; ')}`,
    );
    expect(examined).toBeGreaterThanOrEqual(AB_SEEDS.length - 1);
    expect(swingsOn).toBeGreaterThan(swingsOff);
    expect(closeOn).toBeGreaterThan(closeOff);
  }, 300_000);
});
