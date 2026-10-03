// Playtest 2's heat meter (the maintainer's COPS answer, "Mix of 2 and 1 (reliable but rich)": a
// heat meter; chaos raises heat, which brings more cops and then a roadblock; lose them by riding
// clean). Only the cops system steps here (riders stand where a test puts them; this tick's events
// are injected), so the rules are pinned, not the ride.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import { SIM_TUNING, type SimConfig, type SimEvent, type SimEventCops, type SimRiderDef } from '../api';
import { riderState, ridersSystem } from '../riders';
import { addMover, createWorld, type World } from '../world';
import {
  addHeat,
  COP_CHASING,
  COP_DONE,
  COP_PARKED,
  copsState,
  copsSystem,
  HEAT,
  HEAT_MAX,
  lawSnapshot,
  roadblockSpots,
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
const cop = (id: string): SimRiderDef => ({
  contentId: `base:${id}`,
  name: id,
  role: 'cop',
  faction: 'law',
  controller: { kind: 'cop' },
  bike,
  massKg: 95,
  healthMax: 100,
  law: { agency: 'base:test-law', bustRadiusM: 14, bustDwellS: 1, fineCash: 400, pursuitSpeedScale: 1 },
});

const RIVAL = 0;
const PLAYER = 1;
const COPS = [2, 3, 4];

/** Rival 0, player 1, cops 2-4 (all left in the lot) on a 2.4 km straight fixture road. */
function config(
  over: Partial<SimEventCops> = {},
  tuning: Record<string, number> = {},
  copCount = COPS.length,
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
  const cops: SimEventCops = {
    mode: 'every-race',
    baseCount: 0,
    tierScale: 0,
    chaosSummon: false,
    randomness: 0,
    heat: true,
    ...over,
  };
  return {
    seed: 3,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
      cops,
    },
    riders: [
      rider('rival', 'rival'),
      rider('player', 'player'),
      ...Array.from({ length: copCount }, (_, k) => cop(`c${k + 1}`)),
    ],
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
function heatWorld(cfg: SimConfig) {
  const world: World = createWorld(cfg);
  addMover(world, 'rider', { edge: 1, s: 320, d: 1.7, dir: 1 }, RIVAL);
  addMover(world, 'rider', { edge: 1, s: 300, d: 1.7, dir: 1 }, PLAYER);
  for (let i = 2; i < cfg.riders.length; i++)
    addMover(world, 'rider', { edge: 0, s: 40, d: 4.15, dir: 1 }, i);
  ridersSystem.init(world, cfg);
  copsSystem.init(world, cfg);
  const player = world.movers[PLAYER];
  if (player) player.speed = 30;
  const events: SimEvent[] = [];
  const step = (n = 1, inject: (t: number) => SimEvent[] = () => []) => {
    for (let i = 0; i < n; i++) {
      world.events = inject(world.tick);
      copsSystem.step(world, cfg);
      events.push(...world.events.filter((e) => e.type === 'siren' || e.type === 'heat'));
      world.tick++;
    }
  };
  const hit = (actor: number, target: number): SimEvent => ({
    tick: world.tick,
    type: 'hit',
    actor,
    target,
    data: {},
    causeId: 0,
  });
  const st = copsState(world);
  const heat = () => st.heat[PLAYER] ?? 0;
  return { world, cfg, step, events, hit, st, heat };
}

describe('playtest 2: the heat meter', () => {
  it('a hit the player lands adds 4, on a cop 14; a takedown 12, of a cop 24; rivals add nothing', () => {
    const w = heatWorld(config());
    w.step(1, () => [w.hit(RIVAL, PLAYER), w.hit(RIVAL, 2)]);
    expect(w.heat()).toBe(0);
    w.step(1, () => [w.hit(PLAYER, RIVAL)]);
    expect(w.heat()).toBe(HEAT.hit);
    w.step(1, () => [w.hit(PLAYER, 2)]);
    expect(w.heat()).toBe(HEAT.hit * 2 + HEAT.hitCop);
    const td = (target: number): SimEvent => ({
      tick: w.world.tick,
      type: 'takedown',
      actor: PLAYER,
      target,
      data: { kind: 'health' },
      causeId: 0,
    });
    w.step(1, () => [td(RIVAL)]);
    expect(w.heat()).toBe(HEAT.hit * 2 + HEAT.hitCop + HEAT.takedown);
  });

  it('cools only after 4 s with no new heat, at cops.heatDecayPerS (2.5, and a non-default 5)', () => {
    for (const rate of [2.5, 5]) {
      const w = heatWorld(config({}, { 'cops.heatDecayPerS': rate }));
      w.step(1, () => [w.hit(PLAYER, RIVAL), w.hit(PLAYER, RIVAL), w.hit(PLAYER, RIVAL)]); // 12 points
      w.step(HEAT.calmS * 60 - 2);
      expect(w.heat()).toBe(12);
      w.step(2 + 60);
      expect(w.heat()).toBeCloseTo(12 - rate, 0);
    }
  });

  it('cops.heatScale scales the heat chaos adds (non-default 2), and HEAT_MAX caps it', () => {
    const w = heatWorld(config({}, { 'cops.heatScale': 2 }));
    w.step(1, () => [w.hit(PLAYER, RIVAL)]);
    expect(w.heat()).toBe(HEAT.hit * 2);
    addHeat(w.world, w.cfg, PLAYER, 1000);
    expect(w.heat()).toBe(HEAT_MAX);
  });

  it('tier 1 sends one cop from the lot, 90 m behind the player at his speed, siren on (cause heat)', () => {
    const w = heatWorld(config());
    addHeat(w.world, w.cfg, PLAYER, HEAT.tiers[0] ?? 25);
    w.step(1);
    const tiers = w.events.filter((e) => e.type === 'heat');
    expect(tiers.map((e) => [e.actor, e.data['tier'], e.data['from']])).toEqual([[PLAYER, 1, 0]]);
    const sirens = w.events.filter((e) => e.type === 'siren' && e.data['on'] === true);
    expect(sirens.map((e) => [e.actor, e.data['cause'], e.data['tier']])).toEqual([[2, 'heat', 1]]);
    const c = w.world.movers[2];
    const p = w.world.movers[PLAYER];
    if (!c || !p) throw new Error('no movers');
    const gap = w.cfg.route.progressAt(p.pos.edge, p.pos.s) - w.cfg.route.progressAt(c.pos.edge, c.pos.s);
    expect(gap).toBeCloseTo(HEAT.behindM, 6);
    expect(c.pos.d).toBe(1.7); // the route-forward travel lane
    expect(c.speed).toBe(30);
    expect(w.st.phase[2]).toBe(COP_CHASING);
    expect(w.st.target[2]).toBe(PLAYER);
    expect(lawSnapshot(w.world, w.cfg)).toEqual({
      heat: 25 / HEAT_MAX,
      tier: 1,
      lost: false,
      citations: 0,
      citationCash: 0,
    });
  });

  it('tier 2 sends the pursuit pair; a jump straight to tier 2 sends all three', () => {
    const w = heatWorld(config());
    addHeat(w.world, w.cfg, PLAYER, 26);
    w.step(1);
    addHeat(w.world, w.cfg, PLAYER, 26);
    w.step(1);
    const sirens = w.events.filter((e) => e.type === 'siren' && e.data['on'] === true);
    expect(sirens.map((e) => [e.actor, e.data['tier']])).toEqual([
      [2, 1],
      [3, 2],
      [4, 2],
    ]);
    const jump = heatWorld(config());
    addHeat(jump.world, jump.cfg, PLAYER, 55);
    jump.step(1);
    expect(jump.events.filter((e) => e.type === 'siren').map((e) => e.actor)).toEqual([2, 3, 4]);
  });

  it('a heat cop well back closes with a pursuit burst (the riders boost)', () => {
    const w = heatWorld(config());
    addHeat(w.world, w.cfg, PLAYER, 25);
    w.step(1);
    expect(riderState(w.world).boost[2] ?? 0).toBeGreaterThan(0);
    expect(riderState(w.world).boostMps[2]).toBe(HEAT.catchUpMps);
    const input = w.world.inputs[2];
    expect(input?.throttle).toBe(255);
  });

  it('riding clean to zero heat loses them: heat cops give up (siren off), lost holds until heat rises', () => {
    const w = heatWorld(config());
    addHeat(w.world, w.cfg, PLAYER, 26);
    w.step(1);
    expect(w.st.phase[2]).toBe(COP_CHASING);
    // 26 points at 2.5 a second after 4 s calm (the cop is 90 m back, past the near range).
    w.step(60 * (HEAT.calmS + 26 / 2.5) + 30);
    expect(w.heat()).toBe(0);
    expect(w.st.phase[2]).toBe(COP_DONE);
    const last = w.events.filter((e) => e.type === 'heat').at(-1);
    expect(last?.data).toMatchObject({ tier: 0, lost: true });
    expect(w.events.some((e) => e.type === 'siren' && e.actor === 2 && e.data['on'] === false)).toBe(true);
    expect(lawSnapshot(w.world, w.cfg).lost).toBe(true);
    // Heat again: lost clears, and a cop whose chase ended can be sent once more.
    addHeat(w.world, w.cfg, PLAYER, 30);
    w.step(1);
    expect(lawSnapshot(w.world, w.cfg).lost).toBe(false);
    expect(w.st.phase[2]).toBe(COP_CHASING);
  });

  it('a tier falls back only 8 below its threshold, and is not re-sent until he loses them', () => {
    const w = heatWorld(config());
    addHeat(w.world, w.cfg, PLAYER, 30);
    w.step(1);
    w.st.heat[PLAYER] = 20; // inside the band
    w.step(1);
    expect(w.st.heatTier[PLAYER]).toBe(1);
    w.st.heat[PLAYER] = 16;
    w.step(1);
    expect(w.st.heatTier[PLAYER]).toBe(0);
    addHeat(w.world, w.cfg, PLAYER, 10);
    w.step(1);
    expect(w.st.heatTier[PLAYER]).toBe(1);
    const sent = w.events.filter((e) => e.type === 'siren' && e.data['on'] === true);
    expect(sent).toHaveLength(1);
  });

  it('riding the wrong way in a travel lane adds about 5 a second; the right way adds nothing', () => {
    const w = heatWorld(config());
    w.step(60);
    expect(w.heat()).toBe(0);
    const p = w.world.movers[PLAYER];
    if (p) p.pos = { edge: 1, s: 300, d: 1.7, dir: -1 };
    w.step(60);
    expect(w.heat()).toBeCloseTo(HEAT.wrongWayPerS, 6);
  });

  it('without the event switch there is no meter: chaos adds nothing and nobody is sent', () => {
    const w = heatWorld(config({ heat: false }));
    w.step(10, () => [w.hit(PLAYER, 2)]);
    addHeat(w.world, w.cfg, PLAYER, 80);
    w.step(1);
    expect(w.heat()).toBe(0);
    expect(w.events).toEqual([]);
  });

  it('riding off the road with no cop near cools it 3 times as fast; on the paved road, the plain rate', () => {
    const w = heatWorld(config());
    w.cfg.road.groundAt = () => 'dirt';
    w.step(1, () => [w.hit(PLAYER, RIVAL), w.hit(PLAYER, RIVAL), w.hit(PLAYER, RIVAL)]); // 12 points
    w.step(HEAT.calmS * 60 - 1 + 60);
    expect(w.heat()).toBeCloseTo(12 - 2.5 * HEAT.offRoadScale, 0);
    // On the paved road it is the plain rate.
    const paved = heatWorld(config());
    paved.cfg.road.groundAt = () => 'asphalt';
    paved.step(1, () => [paved.hit(PLAYER, RIVAL), paved.hit(PLAYER, RIVAL), paved.hit(PLAYER, RIVAL)]);
    paved.step(HEAT.calmS * 60 - 1 + 60);
    expect(paved.heat()).toBeCloseTo(12 - 2.5, 0);
  });

  it('tier 3 parks a roadblock across his lanes 300 m up the road, sirens on; past it, they chase', () => {
    const w = heatWorld(config({}, {}, 5));
    addHeat(w.world, w.cfg, PLAYER, HEAT.tiers[2] ?? 80);
    w.step(1);
    const sirens = w.events.filter((e) => e.type === 'siren' && e.data['on'] === true);
    expect(sirens.map((e) => [e.actor, e.data['cause'], e.data['tier']])).toEqual([
      [2, 'heat', 1],
      [3, 'heat', 2],
      [4, 'heat', 2],
      [5, 'roadblock', 3],
      [6, 'roadblock', 3],
    ]);
    const p = w.world.movers[PLAYER];
    if (!p) throw new Error('no player');
    const at = w.cfg.route.progressAt(p.pos.edge, p.pos.s);
    const where = roadblockSpots(w.cfg, at);
    expect(where?.at).toBeCloseTo(at + HEAT.roadblockAheadM, 6);
    for (const [k, id] of [5, 6].entries()) {
      const c = w.world.movers[id];
      expect(c?.pos).toEqual(where?.spots[k]);
      expect(w.st.phase[id]).toBe(COP_PARKED);
      expect(c?.speed).toBe(0);
      expect(w.world.inputs[id]?.brake).toBe(255);
    }
    // One across his lane (the travel lane his way), the other on its shoulder: the one-lane road.
    expect(w.world.movers[5]?.pos.d).toBe(1.7);
    expect(Math.abs((w.world.movers[6]?.pos.d ?? 0) - 1.7)).toBeGreaterThan(1.5);
    // He rides past: they pull out after him as heat cops.
    p.pos = { ...p.pos, edge: 1, s: (w.world.movers[5]?.pos.s ?? 0) + 5 };
    w.step(1);
    expect(w.st.phase[5]).toBe(COP_CHASING);
    expect(w.st.target[5]).toBe(PLAYER);
  });

  it('a roadblock lifts after 45 s (non-default: no cooling) and when he loses them', () => {
    const w = heatWorld(config({}, { 'cops.heatDecayPerS': 0 }, 5));
    const p = w.world.movers[PLAYER];
    if (p) p.speed = 0;
    addHeat(w.world, w.cfg, PLAYER, 85);
    w.step(1);
    expect(w.st.phase[5]).toBe(COP_PARKED);
    w.step(HEAT.roadblockS * 60 - 2);
    expect(w.st.phase[5]).toBe(COP_PARKED);
    w.step(2);
    expect(w.st.phase[5]).toBe(COP_DONE);
    expect(w.events.some((e) => e.type === 'siren' && e.actor === 5 && e.data['on'] === false)).toBe(true);

    const lost = heatWorld(config({}, {}, 5));
    const q = lost.world.movers[PLAYER];
    if (q) q.speed = 0;
    addHeat(lost.world, lost.cfg, PLAYER, 81);
    lost.step(1);
    expect(lost.st.phase[6]).toBe(COP_PARKED);
    lost.step(60 * (HEAT.calmS + 81 / 2.5) + 60); // the heat cops stand 90 m back: not near
    expect(lost.heat()).toBe(0);
    expect(lost.st.phase[6]).toBe(COP_DONE);
    expect(lawSnapshot(lost.world, lost.cfg).lost).toBe(true);
  });

  it('no roadblock near the finish, and none when every cop is busy', () => {
    const cfg = config();
    expect(roadblockSpots(cfg, cfg.route.length - HEAT.roadblockAheadM)).toBeNull();
    const w = heatWorld(config());
    addHeat(w.world, w.cfg, PLAYER, 85);
    w.step(1);
    expect(w.events.filter((e) => e.type === 'siren' && e.data['cause'] === 'roadblock')).toEqual([]);
  });
});
