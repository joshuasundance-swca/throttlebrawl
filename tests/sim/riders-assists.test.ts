/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import {
  configFromHeader,
  createInputRecorder,
  createReplayController,
  makeReplayKey,
} from '../../src/replay';
import {
  createSim,
  quantizeInput,
  type EntitySnapshot,
  type RouteProgress,
  type Sim,
} from '../../src/sim/api';
import { SPEED_MULTIPLIER_MIN } from '../../src/sim/riders';

// riders-4 acceptance, sim tier (docs/milestones/M2.md, "riders-4 · Assists and lower overall
// speed"), on the base pack's real baked track with the real riding model:
// - a 0.8 speed multiplier makes the bot's route time about 1/0.8 as long, within 5 %;
// - at the minimum multiplier the bot still takes the boat-ramp shortcut and lands clean;
// - the assists and the multiplier are in the replay header and reproduce their hashes.
// Like road-2's timing test, the timed runs leave out traffic and the cop and keep rivals from
// swinging, so they time the road and the riding model, not fights.

const blank = (): ActionState => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  attack: false,
  attackSide: 0,
  kick: false,
  lookBack: false,
  skipRunBack: false,
});

type RaceSetup = NonNullable<Parameters<typeof createHeadlessRace>[0]>;

const QUIET = { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0, 'ai.aggressionScale': 0 };

function quietRace(setup: Partial<RaceSetup>) {
  const base = createHeadlessRace({ seed: 11, ...setup, tuning: { ...QUIET, ...setup.tuning } });
  // The cop rides last on the grid, so leaving him out moves no other id.
  const config = { ...base.config, riders: base.config.riders.filter((r) => r.faction !== 'law') };
  return { sim: createSim(config), route: config.route, playerId: base.playerId };
}

/** road-2's shortcut rider: the stub bot's lane-keeping, aiming for the split zone when asked. */
function drive(me: EntitySnapshot, route: RouteProgress, a: ActionState): void {
  const { edge, s, d, dir, yaw } = me.road;
  const v = Math.max(me.speed, 5);
  const lanes = route.lanesAt(edge, s);
  const lane = lanes.find((l) => l.kind === 'drive' && l.direction === dir) ?? lanes[0];
  let target = lane?.dCenterM ?? 0;
  const zone = route.shortcuts[0];
  if (zone && edge === zone.edge && s > zone.s0 - 150) target = (zone.d0 + zone.d1) / 2 - 0.3;
  const kappa = route.kappaAt(edge, s) * dir;
  const steer = 0.35 * (target - d) * dir - 2.5 * yaw + (kappa * v * v) / 22;
  a.throttle = 1;
  a.steer = Math.max(-1, Math.min(1, steer));
}

function edgeName(sim: Sim, id: number): string {
  const e = sim.snapshot().entities[id]?.road.edge ?? -1;
  return sim.config.road.edges[e]?.id ?? '?';
}

/** Rides to the finish with a driver; returns the finish tick and the player's air events. */
function ride(sim: Sim, route: RouteProgress, playerId: number, driver: 'bot' | 'shortcut') {
  const bot = createStubBot();
  let finishTick = -1;
  const air: { type: string; data: Record<string, unknown>; edge: string }[] = [];
  while (!sim.isOver() && sim.tick < 60 * 900 && finishTick < 0) {
    const me = sim.snapshot().entities[playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    if (driver === 'bot') bot.drive(me, route, a);
    else drive(me, route, a);
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    for (const e of sim.events()) {
      // The player's finish event (the race can end on the same tick, when the player is last).
      if (e.actor === playerId && e.type === 'finish') finishTick = sim.tick;
      if (e.actor === playerId && (e.type === 'jump' || e.type === 'land' || e.type === 'crash'))
        air.push({ type: e.type, data: { ...e.data }, edge: edgeName(sim, playerId) });
    }
  }
  return { finishTick, air };
}

describe('riders-4: the lower overall speed on the M1 route', () => {
  it('a 0.8 multiplier makes the bot take about 1/0.8 as long, within 5 %', () => {
    const full = quietRace({});
    const slow = quietRace({ speedMultiplier: 0.8 });
    const a = ride(full.sim, full.route, full.playerId, 'bot');
    const b = ride(slow.sim, slow.route, slow.playerId, 'bot');
    const ratio = b.finishTick / a.finishTick;
    console.log(
      `[examined] bot route time at m 1: ${(a.finishTick / 60).toFixed(1)} s; at m 0.8: ` +
        `${(b.finishTick / 60).toFixed(1)} s; ratio ${ratio.toFixed(3)} (target ${(1 / 0.8).toFixed(3)} ± 5 %)`,
    );
    expect(a.finishTick).toBeGreaterThan(0);
    expect(b.finishTick).toBeGreaterThan(0);
    expect(Math.abs(ratio / (1 / 0.8) - 1)).toBeLessThan(0.05);
  }, 120_000);

  it('at the minimum multiplier the bot still takes the ramp shortcut and lands clean', () => {
    const slow = quietRace({ speedMultiplier: SPEED_MULTIPLIER_MIN });
    const run = ride(slow.sim, slow.route, slow.playerId, 'shortcut');
    const jump = run.air.find((e) => e.type === 'jump');
    const land = run.air.find((e) => e.type === 'land');
    console.log(
      `[examined] shortcut at m ${SPEED_MULTIPLIER_MIN}: finish ${(run.finishTick / 60).toFixed(1)} s, ` +
        `jump ${JSON.stringify(jump)}, land ${JSON.stringify(land)}`,
    );
    expect(jump?.edge).toBe('m1-boat-ramp-cut');
    expect(land?.edge).toBe('m1-boat-ramp-cut');
    expect(land?.data['quality']).toBe('clean');
    expect(run.air.filter((e) => e.type === 'crash')).toEqual([]);
    expect(run.finishTick).toBeGreaterThan(0);
  }, 120_000);
});

describe('riders-4: assists and the multiplier in the replay header', () => {
  const SETUP: Partial<RaceSetup> = {
    seed: 5,
    speedMultiplier: 0.8,
    assists: [{ steer: 'strong', autoThrottle: true }],
  };

  /** Records a bot race of 1800 ticks (the bot leaves the throttle to auto-throttle). */
  function record(setup: Partial<RaceSetup>) {
    const race = createHeadlessRace(setup);
    const recorder = createInputRecorder();
    recorder.beginRace(race.sim, makeReplayKey('test-code', 'test-content'));
    const bot = createStubBot();
    for (let tick = 0; tick < 1800 && !race.sim.isOver(); tick++) {
      const me = race.sim.snapshot().entities[race.playerId];
      if (!me) throw new Error('no player');
      const a = blank();
      bot.drive(me, race.config.route, a);
      a.throttle = 0; // auto-throttle drives
      const cmd = [quantizeInput({ ...a, flags: 0 })];
      recorder.record(tick, cmd);
      race.sim.step(cmd);
      if (tick % 60 === 0) recorder.checkpoint(tick, race.sim.hash());
    }
    recorder.finish(race.sim.tick - 1, race.sim.hash());
    const recording = recorder.current();
    if (!recording) throw new Error('no recording');
    return { race, recording, finalHash: race.sim.hash() };
  }

  it('carries them in the header, and a replay from it reproduces every hash', () => {
    const r = record(SETUP);
    expect(r.recording.header.config?.speedMultiplier).toBe(0.8);
    expect(r.recording.header.config?.slots?.[0]?.assists).toEqual({ steer: 'strong', autoThrottle: true });
    const sim = createSim(configFromHeader(r.recording.header, r.race.config.road, r.race.config.route));
    const result = createReplayController(r.recording).run(sim);
    console.log(`[examined] assisted replay: ${result.ticks} ticks, ${result.checked} hashes compared`);
    expect(result.desync).toBeNull();
    expect(result.finalHash).toBe(r.finalHash);
    expect(result.checked).toBeGreaterThanOrEqual(30);
    // The settings matter: without them the same inputs give a different race (auto-throttle off,
    // the bot's zero throttle never moves the bike).
    const plain = record({ seed: 5 });
    expect(plain.finalHash).not.toBe(r.finalHash);
  }, 120_000);
});
