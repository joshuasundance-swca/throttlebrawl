import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureBranchNetwork } from '../../road';
import { buildTrafficGraph, commitPath, pathPosition } from './network';
import { tuningDefaults } from '../../core';
import { SIM_TUNING } from '../create';
import type { SimConfig } from '../types';
import { addMover, createWorld, stepWorld, worldHash } from '../world';
import { capPerDirection, populate, startTrafficGhost, trafficState, trafficSystem } from './index';
import { placeRoadVehicle } from './path-view';
import { claimVehicle, ownedVehicleSlot, releaseVehicle } from './vehicle-control';
import { pathView } from './path-view';
import { fromCorridor, toCorridor } from './corridor';
import { leaveSupport, standOn } from '../riders/supports';
import { testConfig } from '../riders/testing';
import { mergeStops } from './merge';

function fixture(enabled = true) {
  const f = fixtureBranchNetwork();
  // This fixture is an ordinary paved alternative, with no jump in its road surface.
  const roads = f.roads.map((r) => ({
    ...r,
    features: [],
    laneSections: r.laneSections.map((s) => ({
      ...s,
      lanes: s.lanes.map((l) => (l.kind === 'shortcut' ? { ...l, kind: 'drive' as const } : l)),
    })),
  }));
  const road = createRoadNetwork({ ...f, roads });
  const route = createRouteProgress(road, {
    ...f.route,
    branches: [
      { id: 'cut', roads: ['c-in', 'cut', 'c-out'], ...(enabled ? { traffic: 'road' as const } : {}) },
    ],
  });
  return { road, route, config: { road, route } };
}

function simConfig(f = fixture(), density = 0): SimConfig {
  return {
    ...f.config,
    seed: 99,
    riders: [],
    weapons: [],
    modifiers: [],
    grudges: {},
    event: {
      contentId: 'base:test',
      kind: 'classic-race',
      paceMps: 20,
      byPlaceCash: [],
      raceEndTimeoutTicks: 1800,
    },
    trafficTypes: [
      { contentId: 'base:car', category: 'car', lengthM: 4.6, widthM: 1.8, cruiseMps: 15, hazard: 'normal' },
    ],
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), 'traffic.density': density },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

describe('committed network traffic paths', () => {
  it('does not let a parked approach reserve the receiving lane, but keeps its physical body', () => {
    const c = simConfig();
    c.trafficTypes = [...c.trafficTypes, { ...c.trafficTypes[0]!, category: 'oddity', cruiseMps: 0 }];
    const w = createWorld(c);
    trafficSystem.init(w, c);
    const st = trafficState(w);
    const edge = c.road.edgeIndex('c-merge');
    const parked = placeRoadVehicle(w, c, { type: 1, pos: { edge, s: 20, d: 1.7, dir: 1 } });
    mergeStops(w, c, st);
    expect(st.reservation[parked]).toBe('');
    placeRoadVehicle(w, c, { type: 0, pos: { edge, s: 20, d: 1.7, dir: 1 }, speed: 0 }, parked);
    mergeStops(w, c, st);
    expect(st.reservation[parked]).not.toBe('');
    placeRoadVehicle(w, c, { type: 1, pos: { edge: c.road.edgeIndex('d'), s: 6, d: 1.7, dir: 1 } }, parked);
    const waiting = placeRoadVehicle(w, c, { type: 0, pos: { edge, s: 20, d: 1.7, dir: 1 } });
    expect(mergeStops(w, c, st)[waiting]).toBeLessThan(Infinity);
  });
  it('keeps convoy top-ups and recycling under the shared directional allowance', () => {
    const c = simConfig(fixture(), 10);
    c.riders = testConfig().riders;
    c.trafficTypes = [{ ...c.trafficTypes[0]!, behaviour: { convoy: 4 } }];
    const w = createWorld(c);
    for (const id of ['b', 'cut'])
      addMover(w, 'rider', { edge: c.road.edgeIndex(id), s: 100, d: 8, dir: 1 }, 0);
    trafficSystem.init(w, c);
    const st = trafficState(w);
    for (let t = 0; t < 1800; t++) {
      stepWorld(w, c, [trafficSystem], []);
      for (const [k, id] of st.id.entries()) {
        const path = st.paths[k];
        const pos = w.movers[id]!.pos;
        if (path)
          expect(
            path.c.edges.some((edge, i) => edge === pos.edge && path.c.o[i] === pos.dir),
            `vehicle ${id} at tick ${w.tick}: ${JSON.stringify({ pos, path })}`,
          ).toBe(true);
      }
      for (const dir of [1, -1])
        expect(st.id.filter((_id, k) => st.dir[k] === dir && st.retired[k] === 0).length).toBeLessThanOrEqual(
          capPerDirection(w),
        );
    }
    expect(st.recycles).toBeGreaterThan(0);
  });
  it.each([false, true])('keeps one pair history across the branch rejoin (ghost %s)', (ghost) => {
    const c = simConfig();
    c.riders = testConfig().riders;
    const w = createWorld(c);
    const rider = addMover(w, 'rider', { edge: c.road.edgeIndex('c-out'), s: 0, d: 1.8, dir: 1 }, 0);
    rider.speed = 30;
    trafficSystem.init(w, c);
    const edge = c.road.edgeIndex('c-out');
    const slot = placeRoadVehicle(w, c, {
      type: 0,
      pos: { edge, s: c.road.edges[edge]!.length - 4, d: 0, dir: 1 },
      speed: 15,
      v0: 15,
    });
    const st = trafficState(w);
    const path = st.paths[slot]!;
    const start = st.u[slot]!;
    if (ghost) startTrafficGhost(w, rider.id);
    const events = [];
    for (let t = 0; t < 240; t++) {
      fromCorridor(path.c, start - 6 + t * 0.5, 1.8, 1, rider.pos);
      events.push(...stepWorld(w, c, [trafficSystem], []));
    }
    expect(w.movers[st.id[slot]!]!.pos.edge).toBe(c.road.edgeIndex('d'));
    expect(events.filter((e) => e.type === 'nearMiss' && e.target === st.id[slot])).toHaveLength(
      ghost ? 0 : 1,
    );
    expect(
      events.some((e) => (e.type === 'crash' || e.type === 'wobble') && e.data['cause'] === 'traffic'),
    ).toBe(false);
  });
  it('projects repeated physical edges into the nearest committed occurrence', () => {
    const c = {
      edges: [0, 1, 0],
      o: [1, 1, -1],
      off: [0, 100, 200],
      len: [100, 100, 100],
      dOff: [0, 0, 2],
      length: 300,
      lo: 0,
      hi: 300,
      routeDir: 1,
    };
    const p = { edge: 0, s: 40, d: 1.7, dir: -1 as const };
    expect(toCorridor(c, p, 260)).toEqual({ u: 260, cd: 0.30000000000000004, dir: 1 });
    expect(toCorridor(c, p, 40)).toEqual({ u: 40, cd: 1.7, dir: -1 });
  });
  it('protects a vehicle carrying a rider and allows reuse only after the rider leaves', () => {
    const c = simConfig();
    const w = createWorld(c);
    const rider = addMover(w, 'rider', { edge: c.road.edgeIndex('d'), s: 100, d: 1.7, dir: 1 });
    trafficSystem.init(w, c);
    const spec = { type: 0, pos: { ...rider.pos } };
    const slot = placeRoadVehicle(w, c, spec);
    standOn(w, rider.id, { key: `v:${trafficState(w).id[slot]}`, kind: 'vehicle', speed: 0 }, 0, {
      along: 0,
      across: 0,
    });
    expect(() => placeRoadVehicle(w, c, spec, slot)).toThrow('supported');
    leaveSupport(w, rider.id);
    expect(placeRoadVehicle(w, c, spec, slot)).toBe(slot);
  });
  it('reloads junction waits and committed choices with cold caches and detects altered waiting state', () => {
    const c = simConfig();
    const w = createWorld(c);
    trafficSystem.init(w, c);
    for (const id of ['c-merge', 'cut'])
      placeRoadVehicle(w, c, {
        type: 0,
        pos: {
          edge: c.road.edgeIndex(id),
          s: id === 'cut' ? c.road.edges[c.road.edgeIndex(id)]!.length - 20 : 20,
          d: id === 'cut' ? 0 : 1.7,
          dir: 1,
        },
      });
    placeRoadVehicle(w, c, {
      type: 0,
      pos: { edge: c.road.edgeIndex('d'), s: 6, d: 1.7, dir: 1 },
      speed: 0,
      v0: 0,
    });
    for (let i = 0; i < 180; i++) stepWorld(w, c, [trafficSystem], []);
    const restored = structuredClone(w);
    const hash = worldHash(w);
    expect(worldHash(restored)).toBe(hash);
    const st = trafficState(w);
    for (const p of st.paths) if (p) pathView(w, c, st, p);
    expect(worldHash(w)).toBe(hash);
    expect(st.waitTick.some((t) => t >= 0) || st.junctionWait.some((t) => t >= 0)).toBe(true);
    for (let i = 0; i < 240; i++) {
      expect(stepWorld(restored, c, [trafficSystem], [])).toEqual(stepWorld(w, c, [trafficSystem], []));
      expect(worldHash(restored)).toBe(worldHash(w));
    }
    trafficState(restored).waitTick[0] = 99999;
    expect(worldHash(restored)).not.toBe(worldHash(w));
  });
  it('keeps closed-race finite bounds and discards cleared path history without moving coordinates', () => {
    const f = fixture();
    const graph = buildTrafficGraph(f.config);
    const path = commitPath(
      f.road,
      graph,
      { edge: f.road.edgeIndex('a'), s: 150, d: 1.7, dir: 1 },
      3,
      0,
      0,
      2000,
    );
    const u = path.c.off.at(-1)! + 100;
    const before = pathPosition(path, u, 1.7);
    commitPath(f.road, graph, before, 3, 0, 0, 220, path);
    expect(path.c.edges).not.toContain(f.road.edgeIndex('a'));
    expect(pathPosition(path, u, 1.7)).toEqual(before);
    const finish = { ...f.route.finish, edge: f.route.start.edge, s: 80 };
    const route = { ...f.route, finish };
    const closed = buildTrafficGraph({ road: f.road, route });
    expect(closed.allowed).toEqual([f.route.start.edge]);
    expect(closed.rows[f.route.start.edge]!.plus).toEqual([]);
  });
  it.each([4.6, 16])(
    'holds %s m merge entrants behind a shared queue, then releases both without overlap',
    (lengthM) => {
      const f = fixture();
      const c = simConfig(f);
      c.trafficTypes = [{ ...c.trafficTypes[0]!, lengthM }];
      const clearBodies = (w: ReturnType<typeof createWorld>) => {
        const st = trafficState(w);
        const boxes = st.id.map((id) => {
          const m = w.movers[id]!;
          const p = c.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, m.h);
          const f = c.road.frameAt(m.pos.edge, m.pos.s);
          const cy = Math.cos(m.yaw);
          const sn = Math.sin(m.yaw);
          return { ...p, tx: cy * f.tx - sn * f.tz, tz: cy * f.tz + sn * f.tx };
        });
        for (let a = 0; a < boxes.length; a++)
          for (let b = a + 1; b < boxes.length; b++) {
            const x = boxes[a]!;
            const y = boxes[b]!;
            const overlap = [
              [x.tx, x.tz],
              [-x.tz, x.tx],
              [y.tx, y.tz],
              [-y.tz, y.tx],
            ].every(([ax, az]) => {
              const radius = (p: typeof x) =>
                (lengthM / 2) * Math.abs(p.tx * ax! + p.tz * az!) +
                (c.trafficTypes[0]!.widthM / 2) * Math.abs(-p.tz * ax! + p.tx * az!);
              return Math.abs((x.x - y.x) * ax! + (x.z - y.z) * az!) < radius(x) + radius(y) - 0.02;
            });
            expect(overlap, `physical bodies ${a}/${b} at tick ${w.tick}`).toBe(false);
          }
      };
      const run = () => {
        const w = createWorld(c);
        trafficSystem.init(w, c);
        const st = trafficState(w);
        const d = f.road.edgeIndex('d');
        const lead = placeRoadVehicle(w, c, {
          type: 0,
          pos: { edge: d, s: 6, d: 1.7, dir: 1 },
          v0: 0,
          speed: 0,
        });
        const entrants = [
          { id: 'c-merge', s: 20, d: 1.7 },
          { id: 'cut', s: f.road.edges[f.road.edgeIndex('cut')]!.length - 20, d: 0 },
        ].map(({ id, s, d }) =>
          placeRoadVehicle(w, c, { type: 0, pos: { edge: f.road.edgeIndex(id), s, d, dir: 1 } }),
        );
        const starts = entrants.map((k) => {
          const p = w.movers[st.id[k]!]!.pos;
          return f.road.toWorld(p.edge, p.s, p.d, 0);
        });
        expect(Math.hypot(starts[0]!.x - starts[1]!.x, starts[0]!.z - starts[1]!.z)).toBeGreaterThan(lengthM);
        clearBodies(w);
        for (let t = 0; t < 300; t++) {
          stepWorld(w, c, [trafficSystem], []);
          clearBodies(w);
        }
        expect(entrants.every((k) => w.movers[st.id[k]!]!.pos.edge !== d)).toBe(true);
        expect(w.movers[st.id[lead]!]!.pos.s).toBeCloseTo(6);
        st.v0[lead] = 15;
        let joined = false;
        for (let t = 0; t < 1800 && !joined; t++) {
          stepWorld(w, c, [trafficSystem], []);
          clearBodies(w);
          const cars = st.id.map((id) => w.movers[id]!);
          for (let a = 0; a < cars.length; a++)
            for (let b = a + 1; b < cars.length; b++) {
              if (cars[a]!.pos.edge === d && cars[b]!.pos.edge === d)
                expect(Math.abs(cars[a]!.pos.s - cars[b]!.pos.s)).toBeGreaterThanOrEqual(lengthM);
            }
          joined ||= entrants.every((k) => w.movers[st.id[k]!]!.pos.edge === d);
        }
        expect(
          joined,
          JSON.stringify(
            st.id.map((id, k) => ({
              pos: w.movers[id]?.pos,
              speed: w.movers[id]?.speed,
              reservation: st.reservation[k],
              u: st.u[k],
              path: st.paths[k]?.c.edges,
            })),
          ),
        ).toBe(true);
        return worldHash(w);
      };
      expect(run()).toBe(run());
    },
  );
  it('populates split racers with one global cap and physical spawn clearance', () => {
    const f = fixture();
    const c = simConfig(f, 5);
    const w = createWorld(c);
    const anchors = ['b', 'cut'].map((id) =>
      addMover(w, 'rider', { edge: f.road.edgeIndex(id), s: 150, d: 8, dir: 1 }),
    );
    trafficSystem.init(w, c);
    expect(trafficState(w).spawns).toBe(0); // unstepped menu grid does not need the late rules
    stepWorld(w, c, [trafficSystem], []);
    const st = trafficState(w);
    expect(st.spawns).toBeGreaterThan(0);
    for (const dir of [1, -1])
      expect(st.id.filter((_id, k) => st.dir[k] === dir && st.retired[k] === 0).length).toBeLessThanOrEqual(
        capPerDirection(w),
      );
    expect(st.id.some((id) => f.route.trafficRoads.includes(w.movers[id]!.pos.edge))).toBe(true);
    for (const id of st.id)
      for (const anchor of anchors) {
        const car = w.movers[id]!;
        const a = f.road.toWorld(anchor.pos.edge, anchor.pos.s, anchor.pos.d, 0);
        const b = f.road.toWorld(car.pos.edge, car.pos.s, car.pos.d, 0);
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(st.reactionM);
      }
    w.params['traffic.density'] = 0;
    // Move the racers away, making ambient cars eligible for retirement.
    for (const a of anchors) {
      a.pos.edge = f.road.edgeIndex('d');
      a.pos.s = 190;
    }
    populate(w, c, st);
    expect(st.id.some((_id, k) => st.retired[k] === 1)).toBe(true);
  });
  it('rejects stale same-id/same-type ownership and protects a live owner from recycling', () => {
    const f = fixture();
    const c = simConfig(f, 3);
    const w = createWorld(c);
    addMover(w, 'rider', { edge: f.road.edgeIndex('a'), s: 10, d: -8, dir: 1 });
    trafficSystem.init(w, c);
    const st = trafficState(w);
    const spec = { type: 0, pos: { edge: f.road.edgeIndex('d'), s: 100, d: 1.7, dir: 1 as const } };
    const slot = placeRoadVehicle(w, c, spec);
    const handle = claimVehicle(w, slot, 'fixture');
    const before = { ...w.movers[handle.id]!.pos };
    for (let i = 0; i < 4; i++) populate(w, c, st);
    expect(w.movers[handle.id]!.pos).toEqual(before);
    expect(ownedVehicleSlot(w, handle, 'fixture')).toBe(slot);
    releaseVehicle(w, handle, 'fixture');
    placeRoadVehicle(w, c, spec, slot);
    const replacement = claimVehicle(w, slot, 'fixture');
    expect(replacement.id).toBe(handle.id);
    expect(replacement.generation).toBeGreaterThan(handle.generation);
    expect(ownedVehicleSlot(w, handle, 'fixture')).toBe(-1);
    expect(ownedVehicleSlot(w, replacement, 'fixture')).toBe(slot);
  });
  it('drives either fork into the same receiving lane, without using race progress as separation', () => {
    const { road, route, config } = fixture();
    const graph = buildTrafficGraph(config);
    const arms = new Set<number>();
    for (let seed = 1; seed <= 64; seed++) {
      const path = commitPath(
        road,
        graph,
        { edge: road.edgeIndex('a'), s: 150, d: 1.7, dir: 1 },
        seed,
        0,
        0,
        1000,
      );
      const first = path.c.edges[1];
      if (first !== undefined) arms.add(first);
      expect(path.c.edges.at(-1)).toBe(road.edgeIndex('d'));
      const join = pathPosition(path, path.c.off.at(-1)! + 10, 1.7);
      expect(join.edge).toBe(road.edgeIndex('d'));
      expect(join.s).toBeCloseTo(10);
    }
    expect(arms).toEqual(new Set([road.edgeIndex('c-in'), road.edgeIndex('c-split')]));
    // Equal progress is not physical proximity. The actual paths differ in length and location.
    const pMain = route.progressAt(road.edgeIndex('b'), 100);
    const cutS = pMain - route.progressAt(road.edgeIndex('cut'), 0);
    const main = road.toWorld(road.edgeIndex('b'), 100, 1.7, 0);
    const cut = road.toWorld(road.edgeIndex('cut'), cutS, 0, 0);
    expect(Math.hypot(main.x - cut.x, main.z - cut.z)).toBeGreaterThan(20);
  });

  it('keeps omitted permission on the selected chain and does not invent reverse branch ingress', () => {
    const old = fixture(false);
    const graph = buildTrafficGraph(old.config);
    expect(graph.enabled).toBe(false);
    const f = fixture();
    const net = buildTrafficGraph(f.config);
    expect(net.rows[f.road.edgeIndex('a')]?.plus.some((r) => r.edge === f.road.edgeIndex('c-in'))).toBe(true);
    expect(net.rows[f.road.edgeIndex('d')]?.minus.some((r) => r.edge === f.road.edgeIndex('c-out'))).toBe(
      false,
    );
  });
});
