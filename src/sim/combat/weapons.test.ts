// weapons-2 (docs/milestones/M4.md, a head start): registered behaviours, charges and durability,
// the taser's stun, the chain's drag, starting weapons and the weighted roadside spawns. Hand-placed
// riders on the combat harness; the weapons below are crude starting numbers, as the pack's.
import { describe, expect, it } from 'vitest';
import type { SimWeaponDef } from '../types';
import { createWorld, addMover } from '../world';
import {
  behaviourOf,
  combatState,
  combatSystem,
  combatView,
  SPENT,
  STOWED_H,
  WEAPON_BEHAVIOURS,
} from './index';
import {
  F,
  flags,
  harnessConfig,
  makeHarness,
  ofType,
  PIPE,
  scriptOf,
  type Placement,
} from './harness.test-util';

/** The baton: never on the road (weight 0), steal window ticks 6–18 of its 18-tick wind-up. */
const BATON: SimWeaponDef = {
  ...PIPE,
  contentId: 'base:baton',
  reachSM: 1.5,
  windupTicks: 18,
  recoveryTicks: 24,
  damage: 16,
  knockbackMps: 6,
  staggerTicks: 18,
  steal: { startTick: 6, endTick: 18 },
  behaviour: 'melee.swing',
  roadsideWeight: 0,
};

/** The taser with 2 charges (the pack's has 6), a 54-tick stun, and no shove to speak of. */
const TASER: SimWeaponDef = {
  contentId: 'base:taser',
  unarmed: false,
  reachSM: 2.4,
  reachDM: 1.6,
  windupTicks: 22,
  activeTicks: 5,
  recoveryTicks: 30,
  cooldownTicks: 0,
  damage: 6,
  hitStopMs: 90,
  knockbackMps: 1.5,
  staggerTicks: 12,
  steal: { startTick: 7, endTick: 22 },
  behaviour: 'taser.stun',
  charges: 2,
  stunTicks: 54,
  roadsideWeight: 0,
};

const CHAIN: SimWeaponDef = {
  ...PIPE,
  contentId: 'base:bike-chain',
  reachSM: 2,
  reachDM: 1.8,
  windupTicks: 24,
  knockbackMps: 0,
  staggerTicks: 0,
  steal: { startTick: 8, endTick: 24 },
  behaviour: 'melee.wrap',
  roadsideWeight: 2,
};

/** Junk that breaks after 2 landed hits; no shove, so the target stays in reach. */
const JUNK: SimWeaponDef = {
  ...PIPE,
  contentId: 'base:junk',
  damage: 10,
  knockbackMps: 0,
  staggerTicks: 0,
  durabilityHits: 2,
  roadsideWeight: 1,
};

const once = (tick: number, f: number) => (t: number) => (t === tick ? flags(f) : undefined);
const at = (ticks: readonly number[], f: number) => (t: number) => (ticks.includes(t) ? flags(f) : undefined);
const starts = (events: ReturnType<typeof ofType>) => events.map((e) => e.data['weapon']);

describe('weapons-2: registered behaviours', () => {
  it('lists the three behaviours, and anything else (or nothing) is the M1 swing', () => {
    expect([...WEAPON_BEHAVIOURS]).toEqual(['melee.swing', 'melee.wrap', 'taser.stun']);
    expect(behaviourOf(TASER)).toBe('taser.stun');
    expect(behaviourOf(CHAIN)).toBe('melee.wrap');
    expect(behaviourOf(PIPE)).toBe('melee.swing'); // no behaviour field
    expect(behaviourOf({ ...PIPE, behaviour: 'flamethrower' })).toBe('melee.swing');
  });

  it('the chain drags a landed target by the Chain drag slider (4 m/s, and a non-default 6)', () => {
    for (const drag of [4, 6]) {
      const h = makeHarness(
        [
          { s: 100, d: 0, speed: 20, role: 'rival', startingWeapon: CHAIN.contentId },
          { s: 100, d: 1.2, speed: 20, role: 'rival' },
        ],
        scriptOf({ 0: once(3, F.attack) }),
        { 'combat.wrapDragMps': drag },
        [CHAIN],
      );
      h.run(40);
      const hit = ofType(h.events, 'hit')[0];
      expect(hit?.data['weapon']).toBe(CHAIN.contentId);
      expect(hit?.data['dragMps']).toBe(drag);
      expect(h.world.movers[1]?.speed).toBeCloseTo(20 - drag, 6);
      expect(h.world.movers[0]?.speed).toBe(20);
    }
  });

  it('the taser stuns: no attacks and a wobble for its stun ticks × the slider, and a speed loss', () => {
    for (const scale of [1, 2]) {
      const h = makeHarness(
        [
          { s: 100, d: 0, speed: 20, role: 'rival', startingWeapon: TASER.contentId },
          { s: 100, d: 1.2, speed: 20, role: 'rival' },
        ],
        // The victim presses 10 ticks after the hit lands (tick 3 + 22 = 25): still stunned.
        scriptOf({ 0: once(3, F.attack), 1: once(36, F.attack) }),
        { 'combat.stunScale': scale },
        [TASER],
      );
      h.run(26);
      const hit = ofType(h.events, 'hit')[0];
      expect(hit?.data['stunTicks']).toBe(54 * scale);
      const st = combatState(h.world);
      expect(st.stagger[1]).toBeGreaterThan(54 * scale - 3);
      expect((h.world.systems['riders'] as { wobble: number[] }).wobble[1]).toBe(54 * scale);
      expect(h.world.movers[1]?.speed).toBeCloseTo(20 * 0.8, 6);
      h.run(20);
      expect(ofType(h.events, 'attackStart').filter((e) => e.actor === 1)).toHaveLength(0);
    }
  });
});

describe('weapons-2: uses live on the weapon', () => {
  it('a taser spends a charge per swing; after the last swing it is gone and a press is a punch', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival', startingWeapon: TASER.contentId },
        { s: 100, d: 1.2, role: 'rival', healthMax: 1000 },
      ],
      scriptOf({ 0: at([3, 100, 200], F.attack) }),
      {},
      [TASER],
    );
    expect(combatView(h.world, 0).heldWeapon).toBe(TASER.contentId);
    const pid = combatState(h.world).heldPickup[0] ?? -1;
    h.run(99);
    expect(combatState(h.world).pickupCharges[pid]).toBe(1);
    h.run(100);
    expect(combatView(h.world, 0).heldWeapon).toBeNull();
    expect(combatState(h.world).pickupHolder[pid]).toBe(SPENT);
    expect(h.world.movers[pid]?.h).toBe(STOWED_H);
    h.run(60);
    expect(starts(ofType(h.events, 'attackStart'))).toEqual([TASER.contentId, TASER.contentId, 'base:punch']);
    // The swing that used the last charge says so (on its hit, or its miss).
    const ends = h.events.filter((e) => e.actor === 0 && (e.type === 'hit' || e.type === 'attackMiss'));
    expect(ends.slice(0, 2).map((e) => e.data['spent'] === true)).toEqual([false, true]);
  });

  it('junk breaks on its last landed hit (2 here); it never comes back to the road', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival', startingWeapon: JUNK.contentId },
        { s: 100, d: 1.2, role: 'rival', healthMax: 1000 },
      ],
      scriptOf({ 0: at([3, 80, 160], F.attack) }),
      {},
      [JUNK],
    );
    const pid = combatState(h.world).heldPickup[0] ?? -1;
    h.run(79);
    expect(combatView(h.world, 0).heldWeapon).toBe(JUNK.contentId);
    expect(combatState(h.world).pickupHits[pid]).toBe(1);
    h.run(80);
    const junkHits = ofType(h.events, 'hit').filter((e) => e.data['weapon'] === JUNK.contentId);
    expect(junkHits.map((e) => e.data['spent'] === true)).toEqual([false, true]);
    expect(combatView(h.world, 0).heldWeapon).toBeNull();
    expect(combatState(h.world).pickupHolder[pid]).toBe(SPENT);
    h.run(60);
    expect(starts(ofType(h.events, 'attackStart'))).toEqual([JUNK.contentId, JUNK.contentId, 'base:punch']);
    // Nobody picks a spent weapon up, even riding over where it was.
    expect(ofType(h.events, 'weaponGrab')).toHaveLength(0);
  });
});

describe('weapons-2: the cops’ weapons, stolen', () => {
  it('a cop starts with his baton in hand, and a scripted steal in its window takes it', () => {
    const cop: Placement = { s: 100, d: 0, role: 'cop', startingWeapon: BATON.contentId };
    const thief: Placement = { s: 100, d: 1.2, role: 'player' };
    const rival: Placement = { s: 100, d: 3.5, role: 'rival' };
    // The cop winds up on tick 5; the thief presses on tick 5 + 10 (inside ticks 6–18); then the
    // thief steps toward the rival and swings the baton at him.
    const h = makeHarness(
      [cop, thief, rival],
      scriptOf({ 0: once(5, F.attack), 1: at([15, 60], F.attack) }),
      {},
      [BATON],
    );
    expect(combatView(h.world, 0).heldWeapon).toBe(BATON.contentId);
    h.run(40);
    const steal = ofType(h.events, 'weaponGrab').find((e) => e.data['source'] === 'steal');
    expect(steal?.actor).toBe(1);
    expect(steal?.target).toBe(0);
    expect(combatView(h.world, 0).heldWeapon).toBeNull();
    expect(combatView(h.world, 1).heldWeapon).toBe(BATON.contentId);
    const thiefRider = h.world.movers[1];
    if (thiefRider) thiefRider.pos.d = 2.3; // alongside the rival now
    h.run(60);
    const hit = ofType(h.events, 'hit').find((e) => e.actor === 1);
    expect(hit?.data['weapon']).toBe(BATON.contentId);
    expect(hit?.data['damage']).toBe(16);
    expect(hit?.target).toBe(2);
  });

  it('a player holding a road weapon still steals the cop’s baton: his pipe goes down on the road', () => {
    // The W-O polish run: the skeptic saw 4 of 11 cop steal windows come while the player held a
    // road pipe, and the press only swung the pipe. Now it steals; the pipe lies where he was.
    const run = (pressAt: number) => {
      const h = makeHarness(
        [
          { s: 100, d: 0, role: 'cop', startingWeapon: BATON.contentId },
          { s: 100, d: 1.2, role: 'player', startingWeapon: PIPE.contentId },
        ],
        scriptOf({ 0: once(5, F.attack), 1: once(pressAt, F.attack) }),
        {},
        [PIPE, BATON],
      );
      expect(combatView(h.world, 1).heldWeapon).toBe(PIPE.contentId);
      const pipe = combatState(h.world).heldPickup[1] ?? -1;
      h.run(40);
      return { h, pipe };
    };
    // Pressed on wind-up tick 10 (inside 6–18): the steal.
    const { h, pipe } = run(15);
    const steal = ofType(h.events, 'weaponGrab').find((e) => e.data['source'] === 'steal');
    expect(steal).toMatchObject({ actor: 1, target: 0 });
    expect(steal?.data).toMatchObject({ weapon: BATON.contentId, dropped: PIPE.contentId });
    expect(combatView(h.world, 1).heldWeapon).toBe(BATON.contentId);
    // The cop is bare-handed and stays so: cops never pick up, so the pipe stays on the road.
    expect(combatView(h.world, 0).heldWeapon).toBeNull();
    expect(combatState(h.world).pickupHolder[pipe]).toBe(-1);
    expect(h.world.movers[pipe]?.h).toBe(0);
    expect(ofType(h.events, 'hit').filter((e) => e.actor === 0)).toHaveLength(0); // his swing was cancelled
    // Pressed a tick before the window (wind-up tick 0): no steal, the press swings the pipe.
    const early = run(5).h;
    expect(ofType(early.events, 'weaponGrab').filter((e) => e.data['source'] === 'steal')).toHaveLength(0);
    expect(ofType(early.events, 'attackStart').find((e) => e.actor === 1)?.data['weapon']).toBe(
      PIPE.contentId,
    );
  });

  it('a cop’s hit on a player lands soft (Cop hits on you, 0.5 by default); on a rival it does not', () => {
    const damageOn = (victim: 'player' | 'rival', tuning: Record<string, number> = {}) => {
      const h = makeHarness(
        [
          { s: 100, d: 0, role: 'cop', startingWeapon: BATON.contentId },
          { s: 100, d: 1.2, role: victim },
        ],
        scriptOf({ 0: once(3, F.attack) }),
        tuning,
        [BATON],
      );
      h.run(40);
      return ofType(h.events, 'hit')[0]?.data['damage'];
    };
    expect(damageOn('player')).toBe(8);
    expect(damageOn('player', { 'combat.copOnPlayerScale': 1 })).toBe(16);
    expect(damageOn('rival')).toBe(16);
  });

  // The cops polish round (the integration skeptic's F2): in San Francisco the cop crashed about
  // three times a race on the hills, dropped his baton on the first, and never swung again (cops
  // never pick up), so a player hardly ever saw a steal chance. A cop now keeps his weapon through a
  // wreck (holstered); you get it only by snatching it mid-swing. Anyone else still drops theirs.
  it('a cop keeps his weapon through a wreck and swings it again once back up; a rival still drops his', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'cop', startingWeapon: BATON.contentId },
        { s: 100, d: 1.2, role: 'player' },
        { s: 300, d: 0, role: 'rival', startingWeapon: BATON.contentId },
      ],
      // After the wreck: the cop swings on 30, and the player snatches it on 30 + 10.
      scriptOf({ 0: once(30, F.attack), 1: once(40, F.attack) }),
      {},
      [BATON],
    );
    const cop = h.world.movers[0];
    const rival = h.world.movers[2];
    if (!cop || !rival) throw new Error('movers');
    cop.mode = 'Tumble';
    rival.mode = 'Tumble';
    h.run(1);
    expect(combatView(h.world, 0).heldWeapon).toBe(BATON.contentId); // holstered, not on the road
    expect(combatView(h.world, 2).heldWeapon).toBeNull(); // the rival's lies on the road
    cop.mode = 'Road';
    rival.mode = 'Road';
    h.run(50);
    expect(ofType(h.events, 'attackStart').find((e) => e.actor === 0)?.data['weapon']).toBe(BATON.contentId);
    const steal = ofType(h.events, 'weaponGrab').find((e) => e.data['source'] === 'steal');
    expect([steal?.actor, steal?.target]).toEqual([1, 0]);
    expect(combatView(h.world, 1).heldWeapon).toBe(BATON.contentId);
  });

  it('a stolen taser keeps the charges it has left: one swing spent by the cop, one left for you', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'cop', startingWeapon: TASER.contentId, healthMax: 1000 },
        { s: 100, d: 1.2, role: 'player', healthMax: 1000 },
      ],
      // Cop swings on 5 (lands and stuns you until about tick 80) and on 120; you snatch on 130,
      // then swing it back on 200; after that swing it is spent.
      scriptOf({ 0: at([5, 120], F.attack), 1: at([130, 200], F.attack) }),
      {},
      [TASER],
    );
    const pid = combatState(h.world).heldPickup[0] ?? -1;
    h.run(140);
    expect(combatView(h.world, 1).heldWeapon).toBe(TASER.contentId);
    expect(combatState(h.world).pickupCharges[pid]).toBe(1);
    h.run(140);
    expect(
      ofType(h.events, 'attackStart')
        .filter((e) => e.actor === 1)
        .map((e) => e.data['weapon']),
    ).toEqual([TASER.contentId]);
    expect(combatView(h.world, 1).heldWeapon).toBeNull();
    expect(combatState(h.world).pickupHolder[pid]).toBe(SPENT);
  });
});

/** The roadside layout for a seed: the weapon at each of the three spots. */
function layout(seed: number, weapons: readonly SimWeaponDef[]): string[] {
  const config = harnessConfig([{ s: 100, d: 0 }], {}, weapons);
  config.seed = seed;
  const world = createWorld(config);
  addMover(world, 'rider', { edge: 0, s: 100, d: 0, dir: 1 }, 0);
  combatSystem.init(world, config);
  const st = combatState(world);
  return st.pickups.map((pid) => st.pickupWeapon[pid] ?? '');
}

describe('weapons-2: roadside spawns', () => {
  it('draw by roadsideWeight from the seed: same seed, same layout; weight 0 never lies on the road', () => {
    const weapons = [PIPE, CHAIN, BATON, TASER, JUNK]; // weights 1 (absent), 2, 0, 0, 1
    expect(layout(3, weapons)).toEqual(layout(3, weapons));
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 200; seed++) {
      const spots = layout(seed, weapons);
      expect(spots).toHaveLength(3);
      for (const w of spots) counts[w] = (counts[w] ?? 0) + 1;
    }
    console.log(`[weapons-2] roadside picks over 200 seeds x 3 spots: ${JSON.stringify(counts)}`);
    expect(counts[BATON.contentId]).toBeUndefined();
    expect(counts[TASER.contentId]).toBeUndefined();
    // Weights 1 : 2 : 1 over 600 picks: the chain near half, the others near a quarter each.
    expect(counts[CHAIN.contentId] ?? 0).toBeGreaterThan(240);
    expect(counts[CHAIN.contentId] ?? 0).toBeLessThan(360);
    expect(counts[PIPE.contentId] ?? 0).toBeGreaterThan(100);
    expect(counts[JUNK.contentId] ?? 0).toBeGreaterThan(100);
  });

  it('with only weight-0 weapons the road stays empty', () => {
    expect(layout(1, [BATON, TASER])).toEqual([]);
  });
});
