import { describe, expect, it } from 'vitest';
import type { SimConfig, SimEvent, SimInput, SimStyleRewards } from '../types';
import type { World } from '../world';
import {
  DRIFT_BETA_MAX,
  DRIFT_BOOST_S,
  DRIFT_DEFAULTS,
  DRIFT_GATE_TICKS,
  DRIFT_TUNING,
  driftBoostMps,
  driftChainMult,
  driftMoves,
  driftOf,
  driftTakeoff,
} from './drift';
import type { RiderState } from './index';
import { input, packHarness, riderHarness, testConfig, type RiderHarness } from './testing';

// Playtest 3: drift as a first-class move ("Braking into a hairpin at speeds makes a nice drift like
// mechanism and we should consider that a first class experience"; interview round 2: a drift meter
// with style cash, chained corners multiplying it, an exit boost). Derived from the scratch spec's
// tests (moves.md §4.2), re-derived in the real riding model: the spec's numbers came from a replica
// of it, and this file says where the real model differs.

/** The Rustbucket 400's handling (packs/base/bikes/rustbucket-400.json), the career's first bike. */
const RUSTBUCKET = {
  contentId: 'base:rustbucket-400',
  topSpeedMps: 44.7,
  accelMps2: 4.9,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
} as const;
const STYLE: SimStyleRewards = {
  perNearMissCash: 0,
  perAirtimeCash: 0,
  perOncomingSecondCash: 0,
  perTakedownCash: 0,
  takedownComboScale: 0,
  perStealCash: 0,
  perDriftSecondCash: 30,
};

/** The spec's fixture: a straight, then a 27 m radius right-hander through 180°, then a straight. */
const R = 27;
const HAIRPIN = [
  { id: 'a', lengthM: 400, kappa: 0 },
  { id: 'b', lengthM: Math.PI * R, kappa: 1 / R },
  { id: 'c', lengthM: 600, kappa: 0 },
];
/** Two 40 m right-handers through 90° each, 40 m apart: a chain. */
const R2 = 40;
const TWO_BENDS = [
  { id: 'a', lengthM: 400, kappa: 0 },
  { id: 'b', lengthM: (Math.PI / 2) * R2, kappa: 1 / R2 },
  { id: 'c', lengthM: 40, kappa: 0 },
  { id: 'd', lengthM: (Math.PI / 2) * R2, kappa: 1 / R2 },
  { id: 'e', lengthM: 900, kappa: 0 },
];

function config(
  edges: typeof HAIRPIN,
  tuning: Record<string, number> = {},
  opts: { rivals?: number } = {},
): SimConfig {
  const c = testConfig({ edges, tuning, rivals: opts.rivals ?? 0 });
  return {
    ...c,
    riders: c.riders.map((r) => ({ ...r, bike: { ...RUSTBUCKET } })),
    event: { ...c.event, style: { ...STYLE } },
  };
}

function riders(world: World): RiderState {
  return world.systems['riders'] as RiderState;
}

/** One tick's input for the scripted rider, from where it is. */
type Script = (h: RiderHarness, t: number) => SimInput;

interface Ride {
  events: SimEvent[];
  /** Per tick: edge, s, d, speed, and the drift's slip and unbanked cash after the step. */
  track: { edge: number; s: number; d: number; speed: number; drift: number; cash: number }[];
}

/**
 * Rides a script on the riding model alone. Like stepWorld, each step's events become the next
 * step's `lastEvents` (the drift reads a wipeout there); `inject` adds events to that list.
 */
function ride(
  h: RiderHarness,
  script: Script,
  ticks: number,
  opts: { inject?: (t: number) => SimEvent[]; until?: (h: RiderHarness) => boolean } = {},
): Ride {
  const events: SimEvent[] = [];
  const track: Ride['track'] = [];
  for (let t = 0; t < ticks; t++) {
    const out = h.step(script(h, t));
    events.push(...out);
    h.world.lastEvents = [...out, ...(opts.inject?.(t + 1) ?? [])];
    const p = h.rider.pos;
    track.push({
      edge: p.edge,
      s: p.s,
      d: p.d,
      speed: h.rider.speed,
      drift: driftOf(h.world, h.rider),
      cash: driftMoves(h.world, h.rider.id).driftCash,
    });
    if (opts.until?.(h)) break;
  }
  return { events, track };
}

const ofType = (events: readonly SimEvent[], type: SimEvent['type']) => events.filter((e) => e.type === type);
const barrier = (events: readonly SimEvent[]) =>
  events.filter((e) => (e.type === 'wobble' || e.type === 'crash') && e.data['cause'] === 'barrier');

/**
 * A rider who rides the line: the dev bot's lane-keeping law (centre of the road here), with the
 * road's bend fed forward. In a bend it keeps at least `floor` of lock toward it, so a drift holds.
 */
function lineLaw(h: RiderHarness, kappa: number, floor: number): number {
  const m = h.rider;
  const law = -0.35 * m.pos.d - 2.5 * m.yaw + (kappa * m.speed * m.speed) / 22;
  return Math.max(-1, Math.min(1, kappa > 0 ? Math.max(floor, law) : law));
}

/**
 * The hairpin script: brake from `vIn` m/s down only in the last `lead` m before the bend, turning
 * in hard (full lock and the brake: the drift's way in), then ride the line through it at a
 * light throttle, and away on the straight after.
 */
function hairpinScript(vIn: number, lead: number): Script {
  return (h) => {
    const p = h.rider.pos;
    const toBend = p.edge === 0 ? 400 - p.s : 0;
    if (p.edge === 0) {
      if (toBend < lead) return input(0, 1, 1);
      return input(h.rider.speed > vIn ? 0 : 0.3, h.rider.speed > vIn ? 1 : 0, lineLaw(h, 0, 0));
    }
    if (p.edge === 1) return input(0.4, 0, lineLaw(h, 1 / R, 0.3));
    return input(1, 0, lineLaw(h, 0, 0));
  };
}

const START = { s: 240, d: -3, speed: 44 };
const pastBend = (h: RiderHarness) => h.rider.pos.edge === 2 && h.rider.pos.s > 120;

describe('drift: the tuning', () => {
  it('declares its keys, the speed floors among them (the critic C5: a tight hairpin can lower them)', () => {
    const ids = DRIFT_TUNING.map((d) => d.id);
    expect(ids).toEqual([
      'riders.drift',
      'riders.driftSteerGain',
      'riders.driftDrag',
      'riders.driftChainS',
      'riders.driftMinMps',
      'riders.driftExitMps',
    ]);
    for (const d of DRIFT_TUNING) expect(d.affectsSim).toBe(true);
    expect(DRIFT_DEFAULTS.minMps).toBe(18);
    expect(DRIFT_DEFAULTS.exitMps).toBe(10);
  });

  it('chains multiply ×1, ×1.5, ×2, ×2.5, then ×3 at most; the exit boost is 2 + 4 × min(1, s / 2.5)', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(driftChainMult)).toEqual([1, 1.5, 2, 2.5, 3, 3, 3]);
    expect(driftBoostMps(0.8)).toBeCloseTo(2 + 4 * (0.8 / 2.5), 12);
    expect(driftBoostMps(2.5)).toBe(6);
    expect(driftBoostMps(9)).toBe(6);
  });
});

describe('drift: into a hairpin', () => {
  it('braking and turning in hard starts a drift once the gate has held (9 ticks)', () => {
    const h = riderHarness(config(HAIRPIN), START);
    let firstReady = -1;
    const script = hairpinScript(44, 10);
    const r = ride(
      h,
      (hh, t) => {
        const cmd = script(hh, t);
        // The entry's conditions: brake and lock held, the bend within 30 m, fast enough.
        if (firstReady < 0 && cmd.brake >= 179 && cmd.steer >= 64 && hh.rider.speed >= 18) firstReady = t;
        return cmd;
      },
      900,
      { until: pastBend },
    );
    const starts = ofType(r.events, 'driftStart');
    console.log(
      `[examined] ${r.track.length} ticks; first tick braking on lock ${firstReady}, driftStart at ` +
        starts
          .map((e) => `${e.tick} (side ${String(e.data['side'])}, ${Number(e.data['speed']).toFixed(1)} m/s)`)
          .join(', '),
    );
    expect(firstReady).toBeGreaterThanOrEqual(0);
    expect(starts).toHaveLength(1);
    const start = starts[0];
    expect(start?.data['side']).toBe(1);
    expect(start?.tick).toBeGreaterThanOrEqual(firstReady + DRIFT_GATE_TICKS - 1);
    expect(start?.tick).toBeLessThanOrEqual(firstReady + DRIFT_GATE_TICKS + 20);
    // The slip points the nose into the bend (right, positive) while it holds.
    const slips = r.track.map((p) => p.drift);
    expect(Math.max(...slips)).toBeGreaterThan(0.2);
    expect(Math.max(...slips)).toBeLessThanOrEqual(DRIFT_BETA_MAX + 1e-9);
    expect(Math.min(...slips)).toBeGreaterThanOrEqual(0);
  });

  it('the drift holds the line at an entry where riding it without one runs wide into the barrier', () => {
    // Re-derived in the real riding model (the spec's replica said 34 m/s; here a 44 m/s approach,
    // braked for the last 10 m, meets the bend near 30 m/s). The same rider and the same script,
    // drift on and off.
    const on = riderHarness(config(HAIRPIN), START);
    const rOn = ride(on, hairpinScript(44, 10), 900, { until: pastBend });
    const off = riderHarness(config(HAIRPIN, { 'riders.drift': 0 }), START);
    const rOff = ride(off, hairpinScript(44, 10), 900, { until: pastBend });
    const span = (r: Ride) => {
      const ds = r.track.filter((p) => p.edge === 1).map((p) => p.d);
      return `${Math.min(...ds).toFixed(2)}..${Math.max(...ds).toFixed(2)}`;
    };
    console.log(
      `[examined] drift on: ${rOn.track.length} ticks to 120 m past the bend, d ${span(rOn)} in it, ` +
        `${barrier(rOn.events).length} barrier events; drift off: ${rOff.track.length} ticks, d ${span(rOff)}, ` +
        `${barrier(rOff.events).length} barrier events (${barrier(rOff.events)
          .map((e) => e.type)
          .join(', ')})`,
    );
    expect(ofType(rOn.events, 'driftStart')).toHaveLength(1);
    expect(barrier(rOn.events)).toEqual([]);
    expect(barrier(rOff.events).length).toBeGreaterThan(0);
    // And it is quicker: the tighter line and the exit boost beat the slide's drag.
    expect(rOn.track.length).toBeLessThan(rOff.track.length);
  });

  it('a clean exit boosts: 2 + 4 × min(1, seconds / 2.5) m/s for 1.2 s, and opens the chain', () => {
    const h = riderHarness(config(HAIRPIN), START);
    const st = riders(h.world);
    const id = h.rider.id;
    let boostAtEnd: { boost: number; boostMps: number } | null = null;
    const r = ride(h, hairpinScript(44, 10), 900, {
      until: (hh) => {
        if (!boostAtEnd && (st.driftSide[id] ?? 0) === 0 && (st.driftWindow[id] ?? 0) > 0) {
          boostAtEnd = { boost: st.boost[id] ?? 0, boostMps: st.boostMps[id] ?? 0 };
        }
        return pastBend(hh);
      },
    });
    const end = ofType(r.events, 'driftEnd')[0];
    console.log(`[examined] driftEnd ${JSON.stringify(end?.data)}; boost then ${JSON.stringify(boostAtEnd)}`);
    expect(end?.data['clean']).toBe(true);
    expect(end?.data['points']).toBe(0);
    const seconds = Number(end?.data['seconds']);
    expect(seconds).toBeGreaterThanOrEqual(0.8);
    expect(Number(end?.data['boostMps'])).toBeCloseTo(driftBoostMps(seconds), 9);
    // Read after the tick the drift ended: the exit's own tick already spent one of the 72.
    expect(boostAtEnd).toEqual({ boost: DRIFT_BOOST_S * 60 - 1, boostMps: driftBoostMps(seconds) });
    // The chain is open, unbanked, and its cash shows on the meter.
    expect(driftMoves(h.world, id).driftChain).toBe(1);
    expect(driftMoves(h.world, id).driftCash).toBeGreaterThan(0);
  });
});

describe('drift: the chain and the meter', () => {
  /** Turn in on the brakes in the last 10 m before each bend, ride the line through, then let go. */
  const chainScript: Script = (h) => {
    const p = h.rider.pos;
    const drifting = (riders(h.world).driftSide[h.rider.id] ?? 0) !== 0;
    const bendAhead = (p.edge === 0 && p.s > 400 - 10) || (p.edge === 2 && p.s > 40 - 10);
    if (bendAhead && !drifting) return input(0, 1, 1);
    if (bendAhead || p.edge === 1 || p.edge === 3) return input(0.6, 0, lineLaw(h, 1 / R2, 0.3));
    if (p.edge === 0 && h.rider.speed > 36) return input(0, 1, lineLaw(h, 0, 0));
    return input(0.6, 0, lineLaw(h, 0, 0));
  };

  it('a second drift soon after a clean exit is link 2 at ×1.5; the chain banks once, 240 ticks after the last exit', () => {
    const h = riderHarness(config(TWO_BENDS), { s: 200, d: 0, speed: 36 });
    const st = riders(h.world);
    const id = h.rider.id;
    const top = RUSTBUCKET.topSpeedMps;
    // The accrual each drifting tick, against the formula without the chain: the ratio is the chain's.
    const ratios: number[][] = [[], []];
    let speedBefore = h.rider.speed;
    let cashBefore = 0;
    const r = ride(
      h,
      (hh, t) => {
        speedBefore = hh.rider.speed;
        cashBefore = st.driftCash[id] ?? 0;
        return chainScript(hh, t);
      },
      1500,
      {
        until: (hh) => {
          const link = st.driftChain[id] ?? 0;
          if ((st.driftSide[id] ?? 0) !== 0 && link >= 1 && link <= 2) {
            const beta = st.driftBeta[id] ?? 0;
            const share = Math.min(1, Math.max(0.3, speedBefore / top));
            const base = (30 * (Math.abs(beta) / DRIFT_BETA_MAX) * share) / 60;
            if (base > 1e-6) ratios[link - 1]?.push(((st.driftCash[id] ?? 0) - cashBefore) / base);
          }
          return hh.rider.pos.edge === 4 && hh.rider.pos.s > 400;
        },
      },
    );
    const starts = ofType(r.events, 'driftStart');
    const ends = ofType(r.events, 'driftEnd');
    const slides = ends.filter((e) => e.data['bank'] !== true);
    const banks = ends.filter((e) => e.data['bank'] === true);
    console.log(
      `[examined] starts ${starts.map((e) => `${e.tick}:chain ${String(e.data['chain'])}`).join(', ')}; ends ` +
        `${ends.map((e) => `${e.tick}:${JSON.stringify(e.data)}`).join(' | ')}; accrual checked on ` +
        `${ratios[0]?.length} ticks of link 1 and ${ratios[1]?.length} of link 2`,
    );
    expect(starts.map((e) => e.data['chain'])).toEqual([1, 2]);
    expect(slides.map((e) => e.data['clean'])).toEqual([true, true]);
    expect(slides.map((e) => e.data['chain'])).toEqual([1, 2]);
    for (const x of ratios[0] ?? []) expect(x).toBeCloseTo(1, 9);
    for (const x of ratios[1] ?? []) expect(x).toBeCloseTo(1.5, 9);
    expect(ratios[0]?.length).toBeGreaterThan(30);
    expect(ratios[1]?.length).toBeGreaterThan(30);
    expect(banks).toHaveLength(1);
    const bank = banks[0];
    const lastExit = slides[1];
    expect(bank?.tick).toBe((lastExit?.tick ?? 0) + DRIFT_DEFAULTS.chainS * 60);
    expect(bank?.data['chain']).toBe(2);
    expect(Number(bank?.data['points'])).toBeGreaterThan(0);
    // The meter shows the chain's cash until it banks, then empties.
    const before = r.track[(bank?.tick ?? 0) - 1];
    expect(before?.cash).toBe(Math.round(Number(bank?.data['points'])));
    expect(driftMoves(h.world, id)).toEqual({ driftS: 0, driftChain: 0, driftCash: 0, driftSide: 0 });
  });

  it('a wobble mid-drift (traffic, say) empties the meter: nothing banks', () => {
    const h = riderHarness(config(HAIRPIN), START);
    const st = riders(h.world);
    const id = h.rider.id;
    let hitAt = -1;
    const r = ride(h, hairpinScript(44, 10), 900, {
      inject: (t) => {
        // Half a second into the drift, a car clips the rider (traffic's wobble, actor the rider).
        if (hitAt < 0 && (st.driftS[id] ?? 0) >= 0.5) {
          hitAt = t;
          st.wobble[id] = 36;
          return [
            { tick: t - 1, type: 'wobble', actor: id, target: 99, data: { cause: 'traffic' }, causeId: 1 },
          ];
        }
        return [];
      },
      until: (hh) => hh.rider.pos.edge === 2 && hh.rider.pos.s > 400,
    });
    const ends = ofType(r.events, 'driftEnd');
    console.log(
      `[examined] wobble injected for tick ${hitAt}; driftEnds ${ends.map((e) => `${e.tick}:${JSON.stringify(e.data)}`).join(' | ')}`,
    );
    expect(hitAt).toBeGreaterThan(0);
    expect(ends[0]?.tick).toBe(hitAt);
    expect(ends[0]?.data['clean']).toBe(false);
    expect(Number(ends[0]?.data['lost'])).toBeGreaterThan(0);
    expect(ends.filter((e) => Number(e.data['points']) > 0)).toEqual([]);
    expect(driftMoves(h.world, id).driftCash).toBe(0);
  });

  it('back on the road after a spell off it with no landing (a crash and a remount), the open chain is lost', () => {
    const h = riderHarness(config(HAIRPIN), START);
    const st = riders(h.world);
    const id = h.rider.id;
    ride(h, hairpinScript(44, 10), 900, { until: () => (st.driftWindow[id] ?? 0) > 0 });
    expect(st.driftChain[id]).toBe(1);
    expect(st.driftCash[id] ?? 0).toBeGreaterThan(0);
    // Down for two seconds (tumble's ticks: the riding model skips him), then put back on the road.
    h.world.tick += 120;
    h.world.lastEvents = [];
    const out = h.step(input(0.5, 0, 0));
    expect(ofType(out, 'driftEnd')).toEqual([]);
    expect(driftMoves(h.world, id)).toEqual({ driftS: 0, driftChain: 0, driftCash: 0, driftSide: 0 });
  });

  it('a slide that left the ground without the take-off hook ends on landing, its chain banked', () => {
    const h = riderHarness(config(HAIRPIN), START);
    const st = riders(h.world);
    const id = h.rider.id;
    ride(h, hairpinScript(44, 10), 900, { until: () => (st.driftS[id] ?? 0) >= 1 });
    // A second in the air (a wheelie's launch off a parked car returns before the take-off hook),
    // then down on the wheels: the landing is in the last tick's events.
    h.world.tick += 60;
    h.world.lastEvents = [
      { tick: h.world.tick - 1, type: 'land', actor: id, data: { quality: 'clean' }, causeId: 1 },
    ];
    const out = h.step(input(0.5, 0, 1));
    const end = ofType(out, 'driftEnd')[0];
    expect(end?.data['clean']).toBe(false);
    expect(Number(end?.data['points'])).toBeGreaterThan(0);
    expect(driftMoves(h.world, id)).toEqual({ driftS: 0, driftChain: 0, driftCash: 0, driftSide: 0 });
  });

  it('a take-off ends the drift there: no boost, and its chain banks at once', () => {
    const h = riderHarness(config(HAIRPIN), START);
    const st = riders(h.world);
    const id = h.rider.id;
    ride(h, hairpinScript(44, 10), 900, { until: () => (st.driftS[id] ?? 0) >= 1 });
    h.world.events = [];
    driftTakeoff(h.world, st, h.rider);
    const end = ofType(h.world.events, 'driftEnd')[0];
    expect(end?.data['clean']).toBe(false);
    expect(end?.data['boostMps']).toBe(0);
    expect(Number(end?.data['points'])).toBeGreaterThan(0);
    expect(driftOf(h.world, h.rider)).toBe(0);
    expect(driftMoves(h.world, id).driftChain).toBe(0);
  });

  it('flicking the bars to the other lock at speed mid-slide is a highside: a wobble, never a crash', () => {
    const h = riderHarness(config(HAIRPIN), START);
    const st = riders(h.world);
    const id = h.rider.id;
    const script = hairpinScript(44, 10);
    const r = ride(
      h,
      (hh, t) => {
        const drifting = (st.driftSide[id] ?? 0) !== 0;
        if (drifting && Math.abs(st.driftBeta[id] ?? 0) > 0.47 && hh.rider.speed > 25)
          return input(0.4, 0, -1);
        return script(hh, t);
      },
      900,
      { until: pastBend },
    );
    const wobbles = ofType(r.events, 'wobble').filter((e) => e.data['cause'] === 'drift');
    console.log(
      `[examined] drift wobbles ${wobbles.map((e) => `${e.tick}:${JSON.stringify(e.data)}`).join(' | ')}`,
    );
    expect(wobbles).toHaveLength(1);
    expect(ofType(r.events, 'crash')).toEqual([]);
    const end = ofType(r.events, 'driftEnd')[0];
    expect(end?.data['clean']).toBe(false);
    expect(Number(end?.data['lost'])).toBeGreaterThan(0);
  });
});

describe('drift: when it never starts', () => {
  it('braking and turning on a straight (no bend ahead) is a drift too: it starts anywhere (playtest 4, P4-8)', () => {
    // Playtest 4 turned the old "no drift on a straight" rule round on purpose: the maintainer
    // chose "Anywhere", so the road's bend is no part of the entry, only speed, brake and bars.
    const h = riderHarness(config(HAIRPIN), { s: 40, d: -3, speed: 40 });
    const r = ride(h, () => input(0, 1, 0.8), 60);
    const starts = ofType(r.events, 'driftStart');
    expect(starts).toHaveLength(1);
    expect(starts[0]?.data['side']).toBe(1);
    expect(r.track.some((p) => p.drift > 0)).toBe(true);
    expect(r.track.some((p) => p.edge !== 0)).toBe(false); // it never reached the bend: a straight
  });

  it('on a straight the meter, the cash and the exit boost still work, and a left drift goes left', () => {
    const h = riderHarness(config(HAIRPIN), { s: 40, d: -3, speed: 40 });
    const r = ride(h, (hh, t) => (t < 70 ? input(0, 1, -0.8) : input(0.3, 0, 0)), 200, {
      until: (hh) => hh.rider.pos.edge !== 0,
    });
    expect(ofType(r.events, 'driftStart')[0]?.data['side']).toBe(-1);
    expect(r.track.some((p) => p.cash > 0)).toBe(true);
    const ends = ofType(r.events, 'driftEnd').filter((e) => e.data['bank'] !== true);
    expect(ends).toHaveLength(1);
    expect(r.events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('a straight is still no drift below the speed floor, without the brake, or without the bars', () => {
    const floor = ride(
      riderHarness(config(HAIRPIN), { s: 40, d: -3, speed: 12 }),
      () => input(0, 1, 0.8),
      60,
    );
    const noBrake = ride(
      riderHarness(config(HAIRPIN), { s: 40, d: -3, speed: 40 }),
      () => input(1, 0, 0.8),
      60,
    );
    const noBars = ride(
      riderHarness(config(HAIRPIN), { s: 40, d: -3, speed: 40 }),
      () => input(0, 1, 0.2),
      60,
    );
    for (const r of [floor, noBrake, noBars]) expect(ofType(r.events, 'driftStart')).toEqual([]);
  });

  it('a stab of the brake shorter than the gate is no drift', () => {
    const h = riderHarness(config(HAIRPIN), START);
    const script = hairpinScript(44, 10);
    let stabbed = 0;
    const r = ride(
      h,
      (hh, t) => {
        const cmd = script(hh, t);
        if (cmd.brake !== 255 || hh.rider.pos.edge !== 0 || 400 - hh.rider.pos.s >= 10) return cmd;
        // Only the first few ticks of the turn-in brake: a stab, not a commitment.
        stabbed++;
        return stabbed < DRIFT_GATE_TICKS - 2 ? cmd : { ...cmd, brake: 0 };
      },
      900,
      { until: pastBend },
    );
    expect(stabbed).toBeGreaterThan(DRIFT_GATE_TICKS);
    expect(ofType(r.events, 'driftStart')).toEqual([]);
  });

  it('off (riders.drift 0) rides exactly as with the key left out', () => {
    const zero = riderHarness(config(HAIRPIN, { 'riders.drift': 0 }), START);
    const c = config(HAIRPIN);
    const tuning = { ...c.tuning };
    for (const d of DRIFT_TUNING) delete tuning[d.id];
    const absent = riderHarness({ ...c, tuning }, START);
    const a = ride(zero, hairpinScript(44, 10), 900, { until: pastBend });
    const b = ride(absent, hairpinScript(44, 10), 900, { until: pastBend });
    expect(a.track.length).toBeGreaterThan(100);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(ofType(a.events, 'driftStart')).toEqual([]);
  });

  it('the speed floor is a tuning key: above the entry speed, no drift', () => {
    const h = riderHarness(config(HAIRPIN, { 'riders.driftMinMps': 35 }), START);
    const r = ride(h, hairpinScript(44, 10), 900, { until: pastBend });
    expect(ofType(r.events, 'driftStart')).toEqual([]);
  });

  it('lowered floors let a walking-pace hairpin drift (the critic C5: Lombard turns at R 5 m)', () => {
    const TIGHT = [
      { id: 'a', lengthM: 400, kappa: 0 },
      { id: 'b', lengthM: Math.PI * 6, kappa: 1 / 6 },
      { id: 'c', lengthM: 200, kappa: 0 },
    ];
    // Turned in short of full lock: below riders.uturnMps (12 m/s) the brake and full lock start a
    // U-turn (sim/riders/uturn.ts), which wins. A Lombard drift event that lowers the floors under
    // it must keep that in mind (T2.6).
    const script: Script = (h) => {
      const p = h.rider.pos;
      if (p.edge === 0 && p.s > 400 - 6) return input(0, 1, 0.7);
      if (p.edge === 0)
        return input(h.rider.speed > 11 ? 0 : 0.3, h.rider.speed > 11 ? 1 : 0, lineLaw(h, 0, 0));
      if (p.edge === 1) return input(0.3, 0, lineLaw(h, 1 / 6, 0.3));
      return input(0.5, 0, lineLaw(h, 0, 0));
    };
    const until = (h: RiderHarness) => h.rider.pos.edge === 2 && h.rider.pos.s > 40;
    const at = { s: 340, d: 0, speed: 11 };
    const plain = ride(riderHarness(config(TIGHT), at), script, 1200, { until });
    const low = ride(
      riderHarness(config(TIGHT, { 'riders.driftMinMps': 6, 'riders.driftExitMps': 3 }), at),
      script,
      1200,
      { until },
    );
    console.log(
      `[examined] R 6 m hairpin from 11 m/s: default floors ${ofType(plain.events, 'driftStart').length} drifts; ` +
        `lowered ${low.events.map((e) => `${e.tick}:${e.type}`).join(', ')}`,
    );
    expect(ofType(plain.events, 'driftStart')).toEqual([]);
    expect(ofType(low.events, 'driftStart')).toHaveLength(1);
  });

  it('an AI rider given the same sticks never drifts', () => {
    const c = config(HAIRPIN, {}, { rivals: 1 });
    const pack = packHarness(c, [
      { s: START.s, d: START.d, speed: START.speed },
      { s: START.s, d: START.d + 6, speed: START.speed },
    ]);
    const ai = pack.riders[0];
    if (!ai) throw new Error('no AI rider');
    const asRider: RiderHarness = { world: pack.world, config: c, rider: ai, step: () => [] };
    const script = hairpinScript(44, 10);
    const events: SimEvent[] = [];
    for (let t = 0; t < 400; t++) {
      const cmd = script(asRider, t);
      events.push(...pack.step([cmd, cmd]));
    }
    expect(events.filter((e) => e.type === 'driftStart' && e.actor === ai.id)).toEqual([]);
    expect(driftOf(pack.world, ai)).toBe(0);
  });
});
