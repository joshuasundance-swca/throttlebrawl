/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import moped from '../../packs/base/bikes/moped.json';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { registryFromGlob } from '../../src/content';
import { blankActions, botInput, createBot } from '../../src/dev/bot';
import {
  createRoadNetwork,
  createRouteProgress,
  readConnector,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { createSimWithWorld } from '../../src/sim/create';
import { riderState } from '../../src/sim/riders';
import { raceState } from '../../src/sim/race';
import { TRAFFIC, trafficState, trafficSystem } from '../../src/sim/traffic';
import { placeRoadVehicle } from '../../src/sim/traffic/path-view';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimConfig, SimInput } from '../../src/sim/types';
import { createWorld, stepWorld } from '../../src/sim/world';
import { firstSeed, ISOLATED } from './batch';

const ROOT = 'packs/region-pnw/regions/pacific-northwest';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const baked = read<BakedNetwork>(`${ROOT}/networks/osm-pnw-longview-civic.json`);
const roads = baked.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
const route = read<BakedRoute>(`${ROOT}/routes/osm-longview-civic-triangle.json`);
const road = createRoadNetwork({ network: baked, roads });
const progress = createRouteProgress(road, route);
const isolated = () => {
  const c = gapSimConfig(
    { network: baked, roads },
    { route, tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 } },
  );
  return {
    ...c,
    riders: c.riders.map((r) => ({ ...r, bike: { contentId: `base:${moped.id}`, ...moped.handling } })),
  };
};

describe('the civic triangle is rideable rather than decorative', () => {
  it('rejects ambient cars on the rider fork while dedicated forward and reverse entries still move', () => {
    const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
    const eventId = 'region-pnw:pnw-t1-bridge-city';
    const base = buildSimConfig(reg, streamForEvent(reg, eventId), { seed: 1, eventId });
    const c: SimConfig = { ...base, road, route: progress, tuning: { ...base.tuning, ...ISOLATED } };
    const type = c.trafficTypes.findIndex(
      (t) => t.category === 'car' && !t.behaviour?.kerb && t.cruiseMps > 0,
    );
    expect(type).toBeGreaterThanOrEqual(0);
    const rows = baked.junctions
      .flatMap((j) => j.connectors)
      .map(readConnector)
      .filter((r) => r !== null);
    const rider = rows.find((r) => r.splitZone)!;
    const members = route.branches!.find((b) => b.traffic === 'road')!;
    const placement = (id: string) => {
      const edge = road.edgeIndex(id);
      const s = road.edges[edge]!.length / 2;
      const lane = road.lanesAt(edge, s).find((l) => l.kind === 'drive' || l.kind === 'shortcut')!;
      return { type, pos: { edge, s, d: lane.dCenterM, dir: lane.direction }, v0: 10, speed: 10 };
    };
    const staleRoute: BakedRoute = {
      ...route,
      branches: route.branches!.map((b) =>
        b.id !== members.id
          ? b
          : {
              ...b,
              roads: [rider.road, ...b.roads.filter((id) => id !== rider.road)],
            },
      ),
    };
    const stale: SimConfig = { ...c, route: createRouteProgress(road, staleRoute) };
    const oldWorld = createWorld(stale);
    trafficSystem.init(oldWorld, stale);
    expect(
      () => placeRoadVehicle(oldWorld, stale, placement(rider.road)),
      'stale membership permits a real ambient car',
    ).not.toThrow();
    const world = createWorld(c);
    trafficSystem.init(world, c);
    expect(() => placeRoadVehicle(world, c, placement(rider.road))).toThrow('no legal finite exit');
    const host = new Set(progress.mainEdges);
    const streets = new Set(
      members.roads.map((id) => road.edgeIndex(id)).filter((edge) => !road.edges[edge]!.isConnector),
    );
    const entries = rows.filter(
      (r) =>
        r.trafficOnly &&
        ((host.has(road.edgeIndex(r.from.road)) && streets.has(road.edgeIndex(r.to.road))) ||
          (host.has(road.edgeIndex(r.to.road)) && streets.has(road.edgeIndex(r.from.road)))),
    );
    const directions = new Set<number>();
    for (const entry of entries) {
      const positive = createWorld(c);
      trafficSystem.init(positive, c);
      const spec = placement(entry.road);
      const slot = placeRoadVehicle(positive, c, spec);
      const st = trafficState(positive);
      const id = st.id[slot]!;
      const generation = st.generation[slot];
      const start = road.toWorld(spec.pos.edge, spec.pos.s, spec.pos.d, 0);
      for (let tick = 0; tick < 60; tick++) stepWorld(positive, c, [trafficSystem], []);
      const mover = positive.movers[id]!;
      const end = road.toWorld(mover.pos.edge, mover.pos.s, mover.pos.d, 0);
      expect(Math.hypot(end.x - start.x, end.z - start.z), entry.road).toBeGreaterThan(2);
      expect(st.generation[slot], 'same ambient vehicle generation').toBe(generation);
      directions.add(spec.pos.dir);
    }
    expect([...directions].sort()).toEqual([-1, 1]);
    process.stdout.write(
      `[examined] stale rider ingress accepts placement; current rejects; ${entries.length} dedicated movement controls move in both directions\n`,
    );
  });

  it.each(['diagonal', 'grid'] as const)(
    'finishes the %s with a rental moped and replays every input',
    (choice) => {
      const config = isolated();
      const { sim, world } = createSimWithWorld(config);
      const playerId = sim.snapshot().entities.find((m) => m.kind === 'rider')!.id;
      const bot = createBot();
      const navigation = choice === 'grid' ? config.route : { ...config.route, shortcuts: [] };
      const visited = new Set<number>();
      const inputs: SimInput[] = [];
      const hashes: number[] = [];
      let boosted = false;
      let crashes = 0;
      let snap = sim.snapshot();
      while (!sim.isOver() && sim.tick < 60 * 240) {
        const actions = blankActions();
        bot.drive(snap, playerId, navigation, actions);
        const input = botInput(actions);
        inputs.push(input);
        sim.step([input]);
        snap = sim.snapshot();
        visited.add(snap.entities[playerId]!.road.edge);
        boosted ||= (snap.entities[playerId]!.boostS ?? 0) > 0;
        crashes += sim.events().filter((e) => e.type === 'crash' && e.actor === playerId).length;
        if (sim.tick % 120 === 0) hashes.push(sim.hash());
      }
      const branchRoads = route
        .branches!.flatMap((b) => b.roads)
        .map((id) => road.edgeIndex(id))
        .filter((e) => !road.edges[e]!.isConnector);
      expect(branchRoads.some((e) => visited.has(e))).toBe(choice === 'grid');
      expect(boosted).toBe(choice === 'grid');
      expect(crashes).toBe(0);
      expect(snap.race.finishOrder).toContain(playerId);
      expect(snap.entities[playerId]!.road.edge).toBe(progress.finish.edge);
      expect(raceState(world).checkpoint[playerId]).toBe(config.route.checkpoints.length);
      const replay = createSimWithWorld(isolated()).sim;
      const replayHashes: number[] = [];
      for (const input of inputs) {
        replay.step([input]);
        if (replay.tick % 120 === 0) replayHashes.push(replay.hash());
      }
      expect(replayHashes).toEqual(hashes);
      expect(replay.hash()).toBe(sim.hash());
      process.stdout.write(
        `[examined] rental moped ${choice}: ${sim.tick} finish ticks, ${hashes.length} replay hashes, ${visited.size} traversed edges, ${crashes} crashes, boosted=${boosted}\n`,
      );
    },
  );

  it('lets the ordinary rival field choose either street path and reach the shared finish', () => {
    const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
    const eventId = 'region-pnw:pnw-t1-bridge-city';
    const base = buildSimConfig(reg, streamForEvent(reg, eventId), { seed: 1, eventId });
    const branchStreets = new Set(
      route
        .branches!.flatMap((b) => b.roads)
        .map((id) => road.edgeIndex(id))
        .filter((e) => !road.edges[e]!.isConnector),
    );
    const diagonal = road.edgeIndex('osm-longview-civic-diagonal');
    const search = firstSeed(
      'Longview civic rival choice and finish',
      [1, 2, 3, 4],
      (seed) => {
        const c: SimConfig = {
          ...base,
          seed,
          road,
          route: progress,
          tuning: { ...base.tuning, ...ISOLATED },
        };
        const { sim } = createSimWithWorld(c);
        const choices = new Map<number, string>();
        let finishedChoices: string[] = [];
        for (let tick = 0; tick < 60 * 240 && new Set(finishedChoices).size < 2 && !sim.isOver(); tick++) {
          sim.step([botInput(blankActions())]);
          const snapshot = sim.snapshot();
          for (const m of snapshot.entities) {
            if (m.kind !== 'rider' || m.slot >= 0 || m.faction !== 'rider') continue;
            if (branchStreets.has(m.road.edge)) choices.set(m.id, 'grid');
            else if (m.road.edge === diagonal) choices.set(m.id, 'diagonal');
          }
          finishedChoices = snapshot.race.finishOrder
            .map((id) => choices.get(id))
            .filter((v): v is string => v !== undefined);
        }
        return { choices: [...new Set(finishedChoices)].sort(), ticks: sim.tick };
      },
      (r) => r.choices.length === 2,
    );
    expect(search.result, search.summary).not.toBeNull();
    expect(search.result?.choices).toEqual(['diagonal', 'grid']);
    process.stdout.write(
      `[examined] ${search.summary}; rivals finished both choices by tick ${search.result?.ticks}\n`,
    );
  });

  it('recovers from the authored soft grass margin without a grass-colour crash boundary', () => {
    const c = isolated();
    const { sim, world } = createSimWithWorld(c);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    const edge = road.edgeIndex('osm-longview-civic-30th');
    const s = road.edges[edge]!.length / 2;
    const verge = road.vergeAt(edge, s, 'right');
    me.pos = { edge, s, d: verge.dInner + 2, dir: 1 };
    me.speed = 8;
    me.yaw = -0.3;
    riderState(world).yAbs[me.id] = road.surfaceHeight(edge, s, me.pos.d);
    const bot = createBot();
    const navigation = { ...c.route, shortcuts: [] };
    let returned = false;
    let crashes = 0;
    for (let tick = 0; tick < 600; tick++) {
      const a = blankActions();
      bot.drive(sim.snapshot(), me.id, navigation, a);
      sim.step([botInput(a)]);
      crashes += sim.events().filter((e) => e.type === 'crash' && e.actor === me.id).length;
      if (me.mode === 'Road' && me.pos.d < verge.dInner - 0.5) {
        returned = true;
        break;
      }
    }
    expect(crashes).toBe(0);
    expect(returned).toBe(true);
  });

  it('naturally populates both directed side-street lanes under the shared vehicle cap', () => {
    const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
    const eventId = 'region-pnw:pnw-t1-bridge-city';
    const base = buildSimConfig(reg, streamForEvent(reg, eventId), { seed: 1, eventId });
    const streets = new Set(
      route
        .branches!.flatMap((b) => b.roads)
        .map((id) => road.edgeIndex(id))
        .filter((e) => !road.edges[e]!.isConnector),
    );
    const search = firstSeed(
      'Longview civic ordinary branch directions',
      [1, 2, 3, 4],
      (seed) => {
        const c: SimConfig = {
          ...base,
          seed,
          road,
          route: progress,
          riders: base.riders.filter((r) => r.role === 'player'),
          tuning: { ...base.tuning, ...ISOLATED, 'traffic.density': 1 },
        };
        const { sim } = createSimWithWorld(c);
        const directions = new Set<number>();
        let maximum = 0;
        for (let tick = 0; tick < 1200 && directions.size < 2; tick++) {
          sim.step([botInput(blankActions())]);
          const vehicles = sim.snapshot().entities.filter((m) => m.kind === 'vehicle');
          maximum = Math.max(maximum, vehicles.length);
          for (const m of vehicles) if (streets.has(m.road.edge)) directions.add(m.road.dir);
        }
        return { directions: [...directions].sort(), maximum, ticks: sim.tick };
      },
      (r) => r.directions.length === 2,
    );
    expect(search.result, search.summary).not.toBeNull();
    for (const attempt of search.tried)
      expect(attempt.result.maximum).toBeLessThanOrEqual(2 * TRAFFIC.maxPerDirectionHard);
    expect(search.result?.directions).toEqual([-1, 1]);
    process.stdout.write(
      `[examined] ${search.summary}; ${search.result?.ticks} ticks; maximum ${search.result?.maximum} ordinary vehicles\n`,
    );
  });

  it('observes the same vehicle generation enter, traverse and leave the entire branch in both directions', () => {
    const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
    const eventId = 'region-pnw:pnw-t1-bridge-city';
    const base = buildSimConfig(reg, streamForEvent(reg, eventId), { seed: 1, eventId });
    const branch = route.branches!.find((b) => b.traffic === 'road')!;
    const streets = branch.roads.map((id) => road.edgeIndex(id)).filter((e) => !road.edges[e]!.isConnector);
    const streetSet = new Set(streets);
    const hostSet = new Set(progress.mainEdges);
    const rows = baked.junctions
      .flatMap((j) => j.connectors)
      .map((value) => {
        const row = readConnector(value);
        if (!row) throw new Error('invalid civic connector row');
        return row;
      });
    const directionOf = (r: (typeof rows)[number]) => {
      const e = road.edges[road.edgeIndex(r.from.road)]!;
      return road.lanesAt(e.index, r.from.end === 'from' ? 0 : e.length).find((l) => l.id === r.from.lane)!
        .direction;
    };
    const isDriveMovement = (r: (typeof rows)[number]) =>
      road.lanesAt(road.edgeIndex(r.road), 0).some((l) => l.kind === 'drive');
    const expected = ([1, -1] as const).map((dir) => {
      const entry = rows.find(
        (r) =>
          directionOf(r) === dir &&
          isDriveMovement(r) &&
          (dir === 1
            ? hostSet.has(road.edgeIndex(r.from.road)) && streetSet.has(road.edgeIndex(r.to.road))
            : hostSet.has(road.edgeIndex(r.to.road)) && streetSet.has(road.edgeIndex(r.from.road))),
      )!;
      const exit = rows.find(
        (r) =>
          directionOf(r) === dir &&
          (dir === 1
            ? streetSet.has(road.edgeIndex(r.from.road)) && hostSet.has(road.edgeIndex(r.to.road))
            : streetSet.has(road.edgeIndex(r.to.road)) && hostSet.has(road.edgeIndex(r.from.road))),
      )!;
      return {
        dir,
        edges: [
          road.edgeIndex(dir === 1 ? entry.from.road : entry.to.road),
          road.edgeIndex(entry.road),
          ...(dir === 1 ? streets : [...streets].reverse()),
          road.edgeIndex(exit.road),
          road.edgeIndex(dir === 1 ? exit.to.road : exit.from.road),
        ],
      };
    });
    const search = firstSeed(
      'Longview civic complete vehicle generations',
      [1, 2, 3, 4],
      (seed) => {
        const c: SimConfig = {
          ...base,
          seed,
          road,
          route: progress,
          riders: base.riders.filter((r) => r.role === 'player'),
          tuning: { ...base.tuning, ...ISOLATED, 'traffic.density': 1 },
        };
        const { sim, world } = createSimWithWorld(c);
        const anchor = road.edgeIndex(route.mainPath[1]!);
        const me = world.movers.find((m) => m.kind === 'rider')!;
        me.pos = { edge: anchor, s: road.edges[anchor]!.length / 2, d: 5, dir: 1 };
        riderState(world).yAbs[me.id] = road.surfaceHeight(anchor, me.pos.s, me.pos.d);
        const histories = new Map<string, number[]>();
        const completed = new Map<number, { identity: string; edges: string[] }>();
        // Dense two-way traffic needs time to queue through both turns. The former 90-second
        // watchdog expired before valid traversal; untreated arbitration also deadlocks at
        // this three-minute bound. Require the same generation's complete path, not a tick.
        for (let tick = 0; tick < 60 * 180 && completed.size < expected.length; tick++) {
          const input = blankActions();
          input.brake = 1;
          sim.step([botInput(input)]);
          const st = trafficState(world);
          const vehicles = new Map(
            sim
              .snapshot()
              .entities.filter((m) => m.kind === 'vehicle')
              .map((m) => [m.id, m]),
          );
          for (let slot = 0; slot < st.id.length; slot++) {
            const id = st.id[slot]!;
            const mover = vehicles.get(id);
            if (!mover) continue;
            const generation = st.generation[slot];
            expect(Number.isSafeInteger(generation) && generation! > 0).toBe(true);
            const identity = `${id}:${generation}`;
            const history = histories.get(identity) ?? [];
            if (history.at(-1) !== mover.road.edge) history.push(mover.road.edge);
            histories.set(identity, history);
            for (const want of expected) {
              if (completed.has(want.dir)) continue;
              const first = history.indexOf(want.edges[0]!);
              if (first >= 0 && want.edges.every((edge, i) => history[first + i] === edge))
                completed.set(want.dir, { identity, edges: want.edges.map((edge) => road.edges[edge]!.id) });
            }
          }
        }
        return {
          completed: [...completed].map(([dir, evidence]) => ({ dir, ...evidence })),
          ticks: sim.tick,
          generations: histories.size,
        };
      },
      (r) => r.completed.length === expected.length,
    );
    expect(
      search.result,
      `${search.summary}: ${JSON.stringify(search.tried.map((s) => s.result))}`,
    ).not.toBeNull();
    expect(search.result?.completed.map((r) => r.dir).sort()).toEqual([-1, 1]);
    process.stdout.write(`[examined] ${search.summary}; ${JSON.stringify(search.result)}\n`);
  });
});
