// Playtest 4, run A's live check (punch items 3 to 5), against the maintainer's standing ask (round 2:
// "reduce delay between tap and attack"; "too mechanically constrained and timed"; [decided] "No wait"
// between kicks; [decided] auto-aim plus swipe). By sim ticks:
// - item 3: a player's press anywhere in an attack's recovery is kept (the latest press wins) and
//   starts the tick the recovery ends, so a mashing thumb loses no press. A press in the wind-up or
//   the active moment is the same swing and is still not kept; rivals' presses are never kept;
// - item 4: a rival's hit locks the player's attacks only while the player is visibly staggered (the
//   wobble, scaled by combat.onPlayerScale), never the 21 data ticks behind it, and never less: a
//   press made during the wobble starts the tick it ends. Rivals keep their whole stagger;
// - item 5: a clear side swipe never hits a rider on the other side, even one the attack touched
//   before the swipe picked its side (the cancelled punch's bump no longer carries into the kick).
import { describe, expect, it } from 'vitest';
import { riderState } from '../riders';
import { combatState } from './index';
import { F, flags, KICK, makeHarness, ofType, PUNCH, scriptOf, type Placement } from './harness.test-util';

const KICK_PRESS = F.attack | F.kick;
/** The tick an attack pressed on tick 0 ends (idle again), with nobody in reach. */
const cycle = (w: typeof PUNCH) => w.windupTicks + w.activeTicks + w.recoveryTicks;
/** The kick-conversion window (combat.kickConvertMs 250 ms) in ticks: a kick press this young converts. */
const CONVERT = 15;

/** A player alone on the road (nobody in reach: no hit-stop), pressing on the given ticks. */
function alone(press: (t: number) => number | undefined, role: Placement['role'] = 'player') {
  return makeHarness(
    [{ s: 100, d: 0, role }],
    scriptOf({
      0: (t) => {
        const f = press(t);
        return f === undefined ? undefined : flags(f);
      },
    }),
  );
}

const starts = (h: ReturnType<typeof alone>) =>
  ofType(h.events, 'attackStart').map((e) => [e.tick, e.data['weapon']]);

describe('run A item 3: a press anywhere in the recovery is kept, never dropped', () => {
  for (const [name, first, second] of [
    ['punch, then a punch', PUNCH, F.attack],
    ['punch, then a kick', PUNCH, KICK_PRESS],
    ['kick, then a kick', KICK, KICK_PRESS],
    ['kick, then a punch', KICK, F.attack],
  ] as const) {
    it(`${name}: every press from the recovery's first tick starts as it ends`, () => {
      const firstPress = first === KICK ? KICK_PRESS : F.attack;
      const end = cycle(first);
      const wantSecond = second === KICK_PRESS ? 'base:kick' : 'base:punch';
      // A kick press inside the punch's conversion window converts the punch itself (combat-3).
      const from = Math.max(
        first.windupTicks + first.activeTicks,
        first === PUNCH && second === KICK_PRESS ? CONVERT + 1 : 0,
      );
      let kept = 0;
      for (let at = from; at < end; at++) {
        const h = alone((t) => (t === 0 ? firstPress : t === at ? second : undefined));
        h.run(end + 20);
        expect(starts(h), `press on tick ${at}`).toEqual([
          [0, first.contentId],
          [end, wantSecond],
        ]);
        kept++;
      }
      expect(kept).toBe(end - from);
    });
  }

  it('the live case: a third kick swiped 12 ticks before the second kick ends starts as the leg is back', () => {
    const leg = cycle(KICK);
    const h = alone((t) => (t === 0 || t === leg || t === 2 * leg - 12 ? KICK_PRESS : undefined));
    h.run(3 * leg + 10);
    expect(starts(h)).toEqual([
      [0, 'base:kick'],
      [leg, 'base:kick'],
      [2 * leg, 'base:kick'],
    ]);
  });

  it('the latest press wins: a kick swiped, then a tap, is a punch; a tap, then a kick swiped, is a kick', () => {
    const end = cycle(KICK);
    const swipeThenTap = alone((t) =>
      t === 0 ? KICK_PRESS : t === end - 9 ? KICK_PRESS : t === end - 5 ? F.attack : undefined,
    );
    swipeThenTap.run(end + 20);
    expect(starts(swipeThenTap)).toEqual([
      [0, 'base:kick'],
      [end, 'base:punch'],
    ]);
    const tapThenSwipe = alone((t) =>
      t === 0 ? KICK_PRESS : t === end - 9 ? F.attack : t === end - 5 ? KICK_PRESS : undefined,
    );
    tapThenSwipe.run(end + 20);
    expect(starts(tapThenSwipe)).toEqual([
      [0, 'base:kick'],
      [end, 'base:kick'],
    ]);
  });

  it('control: a press in the wind-up or the active moment is the same swing, not a second one', () => {
    for (const w of [PUNCH, KICK]) {
      const press = w === KICK ? KICK_PRESS : F.attack;
      for (let at = 1; at < w.windupTicks + w.activeTicks; at++) {
        // A plain tap: a kick flag here would be the conversion, not a second swing.
        const h = alone((t) => (t === 0 ? press : t === at ? F.attack : undefined));
        h.run(cycle(w) + 20);
        expect(ofType(h.events, 'attackStart'), `${w.contentId}, press on tick ${at}`).toHaveLength(1);
      }
    }
  });

  it('control: a rival’s press anywhere in its recovery is never kept (the AI presses again when it wants to)', () => {
    for (let at = PUNCH.windupTicks + PUNCH.activeTicks; at < cycle(PUNCH); at++) {
      const h = alone((t) => (t === 0 || t === at ? F.attack : undefined), 'rival');
      h.run(cycle(PUNCH) + 20);
      expect(ofType(h.events, 'attackStart'), `press on tick ${at}`).toHaveLength(1);
    }
  });
});

/** Attacker and target well inside the fixture road, the target to the right (feel.test.ts's pair). */
const pair = (a: Partial<Placement>, b: Partial<Placement>): Placement[] => [
  { s: 100, d: -3, ...a },
  { s: 100, d: -1.8, ...b },
];
type Role = NonNullable<Placement['role']>;
/** The 4-tick hit-stop of a kick or a punch (60 ms) involving the player. */
const HIT_STOP = 4;

/** Rider 0 swings `swing` on tick 0 at rider 1; rider 1 presses `press` on tick `at`. */
function struck(swing: number, at: number, roles: [Role, Role], tuning: Record<string, number> = {}) {
  const h = makeHarness(
    pair({ role: roles[0] }, { role: roles[1] }),
    scriptOf({
      0: (t) => (t === 0 ? flags(swing) : undefined),
      1: (t) => (t === at ? flags(F.attack) : undefined),
    }),
    tuning,
  );
  h.run(80);
  const hit = ofType(h.events, 'hit').find((e) => e.actor === 0);
  const start = ofType(h.events, 'attackStart').find((e) => e.actor === 1);
  return { h, hitTick: hit?.tick ?? -1, start: start?.tick ?? -1 };
}

describe('run A item 4: a tap right after a rival’s hit starts as the player’s stagger ends', () => {
  for (const [name, swing, w] of [
    ['kick', KICK_PRESS, KICK],
    ['punch', F.attack, PUNCH],
  ] as const) {
    it(`a rival’s ${name}: every press from the hit on starts the tick the player’s wobble ends`, () => {
      const probe = struck(swing, 200, ['rival', 'player']);
      const hit = probe.hitTick;
      // The check can find the hit it measures from.
      expect(hit).toBe(w.windupTicks);
      const wobble = Math.round(w.staggerTicks * 0.4);
      const ends = hit + HIT_STOP + wobble;
      for (let at = hit; at < ends; at++) {
        const r = struck(swing, at, ['rival', 'player']);
        expect(r.start, `press on tick ${at}`).toBe(ends);
      }
      // A kick: 7 + 4 + 8 = 19, so a tap on the hit tick waits 12 ticks, not the 25 of the data stagger.
      if (w === KICK) expect(ends).toBe(19);
    });
  }

  it('the lock is the felt wobble: read on the hit tick, the player’s stagger and wobble are equal', () => {
    const h = makeHarness(
      pair({ role: 'rival' }, { role: 'player' }),
      scriptOf({ 0: (t) => (t === 0 ? flags(KICK_PRESS) : undefined) }),
    );
    h.run(KICK.windupTicks + 1);
    expect(ofType(h.events, 'hit')).toHaveLength(1);
    expect(combatState(h.world).stagger[1]).toBe(riderState(h.world).wobble[1]);
    expect(combatState(h.world).stagger[1]).toBe(8);
  });

  it('control: with combat.onPlayerScale at 1 the player is staggered the whole 21 ticks, as anyone', () => {
    const hit = KICK.windupTicks;
    const r = struck(KICK_PRESS, hit, ['rival', 'player'], { 'combat.onPlayerScale': 1 });
    expect(r.start).toBe(hit + HIT_STOP + KICK.staggerTicks);
  });

  it('rivals keep their timing: a rival the player kicks is locked the whole 21 ticks and drops its presses', () => {
    const h = makeHarness(
      pair({ role: 'player' }, { role: 'rival' }),
      scriptOf({
        0: (t) => (t === 0 ? flags(KICK_PRESS) : undefined),
        // The rival mashes: a fresh press every other tick from the hit on.
        1: (t) => (t >= KICK.windupTicks && t % 2 === 0 ? flags(F.attack) : undefined),
      }),
    );
    h.run(KICK.windupTicks + 1);
    expect(combatState(h.world).stagger[1]).toBe(KICK.staggerTicks);
    h.run(60);
    const first = ofType(h.events, 'attackStart').find((e) => e.actor === 1);
    expect(first?.tick).toBe(KICK.windupTicks + HIT_STOP + KICK.staggerTicks);
  });
});

/**
 * The player taps (a punch, auto-aimed) on tick 0 with a rider rubbing his side at `d`; the thumb then
 * swipes `swipe` (kick and side flags, held) from tick 2. The riding phase's contact is recorded every
 * tick (the harness's riders phase is a kinematic stand-in; sim/riders/contact writes contactTick).
 * Returns the targets of the player's hits.
 */
function swipeWhileRubbing(swipe: number, d: number, opts: { rubbing?: boolean; tap?: boolean } = {}) {
  const h = makeHarness(
    [
      { s: 100, d: 0, role: 'player' },
      { s: 100.5, d, role: 'rival' },
    ],
    scriptOf({
      0: (t) =>
        t === 0 && opts.tap !== false
          ? flags(F.attack)
          : t === 0
            ? flags(F.attack | swipe)
            : t >= 2 && t < 12
              ? flags(swipe)
              : undefined,
    }),
  );
  const contact = (riderState(h.world).contactTick ??= {});
  for (let t = 0; t < 40; t++) {
    if (opts.rubbing !== false) contact['0-1'] = h.world.tick;
    h.run(1);
  }
  const mine = ofType(h.events, 'attackStart').filter((e) => e.actor === 0);
  return {
    hits: ofType(h.events, 'hit')
      .filter((e) => e.actor === 0)
      .map((e) => e.target ?? -1),
    kick: mine.some((e) => e.data['weapon'] === 'base:kick'),
  };
}

describe('run A item 5: a clear side swipe never hits the other side', () => {
  it('the live case: a tap becomes a LEFT kick swipe while a rider rubs your RIGHT: no hit on him', () => {
    const r = swipeWhileRubbing(F.kick | F.attackSideLeft, 0.9);
    expect(r.kick).toBe(true);
    expect(r.hits).toEqual([]);
  });

  it('the same from a fresh left kick press: no hit on the rider rubbing your right', () => {
    expect(swipeWhileRubbing(F.kick | F.attackSideLeft, 0.9, { tap: false }).hits).toEqual([]);
  });

  it('control: a RIGHT swipe on the rider rubbing your right lands on him (the bump rule keeps its side)', () => {
    expect(swipeWhileRubbing(F.kick | F.attackSideRight, 0.9).hits).toEqual([1]);
  });

  it('control: a LEFT swipe on a rider rubbing your LEFT lands on him', () => {
    expect(swipeWhileRubbing(F.kick | F.attackSideLeft, -0.9).hits).toEqual([1]);
  });

  it('control: a straight-down (auto-sided) kick swipe lands on the rider rubbing your right', () => {
    expect(swipeWhileRubbing(F.kick, 0.9).hits).toEqual([1]);
  });

  it('control: with no rubbing the left swipe misses as well (the hit came from the carried bump)', () => {
    expect(swipeWhileRubbing(F.kick | F.attackSideLeft, 0.9, { rubbing: false }).hits).toEqual([]);
  });
});
