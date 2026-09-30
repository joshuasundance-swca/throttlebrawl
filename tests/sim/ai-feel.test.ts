// ai-2's seeded-race assertion (docs/milestones/M2.md, "ai-2 · Rivals who feel the hits"): on
// dev-4's shared seeded batch, a rival who noted a grudge against the player swings at them more
// often afterwards than before (printed counts; fails only if it doesn't rise). tumble-2 notes the
// grudge (`grudgeNoted`, when a knocked-off rival gets up); until it lands the batch holds none, and
// the check prints NOT ACTIVE. The shared batch's replays cover "scripted races hash the same
// every run". Hard's wider pack is a scripted scene in src/sim/ai/ai.test.ts (the band's effect is
// smaller than seed-to-seed noise across a dozen bot races; see the ai-2 PR).
import { beforeAll, describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/api';
import { BATCH_TIMEOUT_MS, simBatch, type BatchResult } from './batch';

// Vitest hides console output of passing tests, so the summary goes straight to stdout.
const print = (line: string) => process.stdout.write(line + '\n');

describe('ai-2: a rival you knocked off comes after you (shared batch)', () => {
  let batch: BatchResult;
  beforeAll(async () => {
    batch = await simBatch();
  }, BATCH_TIMEOUT_MS);

  /** Per grudge a rival noted against the player: its swings at them per minute, before and after. */
  function grudgeRates() {
    const out: {
      seed: number;
      holder: number;
      before: number;
      after: number;
      minBefore: number;
      minAfter: number;
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
        out.push({
          seed: race.seed,
          holder,
          before,
          after,
          minBefore: g.tick / 3600,
          minAfter: Math.max(0, end - g.tick) / 3600,
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
    const before =
      sum((r) => r.before) /
      Math.max(
        1e-9,
        sum((r) => r.minBefore),
      );
    const after =
      sum((r) => r.after) /
      Math.max(
        1e-9,
        sum((r) => r.minAfter),
      );
    print(
      `[ai-2] ${rates.length} grudges against the player over ${batch.races.length} races: ` +
        `holders swung at the player ${sum((r) => r.before)} times in ${sum((r) => r.minBefore).toFixed(1)} min before ` +
        `(${before.toFixed(2)}/min) and ${sum((r) => r.after)} times in ${sum((r) => r.minAfter).toFixed(1)} min after ` +
        `(${after.toFixed(2)}/min)`,
    );
    expect(after).toBeGreaterThan(before);
  });
});
