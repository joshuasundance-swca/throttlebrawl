/// <reference types="vite/client" />
// The pack loader uses import.meta.glob, so this Node-side test needs the Vite client types.
// ai-1's seeded-race assertions (docs/milestones/M1.md, "ai-1 · Four box rivals"):
//   - in 50 seeded races every rival finishes, or ends down or busted, and none is ever stuck with
//     no progress for 10 s while not down;
//   - the batch prints how many hits rivals landed on the player, and fails at zero (switched on
//     once the pack has a punch, i.e. when combat-1 lands);
//   - the batch prints the gap from first to last at the finish;
//   - a scripted race gives the same hash every run.
// Interim: dev-1 owns the shared batch (tests/sim/batch.ts). Until it lands, this file runs its own
// 50 races with a lane-keeping, full-throttle player; switch `runRace` to the shared results then.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { basePackFiles, buildRegistry, type ContentRegistry } from '../../src/content';
import { createSim, quantizeInput, type EntitySnapshot, type SimConfig } from '../../src/sim/api';

const RIVALS = ['deacon-vane', 'dial-up', 'chad-speedwell', 'kevin-from-accounting'];
const SEEDS = Array.from({ length: 50 }, (_, i) => 1000 + i * 7919);
const STUCK_TICKS = 600; // 10 s
const MAX_TICKS = 60 * 60 * 6;

/** The base pack, with the default event's field holding all four rivals (a no-op once it does). */
function registry(): ContentRegistry {
  const files = basePackFiles().map((f) => {
    const json = f.json as { type?: string; field?: { riders?: string[] } };
    if (json.type !== 'event' || !json.field) return f;
    const riders = [...(json.field.riders ?? [])];
    for (const id of RIVALS) if (!riders.includes(id)) riders.push(id);
    return { ...f, json: { ...json, field: { ...json.field, riders } } };
  });
  return buildRegistry(files);
}

const REG = registry();
const STREAM = streamForEvent(REG);
const configFor = (seed: number): SimConfig => buildSimConfig(REG, STREAM, { seed });
const COMBAT_LIVE = configFor(1).weapons.some((w) => w.contentId.endsWith(':punch'));

/** The player: full throttle, steering to its lane centre (the stub bot's policy). */
function playerInput(me: EntitySnapshot | undefined, config: SimConfig) {
  if (!me) return quantizeInput({ throttle: 0, brake: 0, steer: 0, flags: 0 });
  const { edge, s, d, dir, yaw } = me.road;
  const lanes = config.route.lanesAt(edge, s);
  const lane = lanes.find((l) => l.kind === 'drive' && l.direction === dir) ?? lanes[0];
  const v = Math.max(me.speed, 5);
  const kappa = config.route.kappaAt(edge, s) * dir;
  const steer = 0.35 * ((lane?.dCenterM ?? 0) - d) * dir - 2.5 * yaw + (kappa * v * v) / 22;
  return quantizeInput({ throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, steer)), flags: 0 });
}

interface RaceResult {
  seed: number;
  ticks: number;
  rivals: number[];
  playerId: number;
  /** Per rival: finished, down, busted, or none of those. */
  endState: Record<number, 'finished' | 'down' | 'busted' | 'running'>;
  /** Per rival: longest stretch without 1 m of progress while not down and not finished, ticks. */
  longestStall: Record<number, number>;
  hitsOnPlayer: number;
  finishTicks: Record<number, number>;
  /** Metres from first to last when the first rider finished. */
  spreadAtFirstFinish: number;
  finalHash: number;
}

function runRace(seed: number): RaceResult {
  const config = configFor(seed);
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const rivals = config.riders.flatMap((r, i) => (r.controller.kind === 'ai' ? [i] : []));
  const best: Record<number, number> = {};
  const since: Record<number, number> = {};
  const longestStall: Record<number, number> = {};
  const busted = new Set<number>();
  const finishTicks: Record<number, number> = {};
  const hitCauses = new Set<number>();
  let spread = -1;
  for (const id of rivals) {
    best[id] = Infinity;
    since[id] = 0;
    longestStall[id] = 0;
  }
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const before = sim.snapshot();
    sim.step([playerInput(before.entities[playerId], config)]);
    for (const e of sim.events()) {
      if (e.type === 'bust' && e.target !== undefined) busted.add(e.target);
      if (e.type === 'finish') finishTicks[e.actor] = e.tick;
      if ((e.type === 'hit' || e.type === 'kick') && e.target === playerId && rivals.includes(e.actor)) {
        hitCauses.add(e.causeId ?? -e.tick);
      }
    }
    const snap = sim.snapshot();
    if (spread < 0 && snap.race.finishOrder.length > 0) {
      const dists = snap.entities.filter((e) => e.kind === 'rider').map((e) => e.distanceToFinish);
      spread = Math.max(...dists) - Math.min(...dists);
    }
    for (const id of rivals) {
      const e = snap.entities[id];
      if (!e) continue;
      const down = e.mode === 'Tumble' || e.mode === 'OnFoot';
      if (e.distanceToFinish < (best[id] ?? Infinity) - 1 || down || e.finished || busted.has(id)) {
        best[id] = Math.min(best[id] ?? Infinity, e.distanceToFinish);
        since[id] = sim.tick;
      }
      longestStall[id] = Math.max(longestStall[id] ?? 0, sim.tick - (since[id] ?? 0));
    }
  }
  const snap = sim.snapshot();
  const endState: RaceResult['endState'] = {};
  for (const id of rivals) {
    const e = snap.entities[id];
    endState[id] = snap.race.finishOrder.includes(id)
      ? 'finished'
      : busted.has(id)
        ? 'busted'
        : e && (e.mode === 'Tumble' || e.mode === 'OnFoot')
          ? 'down'
          : 'running';
  }
  return {
    seed,
    ticks: sim.tick,
    rivals,
    playerId,
    endState,
    longestStall,
    hitsOnPlayer: hitCauses.size,
    finishTicks,
    spreadAtFirstFinish: spread,
    finalHash: sim.hash(),
  };
}

describe('ai-1: four box rivals over 50 seeded races', () => {
  let results: RaceResult[] = [];
  beforeAll(() => {
    results = SEEDS.map(runRace);
  }, 300_000);

  it('races all four rivals', () => {
    for (const r of results) expect(r.rivals.length).toBe(4);
  });

  it('every rival finishes, or ends down or busted', () => {
    const bad = results.flatMap((r) =>
      Object.entries(r.endState)
        .filter(([, s]) => s === 'running')
        .map(([id]) => `seed ${r.seed} rival ${id}`),
    );
    const counts = { finished: 0, down: 0, busted: 0, running: 0 };
    for (const r of results) for (const s of Object.values(r.endState)) counts[s]++;
    console.log(
      `[examined] ${results.length} races, ${results.length * 4} rival results: ` +
        `finished ${counts.finished}, down ${counts.down}, busted ${counts.busted}, running ${counts.running}`,
    );
    expect(bad).toEqual([]);
  });

  it('no rival is ever stuck for 10 s while not down', () => {
    let worst = 0;
    const bad: string[] = [];
    for (const r of results) {
      for (const [id, stall] of Object.entries(r.longestStall)) {
        worst = Math.max(worst, stall);
        if (stall >= STUCK_TICKS) bad.push(`seed ${r.seed} rival ${id}: ${(stall / 60).toFixed(1)} s`);
      }
    }
    console.log(`longest rival stall without progress: ${(worst / 60).toFixed(2)} s (limit 10 s)`);
    expect(bad).toEqual([]);
  });

  it('prints the gap from first to last at the finish', () => {
    const gaps = results.map((r) => {
      const ticks = Object.values(r.finishTicks);
      return ticks.length > 1 ? (Math.max(...ticks) - Math.min(...ticks)) / 60 : NaN;
    });
    const ok = gaps.filter(Number.isFinite).sort((a, b) => a - b);
    const spreads = results.map((r) => r.spreadAtFirstFinish).sort((a, b) => a - b);
    const median = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? NaN;
    console.log(
      `gap first to last finisher: median ${median(ok).toFixed(1)} s, max ${(ok[ok.length - 1] ?? NaN).toFixed(1)} s ` +
        `over ${ok.length} races; field spread when the winner finished: median ${median(spreads).toFixed(0)} m, ` +
        `max ${(spreads[spreads.length - 1] ?? NaN).toFixed(0)} m`,
    );
    expect(ok.length).toBe(results.length);
  });

  it.skipIf(!COMBAT_LIVE)('rivals land hits on the player (fails at zero)', () => {
    const total = results.reduce((n, r) => n + r.hitsOnPlayer, 0);
    const races = results.filter((r) => r.hitsOnPlayer > 0).length;
    console.log(
      `rival hits landed on the player: ${total} over ${results.length} races (${races} races with a hit)`,
    );
    expect(total).toBeGreaterThan(0);
  });

  it('a scripted race gives the same hash every run', () => {
    const seed = SEEDS[0] ?? 1;
    expect(runRace(seed).finalHash).toBe(results[0]?.finalHash);
  });
});

if (!COMBAT_LIVE) {
  console.log(
    'NOT ACTIVE: rival hits on the player (no punch weapon in the pack yet; combat-1 switches it on)',
  );
}
