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
// - What is asserted is the grudge's own effect, as an A/B on the real race: a racer-style rival
//   with and without a grudge against the player, from the same moment of the same seeded race. It
//   lives in tests/sim/ai-grudge-ab.test.ts since 2026-10-05: it reads no batch, so in a file of its
//   own it no longer waits about 280 s for one, and CI can run it on another runner.
import { beforeAll, describe, it } from 'vitest';
import type { SimEvent } from '../../src/sim/api';
import { BATCH_TIMEOUT_MS, createBatchRace, simBatch, TRACE_EVERY_TICKS, type BatchResult } from './batch';

/** Hunting range: ai-2's widest seek range (10 m + 30 m at full aggression), metres of progress. */
const NEAR_M = 40;
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
});
