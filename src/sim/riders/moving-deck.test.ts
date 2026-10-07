// Playtest 3 ("The ramp trucks could be in motion"): a ramp truck with its ramp down is a moving
// deck (SimMovingDeck, published each tick by sim/modifiers). The rule these tests protect is the
// one the maintainer's idea rests on: a rider meets a moving ramp exactly as it would meet a parked
// one at the RELATIVE speed, so the faster you catch the truck, the bigger the air, and a rider
// who is barely faster than the truck meets its body. Stepped by the riding model alone, with the
// deck moved the way traffic and the set piece would (published as the tick starts, then one tick
// on). Driven by sim ticks only.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../../road';
import { MOVING_DECKS_KEY, type SimConfig, type SimEvent, type SimMovingDeck } from '../types';
import { createWorld } from '../world';
import { deckHeight, movingDecks, truckBodyTop, truckClearMps } from './features';
import { input, riderHarness, testConfig } from './testing';

/** The moving carrier's ramp: the parked truck's 13.7° slope, at the size of a 7.5 m tow truck. */
const RUN = 5;
const LIP = (RUN * 2.8) / 11.5;
const LENGTH = 7.5;
const DT = 1 / 60;

/** testConfig's straight (3,000 m), with the given parked features on it. */
function straight(features: BakedFeature[] = []): SimConfig {
  const base = testConfig();
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 3000, kappa: 0 }]);
  const road0 = bundle.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({ ...bundle, roads: [{ ...road0, features }] });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 2980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return { ...base, road, route };
}

/** A deck whose ramp's foot is at `foot` (the truck's rear), travelling along the edge at `speed`. */
function deck(foot: number, speed: number, over: Partial<SimMovingDeck> = {}): SimMovingDeck {
  return {
    vehicle: 99,
    edge: 0,
    s0: foot,
    dir: 1,
    d0: 2.2,
    d1: 4.6,
    speedMps: speed,
    rampLengthM: RUN,
    lipHeightM: LIP,
    bodyM: LENGTH - RUN,
    ...over,
  };
}

interface Ride {
  events: { ev: SimEvent; s: number; deckFoot: number }[];
  trace: { s: number; h: number; mode: string }[];
}

/**
 * One rider at `speed` (held there, so the test is about the deck, not the bike's engine) starting
 * at s with a deck `dir`-facing in front of it, for `ticks` or until a crash.
 */
function rideDeck(opts: {
  from: number;
  d?: number;
  speed: number;
  deck: SimMovingDeck;
  heading?: 1 | -1;
  ticks?: number;
}): Ride {
  const config = straight();
  const h = riderHarness(config, {
    s: opts.from,
    d: opts.d ?? 3.4,
    speed: opts.speed,
    dir: opts.heading ?? 1,
  });
  let live = opts.deck;
  const out: Ride = { events: [], trace: [] };
  for (let t = 0; t < (opts.ticks ?? 60 * 8); t++) {
    h.world.systems[MOVING_DECKS_KEY] = { live: [live] };
    h.rider.speed = opts.speed;
    for (const ev of h.step(input(1))) out.events.push({ ev, s: h.rider.pos.s, deckFoot: live.s0 });
    out.trace.push({ s: h.rider.pos.s, h: h.rider.h, mode: h.rider.mode });
    // The truck drives on: the next tick starts with it one step further.
    live = { ...live, s0: live.s0 + live.dir * live.speedMps * DT };
    if (out.events.some((e) => e.ev.type === 'crash')) break;
  }
  return out;
}

/** The parked truck, same ramp, same size: the reference a moving one is measured against. */
const PARKED: BakedFeature = {
  kind: 'rampTruck',
  id: 'parked',
  s0: 600,
  s1: 600 + LENGTH,
  d0: 2.2,
  d1: 4.6,
  params: { rampLengthM: RUN, lipHeightM: LIP },
};

function rideParked(speed: number): Ride {
  const h = riderHarness(straight([PARKED]), { s: 540, d: 3.4, speed });
  const out: Ride = { events: [], trace: [] };
  for (let t = 0; t < 60 * 8; t++) {
    h.rider.speed = speed;
    for (const ev of h.step(input(1))) out.events.push({ ev, s: h.rider.pos.s, deckFoot: PARKED.s0 });
    out.trace.push({ s: h.rider.pos.s, h: h.rider.h, mode: h.rider.mode });
    if (out.events.some((e) => e.ev.type === 'crash')) break;
  }
  return out;
}

const jumpOf = (r: Ride) => r.events.find((e) => e.ev.type === 'jump')?.ev;
const airTicks = (r: Ride) => r.trace.filter((p) => p.mode === 'Airborne').length;

describe('a moving ramp is met at the relative speed', () => {
  it('launches a rider catching it at 20 m/s of difference the way a parked ramp launches one at 20 m/s', () => {
    // The truck at 18 m/s; the rider 20 m/s faster, 60 m behind its foot.
    const moving = rideDeck({ from: 540, speed: 38, deck: deck(600, 18) });
    const parked = rideParked(20);
    const m = jumpOf(moving);
    const p = jumpOf(parked);
    expect(m, 'a rider catching the moving ramp jumps off its lip').toBeDefined();
    expect(p).toBeDefined();
    const vyMoving = Number(m?.data['vyMps']);
    const vyParked = Number(p?.data['vyMps']);
    console.log(
      `[print] launch rise: ${vyMoving.toFixed(2)} m/s off the moving ramp, ${vyParked.toFixed(2)} off the parked one at the same relative speed; air ${airTicks(moving)} and ${airTicks(parked)} ticks`,
    );
    // The rise follows the relative speed, not the speed over the road (twice as big if it did).
    expect(vyMoving).toBeGreaterThan(vyParked * 0.8);
    expect(vyMoving).toBeLessThan(vyParked * 1.2);
    // And the flight lasts about as long, then lands clean.
    expect(Math.abs(airTicks(moving) - airTicks(parked))).toBeLessThanOrEqual(12);
    const land = moving.events.find((e) => e.ev.type === 'land')?.ev;
    expect(land?.data['quality']).toBe('clean');
    expect(moving.events.filter((e) => e.ev.type === 'crash' || e.ev.type === 'wobble')).toEqual([]);
  });

  it('the bigger the difference in speed, the bigger the air', () => {
    const slow = rideDeck({ from: 540, speed: 30, deck: deck(600, 18) });
    const fast = rideDeck({ from: 540, speed: 38, deck: deck(600, 8) });
    console.log(`[print] air: ${airTicks(slow)} ticks at +12 m/s, ${airTicks(fast)} at +30 m/s`);
    expect(airTicks(fast)).toBeGreaterThan(airTicks(slow));
    expect(airTicks(slow)).toBeGreaterThan(30);
  });

  it('lands on the road past the truck, never on or in it', () => {
    const r = rideDeck({ from: 540, speed: 38, deck: deck(600, 18) });
    const land = r.events.find((e) => e.ev.type === 'land');
    expect(land).toBeDefined();
    // Past the truck's front at the moment of landing (the truck has driven on meanwhile).
    expect(land?.s ?? 0).toBeGreaterThan((land?.deckFoot ?? 0) + LENGTH);
    expect(r.trace.at(-1)?.h).toBe(0);
  });

  it('meets the body, and crashes, when it is too little faster than the truck to clear it', () => {
    const clear = truckClearMps(
      {
        kind: 'rampTruck',
        id: 'x',
        s0: 0,
        s1: LENGTH,
        d0: 0,
        d1: 1,
        params: { rampLengthM: RUN, lipHeightM: LIP },
      },
      9.81,
    );
    expect(clear).toBeGreaterThan(2);
    // 2 m/s faster than the truck: under the clearing speed, whatever the road speed is.
    const r = rideDeck({ from: 596, speed: 20, deck: deck(600, 18) });
    const crash = r.events.find((e) => e.ev.type === 'crash');
    expect(crash?.ev.data).toMatchObject({ cause: 'barrier', object: 'rampTruck' });
    expect(r.events.filter((e) => e.ev.type === 'land')).toEqual([]);
  });

  it('the same road speed clears a parked ramp but meets a truck that is nearly as fast', () => {
    // 20 m/s is plenty over a parked truck, and a crash into one doing 18.
    expect(rideParked(20).events.some((e) => e.ev.type === 'crash')).toBe(false);
    const behind = rideDeck({ from: 596, speed: 20, deck: deck(600, 18) });
    expect(behind.events.some((e) => e.ev.type === 'crash')).toBe(true);
  });

  it('a rider in the next lane is not on the deck: nothing happens as it passes', () => {
    const r = rideDeck({ from: 540, d: -1.7, speed: 38, deck: deck(600, 18) });
    expect(r.events).toEqual([]);
    expect(Math.max(...r.trace.map((p) => p.h))).toBe(0);
  });

  it('a rider who rides into its side is held beside it, as at a parked truck', () => {
    // Keeping pace beside the truck's body (its foot at 590, the body 5.2 to 7.5 m along it), then
    // steering in across its side.
    const config = straight();
    const h = riderHarness(config, { s: 596.5, d: 0.4, speed: 18 });
    let live = deck(590, 18);
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 * 2; t++) {
      h.world.systems[MOVING_DECKS_KEY] = { live: [live] };
      h.rider.speed = 18;
      events.push(...h.step(input(1, 0, 0.6)));
      live = { ...live, s0: live.s0 + live.speedMps * DT };
    }
    const hit = events.find((e) => e.type === 'wobble' || e.type === 'crash');
    expect(hit?.data).toMatchObject({ cause: 'barrier', object: 'rampTruck' });
    // Held outside the deck's side, never inside it.
    expect(h.rider.pos.d).toBeLessThan(2.2);
  });
});

describe('a moving ramp that faces the other way along the edge', () => {
  it('a truck driving toward lower s is ridden up from behind by a rider heading the same way', () => {
    // Foot (rear) at s 2000, the truck driving toward s 0 at 18 m/s; the rider closes at 20 m/s more.
    const r = rideDeck({
      from: 2060,
      speed: 38,
      heading: -1,
      deck: deck(2000, 18, { dir: -1 }),
    });
    expect(jumpOf(r), 'it jumps off the lip').toBeDefined();
    const land = r.events.find((e) => e.ev.type === 'land');
    expect(land?.ev.data['quality']).toBe('clean');
    expect(land?.s ?? 1e9).toBeLessThan((land?.deckFoot ?? 0) - LENGTH);
    expect(r.events.some((e) => e.ev.type === 'crash')).toBe(false);
  });

  it('a rider riding into the truck from the front meets its body at once', () => {
    // Oncoming: the rider heads toward increasing s into a truck driving toward decreasing s.
    const r = rideDeck({ from: 1900, speed: 30, heading: 1, deck: deck(2000, 18, { dir: -1 }) });
    const crash = r.events.find((e) => e.ev.type === 'crash');
    expect(crash?.ev.data).toMatchObject({ cause: 'barrier', object: 'rampTruck' });
    expect(r.events.filter((e) => e.ev.type === 'jump')).toEqual([]);
  });
});

describe('deck geometry', () => {
  const parked = straight([PARKED]);
  const bare = straight();
  // Along a parked truck of the same shape: the ramp, its lip platform and the cab to the front. A parked
  // truck has an empty top deck between its lip platform and its cab; a moving carrier carries nothing,
  // so its cab starts where its lip platform ends (the next test).
  const INTO = [0, 1, RUN / 2, RUN - 0.01, RUN + 0.1, LENGTH - 0.1];

  it('stands the way a parked ramp truck of the same shape stands', () => {
    const world = createWorld(bare);
    world.systems[MOVING_DECKS_KEY] = { live: [deck(PARKED.s0, 20)] };
    const { now } = movingDecks(world, DT);
    for (const into of INTO) {
      const s = PARKED.s0 + into;
      expect(deckHeight(bare, 0, s, 3.4, { moving: now }), `${into} m along`).toBeCloseTo(
        deckHeight(parked, 0, s, 3.4),
        9,
      );
    }
    // Beside it and past it there is nothing.
    expect(deckHeight(bare, 0, PARKED.s0 + 2, -1.7, { moving: now })).toBe(0);
    expect(deckHeight(bare, 0, PARKED.s0 + LENGTH + 0.1, 3.4, { moving: now })).toBe(0);
    expect(deckHeight(bare, 0, PARKED.s0 - 0.1, 3.4, { moving: now })).toBe(0);
  });

  it('has no top deck: a moving carrier carries nothing, so its cab starts where its lip platform ends', () => {
    const world = createWorld(bare);
    world.systems[MOVING_DECKS_KEY] = { live: [deck(PARKED.s0, 20)] };
    const { now } = movingDecks(world, DT);
    const cab = deckHeight(bare, 0, PARKED.s0 + RUN + 1, 3.4, { moving: now });
    expect(cab).toBeCloseTo(truckBodyTop(PARKED), 9);
    expect(cab).toBeGreaterThan(LIP + 0.3);
    // The same distance along a parked truck of that shape is its empty deck, at the lip's height.
    expect(deckHeight(parked, 0, PARKED.s0 + RUN + 1, 3.4)).toBeCloseTo(LIP, 9);
  });

  it('moves with the truck: one tick on, it stands one tick of its travel further', () => {
    const world = createWorld(bare);
    world.systems[MOVING_DECKS_KEY] = { live: [deck(PARKED.s0, 20)] };
    const { now, next } = movingDecks(world, DT);
    for (const into of INTO) {
      const s = PARKED.s0 + into;
      expect(deckHeight(bare, 0, s + 20 * DT, 3.4, { moving: next }), `${into} m along`).toBeCloseTo(
        deckHeight(bare, 0, s, 3.4, { moving: now }),
        9,
      );
    }
  });

  it('mirrors for a truck driving toward lower s: the ramp is at the high-s end', () => {
    const world = createWorld(bare);
    world.systems[MOVING_DECKS_KEY] = { live: [deck(2000, 20, { dir: -1 })] };
    const { now } = movingDecks(world, DT);
    for (const into of INTO) {
      expect(deckHeight(bare, 0, 2000 - into, 3.4, { moving: now }), `${into} m along`).toBeCloseTo(
        deckHeight(parked, 0, PARKED.s0 + into, 3.4),
        9,
      );
    }
  });

  it('is on its own edge only', () => {
    const world = createWorld(bare);
    world.systems[MOVING_DECKS_KEY] = { live: [deck(PARKED.s0, 20, { edge: 1 })] };
    const { now } = movingDecks(world, DT);
    expect(deckHeight(bare, 0, PARKED.s0 + RUN / 2, 3.4, { moving: now })).toBe(0);
    expect(deckHeight(bare, 1, PARKED.s0 + RUN / 2, 3.4, { moving: now })).toBeCloseTo(LIP / 2, 9);
  });

  it('no registry, or an empty one, is no decks at all', () => {
    const world = createWorld(bare);
    expect(movingDecks(world, DT).now).toHaveLength(0);
    world.systems[MOVING_DECKS_KEY] = { live: [] };
    expect(movingDecks(world, DT).next).toHaveLength(0);
  });

  it('leaves the parked truck exactly as it was', () => {
    expect(deckHeight(parked, 0, PARKED.s0 + RUN / 2, 3.4)).toBeCloseTo(LIP / 2, 9);
    expect(truckBodyTop(PARKED)).toBeGreaterThan(LIP);
  });
});
