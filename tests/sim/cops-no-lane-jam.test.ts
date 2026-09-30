// The traffic-flow guard over the shared 50-race batch (the M1 final skeptic's mustFix 1).
//
// The cop used to stop dead in the travel lane when his target was behind him, and IDM traffic
// never passes a stopped rider, so a queue formed behind him and the player sat behind the queue
// (batch seed 37: the cop still for 273 s, a 420 s race against a 124 s median). "Every race
// ends" did not catch it. These two assertions do:
//
// - nobody (rider or vehicle) stands still in a drive lane for more than STILL_LIMIT_S before the
//   player's race is over, not counting the cop parked before his siren or anyone who finished;
// - no race runs longer than RACE_LIMIT_X times the median.
//
// Both read the batch's 1 s trace samples, so a run is measured in whole samples.
/// <reference types="vite/client" />
import { beforeAll, describe, expect, it } from 'vitest';
import type { RoadNetwork } from '../../src/sim/api';
import {
  BATCH_TIMEOUT_MS,
  TRACE_EVERY_TICKS,
  createBatchRace,
  simBatch,
  type BatchResult,
  type MoverSample,
  type RaceResult,
} from './batch';

/** Longest a mover may stand still (under STILL_MPS) in a drive lane, in seconds. */
const STILL_LIMIT_S = 20;
const STILL_MPS = 0.5;
/** No race's player end may come later than this many times the batch median. */
const RACE_LIMIT_X = 2;

let batch: BatchResult;
let road: RoadNetwork;
beforeAll(async () => {
  batch = await simBatch();
  road = createBatchRace(1).config.road;
}, BATCH_TIMEOUT_MS);

/** The tick the player's race ended: his finish or his bust, else the last tick. */
function playerEndTick(r: RaceResult): number {
  const e = r.events.find(
    (x) => (x.type === 'finish' && x.actor === r.playerId) || (x.type === 'bust' && x.target === r.playerId),
  );
  return e ? e.tick : r.ticks;
}

function inDriveLane(m: MoverSample): boolean {
  return road
    .lanesAt(m.edge, m.s)
    .some((l) => l.kind === 'drive' && Math.abs(m.d - l.dCenterM) <= l.widthM / 2);
}

interface Jam {
  id: number;
  kind: string;
  seconds: number;
  endTick: number;
  where: string;
}

/** The longest in-lane standstill of each mover before the player's race ended, worst first. */
function laneStandstills(r: RaceResult): Jam[] {
  const end = playerEndTick(r);
  const siren = r.events.find((e) => e.type === 'siren' && e.data['on'] === true)?.tick ?? Infinity;
  const finishedAt = new Map<number, number>();
  for (const e of r.events) if (e.type === 'finish') finishedAt.set(e.actor, e.tick);
  const run = new Map<number, number>();
  const worst = new Map<number, Jam>();
  for (const { tick, movers } of r.trace) {
    if (tick >= end) break;
    for (const m of movers) {
      const exempt =
        (m.kind !== 'rider' && m.kind !== 'vehicle') ||
        (m.faction === 'law' && tick < siren) ||
        (finishedAt.get(m.id) ?? Infinity) <= tick;
      const still = !exempt && m.mode === 'Road' && m.speed < STILL_MPS && inDriveLane(m);
      const n = still ? (run.get(m.id) ?? 0) + 1 : 0;
      run.set(m.id, n);
      const seconds = (n * TRACE_EVERY_TICKS) / 60;
      if (seconds > (worst.get(m.id)?.seconds ?? 0))
        worst.set(m.id, {
          id: m.id,
          kind: m.faction === 'law' ? 'cop' : m.kind,
          seconds,
          endTick: tick,
          where: `edge ${m.edge} s ${m.s.toFixed(0)} d ${m.d.toFixed(1)}`,
        });
    }
  }
  return [...worst.values()].sort((a, b) => b.seconds - a.seconds);
}

describe('cops: nobody is left standing in a travel lane (the seed 37 jam)', () => {
  it(`no rider or vehicle stands still in a drive lane for over ${STILL_LIMIT_S} s before the player's end`, () => {
    const bad: string[] = [];
    let longest = 0;
    let examined = 0;
    for (const r of batch.races) {
      examined += r.trace.filter((t) => t.tick < playerEndTick(r)).length;
      const jams = laneStandstills(r);
      longest = Math.max(longest, jams[0]?.seconds ?? 0);
      const over = jams.filter((j) => j.seconds > STILL_LIMIT_S);
      if (over.length)
        bad.push(
          `seed ${r.seed}: ` +
            over.map((j) => `${j.kind}#${j.id} ${j.seconds} s to t${j.endTick} (${j.where})`).join('; '),
        );
    }
    process.stdout.write(
      `cops jam check: ${batch.races.length} races, ${examined} trace samples examined, ` +
        `longest in-lane standstill ${longest} s, races over ${STILL_LIMIT_S} s: ${bad.length}\n`,
    );
    expect(examined).toBeGreaterThan(0);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it(`no race's player end comes later than ${RACE_LIMIT_X}x the batch median`, () => {
    const ends = batch.races.map((r) => ({ seed: r.seed, s: playerEndTick(r) / 60 }));
    const sorted = ends.map((e) => e.s).sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median =
      sorted.length % 2 ? (sorted[Math.floor(mid)] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    const slow = ends.filter((e) => e.s > RACE_LIMIT_X * median);
    process.stdout.write(
      `cops race length: median player end ${median.toFixed(1)} s, longest ${(sorted[sorted.length - 1] ?? 0).toFixed(1)} s, ` +
        `over ${RACE_LIMIT_X}x: ${slow.map((e) => `seed ${e.seed} ${e.s.toFixed(1)} s`).join(', ') || 'none'}\n`,
    );
    expect(ends).toHaveLength(50);
    expect(slow).toEqual([]);
  });
});
