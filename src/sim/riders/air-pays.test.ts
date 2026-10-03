// Air that pays (the pitch deck's #13, run W-T): "a clean landing after real air gives a short surge
// ... and rivals get the surge too. Land within a bike length of a rival for a heavy hit; it only
// knocks him off if he's already hurt. ... a chalk mark shows where you'll touch down, red if you're
// crooked. On the biggest jumps, a lawn-chair-and-newspaper pose; hold it too long and you land
// holding the newspaper." Every test drives the riding model tick by tick (no wall clock, no
// frames) on the fixture roads; the big jump is the 25 % ramp at 34 m/s (about 1.5 s of air).
import { describe, expect, it } from 'vitest';
import { createSim } from '../api';
import { InputFlag, type SimConfig, type SimEvent, type SimInput } from '../types';
import type { Mover } from '../world';
import { riderState, touchdownOf, RIDERS_TUNING } from './index';
import { input, packHarness, riderHarness, testConfig, type RiderPlacement } from './testing';

const RAMP = [
  { id: 'runup', lengthM: 200, kappa: 0 },
  { id: 'ramp', lengthM: 16, kappa: 0, grade: 0.25 },
  { id: 'landing', lengthM: 600, kappa: 0 },
];
/** A small kicker: about a third of a second in the air. */
const HOP = [
  { id: 'runup', lengthM: 200, kappa: 0 },
  { id: 'ramp', lengthM: 6, kappa: 0, grade: 0.06 },
  { id: 'landing', lengthM: 600, kappa: 0 },
];
const SPEED = 34;

const gas = (): SimInput => input(1);
const cruise = (v: number): SimInput => input(v < SPEED ? 1 : 0.6);
/** The brake and the kick held together: the newspaper on a big jump. */
const paper = (): SimInput => ({ ...input(0, 1), flags: InputFlag.kick });

interface Flight {
  events: SimEvent[];
  land: SimEvent | undefined;
  crash: SimEvent | undefined;
  rider: Mover;
  config: SimConfig;
  tricks: Set<string>;
  /** The rider's speed this many ticks after the landing. */
  speedAfter: number;
  boostAfterLand: number;
}

/** One jump by the player, with `air` the input on each tick in the air (t: ticks since take-off). */
function fly(
  edges = RAMP,
  air: (t: number) => SimInput = gas,
  opts: { tuning?: Record<string, number>; drop?: string[]; yawAt?: { t: number; yaw: number } } = {},
): Flight {
  const config = testConfig(opts.tuning ? { edges, tuning: opts.tuning } : { edges });
  for (const k of opts.drop ?? []) delete (config.tuning as Record<string, number>)[k];
  const h = riderHarness(config, { edge: 0, s: 150, d: 0, speed: SPEED });
  const st = riderState(h.world);
  const events: SimEvent[] = [];
  const tricks = new Set<string>();
  let t = -1;
  let after = -1;
  let boostAfterLand = 0;
  for (let k = 0; k < 60 * 8 && after < 30; k++) {
    const airborne = h.rider.mode === 'Airborne';
    t = airborne ? t + 1 : -1;
    if (airborne && opts.yawAt && t === opts.yawAt.t) h.rider.yaw = opts.yawAt.yaw;
    const out = h.step(airborne ? air(t) : after >= 0 ? gas() : cruise(h.rider.speed));
    events.push(...out);
    if (st.trick[h.rider.id]) tricks.add(st.trick[h.rider.id] ?? '');
    if (after >= 0) after++;
    else if (out.some((e) => e.type === 'land')) {
      after = 0;
      boostAfterLand = st.boost[h.rider.id] ?? 0;
    }
  }
  return {
    events,
    land: events.find((e) => e.type === 'land'),
    crash: events.find((e) => e.type === 'crash'),
    rider: h.rider,
    config,
    tricks,
    speedAfter: h.rider.speed,
    boostAfterLand,
  };
}

const NEW_KEYS = [
  'riders.surgeS',
  'riders.surgeMps',
  'riders.surgeMinAirS',
  'riders.landingHitDamage',
  'riders.landingHitHurtShare',
  'riders.newspaperAirS',
];

describe('air that pays: the landing surge', () => {
  it('a clean landing after real air surges the bike forward', () => {
    const on = fly();
    const off = fly(RAMP, gas, { tuning: { 'riders.surgeS': 0 } });
    expect(on.land?.data['quality']).toBe('clean');
    expect(on.land?.data['surge']).toBe(true);
    expect(on.land?.data['surgeS']).toBe(1);
    expect(on.boostAfterLand).toBe(60);
    expect(off.land?.data['surge']).toBeUndefined();
    // Half a second on, the surged bike is clearly faster than the same landing without it.
    expect(on.speedAfter - off.speedAfter).toBeGreaterThan(2);
  });

  it('a hop under the real-air minimum gives none', () => {
    const r = fly(HOP);
    expect(r.land).toBeDefined();
    expect(Number(r.land?.data['airTicks'])).toBeLessThan(30);
    expect(r.land?.data['surge']).toBeUndefined();
  });

  it('a crooked landing gives none', () => {
    // Knocked 0.2 rad off line a tick before the ground: it lands wobbling, so no surge.
    const solo = fly();
    const airTicks = Number(solo.land?.data['airTicks']);
    const r = fly(RAMP, gas, { yawAt: { t: airTicks - 1, yaw: 0.2 } });
    expect(r.land?.data['quality']).toBe('wobble');
    expect(r.land?.data['surge']).toBeUndefined();
  });

  it('rivals get the surge too', () => {
    const config = testConfig({ edges: RAMP, rivals: 1 });
    const h = packHarness(config, [
      { s: 150, d: -1.5, speed: SPEED },
      { s: 60, d: 1.5, speed: SPEED },
    ]);
    const rivalLand: SimEvent[] = [];
    for (let k = 0; k < 60 * 6 && rivalLand.length === 0; k++) {
      const out = h.step(h.riders.map((m) => cruise(m.speed)));
      rivalLand.push(...out.filter((e) => e.type === 'land' && e.actor === h.riders[0]?.id));
    }
    expect(config.riders[0]?.controller.kind).toBe('ai');
    expect(rivalLand[0]?.data['quality']).toBe('clean');
    expect(rivalLand[0]?.data['surge']).toBe(true);
  });

  it('a race whose tuning leaves the new keys out rides exactly as before', () => {
    const r = fly(RAMP, gas, { drop: NEW_KEYS });
    expect(r.land?.data['quality']).toBe('clean');
    expect(r.land?.data['surge']).toBeUndefined();
    expect(r.boostAfterLand).toBe(0);
  });

  it('declares every new key as a sim tuning parameter', () => {
    const ids = new Set(RIDERS_TUNING.filter((d) => d.affectsSim).map((d) => d.id));
    for (const k of NEW_KEYS) expect(ids.has(k)).toBe(true);
  });
});

/** Where the player comes down off the ramp, alone. */
function landingSpot(): { edge: number; s: number; d: number } {
  const config = testConfig({ edges: RAMP, rivals: 1 });
  const h = packHarness(config, [
    { s: 590, d: 0, edge: 2 },
    { s: 150, d: 0, speed: SPEED },
  ]);
  for (let k = 0; k < 60 * 8; k++) {
    const out = h.step([input(0), cruise(h.riders[1]?.speed ?? 0)]);
    const land = out.find((e) => e.type === 'land' && e.actor === h.riders[1]?.id);
    if (land) {
      const p = h.riders[1]?.pos;
      if (p) return { edge: p.edge, s: p.s, d: p.d };
    }
  }
  throw new Error('never landed');
}

/** The player's jump with a rival parked at `rival` (rider 0 is the rival, rider 1 the player). */
function landNear(rival: RiderPlacement, rivalHealth?: number, tuning: Record<string, number> = {}) {
  const config = testConfig({ edges: RAMP, rivals: 1, tuning });
  const h = packHarness(config, [rival, { s: 150, d: 0, speed: SPEED }]);
  const st = riderState(h.world);
  const rivalId = h.riders[0]?.id ?? -1;
  if (rivalHealth !== undefined) st.health[rivalId] = rivalHealth;
  const events: SimEvent[] = [];
  for (let k = 0; k < 60 * 8 && !events.some((e) => e.type === 'land' && e.actor !== rivalId); k++) {
    events.push(...h.step([input(0), cruise(h.riders[1]?.speed ?? 0)]));
  }
  const hit = events.find((e) => e.type === 'hit');
  const crash = events.find((e) => e.type === 'crash' && e.actor === rivalId);
  return { hit, crash, health: st.health[rivalId] ?? 0, wobble: st.wobble[rivalId] ?? 0, rivalId };
}

describe('air that pays: the landing hit', () => {
  const spot = landingSpot();

  it('lands a heavy hit on a fresh rival within a bike length, but never knocks him off', () => {
    const r = landNear({ ...spot, d: spot.d + 1 });
    expect(r.hit?.data['weapon']).toBe('landing');
    expect(r.hit?.target).toBe(r.rivalId);
    expect(r.hit?.data['damage']).toBe(35);
    expect(r.health).toBe(65);
    expect(r.wobble).toBeGreaterThan(0);
    expect(r.crash).toBeUndefined();
  });

  it('knocks off a rival who is already hurt, credited to the lander', () => {
    const r = landNear({ ...spot, d: spot.d + 1 }, 70);
    expect(r.hit?.data['weapon']).toBe('landing');
    expect(r.crash?.data['reason']).toBe('knockedOff');
    expect(r.crash?.target).toBe(r.hit?.actor);
    expect(r.crash?.causeId).toBe(r.hit?.causeId);
  });

  it('a fresh rival keeps his last point even when the hit is bigger than his health', () => {
    const r = landNear({ ...spot, d: spot.d + 1 }, 90, { 'riders.landingHitDamage': 100 });
    expect(r.health).toBe(1);
    expect(r.crash).toBeUndefined();
  });

  it('a rival more than a bike length away is not touched', () => {
    expect(landNear({ ...spot, d: spot.d + 2.5 }).hit).toBeUndefined();
    expect(landNear({ ...spot, s: spot.s + 3 }).hit).toBeUndefined();
  });

  it('is off with its damage at 0', () => {
    expect(landNear({ ...spot, d: spot.d + 1 }, 70, { 'riders.landingHitDamage': 0 }).hit).toBeUndefined();
  });
});

describe('air that pays: the newspaper', () => {
  it('read on a big jump and folded in time, it is a trick and lands clean', () => {
    const r = fly(RAMP, (t) => (t >= 5 && t < 40 ? paper() : gas()));
    expect(r.tricks.has('newspaper')).toBe(true);
    expect(r.land?.data['quality']).toBe('clean');
    expect(r.land?.data['trick']).toBe('newspaper');
    expect(r.crash).toBeUndefined();
  });

  it('held into the ground, the rider lands holding the newspaper: a crash thrown high', () => {
    const r = fly(RAMP, (t) => (t >= 5 ? paper() : gas()));
    expect(r.land?.data['quality']).toBe('crash');
    expect(r.crash?.data['attempt']).toBe('newspaper');
    expect(r.crash?.data['botched']).toBe(true);
    expect(Number(r.crash?.data['upMps'])).toBeGreaterThan(0);
  });

  it('let go too late to fold it, it still crashes', () => {
    const solo = fly();
    const airTicks = Number(solo.land?.data['airTicks']);
    const r = fly(RAMP, (t) => (t >= 5 && t < airTicks - 5 ? paper() : gas()));
    expect(r.crash?.data['attempt']).toBe('newspaper');
  });

  it('a kick pressed for a few ticks while braking (a fight in the air) never opens it', () => {
    const r = fly(RAMP, (t) => (t % 20 < 4 ? paper() : t % 20 < 10 ? input(0, 1) : gas()));
    expect(r.tricks.has('newspaper')).toBe(false);
    expect(r.crash).toBeUndefined();
  });

  it('on a small jump the same hold does nothing: the bike flies level as before', () => {
    const r = fly(HOP, paper);
    expect(r.tricks.has('newspaper')).toBe(false);
    expect(r.land?.data['quality']).toBe('clean');
    expect(r.land?.data['trick']).toBe('');
  });

  it('is off when its tuning key is left out', () => {
    const r = fly(RAMP, (t) => (t >= 5 ? paper() : gas()), { drop: ['riders.newspaperAirS'] });
    expect(r.tricks.has('newspaper')).toBe(false);
    expect(r.crash).toBeUndefined();
  });
});

describe('air that pays in the whole sim: style cash, the snapshot and replays', () => {
  const run = () => {
    const base = testConfig({ edges: RAMP, start: { road: 'runup', s: 60, dir: 1 } });
    const config: SimConfig = {
      ...base,
      event: {
        ...base.event,
        style: {
          perNearMissCash: 0,
          perAirtimeCash: 50,
          perOncomingSecondCash: 0,
          perTakedownCash: 0,
          takedownComboScale: 0,
          perStealCash: 0,
        },
      },
    };
    const sim = createSim(config);
    const hashes: number[] = [];
    const events: SimEvent[] = [];
    const shown = new Set<string>();
    let marks = 0;
    let airT = -1;
    for (let t = 0; t < 60 * 12; t++) {
      const me = sim.snapshot().entities.find((e) => e.slot === 0);
      airT = me?.mode === 'Airborne' ? airT + 1 : -1;
      sim.step([airT >= 5 && airT < 40 ? paper() : gas()]);
      hashes.push(sim.hash());
      events.push(...sim.events());
      const after = sim.snapshot().entities.find((e) => e.slot === 0);
      if (after?.trick) shown.add(after.trick);
      if (after?.touchdown) marks++;
      if (after?.mode !== 'Airborne') expect(after?.touchdown ?? null).toBeNull();
    }
    return { hashes, events, shown, marks };
  };

  it('scores the newspaper as style cash, shows it and the touch-down, and replays to the same hashes', () => {
    const a = run();
    const b = run();
    expect(b.hashes).toEqual(a.hashes);
    const land = a.events.find((e) => e.type === 'land');
    expect(land?.data['trick']).toBe('newspaper');
    expect(land?.data['surge']).toBe(true);
    const trick = a.events.find((e) => e.type === 'style' && e.data['kind'] === 'trick');
    // The newspaper: 50 airtime cash × the trick scale 2 × 1.5.
    expect(trick?.data['points']).toBe(150);
    expect(a.shown.has('newspaper')).toBe(true);
    expect(a.marks).toBeGreaterThan(60);
  });
});

describe('air that pays: the touch-down forecast (the chalk mark)', () => {
  /** The forecast at tick `at` of the flight, and the real landing point. */
  function forecast(at: number, air: (t: number) => SimInput = gas) {
    const config = testConfig({ edges: RAMP });
    const h = riderHarness(config, { edge: 0, s: 150, d: 0, speed: SPEED });
    let t = -1;
    let seen: ReturnType<typeof touchdownOf> = null;
    let grounded: ReturnType<typeof touchdownOf> | undefined;
    for (let k = 0; k < 60 * 8; k++) {
      const airborne = h.rider.mode === 'Airborne';
      t = airborne ? t + 1 : -1;
      if (!airborne && grounded === undefined) grounded = touchdownOf(h.world, config, h.rider);
      const out = h.step(airborne ? air(t) : cruise(h.rider.speed));
      if (h.rider.mode === 'Airborne' && t + 1 === at) seen = touchdownOf(h.world, config, h.rider);
      if (out.some((e) => e.type === 'land')) {
        const p = config.road.toWorld(h.rider.pos.edge, h.rider.pos.s, h.rider.pos.d, 0);
        return { seen, real: p, grounded };
      }
    }
    throw new Error('never landed');
  }

  it('marks where the bike comes down, to within a metre (about a tick of travel)', () => {
    for (const at of [5, 30, 60]) {
      const { seen, real } = forecast(at);
      expect(seen).not.toBeNull();
      expect(seen?.crooked).toBe(false);
      expect(Math.hypot((seen?.x ?? 0) - real.x, (seen?.z ?? 0) - real.z)).toBeLessThan(1);
      expect(seen?.inS).toBeGreaterThan(0);
    }
  });

  it('is null on the ground', () => {
    expect(forecast(5).grounded).toBeNull();
  });

  it('turns crooked while the newspaper is out', () => {
    const { seen } = forecast(20, (t) => (t >= 5 ? paper() : gas()));
    expect(seen?.crooked).toBe(true);
  });
});
