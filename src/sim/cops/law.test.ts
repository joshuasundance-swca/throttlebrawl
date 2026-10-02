// cops-3 (docs/milestones/M4.md, a head start): the spawn mix from the event's `cops` block
// (every-race, tier-rising, chaos-summoned, none), the hidden chaos meter, the cap on cops
// chasing at once, fines that grow with the tier, and an armed cop's swing. Only the cops system
// steps here (riders stand still where a test puts them), so the rules are pinned, not the ride.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type RoadPos } from '../../road';
import {
  InputFlag,
  SIM_TUNING,
  type SimConfig,
  type SimEvent,
  type SimEventCops,
  type SimRiderDef,
} from '../api';
import { combatState } from '../combat';
import { PIPE } from '../combat/harness.test-util';
import { ridersSystem } from '../riders';
import { addMover, createWorld, type World } from '../world';
import { CHAOS_HIT, COP_CHASING, copsState, copsSystem } from './index';

const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const rider = (id: string, role: 'rival' | 'player'): SimRiderDef => ({
  contentId: `base:${id}`,
  name: id,
  role,
  faction: 'rider',
  controller: role === 'player' ? { kind: 'player', slot: 0 } : { kind: 'ai', style: 'racer' },
  bike,
  massKg: 80,
  healthMax: 100,
});
const cop = (id: string, fineCash = 400): SimRiderDef => ({
  contentId: `base:${id}`,
  name: id,
  role: 'cop',
  faction: 'law',
  controller: { kind: 'cop' },
  bike,
  massKg: 95,
  healthMax: 100,
  law: { agency: 'base:test-law', bustRadiusM: 14, bustDwellS: 1, fineCash, pursuitSpeedScale: 1 },
});

const PLAYER_ID = 1;
const COPS = [2, 3, 4];
const BATON = { ...PIPE, contentId: 'base:baton', windupTicks: 18, steal: { startTick: 6, endTick: 18 } };

/** Rival 0, player 1, cops 2–4 on a 1.3 km fixture road, siren lead 0 and spawn delay 0 by default. */
function config(
  cops: SimEventCops | undefined,
  opts: { tier?: number; seed?: number; tuning?: Record<string, number> } = {},
): SimConfig {
  const road = createRoadNetwork(
    fixtureNetwork([
      { id: 'a', lengthM: 400, kappa: 0 },
      { id: 'b', lengthM: 500, kappa: 0 },
      { id: 'c', lengthM: 400, kappa: 0 },
    ]),
  );
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 60, dir: 1 },
    finish: { road: 'c', s: 380 },
    mainPath: ['a', 'b', 'c'],
    allowedRoads: ['a', 'b', 'c'],
    closed: false,
  });
  return {
    seed: opts.seed ?? 5,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
      ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
      ...(cops ? { cops } : {}),
    },
    riders: [rider('rival', 'rival'), rider('player', 'player'), cop('c1'), cop('c2'), cop('c3')],
    weapons: [BATON],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
      'cops.sirenLeadS': 0,
      'cops.spawnDelayS': 0,
      ...opts.tuning,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const mix = (over: Partial<SimEventCops>): SimEventCops => ({
  mode: 'every-race',
  baseCount: 1,
  tierScale: 0,
  chaosSummon: false,
  randomness: 0,
  ...over,
});

/** A world with only the cops system stepping; `hitsEvery` injects a player hit every n ticks. */
function lawWorld(cfg: SimConfig) {
  const world: World = createWorld(cfg);
  const at = (s: number, d: number): RoadPos => ({ edge: 0, s, d, dir: 1 });
  addMover(world, 'rider', at(100, 1.7), 0);
  addMover(world, 'rider', at(200, 1.7), 1);
  for (const i of COPS) addMover(world, 'rider', at(150, 1.7), i);
  ridersSystem.init(world, cfg);
  copsSystem.init(world, cfg);
  const events: SimEvent[] = [];
  const step = (n: number, hitsEvery = 0) => {
    for (let i = 0; i < n; i++) {
      world.events = [];
      if (hitsEvery > 0 && world.tick % hitsEvery === 0) {
        world.events.push({
          tick: world.tick,
          type: 'hit',
          actor: PLAYER_ID,
          target: 0,
          data: {},
          causeId: 0,
        });
      }
      copsSystem.step(world, cfg);
      events.push(...world.events);
      world.tick++;
    }
  };
  const sirens = () => events.filter((e) => e.type === 'siren' && e.data['on'] === true);
  return { world, cfg, step, events, sirens };
}

const print = (line: string) => console.log(`[cops-3] ${line}`);

describe('cops-3: the spawn mix', () => {
  it('without a cops block every fielded cop comes out (the M2 rule), up to the two-at-once cap', () => {
    const w = lawWorld(config(undefined));
    w.step(600);
    expect(w.sirens().map((e) => e.actor)).toEqual([2, 3]);
    expect(w.sirens().every((e) => e.data['cause'] === undefined)).toBe(true);
  });

  it('every-race brings baseCount cops, a wave gap apart (8 s, and a non-default 3 s)', () => {
    for (const gap of [8, 3]) {
      const w = lawWorld(config(mix({ baseCount: 2 }), { tuning: { 'cops.waveGapS': gap } }));
      w.step(60 * 30);
      const s = w.sirens();
      expect(s.map((e) => e.actor)).toEqual([2, 3]);
      expect(s.map((e) => e.data['cause'])).toEqual(['every-race', 'every-race']);
      expect((s[1]?.tick ?? 0) - (s[0]?.tick ?? 0)).toBe(gap * 60);
      expect(copsState(w.world).phase[4]).not.toBe(COP_CHASING);
    }
  });

  it('tier-rising adds tierScale cops per tier above the first (printed)', () => {
    const out: string[] = [];
    const counts = [1, 2, 3, 4, 5].map((tier) => {
      const w = lawWorld(
        config(mix({ mode: 'tier-rising', baseCount: 1, tierScale: 0.5 }), {
          tier,
          tuning: { 'cops.maxActive': 6 },
        }),
      );
      w.step(60 * 30);
      out.push(`tier ${tier}: ${w.sirens().length}`);
      expect(w.sirens().every((e) => e.data['cause'] === 'tier-rising')).toBe(true);
      return w.sirens().length;
    });
    print(`tier-rising (base 1, +0.5 a tier, 3 cops fielded): ${out.join(', ')}`);
    expect(counts).toEqual([1, 2, 2, 3, 3]); // 1, 1.5, 2, 2.5, 3 rounded (half up), at most the 3 fielded
  });

  it('none brings nobody, chaos or not', () => {
    const w = lawWorld(config(mix({ mode: 'none', baseCount: 2, chaosSummon: true })));
    w.step(60 * 30, 10);
    expect(w.sirens()).toHaveLength(0);
  });

  it('chaos-summoned: no chaos, no cops; chaos summons them one at a time (printed)', () => {
    const calm = lawWorld(config(mix({ mode: 'chaos-summoned', baseCount: 0 })));
    calm.step(60 * 30);
    const wild = lawWorld(config(mix({ mode: 'chaos-summoned', baseCount: 0 })));
    wild.step(60 * 30, 30); // a player hit every half second
    print(
      `chaos-summoned over 30 s: ${calm.sirens().length} cops with no chaos, ${wild.sirens().length} with a hit every 0.5 s`,
    );
    expect(calm.sirens()).toHaveLength(0);
    expect(wild.sirens().length).toBeGreaterThanOrEqual(2);
    expect(wild.sirens().every((e) => e.data['cause'] === 'chaos')).toBe(true);
    // The first summons after 10 points: the 11th hit at tick 300 (the meter drained 0.5 meanwhile).
    expect(wild.sirens()[0]?.tick).toBe(300);
  });

  it('chaosSummon lets mayhem add cops on top of every-race; a lower threshold summons sooner', () => {
    const base = lawWorld(config(mix({ baseCount: 1 })));
    base.step(60 * 20, 30);
    const summoned = lawWorld(config(mix({ baseCount: 1, chaosSummon: true })));
    summoned.step(60 * 20, 30);
    const eager = lawWorld(
      config(mix({ baseCount: 1, chaosSummon: true }), { tuning: { 'cops.chaosSummonAt': 4 } }),
    );
    eager.step(60 * 20, 30);
    print(
      `every-race base 1 over 20 s with a hit every 0.5 s: ${base.sirens().length} cops without chaos summons, ` +
        `${summoned.sirens().length} with, first summons at tick ${summoned.sirens()[1]?.tick} (threshold 10) and ` +
        `${eager.sirens()[1]?.tick} (threshold 4)`,
    );
    expect(base.sirens()).toHaveLength(1);
    expect(summoned.sirens().length).toBeGreaterThan(base.sirens().length);
    expect(eager.sirens()[1]?.tick ?? Infinity).toBeLessThan(summoned.sirens()[1]?.tick ?? Infinity);
  });

  it('the chaos meter only counts hits with a player in them, and drains with time', () => {
    const w = lawWorld(config(mix({ mode: 'chaos-summoned', baseCount: 0 })));
    // Rival-on-rival hits: nothing.
    for (let i = 0; i < 20; i++) {
      w.world.events = [{ tick: w.world.tick, type: 'hit', actor: 0, target: 0, data: {}, causeId: 0 }];
      copsSystem.step(w.world, w.cfg);
      w.world.tick++;
    }
    expect(copsState(w.world).chaos).toBe(0);
    w.step(1, 1);
    expect(copsState(w.world).chaos).toBe(CHAOS_HIT);
    w.step(600);
    expect(copsState(w.world).chaos).toBeCloseTo(0, 9); // 0.1 a second drains one point in 10 s
  });

  it('randomness jitters the waves: the same seed gives the same race, seeds differ', () => {
    const gaps = (seed: number) => {
      const w = lawWorld(config(mix({ baseCount: 3, randomness: 0.5 }), { seed }));
      w.step(60 * 30);
      const s = w.sirens();
      return (s[1]?.tick ?? 0) - (s[0]?.tick ?? 0);
    };
    expect(gaps(11)).toBe(gaps(11));
    const all = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(gaps));
    print(`wave gaps with randomness 0.5 over seeds 1-8 (ticks): ${[...all].join(', ')}`);
    expect(all.size).toBeGreaterThan(1);
    for (const g of all) expect(g).toBeGreaterThanOrEqual(240 - 1); // 8 s ± 50 %
  });

  it('cops.maxActive holds back the next cop until a chase ends (here: a non-default 1)', () => {
    const w = lawWorld(
      config(mix({ baseCount: 3 }), { tuning: { 'cops.maxActive': 1, 'cops.waveGapS': 0 } }),
    );
    w.step(120);
    expect(w.sirens().map((e) => e.actor)).toEqual([2]);
  });
});

describe('cops-3: fines', () => {
  const bust = (tier: number | undefined, tuning: Record<string, number> = {}) => {
    // The fine, not the bust rule, is under test: the M1 proximity bust (cops.bustKnockdownOnly 0).
    const t = { 'cops.bustKnockdownOnly': 0, ...tuning };
    const w = lawWorld(config(undefined, { ...(tier !== undefined ? { tier } : {}), tuning: t }));
    w.step(1); // he pulls out
    const player = w.world.movers[PLAYER_ID];
    const c = w.world.movers[2];
    if (player && c) {
      player.mode = 'Tumble';
      c.pos = { ...player.pos, s: player.pos.s - 5 };
    }
    w.step(90);
    return w.events.find((e) => e.type === 'bust');
  };

  it('grow with the tier: × (1 + (tier − 1) × 0.5) by default, and the event says so', () => {
    const fines = [undefined, 1, 2, 3].map((t) => bust(t)?.data['fineCash']);
    print(
      `fines for a $400 cop: no tier ${fines[0]}, tier 1 ${fines[1]}, tier 2 ${fines[2]}, tier 3 ${fines[3]}`,
    );
    expect(fines).toEqual([400, 400, 600, 800]);
    expect(bust(3)?.data).toMatchObject({ fineCash: 800, tier: 3, fineBaseCash: 400 });
  });

  it('the growth is a slider (a non-default 1.0 doubles the fine at tier 2)', () => {
    expect(bust(2, { 'cops.fineTierScale': 1 })?.data['fineCash']).toBe(800);
    expect(bust(2, { 'cops.fineTierScale': 0 })?.data['fineCash']).toBe(400);
  });
});

describe('cops-3: an armed cop swings', () => {
  it('presses attack when the man he chases is in reach, then not again for cops.swingEveryS', () => {
    const w = lawWorld(config(mix({ baseCount: 1 })));
    combatState(w.world).held[2] = BATON.contentId;
    combatState(w.world).phase[2] = 'idle';
    const presses: number[] = [];
    for (let t = 0; t < 400; t++) {
      const player = w.world.movers[PLAYER_ID];
      const c = w.world.movers[2];
      if (player && c) c.pos = { ...player.pos, d: player.pos.d - 1.0 }; // alongside, inside reach
      w.step(1);
      if (((w.world.inputs[2]?.flags ?? 0) & InputFlag.attack) !== 0) presses.push(w.world.tick - 1);
    }
    expect(presses).toEqual([0, 360]); // the default 6 s
  });

  it('an unarmed cop never presses attack, and nobody out of reach is swung at', () => {
    const unarmed = lawWorld(config(mix({ baseCount: 1 })));
    unarmed.step(300);
    expect(unarmed.world.inputs[2]?.flags ?? 0).toBe(0);
    const far = lawWorld(config(mix({ baseCount: 1 })));
    combatState(far.world).held[2] = BATON.contentId;
    combatState(far.world).phase[2] = 'idle';
    let pressed = false;
    for (let t = 0; t < 300; t++) {
      far.step(1);
      pressed ||= ((far.world.inputs[2]?.flags ?? 0) & InputFlag.attack) !== 0;
    }
    expect(pressed).toBe(false); // he starts 50 m behind and the riders here do not move
  });
});
