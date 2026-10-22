/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createRoadNetwork, terrainAt, roadBandHeight } from '../../src/road';
import { iowaParkLayout } from '../../src/road/structures/iowa-park';
import { quantizeInput, type SimConfig, type SimInput } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { initialPedGround, supportedPedMove } from '../../src/sim/peds/ground';
import { PED_PHASE, PEDS, pedsState } from '../../src/sim/peds';
import { pedsStep } from '../../src/sim/peds/step';
import { riderState } from '../../src/sim/riders';
import { ISOLATED, seedRange } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const visitorIds = ['region-clinton:park-hiker', 'region-clinton:park-runner'];
function configFor(seed = 1, route = 'osm-clinton-eagle-point-run'): SimConfig {
  return createHeadlessRace(
    {
      seed,
      eventId: 'region-clinton:clinton-ia136-race',
      route: `region-clinton:${route}`,
      eventPatch: { riders: [] },
      tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 },
    },
    { registry },
  ).config;
}
function zoneOf(c: SimConfig) {
  const e = c.road.edges.find((e) => e.features.some((f) => f.id === 'eagle-entry-visitors'))!;
  expect(e, 'authored Park Entry visitors').toBeDefined();
  const f = e.features.find((f) => f.id === 'eagle-entry-visitors')!;
  return { e, f };
}

describe('Eagle Point park visitors use local content and real source ground', () => {
  it('loads visitors only from the park zone, leaving the regional pool and other routes alone', () => {
    const c = configFor();
    const { e, f } = zoneOf(c);
    expect(registry.regions['region-clinton:clinton-iowa']!.traffic.pedestrians).toEqual([]);
    const { world } = createSimWithWorld(c);
    const st = pedsState(world);
    expect(st.id.length).toBeGreaterThan(0);
    for (const [k, id] of st.id.entries()) {
      const p = world.movers[id]!;
      expect(visitorIds).toContain(c.trafficTypes[st.type[k]!]!.contentId);
      expect(p.pos.edge).toBe(e.index);
      expect(p.pos.s).toBeGreaterThanOrEqual(f.s0);
      expect(p.pos.s).toBeLessThanOrEqual(f.s1);
      expect(st.crosses[k]).toBe(0);
    }
    const network = registry.networks['region-clinton:osm-clinton-eagle-point']!;
    const baked = network.roads.map((id) => registry.roads[`region-clinton:${id}`]!);
    const road = createRoadNetwork({
      network,
      roads: baked.map((r) => ({
        ...r,
        features: (r.features ?? []).filter((f) => f.id !== 'eagle-entry-visitors'),
      })),
    });
    expect(pedsState(createSimWithWorld({ ...c, road }).world).id).toEqual([]);
    for (const route of ['osm-clinton-ia136-run']) {
      const other = configFor(1, route);
      const state = pedsState(createSimWithWorld(other).world);
      expect(
        state.type.map((i) => other.trafficTypes[i]!.contentId).some((id) => visitorIds.includes(id)),
      ).toBe(false);
    }
  });

  it('supports the whole spawn/stroll and single-retreat envelope, clear of other roads and seeded facilities', () => {
    const c = configFor(),
      { e, f } = zoneOf(c),
      road = c.road;
    const types = c.trafficTypes.filter((t) => visitorIds.includes(t.contentId));
    expect(types.length).toBeGreaterThan(0);
    let probes = 0;
    for (const t of types)
      for (let s = f.s0; s <= f.s1; s += 0.5)
        for (const d of [f.d0, f.d1]) {
          const at = { edge: e.index, s, d },
            y = initialPedGround(road, at);
          expect(y).not.toBeNull();
          for (const endD of [d, d - PEDS.diveDistM, d + PEDS.diveDistM]) {
            const moved = supportedPedMove(road, at, { s, d: endD }, y!, t);
            expect(moved.d, `s=${s} from=${d} to=${endD} at=${JSON.stringify(moved)}`).toBeCloseTo(endD, 8);
            expect(moved.s).toBe(s);
            const returned = supportedPedMove(road, { edge: e.index, ...moved }, { s, d }, moved.y, t);
            expect(returned.d, `return s=${s} from=${endD} to=${d}`).toBeCloseTo(d, 8);
            for (const ds of [-t.lengthM / 2, t.lengthM / 2])
              for (const dd of [-t.widthM / 2, t.widthM / 2]) {
                const p = road.toWorld(e.index, s + ds, endD + dd, 0);
                if (roadBandHeight(road, e.index, s + ds, endD + dd) === null)
                  expect(terrainAt(road.terrain, p.x, p.z)?.surface).toBe('grass');
                // All roads, including distant stretches of this edge and generated connectors.
                for (const other of road.edges)
                  for (let i = 1; i < other.count; i++) {
                    if (other.index === e.index && Math.abs(i * other.spacing - s) < 12) continue;
                    const ax = other.x[i - 1]!,
                      az = other.z[i - 1]!,
                      dx = other.x[i]! - ax,
                      dz = other.z[i]! - az;
                    const u = Math.max(
                      0,
                      Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz)),
                    );
                    expect(Math.hypot(p.x - ax - u * dx, p.z - az - u * dz)).toBeGreaterThan(
                      Math.max(-other.dMin, other.dMax) + 0.6,
                    );
                  }
                for (const seed of seedRange(1, 8))
                  for (const facility of iowaParkLayout(road, seed).facilities)
                    expect(Math.hypot(p.x - facility.x, p.z - facility.z)).toBeGreaterThan(facility.radiusM);
                probes++;
              }
          }
        }
    const water = road.terrain!.patches.find((p) => p.surface === 'water')!;
    const tri = water.triangles[0]!,
      points = tri.map((i) => water.vertices[i]!);
    expect(
      terrainAt(
        road.terrain,
        points.reduce((n, p) => n + p[0], 0) / 3,
        points.reduce((n, p) => n + p[2], 0) / 3,
      )?.surface,
    ).toBe('water');
    expect(initialPedGround(road, { edge: e.index, s: f.s0, d: 1e5 })).toBeNull();
    console.log(
      `[park support] ${probes} footprint samples including both retreat directions, eight facility seeds and water/missing controls`,
    );
  }, 90_000);

  it('strolls both ways, turns, and keeps snapshot feet on the physical floor', () => {
    const c = configFor(),
      { e, f } = zoneOf(c),
      { sim, world } = createSimWithWorld(c);
    const st = pedsState(world),
      id = st.id[0]!,
      p = world.movers[id]!;
    const me = world.movers.find((m) => m.kind === 'rider')!;
    me.speed = 0;
    const ways = new Set<number>();
    let min = p.pos.s,
      max = p.pos.s;
    for (let tick = 0; tick < 2400; tick++) {
      const before = p.pos.s;
      pedsStep(world, c);
      world.tick++;
      ways.add(Math.sign(p.pos.s - before));
      min = Math.min(min, p.pos.s);
      max = Math.max(max, p.pos.s);
      expect(p.pos.s).toBeGreaterThanOrEqual(f.s0);
      expect(p.pos.s).toBeLessThanOrEqual(f.s1);
      const snap = sim.snapshot().entities.find((q) => q.id === id)!;
      expect(snap.y).toBeCloseTo(st.groundY[0]! + p.h, 8);
      expect(initialPedGround(c.road, p.pos)).toBeCloseTo(st.groundY[0]!, 6);
      expect(p.pos.d).toBeLessThan(c.road.edges[e.index]!.dMin - PEDS.offRoadMarginM);
    }
    expect(ways.has(-1) && ways.has(1)).toBe(true);
    expect(max - min).toBeGreaterThan(f.s1 - f.s0 - 2 * PEDS.strollEndM - 0.1);
  });

  it.each([1.5, -3.2])('a real rider passes at d=%s without contact and replays recorded controls', (d) => {
    const c = configFor(),
      { e, f } = zoneOf(c);
    const run = (replay?: readonly SimInput[]) => {
      const { sim, world } = createSimWithWorld(c),
        st = pedsState(world);
      const me = world.movers.find((m) => m.kind === 'rider')!;
      me.pos = { edge: e.index, s: f.s0 - 60, d, dir: 1 };
      me.speed = 20;
      me.yaw = 0;
      riderState(world).yAbs[me.id] = c.road.surfaceHeight(e.index, me.pos.s, d);
      const commands: SimInput[] = [],
        hashes: number[] = [],
        events: string[] = [];
      for (let tick = 0; tick < (replay?.length ?? 600); tick++) {
        const command =
          replay?.[tick] ??
          quantizeInput({
            throttle: me.speed < 20 ? 0.3 : 0,
            brake: 0,
            steer: Math.max(
              -1,
              Math.min(
                1,
                (d - me.pos.d) * 0.4 -
                  me.yaw * 2.5 +
                  (c.road.kappaAt(me.pos.edge, me.pos.s) * me.speed * me.speed) / 22,
              ),
            ),
            flags: 0,
          });
        commands.push(command);
        sim.step([command]);
        hashes.push(sim.hash());
        events.push(...sim.events().map((ev) => `${ev.type}:${String(ev.data['kind'] ?? '')}`));
        if (!replay && me.pos.s > f.s1 + 30) break;
      }
      expect(me.pos.edge).toBe(e.index);
      expect(me.pos.s).toBeGreaterThan(f.s1 + 25);
      expect(me.mode).toBe('Road');
      expect(st.contacts).toBe(0);
      expect(events.filter((ev) => ev.startsWith('crash:'))).toEqual([]);
      return { commands, hashes, events };
    };
    const actual = run();
    expect(run(actual.commands)).toEqual(actual);
    if (d > 0)
      expect(actual.events.filter((ev) => ev.startsWith('pedReact:') || ev.startsWith('pedDive:'))).toEqual(
        [],
      );
    else expect(actual.events).toContain('pedReact:jumpBack');
  });

  for (const kind of visitorIds)
    for (const approach of ['hop', 'outward dive', 'inward dive', 'far'] as const)
      it(`${kind} has a supported ${approach}, including repeated approaches and recovery`, () => {
        const run = () => {
          const c = configFor(),
            { sim, world } = createSimWithWorld(c);
          const st = pedsState(world),
            id = st.id[0]!,
            p = world.movers[id]!;
          st.type[0] = c.trafficTypes.findIndex((t) => t.contentId === kind);
          const t = c.trafficTypes[st.type[0]]!;
          const me = world.movers.find((m) => m.kind === 'rider')!;
          const hashes: number[] = [],
            displacements: number[] = [],
            reacts: string[] = [];
          const offset =
            approach === 'hop' ? 3 : approach === 'far' ? 9 : approach === 'outward dive' ? 0.4 : -0.4;
          for (let pass = 0; pass < 3; pass++) {
            const fromD = p.pos.d,
              riderD = fromD + offset;
            me.pos = { ...p.pos, s: p.pos.s - 50, d: riderD };
            me.speed = 20;
            let peak = 0;
            const fromEvents = world.events.length;
            for (let tick = 0; tick < 900; tick++) {
              if (tick < 300) me.pos.s += me.speed / 60;
              else me.speed = 0;
              riderState(world).yAbs[me.id] = initialPedGround(c.road, me.pos)!;
              pedsStep(world, c);
              world.tick++;
              peak = Math.max(peak, approach === 'inward dive' ? p.pos.d - fromD : fromD - p.pos.d);
              const supported = supportedPedMove(c.road, p.pos, p.pos, st.groundY[0]!, t);
              expect(supported.y).toBeCloseTo(st.groundY[0]!, 6);
              for (const ds of [-t.lengthM / 2, t.lengthM / 2])
                for (const dd of [-t.widthM / 2, t.widthM / 2]) {
                  const q = c.road.toWorld(p.pos.edge, p.pos.s + ds, p.pos.d + dd, 0);
                  if (roadBandHeight(c.road, p.pos.edge, p.pos.s + ds, p.pos.d + dd) === null)
                    expect(terrainAt(c.road.terrain, q.x, q.z)?.surface).toBe('grass');
                }
              expect(sim.snapshot().entities.find((q) => q.id === id)!.y).toBeCloseTo(
                st.groundY[0]! + p.h,
                8,
              );
              if (tick % 60 === 0) hashes.push(sim.hash());
            }
            const events = world.events.slice(fromEvents).filter((e) => e.actor === id);
            reacts.push(...events.map((e) => `${e.type}:${String(e.data['kind'] ?? '')}`));
            displacements.push(peak);
            if (approach === 'far') {
              expect(events.filter((e) => e.type === 'pedDive' || e.type === 'pedReact')).toEqual([]);
              expect(peak).toBeLessThan(0.01);
            } else if (approach === 'hop') {
              expect(events.some((e) => e.type === 'pedReact' && e.data['kind'] === 'jumpBack')).toBe(true);
              expect(events.some((e) => e.type === 'pedDive')).toBe(false);
              expect(peak).toBeGreaterThan(PEDS.hopDistM - 0.05);
            } else {
              expect(events.some((e) => e.type === 'pedDive')).toBe(true);
              expect(peak).toBeGreaterThan(PEDS.diveDistM - 0.05);
            }
            expect(st.contacts).toBe(0);
            expect(st.vehicleContacts).toBe(0);
            console.log(
              `[park pass diagnostic] ${kind} ${approach} ${pass}: s=${p.pos.s} d=${p.pos.d} y=${st.groundY[0]} phase=${st.phase[0]} target=${st.targetD[0]} home=${st.homeD[0]} peak=${peak}`,
            );
            expect(st.phase[0]).toBe(PED_PHASE.along);
            expect(p.pos.d).toBeCloseTo(st.homeD[0]!, 4);
          }
          return { hashes, displacements, reacts };
        };
        const result = run();
        expect(run()).toEqual(result);
        console.log(`[park reaction] ${kind} ${approach}: ${JSON.stringify(result.displacements)}`);
      });
});
