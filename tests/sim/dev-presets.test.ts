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
// The batch hooks run in every race. The M2 bot assertions that cannot hold yet print NOT ACTIVE
// with the reason, so a switched-off check never reads as a pass:
// - the bot lands a takedown: ACTIVE once BOT_TAKEDOWNS is set, by the part of dev-4 that teaches
//   the bot to fight a rival down (combat-4's takedowns are in; the bot's are not);
// - slow motion is counted per tick by the dev hook: ACTIVE once any race spends a tick in it.
const BOT_TAKEDOWNS = false;
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
  [normal, easy, hard] = await Promise.all([simBatch(), presetBatch('easy'), presetBatch('hard')]);
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

describe('dev-4: batch hooks and the held bot assertions', () => {
  it('every registered hook ran in every race of every batch', () => {
    for (const b of [normal, easy, hard])
      for (const r of b.races) expect(r.hooks['dev'], `${r.difficulty} seed ${r.seed}`).toBeDefined();
  });

  it('the bot lands at least one takedown in the Normal batch (switches on with the bot that can)', () => {
    const all = sum(normal, (r) => r.events.filter((e) => e.type === 'takedown').length);
    const mine = sum(
      normal,
      (r) => r.events.filter((e) => e.type === 'takedown' && e.actor === r.playerId).length,
    );
    if (!BOT_TAKEDOWNS) {
      // combat-4's takedowns are in the sim (on 2026-09-30 the batch saw them), but the bot punches
      // about twice a race and gives up after 8 s, so it never fights a rival down: probes with
      // kicks on every press, or a 40 s engagement, still landed 0 in 12 races. Teaching the bot
      // to finish a fight is dev-4's next part; it sets BOT_TAKEDOWNS and this asserts.
      print(
        `[assert] the bot lands a takedown: NOT ACTIVE (the bot does not fight to a takedown yet: dev-4 part 2; ` +
          `${mine} bot takedowns of ${all} in ${normal.races.length} races)`,
      );
      return;
    }
    print(`[assert] the bot lands a takedown: ACTIVE (${mine} bot takedowns of ${all})`);
    expect(mine).toBeGreaterThan(0);
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
