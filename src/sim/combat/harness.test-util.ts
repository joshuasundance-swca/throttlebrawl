// A small world for combat tests: riders placed by hand on one straight fixture road, driven by a
// script, moved by a plain kinematic stand-in for the riders phase (speed along s, brake at the
// bike's rate), so these tests pin combat's rules and not the riding model's feel.
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimWeaponDef } from '../types';
import { InputFlag } from '../types';
import {
  addMover,
  createWorld,
  orderSystems,
  stepWorld,
  TICK_ORDER,
  type SimSystem,
  type SystemName,
  type World,
} from '../world';
import { COMBAT_TUNING, combatSystem } from './index';

/**
 * The M1 timing numbers (docs/milestones/M1.md), as buildSimConfig resolves the base pack, with
 * combat-3's shove speeds (packs/base/weapons/: the kick shoves about a lane, the punch staggers).
 */
export const PUNCH: SimWeaponDef = {
  contentId: 'base:punch',
  unarmed: true,
  reachSM: 1.2,
  reachDM: 1.4,
  windupTicks: 7,
  activeTicks: 5,
  recoveryTicks: 15,
  cooldownTicks: 0,
  damage: 10,
  hitStopMs: 60,
  knockbackMps: 3.3,
  staggerTicks: 12,
  steal: null,
};

export const KICK: SimWeaponDef = {
  contentId: 'base:kick',
  unarmed: true,
  reachSM: 1.0,
  reachDM: 1.7,
  windupTicks: 13,
  activeTicks: 6,
  recoveryTicks: 27,
  cooldownTicks: 30,
  damage: 18,
  hitStopMs: 60,
  knockbackMps: 18,
  staggerTicks: 21,
  steal: null,
};

/** The lead pipe (docs/milestones/M1.md, combat-2): 20 / 6 / 25 ticks, steal window ticks 7–20. */
export const PIPE: SimWeaponDef = {
  contentId: 'base:lead-pipe',
  unarmed: false,
  reachSM: 1.6,
  reachDM: 1.4,
  windupTicks: 20,
  activeTicks: 6,
  recoveryTicks: 25,
  cooldownTicks: 0,
  damage: 22,
  hitStopMs: 70,
  knockbackMps: 7.5,
  staggerTicks: 21,
  steal: { startTick: 7, endTick: 20 },
};

export const F = InputFlag;

export interface Placement {
  s: number;
  d: number;
  speed?: number;
  /** 'player' riders take part in hit-stop; 'cop' is faction law. */
  role?: 'player' | 'rival' | 'cop';
  healthMax?: number;
  /** The rider's fight stats (playtest 2): damage and stagger taken divided, damage dealt multiplied. */
  toughness?: number;
  power?: number;
  /** Rider mass, kg (80 when absent); the bike adds 180. */
  massKg?: number;
  /** The bike's `combat` block (combat-3): resistance 0..1 and hit power. */
  knockbackResistance?: number;
  hitPowerScale?: number;
  /** A weapon content id the rider starts holding (M4 weapons-2: a cop's baton or taser). */
  startingWeapon?: string;
}

const BIKE = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

export function harnessConfig(
  placements: readonly Placement[],
  tuning: Record<string, number> = {},
  extraWeapons: readonly SimWeaponDef[] = [],
): SimConfig {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0 }]));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  const riders: SimRiderDef[] = placements.map((p, i) => ({
    contentId: `base:r${i}`,
    name: `R${i}`,
    role: p.role === 'cop' ? 'cop' : p.role === 'player' ? 'player' : 'rival',
    faction: p.role === 'cop' ? 'law' : 'rider',
    controller:
      p.role === 'player'
        ? { kind: 'player', slot: 0 }
        : p.role === 'cop'
          ? { kind: 'cop' }
          : { kind: 'ai', style: 'racer' },
    bike: {
      ...BIKE,
      ...(p.knockbackResistance !== undefined ? { knockbackResistance: p.knockbackResistance } : {}),
      ...(p.hitPowerScale !== undefined ? { hitPowerScale: p.hitPowerScale } : {}),
    },
    massKg: p.massKg ?? 80,
    healthMax: p.healthMax ?? 100,
    ...(p.toughness !== undefined ? { toughness: p.toughness } : {}),
    ...(p.power !== undefined ? { power: p.power } : {}),
    ...(p.startingWeapon !== undefined ? { startingWeapon: p.startingWeapon } : {}),
  }));
  return {
    seed: 7,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [],
      raceEndTimeoutTicks: 1800,
    },
    riders,
    weapons: [PUNCH, KICK, ...extraWeapons],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { ...tuningDefaults(COMBAT_TUNING), ...tuning },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

/** Per-tick script: the input for each rider id (missing = neutral). */
export type Script = (tick: number, id: number) => SimInput | undefined;

export interface Harness {
  world: World;
  config: SimConfig;
  events: SimEvent[];
  /** Steps n ticks; returns the events of those ticks. */
  run(n: number): SimEvent[];
}

const NEUTRAL: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };

/** Extras for combat-4's tests: stand-ins for later phases (traffic, tumble) and the slow-mo toggle. */
export interface HarnessOptions {
  systems?: Partial<Record<SystemName, SimSystem>>;
  slowMo?: boolean;
}

export function makeHarness(
  placements: readonly Placement[],
  script: Script,
  tuning?: Record<string, number>,
  extraWeapons: readonly SimWeaponDef[] = [],
  opts: HarnessOptions = {},
): Harness {
  const config = harnessConfig(placements, tuning, extraWeapons);
  config.slowMo = opts.slowMo ?? false;
  const world = createWorld(config);
  placements.forEach((p, i) => {
    const m = addMover(world, 'rider', { edge: 0, s: p.s, d: p.d, dir: 1 }, i);
    m.speed = p.speed ?? 0;
  });
  const noop = (name: SystemName): SimSystem => ({ name, init() {}, step() {} });
  const controllers: SimSystem = {
    name: 'controllers',
    init() {},
    step(w) {
      for (const m of w.movers) w.inputs[m.id] = { ...(script(w.tick, m.id) ?? NEUTRAL) };
    },
  };
  const riders: SimSystem = {
    name: 'riders',
    init(w, c) {
      const health: number[] = [];
      for (const m of w.movers) health[m.id] = c.riders[m.riderIndex]?.healthMax ?? 0;
      w.systems['riders'] = { throttle: [], brake: [], rpm: [], gear: [], lean: [], health, wobble: [] };
    },
    step(w, c) {
      const dt = w.timeScale / 60;
      for (const m of w.movers) {
        if (m.mode !== 'Road') continue;
        const brake = (w.inputs[m.id]?.brake ?? 0) / 255;
        m.speed = Math.max(0, m.speed - brake * (c.riders[m.riderIndex]?.bike.brakeMps2 ?? 0) * dt);
        m.pos.s += m.pos.dir * m.speed * dt;
      }
    },
  };
  const systems = orderSystems(
    TICK_ORDER.map((name) =>
      name === 'controllers'
        ? controllers
        : name === 'riders'
          ? riders
          : name === 'combat'
            ? combatSystem
            : (opts.systems?.[name] ?? noop(name)),
    ),
  );
  for (const s of systems) s.init(world, config);
  const events: SimEvent[] = [];
  return {
    world,
    config,
    events,
    run(n: number) {
      const out: SimEvent[] = [];
      for (let i = 0; i < n; i++) out.push(...stepWorld(world, config, systems, []));
      events.push(...out);
      return out;
    },
  };
}

/** A script from a map of rider id to a function of the tick. */
export function scriptOf(byId: Record<number, (tick: number) => SimInput | undefined>): Script {
  return (tick, id) => byId[id]?.(tick);
}

/** Flags only (no throttle, steer or brake). */
export function flags(f: number): SimInput {
  return { steer: 0, throttle: 0, brake: 0, flags: f };
}

export function ofType(events: readonly SimEvent[], type: SimEvent['type']): SimEvent[] {
  return events.filter((e) => e.type === type);
}
