import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureBranchNetwork } from '../../road';
import { testConfig } from '../riders/testing';
import { createWorld, stepWorld, worldHash } from '../world';
import { trafficState, trafficSystem } from './index';
import { junctionSpawnAllowed, junctionStops } from './junctions';
import { placeRoadVehicle } from './path-view';

function setup(lengthM = 4.6, parallel = false, raised = false) {
  const fixture = fixtureBranchNetwork();
  const road = createRoadNetwork({
    ...fixture,
    roads: fixture.roads.map((r) => ({
      ...r,
      features: [],
      laneSections: r.laneSections.map((section) => ({
        ...section,
        lanes: [
          ...section.lanes.map((lane) =>
            lane.kind === 'shortcut' ? { ...lane, kind: 'drive' as const } : lane,
          ),
          ...(parallel && r.id === 'a'
            ? [{ id: 'R2', dCenterM: 5.1, widthM: 3.4, direction: 1 as const, kind: 'drive' as const }]
            : []),
        ],
      })),
      samples:
        raised && ['c-in', 'cut', 'c-out'].includes(r.id)
          ? { ...r.samples, data: { ...r.samples.data, y: r.samples.data['y']!.map((y) => y + 10) } }
          : r.samples,
    })),
  });
  const config = {
    ...testConfig(),
    road,
    route: createRouteProgress(road, {
      ...fixture.route,
      branches: [{ id: 'cut', roads: ['c-in', 'cut', 'c-out'], traffic: 'road' }],
    }),
    riders: [],
    trafficTypes: [
      {
        contentId: 'base:car',
        category: 'car' as const,
        lengthM,
        widthM: 1.8,
        cruiseMps: 15,
        hazard: 'normal' as const,
      },
    ],
    tuning: { ...testConfig().tuning, 'traffic.density': 0 },
  };
  const world = createWorld(config);
  trafficSystem.init(world, config);
  const state = trafficState(world);
  return { config, world, state };
}

function queue(lengthM = 4.6, parallel = false) {
  const { config, world, state } = setup(lengthM, parallel);
  const { road } = config;
  const edge = road.edgeIndex('a');
  const lane = road.lanesAt(edge, 0).find((l) => l.kind === 'drive' && l.direction === 1)!;
  // Locate the real whole-body entry boundary; do not hard-code the compiler's junction shape.
  let entry = 0;
  while (
    entry < road.edges[edge]!.length &&
    junctionSpawnAllowed(config, { edge, s: entry, d: lane.dCenterM, dir: 1 }, lengthM, 1.8)
  )
    entry++;
  expect(entry).toBeGreaterThan(2 * lengthM);
  expect(entry).toBeLessThan(road.edges[edge]!.length);
  const rear = placeRoadVehicle(world, config, {
    type: 0,
    pos: { edge, s: entry - lengthM - 8, d: lane.dCenterM, dir: 1 },
    speed: 0,
  });
  junctionStops(world, config, state);
  const key = state.junctionReservation[rear]!;
  expect(key).not.toBe('');
  const front = placeRoadVehicle(world, config, {
    type: 0,
    pos: { edge, s: entry - 2, d: lane.dCenterM, dir: 1 },
    speed: 0,
  });
  state.junctionWait[front] = world.tick + 1;
  return { config, world, state, rear, front, key, entry };
}

describe('junction approach queues', () => {
  it.each([4.6, 16])(
    'releases a physical predecessor before a rear reservation holder (%s m bodies)',
    (lengthM) => {
      const { config, world, state, rear, front, key } = queue(lengthM);
      const stops = junctionStops(world, config, state);
      expect(stops[front], 'the rear holder must let its same-lane leader enter').toBe(Infinity);
      expect(stops[rear]).toBeLessThan(Infinity);
      expect(state.junctionReservation[front]).toBe(key);
      expect(state.junctionReservation[rear]).toBe('');
      const identities = state.id.map((id, k) => `${id}:${state.generation[k]}`);
      const start = world.movers[state.id[front]!]!.pos.edge;
      for (let tick = 0; tick < 60 * 40; tick++) {
        stepWorld(world, config, [trafficSystem], []);
        const leader = world.movers[state.id[front]!]!;
        const follower = world.movers[state.id[rear]!]!;
        if (leader.pos.edge === follower.pos.edge)
          expect(Math.abs(leader.pos.s - follower.pos.s)).toBeGreaterThanOrEqual(
            config.trafficTypes[0]!.lengthM,
          );
        const body = (m: typeof leader) => {
          const p = config.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, m.h);
          const f = config.road.frameAt(m.pos.edge, m.pos.s);
          return {
            ...p,
            tx: Math.cos(m.yaw) * f.tx - Math.sin(m.yaw) * f.tz,
            tz: Math.cos(m.yaw) * f.tz + Math.sin(m.yaw) * f.tx,
          };
        };
        const a = body(leader),
          b = body(follower);
        const overlap = [
          [a.tx, a.tz],
          [-a.tz, a.tx],
          [b.tx, b.tz],
          [-b.tz, b.tx],
        ].every(([x, z]) => {
          const radius = (p: typeof a) =>
            (lengthM / 2) * Math.abs(p.tx * x! + p.tz * z!) +
            (config.trafficTypes[0]!.widthM / 2) * Math.abs(-p.tz * x! + p.tx * z!);
          return Math.abs((a.x - b.x) * x! + (a.z - b.z) * z!) < radius(a) + radius(b) - 0.02;
        });
        expect(overlap, `whole bodies at tick ${world.tick}`).toBe(false);
      }
      expect(state.id.map((id, k) => `${id}:${state.generation[k]}`)).toEqual(identities);
      expect(world.movers[state.id[front]!]!.pos.edge).not.toBe(start);
      expect(world.movers[state.id[rear]!]!.pos.edge).not.toBe(start);
    },
  );

  it('keeps independent-lane reservation, wait-time and identity fairness deterministic', () => {
    const { config, world, state, rear, front, key } = queue(4.6, true);
    world.movers[state.id[front]!]!.pos.d = 5.1;
    // Same longitudinal predecessor, different physical lane: it does not hold up the owner.
    expect(junctionStops(world, config, state)[rear]).toBe(Infinity);
    expect(state.junctionReservation[rear]).toBe(key);
    expect(state.junctionWait[front]).toBeGreaterThanOrEqual(0);
    const decide = (rearWait: number, frontWait: number) => {
      state.junctionReservation.fill('');
      state.junctionWait[rear] = rearWait;
      state.junctionWait[front] = frontWait;
      const restored = structuredClone(world);
      expect(junctionStops(restored, config, trafficState(restored))).toEqual(
        junctionStops(world, config, state),
      );
      expect(worldHash(restored)).toBe(worldHash(world));
    };
    decide(20, 10);
    expect(state.junctionReservation[front]).toBe(key);
    decide(10, 20);
    expect(state.junctionReservation[rear]).toBe(key);
    decide(10, 10);
    expect(state.id[rear]).toBeLessThan(state.id[front]!);
    expect(state.junctionReservation[rear]).toBe(key);
  });

  it('lets a body already in the conflict surface clear even against the waiting direction', () => {
    const { config, world, state, rear, front } = queue();
    const car = world.movers[state.id[front]!]!;
    const edge = config.road.edges[car.pos.edge]!;
    placeRoadVehicle(
      world,
      config,
      {
        type: 0,
        pos: { edge: edge.index, s: edge.length - 1, d: -1.7, dir: -1 },
        speed: 0,
      },
      front,
    );
    car.pos.d = 1.7;
    expect(junctionSpawnAllowed(config, car.pos, 4.6, 1.8)).toBe(false);
    const stops = junctionStops(world, config, state);
    expect(stops[front]).toBe(Infinity);
    expect(stops[rear]).toBeLessThan(Infinity);
    expect(state.junctionWait[front]).toBeGreaterThanOrEqual(0);
  });

  it('does not confuse an opposing vehicle on the separate lane with a physical predecessor', () => {
    const { config, world, state, rear, front, key } = queue();
    const car = world.movers[state.id[front]!]!;
    placeRoadVehicle(
      world,
      config,
      {
        type: 0,
        pos: { ...car.pos, d: -1.7, dir: -1 },
        speed: 0,
      },
      front,
    );
    expect(junctionStops(world, config, state)[rear]).toBe(Infinity);
    expect(state.junctionReservation[rear]).toBe(key);
  });

  it('measures road-level overlap, excluding an elevated alternative above the same approach', () => {
    const { config, entry } = queue();
    const overpass = setup(4.6, false, true).config;
    const pos = { edge: config.road.edgeIndex('a'), s: entry, d: 1.7, dir: 1 as const };
    expect(junctionSpawnAllowed(config, pos, 4.6, 1.8)).toBe(false);
    expect(junctionSpawnAllowed(overpass, pos, 4.6, 1.8)).toBe(true);
  });
});
