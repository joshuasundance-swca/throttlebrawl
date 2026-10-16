/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import {
  buildSimConfig,
  createHeadlessRace,
  createStreamCache,
  resumeFromRecording,
  roadsForHeader,
} from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';
import type { BakedRoad, RoadNetwork } from '../../src/road';
import {
  createInputRecorder,
  decodeReplay,
  encodeReplay,
  HASH_EVERY_TICKS,
  makeReplayKey,
} from '../../src/replay';
import { firstSeed, ISOLATED } from './batch';

const modules = import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' });
const registry = registryFromGlob(modules);
const EVENT = 'region-clinton:clinton-ia136-race';
const ROUTE = 'region-clinton:osm-clinton-eagle-point-run';

function trafficIssue(road: RoadNetwork, pos: { edge: number; s: number; dir: number }): string | null {
  const edge = road.edges[pos.edge]!;
  const lanes = road.lanesAt(pos.edge, pos.s).filter((l) => l.kind === 'drive');
  if (!lanes.some((l) => l.direction === pos.dir)) return `${edge.id}: outside lane direction`;
  // The city's map makes both loops forward-only; check that independently of the bake's lanes.
  if (edge.id !== 'osm-clinton-eagle-entry' && pos.dir !== 1) return `${edge.id}: reverse loop traffic`;
  return null;
}

function race(seed: number, playerBike: string, control: 'full' | 'braking-solo' = 'full') {
  const isolated = control === 'braking-solo';
  const tuning = { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 };
  const { sim, route, config, playerId } = createHeadlessRace(
    {
      seed,
      eventId: EVENT,
      route: ROUTE,
      playerBike,
      ...(isolated ? { tuning, eventPatch: { riders: [] } } : {}),
    },
    { registry },
  );
  expect(config.event.routeId).toBe(ROUTE);
  const bot = createBot();
  const recorder = createInputRecorder();
  recorder.beginRace(sim, makeReplayKey('test-build', 'test-content'));
  let snapshot = sim.snapshot();
  const grid = snapshot.entities.filter((m) => m.kind === 'rider' && m.faction !== 'law');
  for (const rider of grid) {
    const lanes = config.road
      .lanesAt(rider.road.edge, rider.road.s)
      .filter((l) => l.kind === 'drive' && l.direction === 1);
    expect(
      lanes.some((l) => Math.abs(rider.road.d - l.dCenterM) <= l.widthM / 2 - 0.4),
      `grid rider ${rider.contentId}`,
    ).toBe(true);
  }
  const ordered = grid.map((m) => m.road.s).sort((a, b) => a - b);
  for (let i = 1; i < ordered.length; i++) expect(ordered[i]! - ordered[i - 1]!).toBeGreaterThanOrEqual(7.9);
  const problems = new Set<string>();
  const invalidTraffic = new Set<string>();
  const entryDirections = new Set<number>();
  let loopTraffic = 0;
  let finishTick = -1;
  let crashes = 0;
  const crashCauses: Record<string, number> = {};
  const crashSamples: {
    tick: number;
    edge: string;
    s: number;
    d: number;
    speed: number;
    kappa: number;
    drive: boolean;
    data: unknown;
  }[] = [];
  const npcCrashes: Record<string, number> = {};
  const npcCrashSamples: unknown[] = [];
  while (!sim.isOver() && sim.tick < 60 * 60 * 6) {
    const actions = emptyActions();
    bot.drive(snapshot, playerId, route, actions);
    const driver = snapshot.entities[playerId]!;
    if (control === 'braking-solo' && driver.mode === 'Road' && driver.grounded) {
      // A test driver that actually brakes for corners. The stock combat bot never does.
      // Public queries only; conservative 10 m/s² cornering and 4 m/s² braking targets.
      let cap = Infinity;
      for (let distance = 0; distance <= 160; distance += 3) {
        let edgeIndex = config.route.mainEdges.indexOf(driver.road.edge);
        let at = driver.road.s + distance;
        let edge = config.route.mainEdges[edgeIndex]!;
        while (at > route.edgeLength(edge) && edgeIndex + 1 < config.route.mainEdges.length) {
          at -= route.edgeLength(edge);
          edge = config.route.mainEdges[++edgeIndex]!;
        }
        at = Math.min(at, route.edgeLength(edge));
        const turnCap = Math.sqrt(10 / Math.max(Math.abs(route.kappaAt(edge, at)), 1 / 5000));
        cap = Math.min(cap, Math.sqrt(turnCap * turnCap + 8 * distance));
      }
      actions.throttle = driver.speed < cap - 1 ? 1 : 0;
      actions.brake = driver.speed > cap ? 1 : 0;
    }
    const input = toSimInput(actions);
    const tick = sim.tick;
    const before = snapshot.entities[playerId]!;
    const beforeSnapshot = snapshot;
    recorder.record(tick, [input]);
    sim.step([input]);
    if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
    snapshot = sim.snapshot();
    for (const mover of snapshot.entities) {
      const problem = moverProblem(mover, route);
      if (problem) problems.add(problem);
      if (mover.kind === 'vehicle') {
        const edge = config.road.edges[mover.road.edge]!;
        const issue = trafficIssue(config.road, mover.road);
        if (issue) invalidTraffic.add(issue);
        if (edge.id === 'osm-clinton-eagle-entry') entryDirections.add(mover.road.dir);
        else loopTraffic++;
      }
    }
    for (const event of sim.events()) {
      if (event.type === 'crash' && event.actor !== playerId) {
        const npc = snapshot.entities[event.actor ?? -1];
        if (npc?.kind === 'rider' && npc.faction !== 'law') {
          npcCrashes[npc.contentId] = (npcCrashes[npc.contentId] ?? 0) + 1;
          const prior = beforeSnapshot.entities[npc.id]!;
          npcCrashSamples.push({
            id: npc.contentId,
            tick,
            edge: config.road.edges[prior.road.edge]!.id,
            s: prior.road.s,
            d: prior.road.d,
            speed: prior.speed,
            kappa: route.kappaAt(prior.road.edge, prior.road.s),
            playerAlreadyFinished: beforeSnapshot.race.finishOrder.includes(playerId),
            data: event.data,
          });
        }
      }
      if (event.type !== 'crash' || event.actor !== playerId) continue;
      crashes++;
      const cause = String(event.data['cause'] ?? event.data['reason'] ?? 'unspecified');
      crashCauses[cause] = (crashCauses[cause] ?? 0) + 1;
      const edge = config.road.edges[before.road.edge]!;
      const drive = config.road
        .lanesAt(before.road.edge, before.road.s)
        .some((l) => l.kind === 'drive' && Math.abs(before.road.d - l.dCenterM) <= l.widthM / 2);
      crashSamples.push({
        tick,
        edge: edge.id,
        s: before.road.s,
        d: before.road.d,
        speed: before.speed,
        kappa: route.kappaAt(before.road.edge, before.road.s),
        drive,
        data: event.data,
      });
    }
    if (finishTick < 0 && snapshot.race.finishOrder.includes(playerId)) finishTick = sim.tick;
  }
  recorder.finish(sim.tick - 1, sim.hash());
  return {
    finishTick,
    ticks: sim.tick,
    problems: [...problems],
    invalidTraffic: [...invalidTraffic],
    entryDirections: [...entryDirections],
    loopTraffic,
    crashes,
    crashCauses,
    crashSamples,
    npcCrashSamples,
    npc: snapshot.entities
      .filter((e) => e.kind === 'rider' && e.id !== playerId && e.faction !== 'law')
      .map((e) => ({
        id: e.contentId,
        progress: e.progress,
        finished: e.finished,
        crashes: npcCrashes[e.contentId] ?? 0,
      })),
    recording: recorder.current(),
  };
}

describe('Eagle Point: actual narrow-field driving', () => {
  it('detects actual wrong-way traffic in a deliberately reversed-loop control', () => {
    const reversed = registryFromGlob(
      Object.fromEntries(
        Object.entries(modules).map(([path, value]) => {
          const road = value as BakedRoad;
          if (!['osm-clinton-eagle-south-loop', 'osm-clinton-eagle-central-loop'].includes(road.id))
            return [path, value];
          return [
            path,
            {
              ...road,
              laneSections: road.laneSections.map((section) => ({
                ...section,
                lanes: section.lanes.map((lane) =>
                  lane.kind === 'drive' ? { ...lane, direction: -1 } : lane,
                ),
              })),
            },
          ];
        }),
      ),
    );
    // Keep a modified-content control out of createHeadlessRace's shared per-network stream cache.
    const config = buildSimConfig(reversed, createStreamCache().forEvent(reversed, EVENT, undefined, ROUTE), {
      seed: 1,
      eventId: EVENT,
      route: ROUTE,
    });
    const sim = createSim(config);
    const violations = new Set<string>();
    for (let tick = 0; tick < 1800 && violations.size === 0; tick++) {
      sim.step([]);
      for (const mover of sim.snapshot().entities)
        if (mover.kind === 'vehicle') {
          const issue = trafficIssue(config.road, mover.road);
          if (issue) violations.add(issue);
        }
    }
    expect([...violations].some((v) => v.includes('reverse loop traffic'))).toBe(true);
    process.stdout.write(`[negative control] ${[...violations].join(', ')}\n`);
  });

  it('each authored rival can negotiate the real bends alone without crashing', () => {
    const { config, route } = createHeadlessRace({ seed: 1, eventId: EVENT, route: ROUTE }, { registry });
    const rivals = config.riders.filter((r) => r.controller.kind === 'ai');
    expect(rivals.length).toBeGreaterThan(0);
    for (const rider of rivals) {
      const sim = createSim({
        ...config,
        riders: [rider],
        tuning: {
          ...config.tuning,
          ...ISOLATED,
          'ground.offRoad': 1,
          'riders.courseEdges': 1,
        },
      });
      let crashes = 0;
      const problems = new Set<string>();
      for (let tick = 0; tick < 18000; tick++) {
        if (sim.snapshot().entities[0]!.finished) break;
        sim.step([]);
        crashes += sim.events().filter((e) => e.type === 'crash' && e.actor === 0).length;
        const issue = moverProblem(sim.snapshot().entities[0]!, route);
        if (issue) problems.add(issue);
      }
      const me = sim.snapshot().entities[0]!;
      process.stdout.write(
        `[control] solo NPC ${rider.contentId}: tick ${sim.tick}, progress ${me.progress}, finished ${me.finished}, crashes ${crashes}\n`,
      );
      expect(problems).toEqual(new Set());
      expect(me.finished).toBe(true);
      expect(crashes).toBe(0);
    }
  }, 180_000);

  for (const bike of ['base:rustbucket-400', 'base:superbike-1000']) {
    it(`${bike} can finish with real traffic and replay the same route`, () => {
      const found = firstSeed(
        `Eagle Point ${bike} finish with both entry traffic directions`,
        [1, 2, 3, 4],
        (seed) => race(seed, bike),
        (r) =>
          r.finishTick > 0 &&
          r.entryDirections.includes(-1) &&
          r.entryDirections.includes(1) &&
          r.loopTraffic > 0,
      );
      for (const attempt of found.tried) {
        expect(attempt.result.problems).toEqual([]);
        expect(attempt.result.invalidTraffic).toEqual([]);
        expect(attempt.result.npc.length).toBeGreaterThan(0);
        for (const npc of attempt.result.npc) {
          expect(Number.isFinite(npc.progress)).toBe(true);
          expect(npc.finished).toBe(true);
        }
        process.stdout.write(
          `[trial] ${bike} seed ${attempt.seed}: finish ${attempt.result.finishTick}, crashes ${attempt.result.crashes}, causes ${JSON.stringify(attempt.result.crashCauses)}; ${JSON.stringify(attempt.result.crashSamples)}; NPC ${JSON.stringify(attempt.result.npc)}; NPC crashes ${JSON.stringify(attempt.result.npcCrashSamples)}\n`,
        );
      }
      expect(found.result, found.summary).not.toBeNull();
      const result = found.result;
      if (!result?.recording) throw new Error('No Eagle Point finish recording');
      expect(result.entryDirections.sort()).toEqual([-1, 1]);
      expect(result.loopTraffic).toBeGreaterThan(0);
      const saved = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(result.recording))) as unknown);
      const replay = resumeFromRecording(saved, roadsForHeader(registry, createStreamCache()));
      expect(replay.desync).toBeNull();
      expect(replay.checked).toBeGreaterThan(Math.floor(result.finishTick / HASH_EVERY_TICKS) - 1);
      process.stdout.write(
        `[examined] Eagle Point ${bike}: seed ${found.seed}, player finish tick ${result.finishTick}, ${result.crashes} player crashes ${JSON.stringify(result.crashCauses)}, entry traffic both ways, ${result.loopTraffic} forward loop vehicle observations, replay ${replay.checked} checkpoints\n`,
      );
    }, 180_000);
  }

  it('a solo driver that brakes for bends can finish cleanly with real course boundaries on both bikes', () => {
    for (const bike of ['base:rustbucket-400', 'base:superbike-1000']) {
      const result = race(1, bike, 'braking-solo');
      process.stdout.write(
        `[control] braking ${bike} seed1: finish ${result.finishTick}, crash causes ${JSON.stringify(result.crashCauses)}, samples ${JSON.stringify(result.crashSamples)}\n`,
      );
      expect(result.problems).toEqual([]);
      expect(result.finishTick).toBeGreaterThan(0);
      expect(result.crashes).toBe(0);
    }
  }, 180_000);
});
