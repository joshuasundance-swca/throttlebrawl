// Playtest 4 (P4-6, the maintainer, round 2): "make it so that bumping into a rival while attacking
// doesn't negate the attack". #513 kept an attack that touches its rider during the wind-up or the
// active moment; run B (B15) found the other half: an attack pressed just AFTER a rear bump still
// missed, because the bump holds the two bikes 2 m apart nose to tail with their speeds merged, out
// of the punch's 1.2 m, the kick's 1 m and the straight kick's 2 m. The rule, by sim ticks: a
// player's attack started within BUMP_AFTER_TICKS of a bump with a rider lands on him while he is
// within BUMP_REACH_M, and nothing else changes:
// - with no bump, the same rider 2 m ahead is still out of reach (no general reach increase);
// - a press later than BUMP_AFTER_TICKS after the bump misses him;
// - a rider pushed past BUMP_REACH_M is out of reach;
// - a rival who bumps the player keeps his own reach box.
// The harness's riders phase is a kinematic stand-in, so the bump is the riding phase's contact
// record (riderState().contactTick, which sim/riders/contact writes), set on the tick it happens.
import { describe, expect, it } from 'vitest';
import { riderState } from '../riders';
import { BUMP_AFTER_TICKS, BUMP_REACH_M } from './index';
import { F, flags, makeHarness, ofType, scriptOf, type Placement } from './harness.test-util';

const PUNCH = F.attack;
const KICK = F.attack | F.kick;
const STRAIGHT = KICK | F.attackSideLeft | F.attackSideRight;
const PRESSES = { punch: PUNCH, kick: KICK, straight: STRAIGHT } as const;
/** Where a rear bump leaves the rider ahead: just past the 2 m the contact holds, a little across. */
const PUSHED = { ahead: 2.3, across: 0.3 };
const BUMP_TICK = 5;

interface Ride {
  /** The attacker's entity id (0 or 1); the other rider is the one bumped. */
  attacker: 0 | 1;
  press: number;
  /** Ticks after the bump the attacker presses. */
  after: number;
  /** Whether the two bikes touched on BUMP_TICK. */
  bump?: boolean;
  /** How far ahead of the attacker the other rider rides (m). */
  ahead?: number;
}

/** Both riders at 25 m/s on a straight road; returns the attacker's hits' targets. */
function ride({ attacker, press, after, bump = true, ahead = PUSHED.ahead }: Ride): number[] {
  const back: Placement = { s: 100, d: 0, speed: 25 };
  const front: Placement = { s: 100 + ahead, d: -PUSHED.across, speed: 25 };
  // Entity 0 is the player: behind when he attacks, in front when the rival does.
  const placements: Placement[] =
    attacker === 0
      ? [
          { ...back, role: 'player' },
          { ...front, role: 'rival' },
        ]
      : [
          { ...front, d: 0, role: 'player' },
          { ...back, d: PUSHED.across, role: 'rival' },
        ];
  const pressAt = BUMP_TICK + after;
  const h = makeHarness(
    placements,
    scriptOf({ [attacker]: (t) => (t === pressAt ? flags(press) : undefined) }),
  );
  const contact = (riderState(h.world).contactTick ??= {});
  h.run(BUMP_TICK);
  if (bump) contact['0-1'] = h.world.tick;
  h.run(after + 60);
  return ofType(h.events, 'hit')
    .filter((e) => e.actor === attacker)
    .map((e) => e.target ?? -1);
}

describe('P4-6: an attack pressed just after a bump lands on the rider bumped', () => {
  it('a punch, a kick or a straight kick pressed up to BUMP_AFTER_TICKS after a rear bump lands', () => {
    for (const [name, press] of Object.entries(PRESSES)) {
      for (const after of [0, 1, 8, 15, BUMP_AFTER_TICKS]) {
        expect(ride({ attacker: 0, press, after }), `${name} ${after} ticks after`).toEqual([1]);
      }
    }
  });

  it('control: with no bump, the same rider 2.3 m ahead is out of reach', () => {
    for (const [name, press] of Object.entries(PRESSES)) {
      expect(ride({ attacker: 0, press, after: 8, bump: false }), name).toEqual([]);
    }
  });

  it('control: a press later than BUMP_AFTER_TICKS after the bump misses', () => {
    for (const [name, press] of Object.entries(PRESSES)) {
      expect(ride({ attacker: 0, press, after: BUMP_AFTER_TICKS + 1 }), name).toEqual([]);
    }
  });

  it('control: a rider beyond BUMP_REACH_M ahead is out of reach, bump or not', () => {
    for (const [name, press] of Object.entries(PRESSES)) {
      expect(ride({ attacker: 0, press, after: 4, ahead: BUMP_REACH_M + 0.5 }), name).toEqual([]);
    }
  });

  it('control: a rival who bumps the player keeps his own reach box', () => {
    for (const [name, press] of Object.entries(PRESSES)) {
      expect(ride({ attacker: 1, press, after: 4 }), name).toEqual([]);
    }
  });
});
