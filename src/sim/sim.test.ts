import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../road';
import { createSim, neutralInput, quantizeInput, SIM_TUNING, type SimConfig, type SimInput } from './api';
import { TICK_ORDER } from './world';

function fixtureConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  const road = createRoadNetwork(
    fixtureNetwork([
      { id: 'a', lengthM: 400, kappa: 0 },
      { id: 'b', lengthM: 500, kappa: 1 / 300, grade: 0.02 },
      { id: 'c', lengthM: 400, kappa: -1 / 400 },
    ]),
  );
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'c', s: 380 },
    mainPath: ['a', 'b', 'c'],
    allowedRoads: ['a', 'b', 'c'],
    closed: false,
  });
  const bike = {
    contentId: 'base:bike',
    topSpeedMps: 38,
    accelMps2: 4.2,
    brakeMps2: 9,
    steerRateMps: 5.5,
    massKg: 180,
  };
  return {
    seed: 1234,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: [
      {
        contentId: 'base:rival',
        name: 'Rival',
        role: 'rival',
        faction: 'rider',
        controller: { kind: 'ai', style: 'racer' },
        bike,
        massKg: 90,
        healthMax: 100,
      },
      {
        contentId: 'base:player',
        name: 'You',
        role: 'player',
        faction: 'rider',
        controller: { kind: 'player', slot: 0 },
        bike,
        massKg: 80,
        healthMax: 100,
      },
    ],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { 'riders.steerScale': 1 },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
    ...overrides,
  };
}

/** A scripted input: full throttle, a steering wobble, a brake tap. */
function scripted(tick: number): SimInput {
  return quantizeInput({
    throttle: tick % 400 < 350 ? 1 : 0,
    brake: tick % 400 >= 380 ? 0.6 : 0,
    steer: 0.4 * Math.sin(tick / 50),
    flags: 0,
  });
}

describe('sim: the contract', () => {
  it('declares its tuning parameters inside their ranges', () => {
    expect(SIM_TUNING.length).toBeGreaterThan(0);
    for (const d of SIM_TUNING) {
      expect(d.default).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeLessThanOrEqual(d.max);
    }
  });

  it('runs its systems in the fixed tick order', () => {
    expect(TICK_ORDER).toEqual([
      'controllers',
      'riders',
      'combat',
      'cops',
      'traffic',
      'peds',
      'tumble',
      'race',
      'modifiers',
    ]);
  });

  it('gives the same hash every run for the same scripted input (600 ticks)', () => {
    const run = () => {
      const sim = createSim(fixtureConfig());
      const hashes: number[] = [];
      for (let t = 0; t < 600; t++) {
        sim.step([scripted(t)]);
        hashes.push(sim.hash());
      }
      return hashes;
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(500);
  });

  it('converges toward top speed under full throttle and slows when released', () => {
    const sim = createSim(fixtureConfig());
    for (let t = 0; t < 60 * 20; t++)
      sim.step([quantizeInput({ throttle: 1, brake: 0, steer: 0, flags: 0 })]);
    const player = () => sim.snapshot().entities.find((e) => e.slot === 0);
    const fast = player()?.speed ?? 0;
    expect(fast).toBeGreaterThan(30);
    expect(fast).toBeLessThanOrEqual(38 + 1e-9);
    for (let t = 0; t < 60; t++) sim.step([neutralInput()]);
    expect(player()?.speed ?? 0).toBeLessThan(fast);
  });

  it('applies a tuning change on the next tick only, and refuses unknown ids', () => {
    const a = createSim(fixtureConfig());
    const b = createSim(fixtureConfig());
    for (let t = 0; t < 100; t++) {
      a.step([scripted(t)]);
      b.step([scripted(t)]);
    }
    a.applyParam('riders.steerScale', 1.8);
    expect(a.hash()).toBe(b.hash()); // nothing changes until the next step...
    for (let t = 100; t < 200; t++) {
      a.step([scripted(t)]);
      b.step([scripted(t)]);
    }
    const pa = a.snapshot().entities.find((e) => e.slot === 0);
    const pb = b.snapshot().entities.find((e) => e.slot === 0);
    expect(pa?.road.d).not.toBe(pb?.road.d); // ...and it changed the outcome
    expect(() => a.applyParam('nope.nothing', 1)).toThrow(/not a sim tuning parameter/);
  });

  it('runs a race to the end with a placing, crossing both junctions, with no NaN', () => {
    const sim = createSim(fixtureConfig());
    const edges: number[] = [];
    let ticks = 0;
    while (!sim.isOver() && ticks < 60 * 300) {
      const me = sim.snapshot().entities.find((e) => e.slot === 0);
      const steer = me ? Math.max(-1, Math.min(1, (1.7 - me.road.d) * 0.3 - me.road.yaw * 2)) : 0;
      sim.step([quantizeInput({ throttle: 1, brake: 0, steer, flags: 0 })]);
      ticks++;
      for (const e of sim.snapshot().entities) {
        for (const v of [e.x, e.y, e.z, e.road.s, e.road.d, e.speed, e.heading])
          expect(Number.isFinite(v)).toBe(true);
        if (e.slot === 0 && edges[edges.length - 1] !== e.road.edge) edges.push(e.road.edge);
      }
    }
    expect(sim.isOver()).toBe(true);
    expect(edges).toEqual([0, 1, 2]);
    const snap = sim.snapshot();
    expect(snap.race.finishOrder.length).toBe(2);
    expect(snap.entities.map((e) => e.place).sort()).toEqual([1, 2]);
  });
});
