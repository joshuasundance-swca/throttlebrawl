// Playtest 3, T3.2 (round 3, "Gentle climb": about 10% easier to knock down at a region's first tier,
// about 20% harder by its last): the career's field level, as far as the AI applies it itself.
// `SimEventDef.level` = { aggressionScale, signatureGapScale }: every rival's aggression times the
// first, on top of the difficulty preset; each timed signature move's gap and spread times the
// second (lower, more often), the first move still waiting out the start. Absent, or 1 and 1, the
// race runs as before and no hash moves. The scene: the fixture road, only the controllers, riders
// and race phases running (as signature.test.ts), a seeded pack of rivals with the player cruising
// in the middle of them.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type RoadPos } from '../../road';
import { raceSystem } from '../race';
import { ridersSystem } from '../riders';
import type { SignatureId, SimConfig, SimEventLevel, SimInput, SimRiderDef } from '../types';
import {
  addMover,
  createWorld,
  orderSystems,
  stepWorld,
  TICK_ORDER,
  worldHash,
  type Mover,
  type SimSystem,
  type SystemName,
  type World,
} from '../world';
import { aiState, aiSystem } from './index';
import { aggressionScale, signatureGapScale } from './level';
import { signatureState } from './signature';

const noop = (name: SystemName): SimSystem => ({ name, init() {}, step() {} });
const SYSTEMS = orderSystems(
  TICK_ORDER.map((n) =>
    n === 'controllers' ? aiSystem : n === 'riders' ? ridersSystem : n === 'race' ? raceSystem : noop(n),
  ),
);

const road = createRoadNetwork(
  fixtureNetwork([
    { id: 'a', lengthM: 6000, kappa: 0 },
    { id: 'b', lengthM: 800, kappa: 0 },
  ]),
);
const route = createRouteProgress(road, {
  id: 'r',
  network: 'fixture',
  start: { road: 'a', s: 20, dir: 1 },
  finish: { road: 'b', s: 760 },
  mainPath: ['a', 'b'],
  allowedRoads: ['a', 'b'],
  closed: false,
});
const bike = {
  contentId: 'base:bike',
  topSpeedMps: 44.7,
  accelMps2: 4.9,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

function rival(n: number, style: string, signature?: SignatureId): SimRiderDef {
  return {
    contentId: `base:r${n}`,
    name: `R${n}`,
    role: 'rival',
    faction: 'rider',
    controller: { kind: 'ai', style, personality: signature ? { signature } : {} },
    bike,
    massKg: 90,
    healthMax: 100,
  };
}
const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'You',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 80,
  healthMax: 100,
};

function config(riders: SimRiderDef[], seed: number, level?: SimEventLevel): SimConfig {
  return {
    seed,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [1],
      raceEndTimeoutTicks: 1_000_000,
      ...(level ? { level } : {}),
    },
    riders,
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      'riders.steerScale': 1,
      'ai.paceScale': 1,
      'ai.aggressionScale': 1,
      'ai.styleQuirks': 1,
      'ai.signatures': 1,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 0 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

/** The pack: rivals side by side a few metres ahead of the player, who then cruises among them. */
function start(riders: SimRiderDef[], seed: number, level?: SimEventLevel) {
  const cfg = config([...riders, PLAYER], seed, level);
  const world: World = createWorld(cfg);
  const lanes = [0.8, 2.4, 1.7, 3.2, 0.2];
  const movers = cfg.riders.map((_def, i) => {
    const player = i === riders.length;
    const pos: RoadPos = {
      edge: 0,
      s: player ? 40 : 60 + 3 * i,
      d: player ? 1.7 : (lanes[i] ?? 1.7),
      dir: 1,
    };
    road.advance(pos);
    const m = addMover(world, 'rider', pos, i);
    m.speed = 28;
    return m;
  });
  for (const s of SYSTEMS) s.init(world, cfg);
  return { world, cfg, me: movers[riders.length] as Mover };
}

function cruise(me: Mover): SimInput {
  return {
    steer: Math.round(Math.max(-1, Math.min(1, (1.7 - me.pos.d) * 0.3 - me.yaw * 2)) * 127),
    throttle: me.speed < 28 ? 220 : 90,
    brake: 0,
    flags: 0,
  };
}

function run(riders: SimRiderDef[], seed: number, ticks: number, level?: SimEventLevel) {
  const s = start(riders, seed, level);
  for (let t = 0; t < ticks; t++) stepWorld(s.world, s.cfg, SYSTEMS, [cruise(s.me)]);
  return s;
}

const SCRAPPERS = [
  rival(0, 'heavy-hitter'),
  rival(1, 'heavy-hitter'),
  rival(2, 'scrapper'),
  rival(3, 'heavy-hitter'),
];
const SEEDS = [1, 2, 3, 4, 5, 6];

/** Swings the rivals pressed over the seeds, in total. */
function swings(level: SimEventLevel | undefined, ticks = 3600): number {
  let total = 0;
  for (const seed of SEEDS) {
    const { world } = run(SCRAPPERS, seed, ticks, level);
    total += aiState(world).presses.reduce((a, b) => a + (b ?? 0), 0);
  }
  return total;
}

describe('the career level in the AI: absent is today, and a number is held sane', () => {
  it('level absent, and {1, 1}, run a pack to the very same hash (so no replay fixture moves)', () => {
    const riders = [...SCRAPPERS.slice(0, 2), rival(4, 'showboat', 'selfie'), rival(5, 'racer', 'wave')];
    const none = worldHash(run(riders, 7, 3600).world);
    expect(worldHash(run(riders, 7, 3600, { aggressionScale: 1, signatureGapScale: 1 }).world)).toBe(none);
  });

  it('the same seed and level twice give the same hash, and a different level a different one', () => {
    const level = { aggressionScale: 1.2, signatureGapScale: 0.8 };
    const riders = [...SCRAPPERS.slice(0, 2), rival(4, 'showboat', 'selfie')];
    const a = worldHash(run(riders, 7, 3600, level).world);
    expect(worldHash(run(riders, 7, 3600, level).world)).toBe(a);
    expect(worldHash(run(riders, 7, 3600).world)).not.toBe(a);
  });

  it('a scale that is not a number above 0 counts as 1; a wild one is held to a range', () => {
    const at = (level?: Partial<SimEventLevel>) => ({ event: { level } }) as unknown as SimConfig;
    for (const bad of [Number.NaN, Infinity, 0, -1]) {
      expect(aggressionScale(at({ aggressionScale: bad }))).toBe(1);
      expect(signatureGapScale(at({ signatureGapScale: bad }))).toBe(1);
    }
    expect(aggressionScale(at())).toBe(1);
    expect(aggressionScale(at({ aggressionScale: 1.2 }))).toBe(1.2);
    expect(aggressionScale(at({ aggressionScale: 50 }))).toBeLessThanOrEqual(2);
    expect(aggressionScale(at({ aggressionScale: 0.001 }))).toBeGreaterThanOrEqual(0.25);
    expect(signatureGapScale(at({ signatureGapScale: 0.5 }))).toBe(0.5);
    expect(signatureGapScale(at({ signatureGapScale: 99 }))).toBeLessThanOrEqual(4);
    expect(signatureGapScale(at({ signatureGapScale: 0.0001 }))).toBeGreaterThanOrEqual(0.25);
  });
});

describe('the gentle climb: aggression scales how often the rivals swing', () => {
  it('a first-tier field (0.9) swings less than the base, and a last-tier field (1.2) more, by a gentle margin', () => {
    const easy = swings({ aggressionScale: 0.9, signatureGapScale: 1 });
    const base = swings(undefined);
    const hard = swings({ aggressionScale: 1.2, signatureGapScale: 1 });
    console.log(
      `[examined] swings pressed by 4 rivals over ${SEEDS.length} seeds x 60 s: 0.9 -> ${easy}, absent -> ${base}, 1.2 -> ${hard} ` +
        `(x${(easy / base).toFixed(2)}, x${(hard / base).toFixed(2)})`,
    );
    expect(base).toBeGreaterThan(40);
    expect(easy).toBeLessThan(base);
    expect(hard).toBeGreaterThan(base);
    // Gentle: a 20% rise in aggression is nowhere near doubling the fighting, nor does 10% off halve it.
    expect(hard / base).toBeLessThan(1.6);
    expect(easy / base).toBeGreaterThan(0.6);
  });
});

describe('the gentle climb: the signature gap scales how often a move comes', () => {
  const chad = [rival(0, 'showboat', 'selfie')];
  const total = (level: SimEventLevel | undefined, ticks: number): number => {
    let n = 0;
    for (const seed of SEEDS) n += signatureState(run(chad, seed, ticks, level).world).count[0] ?? 0;
    return n;
  };

  it('halving the gap (0.5) gives Chad at least 1.5 times as many selfies; doubling it fewer', () => {
    const base = total({ aggressionScale: 1, signatureGapScale: 1 }, 7200);
    const often = total({ aggressionScale: 1, signatureGapScale: 0.5 }, 7200);
    const rare = total({ aggressionScale: 1, signatureGapScale: 2 }, 7200);
    console.log(
      `[examined] Chad's selfies over ${SEEDS.length} seeds x 120 s: gap x0.5 -> ${often}, x1 -> ${base}, x2 -> ${rare}`,
    );
    expect(base).toBeGreaterThan(10);
    expect(often).toBeGreaterThanOrEqual(1.5 * base);
    expect(rare).toBeLessThan(base);
  });

  it('no timed move starts in the first 10 s, however small the scale (the first tick is unchanged)', () => {
    const s = start(chad, 3, { aggressionScale: 1, signatureGapScale: 0.25 });
    expect(signatureState(s.world).next[0]).toBeGreaterThanOrEqual(600);
    for (let t = 0; t < 599; t++) stepWorld(s.world, s.cfg, SYSTEMS, [cruise(s.me)]);
    expect(signatureState(s.world).count[0]).toBe(0);
  });
});
