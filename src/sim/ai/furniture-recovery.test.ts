import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, planStreetFurniture } from '../../road';
import { loadSimSteps, SIM_TUNING } from '../api';
import { combatSystem } from '../combat';
import { KICK, PUNCH } from '../combat/harness.test-util';
import { raceSystem } from '../race';
import { ridersSystem } from '../riders';
import { BIKE_RADIUS_M, BIKE_SPINE_HALF_M } from '../riders/furniture';
import { input, testConfig } from '../riders/testing';
import { tumbleSystem } from '../tumble';
import { InputFlag, type MoverMode, type SimConfig, type SimEvent } from '../types';
import { addMover, createWorld, stepWorld } from '../world';
import { aiSystem } from './index';

await loadSimSteps();

const SPEED_MPS = 16;
const APPROACH_M = 45;
const PASS_M = 8;

function furnishedRoad(): SimConfig {
  const bundle = fixtureNetwork([
    {
      id: 'a',
      lengthM: 500,
      kappa: 0,
      lanes: [{ id: 'R1', dCenterM: 0, widthM: 4, direction: 1, kind: 'drive' }],
    },
  ]);
  const authored = bundle.roads[0]!;
  authored.tags = [{ s0: 100, s1: 220, side: 'right', tag: 'towers' }];
  authored.barriers = [];
  authored.laneSections[0]!.verges = {
    left: { widthM: 4, surface: 'shoulder', edge: 'soft' },
    right: { widthM: 4, surface: 'shoulder', edge: 'soft' },
  };
  const road = createRoadNetwork(bundle);
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 480 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  const base = testConfig({ rivals: 1, paceMps: SPEED_MPS, rubberBand: 0 });
  const rival = base.riders[0]!;
  return {
    ...base,
    road,
    route,
    riders: [
      { ...rival, controller: { kind: 'ai', style: 'racer', personality: { aggression: 0, weave: 0 } } },
      base.riders[1]!,
    ],
    weapons: [PUNCH, KICK],
    tuning: {
      ...tuningDefaults(SIM_TUNING),
      'ground.offRoad': 1,
      'riders.furniture': 1,
      'riders.structures': 0,
      'riders.pileUps': 0,
    },
  };
}

type Scenario = 'recover' | 'straight' | 'too-close';

function ride(scenario: Scenario) {
  const config = furnishedRoad();
  const pieces = planStreetFurniture(config.road, config.seed).items;
  const lamp = pieces.find((piece) => piece.kind === 'dt-lamp');
  if (!lamp) throw new Error('authored downtown run has no lamp');
  const edge = config.road.edges[0]!;
  // The first lamp is authored by the downtown planner, not inserted by this test. Its roadward
  // edge is clear of the whole road; the approach and return corridor contain no earlier piece.
  expect(lamp.cls).toBe('solid');
  expect(lamp.shape.d - lamp.shape.reachD).toBeGreaterThan(edge.dMax + BIKE_RADIUS_M);
  expect(pieces.some((piece) => piece.s < lamp.s)).toBe(false);
  const decayS = config.tuning['combat.knockbackDecayS']!;
  const shoveM = (KICK.knockbackMps * decayS) / 2;
  const initialD = lamp.shape.d - shoveM;
  expect(Math.abs(initialD) + 1.2 + BIKE_RADIUS_M).toBeLessThanOrEqual(edge.dMax);
  expect(1.2).toBeLessThan(KICK.reachDM);
  // Even a full stock shove plus its 0.4 s of travel and braking from 16 to 8 m/s leaves more
  // than 25 m to steer back into a four-metre road. No seed is searched or furniture moved.
  const brakingM = (SPEED_MPS ** 2 - 8 ** 2) / (2 * config.riders[0]!.bike.brakeMps2);
  expect(APPROACH_M - SPEED_MPS * decayS - brakingM).toBeGreaterThan(25);
  const world = createWorld(config);
  const tooClose = scenario === 'too-close';
  const s = lamp.shape.s - (tooClose ? 1.4 : APPROACH_M);
  const rival = addMover(world, 'rider', { edge: 0, s, d: tooClose ? lamp.shape.d : initialD, dir: 1 }, 0);
  const player = addMover(
    world,
    'rider',
    { edge: 0, s: tooClose ? s - 20 : s, d: initialD - 1.2, dir: 1 },
    1,
  );
  rival.speed = player.speed = SPEED_MPS;
  const systems = [aiSystem, ridersSystem, combatSystem, tumbleSystem, raceSystem];
  for (const system of systems) system.init(world, config);
  // This changes only the straight control's input. Riding, combat, contact and tumble are real
  // in every scene; the recover and too-close scenes use the actual AI input on every tick.
  const driven = systems.map((system) =>
    system === aiSystem && scenario === 'straight'
      ? {
          ...system,
          step() {
            world.inputs[rival.id] = input(rival.speed < SPEED_MPS ? 0.35 : 0);
          },
        }
      : system,
  );
  const events: SimEvent[] = [];
  const trace: { tick: number; s: number; d: number; speed: number; mode: MoverMode; onRoad: boolean }[] = [];
  // Eight m/s is the controller's off-road crawl. Allow the approach plus pass distance at half
  // that speed, and the kick's wind-up, shove and hit stop. This is sim time, never a wall clock.
  const maxTicks = Math.ceil(
    ((APPROACH_M + PASS_M) / 4 + decayS + KICK.windupTicks / 60 + KICK.hitStopMs / 1000) * 60,
  );
  for (let tick = 0; tick < maxTicks; tick++) {
    const playerInput = input(tick < 10 ? 0.35 : 0, tick < 10 ? 0 : 1);
    if (!tooClose && tick < KICK.windupTicks + 1)
      playerInput.flags = InputFlag.kick | InputFlag.attackSideRight | (tick === 0 ? InputFlag.attack : 0);
    events.push(...stepWorld(world, config, driven, [playerInput]));
    const reachD = BIKE_RADIUS_M + BIKE_SPINE_HALF_M * Math.abs(Math.sin(rival.yaw));
    trace.push({
      tick: world.tick,
      s: rival.pos.s,
      d: rival.pos.d,
      speed: rival.speed,
      mode: rival.mode,
      onRoad: rival.pos.d - reachD >= edge.dMin && rival.pos.d + reachD <= edge.dMax,
    });
    if (rival.mode !== 'Road' || rival.pos.s > lamp.shape.s + PASS_M) break;
  }
  const falls = events.filter((event) => event.type === 'crash' && event.actor === rival.id);
  const contacts = events.filter(
    (event) => event.actor === rival.id && event.data['furniture'] === String(lamp.id),
  );
  const hits = events.filter(
    (event) => event.type === 'hit' && event.actor === player.id && event.target === rival.id,
  );
  const peak = trace.reduce((best, sample) => (sample.d > best.d ? sample : best), trace[0]!);
  const returned = trace.find((sample) => sample.tick > peak.tick && sample.onRoad);
  const last = trace.at(-1)!;
  console.log(
    '[furniture recovery]',
    JSON.stringify({
      scenario,
      lamp: { s: lamp.s, d: lamp.shape.d },
      hits,
      peak,
      returned,
      last,
      falls,
      contacts,
      maxTicks,
    }),
  );
  return { hits, peak, returned, last, falls, contacts, trace, lamp, edge };
}

function expectRecovery(result: ReturnType<typeof ride>) {
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0]!.data).toMatchObject({ kick: true });
  expect(Number(result.hits[0]!.data['health'])).toBeGreaterThan(0);
  expect(result.peak.d).toBeGreaterThan(result.edge.dMax + BIKE_RADIUS_M);
  expect(result.returned).toBeDefined();
  expect(result.returned!.s).toBeLessThan(result.lamp.s - result.lamp.shape.reachS - 1);
  expect(result.falls).toEqual([]);
  expect(result.trace.every((sample) => sample.mode === 'Road')).toBe(true);
  expect(result.last.onRoad).toBe(true);
  expect(result.last.s).toBeGreaterThan(result.lamp.s + PASS_M);
}

describe('real rival recovery after a kick onto a furnished roadside', () => {
  it('survives a landed stock kick, returns its whole bike to the road and passes the planned solid lamp', () => {
    expectRecovery(ride('recover'));
  });

  it('the same kick with straight input falls at the lamp and fails the recovery oracle', () => {
    const result = ride('straight');
    expect(result.hits).toHaveLength(1);
    expect(result.peak.d).toBeGreaterThan(result.edge.dMax + BIKE_RADIUS_M);
    expect(result.contacts.some((event) => event.type === 'crash')).toBe(true);
    expect(result.falls[0]?.data).toMatchObject({ object: 'dt-lamp', furniture: String(result.lamp.id) });
    expect(result.last.mode).toBe('Tumble');
    expect(() => expectRecovery(result)).toThrow();
  });

  it('the same observer detects a forced impact when the real AI has only 0.3 m of reaction clearance', () => {
    const result = ride('too-close');
    expect(result.hits).toEqual([]);
    expect(result.contacts.some((event) => event.type === 'crash')).toBe(true);
    expect(result.falls[0]?.data).toMatchObject({
      object: 'dt-lamp',
      furniture: String(result.lamp.id),
      hit: 'end',
    });
    expect(Number(result.falls[0]?.data['impactMps'])).toBeGreaterThan(10);
    expect(result.last.mode).toBe('Tumble');
  });
});
