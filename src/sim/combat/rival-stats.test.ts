// Playtest 2 (2026-10-02), interview round 3: "Visible personalities" (moderate stat differences
// shown through how rivals ride and fight), after "different racers different stats might make
// sense". A rider's stats.toughness divides the damage and the stagger it takes; stats.power
// multiplies the damage of every hit it lands. Both default to 1.
import { describe, expect, it } from 'vitest';
import { combatState } from './index';
import { F, flags, makeHarness, ofType, scriptOf, type Placement } from './harness.test-util';

/** One kick from rider 0 at rider 1; the hit's damage and rider 1's stagger right after it. */
function kick(attacker: Partial<Placement>, victim: Partial<Placement>) {
  const h = makeHarness(
    [
      { s: 100, d: 0, role: 'player', ...attacker },
      { s: 100, d: 1.2, ...victim },
    ],
    scriptOf({ 0: (t) => (t === 1 ? flags(F.attack | F.kick) : undefined) }),
  );
  let stagger = 0;
  for (let t = 0; t < 40; t++) {
    h.run(1);
    if (ofType(h.events, 'hit').length > 0 && stagger === 0) stagger = combatState(h.world).stagger[1] ?? 0;
  }
  return { damage: ofType(h.events, 'hit')[0]?.data['damage'], stagger };
}

describe('playtest 2: rider fight stats', () => {
  it('absent stats change nothing: the player’s kick does 36 and staggers the 21-tick kick stagger', () => {
    const plain = kick({}, {});
    expect(plain.damage).toBe(36);
    expect(kick({ power: 1 }, { toughness: 1 })).toEqual(plain);
  });

  it('a tough rider takes less damage and a shorter stagger; a fragile one more', () => {
    const plain = kick({}, {});
    const tough = kick({}, { toughness: 1.2 });
    const fragile = kick({}, { toughness: 0.8 });
    expect(tough.damage).toBe(30); // 36 / 1.2
    expect(fragile.damage).toBe(45); // 36 / 0.8
    expect(tough.stagger).toBeLessThan(plain.stagger);
    expect(fragile.stagger).toBeGreaterThan(plain.stagger);
  });

  it('a strong rider hits harder, on the player too', () => {
    expect(kick({ power: 1.25 }, {}).damage).toBe(45); // 36 × 1.25
    // A rival's kick on the player: the data damage (combat.onPlayerDamageScale 1) × his power.
    expect(kick({ role: 'rival', power: 1.5 }, { role: 'player' }).damage).toBe(27); // 18 × 1.5
  });

  it('so a 100-point rider with toughness 1.2 takes 4 of the player’s kicks, not 3', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player' },
        { s: 100, d: 1.2, toughness: 1.2 },
      ],
      scriptOf({ 0: (t) => (t % 90 === 1 ? flags(F.attack | F.kick) : undefined) }),
    );
    for (let t = 0; t < 90 * 10 && ofType(h.events, 'crash').length === 0; t++) {
      h.run(1);
      const v = h.world.movers[1];
      if (v) v.pos.d = 1.2;
    }
    expect(ofType(h.events, 'hit')).toHaveLength(4);
    expect(ofType(h.events, 'crash')).toHaveLength(1);
  });
});
