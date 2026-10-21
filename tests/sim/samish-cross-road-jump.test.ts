import { describe, expect, it } from 'vitest';
import { buildSimConfig, realRoutes, streamForEvent } from '../../src/app/config';
import { regionChoices } from '../../src/app/regions';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev/bot';
import { emptyActions, toSimInput } from '../../src/input';
import {
  configFromHeader,
  createInputRecorder,
  createReplayController,
  decodeReplay,
  encodeReplay,
  HASH_EVERY_TICKS,
} from '../../src/replay';
import { neutralInput, quantizeInput, type RouteProgress } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { placeRoadVehicle } from '../../src/sim/traffic/path-view';
import { trafficState } from '../../src/sim/traffic';
import source from '../../tools/gis/networks/osm-pnw-samish.json';
import { ISOLATED } from './batch';

const all = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const route = 'region-pnw:osm-i5-samish-run';
const event = regionChoices(all).find((c) => realRoutes(all, c.eventId).includes(route))!.eventId;
const main = 'osm-i5-lake-samish';
const shore = 'osm-samish-east-shore';
const featureId = 'samish-i5-shore-jump';

function race() {
  const built = buildSimConfig(all, streamForEvent(all, event, undefined, route), {
    seed: 1,
    eventId: event,
    route,
    tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 },
  });
  return { ...built, riders: built.riders.filter((r) => r.controller.kind === 'player') };
}

function approach(startD: number, speed: number, steerInAir: number, startOffset = 20) {
  const config = race();
  const edge = config.road.edgeIndex(main);
  const ramp = config.road.edges[edge]!.features.find((f) => f.id === featureId)!;
  const { sim, world } = createSimWithWorld(config);
  const player = world.movers.find((m) => config.riders[m.riderIndex]?.controller.kind === 'player')!;
  expect(config.riders[player.riderIndex]?.bike.contentId).toBe('base:rustbucket-400');
  player.pos = { edge, s: ramp.s0 - startOffset, d: startD, dir: 1 };
  player.speed = speed;
  const events: { type: string; data: Record<string, unknown>; edge: number }[] = [];
  let launched = false;
  let handed = false;
  let landedOnShore = false;
  for (let tick = 0; tick < 360; tick++) {
    sim.step([quantizeInput({ throttle: 1, brake: 0, steer: launched ? steerInAir : 0, flags: 0 })]);
    for (const e of sim.events())
      if (e.actor === player.id) events.push({ type: e.type, data: e.data, edge: player.pos.edge });
    launched ||= events.some((e) => e.type === 'jump');
    handed ||= player.pos.edge === config.road.edgeIndex(shore);
    landedOnShore ||=
      handed && events.some((e) => e.type === 'land' && e.edge === config.road.edgeIndex(shore));
    if (landedOnShore || events.some((e) => e.type === 'crash') || player.pos.s > ramp.s1 + 180) break;
  }
  return { config, sim, player, events, launched, handed, landedOnShore };
}

describe('Samish I-5 to shore jump', () => {
  it('has room for a slower committed line and a fast partial steer', () => {
    for (const [speed, steer] of [
      [30, 0.75],
      [44, 0.5],
    ] as const) {
      const out = approach(12.5, speed, steer);
      expect(out.landedOnShore, `${speed} m/s approach, ${steer} right air steer`).toBe(true);
      expect(out.events.some((e) => e.type === 'crash')).toBe(false);
    }
  });
  it('authors one fixed visible launch on the race road', () => {
    const named = source.lines.flatMap((line) => line.roads).find((road) => road.id === main);
    const authored = (
      named as { features?: readonly { id: string; kind: string }[] } | undefined
    )?.features?.find((f) => f.id === featureId);
    const config = race();
    const baked = config.road.edges[config.road.edgeIndex(main)]!.features.find((f) => f.id === featureId);
    expect(authored?.kind).toBe('rampTruck');
    expect(baked).toMatchObject({ kind: 'rampTruck', id: featureId });
    expect(config.route.allows(config.road.edgeIndex(shore))).toBe(true);
    const edge = config.road.edgeIndex(main);
    const drive = config.road
      .lanesAt(edge, baked!.s0)
      .filter((lane) => lane.kind === 'drive' && lane.direction === 1);
    const widestTraffic = Math.max(...config.trafficTypes.map((type) => type.widthM));
    expect(drive.length).toBeGreaterThan(0);
    for (const lane of drive) expect(lane.dCenterM + widestTraffic / 2).toBeLessThan(baked!.d0);
    expect(baked!.d1).toBeLessThan(config.road.vergeAt(edge, baked!.s0, 'right').dOuter);
  });

  it('launches a Rustbucket with steering onto the allowed shore road', () => {
    const out = approach(12.5, 38, 1);
    expect(out.launched).toBe(true);
    expect(out.handed).toBe(true);
    expect(out.landedOnShore).toBe(true);
    expect(out.events.some((e) => e.type === 'crash')).toBe(false);
    expect(out.events.some((e) => e.type === 'lapOrCheckpoint' && e.data['checkpoint'] === 1)).toBe(true);
    expect(out.player.pos.edge).toBe(out.config.road.edgeIndex(shore));
  });

  it('keeps a straight launch, a missed truck, and a slow attempt off the shore road', () => {
    const straight = approach(12.5, 38, 0);
    const missed = approach(8, 38, 1);
    const slow = approach(12.5, 8, 1, 5);
    expect(straight.launched).toBe(true);
    expect(straight.handed).toBe(false);
    expect(missed.launched).toBe(false);
    expect(missed.handed).toBe(false);
    expect(slow.handed).toBe(false);
    expect(slow.events.some((e) => e.type === 'crash')).toBe(true);
  });

  it('keeps an ordinary I-5 car physically clear of the fixed shoulder truck', () => {
    const config = race();
    const edge = config.road.edgeIndex(main);
    const ramp = config.road.edges[edge]!.features.find((f) => f.id === featureId)!;
    const type = config.trafficTypes.findIndex((t) => t.category === 'car' && t.cruiseMps > 0);
    expect(type).toBeGreaterThanOrEqual(0);
    const { sim, world } = createSimWithWorld(config);
    const slot = placeRoadVehicle(world, config, {
      type,
      pos: { edge, s: ramp.s0 - 90, d: 8, dir: 1 },
      v0: 22,
      speed: 22,
    });
    const id = trafficState(world).id[slot]!;
    let passing = 0;
    for (let tick = 0; tick < 600; tick++) {
      sim.step([neutralInput()]);
      const car = world.movers[id]!;
      if (car.pos.edge === edge && car.pos.s >= ramp.s0 && car.pos.s <= ramp.s1) {
        passing++;
        expect(car.pos.d + config.trafficTypes[type]!.widthM / 2).toBeLessThan(ramp.d0);
      }
      if (car.pos.edge !== edge || car.pos.s > ramp.s1 + 10) break;
    }
    expect(passing).toBeGreaterThan(0);
  });

  it('records a start-to-finish steered crossing and replays its landing and route state', () => {
    const config = race();
    const { sim, world } = createSimWithWorld(config);
    const player = world.movers.find((m) => config.riders[m.riderIndex]?.controller.kind === 'player')!;
    const edge = config.road.edgeIndex(main);
    const shoreEdge = config.road.edgeIndex(shore);
    const ramp = config.road.edges[edge]!.features.find((f) => f.id === featureId)!;
    const bot = createBot();
    const mainlineBotRoute: RouteProgress = { ...config.route, shortcuts: [] };
    const recorder = createInputRecorder();
    recorder.beginRace(sim, 'samish-jump-code+content');
    let jumped = false;
    let handed = false;
    let landed = false;
    let rejoined = false;
    let crashes = 0;
    let physicalFinish = false;
    const checkpoints: number[] = [];
    const marks: unknown[] = [];
    while (!sim.isOver() && sim.tick < 60 * 240) {
      const actions = emptyActions();
      bot.drive(sim.snapshot(), player.id, mainlineBotRoute, actions);
      if (player.pos.edge === edge && player.pos.s >= ramp.s0 - 150 && !jumped) {
        const target = (ramp.d0 + ramp.d1) / 2;
        const kappa = config.road.kappaAt(edge, player.pos.s);
        actions.throttle = 1;
        actions.brake = 0;
        actions.steer = Math.max(
          -1,
          Math.min(
            1,
            0.35 * (target - player.pos.d) - 2.5 * player.yaw + (kappa * player.speed * player.speed) / 22,
          ),
        );
      } else if (jumped && !landed) actions.steer = 1;
      const input = toSimInput(actions);
      const tick = sim.tick;
      recorder.record(tick, [input]);
      sim.step([input]);
      if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
      jumped ||= sim
        .events()
        .some((e) => e.actor === player.id && e.type === 'jump' && player.pos.edge === edge);
      for (const e of sim.events())
        if (e.actor === player.id && ['jump', 'land', 'crash', 'finish'].includes(e.type))
          marks.push({ type: e.type, data: e.data, pos: { ...player.pos }, speed: player.speed });
      for (const e of sim.events())
        if (e.actor === player.id && e.type === 'lapOrCheckpoint')
          checkpoints.push(Number(e.data['checkpoint']));
      physicalFinish ||= sim
        .events()
        .some((e) => e.actor === player.id && e.type === 'finish' && e.data['classified'] === false);
      handed ||= player.pos.edge === shoreEdge;
      landed ||=
        handed &&
        sim.events().some((e) => e.actor === player.id && e.type === 'land' && player.pos.edge === shoreEdge);
      rejoined ||= landed && config.route.mainEdges.includes(player.pos.edge) && player.pos.edge !== edge;
      crashes += sim.events().filter((e) => e.actor === player.id && e.type === 'crash').length;
    }
    process.stdout.write(
      `[samish full crossing] ${JSON.stringify({ tick: sim.tick, jumped, handed, landed, crashes, finish: sim.snapshot().race.finishOrder, pos: player.pos, marks })}\n`,
    );
    expect(jumped).toBe(true);
    expect(handed).toBe(true);
    expect(landed).toBe(true);
    expect(rejoined).toBe(true);
    expect(crashes).toBe(0);
    expect(sim.snapshot().race.finishOrder).toContain(player.id);
    expect(checkpoints).toEqual(config.route.checkpoints.map((_checkpoint, i) => i));
    expect(physicalFinish).toBe(true);
    recorder.finish(sim.tick - 1, sim.hash());
    const saved = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(recorder.current()!))));
    const replay = createReplayController(saved).run(
      createSimWithWorld(configFromHeader(saved.header, config.road, config.route)).sim,
    );
    expect(replay.desync).toBeNull();
    expect(replay.finalHash).toBe(sim.hash());
  }, 120_000);
});
