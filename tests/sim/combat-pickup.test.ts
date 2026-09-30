import { beforeAll, describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/api';
import { BATCH_TIMEOUT_MS, createBatchRace, simBatch, type BatchResult } from './batch';

// combat-2 over the real base pack and the shared 50-race batch (docs/milestones/M1.md,
// combat-2). The rules themselves are pinned by src/sim/combat/steal.test.ts; here: the pack
// resolves the pipe to the M1 starting numbers, the race lays the pipes out, and in 50 seeded
// races every weapon move is consistent (a pipe is only ever taken from where it is).

const PIPE = 'base:lead-pipe';
let batch: BatchResult;
const print = (line: string) => process.stdout.write(line + '\n');

beforeAll(async () => {
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

describe('combat-2 on the base pack', () => {
  it('resolves the lead pipe to 20 / 6 / 25 ticks with the steal window on ticks 7–20', () => {
    const { config } = createBatchRace(1);
    const pipe = config.weapons.find((w) => w.contentId === PIPE);
    expect(pipe).toBeDefined();
    expect(pipe?.unarmed).toBe(false);
    expect([pipe?.windupTicks, pipe?.activeTicks, pipe?.recoveryTicks]).toEqual([20, 6, 25]);
    expect(pipe?.steal).toEqual({ startTick: 7, endTick: 20 });
    expect([pipe?.reachSM, pipe?.reachDM]).toEqual([1.6, 1.4]);
  });

  it('lays three pipes on the route at race start', () => {
    const { sim } = createBatchRace(1);
    const pickups = sim.snapshot().entities.filter((e) => e.kind === 'pickup');
    expect(pickups).toHaveLength(3);
    for (const p of pickups) {
      expect(p.mode).toBe('Road');
      expect(p.contentId).toBe(PIPE);
    }
  });
});

/** Replays a race's weapon events and returns what they add up to, or the first inconsistency. */
function audit(events: readonly SimEvent[]) {
  const holderOf = new Map<number, number>(); // pickup id -> rider id (absent = on the road)
  const holding = new Map<number, number>(); // rider id -> pickup id
  const out = { road: 0, steal: 0, cues: 0, pipeHits: 0, problem: '' };
  for (const e of events) {
    if (e.type === 'stealWindow') out.cues++;
    if (e.type === 'hit' && e.data['weapon'] === PIPE) out.pipeHits++;
    // A rider who crashes or is knocked off drops the pipe (drops have no event of their own).
    if (e.type === 'crash') {
      const pid = holding.get(e.actor);
      if (pid !== undefined) holderOf.delete(pid);
      holding.delete(e.actor);
    }
    if (e.type !== 'weaponGrab') continue;
    const src = e.data['source'];
    if (src === 'road') {
      out.road++;
      const pid = e.target ?? -1;
      // It may have been dropped since its last grab: drops have no event, so free it here.
      const prev = holderOf.get(pid);
      if (prev !== undefined && holding.get(prev) === pid) holding.delete(prev);
      if (holding.has(e.actor)) out.problem ||= `tick ${e.tick}: rider ${e.actor} picked up a second weapon`;
      holderOf.set(pid, e.actor);
      holding.set(e.actor, pid);
    } else if (src === 'steal') {
      out.steal++;
      const from = e.target ?? -1;
      const pid = holding.get(from);
      if (pid === undefined) out.problem ||= `tick ${e.tick}: stole from rider ${from}, who held nothing`;
      else {
        holding.delete(from);
        holding.set(e.actor, pid);
        holderOf.set(pid, e.actor);
      }
    } else out.problem ||= `tick ${e.tick}: weaponGrab with source ${String(src)}`;
  }
  return out;
}

describe('combat-2 over the shared seeded-race batch', () => {
  it('pipes get picked up, and every weapon move is consistent', () => {
    let road = 0;
    let steal = 0;
    let cues = 0;
    let pipeHits = 0;
    let racesWithGrab = 0;
    const problems: string[] = [];
    for (const race of batch.races) {
      const a = audit(race.events);
      road += a.road;
      steal += a.steal;
      cues += a.cues;
      pipeHits += a.pipeHits;
      if (a.road > 0) racesWithGrab++;
      if (a.problem) problems.push(`seed ${race.seed}: ${a.problem}`);
    }
    print(
      `[combat-2 batch] ${batch.races.length} races: ${road} roadside pickups (in ${racesWithGrab} races), ` +
        `${steal} steals, ${cues} steal cues, ${pipeHits} pipe hits`,
    );
    expect(problems).toEqual([]);
    expect(road).toBeGreaterThan(0);
  });
});
