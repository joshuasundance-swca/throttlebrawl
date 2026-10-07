// Gaps and the walls a flying rider goes over in the riding model (playtest 3, T3.1; the maintainer,
// 2026-10-03: "In the keys I think the 7 mile bridge has an old road parallel to it. Jumps could let
// you get from one to the other"; round 3: "the real 80 m missing span is the big jump (a miss =
// splash, respawn on the highway)"; "the static one could be used to get to shortcuts"; 2026-10-06:
// "when airborne it was possible to go over and across barriers"). The tumble's side (the water, the
// splash and where the rider wakes) is in sim/tumble/gap.test.ts; the real roads' cases are in
// tests/sim/over-barrier.test.ts.
//
// Every test drives the riding model alone by sim ticks (riderHarness): no wall clock, no frames.
import { describe, expect, it } from 'vitest';
import { GAP_DEFAULTS, type BakedBarrier, type BakedTag } from '../../road';
import { gapBridge, gapFeature, gapSimConfig, GAP_DECK_Y } from '../tumble/gap-fixture';
import type { SimEvent } from '../types';
import { GAP_CLIP_M } from './gap';
import { riderState } from './index';
import { input, riderHarness, type RiderHarness } from './testing';

const ofType = (events: readonly SimEvent[], type: string) => events.filter((e) => e.type === type);

/** Steps at full throttle, straight, until `done` or `max` ticks; returns every event. */
function ride(h: RiderHarness, max: number, done: (events: SimEvent[]) => boolean = () => false): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < max; t++) {
    all.push(...h.step(input(1)));
    if (done(all)) break;
  }
  return all;
}

const firstCrash = (events: SimEvent[]) => events.some((e) => e.type === 'crash');

describe('a gap: no surface under the rider', () => {
  it('a grounded rider who rides into a gap leaves the ground there (a `jump` with data.gap)', () => {
    const h = riderHarness(gapSimConfig(gapBridge({ features: [gapFeature('hole', 200, 230)] })), {
      s: 180,
      d: 1.7,
      speed: 10,
    });
    let jumpS = NaN;
    const events = ride(h, 300, (all) => {
      if (Number.isNaN(jumpS) && all.some((e) => e.type === 'jump')) jumpS = h.rider.pos.s;
      return firstCrash(all);
    });
    const jump = ofType(events, 'jump')[0];
    console.log(`[examined] jump ${JSON.stringify(jump?.data)} at s ${jumpS.toFixed(2)}`);
    expect(jump?.data['gap']).toBe(true);
    // It takes off on the first tick over the gap: within one tick's travel past its start.
    expect(jumpS).toBeGreaterThanOrEqual(200);
    expect(jumpS).toBeLessThan(200 + Number(jump?.data['speed']) / 60 + 0.01);
    expect(ofType(events, 'land')).toHaveLength(0);
  });

  it('past the kill depth it crashes overboard (cause gap), and never lands inside the gap', () => {
    const h = riderHarness(gapSimConfig(gapBridge({ features: [gapFeature('hole', 200, 230)] })), {
      s: 180,
      d: 1.7,
      speed: 10,
    });
    const events = ride(h, 300, firstCrash);
    const crash = ofType(events, 'crash')[0];
    const deck = h.config.road.surfaceHeight(0, h.rider.pos.s, h.rider.pos.d);
    const below = deck - (riderState(h.world).yAbs[h.rider.id] ?? 0);
    console.log(
      `[examined] crash ${JSON.stringify(crash?.data)} at s ${h.rider.pos.s.toFixed(2)}, ${below.toFixed(3)} m below the deck`,
    );
    expect(crash?.data).toMatchObject({ cause: 'gap', overboard: true, feature: 'hole' });
    expect(ofType(events, 'land')).toHaveLength(0);
    expect(h.rider.pos.s).toBeGreaterThan(200);
    expect(h.rider.pos.s).toBeLessThan(230);
    // At the default kill depth, within one tick's fall of it.
    expect(below).toBeGreaterThanOrEqual(GAP_DEFAULTS.killDepthM);
    expect(below).toBeLessThan(GAP_DEFAULTS.killDepthM + 0.2);
    expect(crash?.data['depthM']).toBeCloseTo(below, 6);
  });

  it("takes the gap's own kill depth", () => {
    const h = riderHarness(
      gapSimConfig(gapBridge({ features: [gapFeature('hole', 200, 260, { killDepthM: 3 })] })),
      { s: 180, d: 1.7, speed: 10 },
    );
    const events = ride(h, 300, firstCrash);
    const depth = Number(ofType(events, 'crash')[0]?.data['depthM']);
    console.log(`[examined] killDepthM 3: crash ${depth.toFixed(3)} m below the deck`);
    expect(depth).toBeGreaterThanOrEqual(3);
    expect(depth).toBeLessThan(3.2);
  });

  it('off a 2.0 m / 16 m kicker a fast bike clears a 64 m gap and lands past it; a slow one goes in', () => {
    const bundle = gapBridge({
      kicker: { lipS: 400, heightM: 2, lengthM: 16 },
      features: [gapFeature('moser', 400, 464)],
    });
    const run = (speed: number) => {
      const h = riderHarness(gapSimConfig(bundle), { s: 300, d: 1.7, speed });
      // Up to the crash (here no tumble takes the rider down, so the flight would go on).
      const events = ride(h, 600, firstCrash);
      const land = ofType(events, 'land')[0];
      const crash = ofType(events, 'crash')[0];
      return { h, land, crash, jump: ofType(events, 'jump')[0] };
    };
    const fast = run(38);
    console.log(
      `[examined] 38 m/s: jump ${JSON.stringify(fast.jump?.data)}, land ${JSON.stringify(fast.land?.data)} at tick ${fast.land?.tick}, crash ${JSON.stringify(fast.crash?.data ?? null)}`,
    );
    expect(fast.jump).toBeDefined();
    expect(fast.land).toBeDefined();
    expect(fast.crash).toBeUndefined();
    expect(fast.h.rider.mode).toBe('Road');
    expect(fast.h.rider.pos.s).toBeGreaterThan(464);
    const slow = run(25);
    console.log(`[examined] 25 m/s: crash ${JSON.stringify(slow.crash?.data)}`);
    expect(slow.crash?.data).toMatchObject({ cause: 'gap', overboard: true, feature: 'moser' });
    expect(slow.land).toBeUndefined();
  });

  it(`reaching the far edge more than ${GAP_CLIP_M} m below the deck hits its broken end; less, it lands`, () => {
    // A 10 m hole with no kicker: about 29 m/s at the hole, the bike has dropped about 0.57 m by
    // the far end; at 37 m/s about 0.36 m.
    const bundle = gapBridge({ features: [gapFeature('pothole', 300, 310)] });
    const run = (speed: number) => {
      const h = riderHarness(gapSimConfig(bundle), { s: 280, d: 1.7, speed });
      const events = ride(h, 120, firstCrash);
      return { h, events };
    };
    const slow = run(28);
    const face = ofType(slow.events, 'crash')[0];
    console.log(`[examined] 28 m/s: ${JSON.stringify(face?.data)} at s ${slow.h.rider.pos.s.toFixed(2)}`);
    expect(face?.data).toMatchObject({ cause: 'gap', overboard: true, face: true, feature: 'pothole' });
    expect(Number(face?.data['depthM'])).toBeGreaterThan(GAP_CLIP_M);
    expect(Number(face?.data['depthM'])).toBeLessThanOrEqual(GAP_DEFAULTS.killDepthM);
    // On the last tick over the hole: the next tick's travel takes it past the far end.
    expect(slow.h.rider.pos.s).toBeLessThanOrEqual(310);
    expect(slow.h.rider.pos.s + slow.h.rider.speed / 60).toBeGreaterThan(310);
    const fast = run(37);
    const land = ofType(fast.events, 'land')[0];
    console.log(
      `[examined] 37 m/s: land ${JSON.stringify(land?.data)}, crashes ${ofType(fast.events, 'crash').length}`,
    );
    expect(ofType(fast.events, 'crash')).toHaveLength(0);
    expect(land).toBeDefined();
    expect(fast.h.rider.pos.s).toBeGreaterThan(310);
  });

  it('a rider beside a part-width gap rides on (the box is s0..s1 × d0..d1)', () => {
    const lane = { kind: 'gap', id: 'lane-hole', s0: 200, s1: 230, d0: 0, d1: 8 };
    const h = riderHarness(gapSimConfig(gapBridge({ features: [lane] })), { s: 180, d: -1.7, speed: 15 });
    const events = ride(h, 180);
    expect(ofType(events, 'jump')).toHaveLength(0);
    expect(ofType(events, 'crash')).toHaveLength(0);
    expect(h.rider.pos.s).toBeGreaterThan(230);
  });
});

describe('over the barrier (2026-10-06): a wall holds a flying rider only below its top', () => {
  // The `jumpable` flag is retired into the height rule: it is read and changes nothing.
  const wall = (jumpable: boolean): BakedBarrier[] => [
    { s0: 0, s1: 1500, side: 'left', kind: 'rail', heightM: 1 },
    { s0: 0, s1: 1500, side: 'right', kind: 'wall', heightM: 1.2, ...(jumpable ? { jumpable: true } : {}) },
  ];
  const EDGE = 4.9; // the fixture's outer right shoulder edge
  const LIMIT = EDGE - 0.5; // the riding limit there: half a bike inside it
  /** The sea past the wall's side (road/beyond.ts reads the tags). */
  const SEA: BakedTag[] = [{ s0: 0, s1: 1500, side: 'right', tag: 'water-open' }];

  /** A rider in the air at s 150, `h` above the deck, heading right at the wall. */
  function airborne(
    jumpable: boolean,
    hM: number,
    tags?: BakedTag[],
    tuning?: Readonly<Record<string, number>>,
  ): RiderHarness {
    const bridge = gapBridge({ barriers: wall(jumpable), ...(tags ? { tags } : {}) });
    const config = gapSimConfig(bridge);
    const h = riderHarness(tuning ? { ...config, tuning: { ...config.tuning, ...tuning } } : config, {
      s: 150,
      d: 3.5,
      speed: 25,
      yaw: 0.3,
    });
    const st = riderState(h.world);
    h.rider.mode = 'Airborne';
    st.yAbs[h.rider.id] = GAP_DECK_Y + hM;
    st.vy[h.rider.id] = 3;
    st.airTicks[h.rider.id] = 0;
    return h;
  }

  /** Steps while airborne (or until a crash); the furthest d reached, the events and the d it ends at. */
  function fly(h: RiderHarness): { maxD: number; events: SimEvent[]; endD: number } {
    let maxD = h.rider.pos.d;
    const events: SimEvent[] = [];
    for (let t = 0; t < 180 && h.rider.mode === 'Airborne' && !firstCrash(events); t++) {
      events.push(...h.step(input(1)));
      maxD = Math.max(maxD, h.rider.pos.d);
    }
    return { maxD, events, endD: h.rider.pos.d };
  }

  it('higher than the wall it flies over, jumpable or not; with ground past it (the old rules), it comes down at the edge', () => {
    for (const jumpable of [true, false]) {
      // The old rules: the course's honest edges off (sim/riders/course.ts). With them on, ground past the
      // edge is out of bounds (the next test).
      const { maxD, events, endD } = fly(airborne(jumpable, 3, undefined, { 'riders.courseEdges': 0 }));
      console.log(
        `[examined] jumpable ${jumpable}, 3 m up: furthest d ${maxD.toFixed(2)}, ends at d ${endD.toFixed(2)}, events ${events.map((e) => `${e.type}:${String(e.data['cause'] ?? e.data['quality'])}`).join(',')}`,
      );
      expect(maxD).toBeGreaterThan(EDGE + 1);
      expect(events.filter((e) => e.data['cause'] === 'barrier' || e.data['cause'] === 'over')).toEqual([]);
      // The sim has no ground past the edge: it lands at the band's edge, judged as any landing.
      expect(ofType(events, 'land')).toHaveLength(1);
      expect(endD).toBeCloseTo(LIMIT, 6);
    }
  });

  it("with the course's honest edges (the default), ground past the wall is out of bounds: the quick reset", () => {
    const { maxD, events } = fly(airborne(false, 3));
    const crash = ofType(events, 'crash')[0];
    console.log(
      `[examined] ground past the wall, 3 m up: furthest d ${maxD.toFixed(2)}, crash ${JSON.stringify(crash?.data)}`,
    );
    expect(maxD).toBeGreaterThan(EDGE + 1);
    expect(crash?.data).toMatchObject({
      cause: 'over',
      overboard: true,
      past: 'ground',
      high: false,
      side: 1,
    });
    // Down at the ground's height (the deck's at the crossing), never landed at the band's edge.
    expect(Number(crash?.data['depthM'])).toBeGreaterThanOrEqual(0);
    expect(crash?.data['crossD']).toBeCloseTo(LIMIT, 6);
    expect(ofType(events, 'land')).toEqual([]);
  });

  it('below its height it holds the rider in', () => {
    for (const jumpable of [true, false]) {
      const { maxD } = fly(airborne(jumpable, 0.6));
      console.log(`[examined] jumpable ${jumpable}, 0.6 m up: furthest d ${maxD.toFixed(2)}`);
      expect(maxD).toBeLessThanOrEqual(EDGE);
    }
  });

  it('with the sea past it, over the wall it goes overboard: the drop is the deck down to sea level', () => {
    const { maxD, events } = fly(airborne(false, 3, SEA));
    const crash = ofType(events, 'crash')[0];
    console.log(
      `[examined] the sea past the wall, 3 m up: furthest d ${maxD.toFixed(2)}, crash ${JSON.stringify(crash?.data)}`,
    );
    expect(crash?.data).toMatchObject({
      cause: 'over',
      overboard: true,
      past: 'water',
      high: false,
      side: 1,
    });
    expect(crash?.data['dropM']).toBeCloseTo(GAP_DECK_Y, 6);
    // It fell past the kill depth below the deck at the crossing, never landing on the road's plane.
    expect(crash?.data['depthM']).toBeGreaterThan(GAP_DEFAULTS.killDepthM);
    expect(ofType(events, 'land')).toEqual([]);
  });

  it('a grounded rider meets the wall as a wall', () => {
    const h = riderHarness(gapSimConfig(gapBridge({ barriers: wall(true) })), {
      s: 150,
      d: 3.5,
      speed: 25,
      yaw: 0.3,
    });
    let maxD = h.rider.pos.d;
    for (let t = 0; t < 30; t++) {
      h.step(input(1));
      maxD = Math.max(maxD, h.rider.pos.d);
    }
    console.log(`[examined] grounded: furthest d ${maxD.toFixed(2)}`);
    expect(maxD).toBeLessThanOrEqual(EDGE);
  });
});
