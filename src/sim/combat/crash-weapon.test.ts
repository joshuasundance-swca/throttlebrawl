// W-Q (the pitch deck's item 11, "fill the dead air after a crash"): sometimes a weapon lies by
// your bike when you get up. The combat harness with the real tumble phase, and a crash injected in
// the traffic phase (which runs before tumble, as a car would).
import { describe, expect, it } from 'vitest';
import { createRng, streamSeed } from '../../core';
import { parkedBike, tumbleSystem } from '../tumble';
import { emit, type SimSystem } from '../world';
import { CRASH_WEAPON_AHEAD_M, combatState, spawnPickup } from './index';
import { makeHarness, ofType, PIPE } from './harness.test-util';

/** Crashes rider `id` on tick `at`, as traffic would. */
const crashAt = (id: number, at: number): SimSystem => ({
  name: 'traffic',
  init() {},
  step(w) {
    if (w.tick === at) emit(w, 'crash', id, { cause: 'traffic', contact: 'crash' });
  },
});

/** Player 0 riding at 20 m/s and a rival far behind; the player crashes on tick 5. */
function crash(tuning: Record<string, number>, player: 'player' | 'rival' = 'player', armed = false) {
  // `armed`: the player holds a pipe from the start (it drops in the wreck, as M1's rule says).
  const h = makeHarness(
    [
      { s: 200, d: 1.7, role: player, speed: 20 },
      { s: 20, d: -1.7 },
    ],
    () => undefined,
    tuning,
    [PIPE],
    { systems: { traffic: crashAt(0, 5), tumble: tumbleSystem } },
  );
  if (armed) {
    const st = combatState(h.world);
    const p = spawnPickup(h.world, PIPE.contentId, { edge: 0, s: 900, d: 0, dir: 1 });
    st.held[0] = PIPE.contentId;
    st.heldPickup[0] = p;
    st.pickupHolder[p] = 0;
  }
  const before = combatState(h.world).pickups.length;
  for (let t = 0; t < 600 && !ofType(h.events, 'getUp').length; t++) h.run(1);
  const bike = parkedBike(h.world, 0);
  h.run(2); // combat reads the get-up a tick later
  const st = combatState(h.world);
  const added = st.pickups.slice(before).filter((id) => st.pickupHolder[id] === -1);
  return { h, bike, added };
}

describe('W-Q: a weapon by the bike after a crash', () => {
  it('at chance 1, a roadside weapon lies on the bike line, a few metres up the road', () => {
    const { h, bike, added } = crash({ 'combat.crashWeaponChance': 1 });
    expect(ofType(h.events, 'getUp')).toHaveLength(1);
    expect(bike).not.toBeNull();
    expect(added.length).toBeGreaterThanOrEqual(1);
    const p = h.world.movers[added.at(-1) ?? -1];
    expect(p?.kind).toBe('pickup');
    expect(p?.pos.d).toBeCloseTo(bike?.d ?? NaN, 6);
    expect(p?.pos.s).toBeCloseTo((bike?.s ?? NaN) + CRASH_WEAPON_AHEAD_M, 6);
  });

  it('at chance 0, none; and never for a rival', () => {
    expect(crash({ 'combat.crashWeaponChance': 0 }).added).toEqual([]);
    expect(crash({ 'combat.crashWeaponChance': 1 }, 'rival').added).toEqual([]);
  });

  it('a player who wrecked with a weapon dropped it, so gets one too (and the dropped one lies where it fell)', () => {
    const { h, added } = crash({ 'combat.crashWeaponChance': 1 }, 'player', true);
    expect(added).toHaveLength(1);
    expect(combatState(h.world).held[0]).toBe('');
  });

  it('is about the default 0.3 over many seeds (a seeded roll)', () => {
    let hits = 0;
    const N = 40;
    for (let seed = 1; seed <= N; seed++) {
      const h = makeHarness(
        [
          { s: 200, d: 1.7, role: 'player', speed: 20 },
          { s: 20, d: -1.7 },
        ],
        () => undefined,
        {},
        [PIPE],
        { systems: { traffic: crashAt(0, 5), tumble: tumbleSystem } },
      );
      // Reseed the combat stream for this run, as a fresh race's seed would.
      h.world.rng.combat = createRng(streamSeed(seed, 'combat'));
      const before = combatState(h.world).pickups.length;
      for (let t = 0; t < 600 && !ofType(h.events, 'getUp').length; t++) h.run(1);
      h.run(2);
      if (combatState(h.world).pickups.length > before) hits++;
    }
    console.log(`[examined] crash weapon over ${N} seeded get-ups: ${hits}`);
    expect(hits).toBeGreaterThan(N * 0.1);
    expect(hits).toBeLessThan(N * 0.55);
  });
});
