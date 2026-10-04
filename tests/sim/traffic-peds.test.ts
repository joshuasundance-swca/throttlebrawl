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
// Independently, on five of the same seeds with per-tick access (runSeededRace's onTick), from the
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
import { PEDS, pedThreatRangeM } from '../../src/sim/peds';
import type { EntitySnapshot, RoadNetwork, SimConfig } from '../../src/sim/api';
import {
  BATCH_TIMEOUT_MS,
  createBatchRace,
  runSeededRace,
  simBatch,
  type BatchResult,
  type RaceResult,
} from './batch';

const print = (line: string) => process.stdout.write(line + '\n');
const PER_TICK_SEEDS = [1, 2, 3, 4, 5];

let batch: BatchResult;
beforeAll(async () => {
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

const sum = (rs: readonly RaceResult[], f: (r: RaceResult) => number) => rs.reduce((n, r) => n + f(r), 0);

describe('traffic-2: pedestrians over the shared 50-race batch', () => {
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

/** Along-road offset (in the rider's travel direction) and side offset of p from r, or null. */
function relate(road: RoadNetwork, r: EntitySnapshot, p: EntitySnapshot, range: number) {
  let ps = p.road.s;
  let sign = 1;
  if (r.road.edge !== p.road.edge) {
    const n = road.neighbours(r.road.edge, r.road.s, range).find((q) => q.edge === p.road.edge);
    if (!n) return null;
    ps = n.sOffset + n.sSign * p.road.s;
    sign = n.sSign;
  }
  const along = (ps - r.road.s) * r.road.dir;
  if (Math.abs(along) > range) return null;
  return { along, side: sign * p.road.d - r.road.d };
}

interface TickCheck {
  /** Pedestrians seen going from off the road to on it, and those with a rider about to arrive. */
  stepOns: number;
  stepIns: string[];
  ticks: number;
  pairs: number;
  threatTicks: number;
  threatened: Set<number>;
  undived: string[];
  contacts: string[];
}

function perTickRace(seed: number): TickCheck {
  const config: SimConfig = createBatchRace(seed).config;
  const kinds = config.trafficTypes.filter((t) => t.category === 'pedestrian' || t.category === 'animal');
  const bigLength = Math.max(...kinds.map((t) => t.lengthM));
  const bigWidth = Math.max(...kinds.map((t) => t.widthM));
  const smallWidth = Math.min(...kinds.map((t) => t.widthM));
  const band = (PEDS.riderWidthM + smallWidth) / 2 + PEDS.lateralM;
  const diveTicks = Math.ceil(PEDS.diveS * 60) + 1;
  // Dive ages count scaled ticks (the sum of timeScale), as the sim's dive timer does: a hit-stop
  // freezes a dive in mid-air, so in raw ticks it lasts longer than diveTicks.
  let scaledTicks = 0;
  const lastDive = new Map<number, number>();
  const touching = new Set<string>();
  /** Riders whose crash went over a rail: falling to the water, not sliding along the deck. */
  const overboard = new Set<number>();
  /** Each rider's height in the last snapshot: what the peds step sees of a tumble this tick. */
  const prevH = new Map<number, number>();
  /** Each pedestrian's last snapshot: was it on the road, and how long ago did it dive. */
  const wasOn = new Map<number, boolean>();
  const out: TickCheck = {
    stepOns: 0,
    stepIns: [],
    ticks: 0,
    pairs: 0,
    threatTicks: 0,
    threatened: new Set(),
    undived: [],
    contacts: [],
  };
  runSeededRace(seed, {
    noReplay: true,
    onTick(snap, events) {
      out.ticks++;
      scaledTicks += snap.timeScale;
      for (const e of events) if (e.type === 'pedDive') lastDive.set(e.actor, scaledTicks);
      for (const e of events) if (e.type === 'railOver') overboard.add(e.actor);
      for (const e of snap.entities) if (e.kind === 'rider' && e.mode !== 'Tumble') overboard.delete(e.id);
      const peds = snap.entities.filter((e) => e.kind === 'ped');
      for (const p of peds) {
        let lo = 0;
        let hi = 0;
        for (const lane of config.road.lanesAt(p.road.edge, p.road.s)) {
          lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
          hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
        }
        const on = p.road.d > lo && p.road.d < hi;
        const before = wasOn.get(p.id);
        wasOn.set(p.id, on);
        // A dive can land on the road (and the walk off it follows); only a walk onto it is a step.
        const diving = scaledTicks - (lastDive.get(p.id) ?? -1e9) <= diveTicks + 60 * PEDS.downS;
        if (before !== false || !on || diving) continue;
        out.stepOns++;
        for (const r of snap.entities) {
          if (r.kind !== 'rider' || !(r.mode === 'Road' || r.mode === 'Airborne' || r.mode === 'Tumble'))
            continue;
          if (r.speed < PEDS.threatMinMps + 0.5) continue;
          const rel = relate(config.road, r, p, PEDS.gapLookM);
          if (!rel || rel.along < 0) continue;
          const arrival = (rel.along - (PEDS.riderLengthM + bigLength) / 2) / r.speed;
          const sameHalf = Math.sign(r.road.d) === Math.sign(p.road.d) || Math.abs(r.road.d) <= 1;
          if (arrival < PEDS.gapMarginS / 2 && sameHalf && Math.abs(r.road.h - p.road.h) < PEDS.maxContactH) {
            out.stepIns.push(
              `seed ${seed} tick ${snap.tick} rider ${r.id} ped ${p.id} arrival ${arrival.toFixed(2)} s`,
            );
          }
        }
      }
      for (const r of snap.entities) {
        if (r.kind !== 'rider' || !(r.mode === 'Road' || r.mode === 'Airborne' || r.mode === 'Tumble'))
          continue;
        for (const p of peds) {
          out.pairs++;
          const rel = relate(config.road, r, p, Math.max(10, pedThreatRangeM(r.speed)));
          const key = `${r.id}/${p.id}`;
          const overlap =
            rel !== null &&
            Math.abs(rel.along) < (PEDS.riderLengthM + bigLength) / 2 &&
            Math.abs(rel.side) < (PEDS.riderWidthM + bigWidth) / 2 &&
            Math.abs(r.road.h - p.road.h) < PEDS.maxContactH;
          if (overlap && !touching.has(key)) {
            touching.add(key);
            out.contacts.push(`seed ${seed} tick ${snap.tick} rider ${r.id} (${r.mode}) ped ${p.id}`);
          } else if (!overlap) {
            touching.delete(key);
          }
          // One tick of travel as slack: a sliding crash moves in the tumble phase, after peds, so
          // the sim sees it one tick behind the snapshot.
          const slack = r.speed / 60 + 0.1;
          if (!rel || r.speed < PEDS.threatMinMps + 0.5) continue;
          // Over the rail and falling (its speed is the fall, its road spot the deck it left): no
          // threat to anyone on the road. Seed 1 met one once the 2026-10-02 run-back trim
          // reshuffled the race.
          if (overboard.has(r.id)) continue;
          // The height lags a tick too: a crash thrown high falls in the tumble phase, after peds, so
          // the sim judged last tick's height (seed 5 once #353's Keys traffic reshuffled the race:
          // a rival falling 0.16 m a tick read 1.36 m here and 1.52 m to the sim, over its 1.5).
          const seenH = r.mode === 'Tumble' ? Math.max(r.road.h, prevH.get(r.id) ?? r.road.h) : r.road.h;
          if (seenH - p.road.h >= PEDS.maxContactH - 0.1) continue;
          if (rel.along < -PEDS.threatBehindM + slack || rel.along > pedThreatRangeM(r.speed) - slack)
            continue;
          if (Math.abs(rel.side) >= band - 0.1) continue;
          out.threatTicks++;
          out.threatened.add(p.id);
          if (scaledTicks - (lastDive.get(p.id) ?? -1e9) > diveTicks) {
            out.undived.push(`seed ${seed} tick ${snap.tick} rider ${r.id} ped ${p.id}`);
          }
        }
      }
      for (const e of snap.entities) if (e.kind === 'rider') prevH.set(e.id, e.road.h);
    },
  });
  return out;
}

describe('traffic-2: per-tick checks from the snapshots, five of the batch seeds', () => {
  it('no rider box ever overlaps a pedestrian, and every threatened pedestrian is diving', () => {
    const checks = PER_TICK_SEEDS.map(perTickRace);
    const total = (f: (c: TickCheck) => number) => checks.reduce((n, c) => n + f(c), 0);
    const undived = checks.flatMap((c) => c.undived);
    const contacts = checks.flatMap((c) => c.contacts);
    const stepIns = checks.flatMap((c) => c.stepIns);
    print(
      `[peds] per-tick: ${checks.length} races, ${total((c) => c.ticks)} ticks, ` +
        `${total((c) => c.pairs)} rider-pedestrian pairs examined, ${total((c) => c.threatened.size)} ` +
        `threatened pedestrians over ${total((c) => c.threatTicks)} threat ticks, ` +
        `${undived.length} without a dive, ${contacts.length} contacts; ` +
        `${total((c) => c.stepOns)} steps onto the road, ${stepIns.length} into a rider's gap`,
    );
    expect(total((c) => c.pairs)).toBeGreaterThan(0);
    expect(total((c) => c.threatened.size)).toBeGreaterThan(0);
    expect(undived.slice(0, 5)).toEqual([]);
    expect(contacts.slice(0, 5)).toEqual([]);
    // Gap acceptance: they do cross (the check sees steps), and none steps in front of a rider.
    expect(total((c) => c.stepOns)).toBeGreaterThan(0);
    expect(stepIns.slice(0, 5)).toEqual([]);
  }, 300_000);
});
