// combat-3's automated acceptance (docs/milestones/M2.md, "combat-3 · Hit feel") and playtest 1's
// item 4 (the kick shove). The kick conversion (item 3) and hitImpulse are in convert.test.ts; the
// determinism item runs through createSim in hitstop.test.ts.
import { describe, expect, it } from 'vitest';
import { riderState } from '../riders';
import { F, flags, makeHarness, ofType, scriptOf, type Placement } from './harness.test-util';

const KICK_PRESS = F.attack | F.kick;
const once = (tick: number, f: number) => (t: number) => (t === tick ? flags(f) : undefined);

/** Per-tick lateral speed of a rider (m/s, from its d change), over n ticks. */
function lateralTrace(
  placements: Placement[],
  script: Parameters<typeof makeHarness>[1],
  n: number,
  tuning = {},
) {
  const h = makeHarness(placements, script, tuning);
  const speeds: number[] = [];
  const ds: number[] = [];
  let last = h.world.movers[1]?.pos.d ?? 0;
  for (let t = 0; t < n; t++) {
    h.run(1);
    const d = h.world.movers[1]?.pos.d ?? 0;
    speeds.push((d - last) * 60);
    ds.push(d);
    last = d;
  }
  return { h, speeds, ds, moved: ds[ds.length - 1]! - (placements[1]?.d ?? 0) };
}

/** Attacker and target well inside the fixture road (barriers at ±4.4 m), target to the right. */
const pair = (a: Partial<Placement> = {}, b: Partial<Placement> = {}): Placement[] => [
  { s: 100, d: -3, role: 'player', ...a },
  { s: 100, d: -1.8, ...b },
];

describe('combat-3: hit-stop', () => {
  it('lasts exactly the declared ticks inside 40–80 ms, and a rival-against-rival hit gets none', () => {
    const frozen = (scale: number, attacker: 'player' | 'rival') => {
      const h = makeHarness(pair({ role: attacker }), scriptOf({ 0: once(0, KICK_PRESS) }), {
        'combat.hitStopScale': scale,
      });
      let n = 0;
      for (let t = 0; t < 40; t++) {
        h.run(1);
        if (h.world.timeScale === 0) n++;
      }
      expect(ofType(h.events, 'hit')).toHaveLength(1);
      return n;
    };
    // The kick's 60 ms: ×(40/60) = 40 ms → round(2.4) = 2 ticks; ×1 → 4; ×(80/60) = 80 ms → 5.
    expect(frozen(40 / 60, 'player')).toBe(2);
    expect(frozen(1, 'player')).toBe(4);
    expect(frozen(80 / 60, 'player')).toBe(5);
    expect(frozen(1, 'rival')).toBe(0);
  });
});

describe('combat-3: knockback is a short curve (playtest 1 item 4: a kick shoves about a lane)', () => {
  it('a kick’s peak lateral speed beats a punch’s, at equal mass', () => {
    const kick = lateralTrace(pair(), scriptOf({ 0: once(0, KICK_PRESS) }), 60);
    const punch = lateralTrace(pair({ d: -2.8 }), scriptOf({ 0: once(0, F.attack) }), 60);
    expect(ofType(kick.h.events, 'hit')).toHaveLength(1);
    expect(ofType(punch.h.events, 'hit')).toHaveLength(1);
    const peak = (xs: number[]) => Math.max(...xs.map(Math.abs));
    expect(peak(kick.speeds)).toBeGreaterThan(peak(punch.speeds) * 4);
  });

  it('a landed kick shoves the target about a lane width (3–4.2 m), and then the shove is spent', () => {
    const { moved, speeds } = lateralTrace(pair(), scriptOf({ 0: once(0, KICK_PRESS) }), 90);
    expect(moved).toBeGreaterThan(3);
    expect(moved).toBeLessThan(4.2);
    expect(speeds.slice(60).every((v) => v === 0)).toBe(true);
  });

  it('the curve peaks right after the hit-stop, then decays to zero over combat.knockbackDecayS', () => {
    const { h, speeds } = lateralTrace(pair(), scriptOf({ 0: once(0, KICK_PRESS) }), 70);
    const hitTick = ofType(h.events, 'hit')[0]?.tick ?? -1;
    expect(hitTick).toBe(13);
    // Frozen for the 4 hit-stop ticks, then moving away from the attacker (+d here).
    expect(speeds.slice(hitTick + 1, hitTick + 5)).toEqual([0, 0, 0, 0]);
    const moving = speeds.slice(hitTick + 5).filter((v) => v > 0);
    expect(moving.length).toBe(24); // 0.4 s at 60 Hz
    expect(moving[0]).toBe(Math.max(...moving));
    for (let i = 1; i < moving.length; i++) expect(moving[i]!).toBeLessThan(moving[i - 1]!);

    // A longer decay setting moves the target further for longer, at the same peak.
    const long = lateralTrace(pair(), scriptOf({ 0: once(0, KICK_PRESS) }), 90, {
      'combat.knockbackDecayS': 0.6,
    });
    const longMoving = long.speeds.filter((v) => v > 0);
    expect(longMoving.length).toBe(36);
    expect(long.moved).toBeGreaterThan(lateralTrace(pair(), scriptOf({ 0: once(0, KICK_PRESS) }), 90).moved);
  });

  it('a punch staggers rather than shoves: M1’s 0.66 m nudge, far short of a lane, and the target wobbles', () => {
    const { h, moved } = lateralTrace(pair({ d: -2.8 }), scriptOf({ 0: once(0, F.attack) }), 60);
    expect(ofType(h.events, 'hit')).toHaveLength(1);
    expect(moved).toBeCloseTo(0.66, 6);
    // The stub riders phase never counts the wobble down, so it shows what the hit set: the
    // punch's 12-tick stagger, which makes the riders phase halve the target's steering.
    expect(riderState(h.world).wobble[1]).toBe(12);
    const doubled = lateralTrace(pair({ d: -2.8 }), scriptOf({ 0: once(0, F.attack) }), 60, {
      'combat.staggerScale': 2,
    });
    expect(riderState(doubled.h.world).wobble[1]).toBe(24);
  });

  it('the attacker’s mass, hit power and the target’s knockbackResistance scale the shove', () => {
    const kick = scriptOf({ 0: once(0, KICK_PRESS) });
    const base = lateralTrace(pair(), kick, 90).moved;
    const heavy = lateralTrace(pair({ massKg: 160 }), kick, 90).moved;
    const resistant = lateralTrace(pair({}, { knockbackResistance: 0.5 }), kick, 90).moved;
    const weak = lateralTrace(pair({ hitPowerScale: 0.5 }), kick, 90).moved;
    // Total mass ratio (160 + 180) / (80 + 180).
    expect(heavy / base).toBeCloseTo(340 / 260, 6);
    expect(resistant / base).toBeCloseTo(0.5, 6);
    expect(weak / base).toBeCloseTo(0.5, 6);
  });

  it('combat.kickShoveScale scales kicks only; combat.knockbackScale scales every hit', () => {
    const kick = scriptOf({ 0: once(0, KICK_PRESS) });
    const punch = scriptOf({ 0: once(0, F.attack) });
    const kickBase = lateralTrace(pair(), kick, 90).moved;
    const punchBase = lateralTrace(pair({ d: -2.8 }), punch, 90).moved;
    expect(lateralTrace(pair(), kick, 90, { 'combat.kickShoveScale': 0.5 }).moved / kickBase).toBeCloseTo(
      0.5,
      6,
    );
    expect(lateralTrace(pair({ d: -2.8 }), punch, 90, { 'combat.kickShoveScale': 0.5 }).moved).toBeCloseTo(
      punchBase,
      9,
    );
    expect(
      lateralTrace(pair({ d: -2.8 }), punch, 90, { 'combat.knockbackScale': 2 }).moved / punchBase,
    ).toBeCloseTo(2, 6);
  });

  it('a rival’s kick on the player shoves by combat.onPlayerScale (0.4), any rival hit wobbles by it, and a punch keeps M1’s nudge', () => {
    const kick = scriptOf({ 0: once(0, KICK_PRESS) });
    const onRival = lateralTrace(pair(), kick, 90);
    const onPlayer = lateralTrace(pair({ role: 'rival' }, { role: 'player' }), kick, 90);
    expect(onPlayer.moved / onRival.moved).toBeCloseTo(0.4, 6);
    expect(riderState(onRival.h.world).wobble[1]).toBe(21);
    expect(riderState(onPlayer.h.world).wobble[1]).toBe(Math.round(21 * 0.4));
    // The hit's strength for the camera and haptics is the same either way.
    const impulse = (h: typeof onRival.h) => ofType(h.events, 'hit')[0]?.data['hitImpulse'];
    expect(impulse(onPlayer.h)).toBe(impulse(onRival.h));
    // A non-default value: 1 treats the player like anyone else.
    const full = lateralTrace(pair({ role: 'rival' }, { role: 'player' }), kick, 90, {
      'combat.onPlayerScale': 1,
    });
    expect(full.moved).toBeCloseTo(onRival.moved, 9);
    // A rival's punch still nudges the player M1's 0.66 m; only its wobble is scaled.
    const punch = lateralTrace(
      pair({ role: 'rival', d: -2.8 }, { role: 'player' }),
      scriptOf({ 0: once(0, F.attack) }),
      60,
    );
    expect(punch.moved).toBeCloseTo(0.66, 6);
    expect(riderState(punch.h.world).wobble[1]).toBe(Math.round(12 * 0.4));
  });

  it('a shove stops at the barrier line and does not push the target through it', () => {
    const { ds, speeds } = lateralTrace(
      pair({ d: 2.5 }, { d: 3.7 }),
      scriptOf({ 0: once(0, KICK_PRESS) }),
      60,
    );
    expect(Math.max(...ds)).toBeCloseTo(4.4, 9);
    expect(speeds.slice(40).every((v) => v === 0)).toBe(true);
  });
});

describe('combat-3: a player’s health recovers out of combat', () => {
  /** A rival (id 0) kicks the player (id 1) once, on tick 0. */
  const kickedPlayer = (tuning: Record<string, number> = {}) =>
    makeHarness(pair({ role: 'rival' }, { role: 'player' }), scriptOf({ 0: once(0, KICK_PRESS) }), tuning);
  /** The kick lands on tick 13; then the rival is put 100 m up the road, out of the way. */
  const hitThenClear = (tuning: Record<string, number> = {}) => {
    const h = kickedPlayer(tuning);
    h.run(14);
    const rival = h.world.movers[0];
    if (rival) rival.pos.s += 100;
    return h;
  };

  it('only after the out-of-combat delay (5 s of world time), then slowly, in whole points, up to full', () => {
    const h = hitThenClear();
    const health = () => riderState(h.world).health[1] ?? NaN;
    expect(health()).toBe(82); // the kick landed on tick 13: 100 → 82
    // Frozen for 4 hit-stop ticks, then 300 world ticks of calm before recovery starts.
    h.run(4 + 299);
    expect(health()).toBe(82);
    h.run(60);
    expect(health()).toBeGreaterThan(82);
    expect(health()).toBeLessThanOrEqual(86);
    expect(Number.isInteger(health())).toBe(true);
    h.run(60 * 20);
    expect(health()).toBe(100);
  });

  it('only clear of other riders: with the rival still alongside, none comes back (combat.regenClearM)', () => {
    const near = kickedPlayer();
    near.run(60 * 20);
    expect(riderState(near.world).health[1]).toBe(82);
    const anywhere = kickedPlayer({ 'combat.regenClearM': 0 });
    anywhere.run(60 * 20);
    expect(riderState(anywhere.world).health[1]).toBe(100);
  });

  it('rivals do not recover: they keep M1’s durability', () => {
    const h = makeHarness(pair(), scriptOf({ 0: once(0, KICK_PRESS) }));
    h.run(60 * 20);
    expect(riderState(h.world).health[1]).toBe(64); // one kick: 18 × 2 (playtest 2's knockdown scale)
  });

  it('the attacker is in combat too: its own swings hold off its recovery', () => {
    const h = makeHarness(
      [
        { s: 100, d: -3, role: 'player', healthMax: 100 },
        { s: 100, d: -1.8 },
      ],
      scriptOf({ 0: (t) => (t % 120 === 0 ? flags(F.attack) : undefined) }),
      { 'combat.regenClearM': 0 },
    );
    riderState(h.world).health[0] = 50;
    h.run(60 * 10);
    expect(riderState(h.world).health[0]).toBe(50);
  });

  it('non-default settings change it: a 1 s delay starts sooner, a zero rate never recovers', () => {
    const quick = hitThenClear({ 'combat.regenDelayS': 1 });
    quick.run(4 + 60 + 30);
    expect(riderState(quick.world).health[1]).toBeGreaterThan(82);
    const never = hitThenClear({ 'combat.regenPerS': 0 });
    never.run(60 * 30);
    expect(riderState(never.world).health[1]).toBe(82);
  });
});

describe('combat-3: a press while staggered', () => {
  it('a press while staggered is kept, and the attack (a kick, if the swipe is held) starts as the stagger ends', () => {
    // The rival's kick lands on tick 13 and staggers the player 21 world ticks (after the 4-tick
    // hit-stop, ticks 18–38). The player presses on tick 20 and holds the kick flag.
    const h = makeHarness(
      pair({ role: 'rival' }, { role: 'player' }),
      scriptOf({
        0: once(0, KICK_PRESS),
        1: (t) => (t === 20 ? flags(F.attack | F.kick) : t > 20 && t < 60 ? flags(F.kick) : undefined),
      }),
    );
    h.run(80);
    const mine = ofType(h.events, 'attackStart').filter((e) => e.actor === 1);
    expect(mine.map((e) => [e.tick, e.data['weapon']])).toEqual([[38, 'base:kick']]);
  });
});
