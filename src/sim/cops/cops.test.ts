import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type RoadPos } from '../../road';
import {
  createSim,
  InputFlag,
  quantizeInput,
  SIM_TUNING,
  type SimConfig,
  type SimEvent,
  type SimRiderDef,
} from '../api';
import { KICK, PUNCH } from '../combat/harness.test-util';
import { ridersSystem } from '../riders';
import { addMover, createWorld, type World } from '../world';
import {
  COP_DONE,
  copsState,
  copsSystem,
  COPS_TUNING,
  CRAWL_MPS,
  HANG_BACK_TICKS,
  MOVE_IN_TICKS,
} from './index';

const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

const RIVAL: SimRiderDef = {
  contentId: 'base:rival',
  name: 'Rival',
  role: 'rival',
  faction: 'rider',
  controller: { kind: 'ai', style: 'racer' },
  bike,
  massKg: 90,
  healthMax: 100,
};
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
const COP: SimRiderDef = {
  contentId: 'base:sgt-pruitt',
  name: 'Sgt. Pruitt',
  role: 'cop',
  faction: 'law',
  controller: { kind: 'cop' },
  bike: { ...bike, topSpeedMps: 38 * 1.05 },
  massKg: 95,
  healthMax: 100,
  law: {
    agency: 'base:test-deputies',
    bustRadiusM: 14,
    bustDwellS: 1,
    fineCash: 400,
    pursuitSpeedScale: 1.05,
  },
};

/**
 * Rival 0, player 1, cop 2, on a 1.3 km fixture road. The siren lead defaults to 0 here, so the
 * M1 tests keep timing the pull-out from the siren; the cops-2 tests set it explicitly.
 */
function fixtureConfig(
  tuning: Record<string, number> = {},
  difficulty: Partial<SimConfig['difficulty']> = {},
): SimConfig {
  const road = createRoadNetwork(
    fixtureNetwork([
      { id: 'a', lengthM: 400, kappa: 0 },
      { id: 'b', lengthM: 500, kappa: 1 / 300, grade: 0.02 },
      { id: 'c', lengthM: 400, kappa: -1 / 400 },
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
    seed: 99,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
    },
    riders: [RIVAL, PLAYER, COP],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), 'cops.sirenLeadS': 0, ...tuning },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1, ...difficulty },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const PLAYER_ID = 1;
const COP_ID = 2;

/**
 * A world with only the cops system stepping, so a test can put riders exactly where it wants and
 * set their mode by hand (the "down" state belongs to tumble-1, which a test stands in for).
 */
function copWorld(tuning: Record<string, number> = {}) {
  const config = fixtureConfig({ 'cops.spawnDelayS': 0, ...tuning });
  const world: World = createWorld(config);
  const at = (s: number, d: number): RoadPos => ({ edge: 0, s, d, dir: 1 });
  addMover(world, 'rider', at(100, 1.7), 0);
  addMover(world, 'rider', at(200, 1.7), 1);
  addMover(world, 'rider', at(190, 1.7), 2);
  ridersSystem.init(world, config);
  copsSystem.init(world, config);
  const events: SimEvent[] = [];
  /** Steps the cops system, plus the riding model when `ride` is set (movers then move). */
  const step = (n = 1, ride = false, earlier: SimEvent[] = []) => {
    for (let i = 0; i < n; i++) {
      world.events = i === 0 ? [...earlier] : []; // `earlier`: events an earlier phase emitted
      if (ride) ridersSystem.step(world, config);
      copsSystem.step(world, config);
      events.push(...world.events);
      world.tick++;
    }
  };
  const place = (id: number, s: number, d = 1.7) => {
    const m = world.movers[id];
    if (m) m.pos = at(s, d);
  };
  const mode = (id: number, value: 'Road' | 'Tumble' | 'OnFoot') => {
    const m = world.movers[id];
    if (m) m.mode = value;
  };
  const busts = () => events.filter((e) => e.type === 'bust');
  return { world, config, step, place, mode, events, busts };
}

describe('cops: tuning declarations', () => {
  it('declares the thirteen cop parameters (M4 cops-3 added six, playtest 1c the launch share) inside their ranges, all sim-affecting', () => {
    expect(COPS_TUNING.map((d) => d.id).sort()).toEqual([
      'cops.bustDwellScale',
      'cops.bustRadiusScale',
      'cops.chaosDecayPerS',
      'cops.chaosSummonAt',
      'cops.fineTierScale',
      'cops.followGapM',
      'cops.launchShare',
      'cops.maxActive',
      'cops.sirenLeadS',
      'cops.spawnChance',
      'cops.spawnDelayS',
      'cops.swingEveryS',
      'cops.waveGapS',
    ]);
    for (const d of COPS_TUNING) {
      expect(d.affectsSim).toBe(true);
      expect(d.default).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeLessThanOrEqual(d.max);
    }
    const scales = COPS_TUNING.filter((d) => d.id.startsWith('cops.bust') && d.id.endsWith('Scale'));
    expect(scales.map((d) => d.default)).toEqual([1, 1]);
  });
});

describe('cops: the crude bust', () => {
  it('fires when the player is down inside the radius for the full dwell (60 ticks)', () => {
    const w = copWorld();
    w.place(COP_ID, 190); // 10 m behind the player, inside 14 m
    w.mode(PLAYER_ID, 'Tumble');
    w.step(59);
    expect(w.busts()).toHaveLength(0);
    w.step(1);
    expect(w.busts()).toHaveLength(1);
    const bust = w.busts()[0];
    expect(bust?.actor).toBe(COP_ID);
    expect(bust?.target).toBe(PLAYER_ID);
    expect(bust?.data['fineCash']).toBe(400);
    expect(copsState(w.world).busted).toEqual([PLAYER_ID]);
    w.step(120);
    expect(w.busts()).toHaveLength(1); // once per player
  });

  it('counts running back on foot as down', () => {
    const w = copWorld();
    w.mode(PLAYER_ID, 'OnFoot');
    w.step(60);
    expect(w.busts()).toHaveLength(1);
  });

  it('does not fire outside the radius', () => {
    const w = copWorld();
    w.place(COP_ID, 185); // 15 m behind
    w.mode(PLAYER_ID, 'Tumble');
    w.step(600);
    expect(w.busts()).toHaveLength(0);
  });

  it('does not fire for a shorter time, and the dwell starts over after the player gets up', () => {
    const w = copWorld();
    w.mode(PLAYER_ID, 'Tumble');
    w.step(59);
    w.mode(PLAYER_ID, 'Road');
    w.step(1);
    w.mode(PLAYER_ID, 'Tumble');
    w.step(59);
    expect(w.busts()).toHaveLength(0);
    w.step(1);
    expect(w.busts()).toHaveLength(1);
  });

  it('does not bust a player who is riding, however close', () => {
    const w = copWorld();
    w.place(COP_ID, 199);
    w.step(600);
    expect(w.busts()).toHaveLength(0);
  });

  it('never busts a rival: only players', () => {
    const w = copWorld();
    w.place(0, 195);
    w.mode(0, 'Tumble');
    w.step(600);
    expect(w.busts()).toHaveLength(0);
  });

  it('a knocked-down cop cannot bust anyone until he is back up', () => {
    const w = copWorld();
    w.mode(COP_ID, 'Tumble');
    w.mode(PLAYER_ID, 'Tumble');
    w.step(300);
    expect(w.busts()).toHaveLength(0);
    w.mode(COP_ID, 'Road');
    w.step(59);
    expect(w.busts()).toHaveLength(0); // the dwell counts only from when he is up
    w.step(1);
    expect(w.busts()).toHaveLength(1);
  });

  it('scales the radius and the dwell by their tuning keys', () => {
    const wide = copWorld({ 'cops.bustRadiusScale': 2 });
    wide.place(COP_ID, 175); // 25 m: outside 14 m, inside 28 m
    wide.mode(PLAYER_ID, 'Tumble');
    wide.step(60);
    expect(wide.busts()).toHaveLength(1);

    const slow = copWorld({ 'cops.bustDwellScale': 1.5 });
    slow.mode(PLAYER_ID, 'Tumble');
    slow.step(89);
    expect(slow.busts()).toHaveLength(0);
    slow.step(1);
    expect(slow.busts()).toHaveLength(1);
  });

  it('counts the dwell in scaled time: a frozen hit-stop adds nothing, half speed takes twice as long', () => {
    const w = copWorld();
    w.mode(PLAYER_ID, 'Tumble');
    w.world.timeScale = 0;
    w.step(200);
    expect(w.busts()).toHaveLength(0);
    w.world.timeScale = 0.5;
    w.step(119);
    expect(w.busts()).toHaveLength(0);
    w.step(1);
    expect(w.busts()).toHaveLength(1);
  });

  it('waits out the spawn delay before he can bust, then sounds the siren', () => {
    const w = copWorld({ 'cops.spawnDelayS': 2 });
    w.mode(PLAYER_ID, 'Tumble');
    w.step(119);
    expect(w.busts()).toHaveLength(0);
    expect(w.events.filter((e) => e.type === 'siren')).toHaveLength(0);
    w.step(61);
    const sirens = w.events.filter((e) => e.type === 'siren');
    expect(sirens[0]?.data['on']).toBe(true);
    expect(sirens[0]?.actor).toBe(COP_ID);
    expect(w.busts()).toHaveLength(1);
  });

  it('stays parked when difficulty sets the cop frequency to zero', () => {
    const w = copWorld();
    const config = { ...w.config, difficulty: { ...w.config.difficulty, copFrequency: 0 } };
    const world = createWorld(config);
    for (const m of w.world.movers) addMover(world, m.kind, { ...m.pos }, m.riderIndex);
    ridersSystem.init(world, config);
    copsSystem.init(world, config);
    const player = world.movers[PLAYER_ID];
    if (player) player.mode = 'Tumble';
    const seen: SimEvent[] = [];
    for (let t = 0; t < 600; t++) {
      world.events = [];
      copsSystem.step(world, config);
      seen.push(...world.events);
      world.tick++;
    }
    expect(seen.filter((e) => e.type === 'bust' || e.type === 'siren')).toHaveLength(0);
  });
});

describe('cops: whom he chases', () => {
  const hitBy = (actor: number, tick: number): SimEvent => ({
    tick,
    type: 'hit',
    actor,
    target: PLAYER_ID,
    causeId: 77,
    data: {},
  });

  it('chases the player by default', () => {
    const w = copWorld();
    w.step(1);
    expect(copsState(w.world).target[COP_ID]).toBe(PLAYER_ID);
  });

  it('turns on whoever causes chaos nearby, for 10 s, then goes back to the player', () => {
    const w = copWorld();
    w.place(0, 185); // the rival, 5 m from the cop
    w.step(1, false, [hitBy(0, w.world.tick)]);
    expect(copsState(w.world).target[COP_ID]).toBe(0);
    w.step(599);
    expect(copsState(w.world).target[COP_ID]).toBe(0);
    w.step(2);
    expect(copsState(w.world).target[COP_ID]).toBe(PLAYER_ID);
  });

  it('ignores chaos far away (more than 60 m)', () => {
    const w = copWorld();
    w.place(0, 100); // 90 m behind the cop
    w.step(1, false, [hitBy(0, w.world.tick)]);
    expect(copsState(w.world).target[COP_ID]).toBe(PLAYER_ID);
  });
});

describe('cops: where he waits (copSpawn)', () => {
  /** The fixture race with a copSpawn lot on road `a` at s 20..30, on the given side. */
  function withLot(side: 1 | -1): SimConfig {
    const base = fixtureConfig({ 'cops.spawnDelayS': 1 });
    const bundle = fixtureNetwork([
      { id: 'a', lengthM: 400, kappa: 0 },
      { id: 'b', lengthM: 500, kappa: 1 / 300, grade: 0.02 },
      { id: 'c', lengthM: 400, kappa: -1 / 400 },
    ]);
    const [a, ...rest] = bundle.roads;
    if (!a) throw new Error('no road a');
    const lot = { kind: 'copSpawn', id: 'lot', s0: 20, s1: 30, d0: side * 5.5, d1: side * 9 };
    const road = createRoadNetwork({ ...bundle, roads: [{ ...a, features: [lot] }, ...rest] });
    const route = createRouteProgress(road, {
      id: 'r',
      network: 'fixture',
      start: { road: 'a', s: 60, dir: 1 },
      finish: { road: 'c', s: 380 },
      mainPath: ['a', 'b', 'c'],
      allowedRoads: ['a', 'b', 'c'],
      closed: false,
    });
    return { ...base, road, route };
  }

  it('waits at the lot, on the shoulder on its side, then pulls out after his siren', () => {
    for (const side of [1, -1] as const) {
      const sim = createSim(withLot(side));
      const cop = sim.snapshot().entities[COP_ID];
      expect(cop?.road).toMatchObject({ edge: 0, s: 25, d: side * 4.15, dir: 1 });
      for (let t = 0; t < 50; t++) sim.step([quantizeInput({ throttle: 1, brake: 0, steer: 0, flags: 0 })]);
      expect(sim.snapshot().entities[COP_ID]?.road.s).toBe(25); // parked during the spawn delay
      for (let t = 50; t < 400; t++) sim.step([quantizeInput({ throttle: 1, brake: 0, steer: 0, flags: 0 })]);
      expect(sim.snapshot().entities[COP_ID]?.speed).toBeGreaterThan(10); // then gives chase
    }
  });

  it('without a copSpawn on the route he keeps his grid slot behind the field', () => {
    const config = fixtureConfig();
    const sim = createSim(config);
    expect(sim.snapshot().entities[COP_ID]?.road.s).toBeLessThan(config.route.start.s);
    expect(Math.abs(sim.snapshot().entities[COP_ID]?.road.d ?? 9)).toBeLessThan(3.4);
  });
});

describe('cops: the chase', () => {
  /** Full throttle for `rideTicks`, then brake to a stop and wait. */
  function scripted(tick: number, rideTicks: number) {
    return quantizeInput({
      throttle: tick < rideTicks ? 1 : 0,
      brake: tick < rideTicks ? 0 : 1,
      steer: 0,
      flags: 0,
    });
  }

  function runChase(rideTicks = 60 * 12, tuning: Record<string, number> = {}) {
    const sim = createSim(fixtureConfig({ 'cops.spawnDelayS': 1, 'cops.followGapM': 40, ...tuning }));
    const hashes: number[] = [];
    const events: SimEvent[] = [];
    const gaps: number[] = [];
    for (let t = 0; t < rideTicks + 60 * 28; t++) {
      sim.step([scripted(t, rideTicks)]);
      hashes.push(sim.hash());
      events.push(...sim.events());
      const snap = sim.snapshot();
      const me = snap.entities[PLAYER_ID];
      const cop = snap.entities[COP_ID];
      if (me && cop) gaps.push(me.progress - cop.progress);
    }
    return { sim, hashes, events, gaps };
  }

  // The road lane's launch report (playtest 1c): when the cop got the launch punch he caught up from
  // the lot, and a player who then braked hard had him sail past "at every brake time from 8 to
  // 25 s", then crawl on along the shoulder for good. With `cops.launchShare` at 1 (a non-default
  // value: by default he still rides without it) he gets the racers' punch: hanging back he stops
  // behind a braking player (below); moving in alongside he can be carried past one who slams on the
  // brakes, as any rider beside you would be, but then he pulls onto the shoulder and waits.
  it('with the launch punch, braking hard at any time never leaves him crawling on ahead', () => {
    const rows: string[] = [];
    for (const brakeS of [6, 8, 10, 12, 14, 16, 18, 20]) {
      const { sim, gaps } = runChase(60 * brakeS, { 'cops.launchShare': 1 });
      const after = gaps.slice(60 * brakeS);
      const closest = Math.min(...after);
      // Where he ended, 28 s after the player stopped, against where he was 8 s before that.
      const end = gaps[gaps.length - 1] ?? 0;
      const before = gaps[gaps.length - 1 - 60 * 8] ?? 0;
      rows.push(`${brakeS} s: closest ${closest.toFixed(1)} m, ends ${end.toFixed(1)} m`);
      expect(closest, `braking at ${brakeS} s: carried past by at most a stopping distance`).toBeGreaterThan(
        -40,
      );
      expect(Math.abs(end - before), `braking at ${brakeS} s: he waits, not crawling on`).toBeLessThan(1);
      expect(sim.snapshot().entities[COP_ID]?.speed ?? 9, `braking at ${brakeS} s`).toBeLessThan(0.5);
    }
    console.log(`[cops] the chase, braking at: ${rows.join('; ')}`);
  });

  it('the cop is a law-faction rider driven by nobody but sim/cops', () => {
    const sim = createSim(fixtureConfig({ 'cops.spawnDelayS': 1 }));
    const cop = sim.snapshot().entities[COP_ID];
    expect(cop?.faction).toBe('law');
    expect(cop?.slot).toBe(-1);
    for (let t = 0; t < 50; t++) sim.step([scripted(t, 1000)]);
    expect(sim.snapshot().entities[COP_ID]?.speed).toBe(0); // parked during the spawn delay
    for (let t = 50; t < 300; t++) sim.step([scripted(t, 1000)]);
    expect(sim.snapshot().entities[COP_ID]?.speed).toBeGreaterThan(10); // then gives chase
  });

  it('catches a player who stops, and ends up stopped alongside him without passing', () => {
    const { sim, events, gaps } = runChase();
    const sirenOn = events.find((e) => e.type === 'siren' && e.data['on'] === true);
    expect(sirenOn?.tick).toBe(60);
    // The cop starts on the grid beside the player and falls behind while parked. The player
    // stops hard after 12 s but stays upright; the cop catches up, and after his spell hanging
    // back he moves in alongside a player who is not going anywhere.
    const final = gaps[gaps.length - 1] ?? Infinity;
    expect(Math.abs(final)).toBeLessThanOrEqual(4);
    expect(Math.min(...gaps)).toBeGreaterThan(-2); // never passes him
    expect(sim.snapshot().entities[COP_ID]?.speed).toBeLessThan(1);
    for (const e of sim.snapshot().entities) {
      expect(Number.isFinite(e.road.s) && Number.isFinite(e.road.d)).toBe(true);
    }
    expect(events.filter((e) => e.type === 'bust')).toHaveLength(0);
  });

  it('rides in alongside a cruising player inside punch and kick reach, then drops back', () => {
    const w = copWorld({ 'cops.followGapM': 40 });
    w.place(0, 20); // the rival sits out of the way at the back
    w.place(PLAYER_ID, 160);
    w.place(COP_ID, 100);
    for (const id of [PLAYER_ID, COP_ID]) {
      const m = w.world.movers[id];
      if (m) m.speed = 25;
    }
    const inputs = w.world.inputs;
    const ahead: number[] = [];
    const across: number[] = [];
    for (let t = 0; t < 60 * 30; t++) {
      const me = w.world.movers[PLAYER_ID];
      const cop = w.world.movers[COP_ID];
      if (!me || !cop) throw new Error('missing movers');
      // The player cruises in his lane (steering like the fixture race in sim.test.ts).
      const steer = Math.max(-1, Math.min(1, (1.7 - me.pos.d) * 0.3 - me.yaw * 2));
      inputs[PLAYER_ID] = quantizeInput({ throttle: 0.55, brake: 0, steer, flags: 0 });
      inputs[0] = quantizeInput({ throttle: 0, brake: 1, steer: 0, flags: 0 });
      w.step(1, true);
      const route = w.config.route;
      ahead.push(route.progressAt(me.pos.edge, me.pos.s) - route.progressAt(cop.pos.edge, cop.pos.s));
      across.push(me.pos.d - cop.pos.d);
    }
    const onStation = ahead.findIndex((g) => g < 50);
    const spell = ahead.slice(onStation, onStation + 60 * 7);
    expect(Math.min(...spell)).toBeGreaterThan(14);
    // Moving in: inside the auto-target box and the punch's sideways reach, at the player's speed.
    const inReach = ahead.findIndex(
      (g, t) => t > onStation && Math.abs(g) <= 1.2 && Math.abs(across[t] ?? 99) <= 1.4,
    );
    expect(inReach).toBeGreaterThan(onStation + HANG_BACK_TICKS - 60);
    // ...and after the spell alongside he drops back toward the follow gap.
    expect(Math.max(...ahead.slice(inReach + MOVE_IN_TICKS))).toBeGreaterThan(25);
    expect(w.busts()).toHaveLength(0);
  });

  // The integration skeptic and the road lane's launch report (playtest 1c): with the punchy launch
  // the player reaches top speed with the cop hanging back on station, and a hard stop from there
  // left him unable to stop in time: he sailed past and crawled on along the shoulder. Hanging back
  // he now keeps a stopping distance: he can always stop behind where the player can stop. (Moving
  // in alongside, after HANG_BACK_TICKS on station, is a different goal: he rides beside him.)
  for (const followGapM of [40, 15]) {
    it(`hanging back ${followGapM} m at top speed, he stops behind a player who brakes hard, never past him`, () => {
      const w = copWorld({ 'cops.followGapM': followGapM });
      w.place(0, 20); // the rival sits out of the way at the back
      w.place(PLAYER_ID, 300);
      w.place(COP_ID, 300 - followGapM);
      for (const id of [PLAYER_ID, COP_ID]) {
        const m = w.world.movers[id];
        if (m) m.speed = bike.topSpeedMps;
      }
      const inputs = w.world.inputs;
      const route = w.config.route;
      const BRAKE_AT = 60 * 3;
      const gaps: number[] = [];
      let copStopped = -1;
      for (let t = 0; t < HANG_BACK_TICKS - 1; t++) {
        const me = w.world.movers[PLAYER_ID];
        const cop = w.world.movers[COP_ID];
        if (!me || !cop) throw new Error('missing movers');
        const steer = Math.max(-1, Math.min(1, (1.7 - me.pos.d) * 0.3 - me.yaw * 2));
        // Flat out for 3 s (the cop settles on station), then a full stop.
        const braking = t >= BRAKE_AT;
        inputs[PLAYER_ID] = quantizeInput({
          throttle: braking ? 0 : 1,
          brake: braking ? 1 : 0,
          steer,
          flags: 0,
        });
        inputs[0] = quantizeInput({ throttle: 0, brake: 1, steer: 0, flags: 0 });
        w.step(1, true);
        gaps.push(route.progressAt(me.pos.edge, me.pos.s) - route.progressAt(cop.pos.edge, cop.pos.s));
        // Behind a stopped target he rolls on at a crawl toward the shoulder (he never stands in a lane).
        if (braking && copStopped < 0 && cop.speed <= CRAWL_MPS + 0.5) copStopped = t;
      }
      const onStation = gaps[BRAKE_AT - 1] ?? 0;
      const closest = Math.min(...gaps.slice(BRAKE_AT));
      console.log(
        `[cops] hanging back ${followGapM} m at top speed: ${onStation.toFixed(1)} m back when the player braked, ` +
          `closest ${closest.toFixed(1)} m, down to a crawl ${((copStopped - BRAKE_AT) / 60).toFixed(1)} s after`,
      );
      expect(onStation).toBeGreaterThan(followGapM - 5); // he was on station, not hanging far back
      expect(closest).toBeGreaterThan(2); // never alongside or past him
      expect(copStopped).toBeGreaterThan(0); // and slowed to a crawl behind him
      expect(w.busts()).toHaveLength(0);
    });
  }

  it('can be knocked off like any rider: punches take his health, he tumbles, then rides again', () => {
    const config = {
      ...fixtureConfig({ 'cops.spawnDelayS': 0, 'cops.followGapM': 40 }),
      weapons: [PUNCH, KICK],
    };
    const sim = createSim(config);
    const events: SimEvent[] = [];
    let downAt = -1;
    let upAgainAt = -1;
    for (let t = 0; t < 60 * 60 && upAgainAt < 0; t++) {
      const snap = sim.snapshot();
      const me = snap.entities[PLAYER_ID];
      const cop = snap.entities[COP_ID];
      if (!me || !cop) throw new Error('missing entities');
      // Cruise in lane; punch when the cop is inside punch reach, kick when only kick reach fits.
      const ds = cop.progress - me.progress;
      const dd = cop.road.d - me.road.d;
      const up = cop.mode === 'Road';
      const punch = up && Math.abs(ds) <= 1.1 && Math.abs(dd) <= 1.35;
      const kick = up && !punch && Math.abs(ds) <= 0.9 && Math.abs(dd) <= 1.65;
      const side = dd < 0 ? InputFlag.attackSideLeft : InputFlag.attackSideRight;
      // A fresh press every half second (a held button is one press).
      const press = t % 30 === 0;
      const flags = !press
        ? 0
        : punch
          ? InputFlag.attack | side
          : kick
            ? InputFlag.attack | InputFlag.kick | side
            : 0;
      const steer = Math.max(-1, Math.min(1, (1.7 - me.road.d) * 0.3 - me.road.yaw * 2));
      sim.step([quantizeInput({ throttle: 0.55, brake: 0, steer, flags })]);
      events.push(...sim.events());
      const mode = sim.snapshot().entities[COP_ID]?.mode;
      if (downAt < 0 && mode === 'Tumble') downAt = t;
      if (downAt >= 0 && mode === 'Road') upAgainAt = t;
    }
    const hitsOnCop = events.filter((e) => e.type === 'hit' && e.target === COP_ID);
    const knockedOff = events.find((e) => e.type === 'crash' && e.actor === COP_ID);
    expect(hitsOnCop.length).toBeGreaterThan(0);
    expect(knockedOff?.data['reason']).toBe('knockedOff');
    expect(downAt).toBeGreaterThan(0);
    expect(upAgainAt).toBeGreaterThan(downAt); // run back and remounted
    expect(events.filter((e) => e.type === 'bust')).toHaveLength(0);
  });

  it('closes in on a player who goes down, stops beside him and busts him', () => {
    const w = copWorld({ 'cops.followGapM': 40 });
    w.place(COP_ID, 100);
    w.place(0, 60); // the rival is well behind, out of the way
    w.mode(PLAYER_ID, 'Tumble'); // 100 m ahead of the cop, down
    w.step(60 * 15, true);
    expect(w.busts()).toHaveLength(1);
    const bust = w.busts()[0];
    const cop = w.world.movers[COP_ID];
    expect(cop?.pos.s).toBeLessThan(200); // never passes the downed player
    expect(cop?.pos.s).toBeGreaterThan(200 - 14);
    expect(bust?.tick).toBeLessThan(60 * 10);
    // After the bust the chase is over: the siren goes off and he stays put.
    const off = w.events.find((e) => e.type === 'siren' && e.data['on'] === false);
    expect(off?.tick).toBe(bust?.tick);
    expect(cop?.speed).toBeLessThan(0.5);
  });

  it('end to end: crash into the barrier with him alongside, and he busts you', () => {
    // A touchy barrier (crash from 3 m/s into it), so a swerve at cruising speed is a sure crash.
    const sim = createSim(
      fixtureConfig({ 'cops.spawnDelayS': 0, 'cops.followGapM': 40, 'riders.crashImpactMps': 3 }),
    );
    const events: SimEvent[] = [];
    let swerve = false;
    for (let t = 0; t < 60 * 60 && !events.some((e) => e.type === 'bust'); t++) {
      const snap = sim.snapshot();
      const me = snap.entities[PLAYER_ID];
      const cop = snap.entities[COP_ID];
      if (!me || !cop) throw new Error('missing entities');
      // Cruise in lane until the cop is alongside, then swerve hard into the right barrier.
      if (!swerve && me.speed > 20 && Math.abs(cop.progress - me.progress) <= 3) swerve = true;
      const keep = Math.max(-1, Math.min(1, (1.7 - me.road.d) * 0.3 - me.road.yaw * 2));
      sim.step([quantizeInput({ throttle: swerve ? 1 : 0.7, brake: 0, steer: swerve ? 1 : keep, flags: 0 })]);
      events.push(...sim.events());
    }
    const crash = events.find((e) => e.type === 'crash' && e.actor === PLAYER_ID);
    const bust = events.find((e) => e.type === 'bust');
    expect(swerve).toBe(true);
    expect(crash).toBeDefined();
    expect(bust?.actor).toBe(COP_ID);
    expect(bust?.target).toBe(PLAYER_ID);
    expect(bust?.data['fineCash']).toBe(400);
    expect((bust?.tick ?? Infinity) - (crash?.tick ?? 0)).toBeLessThan(60 * 8);
  });

  it('ahead of a stopped target he never stops in the travel lane: he waits on the shoulder, then follows', () => {
    // The M1 skeptic's seed 37: the cop passed a downed player, then braked to a standstill in the
    // lane ahead of him, and traffic queued behind the cop for minutes (it never passes a stopped
    // rider in its lane). Now he eases onto the shoulder, clear of the lane, and waits there.
    const w = copWorld({ 'cops.followGapM': 40 });
    w.place(0, 20); // the rival sits out of the way at the back
    w.place(PLAYER_ID, 200);
    w.place(COP_ID, 260); // 60 m ahead of his target
    const cop = w.world.movers[COP_ID];
    if (cop) cop.speed = 25;
    const inputs = w.world.inputs;
    const stillInLane: number[] = [];
    for (let t = 0; t < 60 * 30; t++) {
      inputs[0] = quantizeInput({ throttle: 0, brake: 1, steer: 0, flags: 0 });
      inputs[PLAYER_ID] = quantizeInput({ throttle: 0, brake: 1, steer: 0, flags: 0 }); // stays put
      w.step(1, true);
      const c = w.world.movers[COP_ID];
      if (c && c.speed < 0.5 && c.pos.d < 1.7 + 1.7 + 0.3) stillInLane.push(t);
    }
    const parked = w.world.movers[COP_ID];
    expect(stillInLane).toEqual([]);
    expect(parked?.speed).toBeLessThan(0.5); // he waits...
    expect(parked?.pos.d).toBeGreaterThanOrEqual(3.7); // ...on the shoulder, clear of the lane
    expect(parked?.pos.s).toBeLessThan(400); // not riding off down the road
    // The player rides on past him; the cop leaves the shoulder and follows.
    for (let t = 0; t < 60 * 25; t++) {
      const me = w.world.movers[PLAYER_ID];
      if (!me) throw new Error('missing player');
      const steer = Math.max(-1, Math.min(1, (1.7 - me.pos.d) * 0.3 - me.yaw * 2));
      inputs[0] = quantizeInput({ throttle: 0, brake: 1, steer: 0, flags: 0 });
      inputs[PLAYER_ID] = quantizeInput({ throttle: 0.55, brake: 0, steer, flags: 0 });
      w.step(1, true);
    }
    const me = w.world.movers[PLAYER_ID];
    const after = w.world.movers[COP_ID];
    const route = w.config.route;
    const gap =
      route.progressAt(me?.pos.edge ?? 0, me?.pos.s ?? 0) -
      route.progressAt(after?.pos.edge ?? 0, after?.pos.s ?? 0);
    expect(gap).toBeGreaterThan(0); // behind his target again
    expect(after?.speed).toBeGreaterThan(10); // and chasing
    expect(after?.pos.d).toBeLessThan(3.4); // back in the travel lane
    expect(w.busts()).toHaveLength(0);
  });

  it('with nobody to chase he pulls onto the shoulder rather than stopping in the lane', () => {
    const w = copWorld();
    w.place(0, 20);
    w.place(PLAYER_ID, 100);
    w.place(COP_ID, 200);
    const cop = w.world.movers[COP_ID];
    if (cop) cop.speed = 20;
    copsState(w.world).phase[COP_ID] = COP_DONE; // the chase is over, nobody busted
    for (let t = 0; t < 60 * 20; t++) {
      w.world.inputs[0] = quantizeInput({ throttle: 0, brake: 1, steer: 0, flags: 0 });
      w.world.inputs[PLAYER_ID] = quantizeInput({ throttle: 0, brake: 1, steer: 0, flags: 0 });
      w.step(1, true);
    }
    const after = w.world.movers[COP_ID];
    expect(after?.speed).toBeLessThan(0.5);
    expect(after?.pos.d).toBeGreaterThanOrEqual(3.7);
  });

  it('a scripted chase gives the same hash every run', () => {
    const a = runChase().hashes;
    const b = runChase().hashes;
    expect(b).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(2000);
  });
});

// cops-2 (docs/milestones/M2.md): the spawn chance and the time to first spawn scale with the
// difficulty's cop frequency, and the siren leads his pull-out by `cops.sirenLeadS`.
describe('cops-2: a difficulty-aware cop', () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

  /** The cops system alone for `ticks`; returns the siren-on tick (or -1) and the pull-out tick. */
  function spawnRun(seed: number, tuning: Record<string, number>, copFrequency: number, ticks: number) {
    const config = { ...fixtureConfig(tuning, { copFrequency }), seed };
    const world = createWorld(config);
    addMover(world, 'rider', { edge: 0, s: 100, d: 1.7, dir: 1 }, 0);
    addMover(world, 'rider', { edge: 0, s: 200, d: 1.7, dir: 1 }, 1);
    addMover(world, 'rider', { edge: 0, s: 190, d: 1.7, dir: 1 }, 2);
    ridersSystem.init(world, config);
    copsSystem.init(world, config);
    let siren = -1;
    let pullOut = -1;
    for (let t = 0; t < ticks; t++) {
      world.events = [];
      copsSystem.step(world, config);
      if (siren < 0 && world.events.some((e) => e.type === 'siren' && e.data['on'] === true)) siren = t;
      if (pullOut < 0 && (world.inputs[COP_ID]?.brake ?? 255) < 255) pullOut = t;
      world.tick++;
    }
    return { siren, pullOut, world };
  }
  const spawned = (tuning: Record<string, number>, copFrequency: number) =>
    SEEDS.filter((seed) => spawnRun(seed, { 'cops.spawnDelayS': 1, ...tuning }, copFrequency, 150).siren >= 0)
      .length;

  it('declares the spawn chance (1 = always on Normal) and the siren lead (3 s)', () => {
    const chance = COPS_TUNING.find((d) => d.id === 'cops.spawnChance');
    const lead = COPS_TUNING.find((d) => d.id === 'cops.sirenLeadS');
    expect(chance).toMatchObject({ default: 1, min: 0, max: 1, affectsSim: true });
    expect(lead).toMatchObject({ default: 3, unit: 's', affectsSim: true });
  });

  it('on Normal he comes out in every race; at half the cop frequency in about half; at 1.5 in all', () => {
    const normal = spawned({}, 1);
    const easy = spawned({}, 0.5);
    const hard = spawned({}, 1.5);
    console.log(
      `[examined] cops-2 spawn chance: ${SEEDS.length} seeds; normal ${normal}, easy ${easy}, hard ${hard}`,
    );
    expect(normal).toBe(SEEDS.length);
    expect(hard).toBe(SEEDS.length);
    expect(easy).toBeGreaterThan(SEEDS.length * 0.25);
    expect(easy).toBeLessThan(SEEDS.length * 0.75);
  });

  it('the spawn chance tuning value multiplies with the cop frequency (non-default values)', () => {
    const quarter = spawned({ 'cops.spawnChance': 0.25 }, 1);
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(SEEDS.length * 0.5);
    expect(spawned({ 'cops.spawnChance': 0.5 }, 2)).toBe(SEEDS.length); // 0.5 x 2 = always
    expect(spawned({ 'cops.spawnChance': 0 }, 1.5)).toBe(0);
  });

  it('a cop who does not come out stays parked and silent all race', () => {
    const seed = SEEDS.find((s) => spawnRun(s, { 'cops.spawnDelayS': 1 }, 0.5, 150).siren < 0);
    expect(seed).toBeDefined();
    const run = spawnRun(seed ?? 0, { 'cops.spawnDelayS': 1 }, 0.5, 60 * 60);
    expect(run.siren).toBe(-1);
    expect(run.pullOut).toBe(-1);
  });

  it('the time to first spawn divides by the cop frequency, and the siren leads the pull-out', () => {
    const tuning = { 'cops.spawnDelayS': 3, 'cops.sirenLeadS': 1 };
    const seed = SEEDS.find((s) => spawnRun(s, tuning, 0.5, 400).siren >= 0) ?? 0;
    const normal = spawnRun(seed, tuning, 1, 400);
    const hard = spawnRun(seed, tuning, 1.5, 400);
    const easy = spawnRun(seed, tuning, 0.5, 400);
    expect([normal.siren, normal.pullOut]).toEqual([120, 180]);
    expect([hard.siren, hard.pullOut]).toEqual([60, 120]);
    expect([easy.siren, easy.pullOut]).toEqual([300, 360]);
  });

  it('keeps the full lead even when the spawn delay is shorter than it', () => {
    const run = spawnRun(1, { 'cops.spawnDelayS': 1, 'cops.sirenLeadS': 3 }, 1, 400);
    expect([run.siren, run.pullOut]).toEqual([0, 180]);
  });

  it('while the siren leads he stays parked and cannot bust: the dwell starts at the pull-out', () => {
    const w = copWorld({ 'cops.spawnDelayS': 5, 'cops.sirenLeadS': 3 });
    w.mode(PLAYER_ID, 'Tumble'); // down 10 m in front of him
    w.step(120);
    expect(w.events.filter((e) => e.type === 'siren')).toHaveLength(0);
    w.step(1);
    expect(w.events.filter((e) => e.type === 'siren' && e.data['on'] === true)).toHaveLength(1);
    w.step(300 - 121); // ticks 121..299
    expect(w.busts()).toHaveLength(0);
    expect(w.world.inputs[COP_ID]?.brake).toBe(255); // still parked at tick 299
    w.step(59); // ticks 300..358
    expect(w.busts()).toHaveLength(0);
    w.step(1);
    expect(w.busts()).toHaveLength(1); // pull-out at 300, plus the 60-tick dwell
    expect(w.busts()[0]?.tick).toBe(359);
  });

  it('a scripted race on each preset hashes the same every run, and the presets differ', () => {
    const run = (copFrequency: number) => {
      const sim = createSim({
        ...fixtureConfig({ 'cops.spawnDelayS': 2, 'cops.sirenLeadS': 1 }, { copFrequency }),
        seed: 7,
      });
      for (let t = 0; t < 600; t++) sim.step([quantizeInput({ throttle: 1, brake: 0, steer: 0, flags: 0 })]);
      return sim.hash();
    };
    for (const f of [0.5, 1, 1.5]) expect(run(f)).toBe(run(f));
    expect(new Set([run(0.5), run(1), run(1.5)]).size).toBe(3);
  });
});

describe('cops-2: a knocked-down cop cannot bust anyone until he is back up (full sim)', () => {
  it('knock him off, crash beside him: no bust while he is down, and he rides on after', () => {
    // A touchy barrier (crash from 3 m/s into it), so the player's swerve after the knock-off is a
    // sure crash near the tumbling cop. Everything runs through the real systems: combat knocks
    // him off, tumble takes him down and hands him back, and sim/cops decides the bust.
    const config = {
      ...fixtureConfig({ 'cops.spawnDelayS': 0, 'cops.followGapM': 40, 'riders.crashImpactMps': 3 }),
      weapons: [PUNCH, KICK],
    };
    const sim = createSim(config);
    const events: SimEvent[] = [];
    let copDownAt = -1;
    let copUpAt = -1;
    let overlap = 0; // ticks where both were down and within his 14 m bust radius
    const bustsWhileCopDown: number[] = [];
    for (let t = 0; t < 60 * 90 && copUpAt < 0; t++) {
      const snap = sim.snapshot();
      const me = snap.entities[PLAYER_ID];
      const cop = snap.entities[COP_ID];
      if (!me || !cop) throw new Error('missing entities');
      let flags = 0;
      let steer = Math.max(-1, Math.min(1, (1.7 - me.road.d) * 0.3 - me.road.yaw * 2));
      if (copDownAt < 0) {
        // Cruise in lane; punch when he is inside punch reach, kick when only kick reach fits.
        const up = cop.mode === 'Road';
        const ds = cop.progress - me.progress;
        const dd = cop.road.d - me.road.d;
        const punch = up && Math.abs(ds) <= 1.1 && Math.abs(dd) <= 1.35;
        const kick = up && !punch && Math.abs(ds) <= 0.9 && Math.abs(dd) <= 1.65;
        const side = dd < 0 ? InputFlag.attackSideLeft : InputFlag.attackSideRight;
        if (t % 30 === 0 && punch) flags = InputFlag.attack | side;
        else if (t % 30 === 0 && kick) flags = InputFlag.attack | InputFlag.kick | side;
      } else steer = 1; // he is down: swerve into the right barrier beside him
      sim.step([quantizeInput({ throttle: copDownAt < 0 ? 0.55 : 0.3, brake: 0, steer, flags })]);
      const stepped = sim.events();
      events.push(...stepped);
      const after = sim.snapshot();
      const c = after.entities[COP_ID];
      const p = after.entities[PLAYER_ID];
      const copDown = c?.mode !== 'Road';
      if (copDownAt < 0 && copDown) copDownAt = t;
      if (copDownAt >= 0 && !copDown) copUpAt = t;
      const playerDown = p?.mode === 'Tumble' || p?.mode === 'OnFoot';
      if (copDown && playerDown && c && p && Math.hypot(c.x - p.x, c.z - p.z) <= 14) overlap++;
      if (copDown && stepped.some((e) => e.type === 'bust')) bustsWhileCopDown.push(t);
    }
    const playerCrash = events.find((e) => e.type === 'crash' && e.actor === PLAYER_ID);
    console.log(
      `[examined] cops-2 downed cop: down t${copDownAt}, up t${copUpAt}, player crash t${playerCrash?.tick}, ` +
        `${overlap} ticks both down within 14 m, busts while he was down: ${bustsWhileCopDown.length}`,
    );
    expect(copDownAt).toBeGreaterThan(0);
    expect(playerCrash).toBeDefined();
    expect(overlap).toBeGreaterThan(60); // longer than a full bust dwell: the guard was exercised
    expect(bustsWhileCopDown).toEqual([]);
    expect(copUpAt).toBeGreaterThan(copDownAt); // got up and back on the bike
    expect(events.some((e) => e.type === 'siren' && e.data['on'] === false)).toBe(false); // chase on
  });
});
