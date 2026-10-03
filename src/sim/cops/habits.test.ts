// Law with a personality (the pitch deck's #11, run W-T): every region's cop chases his own way,
// on top of playtest 2's patrol and heat meter. Only the cops system steps here (riders stand where
// a test puts them), so the rules are pinned, not the ride. Real races are in
// tests/sim/cops-law-personality.test.ts.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import {
  LAW_PROP_ID_BASE,
  SIM_TUNING,
  type SimConfig,
  type SimEvent,
  type SimEventCops,
  type SimLawHabit,
  type SimRiderDef,
} from '../api';
import { riderState, ridersSystem } from '../riders';
import { addMover, createWorld, type World } from '../world';
import {
  addHeat,
  COP_CHASING,
  COP_DONE,
  COP_PARKED,
  copsState,
  copsSystem,
  HABIT,
  HEAT,
  JURISDICTION,
  lawProps,
  lawSnapshot,
  relentlessness,
  routePosAt,
} from './index';

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
const cop = (id: string, habit?: SimLawHabit): SimRiderDef => ({
  contentId: `base:${id}`,
  name: id,
  role: 'cop',
  faction: 'law',
  controller: { kind: 'cop' },
  bike,
  massKg: 95,
  healthMax: 100,
  law: {
    agency: 'base:test-law',
    bustRadiusM: 14,
    bustDwellS: 1,
    fineCash: 400,
    pursuitSpeedScale: 1,
    ...(habit ? { habit } : {}),
  },
});

const RIVAL = 0;
const PLAYER = 1;
const COP = 2;

/** Rival 0, player 1, the cops from 2 on a 2.4 km straight fixture road (progress = s + 800 per road). */
function config(
  cops: SimRiderDef[],
  over: Partial<SimEventCops> = {},
  tuning: Record<string, number> = {},
): SimConfig {
  const road = createRoadNetwork(
    fixtureNetwork([
      { id: 'a', lengthM: 800, kappa: 0 },
      { id: 'b', lengthM: 800, kappa: 0 },
      { id: 'c', lengthM: 800, kappa: 0 },
    ]),
  );
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 60, dir: 1 },
    finish: { road: 'c', s: 780 },
    mainPath: ['a', 'b', 'c'],
    allowedRoads: ['a', 'b', 'c'],
    closed: false,
  });
  return {
    seed: 3,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
      cops: { mode: 'every-race', baseCount: 0, tierScale: 0, chaosSummon: false, randomness: 0, ...over },
    },
    riders: [rider('rival', 'rival'), rider('player', 'player'), ...cops],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), ...tuning },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

/** A world with only the cops system stepping; the player at s 300 of road b (progress 1040). */
function lawWorld(cfg: SimConfig) {
  const world: World = createWorld(cfg);
  addMover(world, 'rider', { edge: 1, s: 320, d: -1.7, dir: 1 }, RIVAL);
  addMover(world, 'rider', { edge: 1, s: 300, d: 1.7, dir: 1 }, PLAYER);
  for (let i = 2; i < cfg.riders.length; i++)
    addMover(world, 'rider', { edge: 0, s: 40, d: 4.15, dir: 1 }, i);
  ridersSystem.init(world, cfg);
  copsSystem.init(world, cfg);
  const player = world.movers[PLAYER];
  if (player) player.speed = 30;
  const events: SimEvent[] = [];
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      world.events = [];
      copsSystem.step(world, cfg);
      events.push(...world.events);
      world.tick++;
    }
  };
  const st = copsState(world);
  /** Puts cop `id` on the road `gapM` behind the player (negative: ahead), chasing him. */
  const chase = (id: number, gapM: number, dd = 0) => {
    const c = world.movers[id];
    const p = world.movers[PLAYER];
    if (!c || !p) throw new Error('no movers');
    const pos = routePosAt(cfg, cfg.route.progressAt(p.pos.edge, p.pos.s) - gapM);
    if (!pos) throw new Error(`no road ${gapM} m behind the player`);
    c.pos = { ...pos, d: p.pos.d + dd };
    c.speed = p.speed;
    st.phase[id] = COP_CHASING;
    st.spawns[id] = 1;
    st.sirenOn[id] = 1;
    st.target[id] = PLAYER;
  };
  const law = (kind: string) => events.filter((e) => e.type === 'law' && e.data['kind'] === kind);
  /** Puts the player at a route progress, in his lane. */
  const at = (progress: number) => {
    const p = world.movers[PLAYER];
    const pos = routePosAt(cfg, progress);
    if (!p || !pos) throw new Error(`no player or no road at ${progress}`);
    p.pos = { ...pos, d: 1.7 };
  };
  return { world, cfg, step, events, st, chase, law, at };
}

describe('law with a personality: Sgt. Pruitt (relentless)', () => {
  const pruitt = (params: Record<string, number> = {}) => cop('pruitt', { kind: 'relentless', params });

  it('grows more relentless the longer he chases (all race), stepping it up at half and at the top', () => {
    const w = lawWorld(config([pruitt({ rampS: 20 })]));
    w.chase(COP, 40);
    w.step(10 * 60 - 1);
    expect(relentlessness(w.world, w.cfg, COP)).toBeCloseTo((10 * 60 - 1) / (20 * 60), 6);
    expect(w.law('relentless')).toEqual([]);
    w.step(1);
    expect(w.law('relentless').map((e) => [e.actor, e.target, e.data['level']])).toEqual([[COP, PLAYER, 1]]);
    w.step(10 * 60);
    expect(relentlessness(w.world, w.cfg, COP)).toBe(1);
    expect(w.law('relentless').map((e) => e.data['level'])).toEqual([1, 2]);
    // Parked, the clock stops: it is chasing time, not race time.
    w.st.phase[COP] = COP_PARKED;
    w.step(60);
    expect(w.law('relentless')).toHaveLength(2);
  });

  it('at the top he rides harder to catch up: a boost of maxScale over his own top speed while well back', () => {
    const far = lawWorld(config([pruitt({ rampS: 1, maxScale: 1.2 })]));
    far.chase(COP, 40);
    far.step(61);
    far.chase(COP, 200);
    far.step(1);
    expect(riderState(far.world).boostMps[COP]).toBeCloseTo(bike.topSpeedMps * 0.2, 6);
    expect(far.world.inputs[COP]?.throttle).toBe(255);
    // A plain cop that far back gets no boost.
    const plain = lawWorld(config([cop('plain')]));
    plain.chase(COP, 200);
    plain.step(1);
    expect(riderState(plain.world).boost[COP] ?? 0).toBe(0);
  });

  it('closes in sooner: at the top he moves in alongside well before the plain 8 s on station', () => {
    const ticksToMoveIn = (habit: SimRiderDef) => {
      const w = lawWorld(config([habit]));
      w.chase(COP, 15); // on station for both (inside the shorter follow gap at the top)
      if (habit.law?.habit) w.st.chasedFor[COP] = 1e9; // at the top of his ramp
      for (let t = 0; t < 20 * 60; t++) {
        w.step(1);
        if (w.st.closing[COP] === 1) return t;
      }
      return Infinity;
    };
    const plain = ticksToMoveIn(cop('plain'));
    const relentless = ticksToMoveIn(pruitt());
    expect(plain).toBeGreaterThanOrEqual(8 * 60 - 1);
    expect(relentless).toBeLessThan(plain * (1 - HABIT.relentless.hangShare) + 2);
  });
});

describe('law with a personality: Trooper Dalrymple (radar)', () => {
  const trooper = cop('dalrymple', { kind: 'radar', params: { limitMps: 29 } });
  /** The fixture's bridge: water both sides from route progress 1200 to 1700 (road b, s 460 to 960). */
  const BRIDGE = [1200, 1700] as const;
  /** One cop on patrol (no lot starter), heat on; with a bridge unless `dry`. */
  const patrolled = (dry = false) => {
    const cfg = config([trooper], { baseCount: 0, patrolMax: 1, heat: true });
    if (dry) return cfg;
    const road = cfg.road;
    const vergeAt = road.vergeAt.bind(road);
    road.vergeAt = (edge, s, side) => {
      const v = vergeAt(edge, s, side);
      const at = cfg.route.progressAt(edge, s);
      return at >= BRIDGE[0] && at < BRIDGE[1] ? { ...v, edge: 'water' } : v;
    };
    return cfg;
  };

  it('waits at the long bridge (40 m onto it), with his radar beside him', () => {
    const w = lawWorld(patrolled());
    expect(w.st.patrolAt[COP]).toBeCloseTo(BRIDGE[0] + 40, -1);
    expect(w.st.radarAt[COP]).toBe(w.st.patrolAt[COP]);
  });

  it('with no long bridge on the route he patrols as any cop: no radar, and he wakes for anyone', () => {
    const w = lawWorld(patrolled(true));
    expect(w.st.radarAt[COP] ?? -1).toBe(-1);
    expect(lawProps(w.world, w.cfg)).toEqual([]);
    const p = w.world.movers[PLAYER];
    if (!p) throw new Error('no player');
    p.speed = 20;
    w.at((w.st.patrolAt[COP] ?? 0) - 150);
    w.step(1);
    expect(w.law('radar')).toEqual([]);
    expect(w.events.some((e) => e.type === 'siren' && e.actor === COP && e.data['on'] === true)).toBe(true);
  });

  it('clocks a player over the limit (heat, his siren, the chase) as he comes up the road', () => {
    const w = lawWorld(patrolled());
    expect(w.st.patrolAt[COP]).toBeGreaterThan(0);
    const p = w.world.movers[PLAYER];
    if (!p) throw new Error('no player');
    const spot = w.st.patrolAt[COP] ?? 0;
    p.speed = 35;
    w.at(spot - 400);
    w.step(1);
    expect(w.law('radar')).toEqual([]);
    w.at(spot - 150);
    w.step(1);
    expect(
      w.law('radar').map((e) => [e.actor, e.target, e.data['over'], e.data['mps'], e.data['limitMps']]),
    ).toEqual([[COP, PLAYER, true, 35, 29]]);
    expect(w.st.heat[PLAYER]).toBe(HABIT.radar.heat);
    expect(w.events.some((e) => e.type === 'siren' && e.actor === COP && e.data['on'] === true)).toBe(true);
    // Measured once: no second reading as he closes.
    w.at(spot - 60);
    w.step(1);
    expect(w.law('radar')).toHaveLength(1);
    // Drawing level, he pulls out.
    w.at(spot + 1);
    w.step(1);
    expect(w.st.phase[COP]).toBe(COP_CHASING);
  });

  it('lets a player under the limit ride by: no heat, no siren, and he stays parked', () => {
    const w = lawWorld(patrolled());
    const p = w.world.movers[PLAYER];
    if (!p) throw new Error('no player');
    const spot = w.st.patrolAt[COP] ?? 0;
    p.speed = 25;
    w.at(spot - 150);
    w.step(1);
    expect(w.law('radar').map((e) => e.data['over'])).toEqual([false]);
    for (const ds of [-60, -1, 1, 20]) {
      w.at(spot + ds);
      w.step(1);
    }
    expect(w.st.heat[PLAYER] ?? 0).toBe(0);
    expect(w.events.some((e) => e.type === 'siren')).toBe(false);
    expect(w.st.phase[COP]).toBe(COP_PARKED);
  });

  it('puts his radar beside him on the road (a prop)', () => {
    const w = lawWorld(patrolled());
    const props = lawProps(w.world, w.cfg);
    const radar = props.find((q) => q.kind === 'radar');
    expect(radar).toMatchObject({ variant: 'trooper', id: LAW_PROP_ID_BASE + 1 + COP });
  });
});

describe('law with a personality: Deputy Lindqvist (citations)', () => {
  const deputy = cop('lindqvist', { kind: 'citations', params: { everyS: 3, cashEach: 75 } });

  it('writes a citation every 3 s alongside; the snapshot carries the bill so far', () => {
    const w = lawWorld(config([deputy]));
    w.chase(COP, 0, 1.4);
    w.step(3 * 60 - 1);
    expect(w.law('citation')).toEqual([]);
    w.step(1);
    w.step(6 * 60);
    expect(w.law('citation').map((e) => [e.actor, e.target, e.data['count'], e.data['totalCash']])).toEqual([
      [COP, PLAYER, 1, 75],
      [COP, PLAYER, 2, 150],
      [COP, PLAYER, 3, 225],
    ]);
    expect(lawSnapshot(w.world, w.cfg)).toMatchObject({ citations: 3, citationCash: 225 });
  });

  it('writes nothing hanging back, and bills the total once, when the player finishes', () => {
    const w = lawWorld(config([deputy]));
    w.chase(COP, 30);
    w.step(10 * 60);
    expect(w.law('citation')).toEqual([]);
    w.chase(COP, 0, 1.4);
    w.step(6 * 60);
    expect(w.law('bill')).toEqual([]);
    const p = w.world.movers[PLAYER];
    if (!p) throw new Error('no player');
    p.pos = { ...p.pos, edge: 2, s: 785 };
    w.step(3);
    expect(w.law('bill').map((e) => [e.actor, e.target, e.data['count'], e.data['totalCash']])).toEqual([
      [COP, PLAYER, 2, 150],
    ]);
  });

  it('never rams: alongside he rides out of bumping range (wider than a plain cop)', () => {
    const w = lawWorld(config([deputy]));
    w.chase(COP, 0, -3);
    w.st.closing[COP] = 1;
    w.step(1);
    const plain = lawWorld(config([cop('plain')]));
    plain.chase(COP, 0, -3);
    plain.st.closing[COP] = 1;
    plain.step(1);
    // Steering toward a line HABIT.citations.sideM off the player, against a plain cop's 1.2 m.
    const steer = (x: { world: World }) => x.world.inputs[COP]?.steer ?? 0;
    expect(Math.abs(steer(w))).toBeLessThan(Math.abs(steer(plain)));
    expect(HABIT.citations.sideM).toBeGreaterThan(1.2);
  });

  it('is never in a hurry but always there: well back, he closes with his own catch-up', () => {
    const w = lawWorld(config([deputy]));
    w.chase(COP, 200);
    w.step(1);
    expect(riderState(w.world).boostMps[COP]).toBeCloseTo(
      bike.topSpeedMps * (HABIT.citations.maxScale - 1),
      6,
    );
    // On station, no boost is refreshed.
    const near = lawWorld(config([deputy]));
    near.chase(COP, 40);
    near.step(1);
    expect(riderState(near.world).boost[COP] ?? 0).toBe(0);
  });

  it('a plain cop writes no citations, and the snapshot shows none', () => {
    const w = lawWorld(config([cop('plain')]));
    w.chase(COP, 0, 1.4);
    w.step(10 * 60);
    expect(w.events.filter((e) => e.type === 'law')).toEqual([]);
    expect(lawSnapshot(w.world, w.cfg)).toEqual({
      heat: 0,
      tier: 0,
      lost: false,
      citations: 0,
      citationCash: 0,
    });
  });
});

describe('law with a personality: Officer Meter (a pursuit budget)', () => {
  const meter = (budgetS: number) => cop('meter', { kind: 'budget', params: { budgetS } });

  it('chases until his budget is spent, then pulls over for good', () => {
    const w = lawWorld(config([meter(10)]));
    w.chase(COP, 40);
    w.step(10 * 60 - 1);
    expect(w.st.phase[COP]).toBe(COP_CHASING);
    w.step(1);
    expect(w.st.phase[COP]).toBe(COP_DONE);
    expect(w.law('budgetOut').map((e) => [e.actor, e.target, e.data['budgetS']])).toEqual([
      [COP, PLAYER, 10],
    ]);
    expect(w.events.some((e) => e.type === 'siren' && e.actor === COP && e.data['on'] === false)).toBe(true);
  });

  it('spent, he is never sent again: the heat meter takes the next cop instead', () => {
    const w = lawWorld(config([meter(5), cop('plain')], { heat: true }));
    w.chase(COP, 40);
    w.step(5 * 60 + 1);
    expect(w.st.phase[COP]).toBe(COP_DONE);
    addHeat(w.world, w.cfg, PLAYER, HEAT.tiers[0] ?? 25);
    w.step(1);
    const sent = w.events.filter((e) => e.type === 'siren' && e.data['cause'] === 'heat');
    expect(sent.map((e) => e.actor)).toEqual([COP + 1]);
  });
});

describe('law with a personality: the END OF JURISDICTION sign', () => {
  const sign = { label: 'END OF JURISDICTION. Have a nice day.', agency: 'base:test-law' };

  it('stands part-way along the route, with its words, when the heat meter runs', () => {
    const w = lawWorld(config([cop('plain')], { heat: true, jurisdiction: sign }));
    expect(w.st.lineAt).toBeGreaterThanOrEqual(JURISDICTION.share * w.cfg.route.length);
    expect(w.st.lineAt).toBeLessThan(w.cfg.route.length - HEAT.roadblockFinishM);
    const props = lawProps(w.world, w.cfg).filter((q) => q.kind === 'sign');
    expect(props).toEqual([
      expect.objectContaining({
        id: LAW_PROP_ID_BASE,
        variant: 'jurisdiction',
        label: sign.label,
        piece: 'base:test-law',
      }),
    ]);
    // No meter, or no sign in the data: nothing stands.
    const off = lawWorld(config([cop('plain')], { heat: false, jurisdiction: sign }));
    expect(off.st.lineAt).toBe(-1);
    expect(lawProps(off.world, off.cfg)).toEqual([]);
  });

  it('crossing it cools the heat and the cops on him pull over; once a race', () => {
    const w = lawWorld(config([cop('lot'), cop('heat1')], { heat: true, jurisdiction: sign }));
    const p = w.world.movers[PLAYER];
    if (!p) throw new Error('no player');
    // Just short of the line, hot (tier 1 sends a heat cop), with the lot's cop on him too.
    const line = w.st.lineAt;
    w.at(line - 2);
    w.chase(COP, 40);
    addHeat(w.world, w.cfg, PLAYER, 30);
    w.step(1);
    expect(w.st.heatCop[COP + 1]).toBe(1);
    w.at(line + 1);
    w.step(2);
    const crossed = w.law('jurisdiction');
    expect(crossed).toHaveLength(1);
    expect(crossed[0]?.target).toBe(PLAYER);
    expect(crossed[0]?.data['heatBefore']).toBeCloseTo(30 / 100, 6);
    expect(w.st.heat[PLAYER]).toBe(0);
    expect(w.st.phase[COP]).toBe(COP_DONE);
    expect(w.st.phase[COP + 1]).toBe(COP_DONE);
    expect(lawSnapshot(w.world, w.cfg).lost).toBe(true);
    // Back over it and across again: nothing more.
    w.at(line - 10);
    w.step(1);
    w.at(line + 10);
    w.step(1);
    expect(w.law('jurisdiction')).toHaveLength(1);
  });

  it('crossing it clean, with nobody on him, says nothing', () => {
    const w = lawWorld(config([cop('plain')], { heat: true, jurisdiction: sign }));
    const line = w.st.lineAt;
    w.at(line - 2);
    w.step(1);
    w.at(line + 1);
    w.step(1);
    expect(w.law('jurisdiction')).toEqual([]);
  });
});

describe('the roadblock takes a cop trailing far behind (PNW roadblocks were rare)', () => {
  it('a chasing cop out of sight behind the player is radioed ahead to the roadblock', () => {
    const w = lawWorld(config([cop('lot'), cop('h1'), cop('h2'), cop('h3')], { heat: true }));
    // The lot's cop chases from 400 m back (he never catches up); every other cop is a heat cop.
    w.chase(COP, 400);
    addHeat(w.world, w.cfg, PLAYER, 55);
    w.step(1);
    addHeat(w.world, w.cfg, PLAYER, 30);
    w.step(1);
    const blocks = w.events.filter((e) => e.type === 'siren' && e.data['cause'] === 'roadblock');
    expect(blocks.map((e) => e.actor)).toContain(COP);
    expect(w.st.blockAt[COP]).toBeGreaterThan(0);
  });
});
