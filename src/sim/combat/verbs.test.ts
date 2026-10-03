// Weapons with verbs (the pitch deck's #4, run W-T): Kevin's briefcase is thrown and bursts into
// paperwork, the chain yanks a rival across your line (toward you, or past you into the oncoming
// lane), and the campaign sign sweeps both sides at once. Hand-placed riders on the combat harness,
// driven by sim ticks only.
import { describe, expect, it } from 'vitest';
import type { SimWeaponDef } from '../types';
import { behaviourOf, combatState, combatView, SPENT, WEAPON_BEHAVIOURS } from './index';
import { F, flags, makeHarness, ofType, PIPE, scriptOf } from './harness.test-util';

/** The briefcase as a thrown weapon: 18-tick wind-up, flies up to 14 m ahead, 3 m either side. */
const BRIEFCASE: SimWeaponDef = {
  ...PIPE,
  contentId: 'base:kevins-briefcase',
  reachSM: 14,
  reachDM: 3,
  windupTicks: 18,
  damage: 14,
  knockbackMps: 9,
  steal: { startTick: 5, endTick: 18 },
  behaviour: 'throw.burst',
  durabilityHits: null,
};

const CHAIN: SimWeaponDef = {
  ...PIPE,
  contentId: 'base:bike-chain',
  reachSM: 2,
  reachDM: 1.8,
  windupTicks: 24,
  knockbackMps: 5,
  steal: { startTick: 8, endTick: 24 },
  behaviour: 'melee.yank',
};

const SIGN: SimWeaponDef = {
  ...PIPE,
  contentId: 'base:campaign-sign',
  reachSM: 2.2,
  reachDM: 1.6,
  windupTicks: 25,
  damage: 12,
  knockbackMps: 10,
  steal: { startTick: 8, endTick: 25 },
  behaviour: 'melee.sweep',
  durabilityHits: 3,
};

const attackAt = (tick: number) => (t: number) => (t === tick ? flags(F.attack) : undefined);

describe('verbs: the registry', () => {
  it('registers the throw, the yank and the sweep', () => {
    for (const b of ['throw.burst', 'melee.yank', 'melee.sweep']) {
      expect(WEAPON_BEHAVIOURS as readonly string[]).toContain(b);
    }
    expect(behaviourOf(BRIEFCASE)).toBe('throw.burst');
    expect(behaviourOf(CHAIN)).toBe('melee.yank');
    expect(behaviourOf(SIGN)).toBe('melee.sweep');
  });
});

describe('verbs: Kevin’s briefcase is thrown and bursts into paperwork', () => {
  it('leaves the hand at the end of the wind-up, flies ahead and bursts on the rider it hits', () => {
    const h = makeHarness(
      [
        { s: 100, d: 1.7, speed: 30, role: 'player', startingWeapon: BRIEFCASE.contentId },
        { s: 109, d: 1.2, speed: 30, role: 'rival' },
      ],
      scriptOf({ 0: attackAt(3) }),
      {},
      [BRIEFCASE],
    );
    const pid = combatState(h.world).heldPickup[0] ?? -1;
    expect(pid).toBeGreaterThanOrEqual(0);
    // Through the wind-up the case is still in the hand.
    h.run(3 + BRIEFCASE.windupTicks - 1);
    expect(combatView(h.world, 0).heldWeapon).toBe(BRIEFCASE.contentId);
    // A few ticks after it leaves the hand it is in the air, ahead of the thrower.
    h.run(4);
    expect(combatView(h.world, 0).heldWeapon).toBeNull();
    const flying = h.world.movers[pid];
    expect(flying?.h ?? 0).toBeGreaterThan(0.5);
    expect((flying?.pos.s ?? 0) - (h.world.movers[0]?.pos.s ?? 0)).toBeGreaterThan(0.5);
    h.run(90);
    const hits = ofType(h.events, 'hit').filter((e) => e.actor === 0);
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit?.target).toBe(1);
    expect(hit?.data['thrown']).toBe(true);
    expect(hit?.data['burst']).toBe(true);
    expect(typeof hit?.data['burstX']).toBe('number');
    expect(typeof hit?.data['burstZ']).toBe('number');
    // One throw, and it is gone: the paperwork does not come back.
    expect(combatState(h.world).pickupHolder[pid]).toBe(SPENT);
    // The hit shares the throw's cause, so takedown credit and barks follow it.
    const start = ofType(h.events, 'attackStart').find((e) => e.actor === 0);
    expect(hit?.causeId).toBe(start?.causeId);
    expect(ofType(h.events, 'attackMiss').filter((e) => e.actor === 0)).toHaveLength(0);
    // The release is its own event, on the wind-up's last tick, before the hit: aimed at the rival.
    const thrown = ofType(h.events, 'throw');
    expect(thrown).toHaveLength(1);
    expect(thrown[0]).toMatchObject({ actor: 0, target: 1, causeId: start?.causeId });
    expect(thrown[0]?.data).toMatchObject({ weapon: BRIEFCASE.contentId, pickup: pid });
    expect(thrown[0]?.tick ?? 0).toBeLessThan(hit?.tick ?? 0);
  });

  it('with nobody ahead it flies its range, lands and bursts anyway (a miss)', () => {
    const h = makeHarness(
      [{ s: 100, d: 1.7, speed: 30, role: 'player', startingWeapon: BRIEFCASE.contentId }],
      scriptOf({ 0: attackAt(3) }),
      {},
      [BRIEFCASE],
    );
    const pid = combatState(h.world).heldPickup[0] ?? -1;
    h.run(200);
    const misses = ofType(h.events, 'attackMiss').filter((e) => e.actor === 0);
    expect(misses).toHaveLength(1);
    expect(misses[0]?.data['thrown']).toBe(true);
    expect(misses[0]?.data['burst']).toBe(true);
    expect(combatState(h.world).pickupHolder[pid]).toBe(SPENT);
    expect(ofType(h.events, 'hit')).toHaveLength(0);
  });

  it('never hits the thrower, and a rider behind is not a target', () => {
    const h = makeHarness(
      [
        { s: 100, d: 1.7, speed: 30, role: 'player', startingWeapon: BRIEFCASE.contentId },
        { s: 96, d: 1.7, speed: 30, role: 'rival' },
      ],
      scriptOf({ 0: attackAt(3) }),
      {},
      [BRIEFCASE],
    );
    h.run(200);
    expect(ofType(h.events, 'hit')).toHaveLength(0);
    expect(ofType(h.events, 'attackMiss').filter((e) => e.actor === 0)).toHaveLength(1);
  });

  it('can still be snatched in its wind-up, like any held weapon', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival', startingWeapon: BRIEFCASE.contentId },
        { s: 100, d: 1.2, role: 'player' },
      ],
      scriptOf({ 0: attackAt(5), 1: attackAt(5 + 10) }),
      {},
      [BRIEFCASE],
    );
    h.run(60);
    expect(combatView(h.world, 1).heldWeapon).toBe(BRIEFCASE.contentId);
    expect(ofType(h.events, 'hit')).toHaveLength(0);
  });

  it('its throw range is not a snatch range: a thief 6 m back cannot take it', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival', startingWeapon: BRIEFCASE.contentId },
        { s: 94, d: 1.2, role: 'player' },
      ],
      scriptOf({ 0: attackAt(5), 1: attackAt(5 + 10) }),
      {},
      [BRIEFCASE],
    );
    h.run(60);
    expect(ofType(h.events, 'weaponGrab').filter((e) => e.data['source'] === 'steal')).toHaveLength(0);
  });

  it('replays the same: two runs hash the same', () => {
    const run = () => {
      const h = makeHarness(
        [
          { s: 100, d: 1.7, speed: 30, role: 'player', startingWeapon: BRIEFCASE.contentId },
          { s: 109, d: 1.2, speed: 28, role: 'rival' },
        ],
        scriptOf({ 0: attackAt(3) }),
        {},
        [BRIEFCASE],
      );
      h.run(120);
      return JSON.stringify(h.world.systems['combat']) + JSON.stringify(h.events);
    };
    expect(run()).toBe(run());
  });
});

describe('verbs: the chain yanks a rival across your line', () => {
  it('pulls the target toward you and past you, to your far side', () => {
    // The rival rides on the player's right, a little ahead; the player is on the oncoming side.
    const h = makeHarness(
      [
        { s: 100, d: 0.5, role: 'player', startingWeapon: CHAIN.contentId },
        { s: 101.5, d: 1.9, role: 'rival', healthMax: 1000 },
      ],
      scriptOf({ 0: attackAt(3) }),
      {},
      [CHAIN],
    );
    h.run(3 + CHAIN.windupTicks + 60);
    const hit = ofType(h.events, 'hit').find((e) => e.actor === 0);
    expect(hit?.data['yank']).toBe(true);
    const rival = h.world.movers[1];
    // Pulled across: now on the player's left, about combat.yankPastM (1.2 m) past his line.
    expect(rival?.pos.d ?? 9).toBeLessThan(0.5);
    expect(rival?.pos.d ?? 9).toBeCloseTo(0.5 - 1.2, 1);
  });

  it('the old wrap still shoves away (the control)', () => {
    const wrap: SimWeaponDef = { ...CHAIN, behaviour: 'melee.wrap' };
    const h = makeHarness(
      [
        { s: 100, d: 0.5, role: 'player', startingWeapon: wrap.contentId },
        { s: 101.5, d: 1.9, role: 'rival', healthMax: 1000 },
      ],
      scriptOf({ 0: attackAt(3) }),
      {},
      [wrap],
    );
    h.run(3 + CHAIN.windupTicks + 60);
    expect(h.world.movers[1]?.pos.d ?? 0).toBeGreaterThan(1.9);
  });

  it('the yank distance is a slider: 0 stops the target on your line', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0.5, role: 'player', startingWeapon: CHAIN.contentId },
        { s: 101.5, d: 1.9, role: 'rival', healthMax: 1000 },
      ],
      scriptOf({ 0: attackAt(3) }),
      { 'combat.yankPastM': 0 },
      [CHAIN],
    );
    h.run(3 + CHAIN.windupTicks + 60);
    expect(h.world.movers[1]?.pos.d ?? 9).toBeCloseTo(0.5, 1);
  });
});

describe('verbs: the campaign sign sweeps both sides at once', () => {
  it('one swing lands on a rider on each side, each shoved away, one use spent', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player', startingWeapon: SIGN.contentId },
        { s: 100.5, d: 1.2, role: 'rival', healthMax: 1000 },
        { s: 100.5, d: -1.2, role: 'rival', healthMax: 1000 },
      ],
      scriptOf({ 0: attackAt(3) }),
      {},
      [SIGN],
    );
    const pid = combatState(h.world).heldPickup[0] ?? -1;
    h.run(3 + SIGN.windupTicks + 60);
    const hits = ofType(h.events, 'hit').filter((e) => e.actor === 0);
    expect(hits.map((e) => e.target).sort()).toEqual([1, 2]);
    expect(hits.every((e) => e.data['sweep'] === true)).toBe(true);
    expect(new Set(hits.map((e) => e.causeId)).size).toBe(1);
    expect(h.world.movers[1]?.pos.d ?? 0).toBeGreaterThan(1.2);
    expect(h.world.movers[2]?.pos.d ?? 0).toBeLessThan(-1.2);
    // Durability counts swings that land, not riders: 3 becomes 2.
    expect(combatState(h.world).pickupHits[pid]).toBe(2);
    expect(combatView(h.world, 0).heldWeapon).toBe(SIGN.contentId);
  });

  it('a plain swing in the same spot lands on one rider only (the control)', () => {
    const swing: SimWeaponDef = { ...SIGN, behaviour: 'melee.swing' };
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player', startingWeapon: swing.contentId },
        { s: 100.5, d: 1.2, role: 'rival', healthMax: 1000 },
        { s: 100.5, d: -1.2, role: 'rival', healthMax: 1000 },
      ],
      scriptOf({ 0: attackAt(3) }),
      {},
      [swing],
    );
    h.run(3 + SIGN.windupTicks + 60);
    expect(ofType(h.events, 'hit').filter((e) => e.actor === 0)).toHaveLength(1);
  });

  it('with one rider in reach it still lands once and is not a miss', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player', startingWeapon: SIGN.contentId },
        { s: 100.5, d: -1.2, role: 'rival', healthMax: 1000 },
      ],
      scriptOf({ 0: attackAt(3) }),
      {},
      [SIGN],
    );
    h.run(3 + SIGN.windupTicks + 60);
    expect(ofType(h.events, 'hit').filter((e) => e.actor === 0)).toHaveLength(1);
    expect(ofType(h.events, 'attackMiss')).toHaveLength(0);
  });
});
