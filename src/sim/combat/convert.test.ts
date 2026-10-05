// combat-3's kick conversion (playtest 1 item 3, sim side) and `hitImpulse` on hit events
// (docs/milestones/M2.md, "combat-3 · Hit feel").
import { describe, expect, it } from 'vitest';
import { F, flags, KICK, makeHarness, ofType, scriptOf, type Placement } from './harness.test-util';

const KICK_PRESS = F.attack | F.kick;
const once = (tick: number, f: number) => (t: number) => (t === tick ? flags(f) : undefined);

describe('combat-3: the swipe-down kick (playtest 1 item 3, sim side)', () => {
  // Kick reach is 1.7 m sideways, punch reach 1.4 m: a target 1.6 m away only a kick can reach.
  const kickOnly = (): Placement[] => [
    { s: 100, d: -3, role: 'player' },
    { s: 100, d: -1.4 },
  ];
  /** A target 1.2 m away, inside punch reach. */
  const alongside = (): Placement[] => [
    { s: 100, d: -3, role: 'player' },
    { s: 100, d: -1.8 },
  ];
  /** A press on tick 0 and the kick flag held from `from` until tick 40. */
  const swipe = (from: number) =>
    scriptOf({ 0: (t) => flags((t === 0 ? F.attack : 0) | (t >= from && t <= 40 ? F.kick : 0)) });

  /** Where a converted kick lands: on its own schedule from the press, or the tick after the swipe when that is later. */
  const landsAt = (flagTick: number) => Math.max(KICK.windupTicks, flagTick + 1);

  it('a 180 ms swipe (the kick flag from 12 ticks after the press) makes the punch a kick, landing as soon as the swipe allows', () => {
    // 180 ms is 10.8 → 11 ticks, plus one sampling tick: the flag arrives on tick 12.
    const h = makeHarness(kickOnly(), swipe(12));
    h.run(60);
    const starts = ofType(h.events, 'attackStart');
    expect(starts.map((e) => e.data['weapon'])).toEqual(['base:punch', 'base:kick']);
    expect(starts[1]?.causeId).toBe(starts[0]?.causeId);
    expect(ofType(h.events, 'hit').map((e) => [e.tick, e.data['weapon']])).toEqual([
      [landsAt(12), 'base:kick'],
    ]);
    expect(ofType(h.events, 'kick')).toHaveLength(1);
  });

  it('the same at 200 ms (the flag on tick 13), and an early swipe lands no sooner than a straight kick', () => {
    const late = makeHarness(kickOnly(), swipe(13));
    late.run(60);
    expect(ofType(late.events, 'hit').map((e) => [e.tick, e.data['weapon']])).toEqual([
      [landsAt(13), 'base:kick'],
    ]);
    const early = makeHarness(kickOnly(), swipe(4));
    early.run(60);
    expect(ofType(early.events, 'hit').map((e) => [e.tick, e.data['weapon']])).toEqual([
      [landsAt(4), 'base:kick'],
    ]);
  });

  it('with the target in punch reach, the jab lands and the kick still follows', () => {
    const h = makeHarness(alongside(), swipe(10));
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
      [5 + KICK.windupTicks, 'base:kick'],
    ]);
    const after = makeHarness(kickOnly(), swipe(9), { 'combat.kickConvertMs': 0 });
    after.run(60);
    expect(ofType(after.events, 'attackStart').map((e) => e.data['weapon'])).toEqual(['base:punch']);
  });

  it('a rival’s kick still cooling down does not convert a punch (a player’s kick never cools down)', () => {
    // Kick on tick 0 (its swing ends on tick `swing`, rival on rival: no hit-stop; the cooldown runs
    // on after it), a swipe 4 ticks into the cooldown.
    const swing = KICK.windupTicks + KICK.activeTicks + KICK.recoveryTicks;
    const at = swing + 4;
    const swipeAfterKick = (t: number) =>
      t === 0
        ? flags(KICK_PRESS)
        : t === at
          ? flags(F.attack)
          : t > at && t < at + 20
            ? flags(F.kick)
            : undefined;
    const rival = makeHarness(
      alongside().map((p) => ({ ...p, role: 'rival' as const })),
      scriptOf({ 0: swipeAfterKick }),
    );
    rival.run(swing + 40);
    expect(ofType(rival.events, 'attackStart').map((e) => [e.tick, e.data['weapon']])).toEqual([
      [0, 'base:kick'],
      [at, 'base:punch'],
    ]);
    const player = makeHarness(alongside(), scriptOf({ 0: swipeAfterKick }));
    player.run(swing + 40);
    expect(ofType(player.events, 'attackStart').map((e) => e.data['weapon'])).toEqual([
      'base:kick',
      'base:punch',
      'base:kick',
    ]);
  });
});

describe('combat-3: hitImpulse on hit events', () => {
  it('each hit carries a 0..1 hitImpulse, and a kick’s beats a punch’s', () => {
    const kick = makeHarness(
      [
        { s: 100, d: -3, role: 'player' },
        { s: 100, d: -1.8 },
      ],
      scriptOf({ 0: once(0, KICK_PRESS) }),
    );
    kick.run(40);
    const punch = makeHarness(
      [
        { s: 100, d: -3, role: 'player' },
        { s: 100, d: -2 },
      ],
      scriptOf({ 0: once(0, F.attack) }),
    );
    punch.run(40);
    const k = Number(ofType(kick.events, 'hit')[0]?.data['hitImpulse']);
    const p = Number(ofType(punch.events, 'hit')[0]?.data['hitImpulse']);
    expect(p).toBeGreaterThan(0);
    expect(k).toBeLessThanOrEqual(1);
    expect(k).toBeGreaterThan(p);
  });
});
