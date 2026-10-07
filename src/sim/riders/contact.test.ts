// Playtest 1 item 6 (scratch rules, [decided] 2026-09-30): "Riders clip through each other → solid
// bumps plus shoving." Riders can't overlap; side contact pushes both apart and wobbles them, so a
// player can bump a rival toward traffic; a rear bump trades speed without a bounce, and a hard one
// crashes the rider who ran into the other.
import { describe, expect, it } from 'vitest';
import { createSim } from '../api';
import type { SimConfig, SimEvent } from '../types';
import {
  BUMP_CLOSING_MPS,
  RIDER_BODY_HEIGHT_M,
  RIDER_CONTACT_HALF_WIDTH_M,
  RIDER_HALF_LENGTH_M,
  riderContacts,
} from './contact';
import { riderState } from './index';
import { input, packHarness, testConfig, type PackHarness } from './testing';

const WIDTH = 2 * RIDER_CONTACT_HALF_WIDTH_M;
const LENGTH = 2 * RIDER_HALF_LENGTH_M;

function overlapping(h: PackHarness): boolean {
  const [a, b] = h.riders;
  if (!a || !b || a.pos.edge !== b.pos.edge) return false;
  return Math.abs(a.pos.s - b.pos.s) < LENGTH - 1e-9 && Math.abs(a.pos.d - b.pos.d) < WIDTH - 1e-9;
}

const bumps = (events: readonly SimEvent[]) =>
  events.filter((e) => (e.type === 'wobble' || e.type === 'crash') && e.data['cause'] === 'rider');

/** Two riders: index 0 an AI rival, index 1 the player (inputs are given directly). */
function pair(overrides: (c: SimConfig) => SimConfig = (c) => c): SimConfig {
  return overrides(testConfig({ rivals: 1 }));
}

describe('playtest 1 item 6: riders bump instead of clipping', () => {
  it('separates two riders who bump side by side at once, and wobbles both with one event each', () => {
    // The player swings into the rival: about 25 · sin(0.15) = 3.7 m/s across.
    const h = packHarness(pair(), [
      { s: 100, d: 1.2, speed: 25 },
      { s: 100, d: 1.7, speed: 25, yaw: -0.15 },
    ]);
    const events = h.step([input(0.6), input(0.6)]);
    expect(overlapping(h)).toBe(false);
    const hits = bumps(events);
    expect(hits.map((e) => [e.type, e.actor, e.target])).toEqual([
      ['wobble', 0, 1],
      ['wobble', 1, 0],
    ]);
    expect(Number(hits[0]?.data['closingMps'])).toBeGreaterThanOrEqual(BUMP_CLOSING_MPS);
    const st = riderState(h.world);
    expect(st.wobble[0]).toBeGreaterThan(0);
    expect(st.wobble[1]).toBeGreaterThan(0);
    // The shove keeps them moving apart after the overlap is gone: past a plain separation.
    for (let t = 0; t < 30; t++) h.step([input(0.6), input(0.6)]);
    const [a, b] = h.riders;
    expect((b?.pos.d ?? 0) - (a?.pos.d ?? 0)).toBeGreaterThan(WIDTH + 0.4);
  });

  it('eases two riders rubbing shoulders apart without a wobble (a pack is not a pile-up)', () => {
    const h = packHarness(pair(), [
      { s: 100, d: 1.2, speed: 25 },
      { s: 100, d: 1.7, speed: 25 },
    ]);
    const events = h.step([input(0.6), input(0.6)]);
    expect(overlapping(h)).toBe(false);
    expect(bumps(events)).toEqual([]);
    const st = riderState(h.world);
    expect(st.wobble[0]).toBe(0);
    expect(st.wobble[1]).toBe(0);
    for (let t = 0; t < 30; t++) h.step([input(0.6), input(0.6)]);
    const [a, b] = h.riders;
    expect((b?.pos.d ?? 0) - (a?.pos.d ?? 0)).toBeGreaterThanOrEqual(WIDTH);
  });

  it('never lets a rider steering into another overlap it, and a long scrape emits one bump each', () => {
    const h = packHarness(pair(), [
      { s: 100, d: 0.2, speed: 25 },
      { s: 100, d: 1.7, speed: 25 },
    ]);
    const events: SimEvent[] = [];
    for (let t = 0; t < 180; t++) {
      // The rival holds its line; the player keeps steering left, into it.
      events.push(...h.step([input(0.6), input(0.6, 0, -0.6)]));
      expect(overlapping(h), `tick ${t}`).toBe(false);
    }
    const byPair = bumps(events).filter((e) => e.type === 'wobble');
    expect(byPair.length).toBeGreaterThanOrEqual(2); // at least the first bump, one event each
    // Contacts separated by at least one tick apart count again, but a held scrape does not spam.
    expect(byPair.length).toBeLessThan(20);
  });

  it('lets the player bump a rival toward the oncoming lane (further than the overlap alone)', () => {
    const run = (bump: boolean) => {
      const h = packHarness(pair(), [
        { s: 100, d: 0.9, speed: 25 },
        { s: 100, d: bump ? 2 : 4, speed: 25 },
      ]);
      for (let t = 0; t < 45; t++) h.step([input(0.6), input(0.6, 0, bump && t < 12 ? -1 : 0)]);
      return h.riders[0]?.pos.d ?? 0;
    };
    const alone = run(false);
    const bumped = run(true);
    // Overlap alone would move the rival a few centimetres; the shove carries it well over.
    expect(bumped).toBeLessThan(alone - 0.6);
  });

  it('moves the heavier rider less', () => {
    const heavyRival = pair((c) => ({
      ...c,
      riders: c.riders.map((r, i) => (i === 0 ? { ...r, massKg: 200 } : r)),
    }));
    const h = packHarness(heavyRival, [
      { s: 100, d: 1.2, speed: 25 },
      { s: 100, d: 1.7, speed: 25 },
    ]);
    for (let t = 0; t < 30; t++) h.step([input(0.6), input(0.6)]);
    const moved = h.riders.map((m, i) => Math.abs(m.pos.d - [1.2, 1.7][i]!));
    expect(moved[0]).toBeLessThan(moved[1]! * 0.8);
  });

  it('a rear bump trades speed with no bounce, and both wobble', () => {
    const h = packHarness(pair(), [
      { s: 101.5, d: 1.7, speed: 20 },
      { s: 100, d: 1.7, speed: 26 },
    ]);
    const events = h.step([input(0.5), input(0.5)]);
    expect(overlapping(h)).toBe(false);
    const [front, rear] = h.riders;
    expect(rear!.pos.s).toBeLessThan(front!.pos.s);
    // Inelastic: the rear rider is no faster than the front one, and neither goes backwards.
    expect(rear!.speed).toBeLessThanOrEqual(front!.speed + 1e-9);
    expect(front!.speed).toBeGreaterThan(20);
    expect(rear!.speed).toBeGreaterThan(20);
    expect(bumps(events).map((e) => e.type)).toEqual(['wobble', 'wobble']);
  });

  it('glances a rider who runs into the back of a slower one aside, so it gets past (no steering)', () => {
    // A rider holding full throttle and no steering behind a slower one: M1 rode straight through;
    // a solid bump that held it behind for good would stall a rider who doesn't weave.
    const h = packHarness(pair(), [
      { s: 110, d: 1.7, speed: 20 },
      { s: 100, d: 1.7, speed: 30 },
    ]);
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 * 6; t++) {
      events.push(...h.step([input(0.35), input(1)]));
      expect(overlapping(h), `tick ${t}`).toBe(false);
    }
    const [front, rear] = h.riders;
    expect(rear!.pos.s).toBeGreaterThan(front!.pos.s + 5);
    expect(bumps(events).length).toBeGreaterThanOrEqual(2);
    expect(bumps(events).every((e) => e.type === 'wobble')).toBe(true);
  });

  it('leaves a rider who is tumbling alone', () => {
    const h = packHarness(pair(), [
      { s: 100, d: 1.2, speed: 25 },
      { s: 100, d: 1.7, speed: 25 },
    ]);
    const [a] = h.riders;
    a!.mode = 'Tumble';
    expect(bumps(h.step([input(0.6), input(0.6)]))).toEqual([]);
  });

  it('scales the shove with the lower overall speed (m 0.6 moves the same distance, slower)', () => {
    const apart = (m: number) => {
      const h = packHarness({ ...pair(), speedMultiplier: m }, [
        { s: 100, d: 1.2, speed: 25 * m },
        { s: 100, d: 1.7, speed: 25 * m },
      ]);
      for (let t = 0; t < Math.round(60 / m); t++) h.step([input(0.6), input(0.6)]);
      return (h.riders[1]?.pos.d ?? 0) - (h.riders[0]?.pos.d ?? 0);
    };
    expect(apart(0.6)).toBeCloseTo(apart(1), 1);
  });

  it('a scripted bumping race hashes the same every run', () => {
    const run = () => {
      const sim = createSim(testConfig({ rivals: 2 }));
      const hashes: number[] = [];
      for (let t = 0; t < 600; t++) {
        sim.step([input(1, 0, t % 120 < 60 ? -0.5 : 0.5)]);
        hashes.push(sim.hash());
      }
      return hashes;
    };
    expect(run()).toEqual(run());
  });
});

describe('supports: riders meet only within a rider’s height of each other', () => {
  /** Two riding bikes side by side and overlapping, one `h` m up (on a truck's roof), met once. */
  function stacked(h: number, gap: number | undefined) {
    // The second swings into the first at about 20 · sin(0.15) = 3 m/s across: a bump on the road.
    const hh = packHarness(pair(), [
      { s: 100, d: 1.2, speed: 20 },
      { s: 100, d: 1.6, speed: 20, yaw: -0.15 },
    ]);
    const [a, b] = hh.riders;
    if (!a || !b) throw new Error('no riders');
    b.h = h;
    hh.world.events = [];
    riderContacts(hh.world, hh.config, riderState(hh.world), {
      wobbleTicks: 36,
      limits: () => ({ lo: -10, hi: 10 }),
      ...(gap !== undefined ? { heightGapM: gap } : {}),
    });
    return { events: bumps(hh.world.events), apart: Math.abs(b.pos.d - a.pos.d) };
  }

  it('one 3.4 m up passes over one on the road; at the same height (or with no gap given) they bump', () => {
    const over = stacked(3.4, RIDER_BODY_HEIGHT_M);
    const level = stacked(0, RIDER_BODY_HEIGHT_M);
    const before = stacked(3.4, undefined);
    console.log(
      `[examined] bumps: 3.4 m apart in height ${over.events.length}, level ${level.events.length}, no gap given ${before.events.length}`,
    );
    expect(over.events).toEqual([]);
    expect(over.apart).toBeCloseTo(0.4, 9);
    expect(level.events).toHaveLength(2);
    expect(before.events).toHaveLength(2);
  });
});
