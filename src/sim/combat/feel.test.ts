// combat-3's automated acceptance (docs/milestones/M2.md, "combat-3 · Hit feel") and playtest 1's
// items 3 and 4 (the kick conversion and the kick shove). The determinism item runs through
// createSim in hitstop.test.ts.
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

  it('a punch staggers rather than shoves: under 0.6 m, and the target wobbles for the stagger', () => {
    const { h, moved } = lateralTrace(pair({ d: -2.8 }), scriptOf({ 0: once(0, F.attack) }), 60);
    expect(ofType(h.events, 'hit')).toHaveLength(1);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(0.6);
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

  it('a rival’s hit on the player shoves and wobbles by combat.onPlayerScale (0.4); the player’s own hits are full', () => {
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

describe('combat-3: hitImpulse on hit events', () => {
  it('each hit carries a 0..1 hitImpulse, and a kick’s beats a punch’s', () => {
    const kick = makeHarness(pair(), scriptOf({ 0: once(0, KICK_PRESS) }));
    kick.run(40);
    const punch = makeHarness(pair({ d: -2.8 }), scriptOf({ 0: once(0, F.attack) }));
    punch.run(40);
    const k = Number(ofType(kick.events, 'hit')[0]?.data['hitImpulse']);
    const p = Number(ofType(punch.events, 'hit')[0]?.data['hitImpulse']);
    expect(p).toBeGreaterThan(0);
    expect(k).toBeLessThanOrEqual(1);
    expect(k).toBeGreaterThan(p);
  });
});

describe('combat-3: health recovers out of combat', () => {
  const kickedRival = (tuning: Record<string, number> = {}, extra?: (t: number) => number) =>
    makeHarness(
      pair(),
      scriptOf({ 0: (t) => (t === 0 ? flags(KICK_PRESS) : extra ? flags(extra(t)) : undefined) }),
      tuning,
    );

  it('only after the out-of-combat delay (5 s of world time), then slowly, in whole points, up to full', () => {
    const h = kickedRival();
    const health = () => riderState(h.world).health[1] ?? NaN;
    h.run(14); // the kick lands on tick 13: 100 → 82
    expect(health()).toBe(82);
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

  it('the attacker is in combat too: its own swings hold off its recovery', () => {
    const h = makeHarness(
      [
        { s: 100, d: -3, role: 'player', healthMax: 100 },
        { s: 100, d: -1.8 },
      ],
      scriptOf({ 0: (t) => (t % 120 === 0 ? flags(F.attack) : undefined) }),
    );
    riderState(h.world).health[0] = 50;
    h.run(60 * 10);
    expect(riderState(h.world).health[0]).toBe(50);
  });

  it('non-default settings change it: a 1 s delay starts sooner, a zero rate never recovers', () => {
    const quick = kickedRival({ 'combat.regenDelayS': 1 });
    quick.run(18 + 60 + 30);
    expect(riderState(quick.world).health[1]).toBeGreaterThan(82);
    const never = kickedRival({ 'combat.regenPerS': 0 });
    never.run(60 * 30);
    expect(riderState(never.world).health[1]).toBe(82);
  });
});

describe('combat-3: the swipe-down kick (playtest 1 item 3, sim side)', () => {
  // Kick reach is 1.7 m sideways, punch reach 1.4 m: a target 1.6 m away only a kick can reach.
  const kickOnly = (): Placement[] => [
    { s: 100, d: -3, role: 'player' },
    { s: 100, d: -1.4 },
  ];
  /** A press on tick 0 and the kick flag held from `from` until tick 40. */
  const swipe = (from: number) =>
    scriptOf({ 0: (t) => flags((t === 0 ? F.attack : 0) | (t >= from && t <= 40 ? F.kick : 0)) });

  it('a 180 ms swipe (the kick flag from 12 ticks after the press) makes the punch a kick, landing on the kick’s own schedule', () => {
    // 180 ms is 10.8 → 11 ticks, plus one sampling tick: the flag arrives on tick 12.
    const h = makeHarness(kickOnly(), swipe(12));
    h.run(60);
    const starts = ofType(h.events, 'attackStart');
    expect(starts.map((e) => e.data['weapon'])).toEqual(['base:punch', 'base:kick']);
    expect(starts[1]?.causeId).toBe(starts[0]?.causeId);
    const hits = ofType(h.events, 'hit');
    expect(hits.map((e) => [e.tick, e.data['weapon']])).toEqual([[13, 'base:kick']]);
    expect(ofType(h.events, 'kick')).toHaveLength(1);
  });

  it('the same at 200 ms (the flag on tick 13), and an early swipe lands no sooner than a straight kick', () => {
    const late = makeHarness(kickOnly(), swipe(13));
    late.run(60);
    expect(ofType(late.events, 'hit').map((e) => [e.tick, e.data['weapon']])).toEqual([[14, 'base:kick']]);
    const early = makeHarness(kickOnly(), swipe(4));
    early.run(60);
    expect(ofType(early.events, 'hit').map((e) => [e.tick, e.data['weapon']])).toEqual([[13, 'base:kick']]);
  });

  it('with the target in punch reach, the jab lands and the kick still follows', () => {
    const h = makeHarness(pair(), swipe(10));
    h.run(80);
    expect(ofType(h.events, 'hit').map((e) => e.data['weapon'])).toEqual(['base:punch', 'base:kick']);
  });

  it('a kick request after the conversion window leaves the punch alone', () => {
    const h = makeHarness(kickOnly(), swipe(16));
    h.run(60);
    expect(ofType(h.events, 'attackStart').map((e) => e.data['weapon'])).toEqual(['base:punch']);
    expect(ofType(h.events, 'hit')).toHaveLength(0);
  });

  it('combat.kickConvertMs 0 keeps the M1 rule: only during the wind-up, restarting the kick’s wind-up', () => {
    const inWindup = makeHarness(kickOnly(), swipe(5), { 'combat.kickConvertMs': 0 });
    inWindup.run(60);
    expect(ofType(inWindup.events, 'hit').map((e) => [e.tick, e.data['weapon']])).toEqual([
      [18, 'base:kick'],
    ]);
    const after = makeHarness(kickOnly(), swipe(9), { 'combat.kickConvertMs': 0 });
    after.run(60);
    expect(ofType(after.events, 'attackStart').map((e) => e.data['weapon'])).toEqual(['base:punch']);
  });

  it('a kick still cooling down does not convert a punch', () => {
    // Kick on tick 0 (its cycle and hit-stop end on tick 50, cooldown to tick 80), a swipe on 55.
    const h = makeHarness(
      pair(),
      scriptOf({
        0: (t) =>
          t === 0
            ? flags(KICK_PRESS)
            : t === 55
              ? flags(F.attack)
              : t > 55 && t < 75
                ? flags(F.kick)
                : undefined,
      }),
    );
    h.run(100);
    expect(ofType(h.events, 'attackStart').map((e) => [e.tick, e.data['weapon']])).toEqual([
      [0, 'base:kick'],
      [55, 'base:punch'],
    ]);
  });
});
