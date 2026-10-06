/// <reference types="vite/client" />
// Playtest 4 (the maintainer, 2026-10-05: "it's possible that some things on the sidewalks etc should be
// solid and cause a crash; I just want to be sure we're being consistent and intentional"): the
// roadside classes (src/sim/roadside.ts, docs/content-packs.md "Roadside classes") as a rule test.
//
// - Every shipped traffic type (all three packs) says its class, and says one the rules allow for what
//   it is: a person or animal is `dodges` (or `yields` when big), a kerb rider `dodges` (light) or
//   `yields` (a cart), and the road's cars, trucks and parked oddities are `solid`.
// - Each class behaves as its row of the table says, measured on a straight fixture road with one
//   thing on the verge and a rider coming at its lane at 22 m/s: a `dodges` or `yields` thing gets out
//   of the way (moves aside or jumps) and the rider never crashes into a `dodges` one.
// - The behaviour follows the DATA, not the type's name: the same pedestrian with a different
//   `behaviour.roadside` and nothing else changed crashes the rider, or stands still.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { tuningDefaults } from '../../src/core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../src/road';
import { SIM_TUNING } from '../../src/sim/create';
import { pedsSystem, placePed } from '../../src/sim/peds';
import { ridersSystem } from '../../src/sim/riders';
import { roadsideClass, ROADSIDE_CLASSES } from '../../src/sim/roadside';
import { placeVehicle, trafficState, trafficSystem } from '../../src/sim/traffic';
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimTrafficTypeDef } from '../../src/sim/types';
import { addMover, createWorld, stepWorld, type SimSystem } from '../../src/sim/world';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENTS = [
  'base:keys-t1-last-light-duval',
  'region-sf:sf-t1-pier-pressure',
  'region-pnw:pnw-t1-bridge-city',
];

/** Every traffic type of the three packs, as the sim reads them, by content id. */
function allTypes(): Map<string, SimTrafficTypeDef> {
  const out = new Map<string, SimTrafficTypeDef>();
  for (const eventId of EVENTS) {
    const config = buildSimConfig(REG, STREAMS.forEvent(REG, eventId), { seed: 1, eventId });
    for (const t of config.trafficTypes) out.set(t.contentId, t);
  }
  return out;
}

const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const PLAYER: SimRiderDef = {
  contentId: 'base:player-0',
  name: 'player 0',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 85,
  healthMax: 100,
};

function makeConfig(types: SimTrafficTypeDef[], tuning: Record<string, number> = {}): SimConfig {
  const b = fixtureNetwork([
    { id: 'a', lengthM: 900, kappa: 0 },
    { id: 'b', lengthM: 800, kappa: 0 },
  ]);
  const road = createRoadNetwork({
    network: b.network,
    roads: b.roads.map((r) => ({ ...r, features: [], barriers: [] })),
  });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'b', s: 780 },
    mainPath: ['a', 'b'],
    allowedRoads: ['a', 'b'],
    closed: false,
  });
  return {
    seed: 7,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: types,
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
      'traffic.densitySame': 0,
      'traffic.densityOncoming': 0,
      ...tuning,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SYSTEMS: SimSystem[] = [ridersSystem, trafficSystem, pedsSystem];
const cruise: SimInput = { steer: 0, throttle: 255, brake: 0, flags: 0 };

interface Pass {
  moved: number;
  jumped: boolean;
  /** The rider's crashes whose target is the thing. */
  crashes: number;
  /** The least side-to-side clearance at the moment of passing, box edge to box edge, m. */
  clearance: number;
}

/** One rider at 22 m/s straight up the lane of one `type` standing (or riding) on the verge. */
function pass(type: SimTrafficTypeDef, tuning: Record<string, number> = {}): Pass {
  const config = makeConfig([type], tuning);
  const world = createWorld(config);
  const rider = addMover(world, 'rider', { edge: 0, s: 60, d: 5.75, dir: 1 }, 0);
  rider.speed = 22;
  for (const s of SYSTEMS) s.init(world, config);
  let id: number;
  if (type.category === 'pedestrian' || type.category === 'animal') {
    id = placePed(world, config, { type: 0, edge: 0, s: 300, d: 5.75, s0: 290, s1: 310 });
  } else {
    const slot = placeVehicle(world, config, { type: 0, u: 200, dir: 1 });
    id = trafficState(world).id[slot] ?? -1;
  }
  const thing = world.movers[id];
  if (!thing) throw new Error('no thing');
  rider.pos.d = thing.pos.d;
  const d0 = thing.pos.d;
  const out: Pass = { moved: 0, jumped: false, crashes: 0, clearance: Infinity };
  const events: SimEvent[] = [];
  for (let t = 0; t < 60 * 12; t++) {
    events.push(...stepWorld(world, config, SYSTEMS, [cruise]));
    const p = world.movers[id];
    if (!p) continue;
    out.moved = Math.max(out.moved, Math.abs(p.pos.d - d0));
    if (p.h > 0.15) out.jumped = true;
    if (Math.abs(p.pos.s - rider.pos.s) < (2 + type.lengthM) / 2) {
      out.clearance = Math.min(out.clearance, Math.abs(p.pos.d - rider.pos.d) - (0.8 + type.widthM) / 2);
    }
  }
  out.crashes = events.filter((e) => e.type === 'crash' && e.actor === 0 && e.target === id).length;
  return out;
}

const types = allTypes();
const rows = [...types.values()].sort((a, b) => a.contentId.localeCompare(b.contentId));
const isPerson = (t: SimTrafficTypeDef) => t.category === 'pedestrian' || t.category === 'animal';
const isKerbRider = (t: SimTrafficTypeDef) => t.behaviour?.kerb === true;

/** The traffic-type files of all three packs, as written (a type no event mixes in is still a type). */
const RAW = Object.entries(
  import.meta.glob<{
    id: string;
    category: SimTrafficTypeDef['category'];
    hazard: 'normal' | 'big';
    behaviour?: SimTrafficTypeDef['behaviour'];
  }>('/packs/*/traffic/*.json', { eager: true, import: 'default' }),
).map(([file, j]) => ({ file, ...j }));

describe('roadside classes: every traffic type has one, and it fits', () => {
  it('finds all the shipped traffic types', () => {
    expect(RAW.length).toBeGreaterThanOrEqual(80);
    expect(rows.length).toBeGreaterThanOrEqual(79);
  });

  it.each(RAW.map((t) => [t.file, t] as const))(
    '%s says a class the rules allow for what it is',
    (_file, t) => {
      const cls = t.behaviour?.roadside;
      expect(cls, 'an explicit behaviour.roadside').toBeDefined();
      expect(ROADSIDE_CLASSES).toContain(cls);
      const person = t.category === 'pedestrian' || t.category === 'animal';
      if (person) {
        // Living things move out of the way; the big ones are heavy enough that a hit is a crash.
        expect(cls).toBe(t.hazard === 'big' ? 'yields' : 'dodges');
      } else if (t.behaviour?.kerb === true) {
        expect(cls === 'dodges' || cls === 'yields').toBe(true);
        // A light class never goes with a big hazard.
        if (cls === 'dodges') expect(t.hazard).toBe('normal');
      } else {
        // The road's cars, trucks and parked oddities do not get out of a rider's way.
        expect(cls).toBe('solid');
      }
    },
  );
});

describe('roadside classes: a fast rider comes up the verge at each type', () => {
  const movers = rows.filter((t) => isPerson(t) || isKerbRider(t)).filter((t) => t.cruiseMps >= 0);
  const table: string[] = [];

  it.each(movers.map((t) => [t.contentId, t] as const))('%s behaves as its class says', (_id, t) => {
    // ROADSIDE_BEFORE=1 prints the same table with the kerb riders' new verge dodge off (the report's "before").
    const r = pass(t, process.env['ROADSIDE_BEFORE'] === '1' ? { 'traffic.kerbDeep': 0 } : {});
    const cls = roadsideClass(t);
    table.push(
      `${t.contentId} ${cls} moved ${r.moved.toFixed(2)} m${r.jumped ? ' jumped' : ''}` +
        ` clearance ${r.clearance.toFixed(2)} crashes ${r.crashes}`,
    );
    if (cls === 'dodges' || cls === 'yields') {
      // Gets out of the way: moves aside or jumps, and the rider has room (no overlap at the pass).
      expect(r.moved >= 0.6 || r.jumped, 'moved or jumped').toBe(true);
      expect(r.clearance, 'room at the pass').toBeGreaterThan(0);
    }
    if (cls === 'dodges') expect(r.crashes).toBe(0);
  });

  it('prints the table', () => {
    process.stdout.write(`[roadside] ${table.length} movers:\n  ${table.sort().join('\n  ')}\n`);
    expect(table.length).toBe(movers.length);
  });
});

describe('roadside classes: behaviour follows the data', () => {
  const tourist = [...types.values()].find((t) => t.contentId.endsWith('tourist-with-cooler'));
  it('finds the tourist', () => expect(tourist).toBeDefined());
  const withClass = (
    c: 'dodges' | 'yields' | 'solid',
    hazard: 'normal' | 'big' = 'normal',
  ): SimTrafficTypeDef => ({
    ...(tourist as SimTrafficTypeDef),
    hazard,
    behaviour: { ...(tourist?.behaviour ?? {}), roadside: c },
  });
  /** A rider that never sees the thing coming (reaction scale 0 applies to every non-`dodges` kind). */
  const BLIND = { 'peds.bigReactScale': 0 };
  /** The same tourist, standing right in the rider's lane, hit at 35 m/s with nothing dodging. */
  function hit(t: SimTrafficTypeDef, tuning: Record<string, number>) {
    const config = makeConfig([t], tuning);
    const world = createWorld(config);
    const rider = addMover(world, 'rider', { edge: 0, s: 200, d: 5.75, dir: 1 }, 0);
    rider.speed = 35;
    for (const s of SYSTEMS) s.init(world, config);
    const id = placePed(world, config, { type: 0, edge: 0, s: 300, d: 5.75, s0: 290, s1: 310 });
    const events: SimEvent[] = [];
    let moved = 0;
    for (let k = 0; k < 60 * 6; k++) {
      events.push(...stepWorld(world, config, SYSTEMS, [cruise]));
      moved = Math.max(moved, Math.abs((world.movers[id]?.pos.d ?? 5.75) - 5.75));
    }
    return {
      crashed: events.some((e) => e.type === 'crash' && e.actor === 0 && e.target === id),
      dived: events.some((e) => e.type === 'pedDive' && e.actor === id),
      moved,
    };
  }

  it('the same person is a crash when its data says yields, and soft when it says dodges', () => {
    const soft = hit(withClass('dodges'), BLIND);
    const heavy = hit(withClass('yields'), BLIND);
    expect(soft.crashed).toBe(false);
    expect(heavy.crashed).toBe(true);
  });

  it('a `solid` person does not dive and a hit is a crash', () => {
    const solid = hit(withClass('solid'), {});
    expect(solid.dived).toBe(false);
    expect(solid.moved).toBeLessThan(0.1);
    expect(solid.crashed).toBe(true);
  });

  it('hazard no longer decides: a `big` hazard on a `dodges` person is still soft', () => {
    expect(hit(withClass('dodges', 'big'), BLIND).crashed).toBe(false);
  });
});
