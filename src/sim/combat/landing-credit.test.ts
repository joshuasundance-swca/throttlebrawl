// Air that pays (the pitch deck's #13): the riders' landing hit knocks a hurt rider off with a
// `crash` whose `reason` is `knockedOff` and whose target is the lander. Combat credits that rider
// with the takedown, as for its own finishing hit, though no combat hit of his preceded it.
import { describe, expect, it } from 'vitest';
import { emit, type SimSystem, type World } from '../world';
import { makeHarness, ofType, scriptOf } from './harness.test-util';
import { takedownCount } from './index';

const riding = (w: World, id: number) => {
  const m = w.movers[id];
  return m !== undefined && (m.mode === 'Road' || m.mode === 'Airborne');
};

/** Stands in for the riders' landing hit: on tick 10, rider 0 lands on rider 1 and knocks him off. */
const landing: SimSystem = {
  name: 'traffic',
  init() {},
  step(w) {
    if (w.tick !== 10 || !riding(w, 1)) return;
    emit(w, 'crash', 1, { reason: 'knockedOff', by: 0, landing: true }, { target: 0 });
  },
};

/** Tumble's hand-off, crudely: a riding rider named by a crash this tick goes down. */
const tumble: SimSystem = {
  name: 'tumble',
  init() {},
  step(w) {
    for (const e of w.events) {
      const m = w.movers[e.actor];
      if (e.type === 'crash' && m && riding(w, m.id)) m.mode = 'Tumble';
    }
  },
};

describe('combat credits a knock-off another system names its rider for', () => {
  it('the landing hit is a takedown for the lander', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, speed: 30, role: 'player' },
        { s: 101, d: 1, speed: 30 },
      ],
      scriptOf({}),
      undefined,
      [],
      { systems: { traffic: landing, tumble } },
    );
    h.run(20);
    const td = ofType(h.events, 'takedown');
    expect(td).toHaveLength(1);
    expect(td[0]?.actor).toBe(0);
    expect(td[0]?.target).toBe(1);
    expect(td[0]?.data['kind']).toBe('health');
    expect(takedownCount(h.world, 0)).toBe(1);
  });
});
