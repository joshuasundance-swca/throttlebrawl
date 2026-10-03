/// <reference types="vite/client" />
// The pack loader uses import.meta.glob, so this Node-side test needs the Vite client types.
// ai-1's seeded-race assertions (docs/milestones/M1.md, "ai-1 · Four box rivals"):
//   - in 50 seeded races every rival finishes, or ends down or busted, and none is ever stuck with
//     no progress for 10 s while not down;
//   - the batch prints how many hits rivals landed on the player, and fails at zero (switched on
//     once the pack has a punch, i.e. when combat-1 lands);
//   - the batch prints the gap from first to last at the finish;
//   - a scripted race gives the same hash every run.
// Since the determinism run (2026-10-03, R9) these read dev-1's shared batch (tests/sim/batch.ts:
// 50 seeded races with the bot in the player slot, computed once per source tree) and the ai-rivals
// batch hook (tests/sim/hooks/ai-rivals.ts) for the per-tick stall and end state. The file used to
// race its own 50 races (about 285 s of CI time) with a lane-keeping full-throttle player, under a
// wall-clock limit that fired whenever content grew. The race length is bounded in ticks (the
// batch's MAX_TICKS), so the beforeAll limit below is only a hang guard, above the job's own limit.
import { beforeAll, describe, expect, it } from 'vitest';
import { BATCH_RACES, BATCH_TIMEOUT_MS, simBatch, type BatchResult, type RaceResult } from './batch';
import type { AiRivalsHookResult } from './hooks/ai-rivals';

const RIVALS = ['deacon-vane', 'dial-up', 'chad-speedwell', 'kevin-from-accounting'];
const STUCK_TICKS = 600; // 10 s

let batch: BatchResult;
beforeAll(async () => {
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

function hook(r: RaceResult): AiRivalsHookResult {
  const h = r.hooks['ai-rivals'] as AiRivalsHookResult | undefined;
  if (!h) throw new Error(`seed ${r.seed}: the ai-rivals batch hook did not run`);
  return h;
}

type EndState = 'finished' | 'down' | 'busted' | 'running';

function endStates(r: RaceResult): { id: number; state: EndState }[] {
  const h = hook(r);
  const busted = new Set(
    r.events.flatMap((e) => (e.type === 'bust' && e.target !== undefined ? [e.target] : [])),
  );
  return h.rivals.map((id, k) => {
    const mode = h.endMode[k];
    const state: EndState = r.finishOrder.includes(id)
      ? 'finished'
      : busted.has(id)
        ? 'busted'
        : mode === 'Tumble' || mode === 'OnFoot'
          ? 'down'
          : 'running';
    return { id, state };
  });
}

const isRival = (r: RaceResult, id: number) => hook(r).rivals.includes(id);

/** Distinct rival attacks that landed on the player (a hit and its kick share a cause). */
function hitsOnPlayer(r: RaceResult): number {
  const causes = new Set<number>();
  for (const e of r.events)
    if ((e.type === 'hit' || e.type === 'kick') && e.target === r.playerId && isRival(r, e.actor))
      causes.add(e.causeId ?? -e.tick);
  return causes.size;
}

const finishTicks = (r: RaceResult): Record<number, number> => {
  const out: Record<number, number> = {};
  for (const e of r.events) if (e.type === 'finish') out[e.actor] = e.tick;
  return out;
};

const print = (line: string) => process.stdout.write(line + '\n');
const median = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? NaN;

describe('ai-1: four box rivals over 50 seeded races', () => {
  it('races all four rivals', () => {
    expect(batch.races.length).toBe(BATCH_RACES);
    for (const r of batch.races) {
      const ids = hook(r).contentIds.map((c) => c.slice(c.indexOf(':') + 1));
      expect([...ids].sort(), `seed ${r.seed}`).toEqual([...RIVALS].sort());
    }
  });

  it('every rival finishes, or ends down or busted', () => {
    const counts = { finished: 0, down: 0, busted: 0, running: 0 };
    const bad: string[] = [];
    let classified = 0;
    for (const r of batch.races) {
      for (const { id, state } of endStates(r)) {
        counts[state]++;
        if (state === 'running') bad.push(`seed ${r.seed} rival ${id}`);
      }
      classified += r.events.filter(
        (e) => e.type === 'finish' && e.data['classified'] === true && isRival(r, e.actor),
      ).length;
    }
    print(
      `[examined] ${batch.races.length} races, ${counts.finished + counts.down + counts.busted + counts.running} rival results: ` +
        `finished ${counts.finished} (of which classified at the timeout ${classified}), ` +
        `down ${counts.down}, busted ${counts.busted}, running ${counts.running}`,
    );
    expect(bad).toEqual([]);
  });

  it('no rival is ever stuck for 10 s while not down', () => {
    let worst = 0;
    const bad: string[] = [];
    for (const r of batch.races) {
      const h = hook(r);
      h.longestStall.forEach((stall, k) => {
        worst = Math.max(worst, stall);
        if (stall >= STUCK_TICKS)
          bad.push(`seed ${r.seed} rival ${h.rivals[k]}: ${(stall / 60).toFixed(1)} s`);
      });
    }
    print(
      `[examined] ${batch.races.length * 4} rival races; longest rival stall without progress: ${(worst / 60).toFixed(2)} s (limit 10 s)`,
    );
    expect(bad).toEqual([]);
  });

  it('prints the gap from first to last at the finish', () => {
    const gaps = batch.races.map((r) => {
      const ticks = Object.values(finishTicks(r));
      return ticks.length > 1 ? (Math.max(...ticks) - Math.min(...ticks)) / 60 : NaN;
    });
    const ok = gaps.filter(Number.isFinite).sort((a, b) => a - b);
    const spreads = batch.races.map((r) => hook(r).spreadAtFirstFinish).sort((a, b) => a - b);
    print(
      `gap first to last finisher: median ${median(ok).toFixed(1)} s, max ${(ok[ok.length - 1] ?? NaN).toFixed(1)} s ` +
        `over ${ok.length} races; field spread when the winner finished: median ${median(spreads).toFixed(0)} m, ` +
        `max ${(spreads[spreads.length - 1] ?? NaN).toFixed(0)} m`,
    );
    // The margin against the race-end timeout (30 s after the player): the latest rival home.
    const late = batch.races
      .map((r) => {
        const ft = finishTicks(r);
        const pf = ft[r.playerId];
        const rivals = hook(r)
          .rivals.map((id) => ft[id])
          .filter((x) => x !== undefined);
        return pf === undefined || rivals.length === 0 ? NaN : (Math.max(...rivals) - pf) / 60;
      })
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    print(
      `latest rival home after the player: median ${median(late).toFixed(1)} s, max ${(late[late.length - 1] ?? NaN).toFixed(1)} s`,
    );
    expect(ok.length).toBe(batch.races.length);
  });

  it('prints how often rivals touch traffic (so they do not all pile into the same car)', () => {
    let contacts = 0;
    let vehicles = 0;
    for (const r of batch.races) {
      vehicles = Math.max(vehicles, r.field.vehiclesMax);
      contacts += r.events.filter(
        (e) =>
          (e.type === 'wobble' || e.type === 'crash') && e.data['cause'] === 'traffic' && isRival(r, e.actor),
      ).length;
    }
    const perRivalRace = contacts / (batch.races.length * 4);
    print(
      `rival traffic contacts (wobble or crash): ${contacts} over ${batch.races.length} races, ` +
        `${perRivalRace.toFixed(2)} per rival per race (${vehicles > 0 ? 'traffic present' : 'NO traffic in the batch'})`,
    );
    // A loose guard, not a target: about a quarter per rival per race when this was written.
    expect(perRivalRace).toBeLessThan(1);
  });

  it('rivals land hits on the player (fails at zero)', () => {
    const total = batch.races.reduce((n, r) => n + hitsOnPlayer(r), 0);
    const races = batch.races.filter((r) => hitsOnPlayer(r) > 0).length;
    print(
      `rival hits landed on the player: ${total} over ${batch.races.length} races (${races} races with a hit)`,
    );
    expect(total).toBeGreaterThan(0);
  });

  it('a scripted race gives the same hash every run', () => {
    // The batch replays every race from its recorded inputs in a fresh sim, and compares the state
    // hash every HASH_EVERY_TICKS ticks and at the end: all 50 races, not one.
    for (const r of batch.races) {
      expect(r.replayHashes.length, `seed ${r.seed}: replayed`).toBe(r.hashes.length);
      expect(r.firstMismatch, `seed ${r.seed}: first replay mismatch`).toBe(-1);
    }
  });
});
