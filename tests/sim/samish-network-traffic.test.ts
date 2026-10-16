import { describe, expect, it } from 'vitest';
import { buildSimConfig, realRoutes, streamForEvent } from '../../src/app/config';
import { regionChoices } from '../../src/app/regions';
import { lookup, registryFromGlob } from '../../src/content';
import { blankActions, botInput, createBot } from '../../src/dev/bot';
import {
  configFromHeader,
  createInputRecorder,
  createReplayController,
  decodeReplay,
  encodeReplay,
  HASH_EVERY_TICKS,
} from '../../src/replay';
import { readConnector } from '../../src/road';
import { createSimWithWorld } from '../../src/sim/create';
import { capPerDirection, laneEndAhead, trafficState, trafficSystem } from '../../src/sim/traffic';
import { pathView, placeRoadVehicle } from '../../src/sim/traffic/path-view';
import { mergeStops, prepareTurn } from '../../src/sim/traffic/merge';
import { junctionStops } from '../../src/sim/traffic/junctions';
import { addMover, createWorld, stepWorld } from '../../src/sim/world';
import source from '../../tools/gis/networks/osm-pnw-samish.json';
import { firstSeed, ISOLATED, seedRange } from './batch';

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const ROUTE = 'region-pnw:osm-i5-samish-run';
const EVENT = regionChoices(ALL).find((choice) => realRoutes(ALL, choice.eventId).includes(ROUTE))!.eventId;
const STREAM = streamForEvent(ALL, EVENT, undefined, ROUTE);
const BAKED = lookup(ALL.routes, ROUTE);
const NETWORK = lookup(ALL.networks, `region-pnw:${BAKED.network}`);
const ROWS = NETWORK.junctions
  .flatMap((j) => j.connectors)
  .map(readConnector)
  .filter((c) => c !== null);
const config = (seed = 1, density = 0) =>
  buildSimConfig(ALL, STREAM, {
    seed,
    eventId: EVENT,
    route: ROUTE,
    tuning: { ...ISOLATED, 'traffic.density': density },
  });

function carType(c: ReturnType<typeof config>) {
  const index = c.trafficTypes.findIndex(
    (t) => t.category === 'car' && !t.behaviour?.kerb && t.cruiseMps > 0,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

const CHAINS = source.trafficChains.map((chain) => {
  const body = source.lines.find((line) => line.id === chain.line)!.roads[0]!.id;
  const from = ROWS.find((row) => row.road === `${source.id}-${chain.id}-from`)!;
  const to = ROWS.find((row) => row.road === `${source.id}-${chain.id}-to`)!;
  return { id: chain.id, body, from, to };
});
const SHORE = source.lines.find((line) => line.id === source.branches[0]!.line)!;
const MOVEMENTS = [
  ...CHAINS.map((chain) => ({ ...chain, bodies: [chain.body] })),
  {
    id: 'forward-shore',
    bodies: SHORE.roads.map((road) => road.id),
    from: ROWS.find((row) => row.road === `${source.id}-${source.branches[0]!.label}-traffic-in`)!,
    to: ROWS.find((row) => row.road === `${source.id}-${source.branches[0]!.label}-out`)!,
  },
];

function directedCar(seed: number, movement: (typeof MOVEMENTS)[number]) {
  const c = config(seed);
  const world = createWorld(c);
  trafficSystem.init(world, c);
  const endpoint = movement.from.from;
  const edge = c.road.edgeIndex(endpoint.road);
  const dir = endpoint.end === 'to' ? 1 : -1;
  const s = dir === 1 ? c.road.edges[edge]!.length - 20 : 20;
  const lane = c.road.lanesAt(edge, s).find((l) => l.id === endpoint.lane)!;
  const slot = placeRoadVehicle(world, c, {
    type: carType(c),
    pos: { edge, s, d: lane.dCenterM, dir },
    v0: 15,
    speed: 15,
  });
  return { c, world, slot, st: trafficState(world) };
}

describe('Samish source access in the running traffic and race systems', () => {
  for (const movement of MOVEMENTS) {
    it(`drives an ordinary car through ${movement.id} and onto its direction-valid receiving lane`, () => {
      const search = firstSeed(
        `Samish ${movement.id} committed entry`,
        seedRange(1, 32),
        (seed) => directedCar(seed, movement),
        (f) => f.st.paths[f.slot]!.c.edges.includes(f.c.road.edgeIndex(movement.from.road)),
      );
      expect(search.result, search.summary).not.toBeNull();
      const { c, world, slot, st } = search.result!;
      const car = world.movers[st.id[slot]!]!;
      const generation = st.generation[slot];
      const target = c.road.edgeIndex(movement.to.to.road);
      const visited = new Set<number>();
      let previous = c.road.toWorld(car.pos.edge, car.pos.s, car.pos.d, 0);
      let maximumStepM = 0;
      const deadline = Math.ceil(
        ((100 +
          [movement.from.road, ...movement.bodies, movement.to.road].reduce(
            (sum, id) => sum + c.road.edges[c.road.edgeIndex(id)]!.length,
            0,
          )) /
          5) *
          60,
      );
      while (world.tick < deadline && car.pos.edge !== target) {
        stepWorld(world, c, [trafficSystem], []);
        visited.add(car.pos.edge);
        const point = c.road.toWorld(car.pos.edge, car.pos.s, car.pos.d, 0);
        maximumStepM = Math.max(
          maximumStepM,
          Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z),
        );
        expect(
          c.road
            .lanesAt(car.pos.edge, car.pos.s)
            .some(
              (lane) =>
                lane.kind === 'drive' &&
                lane.direction === car.pos.dir &&
                Math.abs(lane.dCenterM - car.pos.d) <= lane.widthM / 2,
            ),
          `legal lane at ${world.tick}: ${JSON.stringify(car.pos)}`,
        ).toBe(true);
        expect(st.generation[slot], 'same car, no recycle shortcut').toBe(generation);
        previous = point;
      }
      if (car.pos.edge !== target) {
        const path = st.paths[slot]!;
        const view = pathView(world, c, st, path, slot);
        console.log(
          '[Samish movement failure]',
          JSON.stringify({
            id: movement.id,
            tick: world.tick,
            pos: car.pos,
            speed: car.speed,
            vehicles: st.id,
            path: { ...path, c: { ...path.c, edges: path.c.edges.map((e) => c.road.edges[e]!.id) } },
            u: view.u[slot],
            cd: view.cd[slot],
            rank: view.rank[slot],
            laneEnd: laneEndAhead(view, view.u[slot]!, 1, view.rank[slot]!, 200),
            mergeStop: mergeStops(world, c, st)[slot],
            junctionStop: junctionStops(world, c, st)[slot],
            turnStop: prepareTurn(c, st, view, slot),
            junctionReservation: st.junctionReservation[slot],
          }),
        );
      }
      expect(car.pos.edge, JSON.stringify({ tick: world.tick, pos: car.pos, speed: car.speed })).toBe(target);
      expect(car.pos.dir).toBe(movement.to.to.end === 'from' ? 1 : -1);
      for (const id of [movement.from.road, ...movement.bodies, movement.to.road])
        expect(visited).toContain(c.road.edgeIndex(id));
      expect(maximumStepM, 'continuous physical movement, including all road handoffs').toBeLessThan(0.75);
      process.stdout.write(
        `[examined] ${movement.id}: ${world.tick} ticks, ${visited.size} visited roads, maximum 3D step ${maximumStepM.toFixed(4)} m\n`,
      );
    });
  }

  it('rejects reverse movement on each authored southbound ramp tail and the rider-only ingress', () => {
    const c = config();
    const world = createWorld(c);
    trafficSystem.init(world, c);
    const shore = source.lines.find((line) => line.id === source.branches[0]!.line)!;
    for (const id of Object.keys(shore.roadLanes!)) {
      const edge = c.road.edgeIndex(id);
      expect(
        () =>
          placeRoadVehicle(world, c, {
            type: carType(c),
            pos: { edge, s: c.road.edges[edge]!.length / 2, d: -2, dir: -1 },
          }),
        id,
      ).toThrow('no legal finite exit');
    }
    const riderIngress = ROWS.find((row) => row.splitZone)!;
    expect(() =>
      placeRoadVehicle(world, c, {
        type: carType(c),
        pos: { edge: c.road.edgeIndex(riderIngress.road), s: 10, d: 0, dir: 1 },
      }),
    ).toThrow('no legal finite exit');
  });

  it('populates a real shore neighborhood with moving cars in both directions inside the shared allowance', () => {
    const c = config(1, 1);
    const world = createWorld(c);
    const core = c.route.trafficRoads.find(
      (edge) =>
        c.road.lanesAt(edge, 50).filter((l) => l.kind === 'drive').length === 2 &&
        c.road.edges[edge]!.length > 500,
    )!;
    expect(core).toBeDefined();
    const playerIndex = c.riders.findIndex((r) => r.controller.kind === 'player');
    addMover(world, 'rider', { edge: core, s: c.road.edges[core]!.length / 2, d: 2, dir: 1 }, playerIndex);
    addMover(world, 'rider', { ...c.route.start, d: 8 }, playerIndex);
    trafficSystem.init(world, c);
    const st = trafficState(world);
    const observed = new Set<number>();
    const first = new Map<string, number>();
    let peak = 0;
    for (let tick = 0; tick < 1200; tick++) {
      stepWorld(world, c, [trafficSystem], []);
      const alive = st.id.filter((_id, k) => st.retired[k] === 0);
      peak = Math.max(peak, alive.length);
      expect(new Set(alive).size).toBe(alive.length);
      for (const dir of [1, -1])
        expect(st.id.filter((_id, k) => st.retired[k] === 0 && st.dir[k] === dir).length).toBeLessThanOrEqual(
          capPerDirection(world),
        );
      for (const [k, id] of st.id.entries()) {
        const m = world.movers[id]!;
        if (st.retired[k] || m.pos.edge !== core || c.trafficTypes[st.type[k]!]!.category !== 'car') continue;
        const key = `${id}:${st.generation[k]}:${m.pos.dir}`;
        const start = first.get(key) ?? m.pos.s;
        first.set(key, start);
        if ((m.pos.s - start) * m.pos.dir > 5) observed.add(m.pos.dir);
      }
    }
    expect([...observed].sort(), 'actual ordinary cars move at least5m in each shore direction').toEqual([
      -1, 1,
    ]);
    process.stdout.write(
      `[examined] Samish populated core: moving directions ${[...observed].join(', ')}, peak ${peak}, cap ${capPerDirection(world)} per direction, recycles ${st.recycles}\n`,
    );
  });

  it.each(['main', 'shore'] as const)(
    'finishes the actual %s ride with ordered checkpoint events and no classified timeout',
    (choice) => {
      const c = config();
      const { sim, world } = createSimWithWorld(c);
      const player = world.movers.find((m) => c.riders[m.riderIndex]?.controller.kind === 'player')!.id;
      const bot = createBot();
      // Choosing the main line only changes the test driver's preference. Stock route/physics stay.
      const driverRoute = choice === 'main' ? { ...c.route, shortcuts: [] } : c.route;
      const visited = new Set<number>();
      const checkpoints: number[] = [];
      let finish: ReturnType<typeof sim.events>[number] | undefined;
      while (!sim.isOver() && sim.tick < 36000 && !finish) {
        const actions = blankActions();
        bot.drive(sim.snapshot(), player, driverRoute, actions);
        sim.step([botInput(actions)]);
        visited.add(world.movers[player]!.pos.edge);
        for (const event of sim.events())
          if (event.actor === player) {
            if (event.type === 'lapOrCheckpoint') checkpoints.push(Number(event.data['checkpoint']));
            if (event.type === 'finish') finish = event;
          }
      }
      const me = world.movers[player]!;
      expect(
        finish,
        JSON.stringify({ choice, tick: sim.tick, pos: me.pos, speed: me.speed, checkpoints }),
      ).toBeDefined();
      expect(finish!.data['classified']).toBe(false);
      expect(sim.snapshot().race.finishOrder).toContain(player);
      expect(checkpoints).toEqual(c.route.checkpoints.map((_c, i) => i));
      expect(me.pos.edge).toBe(c.route.finish.edge);
      const riderIngress = c.road.edgeIndex(ROWS.find((row) => row.splitZone)!.road);
      expect(
        visited.has(riderIngress),
        'main control stays on I5; shore driver actually takes the rider fork',
      ).toBe(choice === 'shore');
      if (choice === 'main') for (const edge of c.route.mainEdges) expect(visited).toContain(edge);
      else
        for (const id of source.lines
          .find((line) => line.id === source.branches[0]!.line)!
          .roads.map((r) => r.id))
          expect(visited).toContain(c.road.edgeIndex(id));
      process.stdout.write(
        `[examined] Samish ${choice}: unclassified finish at tick ${sim.tick}, ${checkpoints.length} ordered checkpoints, ${visited.size} visited roads\n`,
      );
    },
    90000,
  );

  it('encodes, reloads and tamper-checks inputs across an actual populated Samish rider junction', () => {
    const c = config(1, 1);
    const { sim, world } = createSimWithWorld(c);
    const player = world.movers.find((m) => c.riders[m.riderIndex]?.controller.kind === 'player')!.id;
    const bot = createBot();
    const recorder = createInputRecorder();
    recorder.beginRace(sim, 'test-samish-code+content');
    const riderFork = ROWS.find((row) => row.splitZone)!;
    const approach = c.road.edgeIndex(riderFork.from.road);
    const driverRoute = { ...c.route, shortcuts: [] };
    let encounter = -1;
    let tamperTick = -1;
    let branchTraffic = false;
    while (sim.tick < 12000 && (encounter < 0 || sim.tick < encounter + 240)) {
      const tick = sim.tick;
      const actions = blankActions();
      bot.drive(sim.snapshot(), player, driverRoute, actions);
      recorder.record(tick, [botInput(actions)]);
      sim.step([botInput(actions)]);
      if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
      const position = world.movers[player]!.pos;
      if (position.edge === approach && position.s >= riderFork.splitZone!.s0 && encounter < 0)
        encounter = sim.tick;
      if (encounter >= 0 && tamperTick < 0 && world.movers[player]!.speed > 5) tamperTick = tick;
      branchTraffic ||= trafficState(world).id.some((id) =>
        c.route.trafficRoads.includes(world.movers[id]!.pos.edge),
      );
    }
    if (encounter < 0)
      console.log(
        '[Samish replay precondition failure]',
        JSON.stringify({
          tick: sim.tick,
          player: world.movers[player],
          race: sim.snapshot().race,
          branchTraffic,
          bot: bot.stats(),
        }),
      );
    expect(encounter, 'mainline rider physically crosses the actual populated fork approach').toBeGreaterThan(
      0,
    );
    expect(branchTraffic).toBe(true);
    expect(tamperTick).toBeGreaterThan(0);
    recorder.finish(sim.tick - 1, sim.hash());
    const recording = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(recorder.current()!))));
    const fresh = () => createSimWithWorld(configFromHeader(recording.header, c.road, c.route)).sim;
    const replay = createReplayController(recording).run(fresh());
    expect(replay.desync).toBeNull();
    expect(replay.finalHash).toBe(sim.hash());
    expect(replay.ticks).toBe(sim.tick);
    const tampered = structuredClone(recording);
    const command = tampered.inputs[tamperTick]![0]!;
    command.steer = command.steer === 127 ? -127 : 127;
    expect(createReplayController(tampered).run(fresh()).desync).not.toBeNull();
    process.stdout.write(
      `[examined] Samish junction at tick ${encounter}, branch traffic encountered; ${sim.tick} encoded/reloaded ticks, ${replay.checked} hashes, tamper at ${tamperTick}\n`,
    );
  }, 90000);
});
