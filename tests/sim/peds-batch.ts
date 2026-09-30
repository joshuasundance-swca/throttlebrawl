/// <reference types="vite/client" />
// The pack loader uses import.meta.glob, so this Node-side test needs the Vite client types.
// traffic-2's seeded-race assertions (docs/milestones/M1.md, "traffic-2 · Pedestrians"):
//   - across 50 seeded races, riders and pedestrians never make contact;
//   - every threatened pedestrian produces a pedDive;
//   - a race replays to the same hash.
// Interim: dev-1 owns the shared batch (tests/sim/batch.ts). Until it lands, traffic-2 runs its own
// 50 races with the field the batch will have: the stub bot in the player slot, four rivals, the
// cop (appended the way cops-bust-rate.test.ts does, until buildSimConfig adds him), traffic both
// ways (the dev-build content, drafts included) and pedestrians. Switch to the shared results then.
// With traffic in the field a race costs a few seconds, so the 50 races are split across the five
// files tests/sim/peds-dives-<n>.test.ts, 10 each, which Vitest runs in parallel workers.
//
// Both checks are made from the outside, on snapshots, with the public numbers:
//   - contact: a rider box (on the bike or sliding) overlapping a pedestrian box, using the
//     LARGEST pedestrian kind's box (snapshots do not name a pedestrian's kind), so it over-counts;
//   - threat: pedThreatRangeM(speed) ahead (or PEDS.threatBehindM past) and inside the side band,
//     using the SMALLEST kind's width, so every flagged tick is one the sim must also flag. Each one
//     needs a pedDive for that pedestrian this tick or within one dive's length.
import { describe, expect, it } from 'vitest';
import { type ActionState } from '../../src/app';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { basePackFiles, buildRegistry, lookup, type ContentRegistry } from '../../src/content';
import { createStubBot } from '../../src/dev/bot';
import { PEDS, pedThreatRangeM } from '../../src/sim/peds';
import {
  createSim,
  quantizeInput,
  type EntitySnapshot,
  type RoadNetwork,
  type SimConfig,
  type SimRiderDef,
} from '../../src/sim/api';

/** All 50 races, split into PARTS files of RACES / PARTS each. */
export const RACES = 50;
export const PARTS = 5;
const RIVALS = ['deacon-vane', 'dial-up', 'chad-speedwell', 'kevin-from-accounting'];
/** A cap well past the ~100 s race, for a rider left far behind. */
const MAX_TICKS = 60 * 200;

/** The base pack with drafts (the dev build's traffic), the default event holding all four rivals. */
function registry(): ContentRegistry {
  const files = basePackFiles().map((f) => {
    const json = f.json as { type?: string; field?: { riders?: string[] } };
    if (json.type !== 'event' || !json.field) return f;
    const riders = [...(json.field.riders ?? [])];
    for (const id of RIVALS) if (!riders.includes(id)) riders.push(id);
    return { ...f, json: { ...json, field: { ...json.field, riders } } };
  });
  return buildRegistry(files, { includeDrafts: true });
}

/** Sgt. Pruitt as a SimRiderDef, resolved as cops-bust-rate.test.ts does. */
function pruitt(reg: ContentRegistry): SimRiderDef {
  const rider = lookup(reg.riders, 'sgt-pruitt');
  const law = rider.law;
  if (rider.role !== 'cop' || !law) throw new Error('sgt-pruitt must be a cop with a law block');
  const h = lookup(reg.bikes, rider.bike).handling;
  return {
    contentId: `base:${rider.id}`,
    name: rider.name ?? rider.id,
    role: 'cop',
    faction: 'law',
    controller: { kind: 'cop' },
    bike: {
      contentId: `base:${rider.bike}`,
      topSpeedMps: h.topSpeedMps * law.pursuitSpeedScale,
      accelMps2: h.accelMps2,
      brakeMps2: h.brakeMps2,
      steerRateMps: h.steerRateMps,
      massKg: h.massKg,
    },
    massKg: rider.stats?.massKg ?? 80,
    healthMax: rider.stats?.healthMax ?? 100,
    law: {
      agency: `base:${law.agency}`,
      bustRadiusM: law.bustRadiusM,
      bustDwellS: law.bustDwellS,
      fineCash: law.fineCash,
      pursuitSpeedScale: law.pursuitSpeedScale,
    },
  };
}

const REG = registry();
const STREAM = streamForEvent(REG);
const COP = pruitt(REG);

export function configFor(seed: number): SimConfig {
  const base = buildSimConfig(REG, STREAM, { seed });
  return { ...base, riders: [...base.riders, COP] };
}

function blank(): ActionState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    attack: false,
    attackSide: 0,
    kick: false,
    lookBack: false,
    skipRunBack: false,
  };
}

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

interface RaceResult {
  seed: number;
  ticks: number;
  peds: number;
  vehicles: number;
  dives: number;
  bumped: number;
  threatTicks: number;
  threatenedPeds: number;
  undived: string[];
  contacts: string[];
  finalHash: number;
}

function runRace(seed: number): RaceResult {
  const config = configFor(seed);
  const sim = createSim(config);
  const bot = createStubBot();
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const pedKinds = config.trafficTypes.filter((t) => t.category === 'pedestrian' || t.category === 'animal');
  const bigLength = Math.max(...pedKinds.map((t) => t.lengthM));
  const bigWidth = Math.max(...pedKinds.map((t) => t.widthM));
  const smallWidth = Math.min(...pedKinds.map((t) => t.widthM));
  const band = (PEDS.riderWidthM + smallWidth) / 2 + PEDS.lateralM;
  const diveTicks = Math.ceil(PEDS.diveS * 60) + 1;
  const lastDive = new Map<number, number>();
  const threatened = new Set<number>();
  const touching = new Set<string>();
  const out: RaceResult = {
    seed,
    ticks: 0,
    peds: 0,
    vehicles: 0,
    dives: 0,
    bumped: 0,
    threatTicks: 0,
    threatenedPeds: 0,
    undived: [],
    contacts: [],
    finalHash: 0,
  };
  // Once every rider is well past the last roadside zone, nobody can meet a pedestrian again, so
  // the race is cut there (the cop never finishes, so the race itself runs on).
  let lastZoneDtf = Infinity;
  for (const e of config.road.edges) {
    for (const f of config.road.featuresOf(e.index, 'roadsideZone')) {
      for (const s of [f.s0, f.s1])
        lastZoneDtf = Math.min(lastZoneDtf, config.route.distanceToFinish(e.index, s));
    }
  }
  const pastZones = (entities: readonly EntitySnapshot[]) =>
    entities.every((e) => e.kind !== 'rider' || e.finished || e.distanceToFinish < lastZoneDtf - 30);
  let snap = sim.snapshot();
  out.peds = snap.entities.filter((e) => e.kind === 'ped').length;
  while (!sim.isOver() && sim.tick < MAX_TICKS && !pastZones(snap.entities)) {
    const me = snap.entities[playerId];
    const a = blank();
    if (me) bot.drive(me, config.route, a);
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    for (const e of sim.events()) {
      if (e.type !== 'pedDive') continue;
      out.dives++;
      if (e.data['bumped'] === true) out.bumped++;
      lastDive.set(e.actor, e.tick);
    }
    snap = sim.snapshot();
    const peds = snap.entities.filter((e) => e.kind === 'ped');
    out.vehicles = Math.max(out.vehicles, snap.entities.filter((e) => e.kind === 'vehicle').length);
    for (const r of snap.entities) {
      if (r.kind !== 'rider' || !(r.mode === 'Road' || r.mode === 'Airborne' || r.mode === 'Tumble'))
        continue;
      for (const p of peds) {
        const range = Math.max(10, pedThreatRangeM(r.speed));
        const rel = relate(config.road, r, p, range);
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
        if (!rel || r.speed < PEDS.threatMinMps + 0.5 || r.road.h - p.road.h >= PEDS.maxContactH - 0.1)
          continue;
        if (rel.along < -PEDS.threatBehindM + slack || rel.along > pedThreatRangeM(r.speed) - slack) continue;
        if (Math.abs(rel.side) >= band - 0.1) continue;
        out.threatTicks++;
        threatened.add(p.id);
        if (snap.tick - (lastDive.get(p.id) ?? -1e9) > diveTicks) {
          out.undived.push(`seed ${seed} tick ${snap.tick} rider ${r.id} ped ${p.id}`);
        }
      }
    }
  }
  out.ticks = sim.tick;
  out.threatenedPeds = threatened.size;
  out.finalHash = sim.hash();
  return out;
}

/** Registers part `part` (0-based) of the batch: races part·10 … part·10+9 of the 50. */
export function pedsBatchPart(part: number): void {
  const per = RACES / PARTS;
  const seeds = Array.from({ length: per }, (_, i) => 2000 + (part * per + i) * 7919);
  describe(`traffic-2: pedestrians, races ${part * per + 1}-${(part + 1) * per} of ${RACES} seeded races`, () => {
    it('riders and pedestrians never touch, and every threatened pedestrian dives', () => {
      const results = seeds.map(runRace);
      const sum = (f: (r: RaceResult) => number) => results.reduce((n, r) => n + f(r), 0);
      const contacts = results.flatMap((r) => r.contacts);
      const undived = results.flatMap((r) => r.undived);
      const ticks = results.map((r) => r.ticks).sort((a, b) => a - b);
      // Straight to stdout: Vitest hides console output from passing tests, and this line must show.
      process.stdout.write(
        `peds batch part ${part + 1}/${PARTS}: ${per} seeded races, ${sum((r) => r.ticks)} ticks ` +
          `(per race min ${ticks[0]}, median ${ticks[per >> 1]}, max ${ticks[per - 1]}), ` +
          `${sum((r) => r.peds)} pedestrians spawned (${results[0]?.peds ?? 0} per race), ` +
          `up to ${Math.max(...results.map((r) => r.vehicles))} vehicles, ` +
          `${sum((r) => r.dives)} dives (${sum((r) => r.bumped)} bumped), ` +
          `${sum((r) => r.threatenedPeds)} threatened pedestrians over ${sum((r) => r.threatTicks)} rider-pedestrian threat ticks, ` +
          `${undived.length} threatened without a dive, ${contacts.length} rider contacts\n`,
      );
      expect(results).toHaveLength(per);
      expect(results.every((r) => r.peds > 0)).toBe(true);
      expect(results.every((r) => r.vehicles > 0)).toBe(true);
      // Not vacuous: riders really do come at pedestrians, and they really do dive.
      expect(sum((r) => r.threatenedPeds)).toBeGreaterThan(0);
      expect(sum((r) => r.dives)).toBeGreaterThan(per);
      expect(undived.slice(0, 5)).toEqual([]);
      expect(contacts.slice(0, 5)).toEqual([]);
    }, 300_000);

    if (part === 0) {
      it('a race replays to the same hash', () => {
        const a = runRace(4242);
        const b = runRace(4242);
        expect(a.ticks).toBeGreaterThan(0);
        expect(b.finalHash).toBe(a.finalHash);
        expect(b.dives).toBe(a.dives);
      }, 120_000);
    }
  });
}
