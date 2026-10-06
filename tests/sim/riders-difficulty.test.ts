// riders-5 difficulty acceptance (docs/milestones/M2.md, riders-5): Hard shows more rival hits on
// the player and more cop spawns than Easy, and the printed numbers say by how much. This tests the
// non-default presets, not only Normal.
//
// The determinism run (2026-10-03, R7) made the rival-hit check a test of the mechanism. It used to
// compare race totals over 16 seeds per preset, but over whole races the presets sit within the
// seed noise (seeds 1-32: Easy 131, Hard 137; five red runs on 2026-10-02 read 82 > 82, 77 > 77,
// 52 > 55, 46 > 50 and 72 > 82), so any PR that reshuffled the seeds could flip it. Now:
// - the presets resolve in the declared direction through the app's real config path
//   (buildSimConfig on the base pack): rival aggression and cop frequency rise from Easy to Hard,
//   and the rubber band eases off (deterministic, no race);
// - a staged encounter on a straight road: each of the base event's four rivals, alone with a
//   scripted player cruising at 28 m/s, for 60 s, on seeds 1-6, with the preset's real config
//   (riders, weapons, tuning, difficulty) and nothing else on the road. Hard rivals must start more
//   attacks on the player (by at least HARD_SWING_RATIO) and land more hits than Easy ones;
// - the race totals stay as a printed trend, read from dev-4's shared Easy and Hard batch
//   (tests/sim/batch.ts presetBatch), which also carries the cop-spawn direction (Easy rolls the
//   lot cop out about half the time, Hard always: 7 against 16 on 2026-10-02, far outside the noise).
/// <reference types="vite/client" />
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { buildRegistry, basePackFiles } from '../../src/content';
import type { DifficultyPreset } from '../../src/core';
import { createSim, type SimConfig, type SimInput } from '../../src/sim/api';
import { testConfig } from '../../src/sim/riders/testing';
import { BATCH_TIMEOUT_MS, NO_ROAD_EVENTS, presetBatch, type BatchResult, type RaceResult } from './batch';

const print = (line: string) => process.stdout.write(line + '\n');

const REG = buildRegistry(basePackFiles(), { includeDrafts: true });
const STREAM = streamForEvent(REG);
const presetConfig = (difficulty: DifficultyPreset): SimConfig =>
  buildSimConfig(REG, STREAM, { seed: 1, difficulty, tuning: NO_ROAD_EVENTS });

/**
 * Held alongside, Hard rivals start at least this many times as many attacks on the player as Easy
 * ones [default]. Measured 1.13x on main 0cd9431 (365 against 413): the preset shortens the pause
 * after a swing and raises the chance to swing once in reach, but not the weapon's own cycle. The
 * counts are near-periodic (seed noise about 1 %), and with the preset's scale cut out of the AI
 * the ratio reads 1.00x, so 1.05 keeps 8 points of headroom and still fails that.
 */
const HARD_SWING_RATIO = 1.05;
const ENCOUNTER_SEEDS = [1, 2, 3, 4, 5, 6];
const ENCOUNTER_TICKS = 60 * 60;
const CRUISE_MPS = 28;
/**
 * The encounter's isolation: a rival's hit neither shoves nor hurts the player, so the rival stays
 * alongside and the count measures how readily he attacks. With the shove (0.4 of a full one), each
 * hit pushes the player out of reach, and the swing count measures the re-approach instead.
 */
const ALONGSIDE: Readonly<Record<string, number>> = {
  'combat.onPlayerScale': 0,
  'combat.onPlayerDamageScale': 0,
};

interface Encounter {
  rival: string;
  swings: number;
  hits: number;
}

/**
 * One real rival and the real player on a straight 4 km fixture road, with the preset's real
 * riders, weapons, tuning and difficulty, and no traffic, cops or modifiers.
 */
function encounter(
  base: SimConfig,
  rivalIndex: number,
  seed: number,
  tuning: Readonly<Record<string, number>>,
): Encounter {
  const fixture = testConfig({ edges: [{ id: 'a', lengthM: 4000, kappa: 0 }] });
  const rival = base.riders[rivalIndex];
  const player = base.riders.find((r) => r.controller.kind === 'player');
  if (!rival || !player) throw new Error('the base event has no rival or no player');
  const config: SimConfig = {
    ...base,
    seed,
    road: fixture.road,
    route: fixture.route,
    riders: [rival, player],
    tuning: { ...base.tuning, ...tuning },
    trafficTypes: [],
    modifiers: [],
  };
  const sim = createSim(config);
  const pid = 1;
  let swings = 0;
  let hits = 0;
  const holdD = sim.snapshot().entities[pid]?.road.d ?? 0;
  for (let t = 0; t < ENCOUNTER_TICKS && !sim.isOver(); t++) {
    const me = sim.snapshot().entities[pid];
    const v = me?.speed ?? 0;
    const d = me?.road.d ?? holdD;
    const yaw = me?.road.yaw ?? 0;
    const input: SimInput = {
      steer: Math.round(Math.max(-1, Math.min(1, (holdD - d) * 0.3 - yaw * 2)) * 127),
      throttle: v < CRUISE_MPS ? 220 : 90,
      brake: 0,
      flags: 0,
    };
    sim.step([input]);
    for (const e of sim.events()) {
      if (e.actor !== 0 || e.target !== pid) continue;
      if (e.type === 'attackStart') swings++;
      if (e.type === 'hit') hits++;
    }
  }
  return { rival: rival.contentId, swings, hits };
}

function encounters(
  difficulty: DifficultyPreset,
  tuning: Readonly<Record<string, number>> = {},
): Encounter[] {
  const base = presetConfig(difficulty);
  const rivals = base.riders.flatMap((r, i) =>
    r.controller.kind === 'ai' && r.faction === 'rider' ? [i] : [],
  );
  return rivals.map((i) => {
    const runs = ENCOUNTER_SEEDS.map((seed) => encounter(base, i, seed, tuning));
    return {
      rival: runs[0]?.rival ?? '',
      swings: runs.reduce((n, r) => n + r.swings, 0),
      hits: runs.reduce((n, r) => n + r.hits, 0),
    };
  });
}

describe('riders-5: Easy and Hard differ in the printed direction', () => {
  it('the presets resolve in the declared direction through the app config path', () => {
    const [easy, normal, hard] = (['easy', 'normal', 'hard'] as const).map((p) => presetConfig(p).difficulty);
    print(
      `riders-5 presets: rival aggression ${easy?.riderAggression} / ${normal?.riderAggression} / ${hard?.riderAggression}, ` +
        `cop frequency ${easy?.copFrequency} / ${normal?.copFrequency} / ${hard?.copFrequency}, ` +
        `rubber band ${easy?.rubberBand} / ${normal?.rubberBand} / ${hard?.rubberBand} (Easy / Normal / Hard)`,
    );
    expect([easy?.presetId, normal?.presetId, hard?.presetId]).toEqual(['easy', 'normal', 'hard']);
    expect(easy?.riderAggression).toBeLessThan(normal?.riderAggression ?? NaN);
    expect(normal?.riderAggression).toBeLessThan(hard?.riderAggression ?? NaN);
    expect(easy?.copFrequency).toBeLessThan(normal?.copFrequency ?? NaN);
    expect(normal?.copFrequency).toBeLessThan(hard?.copFrequency ?? NaN);
    expect(easy?.rubberBand).toBeGreaterThan(normal?.rubberBand ?? NaN);
    expect(normal?.rubberBand).toBeGreaterThan(hard?.rubberBand ?? NaN);
  });

  it('Hard shows more rival hits on the player than Easy', () => {
    const sum = (xs: Encounter[], k: 'swings' | 'hits') => xs.reduce((n, x) => n + x[k], 0);
    const line = (what: string, easy: Encounter[], hard: Encounter[]) => {
      const [es, hs] = [sum(easy, 'swings'), sum(hard, 'swings')];
      print(
        `riders-5 staged encounters, ${what} (${easy.length} rivals x ${ENCOUNTER_SEEDS.length} seeds x 60 s): ` +
          `attacks on the player Easy ${es}, Hard ${hs} (${es > 0 ? `${(hs / es).toFixed(2)}x` : 'Easy none'}); ` +
          `hits landed Easy ${sum(easy, 'hits')}, Hard ${sum(hard, 'hits')}; attacks/hits per rival ` +
          `Easy [${easy.map((x) => `${x.rival} ${x.swings}/${x.hits}`).join(', ')}], ` +
          `Hard [${hard.map((x) => `${x.rival} ${x.swings}/${x.hits}`).join(', ')}]`,
      );
    };
    const easy = encounters('easy', ALONGSIDE);
    const hard = encounters('hard', ALONGSIDE);
    line('held alongside', easy, hard);
    // The same encounters with the shove are a printed trend only, asserted nowhere, and cost about
    // 25 s of CI time (the test diet, 2026-10-05), so they run on request.
    if (process.env['RIDERS5_SHOVE_TREND'] === '1')
      line('with the shove (trend)', encounters('easy'), encounters('hard'));
    else
      print(
        'riders-5 staged encounters, with the shove (trend): skipped; set RIDERS5_SHOVE_TREND=1 to print them',
      );
    expect(easy.length).toBe(4);
    expect(sum(easy, 'swings')).toBeGreaterThan(0);
    expect(sum(hard, 'swings')).toBeGreaterThanOrEqual(sum(easy, 'swings') * HARD_SWING_RATIO);
    expect(sum(hard, 'hits')).toBeGreaterThan(sum(easy, 'hits'));
  });

  describe('over dev-4 shared Easy and Hard batch', () => {
    let easy: BatchResult;
    let hard: BatchResult;
    beforeAll(async () => {
      [easy, hard] = await Promise.all([presetBatch('easy'), presetBatch('hard')]);
    }, BATCH_TIMEOUT_MS);

    const rivalHits = (r: RaceResult) =>
      r.events.filter((e) => e.type === 'hit' && e.target === r.playerId && e.actor !== r.playerId).length;
    const copSpawns = (r: RaceResult) =>
      r.events.filter((e) => e.type === 'siren' && e.data['on'] === true).length;
    const total = (b: BatchResult, f: (r: RaceResult) => number) => b.races.reduce((n, r) => n + f(r), 0);

    it('prints the rival hits on the player per preset (a trend: whole races sit inside the seed noise)', () => {
      const e = total(easy, rivalHits);
      const h = total(hard, rivalHits);
      print(
        `riders-5 rival hits on the player (trend): Easy ${e}, Hard ${h} (${e > 0 ? `${(h / e).toFixed(2)}x` : 'Easy had none'}) ` +
          `over ${easy.races.length} races each; per race Easy [${easy.races.map(rivalHits).join(', ')}], Hard [${hard.races.map(rivalHits).join(', ')}]`,
      );
      expect(easy.races.length).toBe(hard.races.length);
    });

    it('Hard shows more cop spawns than Easy', () => {
      const e = total(easy, copSpawns);
      const h = total(hard, copSpawns);
      print(
        `riders-5 cop spawns: Easy ${e}, Hard ${h} (${e > 0 ? `${(h / e).toFixed(2)}x` : 'Easy had none'}); ` +
          `per race Easy [${easy.races.map(copSpawns).join(', ')}], Hard [${hard.races.map(copSpawns).join(', ')}]`,
      );
      expect(h).toBeGreaterThan(e);
    });
  });
});
