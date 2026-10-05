// combat-1's automated acceptance (docs/milestones/M1.md, "combat-1"), items 1–7 and 10, plus the
// tuning scales. Items 8 and 9 run through createSim in hitstop.test.ts.
import { describe, expect, it } from 'vitest';
import { combatState, combatView } from './index';
import { F, flags, KICK, makeHarness, ofType, scriptOf, type Placement } from './harness.test-util';

const KICK_PRESS = F.attack | F.kick;
/** The tick a kick pressed on tick 0 lands (its wind-up: 7 ticks since playtest 4, M1's 13). */
const LANDS = KICK.windupTicks;
const once = (tick: number, f: number) => (t: number) => (t === tick ? flags(f) : undefined);

describe('combat-1: the kick needs reach', () => {
  it('1. a kick with the rival 3 m to the side is an attackMiss, with no knockback', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player' },
        { s: 100, d: 3 },
      ],
      scriptOf({ 0: once(0, KICK_PRESS) }),
    );
    h.run(60);
    const start = ofType(h.events, 'attackStart');
    expect(start.map((e) => e.data['weapon'])).toEqual(['base:kick']);
    expect(start[0]?.target).toBe(1); // inside the 4 m × 3 m acquisition box
    expect(ofType(h.events, 'hit')).toHaveLength(0);
    const miss = ofType(h.events, 'attackMiss');
    expect(miss).toHaveLength(1);
    expect(miss[0]?.causeId).toBe(start[0]?.causeId);
    expect(h.world.movers[1]?.pos.d).toBe(3);
    expect(combatState(h.world).knockPeak[1] ?? 0).toBe(0);
  });

  it('2. a kick with the rival 1.2 m alongside lands exactly one hit, while active, and shoves the rival', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player' },
        { s: 100, d: 1.2 },
      ],
      scriptOf({ 0: once(0, KICK_PRESS) }),
    );
    const dTrace: number[] = [];
    const phases: string[] = [];
    for (let t = 0; t < 60; t++) {
      h.run(1);
      dTrace.push(h.world.movers[1]?.pos.d ?? NaN);
      phases.push(combatView(h.world, 0).attackPhase);
    }
    const hits = ofType(h.events, 'hit');
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit?.target).toBe(1);
    // The wind-up fills the ticks before LANDS, and the active moment starts on LANDS.
    expect(phases.slice(0, LANDS).every((p) => p === 'windup')).toBe(true);
    expect(phases[LANDS]).toBe('active');
    expect(hit?.tick).toBe(LANDS);
    expect(ofType(h.events, 'kick')).toHaveLength(1);
    // Sideways speed: zero before the hit, clearly positive (away from the attacker) after the hit-stop.
    const lateral = (t: number) => ((dTrace[t] ?? 0) - (dTrace[t - 1] ?? 0)) * 60;
    expect(lateral(LANDS - 1)).toBe(0);
    expect(lateral(LANDS + 5)).toBeGreaterThan(3);
    expect(dTrace[40]).toBeGreaterThan(2.2);
  });

  it('3. a rival who brakes out of reach during the wind-up is missed (and is hit when it does not brake)', () => {
    // M1's 13-tick kick wind-up: long enough to brake 1 m out of reach in (the rule holds for any
    // wind-up; playtest 4's 7-tick kick leaves too little time to show it at a 9 m/s² brake).
    const m1Kick = [{ ...KICK, windupTicks: 13 }];
    const riders: Placement[] = [
      { s: 100, d: 0, speed: 26, role: 'player' },
      { s: 100, d: 1.2, speed: 22 },
    ];
    const cruise = makeHarness(riders, scriptOf({ 0: once(0, KICK_PRESS) }), {}, m1Kick);
    cruise.run(40);
    expect(ofType(cruise.events, 'hit')).toHaveLength(1);

    const brakes = makeHarness(
      riders.map((r) => ({ ...r })),
      scriptOf({
        0: once(0, KICK_PRESS),
        1: () => ({ steer: 0, throttle: 0, brake: 255, flags: 0 }),
      }),
      {},
      m1Kick,
    );
    brakes.run(40);
    expect(ofType(brakes.events, 'hit')).toHaveLength(0);
    expect(ofType(brakes.events, 'attackMiss')).toHaveLength(1);
  });
});

describe('combat-1: presses, repeats and the cooldown', () => {
  /** Kick pressed every third tick for a second, by rider 0 (`role`) next to a rival. */
  const mash = (role: 'player' | 'rival') => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role },
        { s: 100, d: 1.2 },
      ],
      scriptOf({ 0: (t) => (t < 60 && t % 3 === 0 ? flags(KICK_PRESS) : undefined) }),
    );
    let sawCooldown = false;
    for (let t = 0; t < 60; t++) {
      h.run(1);
      if (combatView(h.world, 0).attackPhase === 'cooldown') sawCooldown = true;
    }
    return { h, sawCooldown, starts: ofType(h.events, 'attackStart').map((e) => [e.tick, e.data['weapon']]) };
  };
  /** The tick the leg is back after a landed kick on tick 0: its whole swing plus the 4-tick hit-stop. */
  const back = KICK.windupTicks + KICK.activeTicks + KICK.recoveryTicks + 4;

  it('4. a rival mashing kick 20 times in one second lands one kick, and the next request is a punch', () => {
    const { h, sawCooldown, starts } = mash('rival');
    expect(ofType(h.events, 'kick')).toHaveLength(1);
    // A rival's press is never kept, so the first press after the kick's swing (rivals' hits on
    // each other have no hit-stop) falls in its cooldown and becomes a punch.
    const next = Math.ceil((back - 4) / 3) * 3;
    expect(starts).toEqual([
      [0, 'base:kick'],
      [next, 'base:punch'],
    ]);
    expect(sawCooldown).toBe(true);
  });

  it('playtest 4: a player mashing kick gets a kick each time the leg is back, never a punch and no cooldown', () => {
    const { h, sawCooldown, starts } = mash('player');
    // The press kept from the end of the first kick's recovery starts the second kick on the tick it ends.
    expect(starts).toEqual([
      [0, 'base:kick'],
      [back, 'base:kick'],
    ]);
    expect(ofType(h.events, 'hit').every((e) => e.data['weapon'] === 'base:kick')).toBe(true);
    expect(sawCooldown).toBe(false);
  });
});

describe('combat-1: sides and targets', () => {
  // A nearer rival ahead-left (out of kick reach) and a rival alongside-right (in reach).
  const field: Placement[] = [
    { s: 100, d: 0, role: 'player' },
    { s: 101.5, d: -0.5 },
    { s: 100, d: 1.65 },
  ];

  it('5a. auto-target takes the nearest rider, and its side', () => {
    const h = makeHarness(field, scriptOf({ 0: once(0, KICK_PRESS) }));
    h.run(40);
    const start = ofType(h.events, 'attackStart')[0];
    expect(start?.target).toBe(1);
    expect(start?.data['side']).toBe(-1);
    expect(ofType(h.events, 'hit')).toHaveLength(0);
  });

  it('5b. a drag during the wind-up flips the side (and the target)', () => {
    const h = makeHarness(
      field,
      scriptOf({
        0: (t) => (t === 0 ? flags(KICK_PRESS) : t >= 3 && t <= 8 ? flags(F.attackSideRight) : undefined),
      }),
    );
    h.run(40);
    const hits = ofType(h.events, 'hit');
    expect(hits.map((e) => [e.tick, e.target])).toEqual([[LANDS, 2]]);
  });

  it('5c. a drag once the active moment has started does not flip the side', () => {
    const h = makeHarness(
      field,
      scriptOf({
        0: (t) =>
          t === 0 ? flags(KICK_PRESS) : t >= LANDS && t <= 30 ? flags(F.attackSideRight) : undefined,
      }),
    );
    h.run(40);
    expect(ofType(h.events, 'hit')).toHaveLength(0);
    expect(ofType(h.events, 'attackMiss')).toHaveLength(1);
  });

  it('6. with a cop and a rival both in reach the rival is targeted; the side override picks the cop', () => {
    const riders: Placement[] = [
      { s: 100, d: 0, role: 'player' },
      { s: 100, d: 1.0, role: 'cop' },
      { s: 100, d: -1.3 },
    ];
    const auto = makeHarness(riders, scriptOf({ 0: once(0, KICK_PRESS) }));
    auto.run(40);
    expect(ofType(auto.events, 'attackStart')[0]?.target).toBe(2);
    expect(ofType(auto.events, 'hit').map((e) => e.target)).toEqual([2]);

    const atCop = makeHarness(
      riders.map((r) => ({ ...r })),
      scriptOf({ 0: once(0, KICK_PRESS | F.attackSideRight) }),
    );
    atCop.run(40);
    expect(ofType(atCop.events, 'attackStart')[0]?.target).toBe(1);
    expect(ofType(atCop.events, 'hit').map((e) => e.target)).toEqual([1]);
  });
});

describe('combat-1: damage and knock-off', () => {
  it('7. health reaching zero knocks the rider off, with a crash event caused by the hit', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player' },
        { s: 100, d: 1.2, healthMax: 15 },
      ],
      scriptOf({ 0: once(0, KICK_PRESS) }),
    );
    h.run(40);
    const start = ofType(h.events, 'attackStart')[0];
    const hit = ofType(h.events, 'hit')[0];
    const crash = ofType(h.events, 'crash');
    expect(hit?.data['health']).toBe(0);
    expect(crash).toHaveLength(1);
    expect(crash[0]?.actor).toBe(1);
    expect(crash[0]?.tick).toBe(hit?.tick);
    expect(crash[0]?.causeId).toBe(hit?.causeId);
    expect(hit?.causeId).toBe(start?.causeId);
    expect(combatView(h.world, 1).lastAttackerId).toBe(0);
  });

  it('a hit that leaves health above zero causes no crash', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player' },
        { s: 100, d: 1.2 },
      ],
      scriptOf({ 0: once(0, KICK_PRESS) }),
    );
    h.run(40);
    // The kick's 18 data damage × combat.unarmedDamageScale (2, playtest 2): 100 - 36.
    expect(ofType(h.events, 'hit')[0]?.data['health']).toBe(64);
    expect(ofType(h.events, 'crash')).toHaveLength(0);
  });

  it('a hit interrupts the target’s own wind-up (stagger)', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player' },
        { s: 100, d: 1.2 },
      ],
      scriptOf({ 0: once(0, KICK_PRESS), 1: once(LANDS - 3, F.attack) }),
    );
    h.run(60);
    const rivalStarts = ofType(h.events, 'attackStart').filter((e) => e.actor === 1);
    expect(rivalStarts).toHaveLength(1);
    // The rival's punch (a 7-tick wind-up from LANDS - 3) is cut off by the kick landing on LANDS.
    expect(
      h.events.filter((e) => e.actor === 1 && (e.type === 'hit' || e.type === 'attackMiss')),
    ).toHaveLength(0);
  });
});

describe('combat-1: scaled time and the hit-stop', () => {
  it('10. at timeScale 0.5 a punch wind-up takes 14 ticks, and the hit-stop still ends after 4 raw ticks', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player' },
        { s: 100, d: 1.0 },
      ],
      scriptOf({ 0: once(0, F.attack) }),
    );
    h.world.timeScale = 0.5;
    const phases: string[] = [];
    const scales: number[] = [];
    for (let t = 0; t < 30; t++) {
      h.run(1);
      phases.push(combatView(h.world, 0).attackPhase);
      scales.push(h.world.timeScale);
    }
    expect(phases.slice(0, 14).every((p) => p === 'windup')).toBe(true);
    expect(phases[14]).toBe('active');
    expect(ofType(h.events, 'hit').map((e) => e.tick)).toEqual([14]);
    // Frozen (0) after ticks 14–17, so ticks 15–18 step with no motion; 0.5 again from tick 18.
    expect(scales.slice(12, 20)).toEqual([0.5, 0.5, 0, 0, 0, 0, 0.5, 0.5]);
  });

  it('rival-against-rival hits get no hit-stop', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0 },
        { s: 100, d: 1.2 },
      ],
      scriptOf({ 0: once(0, KICK_PRESS) }),
    );
    for (let t = 0; t < 30; t++) {
      h.run(1);
      expect(h.world.timeScale).toBe(1);
    }
    expect(ofType(h.events, 'hit')).toHaveLength(1);
  });

  it('combat.hitStopScale scales the freeze (60 ms × 2 = 120 ms → 7 ticks; 0 → none)', () => {
    const frozenTicks = (scale: number) => {
      const h = makeHarness(
        [
          { s: 100, d: 0, role: 'player' },
          { s: 100, d: 1.2 },
        ],
        scriptOf({ 0: once(0, KICK_PRESS) }),
        { 'combat.hitStopScale': scale },
      );
      let frozen = 0;
      for (let t = 0; t < 40; t++) {
        h.run(1);
        if (h.world.timeScale === 0) frozen++;
      }
      return frozen;
    };
    expect(frozenTicks(1)).toBe(4);
    expect(frozenTicks(2)).toBe(7);
    expect(frozenTicks(0)).toBe(0);
  });

  it('combat.knockbackScale scales the shove (0 → none)', () => {
    // Placed left of centre so the kick's full shove (about a lane) stays clear of the barrier.
    const slideAfter = (scale: number) => {
      const h = makeHarness(
        [
          { s: 100, d: -3, role: 'player' },
          { s: 100, d: -1.8 },
        ],
        scriptOf({ 0: once(0, KICK_PRESS) }),
        { 'combat.knockbackScale': scale },
      );
      h.run(60);
      return (h.world.movers[1]?.pos.d ?? 0) + 1.8;
    };
    expect(slideAfter(0)).toBe(0);
    const one = slideAfter(1);
    expect(one).toBeGreaterThan(1);
    expect(slideAfter(0.5)).toBeCloseTo(one / 2, 1);
  });
});
