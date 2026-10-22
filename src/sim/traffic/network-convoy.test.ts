import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureBranchNetwork } from '../../road';
import { SIM_TUNING } from '../create';
import { testConfig } from '../riders/testing';
import type { SimTrafficTypeDef } from '../types';
import { addMover, createWorld, stepWorld, worldHash, type Mover } from '../world';
import { capPerDirection, densityFor, IDM, TRAFFIC, trafficState, trafficSystem } from './index';
import { populateNetwork } from './network-population';
import { placeRoadVehicle } from './path-view';
import { networkTrafficEnabled } from './vehicle-control';

// A supported slow convoy configuration, rather than a claim about a shipped traffic type.
const SLOW = {
  contentId: 'base:test-slow-convoy',
  category: 'rv',
  lengthM: 9,
  widthM: 2.5,
  cruiseMps: 5,
  hazard: 'big',
  behaviour: { convoy: 4 },
} satisfies SimTrafficTypeDef;

function fixture(convoy = true, kappa = 0, lengthM = 3000) {
  const config = testConfig({ edges: [{ id: 'a', lengthM, kappa }] });
  config.trafficTypes = [{ ...SLOW, behaviour: { convoy: convoy ? SLOW.behaviour.convoy : 1 } }];
  config.tuning = {
    ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
    'traffic.density': 0,
    'traffic.densityOncoming': 0,
  };
  const world = createWorld(config);
  addMover(world, 'rider', { edge: 0, s: lengthM / 2, d: 1.7, dir: 1 }, 0);
  trafficSystem.init(world, config);
  world.params['traffic.density'] = 2;
  return { config, world, st: trafficState(world) };
}

function closePairs(f: ReturnType<typeof fixture>, toleranceM = 1e-6) {
  const { world, st } = f;
  const pairs: [number, number][] = [];
  for (let a = 0; a < st.id.length; a++)
    for (let b = a + 1; b < st.id.length; b++) {
      const ma = world.movers[st.id[a]!]!;
      const mb = world.movers[st.id[b]!]!;
      if (ma.pos.edge !== mb.pos.edge || ma.pos.dir !== mb.pos.dir || ma.pos.d !== mb.pos.d) continue;
      if (st.type[a] !== st.type[b]) continue;
      const type = f.config.trafficTypes[st.type[a]!]!;
      const step = type.lengthM + IDM.minGapM + st.v0[a]! * IDM.timeGapS + TRAFFIC.convoyExtraGapM;
      if (Math.abs(Math.abs(ma.pos.s - mb.pos.s) - step) < toleranceM && st.v0[a] === st.v0[b])
        pairs.push([a, b]);
    }
  return pairs;
}

function distance(f: ReturnType<typeof fixture>, a: Mover, b: Mover) {
  const pa = f.config.road.toWorld(a.pos.edge, a.pos.s, a.pos.d, a.h);
  const pb = f.config.road.toWorld(b.pos.edge, b.pos.s, b.pos.d, b.h);
  return Math.hypot(pa.x - pb.x, pa.z - pb.z);
}

function clearBodiesAndRiders(f: ReturnType<typeof fixture>) {
  const cars = f.st.id.map((id) => f.world.movers[id]!);
  for (const [a, car] of cars.entries()) {
    for (const rider of f.world.movers.filter((m) => m.kind === 'rider'))
      expect(distance(f, car, rider)).toBeGreaterThanOrEqual(f.st.reactionM - 1e-6);
    for (const other of cars.slice(a + 1))
      // Disjoint bounding circles also prove disjoint oriented bodies on a bend.
      expect(distance(f, car, other)).toBeGreaterThanOrEqual(
        Math.hypot(SLOW.lengthM, SLOW.widthM) + IDM.minGapM - 1e-6,
      );
  }
}

function firstGroup() {
  const baseline = fixture();
  populateNetwork(baseline.world, baseline.config, baseline.st, true);
  const pair = closePairs(baseline)[0];
  expect(pair).toBeDefined();
  const leader = baseline.world.movers[baseline.st.id[pair![0]]!]!;
  const follower = baseline.world.movers[baseline.st.id[pair![1]]!]!;
  return {
    leader: { ...leader.pos },
    follower: { ...follower.pos },
    step: Math.abs(leader.pos.s - follower.pos.s),
  };
}

describe('network population convoy clearance', () => {
  it('groups the authored PNW motorhome through the network-enabled traffic system', () => {
    const authored = Object.values(
      import.meta.glob<Omit<SimTrafficTypeDef, 'contentId'> & { id: string }>(
        '/packs/region-pnw/traffic/motorhome.json',
        {
          eager: true,
          import: 'default',
        },
      ),
    )[0]!;
    expect(authored.behaviour?.convoy).toBeGreaterThan(1);
    const run = (convoy: boolean) => {
      const bundle = fixtureBranchNetwork();
      const road = createRoadNetwork({
        ...bundle,
        roads: bundle.roads.map((r) => ({
          ...r,
          features: [],
          laneSections: r.laneSections.map((section) => ({
            ...section,
            lanes: section.lanes.map((lane) =>
              lane.kind === 'shortcut' ? { ...lane, kind: 'drive' as const } : lane,
            ),
          })),
        })),
      });
      const config = testConfig();
      config.road = road;
      config.route = createRouteProgress(road, {
        ...bundle.route,
        branches: [{ id: 'cut', roads: ['c-in', 'cut', 'c-out'], traffic: 'road' }],
      });
      config.trafficTypes = [
        {
          ...authored,
          contentId: `region-pnw:${authored.id}`,
          behaviour: convoy ? { ...authored.behaviour } : { ...authored.behaviour, convoy: 1 },
        },
      ];
      config.tuning = {
        ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
        'traffic.density': 2,
        'traffic.densityOncoming': 0,
      };
      const world = createWorld(config);
      addMover(world, 'rider', { edge: road.edgeIndex('cut'), s: 100, d: 8, dir: 1 }, 0);
      expect(networkTrafficEnabled(config)).toBe(true);
      trafficSystem.init(world, config);
      const st = trafficState(world);
      expect(st.spawns).toBe(0);
      stepWorld(world, config, [trafficSystem], []);
      expect(st.spawns).toBeGreaterThan(0);
      expect(st.paths.every((path) => path !== undefined)).toBe(true);
      // Population precedes one sim tick of motion. Equal initial group speeds can change
      // relative separation only by the bounded acceleration/braking during that tick.
      const toleranceM = (IDM.maxDecelMps2 + IDM.accelMps2) / (60 * 60) + 1e-6;
      return closePairs({ config, world, st }, toleranceM);
    };
    expect(run(true).length).toBeGreaterThan(0);
    expect(run(false)).toEqual([]);
  });

  it('places slow same-lane followers at their safe authored group headway', () => {
    const f = fixture();
    populateNetwork(f.world, f.config, f.st, true);
    expect(f.st.id.length).toBeGreaterThan(1);
    expect(f.st.paths.every((p) => p !== undefined)).toBe(true);
    expect(closePairs(f).length).toBeGreaterThan(0);
    clearBodiesAndRiders(f);
  });

  it('keeps ordinary spawn clearance when the convoy flag is off', () => {
    const f = fixture(false);
    populateNetwork(f.world, f.config, f.st, true);
    expect(f.st.id.length).toBeGreaterThan(1);
    expect(closePairs(f)).toEqual([]);
    for (const [a, id] of f.st.id.entries())
      for (const otherId of f.st.id.slice(a + 1))
        expect(distance(f, f.world.movers[id]!, f.world.movers[otherId]!)).toBeGreaterThanOrEqual(
          SLOW.lengthM + TRAFFIC.spawnGapM - 1e-6,
        );
  });

  it('refuses a follower near an unrelated vehicle of the same convoy type', () => {
    const { leader, follower, step } = firstGroup();
    const f = fixture();
    const blocker = placeRoadVehicle(f.world, f.config, {
      type: 0,
      pos: { ...follower, s: follower.s - follower.dir * (SLOW.lengthM + TRAFFIC.spawnGapM - step / 2) },
    });
    populateNetwork(f.world, f.config, f.st, true);
    const spawned = f.st.id.filter((_id, k) => k !== blocker).map((id) => f.world.movers[id]!);
    expect(spawned.some((m) => Math.abs(m.pos.s - leader.s) < 1e-6)).toBe(true);
    expect(spawned.some((m) => Math.abs(m.pos.s - follower.s) < 1e-6)).toBe(false);
    for (const car of spawned)
      expect(distance(f, car, f.world.movers[f.st.id[blocker]!]!)).toBeGreaterThanOrEqual(
        SLOW.lengthM + TRAFFIC.spawnGapM - 1e-6,
      );
    clearBodiesAndRiders(f);
  });

  it('refuses a follower near a non-anchor rider while its leader still has room', () => {
    const { leader, follower, step } = firstGroup();
    const f = fixture();
    // A law rider leaves the population windows unchanged, isolating the physical rider guard.
    // An extra racer would change candidates and therefore the initial seeded slot selection.
    f.config.riders = [
      ...f.config.riders,
      { ...f.config.riders[0]!, role: 'cop', faction: 'law', controller: { kind: 'cop' } },
    ];
    addMover(
      f.world,
      'rider',
      {
        ...follower,
        s: follower.s - follower.dir * (f.st.reactionM - step / 2),
      },
      1,
    );
    populateNetwork(f.world, f.config, f.st, true);
    const spawned = f.st.id.map((id) => f.world.movers[id]!);
    expect(spawned.some((m) => Math.abs(m.pos.s - leader.s) < 1e-6)).toBe(true);
    expect(spawned.some((m) => Math.abs(m.pos.s - follower.s) < 1e-6)).toBe(false);
    clearBodiesAndRiders(f);
  });

  it('keeps group members outside every racer reaction window', () => {
    const f = fixture();
    addMover(f.world, 'rider', { edge: 0, s: 1200, d: 1.7, dir: 1 }, 0);
    populateNetwork(f.world, f.config, f.st, true);
    expect(closePairs(f).length).toBeGreaterThan(0);
    clearBodiesAndRiders(f);
  });

  it.each([-1 / 100, 1 / 100])('keeps curved-road bodies separated at curvature %s', (kappa) => {
    const f = fixture(true, kappa);
    populateNetwork(f.world, f.config, f.st, true);
    expect(closePairs(f).length).toBeGreaterThan(0);
    clearBodiesAndRiders(f);
  });

  it('keeps short-edge followers inside the road instead of forcing a complete group', () => {
    const f = fixture(true, 0, 300);
    populateNetwork(f.world, f.config, f.st, true);
    expect(f.st.id.length).toBeGreaterThan(0);
    for (const id of f.st.id) {
      const pos = f.world.movers[id]!.pos;
      expect(pos.s).toBeGreaterThanOrEqual(SLOW.lengthM / 2 + 2);
      expect(pos.s + SLOW.lengthM / 2 + 2).toBeLessThanOrEqual(f.config.road.edges[pos.edge]!.length);
    }
    clearBodiesAndRiders(f);
  });

  it('keeps top-ups and recycling within the shared target and repeats deterministically', () => {
    const run = () => {
      const f = fixture();
      f.world.params['traffic.densityOncoming'] = 1;
      const hashes = [];
      for (const s of [600, 1500, 2400]) {
        f.world.movers[0]!.pos.s = s;
        for (let pass = 0; pass < 4; pass++) {
          populateNetwork(f.world, f.config, f.st, s === 600 && pass === 0);
          for (const dir of [1, -1]) {
            const target = Math.min(
              capPerDirection(f.world),
              Math.floor((2 * TRAFFIC.windowM * densityFor(f.world, f.st, dir)) / TRAFFIC.baseSpacingM),
            );
            expect(
              f.st.id.filter((_id, k) => f.st.dir[k] === dir && f.st.retired[k] === 0).length,
            ).toBeLessThanOrEqual(target);
          }
          hashes.push(worldHash(f.world));
        }
      }
      expect(f.st.recycles).toBeGreaterThan(0);
      expect(f.st.generation.some((g) => g > 1)).toBe(true);
      return hashes;
    };
    expect(run()).toEqual(run());
  });
});
