import { beforeAll, describe, expect, it } from 'vitest';
import {
  BATCH_RACES,
  BATCH_SEEDS,
  BATCH_TIMEOUT_MS,
  simBatch,
  type BatchResult,
  type RaceResult,
} from './batch';

// dev-1's own assertions over the shared batch (docs/milestones/M1.md, dev-1 acceptance and M1
// exit criterion 2): 50 seeded races, each ends, no NaN, every mover has a valid mode and road
// position at every tick, and each race replays in the same run to identical state hashes.
// Field and combat assertions belong to the lanes that build them (their own tests/sim files);
// this file prints what the field contained so a gap is visible.

let batch: BatchResult;
const race = (seed: number): RaceResult => {
  const r = batch.races.find((x) => x.seed === seed);
  if (!r) throw new Error(`no race for seed ${seed}`);
  return r;
};

// Vitest hides console output of passing tests, so the summary goes straight to stdout.
const print = (line: string) => process.stdout.write(line + '\n');

beforeAll(async () => {
  batch = await simBatch();
  const rs = batch.races;
  const sum = (f: (r: RaceResult) => number) => rs.reduce((n, r) => n + f(r), 0);
  const ticks = sum((r) => r.ticks);
  const f = rs[0]?.field;
  print(
    `[sim batch] ${rs.length} races, ${ticks} ticks (${(ticks / 60 / rs.length).toFixed(1)} s average), ` +
      `${batch.fromCache ? 'from the cache' : `computed in ${(batch.ms / 1000).toFixed(1)} s`}, key ${batch.key}`,
  );
  print(
    `[sim batch] field (seed 1): ${f?.riders} riders = player + ${f?.rivals} rivals + ${f?.cops} cops; ` +
      `vehicles up to ${Math.max(...rs.map((r) => r.field.vehiclesMax))} ` +
      `(dir +1 up to ${Math.max(...rs.map((r) => r.field.vehiclesByDirMax.plus))}, ` +
      `dir -1 up to ${Math.max(...rs.map((r) => r.field.vehiclesByDirMax.minus))}); ` +
      `pedestrians up to ${Math.max(...rs.map((r) => r.field.pedsMax))}`,
  );
  const places = rs.map((r) => (r.playerFinished ? r.playerPlace : 0));
  print(
    `[sim batch] bot: finished ${places.filter((p) => p > 0).length}/${rs.length}, places ${places.join(' ')}; ` +
      `attack presses ${sum((r) => r.bot.attackPresses)}, hits landed ${sum((r) => r.playerHits)} ` +
      `(in ${rs.filter((r) => r.playerHits > 0).length} races), attackStart events ${sum((r) => r.eventCounts['attackStart'] ?? 0)}, ` +
      `crashes ${sum((r) => r.eventCounts['crash'] ?? 0)}, skip ticks ${sum((r) => r.bot.skipTicks)}, ` +
      `traffic dodges ${sum((r) => r.bot.trafficDodges)}, shortcut ticks ${sum((r) => r.bot.shortcutTicks)}`,
  );
}, BATCH_TIMEOUT_MS);

describe('the shared seeded-race batch (dev-1)', () => {
  it(`runs ${BATCH_RACES} seeded races, each with the bot in the player slot and at least one rival`, () => {
    expect(batch.races.map((r) => r.seed)).toEqual([...BATCH_SEEDS]);
    for (const r of batch.races) {
      expect(r.playerId, `seed ${r.seed}: a player slot`).toBeGreaterThanOrEqual(0);
      expect(r.field.rivals, `seed ${r.seed}: rivals`).toBeGreaterThanOrEqual(1);
      expect(r.inputs.length, `seed ${r.seed}: one recorded input per tick`).toBe(r.ticks);
    }
  });

  it('the seeds give different races (the seed reaches the sim)', () => {
    const finals = new Set(batch.races.map((r) => r.hashes[r.hashes.length - 1]));
    expect(finals.size).toBeGreaterThan(1);
  });

  it.each(BATCH_SEEDS)(
    'seed %i: ends with a result for the bot, no invalid mover at any tick, replays to identical hashes',
    (seed) => {
      const r = race(seed);
      expect(r.over, `seed ${seed} ended`).toBe(true);
      const busted = r.events.some(
        (e) => e.type === 'bust' && (e.target === r.playerId || e.actor === r.playerId),
      );
      expect(r.playerFinished || busted, `seed ${seed}: the bot finished or was busted`).toBe(true);
      expect(r.invalidTicks, r.firstInvalid ?? '').toBe(0);
      expect(Object.keys(r.modeTicks).length).toBeGreaterThan(0);
      expect(r.hashes.length).toBeGreaterThan(1);
      expect(r.replayHashes).toHaveLength(r.hashes.length);
      expect(r.firstMismatch, `seed ${seed}: first replay mismatch at hash index ${r.firstMismatch}`).toBe(
        -1,
      );
    },
  );
});
