import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../../src/content';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { addMover, createWorld, stepWorld } from '../../src/sim/world';
import { TRAFFIC, trafficState, trafficSystem } from '../../src/sim/traffic';
import { buildTrafficGraph } from '../../src/sim/traffic/network';
import { placeRoadVehicle } from '../../src/sim/traffic/path-view';
import { firstSeed } from '../../tests/sim/batch';
import { createRoadNetwork, createRouteProgress } from '../../src/road';
import { junctionSpawnAllowed } from '../../src/sim/traffic/junctions';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const event = 'region-pnw:pnw-t1-bridge-city';
const make = (seed: number, density = 0, focus = false) => {
  const c = buildSimConfig(registry, streamForEvent(registry, event), {
    seed,
    eventId: event,
    tuning: { 'traffic.density': density },
  });
  const w = createWorld(c);
  if (focus)
    addMover(
      w,
      'rider',
      { edge: c.road.edgeIndex('osm-pnw-pdx-morrison-bridge'), s: 250, d: 8, dir: 1 },
      c.riders.findIndex((r) => r.role === 'player'),
    );
  trafficSystem.init(w, c);
  const type = c.trafficTypes.findIndex((t) => t.category === 'car' && !t.behaviour?.kerb && t.cruiseMps > 0);
  expect(type).toBeGreaterThanOrEqual(0);
  return { c, w, type, st: trafficState(w) };
};

describe('Morrison oncoming traffic', () => {
  it('bounds allocated traffic slots while racers revisit roads and density changes', () => {
    const f = make(7, 5, true);
    const rider = f.w.movers.find((m) => m.kind === 'rider')!;
    const roads = ['osm-pnw-pdx-morrison-bridge', 'osm-pnw-pdx-broadway', 'osm-pnw-pdx-east-burnside'];
    for (let cycle = 0; cycle < 18; cycle++) {
      rider.pos.edge = f.c.road.edgeIndex(roads[cycle % roads.length]!);
      rider.pos.s = Math.min(250, f.c.road.edges[rider.pos.edge]!.length / 2);
      f.w.params['traffic.density'] = cycle % 3 === 1 ? 0 : 5;
      for (let tick = 0; tick < 100; tick++) stepWorld(f.w, f.c, [trafficSystem], []);
      expect(f.st.id.length).toBeLessThanOrEqual(2 * TRAFFIC.maxPerDirectionHard);
    }
    expect(f.st.recycles).toBeGreaterThan(0);
  });
  it('protects connector crossings but does not merge a height-separated road into them', () => {
    const { c } = make(1);
    const id = 'osm-pnw-portland-morrison-traffic-reverse-leave';
    const pos = { edge: c.road.edgeIndex(id), s: 75, d: 0, dir: -1 as const };
    expect(junctionSpawnAllowed(c, pos, 20, 2.5)).toBe(false);
    const net = registry.networks['region-pnw:osm-pnw-portland']!;
    const roads = net.roads.map((rid) => registry.roads[`region-pnw:${rid}`]!);
    const road = createRoadNetwork({
      network: net,
      roads: roads.map((r) =>
        r.id !== id
          ? r
          : {
              ...r,
              samples: {
                ...r.samples,
                data: { ...r.samples.data, y: r.samples.data['y']!.map((y) => y + 20) },
              },
            },
      ),
    });
    const route = createRouteProgress(road, registry.routes['region-pnw:osm-bridge-city-run']!);
    expect(junctionSpawnAllowed({ ...c, road, route }, pos, 20, 2.5)).toBe(true);
    // The unraised peer still intersects the main road and remains protected.
    expect(
      junctionSpawnAllowed(
        { ...c, road, route },
        { ...pos, edge: road.edgeIndex('osm-pnw-portland-morrison-traffic-in'), s: 15 },
        20,
        2.5,
      ),
    ).toBe(false);
  });
  it('populates the branch with actual ambient oncoming vehicles', () => {
    const found = firstSeed(
      'ambient Morrison oncoming',
      Array.from({ length: 64 }, (_, i) => i + 1),
      (seed) => {
        const f = make(seed, 2, true);
        let seen = false;
        for (let tick = 0; tick < 60 && !seen; tick++) {
          stepWorld(f.w, f.c, [trafficSystem], []);
          seen = f.st.id.some(
            (id, k) =>
              f.st.dir[k] === -1 &&
              f.w.movers[id]?.pos.edge === f.c.road.edgeIndex('osm-pnw-pdx-morrison-bridge'),
          );
        }
        return seen;
      },
      (seen) => seen,
    );
    expect(found.result).toBe(true);
  });

  it.each(
    [
      ['traffic-in', 'traffic-reverse-leave', 'osm-pnw-pdx-alder', 'osm-pnw-pdx-broadway'],
      ['out', 'traffic-reverse-join', 'osm-pnw-pdx-se-hawthorne', 'osm-pnw-pdx-grand'],
    ].flatMap((roads) => [0, 30, 60].map((phase) => ({ roads, phase }))),
  )(
    'clears opposing long vehicles through overlapping turns: $roads at $phase m phase',
    ({ roads: [forward, reverse, exitA, exitB], phase }) => {
      const found = firstSeed(
        'opposing connector approaches',
        Array.from({ length: 64 }, (_, i) => i + 1),
        (seed) => {
          const f = make(seed);
          const type = f.c.trafficTypes.findIndex((t) => t.contentId === 'region-pnw:pdx-streetcar');
          expect(type).toBeGreaterThanOrEqual(0);
          const sourceA = f.c.road.edgeIndex(exitB!);
          const sourceB = f.c.road.edgeIndex(exitA!);
          const a = placeRoadVehicle(f.w, f.c, {
            type,
            pos: { edge: sourceA, s: f.c.road.edges[sourceA]!.length - 30 - phase, d: 2, dir: 1 },
            speed: 9,
            v0: 9,
          });
          const b = placeRoadVehicle(f.w, f.c, {
            type,
            pos: { edge: sourceB, s: 30, d: -2, dir: -1 },
            speed: 9,
            v0: 9,
          });
          return { ...f, a, b, type };
        },
        (f) =>
          f.st.paths[f.a]?.c.edges.includes(f.c.road.edgeIndex(`osm-pnw-portland-morrison-${forward}`)) ===
            true &&
          f.st.paths[f.b]?.c.edges.includes(f.c.road.edgeIndex(`osm-pnw-portland-morrison-${reverse}`)) ===
            true,
      );
      expect(found.result).not.toBeNull();
      const f = found.result!;
      const { a, b, type } = f;
      const ma = f.w.movers[f.st.id[a]!]!;
      const mb = f.w.movers[f.st.id[b]!]!;
      const body = (m: typeof ma) => {
        const p = f.c.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, m.h);
        const r = f.c.road.frameAt(m.pos.edge, m.pos.s);
        return { ...p, tx: r.tx, tz: r.tz };
      };
      let clear = false;
      let clearA = false;
      let clearB = false;
      for (let tick = 0; tick < 3600 && !clear; tick++) {
        stepWorld(f.w, f.c, [trafficSystem], []);
        const pa = body(ma),
          pb = body(mb);
        const shape = f.c.trafficTypes[type]!;
        const overlap = [
          [pa.tx, pa.tz],
          [-pa.tz, pa.tx],
          [pb.tx, pb.tz],
          [-pb.tz, pb.tx],
        ].every(([x, z]) => {
          const radius = (p: typeof pa) =>
            (shape.lengthM / 2) * Math.abs(p.tx * x! + p.tz * z!) +
            (shape.widthM / 2) * Math.abs(-p.tz * x! + p.tx * z!);
          return Math.abs((pa.x - pb.x) * x! + (pa.z - pb.z) * z!) < radius(pa) + radius(pb) - 0.05;
        });
        expect(overlap && Math.abs(pa.y - pb.y) < 1, `body overlap at ${tick}`).toBe(false);
        clearA ||= ma.pos.edge === f.c.road.edgeIndex(exitA!);
        clearB ||= mb.pos.edge === f.c.road.edgeIndex(exitB!);
        clear = clearA && clearB;
      }
      expect(clear, JSON.stringify({ a: ma.pos, b: mb.pos, waits: f.st.junctionWait })).toBe(true);
    },
  );
  it('has a reachable legal reverse path through every ordinary branch street', () => {
    const { c } = make(1);
    const graph = buildTrafficGraph(c);
    for (const id of ['osm-pnw-pdx-alder', 'osm-pnw-pdx-morrison-bridge', 'osm-pnw-pdx-grand']) {
      expect(graph.viable[c.road.edgeIndex(id)]?.minus, id).toBe(true);
    }
  });

  it('enters from SE Hawthorne, traverses the bridge backwards and exits onto Broadway continuously', () => {
    const found = firstSeed(
      'oncoming Morrison turn',
      Array.from({ length: 64 }, (_, i) => i + 1),
      (seed) => {
        const f = make(seed);
        const slot = placeRoadVehicle(f.w, f.c, {
          type: f.type,
          pos: { edge: f.c.road.edgeIndex('osm-pnw-pdx-se-hawthorne'), s: 45, d: -2, dir: -1 },
          speed: 15,
          v0: 15,
        });
        return { ...f, slot };
      },
      (f) =>
        f.st.paths[f.slot]?.c.edges.includes(
          f.c.road.edgeIndex('osm-pnw-portland-morrison-traffic-reverse-join'),
        ) === true,
    );
    expect(found.result).not.toBeNull();
    const f = found.result!;
    const m = f.w.movers[f.st.id[f.slot]!]!;
    const visited = new Set<number>();
    const target = f.c.road.edgeIndex('osm-pnw-pdx-broadway');
    let previous = f.c.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, 0);
    for (let tick = 0; tick < 16000 && m.pos.edge !== target; tick++) {
      stepWorld(f.w, f.c, [trafficSystem], []);
      visited.add(m.pos.edge);
      const p = f.c.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, 0);
      expect(Math.hypot(p.x - previous.x, p.z - previous.z), `tick ${tick}`).toBeLessThan(0.6);
      expect(f.st.dir[f.slot]).toBe(-1);
      previous = p;
    }
    expect(m.pos.edge).toBe(target);
    expect(visited).toContain(f.c.road.edgeIndex('osm-pnw-pdx-morrison-bridge'));
    expect(visited).toContain(f.c.road.edgeIndex('osm-pnw-portland-morrison-traffic-reverse-leave'));
    expect(m.pos.dir).toBe(-1);
  });
});
