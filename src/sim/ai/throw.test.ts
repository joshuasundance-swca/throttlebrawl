// #388's follow-up (run W-T's live check, mustFix 5): a rival holding a thrown weapon (Kevin's
// briefcase, `throw.burst`) throws it at a rider in its throw range ahead, not only at punch range.
// The AIController against a scripted scene on a fixture road: only the phases the AI needs run
// (controllers, riders, race), the briefcase is put in the rival's hand through combat's state, and
// the player is held at a fixed gap from the rival every tick. A throw is an attack press without the
// kick flag (combat resolves a press to the held weapon); tests/sim/ai-briefcase-throw.test.ts
// checks the whole throw in seeded races.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type RoadPos } from '../../road';
import { combatState, PUNCH_ID, KICK_ID } from '../combat';
import { raceSystem } from '../race';
import { ridersSystem } from '../riders';
import {
  InputFlag,
  type SimAiPersonality,
  type SimConfig,
  type SimRiderDef,
  type SimWeaponDef,
} from '../types';
import {
  addMover,
  createWorld,
  orderSystems,
  stepWorld,
  TICK_ORDER,
  type SimSystem,
  type SystemName,
} from '../world';
import { aiSystem } from './index';

const noop = (name: SystemName): SimSystem => ({ name, init() {}, step() {} });
const SYSTEMS = orderSystems(
  TICK_ORDER.map((n) =>
    n === 'controllers' ? aiSystem : n === 'riders' ? ridersSystem : n === 'race' ? raceSystem : noop(n),
  ),
);

const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 3000, kappa: 0 }]));
const route = createRouteProgress(road, {
  id: 'r',
  network: 'fixture',
  start: { road: 'a', s: 20, dir: 1 },
  finish: { road: 'a', s: 2960 },
  mainPath: ['a'],
  allowedRoads: ['a'],
  closed: false,
});
const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

const unarmed = (contentId: string, reachSM: number, reachDM: number, windupTicks: number): SimWeaponDef => ({
  contentId,
  unarmed: true,
  reachSM,
  reachDM,
  windupTicks,
  activeTicks: 5,
  recoveryTicks: 15,
  cooldownTicks: 0,
  damage: 10,
  hitStopMs: 60,
  knockbackMps: 3,
  staggerTicks: 12,
  steal: null,
});
/** Kevin's briefcase as buildSimConfig resolves packs/base/weapons/kevins-briefcase.json. */
const BRIEFCASE: SimWeaponDef = {
  contentId: 'base:kevins-briefcase',
  unarmed: false,
  reachSM: 14,
  reachDM: 3,
  windupTicks: 18,
  activeTicks: 6,
  recoveryTicks: 23,
  cooldownTicks: 0,
  damage: 14,
  hitStopMs: 80,
  knockbackMps: 9,
  staggerTicks: 30,
  steal: { startTick: 5, endTick: 18 },
  behaviour: 'throw.burst',
};
const PIPE: SimWeaponDef = {
  ...BRIEFCASE,
  contentId: 'base:lead-pipe',
  reachSM: 1.6,
  reachDM: 1.4,
  behaviour: 'melee.swing',
};

function rider(role: 'rival' | 'player', personality?: SimAiPersonality): SimRiderDef {
  return {
    contentId: `base:${role}`,
    name: role,
    role,
    faction: 'rider',
    controller:
      role === 'player'
        ? { kind: 'player', slot: 0 }
        : { kind: 'ai', style: 'racer', ...(personality ? { personality } : {}) },
    bike,
    massKg: 85,
    healthMax: 100,
  };
}

function config(seed: number, riderAggression: number, personality?: SimAiPersonality): SimConfig {
  return {
    seed,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [1],
      raceEndTimeoutTicks: 1800,
    },
    riders: [rider('rival', personality), rider('player')],
    weapons: [unarmed(PUNCH_ID, 1.2, 1.4, 7), unarmed(KICK_ID, 1.0, 1.7, 13), BRIEFCASE, PIPE],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { 'ai.aggressionScale': 1 },
    difficulty: { presetId: 'normal', riderAggression, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

interface Run {
  /** Tick of the rival's first attack press, or -1. */
  press: number;
  /** Whether that press carried the kick flag. */
  kick: boolean;
}

/**
 * The rival rides at 30 m/s holding `held` (or nothing); the player is put `ahead` metres ahead of
 * it and `dd` across, at its speed, every tick. Returns the rival's first attack press within `ticks`.
 */
function run(opts: {
  held: string | null;
  ahead: number;
  dd?: number;
  seed?: number;
  riderAggression?: number;
  personality?: SimAiPersonality;
  ticks?: number;
}): Run {
  const cfg = config(
    opts.seed ?? 1,
    opts.riderAggression ?? 1,
    opts.personality ?? { aggression: 0.5, weave: 0 },
  );
  const world = createWorld(cfg);
  const at = (s: number): RoadPos => {
    const pos: RoadPos = { edge: 0, s, d: 1.7, dir: 1 };
    road.advance(pos);
    return pos;
  };
  const rival = addMover(world, 'rider', at(100), 0);
  const player = addMover(world, 'rider', at(100 + opts.ahead), 1);
  rival.speed = 30;
  player.speed = 30;
  for (const s of SYSTEMS) s.init(world, cfg);
  if (opts.held) combatState(world).held[rival.id] = opts.held;
  const ticks = opts.ticks ?? 600;
  for (let t = 0; t < ticks; t++) {
    player.pos.s = rival.pos.s + opts.ahead;
    player.pos.d = rival.pos.d + (opts.dd ?? 0);
    player.speed = rival.speed;
    stepWorld(world, cfg, SYSTEMS, [{ steer: 0, throttle: 0, brake: 0, flags: 0 }]);
    const flags = world.inputs[rival.id]?.flags ?? 0;
    if (flags & InputFlag.attack) return { press: world.tick, kick: (flags & InputFlag.kick) !== 0 };
  }
  return { press: -1, kick: false };
}

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe('#388: a rival throws the briefcase at a rider in its throw range', () => {
  it('throws (a press without the kick) at a rider 8 m ahead within 4 s, on every seed', () => {
    const presses = SEEDS.map((seed) => run({ held: BRIEFCASE.contentId, ahead: 8, seed }));
    for (const p of presses) {
      expect(p.press).toBeGreaterThan(0);
      expect(p.press).toBeLessThanOrEqual(120 + 4 * 60); // no swings off the start line (tick 120)
      expect(p.kick).toBe(false);
    }
  });

  it('throws only ahead and inside the reach box: not 8 m behind, not 20 m ahead, not 5 m across', () => {
    for (const seed of [1, 2, 3]) {
      expect(run({ held: BRIEFCASE.contentId, ahead: -8, seed }).press).toBe(-1);
      expect(run({ held: BRIEFCASE.contentId, ahead: 20, seed }).press).toBe(-1);
      expect(run({ held: BRIEFCASE.contentId, ahead: 8, dd: 5, seed }).press).toBe(-1);
    }
  });

  it('empty-handed, or holding a weapon that is swung, it still swings only at arm’s length', () => {
    for (const seed of [1, 2, 3]) {
      expect(run({ held: null, ahead: 8, seed }).press).toBe(-1);
      expect(run({ held: PIPE.contentId, ahead: 8, seed }).press).toBe(-1);
    }
  });

  it('never wastes it on a rider beside and behind it: any press there is a kick', () => {
    for (const seed of SEEDS) {
      const p = run({ held: BRIEFCASE.contentId, ahead: -0.6, dd: 1.2, seed });
      if (p.press > 0) expect(p.kick).toBe(true);
    }
  });

  it('keeps the personality and the difficulty: no aggression never throws; Hard throws sooner than Easy', () => {
    expect(run({ held: BRIEFCASE.contentId, ahead: 8, personality: { aggression: 0, weave: 0 } }).press).toBe(
      -1,
    );
    const wait = (riderAggression: number) =>
      mean(
        SEEDS.map((seed) => run({ held: BRIEFCASE.contentId, ahead: 8, seed, riderAggression }).press - 120),
      );
    const easy = wait(0.75);
    const hard = wait(1.25);
    console.log(
      `[ai throw] mean ticks to the throw past the start hold: Easy ${easy.toFixed(1)}, Hard ${hard.toFixed(1)}`,
    );
    expect(hard).toBeLessThan(easy);
  });
});
