import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedTerrain } from '../../road';
import { createSimWithWorld } from '../create';
import { quantizeInput } from '../api';
import { BIKE_HALF_WIDTH_M, riderState, touchdownOf } from './index';
import { testConfig } from './testing';
import { moveOnTerrain } from './terrain';
import { tumbleRecord } from '../tumble';

const edges = [{ id: 'a', lengthM: 300, kappa: 0, grade: 0.01 }];
const input = quantizeInput({ throttle: 0.5, brake: 0, steer: 0, flags: 0 });
const height = (x: number, z: number, slope: number) => 0.01 * -z + slope * (x - 5.5) - 0.06;

function terrainConfig(slope = 0.05, curvature = 0, outerX = 80, waterY?: number, rail = false) {
  const specs = edges.map((edge) => ({ ...edge, kappa: curvature }));
  const bundle = fixtureNetwork(specs);
  // The curved rider faces toward positive Z; keep the sustained movement probe on its authored field.
  const topZ = curvature ? 100 : 0;
  const vertices = [
    [5.48, topZ],
    [5.48, -300],
    [outerX, topZ],
    [outerX, -300],
  ].map(([x, z]) => [x!, height(x!, z!, slope), z!] as [number, number, number]);
  const terrain: BakedTerrain = {
    patches: [
      {
        surface: 'grass',
        vertices,
        triangles: [
          [0, 2, 1],
          [2, 3, 1],
        ],
      },
      ...(waterY === undefined
        ? []
        : [
            {
              surface: 'water' as const,
              vertices: [
                [outerX, waterY, 0],
                [outerX, waterY, -300],
                [80, waterY, 0],
                [80, waterY, -300],
              ] as [number, number, number][],
              triangles: [
                [0, 2, 1],
                [2, 3, 1],
              ] as [number, number, number][],
            },
          ]),
    ],
  };
  const road = createRoadNetwork({
    network: { ...bundle.network, terrain },
    roads: bundle.roads.map((r) => ({
      ...r,
      barriers: rail ? [{ s0: 0, s1: 300, side: 'right' as const, kind: 'rail' as const, heightM: 1 }] : [],
      laneSections: r.laneSections.map((section) => ({
        ...section,
        verges: {
          left: { widthM: 0.6, surface: 'grass' as const, edge: 'soft' as const },
          right: {
            widthM: 0.6,
            surface: 'grass' as const,
            edge: rail ? ('rail' as const) : ('soft' as const),
          },
        },
      })),
    })),
  });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 280 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return {
    ...testConfig({ edges: specs, tuning: { 'ground.offRoad': 1, 'riders.courseEdges': 1 } }),
    road,
    route,
  };
}

describe('riding authored physical terrain', () => {
  it('keeps the crashed mover at its actual body position on land below the reference road', () => {
    const config = terrainConfig(-0.05);
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    me.pos.s = 100;
    me.pos.d = 12;
    me.mode = 'Airborne';
    const p = config.road.toWorld(0, 100, 12, 0);
    me.h = height(p.x, p.z, -0.05) + 0.03 - p.y;
    riderState(world).yAbs[me.id] = p.y + me.h;
    riderState(world).vy[me.id] = -30;
    sim.step([input]);
    expect(me.mode).toBe('Tumble');
    // The crash creates its bodies; the following simulation step advances their mover reference.
    sim.step([input]);
    const current = sim.snapshot().entities.find((e) => e.id === me.id)!;
    expect(current.mode).toBe('Tumble');
    const body = tumbleRecord(world, me.id)!.rider;
    expect(current.x).toBeCloseTo(body.x, 3);
    expect(current.y).toBeCloseTo(body.y, 5);
    expect(current.z).toBeCloseTo(body.z, 3);
    expect(current.road.d).toBeGreaterThan(10);
  });

  it.each([false, true])(
    'travels over the field beyond a real rail without being pulled back (air %s)',
    (air) => {
      const config = terrainConfig(0.05, 0, 80, undefined, true);
      const { sim, world } = createSimWithWorld(config);
      const me = world.movers.find((m) => m.kind === 'rider')!;
      me.pos.s = 100;
      me.pos.d = 12;
      me.speed = 10;
      const p = config.road.toWorld(0, 100, 12, 0);
      me.h = height(p.x, p.z, 0.05) - p.y + (air ? 0.3 : 0);
      if (air) me.mode = 'Airborne';
      riderState(world).yAbs[me.id] = p.y + me.h;
      for (let tick = 0; tick < 30; tick++) {
        sim.step([input]);
        expect(me.pos.d).toBeCloseTo(12, 4);
        expect(['Road', 'Airborne']).toContain(me.mode);
        expect(
          sim.events().filter((e) => e.actor === me.id && ['crash', 'wobble', 'jump'].includes(e.type)),
        ).toEqual([]);
      }
    },
  );

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('meets a real rail on the side it approached from (outside %s, air %s)', (outside, air) => {
    const config = terrainConfig(0.05, 0, 80, undefined, true);
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    const line = config.road.vergeAt(0, 100, 'right').dOuter;
    me.pos.s = 100;
    me.pos.d = line + (outside ? BIKE_HALF_WIDTH_M + 0.01 : -BIKE_HALF_WIDTH_M - 0.01);
    me.yaw = outside ? -0.5 : 0.5;
    me.speed = 10;
    const p = config.road.toWorld(0, 100, me.pos.d, 0);
    me.h = (outside ? height(p.x, p.z, 0.05) - p.y : 0) + (air ? 0.3 : 0);
    if (air) me.mode = 'Airborne';
    riderState(world).yAbs[me.id] = p.y + me.h;
    let contact = false;
    for (let tick = 0; tick < 15; tick++) {
      sim.step([input]);
      contact ||= sim.events().some((e) => e.actor === me.id && e.type === 'wobble');
      if (outside) expect(me.pos.d).toBeGreaterThanOrEqual(line + BIKE_HALF_WIDTH_M - 1e-6);
      else expect(me.pos.d).toBeLessThanOrEqual(line - BIKE_HALF_WIDTH_M + 1e-6);
      expect(sim.events().filter((e) => e.actor === me.id && e.type === 'crash')).toEqual([]);
    }
    expect(contact).toBe(true);
  });

  it('recognizes the actual water surface when riding beyond a field', () => {
    const config = terrainConfig(0.5, 0, 12, 2.5);
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    me.pos.s = 100;
    me.pos.d = 11.99;
    me.yaw = 0.5;
    me.speed = 10;
    const p = config.road.toWorld(0, 100, me.pos.d, 0);
    me.h = height(p.x, p.z, 0.5) - p.y;
    riderState(world).yAbs[me.id] = p.y + me.h;
    sim.step([input]);
    const crashes = sim.events().filter((e) => e.actor === me.id && e.type === 'crash');
    expect(crashes).toHaveLength(1);
    expect(crashes[0]!.data.past).toBe('water');
    expect(crashes[0]!.data.floorY).toBe(2.5);
    const current = sim.snapshot().entities.find((e) => e.id === me.id)!;
    expect(current.floorY).toBe(2.5);
    expect(sim.events().filter((e) => e.actor === me.id && e.type === 'jump')).toEqual([]);
  });

  it.each([1, -1] as const)('preserves world distance across a linked edge (direction %s)', (dir) => {
    const road = createRoadNetwork(
      fixtureNetwork([
        { id: 'a', lengthM: 30, kappa: 0 },
        { id: 'b', lengthM: 30, kappa: 0 },
      ]),
    );
    const pos = { edge: dir === 1 ? 0 : 1, s: dir === 1 ? 29.95 : 0.05, d: 12, dir };
    const before = road.toWorld(pos.edge, pos.s, pos.d, 0);
    const yaw = moveOnTerrain(road, pos, 0, 0.2, 0);
    const after = road.toWorld(pos.edge, pos.s, pos.d, 0);
    expect(pos.edge).toBe(dir === 1 ? 1 : 0);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeCloseTo(0.2, 8);
    expect(yaw).toBeCloseTo(0, 8);
  });

  it('resets once at missing ground without first teleporting onto the road plane or launching', () => {
    const config = terrainConfig(0.5, 0, 12);
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    me.pos.s = 100;
    me.pos.d = 11.99;
    me.yaw = 0.5;
    me.speed = 10;
    const p = config.road.toWorld(0, 100, me.pos.d, 0);
    const feet = height(p.x, p.z, 0.5);
    me.h = feet - p.y;
    riderState(world).yAbs[me.id] = feet;
    sim.step([input]);
    const crashes = sim.events().filter((e) => e.actor === me.id && e.type === 'crash');
    expect(crashes).toHaveLength(1);
    expect(crashes[0]!.data.floorY).toBeCloseTo(feet, 2);
    expect(sim.events().filter((e) => e.actor === me.id && e.type === 'jump')).toEqual([]);
  });

  it('flies in world metres over the inside of a bend, including below its reference road', () => {
    const config = terrainConfig(-0.5, 0.05);
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    me.pos.s = 40;
    me.pos.d = 19.8;
    me.speed = 6;
    me.mode = 'Airborne';
    const before = config.road.toWorld(0, me.pos.s, me.pos.d, 0);
    me.h = height(before.x, before.z, -0.5) + 1 - before.y;
    riderState(world).yAbs[me.id] = before.y + me.h;
    riderState(world).vy[me.id] = 0;
    sim.step([input]);
    const after = sim.snapshot().entities.find((e) => e.id === me.id)!;
    expect(after.mode).toBe('Airborne');
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeCloseTo(after.speed / 60, 3);
    expect(sim.events().filter((e) => e.actor === me.id && e.type === 'crash')).toEqual([]);
    const forecast = touchdownOf(world, config, me);
    expect(forecast).not.toBeNull();
    expect(forecast!.y).toBeCloseTo(height(forecast!.x, forecast!.z, -0.5), 3);
  });

  it('keeps world travel speed near the inside centre of a tight road bend', () => {
    const config = terrainConfig(0.05, 0.05);
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    me.pos.s = 40;
    me.pos.d = 19.8;
    me.speed = 6;
    let before = config.road.toWorld(0, me.pos.s, me.pos.d, 0);
    me.h = height(before.x, before.z, 0.05) - before.y;
    riderState(world).yAbs[me.id] = before.y + me.h;
    const heading = sim.snapshot().entities.find((e) => e.id === me.id)!.heading;
    for (let tick = 0; tick < 60; tick++) {
      sim.step([input]);
      const after = sim.snapshot().entities.find((e) => e.id === me.id)!;
      expect(after.mode).toBe('Road');
      expect(sim.events().filter((e) => e.type === 'finish' || e.type === 'crash')).toEqual([]);
      expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeCloseTo(after.speed / 60, 3);
      expect(after.heading).toBeCloseTo(heading, 5);
      before = { x: after.x, y: after.y, z: after.z };
    }
  });

  it.each([true, false])('crosses the road/grass join without a false launch (outward %s)', (outward) => {
    const config = terrainConfig();
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    me.pos.s = 100;
    me.pos.d = outward ? 5.3 : 5.7;
    me.speed = 10;
    me.yaw = outward ? 0.35 : -0.35;
    const p = config.road.toWorld(0, 100, me.pos.d, 0);
    me.h = outward ? 0 : height(p.x, p.z, 0.05) - p.y;
    riderState(world).yAbs[me.id] = p.y + me.h;
    let crossed = false;
    for (let tick = 0; tick < 90; tick++) {
      sim.step([input]);
      crossed ||= outward ? me.pos.d > 5.5 : me.pos.d < 5.5;
      expect(me.mode).toBe('Road');
      expect(
        sim.events().filter((e) => e.actor === me.id && (e.type === 'jump' || e.type === 'crash')),
      ).toEqual([]);
    }
    expect(crossed).toBe(true);
  });

  it.each([0.05, -0.05])(
    'follows real ground above or below the reference road (cross-slope %s)',
    (slope) => {
      const config = terrainConfig(slope);
      const { sim, world } = createSimWithWorld(config);
      const me = world.movers.find((m) => m.kind === 'rider')!;
      me.pos.s = 100;
      me.pos.d = 12;
      me.speed = 12;
      const p = config.road.toWorld(0, 100, 12, 0);
      me.h = height(p.x, p.z, slope) - p.y;
      riderState(world).yAbs[me.id] = p.y + me.h;
      for (let tick = 0; tick < 90; tick++) {
        sim.step([input]);
        const current = sim.snapshot().entities.find((e) => e.id === me.id)!;
        expect(current.mode).toBe('Road');
        expect(current.grounded).toBe(true);
        expect(current.ground).toBe('grass');
        expect(current.y).toBeCloseTo(height(current.x, current.z, slope), 4);
        expect(current.pitch).toBeCloseTo(Math.atan(0.01), 4);
        expect(
          sim.events().filter((e) => e.actor === me.id && (e.type === 'crash' || e.type === 'jump')),
        ).toEqual([]);
      }
    },
  );

  it('forecasts and lands on the same sloped grass outside the road band', () => {
    const config = terrainConfig();
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    me.pos.s = 100;
    me.pos.d = 12;
    me.speed = 12;
    me.mode = 'Airborne';
    me.h = 2;
    const st = riderState(world);
    st.yAbs[me.id] = config.road.surfaceHeight(0, 100, 12) + me.h;
    st.vy[me.id] = -1;
    const forecast = touchdownOf(world, config, me);
    expect(forecast).not.toBeNull();
    expect(forecast!.y).toBeCloseTo(height(forecast!.x, forecast!.z, 0.05), 3);
    let landed = false;
    for (let tick = 0; tick < 180 && !landed; tick++) {
      sim.step([input]);
      landed = sim.events().some((e) => e.actor === me.id && e.type === 'land');
      expect(sim.events().filter((e) => e.actor === me.id && e.type === 'crash')).toEqual([]);
    }
    expect(landed).toBe(true);
    const current = sim.snapshot().entities.find((e) => e.id === me.id)!;
    expect(current.grounded).toBe(true);
    expect(current.y).toBeCloseTo(height(current.x, current.z, 0.05), 4);
  });
});
