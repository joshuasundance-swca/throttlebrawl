// Playtest 3, T4.2 (maintainer, 2026-10-03: "bike riders cause collisions when they should arguably
// get out of the way"; the pedestrians are the "etc."): a pedestrian steps back instead of walking
// into a rider.
//   - Gap acceptance, in two stages (the kerb to the refuge on the centre line, the refuge to the far
//     kerb): before a pedestrian steps onto the road, and before it leaves the refuge, it checks the
//     next stage. A rider who would reach the stage inside the stage's time (plus a second) blocks the
//     step, so it waits where it stands.
//   - Hurry: a pedestrian already on the road when a rider turns up faster than expected walks fast to
//     the nearer end of its stage.
//   - The worst-moment gag is a fake-out: the lured pedestrian stops at the kerb and hops back as the
//     rider passes. It never steps onto the road.
//   - `peds.gapAccept` (0 or 1): absent means off, and then nothing here changes.
// Everything is driven by sim ticks (docs/engineering.md, "Tests never wait on wall-clock time").
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  type BakedFeature,
  type FixtureEdgeSpec,
} from '../../road';
import { createSim, SIM_TUNING } from '../create';
import { ridersSystem } from '../riders';
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, stepWorld, type SimSystem, type World } from '../world';
import { PED_PHASE, PEDS, pedsState, pedsSystem, placePed } from './index';

// ---- fixtures ----------------------------------------------------------------------------

const TOURIST: SimTrafficTypeDef = {
  contentId: 'base:tourist',
  category: 'pedestrian',
  lengthM: 0.5,
  widthM: 0.5,
  cruiseMps: 1.4,
  hazard: 'normal',
};
const ELK: SimTrafficTypeDef = {
  contentId: 'pnw:elk',
  category: 'animal',
  lengthM: 2.2,
  widthM: 0.8,
  cruiseMps: 1.6,
  hazard: 'big',
};
const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
// Types by index: 0 car, 1 tourist, 2 elk.
const TYPES = [CAR, TOURIST, ELK];

/** The fixture road: drive lanes at d ±1.7 (right lane runs +s), shoulders, edges at ±4.9, refuge at 0. */
const EDGES: readonly FixtureEdgeSpec[] = [{ id: 'a', lengthM: 3000, kappa: 0 }];
const EDGE = 4.9;

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

/** Six zones along the lane, so a rider cruising it meets a dozen crossers. */
const ZONES: readonly BakedFeature[] = Array.from({ length: 6 }, (_, i) => ({
  kind: 'roadsideZone',
  id: `boardwalk-${i}`,
  s0: 300 + i * 200,
  s1: 400 + i * 200,
  d0: 5,
  d1: 12,
  params: { spawns: 'pedestrians' },
}));

function makeConfig(
  tuning: Record<string, number | undefined> = {},
  seed = 7,
  features: readonly BakedFeature[] = [],
): SimConfig {
  const b = fixtureNetwork(EDGES);
  const road = createRoadNetwork({
    network: b.network,
    roads: b.roads.map((r) => ({ ...r, features, barriers: [] })),
  });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 2990 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  const merged: Record<string, number> = { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)) };
  for (const [k, v] of Object.entries(tuning)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  return {
    seed,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 3600,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: TYPES,
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: merged,
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SCENARIO: SimSystem[] = [ridersSystem, pedsSystem];
const cruise: SimInput = { steer: 0, throttle: 255, brake: 0, flags: 0 };
const ON = { 'peds.gapAccept': 1 };
const OFF = { 'peds.gapAccept': 0 };

function scenario(config: SimConfig, rider: { s: number; d: number; speed: number }): World {
  const world = createWorld(config);
  const m = addMover(world, 'rider', { edge: 0, s: rider.s, d: rider.d, dir: 1 }, 0);
  m.speed = rider.speed;
  for (const s of SCENARIO) s.init(world, config);
  return world;
}

/** A crosser waiting at the right kerb, ready to set off at once. */
function crosser(
  world: World,
  config: SimConfig,
  over: { s?: number; timer?: number; lure?: boolean; type?: number } = {},
) {
  return placePed(world, config, {
    type: over.type ?? 1,
    edge: 0,
    s: over.s ?? 300,
    d: 5.6,
    crosses: true,
    homeD: 5.6,
    farD: -5.6,
    timer: over.timer ?? 0,
    lure: over.lure ?? false,
  });
}

/** Metres from the rider to the pedestrian along the road (negative once the rider is past). */
function ahead(world: World, pedId: number): number {
  return (world.movers[pedId]?.pos.s ?? 0) - (world.movers[0]?.pos.s ?? 0);
}

const gapOn = (config: SimConfig) => (config.tuning['peds.gapAccept'] ?? 0) >= 0.5;

interface Trace {
  events: SimEvent[];
  /** The pedestrian's d at each tick, and the rider's lead over it. */
  d: number[];
  lead: number[];
  speed: number[];
}

function run(world: World, config: SimConfig, pedId: number, seconds: number): Trace {
  const t: Trace = { events: [], d: [], lead: [], speed: [] };
  for (let i = 0; i < seconds * 60; i++) {
    t.events.push(...stepWorld(world, config, SCENARIO, [cruise]));
    t.d.push(world.movers[pedId]?.pos.d ?? NaN);
    t.lead.push(ahead(world, pedId));
    t.speed.push(world.movers[pedId]?.speed ?? NaN);
  }
  return t;
}

const dives = (t: Trace, pedId: number) => t.events.filter((e) => e.type === 'pedDive' && e.actor === pedId);

// ---- tests -------------------------------------------------------------------------------

describe('peds: gap acceptance at the kerb', () => {
  const RIDER = { s: 180, d: 1.7, speed: 38 };

  it('a crosser waits at the kerb while a rider 120 m out in the near lane comes, then crosses', () => {
    const config = makeConfig(ON);
    const world = scenario(config, RIDER);
    const pedId = crosser(world, config);
    const t = run(world, config, pedId, 34);
    // While the rider is still coming (within 125 m ahead) and until its tail has passed, the
    // pedestrian never has a foot on the road, and nobody dives.
    let watched = 0;
    t.lead.forEach((lead, i) => {
      if (lead > -1.5 && lead < 125) {
        watched++;
        expect(Math.abs(t.d[i] ?? 0), `tick ${i}: lead ${lead.toFixed(1)}`).toBeGreaterThanOrEqual(
          EDGE + 0.25 - 1e-6,
        );
      }
    });
    expect(watched).toBeGreaterThan(60);
    expect(dives(t, pedId)).toEqual([]);
    // Once the rider is past, it crosses (a fist or a phone for the rider may come first).
    expect(Math.min(...t.d)).toBeLessThan(-EDGE);
  });

  it('the same scene with gap acceptance off steps out (the check can find it)', () => {
    const config = makeConfig(OFF);
    const world = scenario(config, RIDER);
    const pedId = crosser(world, config);
    const t = run(world, config, pedId, 6);
    // Old behaviour: it sets off at once, so it is on the road with the rider still beyond 40 m.
    const onRoadEarly = t.lead.some((lead, i) => lead > 40 && Math.abs(t.d[i] ?? 99) < EDGE);
    expect(onRoadEarly).toBe(true);
  });

  it('a rider in the far lane lets it cross the near half, then it waits at the refuge', () => {
    const config = makeConfig(ON);
    const world = scenario(config, { s: 70, d: -1.7, speed: 38 });
    const pedId = crosser(world, config);
    const t = run(world, config, pedId, 40);
    let atRefuge = 0;
    t.lead.forEach((lead, i) => {
      const d = t.d[i] ?? 0;
      if (lead > -1.5) {
        // Never in the far half while the far-lane rider is coming or passing.
        expect(d, `tick ${i}: lead ${lead.toFixed(1)}`).toBeGreaterThanOrEqual(-0.05);
        if (Math.abs(d) <= 0.05) atRefuge++;
      }
    });
    // It reached the centre line and held there (about a second, until the rider came inside the
    // threat range 1.7 m from it, where the last-resort dive is the existing rule), and no dive bumped.
    expect(atRefuge).toBeGreaterThan(30);
    expect(dives(t, pedId).every((e) => e.data['bumped'] === false)).toBe(true);
    expect(pedsState(world).contacts).toBe(0);
    // After the rider is past it carries on to the far kerb.
    expect(Math.min(...t.d)).toBeLessThan(-EDGE);
  });

  it('a big animal obeys the same gate (the elk stops walking into racers)', () => {
    const config = makeConfig(ON);
    const world = scenario(config, RIDER);
    const elk = crosser(world, config, { type: 2 });
    const t = run(world, config, elk, 12);
    t.lead.forEach((lead, i) => {
      if (lead > -2 && lead < 125) expect(Math.abs(t.d[i] ?? 0)).toBeGreaterThanOrEqual(EDGE + 0.4 - 1e-6);
    });
    expect(t.events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('a stopped rider does not block a crossing (only riders at 3 m/s or more do)', () => {
    const config = makeConfig(ON);
    const world = scenario(config, { s: 250, d: 1.7, speed: 0 });
    const pedId = placePed(world, config, {
      type: 1,
      edge: 0,
      s: 300,
      d: 5.6,
      crosses: true,
      homeD: 5.6,
      farD: -5.6,
      timer: 0,
    });
    const idle: SimInput = { steer: 0, throttle: 0, brake: 255, flags: 0 };
    let crossed = false;
    for (let i = 0; i < 60 * 12 && !crossed; i++) {
      stepWorld(world, config, SCENARIO, [idle]);
      crossed = (world.movers[pedId]?.pos.d ?? 0) < -EDGE;
    }
    expect(crossed).toBe(true);
  });
});

describe('peds: hurry', () => {
  /** A pedestrian already 2.6 m onto the road on its way across (as gap acceptance leaves it). */
  function midRoad(config: SimConfig, riderLead: number) {
    const gated = gapOn(config);
    const world = scenario(config, { s: 300 - riderLead, d: 1.7, speed: 38 });
    const pedId = crosser(world, config);
    const st = pedsState(world);
    const k = st.id.indexOf(pedId);
    const p = world.movers[pedId];
    if (!p) throw new Error('missing ped');
    p.pos.d = 2.6;
    st.phase[k] = PED_PHASE.walk;
    st.targetD[k] = -5.6;
    st.fromD[k] = 5.6;
    st.gated[k] = gated ? 1 : 0;
    return { world, pedId };
  }

  it('walks fast to the nearer end of its stage and the rider passes untouched, with no dive', () => {
    const config = makeConfig(ON);
    const { world, pedId } = midRoad(config, 65);
    const t = run(world, config, pedId, 4);
    expect(Math.max(...t.speed)).toBeGreaterThan(1.4 * 2);
    expect(Math.max(...t.speed)).toBeLessThanOrEqual(1.4 * PEDS.hurryScale + 1e-6);
    // At the moment the rider's nose is level with it, it is at the refuge or off the road.
    const i = t.lead.findIndex((lead) => lead <= 0);
    expect(i).toBeGreaterThan(0);
    const d = t.d[i] ?? 0;
    expect(Math.abs(d) <= 0.05 || Math.abs(d) >= EDGE).toBe(true);
    expect(dives(t, pedId)).toEqual([]);
    expect(pedsState(world).contacts).toBe(0);
  });

  it('with gap acceptance off it keeps its own pace (and has to dive)', () => {
    const config = makeConfig(OFF);
    const { world, pedId } = midRoad(config, 65);
    const t = run(world, config, pedId, 4);
    expect(Math.max(...t.speed.slice(0, 10))).toBeLessThanOrEqual(1.4 + 1e-6);
    expect(dives(t, pedId).length).toBe(1);
  });
});

describe('peds: the worst-moment gag is a fake-out', () => {
  const RIDER = { s: 200, d: 1.7, speed: 38 };

  it('a lured pedestrian stops at the kerb and hops back as the rider passes', () => {
    const config = makeConfig(ON);
    const world = scenario(config, RIDER);
    const pedId = crosser(world, config, { s: 420, timer: 30, lure: true });
    const t = run(world, config, pedId, 8);
    // Never on the road, never diving.
    expect(t.d.every((d) => Math.abs(d) >= EDGE + 0.25 - 1e-6)).toBe(true);
    expect(dives(t, pedId)).toEqual([]);
    // It did come to the kerb: 0.15 m clear of the road edge (its own half width on top).
    const nearest = Math.min(...t.d.map((d) => Math.abs(d)));
    expect(nearest).toBeLessThan(EDGE + 0.25 + PEDS.fakeOutM + 0.05);
    // And hopped back as the rider went by.
    const hop = t.events.find((e) => e.type === 'pedReact' && e.actor === pedId);
    expect(hop?.data['kind']).toBe('jumpBack');
  });

  it('with gap acceptance off the same pedestrian steps onto the road (the check can find it)', () => {
    const config = makeConfig(OFF);
    const world = scenario(config, RIDER);
    const pedId = crosser(world, config, { s: 420, timer: 30, lure: true });
    const t = run(world, config, pedId, 8);
    expect(t.d.some((d) => Math.abs(d) < EDGE)).toBe(true);
  });
});

describe('peds: gapAccept absent means off', () => {
  /** A scripted run: crossers in front of a rider cruising the lane; every pedestrian's spot along the way. */
  function hashes(tuning: Record<string, number | undefined>): string[] {
    const config = makeConfig(tuning, 11, ZONES);
    const sim = createSim(config);
    const out: string[] = [];
    for (let t = 0; t < 60 * 40; t++) {
      sim.step([cruise]);
      if (t % 30 === 0) {
        const peds = sim.snapshot().entities.filter((e) => e.kind === 'ped');
        out.push(JSON.stringify(peds.map((e) => [e.id, e.road.s, e.road.d])));
      }
    }
    return out;
  }

  it('the key absent runs exactly as the key at 0', () => {
    expect(hashes({ 'peds.gapAccept': undefined })).toEqual(hashes(OFF));
  });

  it('the key at 1 changes the run (so the equality above is not vacuous)', () => {
    expect(hashes(ON)).not.toEqual(hashes(OFF));
  });

  it('the key is declared, 0 or 1, and on by default', () => {
    const decl = SIM_TUNING.find((d) => d.id === 'peds.gapAccept');
    expect(decl).toMatchObject({ default: 1, min: 0, max: 1, step: 1, affectsSim: true });
    expect((decl as { system?: boolean }).system).not.toBe(true);
  });
});
