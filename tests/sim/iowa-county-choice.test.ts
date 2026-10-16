/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSimWithWorld } from '../../src/sim/create';
import { riderState } from '../../src/sim/riders';
import { quantizeInput } from '../../src/sim/api';
import { capPerDirection, trafficState } from '../../src/sim/traffic';
import { readConnector, type BakedNetwork } from '../../src/road';
import { buildTrafficGraph } from '../../src/sim/traffic/network';
import { firstSeed, ISOLATED } from './batch';
import {
  configFromHeader,
  createInputRecorder,
  createReplayController,
  HASH_EVERY_TICKS,
} from '../../src/replay';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
function run(take: boolean, bike = 'base:moped', traffic = false, stunt = false, seed = 1) {
  const { config } = createHeadlessRace(
    {
      seed,
      eventId: 'region-clinton:clinton-ia136-race',
      playerBike: bike,
      eventPatch: { riders: [] },
      tuning: {
        ...ISOLATED,
        'ground.offRoad': 1,
        'riders.courseEdges': 1,
        'traffic.density': traffic ? 1 : 0,
      },
    },
    { registry },
  );
  const { sim, world } = createSimWithWorld(config);
  const branch = config.route.branches.find((b) => b.kind === 'detour')!;
  const truckEdge = config.road.edges.find((e) => config.road.featuresOf(e.index, 'rampTruck').length > 0)!;
  const truck = config.road.featuresOf(truckEdge.index, 'rampTruck')[0]!;
  const query = {
    ...config.route,
    shortcuts: take && branch.choice ? [branch.choice] : [],
    lanesAt: (edge: number, s: number) =>
      stunt && edge === truckEdge.index && s > truck.s0 - 120 && s < truck.s1 + 40
        ? [
            {
              id: 'stunt-line',
              kind: 'drive' as const,
              direction: 1 as const,
              widthM: 1.8,
              dCenterM: (truck.d0 + truck.d1) / 2,
            },
          ]
        : config.road.lanesAt(edge, s),
  };
  const recorder = createInputRecorder();
  if (traffic) recorder.beginRace(sim, 'county-test-code+content');
  const graph = buildTrafficGraph(config);
  const bot = createBot();
  const roads = new Set<string>();
  const branchTraffic = new Set<number>();
  const crashes: unknown[] = [];
  let style = 0;
  let maxTraffic = 0;
  while (!sim.isOver() && sim.tick < 60 * 60 * 9) {
    const snapshot = sim.snapshot();
    const me = snapshot.entities[0]!;
    const actions = emptyActions();
    bot.drive(snapshot, me.id, query, actions);
    let cap = Infinity;
    for (let distance = 0; distance <= 160; distance += 4) {
      let edge = me.road.edge;
      let at = me.road.s + distance;
      while (at > config.route.edgeLength(edge)) {
        at -= config.route.edgeLength(edge);
        const next =
          take && branch.choice?.edge === edge ? branch.choice.toEdge : config.road.edges[edge]!.next?.edge;
        if (next === undefined) {
          at = config.route.edgeLength(edge);
          break;
        }
        edge = next;
      }
      const corner = Math.sqrt(10 / Math.max(Math.abs(config.route.kappaAt(edge, at)), 1 / 5000));
      cap = Math.min(cap, Math.sqrt(corner * corner + 8 * distance));
    }
    actions.throttle = me.speed < cap - 1 ? 1 : 0;
    actions.brake = me.speed > cap ? 1 : 0;
    const inputs = [toSimInput(actions)];
    const tick = sim.tick;
    if (traffic) recorder.record(tick, inputs);
    sim.step(inputs);
    if (traffic && tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
    roads.add(config.road.edges[me.road.edge]!.id);
    for (const e of sim.events()) {
      if (e.type === 'crash' && e.actor === me.id) crashes.push(e.data);
      if (e.type === 'style' && e.actor === me.id) style += Number(e.data['points'] ?? 0);
    }
    for (const mover of sim.snapshot().entities) {
      if (mover.kind === 'vehicle' && branch.edges.includes(mover.road.edge))
        branchTraffic.add(mover.road.dir);
    }
    const vehicles = sim.snapshot().entities.filter((m) => m.kind === 'vehicle').length;
    maxTraffic = Math.max(maxTraffic, vehicles);
    expect(vehicles).toBeLessThanOrEqual(2 * capPerDirection(world));
  }
  let replayChecked = 0;
  if (traffic) {
    recorder.finish(sim.tick - 1, sim.hash());
    const recording = recorder.current()!;
    const fresh = () => createSimWithWorld(configFromHeader(recording.header, config.road, config.route)).sim;
    const replay = createReplayController(recording).run(fresh());
    expect(replay.desync).toBeNull();
    expect(replay.finalHash).toBe(sim.hash());
    replayChecked = replay.checked;
    const tampered = structuredClone(recording);
    tampered.inputs[100]![0]!.steer = tampered.inputs[100]![0]!.steer === 127 ? -127 : 127;
    expect(createReplayController(tampered).run(fresh()).desync).not.toBeNull();
  }
  return {
    config,
    branch,
    graph,
    finished: sim.snapshot().entities[0]!.finished,
    ticks: sim.tick,
    roads: [...roads],
    branchTraffic: [...branchTraffic].sort(),
    crashes,
    style,
    maxTraffic,
    replayChecked,
  };
}

it.each([false, true])(
  'the Rental Moped finishes via county detour=%s without a crash',
  (take) => {
    const r = run(take);
    process.stdout.write(
      `[county moped] ${JSON.stringify({ take, finished: r.finished, ticks: r.ticks, roads: r.roads, crashes: r.crashes, style: r.style })}\n`,
    );
    expect(r.finished).toBe(true);
    expect(r.crashes).toEqual([]);
    expect(r.roads.includes(r.branch.id)).toBe(take);
    for (const edge of r.branch.edges.filter((e) => !r.config.road.edges[e]!.isConnector)) {
      expect(r.graph.viable[edge]).toEqual({ plus: true, minus: true });
    }
  },
  120_000,
);

it('a Rental Moped can steer back from the county dirt road grass margin', () => {
  const { config } = createHeadlessRace(
    {
      seed: 1,
      eventId: 'region-clinton:clinton-ia136-race',
      playerBike: 'base:moped',
      eventPatch: { riders: [] },
      tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 },
    },
    { registry },
  );
  const branch = config.route.branches.find((b) => b.kind === 'detour')!;
  const edge = branch.edges
    .map((e) => config.road.edges[e]!)
    .find((e) => !e.isConnector && e.surface === 'dirt')!;
  const { sim, world } = createSimWithWorld(config);
  const me = world.movers[0]!;
  const s = edge.length / 2;
  const verge = config.road.vergeAt(edge.index, s, 'right');
  expect(verge.edge).toBe('soft');
  me.pos = { edge: edge.index, s, d: verge.dInner + 1.5, dir: 1 };
  me.speed = 8;
  me.yaw = -0.3;
  riderState(world).yAbs[me.id] = config.road.surfaceHeight(edge.index, s, me.pos.d);
  const bot = createBot();
  const navigation = { ...config.route, shortcuts: [] };
  let returned = false;
  const crashes = [];
  for (let tick = 0; tick < 600; tick++) {
    const actions = emptyActions();
    bot.drive(sim.snapshot(), me.id, navigation, actions);
    sim.step([toSimInput(actions)]);
    crashes.push(...sim.events().filter((e) => e.type === 'crash'));
    if (me.mode === 'Road' && me.pos.d < verge.dInner - 0.5) {
      returned = true;
      break;
    }
  }
  expect(returned).toBe(true);
  expect(crashes).toEqual([]);
});

it('the optional shoulder carrier gives a stock starter bike a clean paid landing', () => {
  const { config } = createHeadlessRace(
    {
      seed: 1,
      eventId: 'region-clinton:clinton-ia136-race',
      playerBike: 'base:rustbucket-400',
      eventPatch: { riders: [] },
      tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 },
    },
    { registry },
  );
  const edge = config.road.edges.find((e) => config.road.featuresOf(e.index, 'rampTruck').length > 0)!;
  const truck = config.road.featuresOf(edge.index, 'rampTruck')[0]!;
  const { sim, world } = createSimWithWorld(config);
  const me = world.movers[0]!;
  me.pos.edge = edge.index;
  me.pos.s = truck.s0 - 120;
  me.pos.d = (truck.d0 + truck.d1) / 2;
  me.speed = config.riders[0]!.bike.topSpeedMps * 0.95;
  riderState(world).yAbs[me.id] = config.road.surfaceHeight(edge.index, me.pos.s, me.pos.d);
  const events = [];
  for (let tick = 0; tick < 600 && me.pos.s < truck.s1 + 100; tick++) {
    const target = me.pos.s < truck.s1 + 30 ? (truck.d0 + truck.d1) / 2 : 1.75;
    const steer = Math.max(-1, Math.min(1, (target - me.pos.d) * 0.6 - me.yaw * 0.8));
    sim.step([quantizeInput({ throttle: 1, brake: 0, steer, flags: 0 })]);
    events.push(...sim.events());
  }
  const paid = events
    .filter((e) => e.type === 'style' && e.data['kind'] === 'airtime')
    .reduce((sum, e) => sum + Number(e.data['points'] ?? 0), 0);
  process.stdout.write(
    `[county stunt] ${JSON.stringify({ paid, events: events.filter((e) => ['crash', 'jump', 'land', 'style'].includes(e.type)) })}\n`,
  );
  expect(events.filter((e) => e.type === 'crash')).toEqual([]);
  expect(events.some((e) => e.type === 'land')).toBe(true);
  expect(paid).toBeGreaterThan(0);
});

it('ordinary traffic populates the county roads in both directions', () => {
  const found = firstSeed(
    'county traffic both directions',
    [1, 2, 3],
    (seed) => run(true, 'base:moped', true, false, seed),
    (r) => r.finished && r.branchTraffic.includes(-1) && r.branchTraffic.includes(1),
  );
  const r = found.result;
  expect(r, found.summary).not.toBeNull();
  if (!r) throw new Error(found.summary);
  process.stdout.write(
    `[county traffic] ${JSON.stringify({ finished: r.finished, directions: r.branchTraffic, crashes: r.crashes.length, maxTraffic: r.maxTraffic, replayChecked: r.replayChecked })}\n`,
  );
  expect(r.finished).toBe(true);
  expect(r.branchTraffic).toEqual([-1, 1]);
}, 120_000);

it('the longer starter-bike stunt detour earns existing style points with an honest time cost', () => {
  const direct = run(false, 'base:rustbucket-400');
  const detour = run(true, 'base:rustbucket-400', false, true);
  process.stdout.write(
    `[county payoff] ${JSON.stringify({ directTicks: direct.ticks, detourTicks: detour.ticks, extraSeconds: (detour.ticks - direct.ticks) / 60, directStyle: direct.style, detourStyle: detour.style, crashes: detour.crashes })}\n`,
  );
  expect(direct.finished && detour.finished).toBe(true);
  expect(direct.crashes).toEqual([]);
  expect(detour.crashes).toEqual([]);
  expect(detour.ticks).toBeGreaterThan(direct.ticks);
  expect(detour.style).toBeGreaterThan(direct.style);
}, 120_000);

it.each([1, -1] as const)(
  'one unchanged vehicle generation traverses county ingress, streets and exit in direction %i',
  (dir) => {
    const raw = Object.values(
      import.meta.glob<BakedNetwork>('/packs/region-clinton/regions/clinton-iowa/networks/*.json', {
        eager: true,
        import: 'default',
      }),
    ).find((n) => n.id === 'osm-clinton-ia136')!;
    const search = firstSeed(
      `county complete generation direction ${dir}`,
      [1, 2, 3],
      (seed) => {
        const { config } = createHeadlessRace(
          {
            seed,
            eventId: 'region-clinton:clinton-ia136-race',
            eventPatch: { riders: [] },
            tuning: { ...ISOLATED, 'traffic.density': 1 },
          },
          { registry },
        );
        const road = config.road;
        const branch = config.route.branches.find((b) => b.kind === 'detour')!;
        const streets = branch.edges.filter((e) => !road.edges[e]!.isConnector);
        const host = new Set(config.route.mainEdges);
        const rows = raw.junctions.flatMap((j) => j.connectors).map((r) => readConnector(r)!);
        const directionOf = (r: (typeof rows)[number]) =>
          road
            .lanesAt(
              road.edgeIndex(r.from.road),
              r.from.end === 'from' ? 0 : road.edges[road.edgeIndex(r.from.road)]!.length,
            )
            .find((l) => l.id === r.from.lane)!.direction;
        const entry = rows.find(
          (r) =>
            directionOf(r) === dir &&
            road.lanesAt(road.edgeIndex(r.road), 0).some((l) => l.kind === 'drive') &&
            (dir === 1
              ? host.has(road.edgeIndex(r.from.road)) && streets.includes(road.edgeIndex(r.to.road))
              : host.has(road.edgeIndex(r.to.road)) && streets.includes(road.edgeIndex(r.from.road))),
        )!;
        const exit = rows.find(
          (r) =>
            directionOf(r) === dir &&
            (dir === 1
              ? streets.includes(road.edgeIndex(r.from.road)) && host.has(road.edgeIndex(r.to.road))
              : streets.includes(road.edgeIndex(r.to.road)) && host.has(road.edgeIndex(r.from.road))),
        )!;
        const expected = [
          road.edgeIndex(dir === 1 ? entry.from.road : entry.to.road),
          road.edgeIndex(entry.road),
          ...(dir === 1 ? streets : [...streets].reverse()),
          road.edgeIndex(exit.road),
          road.edgeIndex(dir === 1 ? exit.to.road : exit.from.road),
        ];
        const { sim, world } = createSimWithWorld(config);
        const me = world.movers[0]!;
        const initial = road.edges[expected[0]!]!;
        // The finite forward host is short: an anchor 150 m before its end excludes every
        // natural spawn-grid candidate. The real race start leaves a host approach to observe.
        if (dir === 1) expect(initial.index).toBe(config.route.start.edge);
        me.pos = {
          edge: initial.index,
          s: dir === 1 ? config.route.start.s : Math.min(150, initial.length),
          d: dir === 1 ? initial.dMin + 0.5 : initial.dMax - 0.5,
          dir,
        };
        riderState(world).yAbs[me.id] = road.surfaceHeight(me.pos.edge, me.pos.s, me.pos.d);
        let selected: { slot: number; id: number; generation: number } | undefined;
        const histories = new Map<string, number[]>();
        const history: number[] = [];
        let last: unknown;
        let reason = 'tick bound';
        for (let tick = 0; tick < 60 * 300; tick++) {
          const st = trafficState(world);
          for (let slot = 0; slot < st.id.length; slot++) {
            if (st.retired[slot] !== 0) continue;
            const mover = world.movers[st.id[slot]!]!;
            const key = `${mover.id}:${st.generation[slot]}`;
            const seen = histories.get(key) ?? [];
            if (seen.at(-1) !== mover.pos.edge) seen.push(mover.pos.edge);
            histories.set(key, seen);
          }
          if (!selected) {
            const slot = st.id.findIndex((id, k) => {
              const m = world.movers[id];
              const seen = histories.get(`${id}:${st.generation[k]}`) ?? [];
              const start = seen.indexOf(expected[0]!);
              return (
                m?.kind === 'vehicle' &&
                st.retired[k] === 0 &&
                m.pos.dir === dir &&
                start >= 0 &&
                seen[start + 1] === expected[1]
              );
            });
            if (slot >= 0) {
              selected = { slot, id: st.id[slot]!, generation: st.generation[slot]! };
              history.push(expected[0]!);
            }
          }
          if (selected) {
            if (st.generation[selected.slot] !== selected.generation || st.retired[selected.slot] !== 0) {
              reason = 'generation changed';
              break;
            }
            const vehicle = world.movers[selected.id]!;
            if (history.at(-1) !== vehicle.pos.edge) history.push(vehicle.pos.edge);
            const e = road.edges[vehicle.pos.edge]!;
            last = { edge: e.id, s: vehicle.pos.s, speed: vehicle.speed };
            if (expected.every((edge, i) => history[i] === edge)) {
              reason = 'complete';
              break;
            }
            // Follow the real vehicle with the activity anchor, on the clear opposite shoulder.
            // This prevents a long branch from recycling the observed generation outside the window.
            me.pos = {
              ...vehicle.pos,
              s: Math.max(0, Math.min(e.length, vehicle.pos.s - dir * 40)),
              d: dir === 1 ? e.dMin + 0.5 : e.dMax - 0.5,
            };
            me.speed = 0;
            me.yaw = 0;
            riderState(world).yAbs[me.id] = road.surfaceHeight(me.pos.edge, me.pos.s, me.pos.d);
          }
          // A junction queue can drain several movements before this generation enters.
          // Ingress and traversal share the existing finite simulation bound above.
          sim.step([quantizeInput({ throttle: 0, brake: 1, steer: 0, flags: 0 })]);
        }
        if (!selected) reason = 'no observed host-to-ingress generation';
        return {
          reason,
          identity: selected ? `${selected.id}:${selected.generation}` : null,
          expected: expected.map((e) => road.edges[e]!.id),
          history: history.map((e) => road.edges[e]!.id),
          last,
          ticks: sim.tick,
          hostTraffic: trafficState(world).id.flatMap((id, slot) => {
            const m = world.movers[id]!;
            return m.pos.edge === expected[0] && m.pos.dir === dir
              ? [{ id, generation: trafficState(world).generation[slot], s: m.pos.s, speed: m.speed }]
              : [];
          }),
        };
      },
      (r) => r.reason === 'complete',
    );
    process.stdout.write(`[county generation] ${JSON.stringify(search)}\n`);
    expect(search.result, JSON.stringify(search.tried)).not.toBeNull();
  },
  120_000,
);
