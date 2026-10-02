// Playtest 2 (2026-10-02): "Its surprising how long it takes to knock people down", and in the
// interview "Kick is great because it makes them move but it should take a few hits even if they are
// kicks. Weapons should do more. But yeah shorter more frequent brawls (but still not usually one
// hit)". The retune [default]: a fresh 100-point rival goes down in about 3 kicks, about 5 punches,
// and about 2 swings of a weapon, never one hit; rival hits on the player keep their data damage.
import { describe, expect, it } from 'vitest';
import { F, flags, makeHarness, ofType, PIPE, scriptOf, type Placement } from './harness.test-util';

/**
 * Lands the same blow on a fresh rival until it is knocked off, holding the rival alongside between
 * blows (so the kick's shove does not carry it out of reach), and returns how many blows it took.
 */
function blowsToKnockDown(
  blow: 'punch' | 'kick' | 'pipe',
  tuning: Record<string, number> = {},
  victim: Partial<Placement> = {},
  attacker: Partial<Placement> = {},
): { blows: number; damages: number[] } {
  const press = blow === 'kick' ? F.attack | F.kick : F.attack;
  // One press every 90 ticks: longer than any swing plus the kick's cooldown.
  const h = makeHarness(
    [
      {
        s: 100,
        d: 0,
        role: 'player',
        ...(blow === 'pipe' ? { startingWeapon: PIPE.contentId } : {}),
        ...attacker,
      },
      { s: 100, d: 1.2, ...victim },
    ],
    scriptOf({ 0: (t) => (t % 90 === 1 ? flags(press) : undefined) }),
    tuning,
    blow === 'pipe' ? [PIPE] : [],
  );
  for (let t = 0; t < 90 * 20 && ofType(h.events, 'crash').length === 0; t++) {
    h.run(1);
    const v = h.world.movers[1];
    if (v) v.pos.d = 1.2;
  }
  const hits = ofType(h.events, 'hit');
  expect(ofType(h.events, 'crash')).toHaveLength(1);
  return { blows: hits.length, damages: hits.map((e) => Number(e.data['damage'])) };
}

describe('playtest 2: knockdowns come sooner', () => {
  it('a fresh 100-point rival goes down in 3 kicks, 5 punches or 2 pipe swings (never one)', () => {
    const kick = blowsToKnockDown('kick');
    const punch = blowsToKnockDown('punch');
    const pipe = blowsToKnockDown('pipe');
    console.log(
      `[knockdown] kick ${kick.blows} (${kick.damages.join('+')}), punch ${punch.blows} (${punch.damages.join('+')}), pipe ${pipe.blows} (${pipe.damages.join('+')})\n`,
    );
    expect(kick.blows).toBe(3);
    expect(punch.blows).toBe(5);
    expect(pipe.blows).toBe(2);
  });

  it('the sliders change it: at 1× the M1 counts come back (6 kicks, 10 punches, 5 pipe swings)', () => {
    const m1 = { 'combat.unarmedDamageScale': 1, 'combat.weaponDamageScale': 1 };
    expect(blowsToKnockDown('kick', m1).blows).toBe(6);
    expect(blowsToKnockDown('punch', m1).blows).toBe(10);
    expect(blowsToKnockDown('pipe', m1).blows).toBe(5);
    // And the two are separate: a stronger weapon scale leaves the kick alone.
    expect(blowsToKnockDown('kick', { 'combat.weaponDamageScale': 4 }).blows).toBe(3);
    expect(blowsToKnockDown('pipe', { 'combat.unarmedDamageScale': 4 }).blows).toBe(2);
  });

  it('a tougher rider takes more: a 120-point rider needs 4 kicks', () => {
    expect(blowsToKnockDown('kick', {}, { healthMax: 120 }).blows).toBe(4);
  });

  it('a rival’s hits on the player keep their data damage (combat.onPlayerDamageScale 1)', () => {
    const onPlayer = (tuning: Record<string, number> = {}) => {
      const h = makeHarness(
        [
          { s: 100, d: 0 },
          { s: 100, d: 1.2, role: 'player' },
        ],
        scriptOf({ 0: (t) => (t === 1 ? flags(F.attack | F.kick) : undefined) }),
        tuning,
      );
      h.run(40);
      return ofType(h.events, 'hit')[0]?.data['damage'];
    };
    expect(onPlayer()).toBe(18);
    expect(onPlayer({ 'combat.onPlayerDamageScale': 2 })).toBe(36);
    expect(onPlayer({ 'combat.onPlayerDamageScale': 0 })).toBe(0);
  });

  it('rivals’ and cops’ hits on each other keep their data damage; the player’s hit on a cop is scaled', () => {
    const firstHit = (attacker: 'player' | 'rival' | 'cop', victim: 'player' | 'rival' | 'cop') => {
      const h = makeHarness(
        [
          { s: 100, d: 0, role: attacker },
          { s: 100, d: 1.2, role: victim },
        ],
        scriptOf({ 0: (t) => (t === 1 ? flags(F.attack | F.kick) : undefined) }),
      );
      h.run(40);
      return ofType(h.events, 'hit')[0]?.data['damage'];
    };
    expect(firstHit('rival', 'rival')).toBe(18);
    expect(firstHit('cop', 'rival')).toBe(18);
    expect(firstHit('rival', 'cop')).toBe(18);
    expect(firstHit('player', 'cop')).toBe(36);
  });

  it('the hit jolt (hitImpulse) still reads the data damage, so each blow feels as it did', () => {
    const impulse = (tuning: Record<string, number>) => {
      const h = makeHarness(
        [
          { s: 100, d: 0, role: 'player' },
          { s: 100, d: 1.2 },
        ],
        scriptOf({ 0: (t) => (t === 1 ? flags(F.attack) : undefined) }),
        tuning,
      );
      h.run(40);
      return ofType(h.events, 'hit')[0]?.data['hitImpulse'];
    };
    expect(impulse({})).toBe(impulse({ 'combat.unarmedDamageScale': 1 }));
  });
});
