// combat-2's automated acceptance (docs/milestones/M1.md, "combat-2"): the pickup, the held-weapon
// swing, the steal window (ticks 7–20 of the pipe's wind-up), the steal cue, and the drop on a
// wreck. Hand-placed riders on the combat harness; the pipe is the M1 starting numbers.
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../types';
import { combatState, combatView, pickupCount, roadsideSpots, spawnPickup, STOWED_H } from './index';
import {
  F,
  flags,
  harnessConfig,
  makeHarness,
  ofType,
  PIPE,
  scriptOf,
  type Harness,
  type Placement,
} from './harness.test-util';

const PIPE_ID = 'base:lead-pipe';
const once = (tick: number, f: number) => (t: number) => (t === tick ? flags(f) : undefined);
const grabs = (events: readonly SimEvent[], source: 'road' | 'steal') =>
  ofType(events, 'weaponGrab').filter((e) => e.data['source'] === source);

/** Gives a rider the pipe by laying one on the rider's spot and running one tick. */
function arm(h: Harness, id: number): number {
  const m = h.world.movers[id];
  if (!m) throw new Error('no rider');
  const pid = spawnPickup(h.world, PIPE_ID, { edge: 0, s: m.pos.s, d: m.pos.d, dir: 1 });
  h.run(1);
  expect(combatView(h.world, id).heldWeapon).toBe(PIPE_ID);
  return pid;
}

/** How many places one pipe is in (riders holding it, plus 1 if it lies on the road): always 1. */
function pipeCount(h: Harness, pid: number): number {
  const st = combatState(h.world);
  const held = h.world.movers.filter((m) => m.kind === 'rider' && st.heldPickup[m.id] === pid);
  for (const m of held) expect(st.held[m.id]).toBe(st.pickupWeapon[pid]);
  return held.length + ((st.pickupHolder[pid] ?? -1) < 0 ? 1 : 0);
}

/**
 * The steal scene: the holder (a rival) is armed on tick 0 and presses attack on tick SWING, so
 * its wind-up's tick k is tick SWING + k. The thief (1.2 m to its right) presses once on
 * SWING + k. When `thiefFirst`, the thief has the lower entity id, to show the result does not
 * depend on order. With `decoy`, a third rider 1.2 m to the holder's left is the one it swings at
 * (a left drag), so a late press by the thief is not lost to the pipe's stagger.
 */
const SWING = 5;
function stealScene(
  k: number,
  opts: { thiefFirst?: boolean; decoy?: boolean } = {},
): Harness & { pid: number } {
  const holder: Placement = { s: 100, d: 0, role: 'rival' };
  const thief: Placement = { s: 100, d: 1.2, role: 'player' };
  const [hid, tid] = opts.thiefFirst ? [1, 0] : [0, 1];
  const riders = opts.thiefFirst ? [thief, holder] : [holder, thief];
  if (opts.decoy) riders.push({ s: 100, d: -1.2, role: 'rival' });
  const swing = opts.decoy ? F.attack | F.attackSideLeft : F.attack;
  const h = makeHarness(
    riders,
    scriptOf({ [hid]: once(SWING, swing), [tid]: once(SWING + k, F.attack) }),
    {},
    [PIPE],
  );
  const pid = arm(h, hid);
  h.run(SWING + 40);
  return Object.assign(h, { pid });
}

describe('combat-2: the pipe resolves to the M1 starting numbers', () => {
  it('the harness pipe is 20 / 6 / 25 ticks with the steal window on ticks 7–20', () => {
    expect([PIPE.windupTicks, PIPE.activeTicks, PIPE.recoveryTicks]).toEqual([20, 6, 25]);
    expect(PIPE.steal).toEqual({ startTick: 7, endTick: 20 });
    expect(PIPE.unarmed).toBe(false);
  });
});

describe('combat-2: picking up the pipe', () => {
  it('lays one pipe per spot along the route at race start, in the travel lane', () => {
    const config = harnessConfig([{ s: 100, d: 0 }], {}, [PIPE]);
    // The harness route runs from s 20 to s 980 (960 m) on one edge: two 480 m stretches at the
    // default 500 m spacing, a spot at each stretch's centre with no jitter.
    expect(pickupCount(960, 500)).toBe(2);
    const spots = roadsideSpots(config);
    expect(spots.map((p) => Math.round(p.s))).toEqual([20 + 240, 20 + 720]);
    const h = makeHarness([{ s: 100, d: 0 }], () => undefined, {}, [PIPE]);
    const st = combatState(h.world);
    expect(st.pickups).toHaveLength(2);
    for (const id of st.pickups) {
      expect(h.world.movers[id]?.kind).toBe('pickup');
      expect(st.pickupWeapon[id]).toBe(PIPE_ID);
    }
    // No armed weapon in the config: no pickups (combat-1's scenes are unchanged).
    expect(combatState(makeHarness([{ s: 100, d: 0 }], () => undefined).world).pickups).toEqual([]);
  });

  it('a rider riding over the pipe picks it up; one riding 3 m to the side does not', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, speed: 30 },
        { s: 100, d: 3, speed: 30 },
      ],
      () => undefined,
    );
    const pid = spawnPickup(h.world, PIPE_ID, { edge: 0, s: 110, d: 0, dir: 1 });
    h.run(60);
    const road = grabs(h.events, 'road');
    expect(road).toHaveLength(1);
    expect(road[0]?.actor).toBe(0);
    expect(road[0]?.target).toBe(pid);
    expect(road[0]?.data['weapon']).toBe(PIPE_ID);
    expect(combatView(h.world, 0).heldWeapon).toBe(PIPE_ID);
    expect(combatView(h.world, 1).heldWeapon).toBeNull();
    expect(h.world.movers[pid]?.h).toBe(STOWED_H);
    expect(pipeCount(h, pid)).toBe(1);
  });

  it('a cop does not pick up a roadside weapon', () => {
    const h = makeHarness([{ s: 100, d: 0, speed: 30, role: 'cop' }], () => undefined);
    spawnPickup(h.world, PIPE_ID, { edge: 0, s: 110, d: 0, dir: 1 });
    h.run(60);
    expect(grabs(h.events, 'road')).toHaveLength(0);
    expect(combatView(h.world, 0).heldWeapon).toBeNull();
  });
});

describe('combat-2: the held-weapon swing', () => {
  it('swings the pipe (20 / 6 / 25) instead of the punch, and lands its damage', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival' },
        { s: 100, d: 1.2, role: 'rival' },
      ],
      scriptOf({ 0: once(2, F.attack) }),
      {},
      [PIPE],
    );
    arm(h, 0);
    const phases: string[] = [];
    for (let t = 1; t < 60; t++) {
      h.run(1);
      phases.push(combatView(h.world, 0).attackPhase);
    }
    const start = ofType(h.events, 'attackStart');
    expect(start.map((e) => e.data['weapon'])).toEqual([PIPE_ID]);
    expect(start[0]?.tick).toBe(2);
    // phases[i] is tick i + 1: wind-up ticks 2–21, active from tick 22 (6 ticks), recovery 25.
    expect(phases.slice(1, 21).every((p) => p === 'windup')).toBe(true);
    expect(phases[21]).toBe('active');
    const hits = ofType(h.events, 'hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.tick).toBe(22);
    expect(hits[0]?.data['weapon']).toBe(PIPE_ID);
    expect(hits[0]?.data['damage']).toBe(PIPE.damage);
    expect(phases[27]).toBe('recovery');
    expect(phases[52]).toBe('idle');
    expect(combatView(h.world, 0).heldWeapon).toBe(PIPE_ID); // unlimited uses in M1
  });

  it('a kick is still a kick with the pipe in hand, and a kick flag turns a pipe wind-up into one', () => {
    const kick = makeHarness(
      [
        { s: 100, d: 0 },
        { s: 100, d: 1.2 },
      ],
      scriptOf({ 0: once(2, F.attack | F.kick) }),
      {},
      [PIPE],
    );
    arm(kick, 0);
    kick.run(20);
    expect(ofType(kick.events, 'attackStart').map((e) => e.data['weapon'])).toEqual(['base:kick']);

    const turn = makeHarness(
      [
        { s: 100, d: 0 },
        { s: 100, d: 1.2 },
      ],
      scriptOf({ 0: (t) => (t === 2 ? flags(F.attack) : t === 4 ? flags(F.kick) : undefined) }),
      {},
      [PIPE],
    );
    arm(turn, 0);
    turn.run(20);
    const starts = ofType(turn.events, 'attackStart');
    expect(starts.map((e) => e.data['weapon'])).toEqual([PIPE_ID, 'base:kick']);
    expect(starts[1]?.causeId).toBe(starts[0]?.causeId);
  });
});

describe('combat-2: the steal', () => {
  it('attack pressed on ticks 7–20 of an opponent’s swing grabs the weapon, whatever the entity order', () => {
    for (const thiefFirst of [false, true]) {
      for (let k = 7; k <= 20; k++) {
        const h = stealScene(k, { thiefFirst });
        const [hid, tid] = thiefFirst ? [1, 0] : [0, 1];
        const steal = grabs(h.events, 'steal');
        expect(steal, `k=${k} thiefFirst=${thiefFirst}`).toHaveLength(1);
        expect(steal[0]?.tick).toBe(SWING + k);
        expect(steal[0]?.actor).toBe(tid);
        expect(steal[0]?.target).toBe(hid);
        expect(steal[0]?.data['windupTick']).toBe(k);
        // The swing is cancelled: no hit and no miss from the holder; the thief swings nothing.
        expect(ofType(h.events, 'hit').filter((e) => e.actor === hid)).toHaveLength(0);
        expect(ofType(h.events, 'attackMiss').filter((e) => e.actor === hid)).toHaveLength(0);
        expect(ofType(h.events, 'attackStart').filter((e) => e.actor === tid)).toHaveLength(0);
        // The steal and the swing it cancelled share a cause id.
        const swing = ofType(h.events, 'attackStart').find((e) => e.actor === hid);
        expect(steal[0]?.causeId).toBe(swing?.causeId);
        expect(combatView(h.world, tid).heldWeapon).toBe(PIPE_ID);
        expect(combatView(h.world, hid).heldWeapon).toBeNull();
        expect(pipeCount(h, h.pid)).toBe(1);
      }
    }
  });

  it('at tick 3 or tick 22 it is a normal punch, and the holder keeps the pipe', () => {
    for (const [k, decoy] of [
      [3, false],
      [6, false],
      [21, true],
      [22, true],
    ] as const) {
      const h = stealScene(k, { decoy });
      expect(grabs(h.events, 'steal'), `k=${k}`).toHaveLength(0);
      const thiefStarts = ofType(h.events, 'attackStart').filter((e) => e.actor === 1);
      expect(thiefStarts.map((e) => [e.tick, e.data['weapon']])).toEqual([[SWING + k, 'base:punch']]);
      expect(combatView(h.world, 0).heldWeapon).toBe(PIPE_ID);
      expect(combatView(h.world, 1).heldWeapon).toBeNull();
    }
  });

  it('a thief out of the pipe’s reach cannot grab it, even in the window', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival' },
        { s: 100, d: 2.5, role: 'player' },
      ],
      scriptOf({ 0: once(SWING, F.attack), 1: once(SWING + 12, F.attack) }),
      {},
      [PIPE],
    );
    arm(h, 0);
    h.run(SWING + 40);
    expect(grabs(h.events, 'steal')).toHaveLength(0);
    expect(combatView(h.world, 0).heldWeapon).toBe(PIPE_ID);
  });

  it('a grab moves the weapon exactly once: two thieves on the same tick, then a second press', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival' },
        { s: 100, d: 1.2, role: 'player' },
        { s: 100, d: -1.2, role: 'rival' },
      ],
      scriptOf({
        0: once(SWING, F.attack),
        1: (t) => (t === SWING + 10 || t === SWING + 14 ? flags(F.attack) : undefined),
        2: once(SWING + 10, F.attack),
      }),
      {},
      [PIPE],
    );
    const pid = arm(h, 0);
    const counts: number[] = [];
    for (let t = 0; t < SWING + 40; t++) {
      h.run(1);
      counts.push(pipeCount(h, pid));
    }
    const steal = grabs(h.events, 'steal');
    expect(steal).toHaveLength(1);
    // The holder was swinging at rider 1 (the nearer tie is broken by the holder's target first).
    const target = ofType(h.events, 'attackStart').find((e) => e.actor === 0)?.target;
    expect(steal[0]?.actor).toBe(target);
    expect(counts.every((c) => c === 1)).toBe(true);
    const owners = [0, 1, 2].filter((id) => combatView(h.world, id).heldWeapon === PIPE_ID);
    expect(owners).toEqual([steal[0]?.actor]);
  });

  it('a rider already holding a weapon still steals: he drops his own where he is and takes the swung one', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival' },
        { s: 100, d: 1.2, role: 'player' },
      ],
      scriptOf({ 0: once(SWING, F.attack), 1: once(SWING + 10, F.attack) }),
      {},
      [PIPE],
    );
    const swung = arm(h, 0);
    const own = arm(h, 1);
    h.run(SWING + 40);
    const steal = grabs(h.events, 'steal');
    expect(steal).toHaveLength(1);
    expect(steal[0]).toMatchObject({ actor: 1, target: 0 });
    expect(steal[0]?.data).toMatchObject({
      weapon: PIPE_ID,
      source: 'steal',
      windupTick: 10,
      dropped: PIPE_ID,
    });
    // The press stole: it started no swing of his own.
    expect(ofType(h.events, 'attackStart').filter((e) => e.actor === 1)).toHaveLength(0);
    // He holds the swung pipe. His own went down on the road beside him, where the robbed rival,
    // bare-handed now and inside pickup reach, rides over it and takes it (the ordinary road
    // pickup; a cop never picks up, see weapons.test.ts).
    const st = combatState(h.world);
    expect(st.heldPickup[1]).toBe(swung);
    const back = grabs(h.events, 'road').filter((e) => e.tick > SWING);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ actor: 0, target: own, tick: steal[0]?.tick });
    expect(st.heldPickup[0]).toBe(own);
    // Each pipe is in exactly one place.
    expect(pipeCount(h, swung)).toBe(1);
    expect(pipeCount(h, own)).toBe(1);
  });

  it('the same press one tick before the window still swings the held pipe (no steal)', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival' },
        { s: 100, d: 1.2, role: 'player' },
      ],
      scriptOf({ 0: once(SWING, F.attack), 1: once(SWING + 6, F.attack) }),
      {},
      [PIPE],
    );
    arm(h, 0);
    arm(h, 1);
    h.run(SWING + 40);
    expect(grabs(h.events, 'steal')).toHaveLength(0);
    const starts = ofType(h.events, 'attackStart').filter((e) => e.actor === 1);
    expect(starts.map((e) => e.data['weapon'])).toEqual([PIPE_ID]);
  });

  it('the window is counted in scaled time: at timeScale 0.5 it is ticks 14–40 of the wind-up', () => {
    const at = (k: number) => {
      const h = makeHarness(
        [
          { s: 100, d: 0, role: 'rival' },
          { s: 100, d: 1.2, role: 'rival' },
        ],
        scriptOf({ 0: once(SWING, F.attack), 1: once(SWING + k, F.attack) }),
        {},
        [PIPE],
      );
      arm(h, 0);
      h.world.timeScale = 0.5;
      h.run(SWING + 80);
      return grabs(h.events, 'steal').length;
    };
    expect([13, 14, 40, 41].map(at)).toEqual([0, 1, 1, 0]);
  });
});

describe('combat-2: the steal cue', () => {
  it('emits one stealWindow on tick 7 of a held-weapon wind-up, with the swing’s cause id', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival' },
        { s: 100, d: 1.2, role: 'rival' },
      ],
      scriptOf({ 0: once(SWING, F.attack) }),
      {},
      [PIPE],
    );
    arm(h, 0);
    h.run(SWING + 60);
    const cue = ofType(h.events, 'stealWindow');
    expect(cue).toHaveLength(1);
    expect(cue[0]?.tick).toBe(SWING + 7);
    expect(cue[0]?.actor).toBe(0);
    expect(cue[0]?.target).toBe(1);
    expect(cue[0]?.data).toEqual({ weapon: PIPE_ID, ticks: 14 });
    const swing = ofType(h.events, 'attackStart').find((e) => e.actor === 0);
    expect(cue[0]?.causeId).toBe(swing?.causeId);
  });

  it('no cue for a bare-handed punch or kick', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0 },
        { s: 100, d: 1.2 },
      ],
      scriptOf({ 0: (t) => (t === 0 ? flags(F.attack) : t === 40 ? flags(F.attack | F.kick) : undefined) }),
    );
    h.run(100);
    expect(ofType(h.events, 'attackStart')).toHaveLength(2);
    expect(ofType(h.events, 'stealWindow')).toHaveLength(0);
  });
});

describe('combat-2: dropping the weapon on a wreck', () => {
  it('a holder knocked off drops the pipe on the crash tick, and the puncher alongside grabs it', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival', healthMax: 10 },
        { s: 100, d: 1.2, role: 'rival' },
      ],
      scriptOf({ 1: once(3, F.attack) }),
      {},
      [PIPE],
    );
    const pid = arm(h, 0);
    h.run(12);
    const crash = ofType(h.events, 'crash');
    expect(crash.map((e) => [e.tick, e.actor])).toEqual([[10, 0]]);
    // The harness has no tumble phase: health 0 alone makes it a wreck, which drops the pipe, and
    // the empty-handed puncher 1.2 m away picks it up on the same tick.
    expect(combatView(h.world, 0).heldWeapon).toBeNull();
    const road = grabs(h.events, 'road');
    expect(road.map((e) => [e.tick, e.actor])).toEqual([
      [0, 0],
      [10, 1],
    ]);
    expect(combatView(h.world, 1).heldWeapon).toBe(PIPE_ID);
    expect(pipeCount(h, pid)).toBe(1);
  });

  it('a pipe dropped by a tumbling holder lies on the road and a passing rider picks it up', () => {
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'rival' },
        { s: 40, d: 0.5, speed: 30, role: 'rival' },
      ],
      () => undefined,
      {},
      [PIPE],
    );
    const pid = arm(h, 0);
    const holder = h.world.movers[0];
    if (!holder) throw new Error('holder');
    holder.mode = 'Tumble';
    h.run(1);
    expect(combatView(h.world, 0).heldWeapon).toBeNull();
    expect(h.world.movers[pid]?.h).toBe(0);
    expect(h.world.movers[pid]?.pos.s).toBe(100);
    h.run(150);
    const road = grabs(h.events, 'road');
    expect(road.map((e) => [e.actor, e.target])).toEqual([
      [0, pid],
      [1, pid],
    ]);
    expect(combatView(h.world, 1).heldWeapon).toBe(PIPE_ID);
    expect(pipeCount(h, pid)).toBe(1);
  });
});

describe('W-Q: a roadside weapon about every 500 m, laid by the seed', () => {
  const spotsOf = (tuning: Record<string, number> = {}, seed?: number) => {
    const h = makeHarness([{ s: 100, d: 0 }], () => undefined, tuning, [PIPE]);
    if (seed !== undefined) h.config.seed = seed; // (the world's streams were seeded at creation)
    const st = combatState(h.world);
    return st.pickups.map((id) => Math.round((h.world.movers[id]?.pos.s ?? 0) * 100) / 100);
  };

  it('one per spacing of route (at least one), each in the middle half of its stretch', () => {
    expect([pickupCount(7300, 500), pickupCount(2300, 500), pickupCount(120, 500)]).toEqual([15, 5, 1]);
    const spots = spotsOf();
    expect(spots).toHaveLength(2); // the harness route is 960 m
    spots.forEach((s, k) => {
      const lo = 20 + ((k + 0.25) / 2) * 960;
      const hi = 20 + ((k + 0.75) / 2) * 960;
      expect(s).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(s).toBeLessThanOrEqual(hi + 1e-6);
    });
  });

  it('the spacing is a slider: 250 m lays four on the same route', () => {
    expect(spotsOf({ 'combat.pickupSpacingM': 250 })).toHaveLength(4);
  });

  it('the same seed lays them in the same places, and the spots are not the stretch centres', () => {
    const a = spotsOf();
    expect(spotsOf()).toEqual(a);
    expect(a).not.toEqual([260, 740]);
  });
});
