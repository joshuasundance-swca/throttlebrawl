import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  planStructures,
  type BakedTerrain,
  type BakedFeature,
  type BakedTerrainPatch,
} from '../../road';
import { createSimWithWorld } from '../create';
import { quantizeInput } from '../api';
import { BIKE_HALF_WIDTH_M, riderState, touchdownOf } from './index';
import { testConfig } from './testing';
import { moveOnTerrain } from './step';
import { tumbleRecord } from '../tumble';
import { deckHeight, RAMP_TRUCK_LENGTH_M, RAMP_TRUCK_LIP_M } from './features';
import { supportKeyOf } from './supports';

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

function supportEndConfig(
  courseEdges: number,
  water: boolean,
  features: BakedFeature[] = [],
  authored = true,
  neighbour = false,
  extraTerrain: BakedTerrainPatch[] = [],
) {
  const specs = (neighbour ? ['a', 'b'] : ['a']).map((id) => ({ id, lengthM: 300, kappa: 0 }));
  const bundle = fixtureNetwork(specs);
  const rect = (z0: number, z1: number, y: number, surface: 'grass' | 'water') => ({
    surface,
    vertices: [
      [5.48, y, z0],
      [5.48, y, z1],
      [30, y, z0],
      [30, y, z1],
    ] as [number, number, number][],
    triangles: [
      [0, 2, 1],
      [2, 3, 1],
    ] as [number, number, number][],
  });
  const config = {
    ...testConfig({
      edges: specs,
      tuning: { 'ground.offRoad': 1, 'riders.courseEdges': courseEdges },
    }),
    road: createRoadNetwork({
      ...bundle,
      roads: bundle.roads.map((r) => ({
        ...r,
        features,
        ...(r.id === 'b'
          ? {
              samples: {
                ...r.samples,
                data: {
                  ...r.samples.data,
                  x: r.samples.data['x']!.map((v) => v + 12),
                  y: r.samples.data['y']!.map(() => -0.44),
                  z: r.samples.data['z']!.map((v) => v + 300),
                },
              },
            }
          : {}),
      })),
      network: {
        ...bundle.network,
        ...(authored
          ? {
              terrain: {
                patches: [
                  rect(0, -100, -0.44, 'grass'),
                  ...(water ? [rect(-100, -300, -5, 'water')] : []),
                  ...extraTerrain,
                ],
              },
            }
          : {}),
      },
    }),
  };
  return config;
}

describe('riding authored physical terrain', () => {
  it.each(['road', 'raised land'] as const)('a fall cannot reenter %s from beneath its floor', (kind) => {
    const raised: BakedTerrainPatch = {
      surface: 'grass',
      vertices: [
        [5.48, 0.5, -101],
        [5.48, 0.5, -300],
        [30, 0.5, -101],
        [30, 0.5, -300],
      ],
      triangles: [
        [0, 2, 1],
        [2, 3, 1],
      ],
    };
    const config = supportEndConfig(0, true, [], true, false, kind === 'raised land' ? [raised] : []);
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    me.pos.s = kind === 'road' ? 102 : 100.8;
    me.pos.d = kind === 'road' ? 5.8 : 12;
    me.speed = 36;
    me.yaw = kind === 'road' ? -0.8 : 0;
    me.mode = 'Airborne';
    me.h = -1;
    const st = riderState(world);
    st.yAbs[me.id] = -1;
    st.vy[me.id] = -2;
    let crashed = false;
    for (let tick = 0; tick < 120 && !crashed; tick++) {
      const before = sim.snapshot().entities.find((e) => e.id === me.id)!.y;
      sim.step([input]);
      expect(sim.events().filter((e) => e.type === 'land')).toEqual([]);
      expect(sim.snapshot().entities.find((e) => e.id === me.id)!.y).toBeLessThanOrEqual(before);
      crashed = sim.events().some((e) => e.type === 'crash');
    }
    expect(crashed).toBe(true);
  });

  it('lands from above on real dry terrain beneath an overhead reference road and keeps that floor', () => {
    const lower: BakedTerrainPatch = {
      surface: 'grass',
      vertices: [
        [-40, -2, 0],
        [-40, -2, -300],
        [40, -2, 0],
        [40, -2, -300],
      ],
      triangles: [
        [0, 2, 1],
        [2, 3, 1],
      ],
    };
    const config = supportEndConfig(0, true, [], true, false, [lower]);
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    me.pos.s = 102;
    me.pos.d = 0;
    me.speed = 1;
    me.mode = 'Airborne';
    me.h = -1.97;
    const st = riderState(world);
    st.yAbs[me.id] = me.h;
    st.vy[me.id] = -2;
    expect(sim.snapshot().entities.find((e) => e.id === me.id)!.floorY).toBe(-2);
    expect(touchdownOf(world, config, me)?.y).toBeCloseTo(-2, 5);
    let landed = false;
    for (let tick = 0; tick < 4; tick++) {
      sim.step([input]);
      landed ||= sim.events().some((e) => e.type === 'land');
      expect(sim.snapshot().entities.find((e) => e.id === me.id)!.y).toBeCloseTo(-2, 5);
      expect(me.mode).toBe('Road');
      expect(sim.events().filter((e) => e.type === 'crash')).toEqual([]);
    }
    expect(landed).toBe(true);
  });

  it.each(['road', 'raised land'] as const)('still lands from above on %s', (kind) => {
    const raised: BakedTerrainPatch = {
      surface: 'grass',
      vertices: [
        [5.48, 0.5, -101],
        [5.48, 0.5, -300],
        [30, 0.5, -101],
        [30, 0.5, -300],
      ],
      triangles: [
        [0, 2, 1],
        [2, 3, 1],
      ],
    };
    const config = supportEndConfig(0, true, [], true, false, kind === 'raised land' ? [raised] : []);
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    const floor = kind === 'road' ? 0 : 0.5;
    me.pos.s = 102;
    me.pos.d = kind === 'road' ? 0 : 12;
    me.speed = 1;
    me.mode = 'Airborne';
    me.h = floor + 0.03;
    riderState(world).yAbs[me.id] = me.h;
    riderState(world).vy[me.id] = -2;
    sim.step([input]);
    expect(sim.events().filter((e) => e.type === 'land')).toHaveLength(1);
    expect(sim.events().filter((e) => e.type === 'crash')).toEqual([]);
    expect(me.mode).toBe('Road');
    expect(sim.snapshot().entities.find((e) => e.id === me.id)!.y).toBeCloseTo(floor, 5);
  });

  it.each(
    [0, 1].flatMap((courseEdges) =>
      ['supported', 'tiny', 'disabled'].map((kind) => [courseEdges, kind] as const),
    ),
  )(
    'source land meets a %s-course-edge level top with support %s and keeps real feet',
    (courseEdges, kind) => {
      const base = supportEndConfig(courseEdges, true, [
        { kind: 'billboard', id: 'platform', s0: 100, s1: 120, d0: 10, d1: 14 },
      ]);
      const config = { ...base, tuning: { ...base.tuning, 'riders.supports': kind === 'disabled' ? 0 : 1 } };
      planStructures(
        config.road,
        config.seed,
        {
          fixture: {
            plan: (_road, _seed, out) =>
              out.add({
                rule: 'level-source-support',
                cls: 'building',
                model: null,
                edge: 0,
                s: 110,
                d: 10,
                foot: { x: 12, z: -110, ux: 0, uz: -1, hu: 10, hv: kind === 'tiny' ? 0.1 : 2 },
                baseY: -1,
                roof: { kind: 'flat', topM: 0.56 },
              }),
          },
        },
        { fixture: { features: ['billboard'], load: () => Promise.reject(new Error('planned here')) } },
      );
      const { sim, world } = createSimWithWorld(config);
      const me = world.movers.find((m) => m.kind === 'rider')!;
      me.pos.s = 99.8;
      me.pos.d = 12;
      me.speed = 36;
      me.h = -0.44;
      riderState(world).yAbs[me.id] = me.h;
      sim.step([input]);
      if (kind === 'supported') {
        expect(me.mode).toBe('Road');
        expect(sim.snapshot().entities.find((e) => e.id === me.id)!.y).toBeCloseTo(-0.44, 5);
        expect(supportKeyOf(world, me.id)).toMatch(/^s:/);
        expect(sim.events().filter((e) => e.type === 'crash' || e.type === 'jump')).toEqual([]);
      } else {
        expect(me.mode).toBe('Airborne');
        expect(supportKeyOf(world, me.id)).toBe('');
        expect(sim.snapshot().entities.find((e) => e.id === me.id)!.y).toBeLessThan(-0.44);
        for (let tick = 0; tick < 4; tick++) {
          const before = sim.snapshot().entities.find((e) => e.id === me.id)!.y;
          sim.step([input]);
          expect(me.mode).not.toBe('Road');
          expect(sim.snapshot().entities.find((e) => e.id === me.id)!.y).toBeLessThanOrEqual(before);
          expect(sim.events().filter((e) => e.type === 'land')).toEqual([]);
          expect(supportKeyOf(world, me.id)).toBe('');
        }
      }
    },
  );

  it.each([0, 1])(
    'accepts an allowed adjacent road instead of treating its surface as source loss (course edges %s)',
    (courseEdges) => {
      const config = supportEndConfig(courseEdges, true, [], true, true);
      const { sim, world } = createSimWithWorld(config);
      const me = world.movers.find((m) => m.kind === 'rider')!;
      me.pos.s = 99.8;
      me.pos.d = 12;
      me.speed = 36;
      me.h = -0.44;
      riderState(world).yAbs[me.id] = me.h;
      sim.step([input]);
      expect(me.pos.edge).toBe(1);
      expect(me.mode).toBe('Road');
      expect(sim.snapshot().entities.find((e) => e.id === me.id)!.y).toBeCloseTo(-0.44, 5);
      expect(sim.events().filter((e) => e.type === 'crash' || e.type === 'jump')).toEqual([]);
    },
  );

  it.each([0, 1])(
    'retains real height when dry terrain ends at water or missing coverage (course edges %s)',
    (courseEdges) => {
      for (const water of [false, true]) {
        const config = supportEndConfig(courseEdges, water);
        const { sim, world } = createSimWithWorld(config);
        const me = world.movers.find((m) => m.kind === 'rider')!;
        me.pos.s = 99.8;
        me.pos.d = 12;
        me.speed = 36;
        me.yaw = 0;
        me.h = -0.44;
        const st = riderState(world);
        st.yAbs[me.id] = me.h;
        const before = sim.snapshot().entities.find((e) => e.id === me.id)!;
        sim.step([input]);
        const current = sim.snapshot().entities.find((e) => e.id === me.id)!;
        expect(current.y, `water ${water}`).toBeLessThanOrEqual(before.y + 1e-6);
        expect(st.vy[me.id] ?? 0, `water ${water}`).toBeLessThanOrEqual(0);
        expect(sim.events().filter((e) => e.type === 'land')).toEqual([]);
        const crashes = sim.events().filter((e) => e.actor === me.id && e.type === 'crash');
        if (courseEdges) {
          expect(crashes).toHaveLength(1);
          expect(crashes[0]!.data.past).toBe(water ? 'water' : 'ground');
          expect(crashes[0]!.data.floorY).toBeCloseTo(water ? -5 : before.y, 5);
          expect(sim.events().filter((e) => e.type === 'jump')).toEqual([]);
        } else {
          expect(current.mode).toBe('Airborne');
          expect(crashes).toEqual([]);
          const jumps = sim.events().filter((e) => e.type === 'jump');
          expect(jumps).toHaveLength(1);
          expect(jumps[0]!.data.vyMps).toBe(0);
          // The next flight tick must also retain its real floor, rather than landing on the
          // extrapolated road or being clamped upward onto the old course band.
          sim.step([input]);
          const next = sim.snapshot().entities.find((e) => e.id === me.id)!;
          expect(next.y).toBeLessThan(current.y);
          expect(next.mode).toBe('Airborne');
          expect(sim.events().filter((e) => e.type === 'land' || e.type === 'crash')).toEqual([]);
          let physicalCrash = false;
          for (let tick = 0; tick < 120 && !physicalCrash; tick++) {
            sim.step([input]);
            expect(sim.events().filter((e) => e.type === 'land')).toEqual([]);
            physicalCrash = sim.events().some((e) => e.type === 'crash');
          }
          expect(physicalCrash, `eventual physical fall, water ${water}`).toBe(true);
        }
      }
    },
  );

  it.each([-2, 0.5])(
    'inherits real vertical velocity %s at support loss instead of a road-plane impulse',
    (vy) => {
      const config = supportEndConfig(0, true);
      const { sim, world } = createSimWithWorld(config);
      const me = world.movers.find((m) => m.kind === 'rider')!;
      me.pos.s = 99.8;
      me.pos.d = 12;
      me.speed = 36;
      me.h = -0.44;
      const st = riderState(world);
      st.yAbs[me.id] = me.h;
      st.vy[me.id] = vy;
      st.lastTick[me.id] = world.tick - 1;
      sim.step([input]);
      expect(me.mode).toBe('Airborne');
      expect(sim.events().find((e) => e.type === 'jump')?.data.vyMps).toBe(vy);
      expect(st.vy[me.id]).toBeLessThan(vy);
      expect(st.yAbs[me.id]).toBeLessThan(-0.44 + vy / 60);
    },
  );

  it.each([0, 1])(
    'an existing flight over a source void never lands on the reference plane (course edges %s)',
    (courseEdges) => {
      for (const water of [false, true]) {
        const config = supportEndConfig(courseEdges, water);
        const { sim, world } = createSimWithWorld(config);
        const me = world.movers.find((m) => m.kind === 'rider')!;
        me.pos.s = 100.2;
        me.pos.d = 12;
        me.speed = 36;
        me.mode = 'Airborne';
        me.h = -0.44;
        const st = riderState(world);
        st.yAbs[me.id] = me.h;
        st.vy[me.id] = -2;
        let crashed = false;
        for (let tick = 0; tick < 120 && !crashed; tick++) {
          const before = sim.snapshot().entities.find((e) => e.id === me.id)!.y;
          sim.step([input]);
          expect(sim.snapshot().entities.find((e) => e.id === me.id)!.y).toBeLessThanOrEqual(before);
          expect(sim.events().filter((e) => e.type === 'land' || e.type === 'jump')).toEqual([]);
          const crash = sim.events().find((e) => e.actor === me.id && e.type === 'crash');
          crashed = crash !== undefined;
          if (crash && !water) expect(crash.data.floorY).toBeLessThan(0);
          if (crash && water) expect(crash.data.floorY).toBe(-5);
        }
        expect(crashed).toBe(true);
      }
    },
  );

  it.each([0, 1])(
    'keeps real rail contacts at a source void and clears only its actual top (course edges %s)',
    (courseEdges) => {
      for (const [air, clear] of [
        [false, false],
        [true, false],
        [true, true],
      ]) {
        const base = terrainConfig(-0.05, 0, 5.5, -5, true);
        const config = { ...base, tuning: { ...base.tuning, 'riders.courseEdges': courseEdges } };
        const { sim, world } = createSimWithWorld(config);
        const me = world.movers.find((m) => m.kind === 'rider')!;
        const line = config.road.vergeAt(0, 100, 'right').dOuter;
        me.pos.s = 100;
        me.pos.d = line - BIKE_HALF_WIDTH_M - 0.01;
        me.speed = 60;
        me.yaw = 1;
        me.h = air ? (clear ? 2 : 0.5) : 0;
        me.mode = air ? 'Airborne' : 'Road';
        riderState(world).yAbs[me.id] = config.road.surfaceHeight(0, 100, me.pos.d) + me.h;
        riderState(world).vy[me.id] = 0;
        sim.step([input]);
        const contacts = sim
          .events()
          .filter((e) => e.actor === me.id && (e.type === 'wobble' || e.type === 'crash'));
        if (clear) {
          expect(contacts).toEqual([]);
          expect(me.mode).toBe('Airborne');
          expect(me.pos.d).toBeGreaterThan(line);
        } else {
          expect(contacts.length).toBeGreaterThan(0);
          expect(me.pos.d).toBeLessThanOrEqual(line - BIKE_HALF_WIDTH_M + 1e-6);
        }
      }
    },
  );

  it.each([0, 1])(
    'keeps real road, carrier ramp/deck and legacy support (course edges %s)',
    (courseEdges) => {
      const carrier: BakedFeature = {
        kind: 'rampTruck',
        id: 'physical-carrier',
        s0: 90,
        s1: 112,
        d0: 10,
        d1: 14,
        params: { rampLengthM: RAMP_TRUCK_LENGTH_M, lipHeightM: RAMP_TRUCK_LIP_M },
      };
      for (const kind of ['road', 'ramp', 'deck', 'legacy'] as const) {
        const config = supportEndConfig(
          courseEdges,
          true,
          kind === 'ramp' || kind === 'deck' ? [{ ...carrier, d0: -2, d1: 2 }] : [],
          kind !== 'legacy',
        );
        const { sim, world } = createSimWithWorld(config);
        const me = world.movers.find((m) => m.kind === 'rider')!;
        me.pos.s = kind === 'ramp' ? 96 : 103;
        me.pos.d = 0;
        me.speed = 1;
        const floor = kind === 'ramp' || kind === 'deck' ? deckHeight(config, 0, me.pos.s, me.pos.d) : 0;
        expect(floor, kind).toBeGreaterThanOrEqual(0);
        if (kind === 'ramp' || kind === 'deck') expect(floor).toBeGreaterThan(0);
        me.mode = kind === 'deck' ? 'Airborne' : 'Road';
        me.h = floor + (kind === 'deck' ? 0.03 : 0);
        const st = riderState(world);
        st.yAbs[me.id] = me.h;
        st.vy[me.id] = kind === 'deck' ? -2 : 0;
        let landed = false;
        for (let tick = 0; tick < 4; tick++) {
          sim.step([input]);
          landed ||= sim.events().some((e) => e.type === 'land');
          expect(
            sim.events().filter((e) => e.type === 'crash'),
            kind,
          ).toEqual([]);
        }
        expect(me.mode, kind).toBe('Road');
        if (kind === 'deck') expect(landed).toBe(true);
        expect(st.yAbs[me.id], kind).toBeCloseTo(
          kind === 'ramp' || kind === 'deck' ? deckHeight(config, 0, me.pos.s, me.pos.d) : 0,
          5,
        );
      }
    },
  );

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
