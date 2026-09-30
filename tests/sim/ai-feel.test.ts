// ai-2's seeded-race assertion (docs/milestones/M2.md, "ai-2 · Rivals who feel the hits"): on
// dev-4's shared seeded batch, a rival who noted a grudge against the player swings at them more
// often afterwards than before (printed counts; fails only if it doesn't rise). tumble-2 notes the
// grudge (`grudgeNoted`, when a knocked-off rival gets up); until it lands the batch holds none, and
// the check prints NOT ACTIVE. The shared batch's replays cover "scripted races hash the same
// every run". Hard's wider pack is a scripted scene in src/sim/ai/ai.test.ts (the band's effect is
// smaller than seed-to-seed noise across a dozen bot races; see the ai-2 PR).
//
// The rate is per minute the holder and the player spent within hunting range of each other, both
// riding (playtest 1 item 10's faster starter, [default] 2026-09-30). The grudge changes whom a
// rival picks from the riders it can reach (ai-2's seek range, at most 40 m), so time spent far
// apart says nothing about it. Per minute of the whole race, the check measured the finishing
// order instead: at the new speeds most grudge holders finish well ahead of the bot, so their
// "after" minutes were mostly spent out of reach. The whole-race rates are still printed.
import { beforeAll, describe, expect, it } from 'vitest';
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

  it('a rival who noted a grudge against the player swings at them more often afterwards', () => {
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
    // Something to examine on both sides, then the rate within reach must rise.
    expect(nearBefore).toBeGreaterThan(0);
    expect(nearAfter).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(before);
  });
});
