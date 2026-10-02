// combat-4's automated acceptance (docs/milestones/M2.md, "combat-4 · Takedowns and slow motion")
// and playtest 1 item 9 (the momentum kick). The combat harness moves riders along s only; a
// stand-in traffic phase plays an oncoming lane (a crash for any riding rider shoved past
// d = CAR_D), and a stand-in tumble phase puts a crashed rider down, as the real ones do in the
// same tick.
import { describe, expect, it } from 'vitest';
import { emit, worldHash, type SimSystem, type World } from '../world';
import {
  F,
  flags,
  makeHarness,
  ofType,
  scriptOf,
  type HarnessOptions,
  type Placement,
} from './harness.test-util';
import { takedownCount } from './index';

const KICK_PRESS = F.attack | F.kick;
const once = (tick: number, f: number) => (t: number) => (t === tick ? flags(f) : undefined);
/** The oncoming lane starts here: a kick from d = -1.8 (3.6 m) carries the target into it. */
const CAR_D = 1.5;
/** A stand-in car's entity id (nothing moves it; the crash only names it). */
const CAR_ID = 99;

const riding = (w: World, id: number) => {
  const m = w.movers[id];
  return m !== undefined && (m.mode === 'Road' || m.mode === 'Airborne');
};

/** Oncoming traffic: a riding rider at d ≥ CAR_D crashes into a car (traffic's event shape). */
const traffic: SimSystem = {
  name: 'traffic',
  init() {},
  step(w) {
    for (const m of w.movers) {
      if (!riding(w, m.id) || m.pos.d < CAR_D) continue;
      const data = {
        cause: 'traffic',
        hazard: 'normal',
        vehicle: 'base:car',
        contact: 'crash',
        hit: 'frontal',
      };
      emit(w, 'crash', m.id, { ...data, impactMps: 30 }, { target: CAR_ID });
    }
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

const STANDINS: HarnessOptions = { systems: { traffic, tumble }, slowMo: true };

/** Player (0) left of rival (1), 1.2 m apart: a kick on tick 0 lands on 13 and shoves 3.6 m right. */
const pair = (a: Partial<Placement> = {}, b: Partial<Placement> = {}): Placement[] => [
  { s: 100, d: -3, role: 'player', ...a },
  { s: 100, d: -1.8, ...b },
];

function kickIntoTraffic(opts: HarnessOptions = STANDINS, placements = pair(), ticks = 200) {
  const h = makeHarness(placements, scriptOf({ 0: once(0, KICK_PRESS) }), {}, [], opts);
  const scales: number[] = [];
  for (let t = 0; t < ticks; t++) {
    h.run(1);
    scales.push(h.world.timeScale);
  }
  return { h, scales };
}

describe('combat-4: takedowns', () => {
  it('a kick into an oncoming car is one traffic takedown, credited to the kicker the tick after the crash', () => {
    const { h } = kickIntoTraffic();
    const crash = ofType(h.events, 'crash');
    expect(crash).toHaveLength(1);
    const td = ofType(h.events, 'takedown');
    expect(td).toHaveLength(1);
    expect(td[0]).toMatchObject({
      actor: 0,
      target: 1,
      tick: crash[0]!.tick + 1,
      causeId: crash[0]!.causeId,
    });
    expect(td[0]?.data['kind']).toBe('traffic');
    expect(takedownCount(h.world, 0)).toBe(1);
    expect(takedownCount(h.world, 1)).toBe(0);
  });

  it('slow motion: one slowmoStart 0 ticks after the takedown and one slowmoEnd 48 ticks later, at 0.3', () => {
    const { h, scales } = kickIntoTraffic();
    const td = ofType(h.events, 'takedown')[0]!;
    const start = ofType(h.events, 'slowmoStart');
    const end = ofType(h.events, 'slowmoEnd');
    expect(start).toHaveLength(1);
    expect(end).toHaveLength(1);
    expect(start[0]).toMatchObject({ tick: td.tick, actor: 0, target: 1, causeId: td.causeId });
    expect(start[0]?.data).toMatchObject({ ticks: 48, timeScale: 0.3 });
    expect(end[0]).toMatchObject({ tick: td.tick + 48, actor: 0, target: 1, causeId: td.causeId });
    // 48 ticks at 0.3 (from the start tick's later phases to the end tick's riders phase), then 1.
    expect(scales.slice(td.tick, td.tick + 48).every((s) => s === 0.3)).toBe(true);
    expect(scales[td.tick + 48]).toBe(1);
    expect(scales[td.tick - 1]).toBe(1);
  });

  it('the snapshot fact counts the raw ticks left and reads 0 once it ends', () => {
    const h = makeHarness(pair(), scriptOf({ 0: once(0, KICK_PRESS) }), {}, [], STANDINS);
    const left: number[] = [];
    for (let t = 0; t < 200; t++) {
      h.run(1);
      left.push(h.world.facts.slowmo.remainingTicks);
    }
    const td = ofType(h.events, 'takedown')[0]!.tick;
    expect(left[td]).toBe(48);
    expect(left[td + 1]).toBe(47);
    expect(left[td + 48]).toBe(0);
    expect(left.slice(td + 48).every((n) => n === 0)).toBe(true);
  });

  it('with the toggle off the same kick is the same takedown, with no slow motion', () => {
    const on = kickIntoTraffic();
    const off = kickIntoTraffic({ ...STANDINS, slowMo: false });
    const pick = (h: typeof on.h) =>
      ofType(h.events, 'takedown').map((e) => [e.tick, e.actor, e.target, e.data['kind']]);
    expect(pick(off.h)).toEqual(pick(on.h));
    expect(ofType(off.h.events, 'slowmoStart')).toHaveLength(0);
    expect(off.scales.every((s) => s === 1 || s === 0)).toBe(true);
    expect(off.h.world.facts.slowmo.remainingTicks).toBe(0);
  });

  it('a rival-against-rival takedown gets no slow motion', () => {
    const { h, scales } = kickIntoTraffic(STANDINS, pair({ role: 'rival' }));
    expect(ofType(h.events, 'takedown')).toHaveLength(1);
    expect(ofType(h.events, 'slowmoStart')).toHaveLength(0);
    expect(scales.every((s) => s === 1)).toBe(true);
  });

  it('a second big takedown inside 480 ticks (8 s) gets no slow motion; one after it does', () => {
    const second = (at: number) => {
      // Rival 2 waits far up the road, then is put beside the player for a kick on tick `at`.
      const h = makeHarness(
        [...pair(), { s: 600, d: -1.8 }],
        scriptOf({ 0: (t) => (t === 0 || t === at ? flags(KICK_PRESS) : undefined) }),
        {},
        [],
        STANDINS,
      );
      h.run(at);
      const m = h.world.movers[2]!;
      m.pos.s = h.world.movers[0]!.pos.s;
      h.run(200);
      return h;
    };
    const soon = second(150);
    const starts = (h: ReturnType<typeof second>) => ofType(h.events, 'slowmoStart').map((e) => e.target);
    expect(ofType(soon.events, 'takedown').map((e) => e.target)).toEqual([1, 2]);
    expect(starts(soon)).toEqual([1]);
    const later = second(520);
    const td = ofType(later.events, 'takedown');
    expect(td.map((e) => e.target)).toEqual([1, 2]);
    expect(td[1]!.tick - td[0]!.tick).toBeGreaterThanOrEqual(480);
    expect(starts(later)).toEqual([1, 2]);
  });

  it('a knock-out by health is a health takedown, with no slow motion', () => {
    const h = makeHarness(
      pair({ d: -2.8 }, { healthMax: 10 }),
      scriptOf({ 0: once(0, F.attack) }),
      {},
      [],
      STANDINS,
    );
    h.run(100);
    const crash = ofType(h.events, 'crash');
    expect(crash.map((e) => e.data['reason'])).toEqual(['knockedOff']);
    const td = ofType(h.events, 'takedown');
    expect(td).toHaveLength(1);
    expect(td[0]).toMatchObject({ actor: 0, target: 1, causeId: crash[0]!.causeId });
    expect(td[0]?.data['kind']).toBe('health');
    expect(ofType(h.events, 'slowmoStart')).toHaveLength(0);
  });

  it('only within 2 s (120 ticks) of the hit; a crash with data.contact tumble is never a takedown', () => {
    /** A punch lands on tick 7; the rival crashes into a car (or a tumble body's contact) on `at`. */
    const crashAt = (at: number, contact: string) => {
      const late: SimSystem = {
        name: 'traffic',
        init() {},
        step(w) {
          if (w.tick !== at) return;
          emit(w, 'crash', 1, { cause: 'traffic', hazard: 'normal', contact }, { target: CAR_ID });
        },
      };
      const h = makeHarness(pair({ d: -2.8 }), scriptOf({ 0: once(0, F.attack) }), {}, [], {
        systems: { traffic: late, tumble },
        slowMo: true,
      });
      h.run(at + 5);
      expect(ofType(h.events, 'hit')[0]?.tick).toBe(7);
      return ofType(h.events, 'takedown');
    };
    expect(crashAt(7 + 120, 'crash')).toHaveLength(1);
    expect(crashAt(7 + 121, 'crash')).toHaveLength(0);
    expect(crashAt(7 + 30, 'tumble')).toHaveLength(0);
    // A non-default window: 1 s.
    const oneS = (at: number) => {
      const late: SimSystem = {
        name: 'traffic',
        init() {},
        step(w) {
          if (w.tick === at) emit(w, 'crash', 1, { cause: 'barrier' }, {});
        },
      };
      const h = makeHarness(
        pair({ d: -2.8 }),
        scriptOf({ 0: once(0, F.attack) }),
        { 'combat.takedownWindowS': 1 },
        [],
        {
          systems: { traffic: late, tumble },
        },
      );
      h.run(at + 5);
      return ofType(h.events, 'takedown');
    };
    expect(oneS(7 + 60).map((e) => e.data['kind'])).toEqual(['scenery']);
    expect(oneS(7 + 61)).toHaveLength(0);
  });

  it('a crash with nobody’s hit behind it is no takedown', () => {
    const h = makeHarness(pair({ d: 1.5 }, { d: 3 }), () => undefined, {}, [], STANDINS);
    h.run(30);
    expect(ofType(h.events, 'crash').length).toBeGreaterThan(0);
    expect(ofType(h.events, 'takedown')).toHaveLength(0);
  });
});

describe('combat-4: hit-stop inside slow motion', () => {
  it('a hit-stop pauses the slow motion, which resumes at 0.3 and ends that many ticks later', () => {
    // After the takedown, rival 2 is put beside the player and punches them during the slow motion
    // (a player-involved hit, so a hit-stop). The player is still recovering from the kick then.
    const h = makeHarness(
      [...pair(), { s: 600, d: -4 }],
      scriptOf({ 0: once(0, KICK_PRESS), 2: once(40, F.attack) }),
      {},
      [],
      STANDINS,
    );
    const scales: number[] = [];
    for (let t = 0; t < 300; t++) {
      if (t === 40) h.world.movers[2]!.pos.s = h.world.movers[0]!.pos.s;
      h.run(1);
      scales.push(h.world.timeScale);
    }
    const start = ofType(h.events, 'slowmoStart')[0]!.tick;
    const end = ofType(h.events, 'slowmoEnd')[0]!.tick;
    const hit = ofType(h.events, 'hit').find((e) => e.actor === 2)!;
    expect(hit.tick).toBeGreaterThan(start);
    expect(hit.tick).toBeLessThan(end);
    const frozen = scales.slice(start, end).filter((s) => s === 0).length;
    expect(frozen).toBe(4); // the punch's 60 ms
    expect(end - start).toBe(48 + frozen);
    // Back to slow motion after the freeze, then full speed after the end.
    expect(scales[hit.tick + 4]).toBe(0.3);
    expect(scales[end]).toBe(1);
  });
});

describe('combat-4: determinism', () => {
  it('a race with slow motion replays to identical hashes', () => {
    const hashes = () => {
      const h = makeHarness(pair(), scriptOf({ 0: once(0, KICK_PRESS) }), {}, [], STANDINS);
      const out: number[] = [];
      for (let t = 0; t < 150; t++) {
        h.run(1);
        out.push(worldHash(h.world));
      }
      expect(ofType(h.events, 'slowmoStart')).toHaveLength(1);
      return out;
    };
    expect(hashes()).toEqual(hashes());
  });
});

describe('combat-4: the momentum kick (playtest 1 item 9)', () => {
  /** Both riding at 20 m/s; the kicker's heading turned `yaw` toward the target (right = +). */
  const shove = (yaw: number, tuning: Record<string, number> = {}) => {
    const h = makeHarness(
      pair({ speed: 20, d: -3.4 }, { speed: 20, d: -2.2 }),
      scriptOf({ 0: once(0, KICK_PRESS) }),
      tuning,
    );
    h.world.movers[0]!.yaw = yaw;
    h.run(90);
    expect(ofType(h.events, 'hit')).toHaveLength(1);
    return h.world.movers[1]!.pos.d + 2.2;
  };

  it('steering into the target while kicking sends it measurably further than a standing kick', () => {
    const standing = shove(0);
    const into = shove(0.25);
    expect(standing).toBeCloseTo(3.6, 6);
    // 20 m/s × sin(0.25) = 4.95 m/s toward the target, × gain 1, adds 4.95 × 0.2 = 0.99 m.
    expect(into - standing).toBeCloseTo(20 * Math.sin(0.25) * 0.2, 6);
    // Steering away adds nothing (it never shortens the kick).
    expect(shove(-0.25)).toBeCloseTo(standing, 9);
  });

  it('is the player’s move: a rival steering into its kick shoves as far as a standing one', () => {
    const rivalKick = (yaw: number) => {
      const h = makeHarness(
        pair({ role: 'rival', speed: 20, d: -3.4 }, { speed: 20, d: -2.2 }),
        scriptOf({ 0: once(0, KICK_PRESS) }),
      );
      h.world.movers[0]!.yaw = yaw;
      h.run(90);
      return h.world.movers[1]!.pos.d + 2.2;
    };
    expect(rivalKick(0.25)).toBeCloseTo(rivalKick(0), 9);
  });

  it('the gain is a slider (0 turns it off) and the extra speed is clamped', () => {
    expect(shove(0.25, { 'combat.momentumKickGain': 0 })).toBeCloseTo(shove(0), 9);
    expect(shove(0.25, { 'combat.momentumKickGain': 1.5 }) - shove(0)).toBeCloseTo(
      1.5 * 20 * Math.sin(0.25) * 0.2,
      6,
    );
    // Clamped at combat.momentumKickMaxMps (8 m/s → at most 1.6 m more).
    expect(shove(0.6, { 'combat.momentumKickGain': 3 }) - shove(0)).toBeCloseTo(8 * 0.2, 6);
  });
});

describe('W-Q: domino credit (a rider you launch who knocks another off is your takedown)', () => {
  /**
   * Tumble's hand-off plus its body contacts, crudely: a rider down for a tick knocks the next
   * rider in `line` off (sim/tumble's crash shape: cause `tumble`, target = the body's rider).
   */
  const dominoTumble = (line: readonly number[]): SimSystem => ({
    name: 'tumble',
    init() {},
    step(w) {
      for (const e of w.events) {
        const m = w.movers[e.actor];
        if (e.type === 'crash' && m && riding(w, m.id)) m.mode = 'Tumble';
      }
      for (let i = 0; i + 1 < line.length; i++) {
        const body = w.movers[line[i] ?? -1];
        const next = w.movers[line[i + 1] ?? -1];
        if (!body || !next || riding(w, body.id) || !riding(w, next.id)) continue;
        const data = { cause: 'tumble', body: 'rider', by: body.id, impactMps: 14 };
        emit(w, 'crash', next.id, data, { target: body.id });
        next.mode = 'Tumble';
        break; // one contact a tick
      }
    },
  });
  const run = (
    line: readonly number[],
    placements: Placement[],
    script = scriptOf({ 0: once(0, KICK_PRESS) }),
  ) => {
    const h = makeHarness(placements, script, {}, [], {
      systems: { traffic, tumble: dominoTumble(line) },
      slowMo: false,
    });
    h.run(200);
    return h;
  };
  /** Out of the car's lane and out of reach: only a flying body takes this rider down. */
  const far = (s: number): Placement => ({ s, d: -5 });

  it('the kicked rider knocks a third off: a DOUBLE takedown for the kicker', () => {
    const h = run([1, 2], [...pair(), far(130)]);
    const td = ofType(h.events, 'takedown');
    expect(td.map((e) => [e.actor, e.target, e.data['domino'] ?? 1])).toEqual([
      [0, 1, 1],
      [0, 2, 2],
    ]);
    expect(td[1]?.data['kind']).toBe('traffic');
    expect(takedownCount(h.world, 0)).toBe(2);
  });

  it('and down the line: the third knocks a fourth off, a STRIKE (chain 3)', () => {
    const h = run([1, 2, 3], [...pair(), far(130), far(160)]);
    const td = ofType(h.events, 'takedown');
    expect(td.map((e) => [e.target, e.data['domino'] ?? 1])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(td.every((e) => e.actor === 0)).toBe(true);
    expect(takedownCount(h.world, 0)).toBe(3);
  });

  it('a body nobody was credited with credits nobody', () => {
    // Rider 1 rides into the car lane on its own (no hit): its body taking rider 2 out is no one's.
    const h = run([1, 2], [{ s: 100, d: -3, role: 'player' }, { s: 100, d: 2 }, far(130)], () => undefined);
    expect(ofType(h.events, 'crash').length).toBeGreaterThanOrEqual(2);
    expect(ofType(h.events, 'takedown')).toEqual([]);
  });
});
