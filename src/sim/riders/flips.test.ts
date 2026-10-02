// Air control, flips and tricks (playtest 2, 2026-10-02: "I love the idea of doing flips"; the brief:
// "in the air the stick or keys pitch and lean the bike", flips and a wheelie-style trick give style
// cash when landed, a flip landed badly wipes you out in a funny way, deterministic and in the
// snapshot). The jumps are the 25 % ramp fixture at 34 m/s: about 1.5 s in the air.
import { describe, expect, it } from 'vitest';
import { PI, TAU } from '../../core';
import { createSim } from '../api';
import { InputFlag, type SimConfig, type SimEvent, type SimInput } from '../types';
import { FLIP_ACCEL, touchdown } from './air';
import { riderState } from './index';
import { input, riderHarness, testConfig } from './testing';

const RAMP = [
  { id: 'runup', lengthM: 200, kappa: 0 },
  { id: 'ramp', lengthM: 16, kappa: 0, grade: 0.25 },
  { id: 'landing', lengthM: 600, kappa: 0 },
];
const SPEED = 34;

/** What the pilot sees each tick in the air. */
interface Air {
  /** Ticks since take-off (0 on the first airborne tick). */
  t: number;
  /** Height above the road, m, and whether the bike is coming down. */
  h: number;
  falling: boolean;
}

interface Pilot {
  /** The input in the air (default: the gas). */
  air?: (a: Air) => SimInput;
  /** The input on the run-up and the ramp (edge 1) (default: the gas to SPEED). */
  ground?: (speed: number, edge: number) => SimInput;
}

const gas = (): SimInput => input(1);
const withFlags = (i: SimInput, flags: number): SimInput => ({ ...i, flags });
const brake = (): SimInput => input(0, 1);
const kick = (): SimInput => withFlags(input(1), InputFlag.kick);

function fly(pilot: Pilot, tuning: Record<string, number> = {}, configure?: (c: SimConfig) => SimConfig) {
  let config = testConfig({ edges: RAMP, tuning });
  if (configure) config = configure(config);
  const h = riderHarness(config, { edge: 0, s: 150, d: 0, speed: SPEED });
  const st = riderState(h.world);
  const events: SimEvent[] = [];
  let t = -1;
  let lastH = 0;
  let maxSpin = 0;
  const tricks = new Set<string>();
  for (let k = 0; k < 60 * 6 && !events.some((e) => e.type === 'land'); k++) {
    const airborne = h.rider.mode === 'Airborne';
    t = airborne ? t + 1 : -1;
    const a = { t, h: h.rider.h, falling: h.rider.h < lastH };
    lastH = h.rider.h;
    const inp = airborne
      ? (pilot.air ?? gas)(a)
      : (pilot.ground ?? ((v: number) => input(v < SPEED ? 1 : 0.6)))(h.rider.speed, h.rider.pos.edge);
    events.push(...h.step(inp));
    maxSpin = Math.max(maxSpin, Math.abs(st.pitchRate[h.rider.id] ?? 0));
    if (st.trick[h.rider.id]) tricks.add(st.trick[h.rider.id] ?? '');
  }
  const land = events.find((e) => e.type === 'land');
  const crash = events.find((e) => e.type === 'crash');
  return { h, st, events, land, crash, maxSpin, tricks };
}

describe('air control: flying level (the forgiving default)', () => {
  it('holding the gas, the bike settles to the ground below and lands clean, no trick', () => {
    const r = fly({});
    expect(r.land?.data['quality']).toBe('clean');
    expect(r.land?.data['trick']).toBe('');
    expect(Math.abs(Number(r.land?.data['pitchOff']))).toBeLessThan(0.1);
    expect(r.crash).toBeUndefined();
    // On the ground again, the bike lies along the road.
    expect(r.st.pitch[r.h.rider.id]).toBe(0);
  });

  it('a tap of the brake or a kick nods the bike and it rights itself', () => {
    for (const tap of [brake, kick]) {
      const r = fly({ air: (a) => (a.t >= 5 && a.t < 12 ? tap() : gas()) });
      expect(r.land?.data['quality']).toBe('clean');
      expect(r.land?.data['trick']).toBe('');
    }
  });

  it('a brake or kick held over the lip does nothing until let go (no accidental flips)', () => {
    for (const held of [brake, kick]) {
      // Held from the foot of the ramp, over the lip and on through the flight.
      const r = fly({
        air: () => held(),
        ground: (v, edge) => (edge === 1 ? held() : input(v < SPEED ? 1 : 0.6)),
      });
      expect(r.land?.data['quality']).toBe('clean');
      expect(r.maxSpin).toBeLessThan(2);
    }
  });

  it('rivals give no air commands: an AI rider braking in the air flies level', () => {
    const r = fly({ air: (a) => (a.t >= 3 ? brake() : gas()) }, {}, (c) => ({
      ...c,
      riders: c.riders.map((d) => ({ ...d, controller: { kind: 'ai' as const, style: 'racer' as const } })),
    }));
    expect(r.land?.data['trick']).toBe('');
    expect(r.maxSpin).toBeLessThan(2);
  });
});

describe('flips', () => {
  it('pull back (the brake) for half a second: a backflip, landed clean, style trick in the land event', () => {
    const r = fly({ air: (a) => (a.t >= 3 && a.t < 33 ? brake() : gas()) });
    expect(r.tricks.has('backflip')).toBe(true);
    expect(r.land?.data['trick']).toBe('backflip');
    expect(r.land?.data['flips']).toBe(1);
    expect(r.land?.data['quality']).not.toBe('crash');
    expect(r.crash).toBeUndefined();
    // Upright again after a full turn, nose up.
    expect(Math.abs(Number(r.land?.data['pitchOff']))).toBeLessThan(0.8);
  });

  it('kick held: a front flip', () => {
    const r = fly({ air: (a) => (a.t >= 3 && a.t < 33 ? kick() : gas()) });
    expect(r.tricks.has('frontflip')).toBe(true);
    expect(r.land?.data['trick']).toBe('frontflip');
    expect(r.land?.data['flips']).toBe(1);
    expect(r.crash).toBeUndefined();
  });

  it('let go short of halfway, the flip rights itself backwards (no trick, no crash)', () => {
    const r = fly({ air: (a) => (a.t >= 3 && a.t < 15 ? brake() : gas()) });
    expect(r.land?.data['trick']).toBe('');
    expect(r.crash).toBeUndefined();
  });

  it('holding the brake into the ground never loops the bike out: it comes down on its wheels', () => {
    // Pulled back from the top of the arc on, and never let go (W-Q0 verifier: this used to land
    // still turning over and wipe the rider out). The bike turns only while it can still right itself.
    for (const held of [brake, kick]) {
      const r = fly({ air: (a) => (a.falling && a.h < 3.2 ? held() : gas()) });
      expect(r.land?.data['quality']).not.toBe('crash');
      expect(r.crash).toBeUndefined();
      expect(Number(r.land?.data['pitchOff'])).toBeLessThan(0.8);
      expect(Number(r.land?.data['pitchOff'])).toBeGreaterThan(-0.35);
    }
  });

  it('a bike that does come down mid-flip (the forecast beaten) wipes the rider out, thrown high', () => {
    // touchdown() judges the attitude alone: half a backflip, upside down on the ground.
    const r = fly({});
    const id = r.h.rider.id;
    r.st.pitch[id] = PI;
    r.st.trick[id] = 'backflip';
    const td = touchdown(r.st, r.h.rider, 0);
    expect(td.crashes).toBe(true);
    expect(td.attempt).toBe('backflip');
    expect(td.throw?.upMps).toBeGreaterThan(3);
  });

  it('a slower bike turns slower (riders.airControl, non-default), and 0 turns air control off', () => {
    const off = fly({ air: (a) => (a.t >= 3 && a.t < 33 ? brake() : gas()) }, { 'riders.airControl': 0 });
    expect(off.land?.data['trick']).toBe('');
    expect(off.maxSpin).toBeLessThan(2);
    const half = fly({ air: (a) => (a.t >= 3 && a.t < 33 ? brake() : gas()) }, { 'riders.airControl': 0.5 });
    expect(half.land?.data['trick']).not.toBe('backflip');
    expect(FLIP_ACCEL).toBeGreaterThan(0);
  });
});

describe('tricks', () => {
  it('nose pulled up for the landing: a wheelie landing, clean', () => {
    const r = fly({ air: (a) => (a.falling && a.h < 1.6 ? brake() : gas()) });
    expect(r.land?.data['trick']).toBe('wheelie');
    expect(r.land?.data['quality']).toBe('clean');
    expect(Number(r.land?.data['pitchOff'])).toBeGreaterThan(0.3);
  });

  it('laid over hard mid-air and straightened before the ground: a whip', () => {
    const r = fly({ air: (a) => (a.t >= 10 && a.t < 40 ? input(1, 0, 1) : gas()) });
    expect(r.tricks.has('whip')).toBe(true);
    expect(r.land?.data['trick']).toBe('whip');
    expect(r.land?.data['quality']).toBe('clean');
  });

  it('landing still laid over is a wobble, not a whip', () => {
    const r = fly({ air: (a) => (a.t >= 10 ? input(1, 0, 1) : gas()) });
    expect(r.land?.data['trick']).toBe('');
    expect(r.land?.data['quality']).toBe('wobble');
  });
});

describe('flips in the whole sim: style cash, the snapshot and replays', () => {
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
    let airT = -1;
    let peakPitch = 0;
    const shown = new Set<string>();
    for (let t = 0; t < 60 * 12; t++) {
      const me = sim.snapshot().entities.find((e) => e.slot === 0);
      airT = me?.mode === 'Airborne' ? airT + 1 : -1;
      sim.step([airT >= 3 && airT < 33 ? brake() : gas()]);
      hashes.push(sim.hash());
      events.push(...sim.events());
      const after = sim.snapshot().entities.find((e) => e.slot === 0);
      if (after?.trick) shown.add(after.trick);
      peakPitch = Math.max(peakPitch, after?.pitch ?? 0);
    }
    return { hashes, events, peakPitch, shown };
  };

  it('scores the backflip as style cash, shows it in the snapshot, and replays to the same hashes', () => {
    const a = run();
    const b = run();
    expect(b.hashes).toEqual(a.hashes);
    const land = a.events.find((e) => e.type === 'land');
    expect(land?.data['trick']).toBe('backflip');
    const trick = a.events.find((e) => e.type === 'style' && e.data['kind'] === 'trick');
    expect(trick?.data['trick']).toBe('backflip');
    // A backflip: 50 airtime cash × the trick scale 2 × 1 turn.
    expect(trick?.data['points']).toBe(100);
    expect(trick?.causeId).toBe(land?.causeId);
    expect(a.shown.has('backflip')).toBe(true);
    // The snapshot's pitch ran the full turn (unwrapped past a half turn and on round).
    expect(a.peakPitch).toBeGreaterThan(PI);
    expect(a.peakPitch).toBeLessThan(TAU + 1);
  });
});
