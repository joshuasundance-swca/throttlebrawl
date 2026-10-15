import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../../src/content';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { createRoadNetwork, readConnector, type BakedNetworkBundle } from '../../src/road';
import { addMover, createWorld, stepWorld } from '../../src/sim/world';
import { capPerDirection, placeVehicle, trafficState, trafficSystem } from '../../src/sim/traffic';
import { toCorridor } from '../../src/sim/traffic/corridor';
import { buildTrafficGraph } from '../../src/sim/traffic/network';
import { placeRoadVehicle } from '../../src/sim/traffic/path-view';
import { createSimWithWorld } from '../../src/sim/create';
import { junctionStops } from '../../src/sim/traffic/junctions';

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const EVENT = 'region-pnw:pnw-t1-bridge-city';
const config = (seed = 1) =>
  buildSimConfig(ALL, streamForEvent(ALL, EVENT), { seed, eventId: EVENT, tuning: { 'traffic.density': 0 } });
const INGRESS = 'osm-pnw-portland-morrison-traffic-in';

function scenario(seed = 1) {
  const c = config(seed);
  const w = createWorld(c);
  trafficSystem.init(w, c);
  const car = c.trafficTypes.findIndex((t) => t.category === 'car' && !t.behaviour?.kerb && t.cruiseMps > 0);
  expect(car).toBeGreaterThanOrEqual(0);
  const source = c.road.edgeIndex('osm-pnw-pdx-broadway');
  const slot = placeRoadVehicle(w, c, {
    type: car,
    pos: { edge: source, s: 180, d: 2, dir: 1 },
    v0: 15,
    speed: 15,
  });
  return { c, w, slot, car, st: trafficState(w) };
}

function takingMorrison() {
  for (let seed = 1; seed <= 128; seed++) {
    const f = scenario(seed);
    if (f.st.paths[f.slot]?.c.edges.includes(f.c.road.edgeIndex(INGRESS))) return f;
  }
  throw new Error('no legal Morrison movement found in seeded cohort');
}

function touches(
  a: { x: number; z: number; tx: number; tz: number; length: number; width: number },
  b: { x: number; z: number; tx: number; tz: number; length: number; width: number },
) {
  return [
    [a.tx, a.tz],
    [-a.tz, a.tx],
    [b.tx, b.tz],
    [-b.tz, b.tx],
  ].every(([x, z]) => {
    const radius = (p: typeof a) =>
      (p.length / 2) * Math.abs(p.tx * x! + p.tz * z!) + (p.width / 2) * Math.abs(-p.tz * x! + p.tx * z!);
    return Math.abs((a.x - b.x) * x! + (a.z - b.z) * z!) < radius(a) + radius(b) - 0.05;
  });
}

describe('Bridge City network traffic integration', () => {
  it('lets a kerb cyclist clear the main-road junction instead of demanding the lane center', () => {
    const c = config();
    const w = createWorld(c);
    trafficSystem.init(w, c);
    const cyclist = c.trafficTypes.findIndex((t) => t.behaviour?.kerb && t.cruiseMps > 0);
    expect(cyclist).toBeGreaterThanOrEqual(0);
    // Its kerb policy cannot use a turn from Broadway's inner lane into Morrison.
    const ingress = c.road.edgeIndex(INGRESS);
    expect(buildTrafficGraph(c).viable[ingress]?.plus).toBe(true);
    expect(buildTrafficGraph(c, true).viable[ingress]?.plus).toBe(false);
    expect(() =>
      placeRoadVehicle(w, c, { type: cyclist, pos: { edge: ingress, s: 20, d: 0, dir: 1 } }),
    ).toThrow('no legal finite exit');
    const k = placeRoadVehicle(w, c, {
      type: cyclist,
      pos: {
        edge: c.road.edgeIndex('osm-pnw-pdx-se-hawthorne'),
        s: 40,
        d: -6,
        dir: -1,
      },
    });
    const st = trafficState(w);
    for (let t = 0; t < 1600; t++) stepWorld(w, c, [trafficSystem], []);
    expect(w.movers[st.id[k]!]!.pos.edge).toBe(c.road.edgeIndex('osm-pnw-pdx-hawthorne-bridge'));
  });
  it('does not reserve a future junction for a parked roadside vehicle', () => {
    const c = config();
    const w = createWorld(c);
    trafficSystem.init(w, c);
    const st = trafficState(w);
    const edge = c.road.edgeIndex('osm-pnw-pdx-se-hawthorne');
    const parked = c.trafficTypes.findIndex((t) => t.category === 'oddity' && t.cruiseMps === 0);
    expect(parked).toBeGreaterThanOrEqual(0);
    const k = placeRoadVehicle(w, c, { type: parked, pos: { edge, s: 4.2, d: -6, dir: -1 } });
    junctionStops(w, c, st);
    expect(st.junctionReservation[k]).toBe('');
    // A stopped ordinary car still intends to move through the junction.
    const car = c.trafficTypes.findIndex(
      (t) => t.category === 'car' && !t.behaviour?.kerb && t.cruiseMps > 0,
    );
    placeRoadVehicle(w, c, { type: car, pos: { edge, s: 40, d: -6, dir: -1 }, speed: 0 }, k);
    junctionStops(w, c, st);
    expect(st.junctionReservation[k]).not.toBe('');
    placeRoadVehicle(
      w,
      c,
      {
        type: parked,
        pos: {
          edge: c.road.edgeIndex('osm-pnw-portland-morrison-join'),
          s: 30,
          d: -6,
          dir: -1,
        },
      },
      k,
    );
    const waiting = placeRoadVehicle(w, c, {
      type: car,
      pos: {
        edge: c.road.edgeIndex('osm-pnw-pdx-grand'),
        s: c.road.edges[c.road.edgeIndex('osm-pnw-pdx-grand')]!.length - 40,
        d: 2,
        dir: 1,
      },
    });
    expect(junctionStops(w, c, st)[waiting]).toBeLessThan(Infinity);
  });
  it('keeps regional convoy recycling inside the shared population allowance', () => {
    const c = config(18);
    c.tuning = { ...c.tuning, 'traffic.density': 5 };
    const w = createWorld(c);
    for (const name of ['osm-pnw-pdx-broadway', 'osm-pnw-pdx-morrison-bridge'])
      addMover(
        w,
        'rider',
        { edge: c.road.edgeIndex(name), s: 100, d: 8, dir: 1 },
        c.riders.findIndex((r) => r.role === 'player'),
      );
    trafficSystem.init(w, c);
    const st = trafficState(w);
    for (let t = 0; t < 1200; t++) {
      stepWorld(w, c, [trafficSystem], []);
      for (const dir of [1, -1])
        expect(st.id.filter((_id, k) => st.dir[k] === dir && st.retired[k] === 0).length).toBeLessThanOrEqual(
          capPerDirection(w),
        );
    }
    expect(st.recycles).toBeGreaterThan(0);
  });
  it.each(['classic-race', 'takedown-hunt', 'cop-escape', 'grudge-match'] as const)(
    'steps %s with split racers, traffic, rivals and pursuit deterministically',
    (kind) => {
      const c = {
        ...config(17),
        event: { ...config(17).event, kind },
        tuning: { ...config(17).tuning, 'traffic.density': 2 },
      };
      const run = () => {
        const { sim, world } = createSimWithWorld(c);
        const racers = world.movers.filter(
          (m) => m.kind === 'rider' && c.riders[m.riderIndex]?.faction !== 'law',
        );
        expect(racers.length).toBeGreaterThan(1);
        racers[0]!.pos = { edge: c.road.edgeIndex('osm-pnw-pdx-alder'), s: 60, d: 2, dir: 1 };
        racers[1]!.pos = { edge: c.road.edgeIndex('osm-pnw-pdx-broadway'), s: 100, d: 2, dir: 1 };
        const events = [];
        for (let tick = 0; tick < 180; tick++) {
          sim.step([{ steer: 0, throttle: 255, brake: 0, flags: 0 }]);
          events.push(...sim.events());
        }
        const st = trafficState(world);
        expect(st.id.length).toBeGreaterThan(0);
        expect(st.id.some((id) => c.route.trafficRoads.includes(world.movers[id]!.pos.edge))).toBe(true);
        for (const m of world.movers)
          expect(Number.isFinite(m.pos.s) && Number.isFinite(m.pos.d) && Number.isFinite(m.speed)).toBe(true);
        return { hash: sim.hash(), events };
      };
      expect(run()).toEqual(run());
    },
  );
  it('preserves every original road rider link while exposing legal traffic access', () => {
    const f = config();
    const pack = 'region-pnw:';
    const network = ALL.networks[`${pack}${f.road.id}`]!;
    const added = new Set(
      network.junctions
        .flatMap((j) => j.connectors)
        .map(readConnector)
        .filter((c) => c?.trafficOnly)
        .map((c) => c!.road),
    );
    const original: BakedNetworkBundle = {
      network: {
        ...network,
        roads: network.roads.filter((id) => !added.has(id)),
        junctions: network.junctions.map((j) => ({
          ...j,
          connectors: j.connectors.filter((r) => !added.has(readConnector(r)?.road ?? '')),
        })),
      },
      roads: network.roads.filter((id) => !added.has(id)).map((id) => ALL.roads[`${pack}${id}`]!),
    };
    const old = createRoadNetwork(original);
    for (const e of old.edges)
      for (const end of ['from', 'to'] as const)
        expect(f.road.nextEdges(e.index, end), `${e.id}.${end}`).toEqual(old.nextEdges(e.index, end));
    const graph = buildTrafficGraph(f);
    expect(graph.allowed).toContain(f.road.edgeIndex(INGRESS));
    expect(graph.allowed).not.toContain(f.road.edgeIndex('osm-pnw-portland-morrison-in'));
    expect(graph.viable[f.road.edgeIndex(INGRESS)]?.minus).toBe(false);
  });

  it('drives a committed vehicle continuously through Morrison and onto the shared receiving road', () => {
    const f = takingMorrison();
    const m = f.w.movers[f.st.id[f.slot]!]!;
    const target = f.c.road.edgeIndex('osm-pnw-pdx-se-hawthorne');
    const visited = new Set<number>();
    let previous = f.c.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, 0);
    const deadline = f.w.tick + 14000;
    while (f.w.tick < deadline && m.pos.edge !== target) {
      stepWorld(f.w, f.c, [trafficSystem], []);
      visited.add(m.pos.edge);
      const point = f.c.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, 0);
      expect(Math.hypot(point.x - previous.x, point.z - previous.z)).toBeLessThan(0.5);
      previous = point;
    }
    expect(
      m.pos.edge,
      JSON.stringify({
        pos: m.pos,
        speed: m.speed,
        paths: f.st.paths[f.slot],
        rows: buildTrafficGraph(f.c).rows[m.pos.edge],
      }),
    ).toBe(target);
    expect(visited).toContain(f.c.road.edgeIndex(INGRESS));
    expect(visited).toContain(f.c.road.edgeIndex('osm-pnw-pdx-morrison-bridge'));
    expect(visited).toContain(f.c.road.edgeIndex('osm-pnw-portland-morrison-out'));
    expect(m.pos.edge, JSON.stringify({ pos: m.pos, speed: m.speed, paths: f.st.paths[f.slot] })).toBe(
      target,
    );
  });

  it.each(['network', 'reference'])(
    'clears %s oncoming traffic before the crossing turn, without overlap or starvation',
    (kind) => {
      const f = takingMorrison();
      const road = f.c.road;
      const pos = {
        edge: road.edgeIndex('osm-pnw-portland-morrison-leave'),
        s: 120,
        d: -6,
        dir: -1 as const,
      };
      const ref = toCorridor(f.st.corridor, pos)!;
      const oncoming =
        kind === 'network'
          ? placeRoadVehicle(f.w, f.c, { type: f.car, pos, v0: 15, speed: 15 })
          : placeVehicle(f.w, f.c, { type: f.car, u: ref.u, dir: -1, rank: 1, v0: 15, speed: 15 });
      const turn = f.w.movers[f.st.id[f.slot]!]!;
      const other = f.w.movers[f.st.id[oncoming]!]!;
      let entered = false;
      let cleared = false;
      const deadline = f.w.tick + 3000;
      const body = (m: typeof turn, k: number) => {
        const p = road.toWorld(m.pos.edge, m.pos.s, m.pos.d, m.h);
        const r = road.frameAt(m.pos.edge, m.pos.s);
        const t = f.c.trafficTypes[f.st.type[k]!]!;
        return { ...p, tx: r.tx, tz: r.tz, length: t.lengthM, width: t.widthM };
      };
      while (f.w.tick < deadline && !cleared) {
        stepWorld(f.w, f.c, [trafficSystem], []);
        const a = body(turn, f.slot);
        const b = body(other, oncoming);
        if (Math.abs(a.y - b.y) < 1)
          expect(touches(a, b), `physical overlap at tick ${f.w.tick}`).toBe(false);
        entered ||= turn.pos.edge === road.edgeIndex(INGRESS);
        cleared = entered && turn.pos.edge === road.edgeIndex('osm-pnw-pdx-alder');
      }
      expect(entered).toBe(true);
      expect(
        cleared,
        JSON.stringify({
          turn: turn.pos,
          other: other.pos,
          wait: f.st.junctionWait,
          reservation: f.st.junctionReservation,
        }),
      ).toBe(true);
    },
  );
});
