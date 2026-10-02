// cops-2 acceptance on the base race (docs/milestones/M2.md, cops-2): Hard fields more cops than
// Easy, and his siren leads his arrival by a clear margin.
//
// Playtest 2 (2026-10-02) moved the starting cops out of the lot behind the grid onto a patrol
// ahead (sim/cops PATROL), so the preset comparison now runs the bot (a cop on patrol only wakes for
// a player coming up the road): 12 seeds per preset, each race stopped at 100 s, past the second
// patrol cop's window. The difficulty's cop frequency scales the lot cop's chance and timing as before
// and how many patrol (Easy brings one, Hard two more often), so Hard brings more cops in all. A
// patrol cop's siren sounds at least the siren lead before he pulls out.
//
// The margin is also printed over the shared Normal batch (the bot racing), from its traces.
/// <reference types="vite/client" />
import { beforeAll, describe, expect, it } from 'vitest';
import type { DifficultyPreset } from '../../src/core';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createHeadlessRace } from '../../src/app';
import {
  BATCH_TIMEOUT_MS,
  createBatchRace,
  NO_ROAD_EVENTS,
  simBatch,
  TRACE_EVERY_TICKS,
  type BatchResult,
} from './batch';

const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
/** He has arrived once he rides (above 1 m/s) within this of the player: a little over his 14 m bust radius. */
const ARRIVAL_M = 20;
const RIDING_MPS = 1;
/** The declared siren lead (cops.sirenLeadS default), in ticks. */
const LEAD_TICKS = 3 * 60;
/** Each preset race stops here: past the second patrol window (50-75 s at 0.7 x the pace). */
const RUN_TICKS = 100 * 60;

const print = (line: string) => process.stdout.write(line + '\n');

interface PresetRun {
  seed: number;
  /** Patrol sirens (cause `patrol`): each one's cop, its tick, and the tick he arrived (-1: never). */
  sirens: { cop: number; tick: number; arrival: number }[];
  /** Every cop who came out (any cause). */
  cops: number;
}

function runPreset(seed: number, difficulty: DifficultyPreset): PresetRun {
  // The batch's race with the patrol on (the shared batch turns it off with the road events).
  const { sim, playerId, config } = createHeadlessRace(
    { seed, difficulty, tuning: { ...NO_ROAD_EVENTS, 'cops.patrolScale': 1 } },
    { includeDrafts: true },
  );
  const bot = createBot();
  const sirens: PresetRun['sirens'] = [];
  let cops = 0;
  let snap = sim.snapshot();
  while (sim.tick < RUN_TICKS && !sim.isOver()) {
    const a = emptyActions();
    bot.drive(snap, playerId, config.route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    for (const e of sim.events()) {
      if (e.type !== 'siren' || e.data['on'] !== true) continue;
      cops++;
      if (e.data['cause'] === 'patrol') sirens.push({ cop: e.actor, tick: e.tick, arrival: -1 });
    }
    const me = snap.entities[playerId];
    for (const s of sirens) {
      const cop = snap.entities[s.cop];
      if (s.arrival >= 0 || !me || !cop || cop.speed <= RIDING_MPS) continue;
      if (Math.hypot(cop.x - me.x, cop.z - me.z) <= ARRIVAL_M) s.arrival = sim.tick;
    }
  }
  return { seed, sirens, cops };
}

let easy: PresetRun[];
let hard: PresetRun[];
let batch: BatchResult;
beforeAll(async () => {
  const t0 = performance.now();
  easy = SEEDS.map((s) => runPreset(s, 'easy'));
  hard = SEEDS.map((s) => runPreset(s, 'hard'));
  print(
    `cops-2 preset runs: ${easy.length + hard.length} races of up to 100 s, ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

describe('cops-2: the cop follows the difficulty preset', () => {
  it('Hard fields more cops than Easy, and every race meets a patrol cop (printed)', () => {
    const count = (rs: PresetRun[]) => rs.reduce((n, r) => n + r.cops, 0);
    const patrols = (rs: PresetRun[]) => rs.reduce((n, r) => n + r.sirens.length, 0);
    print(
      `cops-2 difficulty: ${SEEDS.length} seeds per preset, the bot racing 100 s; ` +
        `cops out: Hard ${count(hard)}, Easy ${count(easy)} (patrol cops lit up: Hard ${patrols(hard)}, Easy ${patrols(easy)})`,
    );
    expect(count(hard)).toBeGreaterThan(count(easy));
    for (const r of [...easy, ...hard]) expect(r.sirens.length, `seed ${r.seed}`).toBeGreaterThanOrEqual(1);
  });

  it("a patrol cop's siren leads his arrival by at least the full lead", () => {
    const arrived = [...easy, ...hard].flatMap((r) => r.sirens).filter((s) => s.arrival >= 0);
    const margins = arrived.map((s) => s.arrival - s.tick);
    print(
      `cops-2 siren lead (patrol, the bot racing): ${arrived.length} arrivals examined; ` +
        `siren-to-arrival ${(Math.min(...margins) / 60).toFixed(2)}..${(Math.max(...margins) / 60).toFixed(2)} s`,
    );
    expect(arrived.length).toBeGreaterThan(SEEDS.length);
    for (const m of margins) expect(m).toBeGreaterThanOrEqual(LEAD_TICKS);
  });

  it('in the shared Normal batch (the bot racing), the siren leads his arrival too (printed)', () => {
    const { config } = createBatchRace(1);
    const at = (m: { edge: number; s: number; d: number; h: number }) =>
      config.road.toWorld(m.edge, m.s, m.d, m.h);
    const margins: number[] = [];
    let sirens = 0;
    for (const r of batch.races) {
      const first = r.events.find((e) => e.type === 'siren' && e.data['on'] === true);
      if (first === undefined) continue;
      const siren = first.tick;
      sirens++;
      for (const t of r.trace) {
        if (t.tick < siren) continue;
        const me = t.movers.find((m) => m.id === r.playerId);
        const cop = t.movers.find((m) => m.id === first.actor);
        if (!me || !cop || cop.speed <= RIDING_MPS) continue;
        const p = at(me);
        const q = at(cop);
        if (Math.hypot(p.x - q.x, p.z - q.z) <= ARRIVAL_M) {
          margins.push(t.tick - siren);
          break;
        }
      }
    }
    print(
      `cops-2 siren lead (Normal batch): ${batch.races.length} races, ${sirens} sirens, ${margins.length} arrivals ` +
        `(traces every ${TRACE_EVERY_TICKS} ticks); siren-to-arrival ` +
        (margins.length
          ? `${(Math.min(...margins) / 60).toFixed(0)}..${(Math.max(...margins) / 60).toFixed(0)} s`
          : 'n/a'),
    );
    expect(sirens).toBe(batch.races.length); // the lot cop comes out every race
    for (const m of margins) expect(m).toBeGreaterThanOrEqual(LEAD_TICKS);
  });
});
