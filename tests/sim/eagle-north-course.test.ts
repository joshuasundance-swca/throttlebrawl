/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, createStreamCache, resumeFromRecording, roadsForHeader } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { courseAt, raceStructures } from '../../src/road';
import {
  createInputRecorder,
  decodeReplay,
  encodeReplay,
  HASH_EVERY_TICKS,
  makeReplayKey,
} from '../../src/replay';
import { firstSeed, ISOLATED } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const EVENT = 'region-clinton:clinton-ia136-race';
const ROUTE = 'region-clinton:osm-clinton-eagle-north-run';
const NORTH = 'osm-clinton-eagle-north-loop';

function race(seed: number, playerBike: string, braking: boolean) {
  const { sim, route, config, playerId } = createHeadlessRace(
    {
      seed,
      eventId: EVENT,
      route: ROUTE,
      playerBike,
      ...(braking
        ? {
            tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 },
            eventPatch: { riders: [] },
          }
        : {}),
    },
    { registry },
  );
  const bot = createBot();
  const recorder = createInputRecorder();
  recorder.beginRace(sim, makeReplayKey('test-build', 'test-content'));
  let snapshot = sim.snapshot();
  let finishTick = -1;
  let northTraffic = 0;
  let crashes = 0;
  let brakeTicks = 0;
  const problems = new Set<string>();
  const trafficErrors = new Set<string>();
  const causes: string[] = [];
  while (!sim.isOver() && sim.tick < 60 * 60 * 6) {
    const actions = emptyActions();
    bot.drive(snapshot, playerId, route, actions);
    const driver = snapshot.entities[playerId]!;
    if (braking && driver.mode === 'Road' && driver.grounded) {
      let cap = Infinity;
      for (let distance = 0; distance <= 160; distance += 3) {
        let index = config.route.mainEdges.indexOf(driver.road.edge);
        let at = driver.road.s + distance;
        let edge = config.route.mainEdges[index]!;
        while (at > route.edgeLength(edge) && index + 1 < config.route.mainEdges.length) {
          at -= route.edgeLength(edge);
          edge = config.route.mainEdges[++index]!;
        }
        at = Math.min(at, route.edgeLength(edge));
        const turnCap = Math.sqrt(10 / Math.max(Math.abs(route.kappaAt(edge, at)), 1 / 5000));
        cap = Math.min(cap, Math.sqrt(turnCap * turnCap + 8 * distance));
      }
      actions.throttle = driver.speed < cap - 1 ? 1 : 0;
      actions.brake = driver.speed > cap ? 1 : 0;
    }
    const input = toSimInput(actions);
    if (actions.brake > 0) brakeTicks++;
    const tick = sim.tick;
    recorder.record(tick, [input]);
    sim.step([input]);
    if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
    snapshot = sim.snapshot();
    for (const mover of snapshot.entities) {
      const problem = moverProblem(mover, route);
      if (problem) problems.add(problem);
      if (mover.kind === 'vehicle') {
        const road = config.road.edges[mover.road.edge]!;
        const lanes = config.road
          .lanesAt(mover.road.edge, mover.road.s)
          .filter((lane) => lane.kind === 'drive');
        if (!lanes.some((lane) => lane.direction === mover.road.dir))
          trafficErrors.add(`${road.id}: lane direction`);
        if (mover.road.dir !== 1) trafficErrors.add(`${road.id}: reverse loop traffic`);
        if (road.id === NORTH) northTraffic++;
      }
    }
    for (const event of sim.events())
      if (event.type === 'crash' && event.actor === playerId) {
        crashes++;
        causes.push(String(event.data['cause'] ?? event.data['reason'] ?? 'unspecified'));
      }
    if (finishTick < 0 && snapshot.race.finishOrder.includes(playerId)) finishTick = sim.tick;
  }
  recorder.finish(sim.tick - 1, sim.hash());
  return {
    finishTick,
    ticks: sim.tick,
    northTraffic,
    crashes,
    brakeTicks,
    causes,
    problems: [...problems],
    trafficErrors: [...trafficErrors],
    recording: recorder.current(),
  };
}

describe('Eagle Point northern arc: ordinary motorcycles', () => {
  it('the normal UI field traverses the northern arm before finishing after crash recovery', () => {
    const { sim, route, config, playerId } = createHeadlessRace(
      {
        seed: 1,
        eventId: EVENT,
        route: ROUTE,
        playerBike: 'base:rustbucket-400',
        freePlay: true,
        rivals: 4,
        difficulty: 'normal',
        assists: [{ steer: 'off', autoThrottle: false, steerStyle: 'arcade' }],
      },
      { registry },
    );
    const north = config.road.edgeIndex(NORTH);
    const length = config.road.edges[north]!.length;
    const stations = [0.1, 0.35, 0.6, 0.85].map((fraction) => length * fraction);
    const visited = stations.map(() => false);
    const plan = raceStructures(config.road, config.seed);
    let legalEarlyNorth = false;
    const bot = createBot();
    const recorder = createInputRecorder();
    recorder.beginRace(sim, makeReplayKey('test-build', 'test-content'));
    let snapshot = sim.snapshot();
    let finishTick = -1;
    let travelledM = 0;
    const transitions: unknown[] = [];
    const unearnedProgress: unknown[] = [];
    const footprintLengthM = snapshot.entities[playerId]?.footprintLengthM;
    expect(footprintLengthM, 'the reproduced rider has a physical bike footprint').toBeGreaterThan(0);
    if (footprintLengthM === undefined) throw new Error('Missing player bike footprint');
    const position = (m: (typeof snapshot.entities)[number]) => ({
      mode: m.mode,
      road: m.road,
      x: m.x,
      y: m.y,
      z: m.z,
      progress: m.progress,
      grounded: m.grounded,
    });
    process.stdout.write(
      `[UI reproduction config] ${JSON.stringify({ seed: config.seed, event: config.event, riders: config.riders.map((rider) => ({ id: rider.contentId, controller: rider.controller.kind, bike: rider.bike.contentId })), difficulty: config.difficulty, slots: config.slots, speedMultiplier: config.speedMultiplier })}\n`,
    );
    while (!sim.isOver() && sim.tick < 60 * 60 * 6) {
      const actions = emptyActions();
      bot.drive(snapshot, playerId, route, actions);
      const before = snapshot.entities[playerId]!;
      const input = toSimInput(actions);
      const tick = sim.tick;
      recorder.record(tick, [input]);
      sim.step([input]);
      if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
      snapshot = sim.snapshot();
      const after = snapshot.entities[playerId]!;
      const stepM = Math.hypot(after.x - before.x, after.z - before.z);
      travelledM += stepM;
      const jump = after.progress - before.progress;
      const outsidePavement =
        after.road.d < config.road.vergeAt(after.road.edge, after.road.s, 'left').dOuter ||
        after.road.d > config.road.vergeAt(after.road.edge, after.road.s, 'right').dOuter;
      if (
        before.mode === 'Tumble' &&
        after.mode === 'Tumble' &&
        outsidePavement &&
        stepM < footprintLengthM &&
        jump > config.route.length / 2
      ) {
        unearnedProgress.push({
          tick: sim.tick,
          jump,
          stepM,
          before: position(before),
          after: position(after),
        });
      }
      if (
        after.mode !== before.mode ||
        Math.abs(jump) > 10 ||
        sim.events().some((event) => event.type === 'crash' && event.actor === playerId)
      ) {
        transitions.push({
          tick: sim.tick,
          jump,
          stepM,
          before: position(before),
          after: position(after),
          events: sim.events().filter((event) => event.actor === playerId),
        });
      }
      if (after.mode === 'Road' && after.grounded && after.road.edge === north && after.road.dir === 1) {
        if (after.road.s >= 100 && after.road.s <= 180 && Math.abs(after.road.d) < 1.5)
          legalEarlyNorth = true;
        // The course contract permits authored natural terrain beside the pavement. Require
        // physical corridor traversal and actual course support, not four lucky centreline poses.
        const spot = courseAt(config.road, plan, after.road, after.y);
        stations.forEach((station, i) => {
          const f = config.road.frameAt(north, station);
          const dx = after.x - f.x;
          const dz = after.z - f.z;
          const along = dx * f.tx + dz * f.tz;
          const across = -dx * f.tz + dz * f.tx;
          if (spot.kind !== 'out' && along >= 0 && along < 80 && Math.abs(across) < 30) visited[i] = true;
        });
      }
      if (snapshot.race.finishOrder.includes(playerId)) {
        finishTick = sim.tick;
        break;
      }
    }
    process.stdout.write(
      `[UI north traversal] ${JSON.stringify({ playerId, finishTick, travelledM, stations, visited, legalEarlyNorth, transitions, unearnedProgress })}\n`,
    );
    expect(finishTick).toBeGreaterThan(0);
    expect(legalEarlyNorth, 'the original legal early-north Road/grounded/forward probe').toBe(true);
    expect(
      unearnedProgress,
      'an off-pavement tumble cannot gain half the course while moving less than one bike length',
    ).toEqual([]);
    expect(
      visited,
      'a recorded finish must actually traverse the northern arm, not gain its length through projection',
    ).toEqual(stations.map(() => true));
    recorder.finish(sim.tick - 1, sim.hash());
    const recording = recorder.current();
    if (!recording) throw new Error('No crash recovery recording');
    const saved = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(recording))) as unknown);
    const replay = resumeFromRecording(saved, roadsForHeader(registry, createStreamCache()));
    expect(replay.desync).toBeNull();
    expect(replay.checked).toBeGreaterThan(Math.floor(finishTick / HASH_EVERY_TICKS) - 1);
  }, 180_000);
  for (const bike of ['base:rustbucket-400', 'base:superbike-1000']) {
    it(`${bike} finishes with forward northern traffic and replays deterministically`, () => {
      const found = firstSeed(
        `North Run ${bike} finish and northern traffic`,
        [1, 2, 3, 4],
        (seed) => race(seed, bike, false),
        (result) => result.finishTick > 0 && result.northTraffic > 0,
      );
      for (const attempt of found.tried) {
        expect(attempt.result.problems).toEqual([]);
        expect(attempt.result.trafficErrors).toEqual([]);
        process.stdout.write(
          `[north trial] ${bike} seed ${attempt.seed}: finish ${attempt.result.finishTick}, crashes ${attempt.result.crashes}, causes ${JSON.stringify(attempt.result.causes)}, north vehicle observations ${attempt.result.northTraffic}\n`,
        );
      }
      expect(found.result, found.summary).not.toBeNull();
      const result = found.result;
      if (!result?.recording) throw new Error('No northern finish recording');
      const saved = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(result.recording))) as unknown);
      const replay = resumeFromRecording(saved, roadsForHeader(registry, createStreamCache()));
      expect(replay.desync).toBeNull();
      expect(replay.checked).toBeGreaterThan(Math.floor(result.finishTick / HASH_EVERY_TICKS) - 1);
      process.stdout.write(`[north replay] ${bike}: ${replay.checked} matching checkpoints\n`);
    }, 180_000);
  }
  it('braking for bends finishes cleanly with real boundaries on both ordinary bikes', () => {
    for (const bike of ['base:rustbucket-400', 'base:superbike-1000']) {
      const result = race(1, bike, true);
      process.stdout.write(
        `[north braking control] ${bike}: finish ${result.finishTick}, crashes ${result.crashes}, causes ${JSON.stringify(result.causes)}\n`,
      );
      expect(result.problems).toEqual([]);
      expect(result.finishTick).toBeGreaterThan(0);
      expect(result.crashes).toBe(0);
      expect(result.brakeTicks).toBeGreaterThan(0);
    }
  }, 180_000);
});
