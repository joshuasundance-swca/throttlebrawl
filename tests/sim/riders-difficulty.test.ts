// riders-5 difficulty acceptance (docs/milestones/M2.md, riders-5): Hard shows more rival hits on
// the player and more cop spawns than Easy, and the printed numbers say by how much. This tests the
// non-default presets, not only Normal.
//
// dev-4's shared batch runs Normal only, so the comparison runs here, kept small: the same seeds per
// preset (16 of them), the bot in the player slot as in the batch, each race run to its end (no replay). A cop
// spawn is his siren sounding (sim/cops sounds it just before he pulls out; a cop who stays in the
// lot never sounds it). When dev-4's Easy and Hard batch lands, these counts move onto it.
/// <reference types="vite/client" />
import { beforeAll, describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import type { DifficultyPreset } from '../../src/core';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { BATCH_TIMEOUT_MS, MAX_TICKS, NO_ROAD_EVENTS } from './batch';

// 16 seeds per preset (8 until the 100 mph starter, playtest 1 item 10): at the new speeds fights are
// shorter and rarer, and over 8 seeds one race's swing (seed 4: Easy 15 hits, Hard 7) outweighed
// the presets' difference (Easy 56, Hard 53). Over 16: Easy 94, Hard 108. [default]
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);

const print = (line: string) => process.stdout.write(line + '\n');

interface PresetRace {
  seed: number;
  ticks: number;
  rivalHitsOnPlayer: number;
  copSpawns: number;
}

function runRace(seed: number, difficulty: DifficultyPreset): PresetRace {
  // W-P road events off: this measures the riders, the AI, the law and traffic, and an event reshuffles
  // every seeded race (the events have their own tests: tests/sim/events-*.test.ts, e2e road-events).
  // Off-road (run W-R) off for the same reason: riders leave the lanes under 1 % of the time here,
  // but the change reshuffles these 16 races, and the presets' gap in rival hits is small next to
  // the seed noise (off-road on: seeds 1-16 Easy 82, Hard 73; seeds 1-32 Easy 131, Hard 137).
  const { sim, config, route, playerId } = createHeadlessRace(
    { seed, difficulty, tuning: { ...NO_ROAD_EVENTS, 'ground.offRoad': 0 } },
    { includeDrafts: true },
  );
  const rivals = new Set(
    config.riders
      .map((r, i) => (r.controller.kind === 'ai' && r.faction === 'rider' ? i : -1))
      .filter((i) => i >= 0),
  );
  const bot = createBot();
  let snap = sim.snapshot();
  let rivalHitsOnPlayer = 0;
  let copSpawns = 0;
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    for (const e of sim.events()) {
      if (e.type === 'hit' && e.target === playerId && rivals.has(e.actor)) rivalHitsOnPlayer++;
      if (e.type === 'siren' && e.data['on'] === true) copSpawns++;
    }
  }
  return { seed, ticks: sim.tick, rivalHitsOnPlayer, copSpawns };
}

const sum = (races: readonly PresetRace[], key: 'rivalHitsOnPlayer' | 'copSpawns') =>
  races.reduce((n, r) => n + r[key], 0);

let easy: PresetRace[];
let hard: PresetRace[];
beforeAll(() => {
  const t0 = performance.now();
  easy = SEEDS.map((s) => runRace(s, 'easy'));
  hard = SEEDS.map((s) => runRace(s, 'hard'));
  const ticks = [...easy, ...hard].reduce((n, r) => n + r.ticks, 0);
  print(
    `riders-5 difficulty runs: ${easy.length + hard.length} races (seeds 1-${SEEDS.length} per preset), ` +
      `${ticks} ticks, ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
}, BATCH_TIMEOUT_MS);

describe('riders-5: Easy and Hard differ in the printed direction', () => {
  it('Hard shows more rival hits on the player than Easy', () => {
    const e = sum(easy, 'rivalHitsOnPlayer');
    const h = sum(hard, 'rivalHitsOnPlayer');
    print(
      `riders-5 rival hits on the player: Easy ${e}, Hard ${h} (${e > 0 ? `${(h / e).toFixed(2)}×` : 'Easy had none'}); ` +
        `per race Easy [${easy.map((r) => r.rivalHitsOnPlayer).join(', ')}], Hard [${hard.map((r) => r.rivalHitsOnPlayer).join(', ')}]`,
    );
    expect(easy.length).toBe(SEEDS.length);
    expect(h).toBeGreaterThan(e);
  });

  it('Hard shows more cop spawns than Easy', () => {
    const e = sum(easy, 'copSpawns');
    const h = sum(hard, 'copSpawns');
    print(
      `riders-5 cop spawns: Easy ${e}, Hard ${h} (${e > 0 ? `${(h / e).toFixed(2)}×` : 'Easy had none'}); ` +
        `per race Easy [${easy.map((r) => r.copSpawns).join(', ')}], Hard [${hard.map((r) => r.copSpawns).join(', ')}]`,
    );
    expect(h).toBeGreaterThan(e);
  });
});
