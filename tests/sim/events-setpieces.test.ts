/// <reference types="vite/client" />
// Road set pieces (W-P, the maintainer, 2026-10-01b: "events and set pieces: roadwork, crash
// scenes, parades, a farm truck shedding hay, speed traps"). The bot rides a real region race with
// every piece forced in (chance 1), and each one goes live as racers close in, puts its props and
// vehicles on the road, and ends once everyone is past; the speed trap summons its cop; the hay
// truck drops bales. Seeded: one seed replays to the same hashes, and seeds move the pieces.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import {
  createSim,
  type SimConfig,
  type SimEvent,
  type SimModifierDef,
  type SimTrafficTypeDef,
} from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENT = 'region-pnw:pnw-fogline-run';
const MAX_TICKS = 60 * 60 * 6;

const VEHICLES: SimTrafficTypeDef[] = [
  {
    contentId: 'test:work-truck',
    category: 'oddity',
    lengthM: 7,
    widthM: 2.4,
    cruiseMps: 0,
    hazard: 'big',
    weight: 0,
  },
  {
    contentId: 'test:tow-truck',
    category: 'oddity',
    lengthM: 8,
    widthM: 2.5,
    cruiseMps: 0,
    hazard: 'big',
    weight: 0,
  },
  {
    contentId: 'test:stalled-car',
    category: 'oddity',
    lengthM: 4.6,
    widthM: 1.9,
    cruiseMps: 0,
    hazard: 'normal',
    weight: 0,
  },
  {
    contentId: 'test:float',
    category: 'oddity',
    lengthM: 9,
    widthM: 3,
    cruiseMps: 0,
    hazard: 'big',
    weight: 0,
  },
  {
    contentId: 'test:farm-truck',
    category: 'truck',
    lengthM: 8,
    widthM: 2.5,
    cruiseMps: 12,
    hazard: 'big',
    weight: 0,
  },
];

function mod(
  id: string,
  piece: string,
  window: [number, number],
  extra: Record<string, unknown> = {},
): SimModifierDef {
  return {
    contentId: `test:${id}`,
    kind: 'human',
    chance: 1,
    atProgress: window,
    durationTicks: 0,
    weight: 1,
    effects: [{ kind: 'set-piece', piece, signText: id.toUpperCase(), ...extra }],
  };
}

const ALL: SimModifierDef[] = [
  mod('roadwork', 'roadwork', [0.3, 0.94], { vehicle: 'test:work-truck' }),
  mod('crash', 'crash-scene', [0.3, 0.94], { vehicle: 'test:tow-truck', vehicle2: 'test:stalled-car' }),
  mod('parade', 'parade', [0.3, 0.94], { floats: ['test:float', 'test:float'], inflatable: true }),
  mod('hay', 'hay-spill', [0.3, 0.94], { vehicle: 'test:farm-truck' }),
  mod('trap', 'speed-trap', [0.3, 0.94], { limitMps: 20 }),
];

function config(
  seed: number,
  modifiers: readonly SimModifierDef[] = ALL,
  tuning: Record<string, number> = {},
): SimConfig {
  const base = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT, 'standard'), {
    seed,
    eventId: EVENT,
    length: 'standard',
  });
  // The shipped event caps its pieces per race; these tests force every one in.
  const { modifiersPerRace: _cap, ...event } = base.event;
  return {
    ...base,
    event,
    trafficTypes: [...base.trafficTypes, ...VEHICLES],
    modifiers,
    tuning: { ...base.tuning, ...tuning },
  };
}

interface Run {
  events: SimEvent[];
  hashes: number[];
  maxProps: number;
  kinds: Set<string>;
  moved: Set<string>;
  liveAtEnd: number;
  problem: string | null;
}

function ride(cfg: SimConfig, maxTicks = MAX_TICKS): Run {
  const sim = createSim(cfg);
  const playerId = cfg.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  let snap = sim.snapshot();
  const run: Run = {
    events: [],
    hashes: [],
    maxProps: 0,
    kinds: new Set(),
    moved: new Set(),
    liveAtEnd: 0,
    problem: null,
  };
  while (!sim.isOver() && sim.tick < maxTicks) {
    const actions = emptyActions();
    bot.drive(snap, playerId, cfg.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    run.events.push(...sim.events());
    const props = snap.props ?? [];
    run.maxProps = Math.max(run.maxProps, props.length);
    for (const p of props) {
      run.kinds.add(p.kind);
      if (p.moving) run.moved.add(p.kind);
      if (![p.x, p.y, p.z, p.heading, p.tilt].every(Number.isFinite))
        run.problem ??= `prop ${p.id} not finite`;
    }
    for (const m of snap.entities) run.problem ??= moverProblem(m, cfg.route);
    if (sim.tick % 600 === 0) run.hashes.push(sim.hash());
  }
  run.liveAtEnd = (snap.props ?? []).length;
  return run;
}

const pieceOf = (e: SimEvent) => String(e.data['piece']);

describe('road set pieces (W-P events)', () => {
  it('every piece goes live, does its job and ends as the bot rides the race', () => {
    // The lot cop waits (a long spawn delay), so it is the speed trap that brings him out.
    const run = ride(config(3, ALL, { 'cops.spawnDelayS': 600 }));
    const started = run.events.filter((e) => e.type === 'modifierStart').map(pieceOf);
    const ended = run.events.filter((e) => e.type === 'modifierEnd').map(pieceOf);
    console.log(
      `[print] started ${started.join(', ')}; ended ${ended.join(', ')}; most props at once ${run.maxProps}; ` +
        `kinds ${[...run.kinds].sort().join(', ')}; knocked or moving ${[...run.moved].sort().join(', ')}`,
    );
    expect(run.problem).toBeNull();
    expect(new Set(started)).toEqual(
      new Set(['roadwork', 'crash-scene', 'parade', 'hay-spill', 'speed-trap']),
    );
    // The race ends after everyone has passed them: every piece ended, nothing left on the road.
    expect(new Set(ended)).toEqual(new Set(started));
    expect(run.liveAtEnd).toBe(0);
    for (const k of [
      'cone',
      'flare',
      'sign',
      'person',
      'hayBale',
      'radar',
      'barricade',
      'arrowBoard',
      'lightbar',
      'floatDecor',
      'inflatable',
    ])
      expect(run.kinds, k).toContain(k);
    // The hay truck drops bales as racers close in (they come down moving).
    expect(run.moved).toContain('hayBale');
    // The speed trap: the bot blows past the radar and the lot cop is brought to the trap, siren on.
    // Whether the bot is over the limit as it passes depends on the traffic around it then (the W-P
    // traffic lane), so seed 3 is checked first and seeds 1, 2, 5, 9 and 10 back it up.
    const tripped = (r: Run) => r.events.some((e) => e.type === 'siren' && e.data['cause'] === 'speed-trap');
    let trapSeed = tripped(run) ? 3 : -1;
    for (const seed of [1, 2, 5, 9, 10]) {
      if (trapSeed >= 0) break;
      if (tripped(ride(config(seed, ALL, { 'cops.spawnDelayS': 600 })))) trapSeed = seed;
    }
    console.log(`[print] the speed trap summoned its cop on seed ${trapSeed}`);
    expect(trapSeed, 'the speed trap summons its cop').toBeGreaterThan(0);
  });

  it('replays to the same hashes for one seed, and other seeds place the pieces elsewhere', () => {
    const a = ride(config(5), 60 * 60);
    const b = ride(config(5), 60 * 60);
    expect(a.hashes.length).toBeGreaterThan(0);
    expect(b.hashes).toEqual(a.hashes);
    // Where each piece's sign stands follows the seed.
    const signs = (seed: number) => {
      const sim = createSim(config(seed));
      const out: string[] = [];
      // Signs appear only once a piece is live: step until the first one does.
      for (let t = 0; t < 60 * 120 && !(sim.snapshot().props ?? []).some((p) => p.kind === 'sign'); t++)
        sim.step([]);
      for (const p of sim.snapshot().props ?? [])
        if (p.kind === 'sign') out.push(`${p.piece}@${p.x.toFixed(0)},${p.z.toFixed(0)}`);
      return out.sort().join(';');
    };
    const seen = new Set([1, 2, 3, 4, 6, 7].map(signs));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('a chance scale of 0 puts nothing on the road, and an event without modifiers is unchanged', () => {
    const none = ride(config(3, ALL, { 'modifiers.setPieceChance': 0 }), 60 * 40);
    expect(none.events.filter((e) => e.type === 'modifierStart')).toEqual([]);
    expect(none.maxProps).toBe(0);
    const plain = ride(config(3, []), 60 * 20);
    const plainAgain = ride(config(3, []), 60 * 20);
    expect(plain.hashes).toEqual(plainAgain.hashes);
    expect(plain.maxProps).toBe(0);
  });

  it('the event cap keeps at most modifiersPerRace pieces, picked from the stream', () => {
    const base = config(9);
    const capped: SimConfig = { ...base, event: { ...base.event, modifiersPerRace: 2 } };
    const run = ride(capped);
    const started = run.events.filter((e) => e.type === 'modifierStart');
    expect(started.length).toBeGreaterThan(0);
    expect(started.length).toBeLessThanOrEqual(2);
  });
});
