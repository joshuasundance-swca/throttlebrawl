// cops-2 acceptance on the base race (docs/milestones/M2.md, cops-2): Hard fields the cop more
// often and sooner than Easy, and his siren leads his arrival by a clear margin.
//
// dev-4's shared batch does not run Easy and Hard yet (it is Normal only), so the preset
// comparison runs here, kept small: 12 seeds per preset with the player idling on the grid (no
// bot). Easy races stop just after Easy's siren time, Hard races once the cop reaches the player.
// Idling near the lot is the hard case for the siren's lead: the player is a few dozen metres
// from the cop when the siren sounds. When dev-4's Easy and Hard batch lands, the count moves onto
// it as a stat hook and these runs go.
//
// The margin is also printed over the shared Normal batch (the bot racing), from its traces.
/// <reference types="vite/client" />
import { beforeAll, describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import type { DifficultyPreset } from '../../src/core';
import { quantizeInput, type SimEvent, type SimSnapshot } from '../../src/sim/api';
import { BATCH_TIMEOUT_MS, createBatchRace, simBatch, TRACE_EVERY_TICKS, type BatchResult } from './batch';

const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
/**
 * He has arrived once he rides (above 1 m/s) within this of the player: a little over his 14 m
 * bust radius. Riding, because a player idling on the grid is already this close to the parked cop.
 */
const ARRIVAL_M = 20;
const RIDING_MPS = 1;
/** The declared siren lead (cops.sirenLeadS default), in ticks. */
const LEAD_TICKS = 3 * 60;
/** Easy's siren: a 20 s ÷ 0.5 = 40 s pull-out, less the 3 s lead; stop a second after it. */
const EASY_TICKS = 38 * 60;
/** Hard's pull-out is 20 s ÷ 1.5 ≈ 13.3 s; he reaches an idle player well within 30 s. */
const HARD_TICKS = 30 * 60;

const print = (line: string) => process.stdout.write(line + '\n');

interface PresetRun {
  seed: number;
  sirenTick: number;
  arrivalTick: number;
  ticks: number;
}

function runPreset(
  seed: number,
  difficulty: DifficultyPreset,
  maxTicks: number,
  untilArrival: boolean,
): PresetRun {
  const { sim, playerId } = createHeadlessRace({ seed, difficulty }, { includeDrafts: true });
  const idle = quantizeInput({ throttle: 0, brake: 1, steer: 0, flags: 0 });
  let sirenTick = -1;
  let arrivalTick = -1;
  const near = (snap: SimSnapshot) => {
    const me = snap.entities[playerId];
    const cop = snap.entities.find((e) => e.faction === 'law');
    return !!me && !!cop && cop.speed > RIDING_MPS && Math.hypot(cop.x - me.x, cop.z - me.z) <= ARRIVAL_M;
  };
  while (sim.tick < maxTicks && arrivalTick < 0 && !sim.isOver() && (untilArrival || sirenTick < 0)) {
    sim.step([idle]);
    const siren = sim.events().find((e: SimEvent) => e.type === 'siren' && e.data['on'] === true);
    if (sirenTick < 0 && siren) sirenTick = siren.tick;
    if (sirenTick >= 0 && near(sim.snapshot())) arrivalTick = sim.tick;
  }
  return { seed, sirenTick, arrivalTick, ticks: sim.tick };
}

let easy: PresetRun[];
let hard: PresetRun[];
let batch: BatchResult;
beforeAll(async () => {
  const t0 = performance.now();
  easy = SEEDS.map((s) => runPreset(s, 'easy', EASY_TICKS, false));
  hard = SEEDS.map((s) => runPreset(s, 'hard', HARD_TICKS, true));
  const ticks = [...easy, ...hard].reduce((n, r) => n + r.ticks, 0);
  print(
    `cops-2 preset runs: ${easy.length + hard.length} races, ${ticks} ticks, ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

describe('cops-2: the cop follows the difficulty preset', () => {
  it('Hard fields the cop in more races than Easy, and sooner (printed)', () => {
    const out = (rs: PresetRun[]) => rs.filter((r) => r.sirenTick >= 0);
    const first = (rs: PresetRun[]) => Math.min(...out(rs).map((r) => r.sirenTick));
    print(
      `cops-2 difficulty: ${SEEDS.length} seeds per preset, player idle on the grid; ` +
        `Hard: the cop came out in ${out(hard).length}/${hard.length} races, siren at t${first(hard)}; ` +
        `Easy: ${out(easy).length}/${easy.length}, siren at t${first(easy)}`,
    );
    expect(out(hard).length).toBeGreaterThan(out(easy).length);
    expect(out(easy).length).toBeGreaterThan(0);
    expect(first(hard)).toBeLessThan(first(easy));
  });

  it('with the player idling near the lot, the siren leads his arrival by at least the full lead', () => {
    const arrived = hard.filter((r) => r.sirenTick >= 0 && r.arrivalTick >= 0);
    const margins = arrived.map((r) => r.arrivalTick - r.sirenTick);
    print(
      `cops-2 siren lead (idle player): ${arrived.length} arrivals examined; ` +
        `siren-to-arrival ${(Math.min(...margins) / 60).toFixed(2)}..${(Math.max(...margins) / 60).toFixed(2)} s`,
    );
    expect(arrived.length).toBe(hard.filter((r) => r.sirenTick >= 0).length); // every Hard cop arrived
    for (const r of arrived)
      expect(r.arrivalTick - r.sirenTick, `seed ${r.seed}`).toBeGreaterThanOrEqual(LEAD_TICKS);
  });

  it('in the shared Normal batch (the bot racing), the siren leads his arrival too (printed)', () => {
    const { config } = createBatchRace(1);
    const at = (m: { edge: number; s: number; d: number; h: number }) =>
      config.road.toWorld(m.edge, m.s, m.d, m.h);
    const margins: number[] = [];
    let sirens = 0;
    for (const r of batch.races) {
      const siren = r.events.find((e) => e.type === 'siren' && e.data['on'] === true)?.tick;
      if (siren === undefined) continue;
      sirens++;
      for (const t of r.trace) {
        if (t.tick < siren) continue;
        const me = t.movers.find((m) => m.id === r.playerId);
        const cop = t.movers.find((m) => m.faction === 'law');
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
    expect(sirens).toBe(batch.races.length); // Normal fields him every race
    for (const m of margins) expect(m).toBeGreaterThanOrEqual(LEAD_TICKS);
  });
});
