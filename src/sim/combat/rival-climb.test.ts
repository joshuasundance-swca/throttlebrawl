// Playtest 3, wave C (G4), round 3 "Fights: gentle climb" (rivals about 10% easier to knock down at
// a region's first tier, about 20% harder by its last, "and swing a little harder"): the career
// field level's powerScale (SimRiderDef.levelPower) reaches a rival's hits on the player through
// combat.levelPowerOnPlayer, capped by combat.levelPowerMax. T7.5 found it did nothing in play,
// because the stats-power route (combat.powerOnPlayer) is 0 by default so rivals keep their own
// personalities' numbers. These tests pin the rule, not the pack's numbers: a level's scale moves a
// rival's hit on the player, a neutral level moves nothing, a hit by anyone else or on anyone else
// never takes it, and the cap holds.
import { describe, expect, it } from 'vitest';
import { worldHash } from '../world';
import { F, flags, makeHarness, ofType, scriptOf, type Placement } from './harness.test-util';

const KICK_DATA_DAMAGE = 18;

/** One kick from rider 0 at rider 1, 40 ticks: the first hit's damage and the world's hash. */
function kick(attacker: Partial<Placement>, victim: Partial<Placement>, tuning: Record<string, number> = {}) {
  const h = makeHarness(
    [
      { s: 100, d: 0, role: 'rival', ...attacker },
      { s: 100, d: 1.2, role: 'player', ...victim },
    ],
    scriptOf({ 0: (t) => (t === 1 ? flags(F.attack | F.kick) : undefined) }),
    tuning,
  );
  h.run(40);
  return { damage: ofType(h.events, 'hit')[0]?.data['damage'], hash: worldHash(h.world) };
}

describe('the field level reaches a rival’s hits on the player (playtest 3, gentle climb)', () => {
  it('a level of 1, or none, leaves the hit and the world hash as they are today', () => {
    const today = kick({}, {});
    expect(today.damage).toBe(KICK_DATA_DAMAGE);
    expect(kick({ levelPower: 1 }, {})).toEqual(today);
    // Even tuned to its extremes, a neutral level adds nothing.
    const tuned = { 'combat.levelPowerOnPlayer': 1, 'combat.levelPowerMax': 1.5 };
    expect(kick({ levelPower: 1 }, {}, tuned).damage).toBe(KICK_DATA_DAMAGE);
  });

  it('a climbing level makes the hit harder, a lower first-tier level makes it no harder than today', () => {
    expect(kick({ levelPower: 1.12 }, {}).damage).toBe(Math.round(KICK_DATA_DAMAGE * 1.12));
    expect(kick({ levelPower: 1.12 }, {}).damage).toBeGreaterThan(KICK_DATA_DAMAGE);
    expect(kick({ levelPower: 0.9 }, {}).damage).toBe(Math.round(KICK_DATA_DAMAGE * 0.9));
    expect(kick({ levelPower: 0.9 }, {}).damage).toBeLessThan(KICK_DATA_DAMAGE);
  });

  it('by default a region’s last tier hits at most about 15% harder, whatever the season adds', () => {
    // 1.12 is the last tier's level in season 1; the season cap on the level itself is 1.3.
    const last = kick({ levelPower: 1.12 }, {}).damage as number;
    expect(last / KICK_DATA_DAMAGE).toBeLessThanOrEqual(1.15 + 0.03); // whole-point rounding
    expect(kick({ levelPower: 1.3 }, {}).damage).toBe(Math.round(KICK_DATA_DAMAGE * 1.15));
  });

  it('is tunable: the gain scales the climb, and 0 switches it off', () => {
    const off = { 'combat.levelPowerOnPlayer': 0 };
    expect(kick({ levelPower: 1.12 }, {}, off).damage).toBe(KICK_DATA_DAMAGE);
    // A gain of 0.5 on a level of 1.1 is 1.05: 18 × 1.05 = 18.9, rounded.
    expect(kick({ levelPower: 1.1 }, {}, { 'combat.levelPowerOnPlayer': 0.5 }).damage).toBe(19);
    // The cap is a tunable too.
    expect(kick({ levelPower: 1.3 }, {}, { 'combat.levelPowerMax': 1.3 }).damage).toBe(
      Math.round(KICK_DATA_DAMAGE * 1.3),
    );
  });

  it('only a rival’s hit on the player takes it: not the player’s hits, not fights among rivals', () => {
    // The player's kick on a rival: 36, as the knockdown scale has it, the level notwithstanding.
    expect(kick({ role: 'player', levelPower: 1.3 }, { role: 'rival', levelPower: 1.3 }).damage).toBe(36);
    // Among rivals: the data damage.
    expect(kick({ levelPower: 1.3 }, { role: 'rival' }).damage).toBe(KICK_DATA_DAMAGE);
  });

  it('sits beside the rival’s own power, which still reaches the player only by combat.powerOnPlayer', () => {
    expect(kick({ power: 1.5, levelPower: 1.12 }, {}).damage).toBe(Math.round(KICK_DATA_DAMAGE * 1.12));
    expect(kick({ power: 1.5, levelPower: 1.12 }, {}, { 'combat.powerOnPlayer': 1 }).damage).toBe(
      Math.round(KICK_DATA_DAMAGE * 1.5 * 1.12),
    );
  });
});
