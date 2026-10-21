// traffic-2's seeded-race assertions (docs/milestones/M1.md, "traffic-2 · Pedestrians"):
//   - across 50 seeded races, riders and pedestrians never make contact;
//   - every threatened pedestrian produces a pedDive.
// (The same-hash replay of every race is dev-1's check over the same batch; the scripted-run hash
// is in src/sim/peds/peds.test.ts.)
//
// Over the shared batch (tests/sim/batch.ts, 50 races, dev-build content, so pedestrians and
// traffic are in): the sim marks any contact as a `pedDive` with data.bumped and the toucher as
// target, and a big kind as a `crash` with data.cause `ped`, so the events show every contact.
//
// Independently, on five of the same seeds through the shared per-tick hook, from the
// snapshots and the public numbers only:
//   - contact: a rider box (on the bike or sliding) overlapping a pedestrian box, using the
//     LARGEST pedestrian kind's box (snapshots do not name a pedestrian's kind), so it over-counts;
//   - threat: pedThreatRangeM(speed) ahead (or PEDS.threatBehindM past) and inside the side band,
//     using the SMALLEST kind's width and one tick of slack, so every flagged tick is one the sim
//     must also flag. Each needs a pedDive for that pedestrian this tick or within one dive;
//   - gap acceptance (playtest 3, T4.2): no pedestrian goes from off the road to on it while a rider
//     is about to reach it. The check over-approximates with the published PEDS constants: it
//     counts only a step that leaves the rider under half the gate's one second of margin, from a
//     rider on the pedestrian's half of the road at the gate's minimum speed.
import { beforeAll, describe, expect, it } from 'vitest';
import { BATCH_TIMEOUT_MS, simBatch, type BatchResult, type RaceResult } from './batch';
import { selectedPedestrianChecks, type PedestrianCheck } from './hooks/pedestrian';

const print = (line: string) => process.stdout.write(line + '\n');

const sum = (rs: readonly RaceResult[], f: (r: RaceResult) => number) => rs.reduce((n, r) => n + f(r), 0);

describe('traffic-2: pedestrians over the shared 50-race batch', () => {
  let batch: BatchResult;
  // The per-tick test also awaits the batch itself, so either describe can run alone.
  beforeAll(async () => {
    batch = await simBatch();
  }, BATCH_TIMEOUT_MS);

  it('every race has pedestrians, and they dive', () => {
    const rs = batch.races;
    const dives = sum(rs, (r) => r.eventCounts['pedDive'] ?? 0);
    print(
      `[peds] ${rs.length} races: pedestrians per race ${Math.min(...rs.map((r) => r.field.pedsMax))}` +
        `-${Math.max(...rs.map((r) => r.field.pedsMax))}, ${dives} pedDive events ` +
        `(${rs.filter((r) => (r.eventCounts['pedDive'] ?? 0) > 0).length} races with a dive)`,
    );
    expect(rs.length).toBe(50);
    expect(rs.every((r) => r.field.pedsMax > 0)).toBe(true);
    expect(dives).toBeGreaterThan(rs.length);
  });

  it('riders and pedestrians never make contact', () => {
    const rs = batch.races;
    const touches: string[] = [];
    let carBumps = 0;
    for (const r of rs) {
      for (const e of r.events) {
        const rider = e.target !== undefined && e.target < r.field.riders;
        if (e.type === 'pedDive' && e.data['bumped'] === true) {
          if (rider) touches.push(`seed ${r.seed} tick ${e.tick} rider ${e.target} ped ${e.actor}`);
          else carBumps++;
        }
        if (e.type === 'crash' && e.data['cause'] === 'ped') {
          touches.push(`seed ${r.seed} tick ${e.tick} crash rider ${e.actor}`);
        }
      }
    }
    const events = sum(rs, (r) => r.events.length);
    print(
      `[peds] examined ${events} events in ${rs.length} races: ${touches.length} rider contacts, ` +
        `${carBumps} car bumps`,
    );
    expect(events).toBeGreaterThan(0);
    expect(touches.slice(0, 5)).toEqual([]);
  });
});

describe('traffic-2: per-tick checks from the snapshots, five of the batch seeds and on until they see', () => {
  it('no rider box ever overlaps a pedestrian, and every threatened pedestrian is diving', async () => {
    const batch = await simBatch();
    const checks = selectedPedestrianChecks(batch.races);
    const total = (f: (c: PedestrianCheck) => number) => checks.reduce((n, c) => n + f(c), 0);
    print(`[peds] per-tick seeds ridden: 1 to ${checks.length}`);
    const undived = checks.flatMap((c) => c.undived);
    const contacts = checks.flatMap((c) => c.contacts);
    const stepIns = checks.flatMap((c) => c.stepIns);
    print(
      `[peds] per-tick: ${checks.length} races, ${total((c) => c.ticks)} ticks, ` +
        `${total((c) => c.pairs)} rider-pedestrian pairs examined, ${total((c) => c.threatened.length)} ` +
        `threatened pedestrians over ${total((c) => c.threatTicks)} threat ticks, ` +
        `${undived.length} without a dive, ${contacts.length} contacts; ` +
        `${total((c) => c.stepOns)} steps onto the road, ${stepIns.length} into a rider's gap`,
    );
    expect(total((c) => c.pairs)).toBeGreaterThan(0);
    expect(total((c) => c.threatened.length)).toBeGreaterThan(0);
    expect(undived.slice(0, 5)).toEqual([]);
    expect(contacts.slice(0, 5)).toEqual([]);
    // Gap acceptance: they do cross (the check sees steps), and none steps in front of a rider.
    expect(total((c) => c.stepOns)).toBeGreaterThan(0);
    expect(stepIns.slice(0, 5)).toEqual([]);
    // A hang guard while awaiting the shared batch; checker coverage is at most 16 races.
  }, 900_000);
});
