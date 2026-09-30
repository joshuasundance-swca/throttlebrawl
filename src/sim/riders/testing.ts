// Test fixtures for the riders lane's unit tests (riders, race): a SimConfig on a fixture road,
// and a one-system harness that steps only the riding model with scripted inputs. Used by tests
// only; it follows the sim's determinism rules like any file under src/sim.
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type FixtureEdgeSpec } from '../../road';
import type { SimBikeDef, SimConfig, SimEvent, SimInput, SimRiderDef } from '../types';
import { addMover, createWorld, type Mover, type World } from '../world';
import { ridersSystem, RIDERS_TUNING } from './index';

export const TEST_BIKE: SimBikeDef = {
  contentId: 'base:test-bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

export interface TestConfigOptions {
  edges?: readonly FixtureEdgeSpec[];
  /** Number of AI rivals ahead of the player on the grid. */
  rivals?: number;
  tuning?: Readonly<Record<string, number>>;
  start?: { road: string; s: number; dir: 1 | -1 };
  finish?: { road: string; s: number };
  startGrid?: { rows: number; perRow: number; rowGapM: number };
  checkpoints?: readonly { road: string; s: number }[];
  rubberBand?: number;
  raceEndTimeoutTicks?: number;
  paceMps?: number;
}

export const STRAIGHT: readonly FixtureEdgeSpec[] = [{ id: 'a', lengthM: 3000, kappa: 0 }];

export function testConfig(opts: TestConfigOptions = {}): SimConfig {
  const edges = opts.edges ?? STRAIGHT;
  const road = createRoadNetwork(fixtureNetwork(edges));
  const first = edges[0]?.id ?? 'a';
  const last = edges[edges.length - 1];
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: opts.start ?? { road: first, s: 40, dir: 1 },
    finish: opts.finish ?? { road: last?.id ?? first, s: (last?.lengthM ?? 100) - 20 },
    mainPath: edges.map((e) => e.id),
    allowedRoads: edges.map((e) => e.id),
    closed: false,
    startGrid: opts.startGrid,
    checkpoints: opts.checkpoints ? [...opts.checkpoints] : undefined,
  });
  const rider = (i: number, player: boolean): SimRiderDef => ({
    contentId: player ? 'base:player' : `base:rival-${i}`,
    name: player ? 'You' : `Rival ${i}`,
    role: player ? 'player' : 'rival',
    faction: 'rider',
    controller: player ? { kind: 'player', slot: 0 } : { kind: 'ai', style: 'racer' },
    bike: TEST_BIKE,
    massKg: 80,
    healthMax: 100,
  });
  const rivals = opts.rivals ?? 0;
  const riders = [...Array.from({ length: rivals }, (_v, i) => rider(i, false)), rider(rivals, true)];
  const tuning: Record<string, number> = {};
  for (const d of RIDERS_TUNING) tuning[d.id] = d.default;
  return {
    seed: 1234,
    event: {
      contentId: 'base:test-event',
      kind: 'classic-race',
      paceMps: opts.paceMps ?? 30,
      byPlaceCash: [100, 50, 25],
      raceEndTimeoutTicks: opts.raceEndTimeoutTicks ?? 1800,
    },
    riders,
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { ...tuning, ...(opts.tuning ?? {}) },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: opts.rubberBand ?? 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

export interface RiderHarness {
  world: World;
  config: SimConfig;
  rider: Mover;
  /** Steps the riding model once with this input; returns the events it emitted. */
  step(input: SimInput): SimEvent[];
}

/** One rider on the fixture road, stepped by the riding model alone. */
export function riderHarness(
  config: SimConfig,
  at: { edge?: number; s: number; d: number; dir?: 1 | -1; speed?: number; yaw?: number },
): RiderHarness {
  const world = createWorld(config);
  const rider = addMover(
    world,
    'rider',
    { edge: at.edge ?? 0, s: at.s, d: at.d, dir: at.dir ?? 1 },
    config.riders.length - 1,
  );
  rider.speed = at.speed ?? 0;
  rider.yaw = at.yaw ?? 0;
  ridersSystem.init(world, config);
  return {
    world,
    config,
    rider,
    step(input: SimInput) {
      world.events = [];
      world.inputs[rider.id] = { ...input };
      ridersSystem.step(world, config);
      world.tick++;
      const out = world.events;
      world.events = [];
      return out;
    },
  };
}

/** A SimInput from analog values (steer −1..1, throttle and brake 0..1). */
export function input(throttle: number, brake = 0, steer = 0): SimInput {
  return {
    steer: Math.round(steer * 127),
    throttle: Math.round(throttle * 255),
    brake: Math.round(brake * 255),
    flags: 0,
  };
}
