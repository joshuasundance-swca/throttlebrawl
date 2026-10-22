/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, resumeFromRecording, roadsForHeader } from '../../src/app';
import { quickPlaySetup } from '../../src/app/quick-play-events';
import { createRaceLog, eventPlan } from '../../src/career';
import { registryFromGlob } from '../../src/content';
import { createInputRecorder, HASH_EVERY_TICKS, makeReplayKey } from '../../src/replay';
import { DEFAULT_RACE_OPTIONS } from '../../src/save';
import { createSim, quantizeInput, type EntitySnapshot } from '../../src/sim/api';
import { firstSeed } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const EVENT = 'region-clinton:clinton-mara-survey-run';
const MARA = 'region-clinton:mara-vale';
const BIKES = ['base:rustbucket-400', 'base:superbike-1000'] as const;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Signed separating-axis clearance of the two actual yawed body rectangles, in metres. */
function bodyGap(a: EntitySnapshot, b: EntitySnapshot): number {
  const axes = (e: EntitySnapshot) =>
    [
      [Math.sin(e.heading), Math.cos(e.heading)],
      [Math.cos(e.heading), -Math.sin(e.heading)],
    ] as const;
  const aa = axes(a),
    bb = axes(b);
  const radius = (e: EntitySnapshot, basis: ReturnType<typeof axes>, x: number, z: number) =>
    (Math.abs(basis[0][0] * x + basis[0][1] * z) * e.footprintLengthM!) / 2 +
    (Math.abs(basis[1][0] * x + basis[1][1] * z) * e.footprintWidthM!) / 2;
  return Math.max(
    ...[...aa, ...bb].map(
      ([x, z]) => Math.abs((a.x - b.x) * x + (a.z - b.z) * z) - radius(a, aa, x, z) - radius(b, bb, x, z),
    ),
  );
}

function configFor(seed: number, bike: string) {
  const setup = quickPlaySetup(
    registry,
    EVENT,
    { ...DEFAULT_RACE_OPTIONS, bike },
    { owned: [], current: null },
    'open',
    seed,
    'normal',
    {},
  );
  return buildSimConfig(registry, createStreamCache().forEvent(registry, EVENT), {
    seed,
    eventId: EVENT,
    ...setup,
  });
}

function ride(seed: number, bike: string, lose = false) {
  const config = configFor(seed, bike);
  const sim = createSim(config);
  const player = config.riders.findIndex((r) => r.controller.kind === 'player');
  const rival = config.riders.findIndex((r) => r.contentId === MARA);
  const plan = eventPlan(registry, EVENT);
  const log = createRaceLog({
    playerId: player,
    rules: plan.rules,
    objectives: plan.objectives,
    routeId: config.event.routeId!,
    roadIds: config.road.edges.map((e) => e.id),
  });
  const recorder = createInputRecorder();
  recorder.beginRace(sim, makeReplayKey('test-build', 'test-content'));
  let snapshot = sim.snapshot();
  log.note([], snapshot);
  let phase: 'let-pass' | 'follow' | 'pass' | 'race' = 'let-pass';
  let followingS = 0;
  let passed = false;
  let traffic = false;
  let law = false;
  let rivalProgress = 0;
  let earlyWin = false;
  const crashes: unknown[] = [];
  const contact: unknown[] = [];
  const passingContact: unknown[] = [];
  const rivalContact: unknown[] = [];
  let minRivalClearance = Infinity;
  let passGrounded = true;
  const transitions: unknown[] = [];
  for (; sim.tick < 60 * 60 * 6;) {
    const me = snapshot.entities[player]!;
    const mara = snapshot.entities[rival]!;
    if (me.finished || (lose && mara.finished)) break;
    const at = me.road;
    const lanes = config.road.lanesAt(at.edge, at.s);
    const lane = lanes.find((l) => l.kind === 'drive' && l.direction === at.dir)!;
    const gap = mara.progress - me.progress;
    const entry = config.route.mainEdges[0] === at.edge;
    let target = lane.dCenterM;
    let cap = Infinity;
    // A deliberate driver brakes for the actual bends; top speed is not a hairpin contract.
    for (let ahead = 0; ahead <= 120; ahead += 4) {
      let index = config.route.mainEdges.indexOf(at.edge);
      let s = at.s + ahead;
      let edge = config.route.mainEdges[index]!;
      while (s > config.route.edgeLength(edge) && index + 1 < config.route.mainEdges.length) {
        s -= config.route.edgeLength(edge);
        edge = config.route.mainEdges[++index]!;
      }
      const corner = Math.sqrt(10 / Math.max(Math.abs(config.road.kappaAt(edge, s)), 1 / 5000));
      cap = Math.min(cap, Math.sqrt(corner * corner + 8 * ahead));
    }
    if (phase === 'let-pass') {
      target = entry ? lane.dCenterM + lane.widthM / 2 : target;
      cap = 0;
      if (gap > 8) phase = 'follow';
    }
    if (phase === 'follow') {
      if (gap > 5 && gap < 35 && me.speed > 5 && mara.speed > 5 && me.grounded && mara.grounded)
        followingS += snapshot.timeScale / 60;
      cap = Math.min(cap, Math.max(0, mara.speed + 0.8 * (gap - 12)));
      if (!lose && followingS >= 1) phase = 'pass';
    }
    if (phase === 'pass') {
      // Establish the inside of the existing entry lane before accelerating past the rival.
      // Its whole bike remains on this side of the centreline; oncoming traffic keeps its lane.
      target = entry ? lane.dCenterM - lane.widthM / 2 + 0.5 : lane.dCenterM - 1;
      if (Math.abs(at.d - target) > 0.2) cap = Math.min(cap, mara.speed);
      if (gap < -5) {
        passed = true;
        phase = 'race';
      }
    }
    if (phase === 'follow' || phase === 'pass') {
      minRivalClearance = Math.min(minRivalClearance, bodyGap(me, mara));
      passGrounded &&= me.grounded && mara.grounded;
    }
    const blockers = snapshot.entities.filter(
      (e) =>
        e.kind === 'vehicle' &&
        e.road.edge === at.edge &&
        Math.abs(e.road.d - target) < (e.footprintWidthM! + me.footprintWidthM!) / 2 + 0.5 &&
        e.road.s - at.s > -3 &&
        e.road.s - at.s < 60,
    );
    for (const vehicle of blockers) {
      const closing = vehicle.road.dir === at.dir ? vehicle.speed : -vehicle.speed;
      cap = Math.min(cap, Math.max(0, closing + 0.6 * (vehicle.road.s - at.s - 12)));
    }
    const steer = clamp(
      0.35 * (target - at.d) - 3 * at.yaw + (config.road.kappaAt(at.edge, at.s) * me.speed ** 2) / 22,
      -1,
      1,
    );
    const command = quantizeInput({
      throttle: me.speed < cap - 0.5 ? 1 : 0,
      brake: me.speed > cap ? 1 : 0,
      steer,
      flags: 0,
    });
    const tick = sim.tick;
    recorder.record(tick, [command]);
    sim.step([command]);
    if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
    snapshot = sim.snapshot();
    const events = sim.events();
    log.note(events, snapshot);
    earlyWin ||= log.status().state === 'won' && !snapshot.entities[player]!.finished;
    traffic ||= snapshot.entities.some((e) => e.kind === 'vehicle');
    law ||= snapshot.entities.some((e) => e.faction === 'law');
    rivalProgress = Math.max(rivalProgress, snapshot.entities[rival]!.progress);
    for (const event of events) {
      if (event.type === 'crash' && event.actor === player) crashes.push({ tick, at, data: event.data });
      if (
        (event.actor === player || event.target === player) &&
        (event.type === 'hit' ||
          (event.type === 'wobble' && (event.data['cause'] === 'rider' || event.data['cause'] === 'traffic')))
      ) {
        const sample = {
          tick,
          phase,
          actor: event.actor,
          target: event.target,
          type: event.type,
          data: event.data,
          me: at,
          mara: mara.road,
        };
        contact.push(sample);
        if (phase === 'follow' || phase === 'pass') passingContact.push(sample);
        if (event.actor === rival || event.target === rival) rivalContact.push(sample);
      }
    }
    if (transitions.length === 0 || (transitions.at(-1) as { phase: string }).phase !== phase)
      transitions.push({ tick, phase, s: at.s, gap, speed: me.speed });
    if (crashes.length || log.tally().busted) break;
  }
  recorder.finish(sim.tick - 1, sim.hash());
  return {
    seed,
    bike,
    ticks: sim.tick,
    followingS,
    passed,
    traffic,
    law,
    rivalProgress,
    earlyWin,
    crashes,
    contact,
    passingContact,
    rivalContact,
    transitions,
    minRivalClearance,
    passGrounded,
    status: log.status(),
    tally: log.tally(),
    me: snapshot.entities[player]!,
    mara: snapshot.entities[rival]!,
    recording: recorder.current(),
  };
}

describe('Mara’s Eagle Point finish-ahead encounter', () => {
  it('loads the authored named challenge before driving it', () => {
    expect(registry.events[EVENT]?.kind).toBe('grudge-match');
  });

  it('the carried finish-ahead objective distinguishes win, loss and unfinished combat', () => {
    const config = configFor(1, BIKES[0]);
    const snapshot = createSim(config).snapshot();
    const player = config.riders.findIndex((r) => r.role === 'player');
    const rival = config.riders.findIndex((r) => r.contentId === MARA);
    const plan = eventPlan(registry, EVENT);
    const make = () => {
      const log = createRaceLog({
        playerId: player,
        rules: plan.rules,
        objectives: plan.objectives,
        routeId: config.event.routeId!,
        roadIds: config.road.edges.map((e) => e.id),
      });
      log.note([], snapshot);
      return log;
    };
    const unfinished = make();
    unfinished.note([{ type: 'takedown', actor: player, target: rival, tick: 1, data: {} }], snapshot);
    expect(unfinished.status().state).toBe('running');
    expect(unfinished.status().endNow).toBe(false);
    const won = make();
    won.note([{ type: 'finish', actor: player, tick: 1, data: { place: 1 } }], snapshot);
    expect(won.status().state).toBe('won');
    const lost = make();
    lost.note([{ type: 'finish', actor: rival, tick: 1, data: { place: 1 } }], snapshot);
    lost.note([{ type: 'finish', actor: player, tick: 2, data: { place: 2 } }], snapshot);
    expect(lost.status().state).toBe('lost');
  });

  for (const bike of BIKES)
    it(`${bike} follows Mara, passes cleanly and finishes with ordinary traffic and law`, () => {
      const found = firstSeed(
        `Mara clean follow/pass ${bike}`,
        [1, 2, 3, 4],
        (seed) => ride(seed, bike),
        (r) =>
          r.passed &&
          r.me.finished &&
          r.traffic &&
          r.law &&
          r.crashes.length === 0 &&
          !r.tally.busted &&
          r.passingContact.length === 0 &&
          r.rivalContact.length === 0 &&
          r.minRivalClearance > 0 &&
          r.passGrounded &&
          r.status.state === 'won',
      );
      for (const { result } of found.tried)
        process.stdout.write(
          `[Mara ride] ${JSON.stringify({ seed: result.seed, bike, ticks: result.ticks, followingS: result.followingS, passed: result.passed, traffic: result.traffic, law: result.law, crashes: result.crashes, busted: result.tally.busted, contactCount: result.contact.length, firstContact: result.contact[0], passingContact: result.passingContact, rivalContact: result.rivalContact, minRivalClearanceM: result.minRivalClearance, passGrounded: result.passGrounded, transitions: result.transitions, state: result.status.state, playerProgress: result.me.progress, rivalProgress: result.mara.progress })}\n`,
        );
      expect(found.result, found.summary).not.toBeNull();
      const result = found.result!;
      expect(result.followingS).toBeGreaterThanOrEqual(1);
      expect(result.status.state).toBe('won');
      expect(result.earlyWin).toBe(false);
      expect(result.crashes).toEqual([]);
      expect(result.tally.busted).toBe(false);
      // Police may pursue and make contact later. The named racing pass itself is clean.
      expect(result.rivalContact).toEqual([]);
      expect(result.passingContact).toEqual([]);
      expect(result.minRivalClearance).toBeGreaterThan(0);
      expect(result.passGrounded).toBe(true);
      expect(result.rivalProgress).toBeGreaterThan(0);
      expect(Number.isFinite(result.rivalProgress)).toBe(true);
      expect(result.tally.takedowns).toBe(0);
      const replay = resumeFromRecording(result.recording!, roadsForHeader(registry, createStreamCache()));
      expect(replay.desync).toBeNull();
      expect(replay.checked).toBeGreaterThan(0);
      expect(replay.sim.tick).toBe(result.ticks);
      expect(replay.sim.snapshot().entities.find((e) => e.id === result.me.id)?.finished).toBe(true);
    }, 120_000);

  it('actually loses when the player follows rather than passing before Mara finishes', () => {
    const found = firstSeed(
      'Mara finishes ahead of a following player',
      [1, 2, 3, 4],
      (seed) => ride(seed, BIKES[0], true),
      (r) => r.mara.finished && r.crashes.length === 0 && !r.tally.busted,
    );
    expect(found.result, found.summary).not.toBeNull();
    const result = found.result!;
    expect(result.followingS).toBeGreaterThanOrEqual(1);
    expect(result.passed).toBe(false);
    expect(result.earlyWin).toBe(false);
    expect(result.me.finished).toBe(false);
    expect(result.status.state).toBe('lost');
    expect(result.status.objectives.find((o) => o.kind === 'beat-rival')?.met).toBe(false);
  }, 120_000);
});
