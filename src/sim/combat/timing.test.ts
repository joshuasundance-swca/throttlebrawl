// Playtest 4's combat timing (P4-6, the maintainer, 2026-10-04: "reduce delay between tap and attack
// and make it so that bumping into a rival while attacking doesn't negate the attack"; the kick's
// wait, [decided] "No wait"). The feel audit's probes (scratch pt4-audit-combat-report, sections 2
// and 4) as rules, by sim ticks:
// - a press in the last PRESS_BUFFER_TICKS of a player's recovery is kept and starts on the first
//   legal tick, and a buffered kick stays a kick;
// - a player's kick waits for nothing but the leg's return;
// - an auto-sided attack re-aims every tick of its wind-up until it has a target, so a press made
//   before the rider is in the acquisition box never defaults to the right;
// - a bump into the rider you are attacking never cancels the attack (through the real riders phase,
//   which owns the contact).
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import { createSimWithWorld } from '../create';
import {
  quantizeInput,
  SIM_TUNING,
  tuningDefaults,
  type SimConfig,
  type SimEvent,
  type SimInput,
} from '../api';
import kickPack from '../../../packs/base/weapons/kick.json';
import punchPack from '../../../packs/base/weapons/punch.json';
import { secondsToTicks } from '../../core';
import { BUMP_AFTER_TICKS, PRESS_BUFFER_TICKS } from './index';
import { F, flags, KICK, makeHarness, ofType, PUNCH, scriptOf, type Placement } from './harness.test-util';

const KICK_PRESS = F.attack | F.kick;

/** A player alone on the road (nobody in reach: no hit-stop), pressing on the given ticks. */
function alone(press: (t: number) => number | undefined) {
  return makeHarness(
    [{ s: 100, d: 0, role: 'player' }],
    scriptOf({
      0: (t) => {
        const f = press(t);
        return f === undefined ? undefined : flags(f);
      },
    }),
  );
}

/** The tick an attack pressed on tick 0 ends (idle again), with nobody in reach. */
const cycle = (w: typeof PUNCH) => w.windupTicks + w.activeTicks + w.recoveryTicks;

describe('P4-6: a press near the end of the recovery is buffered, never dropped', () => {
  for (const [name, first, second] of [
    ['punch, then a punch', PUNCH, F.attack],
    ['punch, then a kick', PUNCH, KICK_PRESS],
    ['kick, then a kick', KICK, KICK_PRESS],
    ['kick, then a punch', KICK, F.attack],
  ] as const) {
    it(`${name}: every press in the last ${PRESS_BUFFER_TICKS} ticks starts as the recovery ends`, () => {
      const firstPress = first === KICK ? KICK_PRESS : F.attack;
      const end = cycle(first);
      const wantSecond = second === KICK_PRESS ? 'base:kick' : 'base:punch';
      for (let at = end - PRESS_BUFFER_TICKS; at < end; at++) {
        const h = alone((t) => (t === 0 ? firstPress : t === at ? second : undefined));
        h.run(end + 20);
        const starts = ofType(h.events, 'attackStart').map((e) => [e.tick, e.data['weapon']]);
        expect(starts, `press on tick ${at}`).toEqual([
          [0, first.contentId],
          [end, wantSecond],
        ]);
      }
    });
  }

  it('a kick swipe recognised after the buffered press still kicks (the kick flag is kept)', () => {
    const end = cycle(PUNCH);
    const at = end - 4;
    // The press, then the kick flag two ticks later, released before the recovery ends.
    const h = alone((t) => (t === 0 ? F.attack : t === at ? F.attack : t === at + 2 ? F.kick : undefined));
    h.run(end + 20);
    expect(ofType(h.events, 'attackStart').map((e) => [e.tick, e.data['weapon']])).toEqual([
      [0, 'base:punch'],
      [end, 'base:kick'],
    ]);
  });

  it('a press before the buffer opens is dropped, as before', () => {
    const end = cycle(PUNCH);
    const h = alone((t) => (t === 0 ? F.attack : t === end - PRESS_BUFFER_TICKS - 1 ? F.attack : undefined));
    h.run(end + 20);
    expect(ofType(h.events, 'attackStart')).toHaveLength(1);
  });

  it('a rival’s press is never buffered (the AI presses again when it wants to)', () => {
    const end = cycle(PUNCH);
    const h = makeHarness(
      [{ s: 100, d: 0 }],
      scriptOf({ 0: (t) => (t === 0 || t === end - 2 ? flags(F.attack) : undefined) }),
    );
    h.run(end + 20);
    expect(ofType(h.events, 'attackStart')).toHaveLength(1);
  });
});

describe('P4-6: the kick waits for nothing but the leg ([decided] "No wait")', () => {
  it('a player’s kick pressed the tick the leg is back is a kick, after a landed kick too', () => {
    const pair: Placement[] = [
      { s: 100, d: 0, role: 'player' },
      { s: 100, d: 1.2 },
    ];
    // A landed kick freezes the world for the hit-stop (4 ticks), so the leg is back 4 ticks later.
    const back = cycle(KICK) + 4;
    const h = makeHarness(
      pair,
      scriptOf({ 0: (t) => (t === 0 || t === back ? flags(KICK_PRESS) : undefined) }),
    );
    h.run(back + 30);
    expect(ofType(h.events, 'attackStart').map((e) => [e.tick, e.data['weapon']])).toEqual([
      [0, 'base:kick'],
      [back, 'base:kick'],
    ]);
    // About 0.8 s between kicks, the maintainer's "as soon as the leg is back".
    expect(back / 60).toBeGreaterThan(0.7);
    expect(back / 60).toBeLessThan(0.9);
  });

  it('a rival keeps the kick’s data wait, so rivals kick as often as before', () => {
    const end = cycle(KICK);
    const h = makeHarness(
      [{ s: 100, d: 0 }],
      scriptOf({ 0: (t) => (t === 0 || t === end ? flags(KICK_PRESS) : undefined) }),
    );
    h.run(end + 20);
    expect(ofType(h.events, 'attackStart').map((e) => e.data['weapon'])).toEqual(['base:kick', 'base:punch']);
  });
});

describe('P4-6: the tap-to-hit delay', () => {
  it('the harness mirrors the shipped punch and kick timings', () => {
    for (const [w, pack] of [
      [PUNCH, punchPack],
      [KICK, kickPack],
    ] as const) {
      expect(w.windupTicks, w.contentId).toBe(secondsToTicks(pack.windupS));
      expect(w.activeTicks, w.contentId).toBe(secondsToTicks(pack.activeS));
      expect(w.recoveryTicks, w.contentId).toBe(secondsToTicks(pack.recoveryS));
      expect(w.cooldownTicks, w.contentId).toBe(pack.cooldownS ? secondsToTicks(pack.cooldownS) : 0);
    }
  });

  it('a kick comes out as fast as a punch, and the time it lost before the hit went after it', () => {
    expect(KICK.windupTicks).toBeLessThanOrEqual(PUNCH.windupTicks);
    // The rivals' kick rhythm (their AI paces by the whole cycle) is the M1 kick's: 13 + 6 + 27 + 30.
    expect(KICK.windupTicks + KICK.activeTicks + KICK.recoveryTicks + KICK.cooldownTicks).toBe(
      13 + 6 + 27 + 30,
    );
  });
});

describe('P4-6: an auto-sided attack re-aims until it has a target (audit F2)', () => {
  /**
   * The audit's window probe: the player at 30 m/s catches a rival 12 m ahead riding 30 - closing
   * m/s, 1.2 m to one side. The window is the number of press ticks whose kick lands.
   */
  function kickWindow(closing: number, side: -1 | 1, press: number, windupTicks: number): number {
    let landed = 0;
    for (let at = 0; at < 60; at++) {
      const h = makeHarness(
        [
          { s: 100, d: 0, speed: 30, role: 'player' },
          { s: 112, d: 1.2 * side, speed: 30 - closing },
        ],
        scriptOf({ 0: (t) => (t === at ? flags(press) : undefined) }),
        {},
        [{ ...KICK, windupTicks }],
      );
      h.run(at + 60);
      if (ofType(h.events, 'hit').some((e) => e.actor === 0)) landed++;
    }
    return landed;
  }

  for (const windup of [KICK.windupTicks, 13]) {
    it(`a ${windup}-tick kick: auto-aimed at a rival on the left lands as often as one forced left (16 m/s)`, () => {
      const forced = kickWindow(16, -1, KICK_PRESS | F.attackSideLeft, windup);
      const auto = kickWindow(16, -1, KICK_PRESS, windup);
      const right = kickWindow(16, 1, KICK_PRESS, windup);
      expect(forced).toBeGreaterThanOrEqual(12);
      expect(auto).toBe(forced);
      expect(auto).toBe(right);
    });
  }

  it('an attack with no target by its active moment swings at either side, never only the right', () => {
    // Nobody in the 4 m box at the press; a rival appears on the left inside punch reach by the active moment.
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player' },
        { s: 150, d: -1 },
      ],
      scriptOf({ 0: (t) => (t === 0 ? flags(F.attack) : undefined) }),
    );
    h.run(PUNCH.windupTicks - 1);
    const rival = h.world.movers[1];
    if (rival) rival.pos.s = 100.5;
    h.run(30);
    expect(ofType(h.events, 'hit').map((e) => e.target)).toEqual([1]);
  });
});

// ---- Bumps, through the real riders phase (sim/riders/contact owns the contact) ------------------

const BIKE = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

/** Two riders on a straight road, both driven by inputs: entity 0 the rival (slot 1), entity 1 the player (slot 0). */
function duel(): SimConfig {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1500, kappa: 0 }]));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 1480 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  const rider = (i: number, slot: number) => ({
    contentId: `base:r${i}`,
    name: `R${i}`,
    role: slot === 0 ? ('player' as const) : ('rival' as const),
    faction: 'rider' as const,
    controller: { kind: 'player' as const, slot },
    bike: BIKE,
    massKg: 80,
    healthMax: 100,
  });
  return {
    seed: 99,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [],
      raceEndTimeoutTicks: 1800,
    },
    riders: [rider(0, 1), rider(1, 0)],
    weapons: [PUNCH, KICK],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 2,
  };
}

const ride = (f = 0, steer = 0): SimInput => quantizeInput({ throttle: 1, brake: 0, steer, flags: f });

interface Attack {
  start: number;
  /** Whether the player's bike touched the rival between the press and the attack's end. */
  touched: boolean;
  landed: boolean;
}

/**
 * The player rides up behind the rival (`ahead` m ahead, `dd` to the left, `closing` m/s faster) and
 * presses on `at`; returns the attack, its outcome and whether the two bikes touched during it.
 */
function rideUp(press: number, at: number, closing: number, dd: number, steer = 0, ahead = 4): Attack | null {
  const { sim, world } = createSimWithWorld(duel());
  const [rival, player] = world.movers;
  if (!rival || !player) return null;
  const SET = 50;
  let start = -1;
  let end = -1;
  let touched = false;
  let landed = false;
  for (let t = 0; t < SET + 120; t++) {
    if (t === SET) {
      Object.assign(player.pos, { s: 300, d: 0 });
      Object.assign(rival.pos, { s: 300 + ahead, d: -dd });
      player.yaw = 0;
      rival.yaw = 0;
      player.speed = 25 + closing;
      rival.speed = 25;
    }
    sim.step([ride(t === at ? press : 0, t >= SET ? steer : 0), ride()]);
    const events: readonly SimEvent[] = sim.events();
    for (const e of events) {
      if (e.actor !== 1) continue;
      if (e.type === 'attackStart' && start < 0) start = t;
      if (start >= 0 && end < 0 && e.type === 'wobble' && e.data['cause'] === 'rider' && e.target === 0)
        touched = true;
      if (start >= 0 && end < 0 && (e.type === 'hit' || e.type === 'attackMiss')) {
        landed = e.type === 'hit';
        end = t;
      }
    }
  }
  return start < 0 || end < 0 ? null : { start, touched, landed };
}

describe('P4-6: bumping into the rider you attack never cancels the attack', () => {
  it('riding up into his back wheel: every attack that touched him lands', () => {
    let bumped = 0;
    for (const press of [F.attack, KICK_PRESS]) {
      for (const closing of [4, 6]) {
        for (const dd of [0.3, 0.6]) {
          for (let at = 50; at <= 100; at += 2) {
            const a = rideUp(press, at, closing, dd);
            if (!a?.touched) continue;
            bumped++;
            expect(a.landed, `press ${press} closing ${closing} dd ${dd} on tick ${at}`).toBe(true);
          }
        }
      }
    }
    console.log(`[bump] rear: ${bumped} attacks touched the rival, all landed`);
    // The check can find the case it guards: bumps happened during attacks.
    expect(bumped).toBeGreaterThan(10);
  });

  it('steering into him from alongside: every attack that touched him lands', () => {
    let bumped = 0;
    for (const press of [F.attack, KICK_PRESS]) {
      for (const at of [52, 56, 60, 64]) {
        const a = rideUp(press, at, 0, 1.3, -1, 0.3);
        if (!a?.touched) continue;
        bumped++;
        expect(a.landed, `press ${press} on tick ${at}`).toBe(true);
      }
    }
    console.log(`[bump] alongside: ${bumped} attacks touched the rival, all landed`);
    expect(bumped).toBeGreaterThan(0);
  });
});

/** The tick the player's bike first bumps the rival when riding up as rideUp does with no press, or -1. */
function bumpTick(closing: number, dd: number): number {
  const { sim, world } = createSimWithWorld(duel());
  const [rival, player] = world.movers;
  if (!rival || !player) return -1;
  for (let t = 0; t < 170; t++) {
    if (t === 50) {
      Object.assign(player.pos, { s: 300, d: 0 });
      Object.assign(rival.pos, { s: 304, d: -dd });
      player.yaw = 0;
      rival.yaw = 0;
      player.speed = 25 + closing;
      rival.speed = 25;
    }
    sim.step([ride(), ride()]);
    for (const e of sim.events())
      if (e.type === 'wobble' && e.actor === 1 && e.target === 0 && e.data['cause'] === 'rider') return t;
  }
  return -1;
}

describe('P4-6: an attack pressed just after a rear bump lands (run B, B15)', () => {
  it('a punch, a kick or a straight kick pressed up to BUMP_AFTER_TICKS after the bump lands', () => {
    const STRAIGHT = KICK_PRESS | F.attackSideLeft | F.attackSideRight;
    let pressed = 0;
    for (const press of [F.attack, KICK_PRESS, STRAIGHT]) {
      for (const closing of [4, 6]) {
        for (const dd of [0, 0.3]) {
          const bump = bumpTick(closing, dd);
          // The check can find the case it guards: the ride-up bumps him.
          expect(bump, `closing ${closing} dd ${dd}`).toBeGreaterThan(0);
          for (const after of [2, 10, 20, BUMP_AFTER_TICKS]) {
            const a = rideUp(press, bump + after, closing, dd);
            pressed++;
            expect(a?.landed, `press ${press} closing ${closing} dd ${dd}, ${after} ticks after`).toBe(true);
          }
        }
      }
    }
    expect(pressed).toBe(48);
  });
});
