// ai-2's seeded-race assertions (docs/milestones/M2.md, "ai-2 · Rivals who feel the hits"):
//   - on dev-4's shared seeded batch, a rival the player knocked off targets the player more often
//     afterwards than before (printed counts; fails only if it doesn't rise). The grudge is noted by
//     tumble-2's `grudgeNoted`; until that lands the batch holds none, and the check says so;
//   - Hard's rubber-band factor keeps the pack's first-to-last gap wider than Easy's (printed), from
//     races run with each preset (the shared batch runs Normal only). The two presets' aggression
//     and cop frequency are pinned to 1 there, so only their rubber-band scales differ: measured
//     with every scale as shipped, Hard's harder fighting blurs the gap (12 seeds when written:
//     1.14x, Hard wider in 7 of 12; with the band alone 1.20x, 8 of 12);
//   - scripted races hash the same every run.
import { beforeAll, describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { DifficultyPreset, SimEvent } from '../../src/sim/api';
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

// ---- Easy and Hard ---------------------------------------------------------------------------

/** Seeds for the preset races: fewer than the shared batch, since each preset runs its own. */
const PRESET_SEEDS = Array.from({ length: 12 }, (_, i) => 101 + i);
/** Easy and Hard with everything but the rubber band pinned to Normal's scale. */
const BAND_ONLY: Readonly<Record<string, number>> = {
  'difficulty.easy.riderAggression': 1,
  'difficulty.hard.riderAggression': 1,
  'difficulty.easy.copFrequency': 1,
  'difficulty.hard.copFrequency': 1,
};
const MAX_TICKS = 15 * 60 * 60;

interface PresetRace {
  /** Mean over the race (sampled each second) of the first-to-last gap among riders still racing, m. */
  meanSpread: number;
  /** Mean over the race of each rival's distance from the player (what the rubber band pulls on), m. */
  meanRivalGap: number;
  /** Seconds from the first finisher to the last. */
  finishGap: number;
  hash: number;
}

function runPresetRace(seed: number, difficulty: DifficultyPreset): PresetRace {
  const { sim, route, playerId } = createHeadlessRace(
    { seed, difficulty, tuning: BAND_ONLY },
    { includeDrafts: true },
  );
  const bot = createBot();
  let snap = sim.snapshot();
  let spreadSum = 0;
  let rivalGapSum = 0;
  let samples = 0;
  const finished: number[] = [];
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    for (const e of sim.events()) if (e.type === 'finish') finished.push(e.tick);
    if (sim.tick % 60 === 0) {
      const racing = snap.entities.filter((e) => e.kind === 'rider' && e.faction === 'rider' && !e.finished);
      const me = snap.entities[playerId];
      const rivals = racing.filter((e) => e.id !== playerId);
      if (me && !me.finished && rivals.length > 0) {
        const dists = racing.map((e) => e.distanceToFinish);
        spreadSum += Math.max(...dists) - Math.min(...dists);
        rivalGapSum +=
          rivals.reduce((n, e) => n + Math.abs(e.distanceToFinish - me.distanceToFinish), 0) / rivals.length;
        samples++;
      }
    }
  }
  return {
    meanSpread: samples > 0 ? spreadSum / samples : 0,
    meanRivalGap: samples > 0 ? rivalGapSum / samples : 0,
    finishGap: finished.length > 1 ? (Math.max(...finished) - Math.min(...finished)) / 60 : 0,
    hash: sim.hash(),
  };
}

describe('ai-2: difficulty presets (their own seeded races)', () => {
  const results: Record<'easy' | 'hard', PresetRace[]> = { easy: [], hard: [] };
  beforeAll(() => {
    for (const p of ['easy', 'hard'] as const) results[p] = PRESET_SEEDS.map((s) => runPresetRace(s, p));
  }, BATCH_TIMEOUT_MS);

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

  it("Hard's weaker rubber band leaves the pack's first-to-last gap wider than Easy's", () => {
    const easy = mean(results.easy.map((r) => r.meanSpread));
    const hard = mean(results.hard.map((r) => r.meanSpread));
    const easyGap = mean(results.easy.map((r) => r.finishGap));
    const easyRival = mean(results.easy.map((r) => r.meanRivalGap));
    const hardRival = mean(results.hard.map((r) => r.meanRivalGap));
    const hardGap = mean(results.hard.map((r) => r.finishGap));
    const wider = PRESET_SEEDS.filter(
      (_, i) => (results.hard[i]?.meanSpread ?? 0) > (results.easy[i]?.meanSpread ?? 0),
    );
    print(
      `[ai-2] ${PRESET_SEEDS.length} races per preset (rubber band only; aggression and cops pinned): ` +
        `pack spread (first to last still racing, mean while the player races) ` +
        `Easy ${easy.toFixed(0)} m, Hard ${hard.toFixed(0)} m (${(hard / Math.max(1e-9, easy)).toFixed(2)}×; ` +
        `Hard wider in ${wider.length} of ${PRESET_SEEDS.length} seeds); first-to-last finisher Easy ${easyGap.toFixed(1)} s, ` +
        `Hard ${hardGap.toFixed(1)} s; rival-to-player gap Easy ${easyRival.toFixed(0)} m, Hard ${hardRival.toFixed(0)} m`,
    );
    expect(results.easy.length).toBe(PRESET_SEEDS.length);
    expect(hard).toBeGreaterThan(easy);
  });

  it('a preset race gives the same hash every run', () => {
    const seed = PRESET_SEEDS[0] ?? 101;
    expect(runPresetRace(seed, 'hard').hash).toBe(results.hard[0]?.hash);
  });
});
