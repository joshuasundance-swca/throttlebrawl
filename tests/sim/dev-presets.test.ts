import { beforeAll, describe, expect, it } from 'vitest';
import {
  BATCH_TIMEOUT_MS,
  PRESET_RACES,
  PRESET_SEEDS,
  presetBatch,
  simBatch,
  type BatchResult,
  type RaceResult,
} from './batch';
import type { DevHookResult } from './hooks/dev';

// dev-4 over the shared seeded batches (docs/milestones/M2.md, dev-4 and M2 exit criterion 8):
// the Normal batch plus PRESET_RACES races each on Easy and Hard, with the wall time printed, and
// the preset must reach the sim. The Easy-versus-Hard directions (more rival hits on the player and
// more cop spawns on Hard) are printed here with PASS or FAIL. The assertions stay with the lanes
// that own the difficulty scales: riders-5 in riders-difficulty.test.ts and cops-2 in
// cops-difficulty.test.ts. Those lanes move their comparisons onto presetBatch() when they choose.
// The batch hooks run in every race. The M2 bot assertions:
// - the bot lands takedowns (dev-4 part 2 taught it to fight a rival down: kick from the side that
//   shoves the rival toward traffic, steer into the kick for the momentum shove, finish the weakest
//   rival): at least one in the Normal batch, at least one of them a traffic takedown (a rival
//   kicked into a vehicle), and it still finishes at least BOT_MIN_FINISH of its races;
// - slow motion is counted per tick by the dev hook: ACTIVE once any race spends a tick in it, and
//   NOT ACTIVE with the reason until then, so a switched-off check never reads as a pass.
/** The share of Normal races the fighting bot must still finish (it finished 45 of 50 when it learned to fight). [default] */
const BOT_MIN_FINISH = 0.7;
//
// A cop spawn is his siren sounding (sim/cops sounds it as he pulls out), as riders-5 counts it.

let normal: BatchResult;
let easy: BatchResult;
let hard: BatchResult;

const print = (line: string) => process.stdout.write(line + '\n');

function rivalHitsOnPlayer(r: RaceResult): number {
  return r.events.filter((e) => e.type === 'hit' && e.target === r.playerId && e.actor !== r.playerId).length;
}
const copSpawns = (r: RaceResult) =>
  r.events.filter((e) => e.type === 'siren' && e.data['on'] === true).length;
const sum = (b: BatchResult, f: (r: RaceResult) => number) => b.races.reduce((n, r) => n + f(r), 0);
const timing = (b: BatchResult) =>
  b.fromCache ? 'from the cache' : `computed in ${(b.ms / 1000).toFixed(1)} s`;

beforeAll(async () => {
  // The presets first. Each call computes its batch at once when no other worker holds it, so in
  // the old order this file could compute Normal, Easy and Hard one after another (about 290 s on
  // CI) while the other batch readers sat waiting. This way it computes Easy and Hard while another
  // file computes Normal, and only falls back to computing Normal itself when nobody else has.
  [easy, hard, normal] = await Promise.all([presetBatch('easy'), presetBatch('hard'), simBatch()]);
  for (const [name, b] of [
    ['normal', normal],
    ['easy', easy],
    ['hard', hard],
  ] as const) {
    const ticks = sum(b, (r) => r.ticks);
    print(
      `[preset batch] ${name}: ${b.races.length} races, ${ticks} ticks, ${timing(b)}; ` +
        `bot finished ${b.races.filter((r) => r.playerFinished).length}, ` +
        `rival hits on the player ${sum(b, rivalHitsOnPlayer)}, cop spawns ${sum(b, copSpawns)}`,
    );
  }
}, BATCH_TIMEOUT_MS);

describe('dev-4: the Easy and Hard batches', () => {
  it(`runs ${PRESET_RACES} seeded races per preset on the chosen difficulty, each to its end`, () => {
    for (const [name, b] of [
      ['easy', easy],
      ['hard', hard],
    ] as const) {
      expect(b.races.map((r) => r.seed)).toEqual([...PRESET_SEEDS]);
      for (const r of b.races) {
        expect(r.difficulty, `${name} seed ${r.seed}`).toBe(name);
        expect(r.over, `${name} seed ${r.seed} ended`).toBe(true);
        expect(r.invalidTicks, r.firstInvalid ?? '').toBe(0);
      }
    }
    expect(normal.races.every((r) => r.difficulty === 'normal')).toBe(true);
  });

  it('the preset reaches the sim: Easy and Hard races differ on the same seed', () => {
    const differ = easy.races.filter((r, i) => r.hashes.at(-1) !== hard.races[i]?.hashes.at(-1)).length;
    print(`[preset batch] ${differ} of ${PRESET_RACES} seeds end in a different state on Easy and Hard`);
    expect(differ).toBeGreaterThan(PRESET_RACES / 2);
  });

  it('prints whether Hard shows more rival hits on the player and more cop spawns than Easy', () => {
    const line = (what: string, owner: string, f: (r: RaceResult) => number) => {
      const e = sum(easy, f);
      const h = sum(hard, f);
      const ratio = e > 0 ? `${(h / e).toFixed(2)}x` : 'Easy none';
      print(
        `[print] ${what}: Easy ${e}, Hard ${h} (${ratio}): Hard > Easy ${h > e ? 'PASS' : 'FAIL'} (asserted by ${owner})`,
      );
    };
    line('rival hits on the player', 'riders-5', rivalHitsOnPlayer);
    line('cop spawns', 'cops-2', copSpawns);
    expect(easy.races.length + hard.races.length).toBe(2 * PRESET_RACES);
  });
});

describe('dev-4: batch hooks and the bot assertions', () => {
  it('every registered hook ran in every race of every batch', () => {
    for (const b of [normal, easy, hard])
      for (const r of b.races) expect(r.hooks['dev'], `${r.difficulty} seed ${r.seed}`).toBeDefined();
  });

  it('the bot fights rivals down: takedowns in the Normal batch, one into traffic, and it still finishes', () => {
    const all = sum(normal, (r) => r.events.filter((e) => e.type === 'takedown').length);
    const mine = normal.races.flatMap((r) =>
      r.events.filter((e) => e.type === 'takedown' && e.actor === r.playerId),
    );
    const kinds: Record<string, number> = {};
    for (const e of mine) kinds[String(e.data['kind'])] = (kinds[String(e.data['kind'])] ?? 0) + 1;
    const races = normal.races.filter((r) =>
      r.events.some((e) => e.type === 'takedown' && e.actor === r.playerId),
    ).length;
    const finished = normal.races.filter((r) => r.playerFinished).length;
    const kicks = sum(normal, (r) => r.bot.kickPresses);
    const kicksLanded = sum(
      normal,
      (r) => r.events.filter((e) => e.type === 'kick' && e.actor === r.playerId).length,
    );
    const danger = sum(normal, (r) => r.bot.dangerKicks);
    print(
      `[assert] the bot lands takedowns: ACTIVE (${mine.length} bot takedowns of ${all} in ${normal.races.length} races, ` +
        `in ${races} races; by kind ${JSON.stringify(kinds)}; kicks pressed ${kicks}, landed ${kicksLanded}, ` +
        `aimed into traffic ${danger}; the bot finished ${finished} of ${normal.races.length})`,
    );
    for (const [name, b] of [
      ['easy', easy],
      ['hard', hard],
    ] as const) {
      const n = sum(b, (r) => r.events.filter((e) => e.type === 'takedown' && e.actor === r.playerId).length);
      print(
        `[print] ${name}: ${n} bot takedowns, the bot finished ${b.races.filter((r) => r.playerFinished).length} of ${b.races.length}`,
      );
    }
    expect(mine.length).toBeGreaterThan(0);
    expect(kinds['traffic'] ?? 0, 'a rival kicked into traffic').toBeGreaterThan(0);
    expect(
      finished / normal.races.length,
      'the fighting bot still finishes its races',
    ).toBeGreaterThanOrEqual(BOT_MIN_FINISH);
  });

  it('prints the slow-motion ticks the dev hook counted (switches on with combat-4)', () => {
    const dev = (r: RaceResult) => r.hooks['dev'] as DevHookResult;
    const slowmo = sum(normal, (r) => dev(r).slowmoTicks);
    const slow = sum(normal, (r) => dev(r).slowTicks);
    const races = normal.races.filter((r) => dev(r).slowmoTicks > 0).length;
    print(
      slowmo > 0
        ? `[assert] slow motion in the batch: ACTIVE (${slowmo} ticks in ${races} races; ${slow} ticks below full speed)`
        : `[assert] slow motion in the batch: NOT ACTIVE (no race spent a tick in it yet: combat-4); ${slow} ticks below full speed`,
    );
    for (const r of normal.races) expect(dev(r).minTimeScale).toBeGreaterThanOrEqual(0);
  });
});
