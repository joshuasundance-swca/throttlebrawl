// Playtest 2 (2026-10-02): "Kick timing requires the ability to choose kick direction as you ride
// up behind someone (directional swipe)". A kick with one side flag kicks to that side, whatever
// side the rider ahead is on when you press; a kick with both side flags is the straight kick, a
// boot into the rider directly ahead. The input lane maps the swipe and the keys onto those flags.
import { describe, expect, it } from 'vitest';
import { F, flags, makeHarness, ofType, type Harness, type Placement } from './harness.test-util';

const KICK = F.attack | F.kick;
const STRAIGHT = KICK | F.attackSideLeft | F.attackSideRight;

/**
 * The player rides up behind a rival who is `gap` metres ahead (2.5 by default) and slightly right,
 * closing at 2 m/s, and presses on tick 1. With `passRight`, the player drifts right 0.1 m a tick to
 * 1.6 m, so the rival ends up on the player's LEFT as they draw level.
 */
function rideUp(
  press: number,
  opts: { passRight?: boolean; gap?: number; tuning?: Record<string, number> } = {},
): Harness {
  const placements: Placement[] = [
    { s: 100, d: 0, speed: 22, role: 'player' },
    { s: 100 + (opts.gap ?? 2.5), d: 0.2, speed: 20 },
  ];
  const h = makeHarness(placements, (t, id) => (id === 0 && t === 1 ? flags(press) : undefined), opts.tuning);
  for (let t = 0; t < 70; t++) {
    h.run(1);
    const me = h.world.movers[0];
    if (opts.passRight && me) me.pos.d = Math.min(1.6, me.pos.d + 0.1);
  }
  return h;
}

const hitsOn = (h: Harness, target: number) => ofType(h.events, 'hit').filter((e) => e.target === target);

describe('playtest 2: the directional kick from behind', () => {
  it('a kick to the left lands on a rival you pass on the right; the auto-sided kick swings right and misses', () => {
    const left = rideUp(KICK | F.attackSideLeft, { passRight: true, gap: 1.5 });
    expect(hitsOn(left, 1)).toHaveLength(1);
    expect(left.world.movers[1]!.pos.d).toBeLessThan(0.2 - 2); // shoved left, away from the kicker
    const auto = rideUp(KICK, { passRight: true, gap: 1.5 });
    expect(ofType(auto.events, 'attackStart')[0]?.data['side']).toBe(1); // he was right at the press
    expect(hitsOn(auto, 1)).toHaveLength(0);
    expect(ofType(auto.events, 'attackMiss')).toHaveLength(1);
  });

  it('the straight kick (both side flags) boots the rider directly ahead; a plain kick there is out of reach', () => {
    const straight = rideUp(STRAIGHT);
    const start = ofType(straight.events, 'attackStart')[0];
    expect(start?.data['straight']).toBe(true);
    expect(start?.target).toBe(1);
    const hits = hitsOn(straight, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.data['kick']).toBe(true);
    expect(hits[0]?.data['straight']).toBe(true);
    // He was a little right of the kicker's line, so the boot sends him further right.
    expect(straight.world.movers[1]!.pos.d).toBeGreaterThan(0.2 + 2);
    expect(hitsOn(rideUp(KICK), 1)).toHaveLength(0);
  });

  it('the straight kick’s forward reach is a slider (combat.straightKickReachM): at 0.5 m it misses', () => {
    expect(hitsOn(rideUp(STRAIGHT, { tuning: { 'combat.straightKickReachM': 0.5 } }), 1)).toHaveLength(0);
  });

  it('both side flags without the kick are still an auto-sided punch, as before', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player' },
        { s: 100, d: 1.2 },
      ],
      (t, id) => (id === 0 && t === 1 ? flags(F.attack | F.attackSideLeft | F.attackSideRight) : undefined),
    );
    h.run(40);
    const start = ofType(h.events, 'attackStart')[0];
    expect(start?.data['weapon']).toBe('base:punch');
    expect(start?.data['straight']).toBeUndefined();
    expect(hitsOn(h, 1)).toHaveLength(1);
  });

  it('a swipe that becomes straight during a punch wind-up converts it into a straight kick', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, speed: 22, role: 'player' },
        { s: 102.5, d: 0.2, speed: 20 },
      ],
      (t, id) =>
        id !== 0
          ? undefined
          : t === 1
            ? flags(F.attack)
            : t > 1 && t < 6
              ? flags(STRAIGHT & ~F.attack)
              : undefined,
    );
    h.run(70);
    const starts = ofType(h.events, 'attackStart');
    expect(starts.map((e) => e.data['weapon'])).toEqual(['base:punch', 'base:kick']);
    expect(starts[1]?.data['straight']).toBe(true);
    expect(hitsOn(h, 1)).toHaveLength(1);
  });

  it('replays to the same events', () => {
    const run = () => JSON.stringify(rideUp(STRAIGHT).events);
    expect(run()).toBe(run());
  });
});
