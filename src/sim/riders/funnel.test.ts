// Lane drops for riders (W-R multi-lane highways): where the road narrows ahead (a lane that ends,
// a highway into a two-lane road), the edge comes in as a smooth funnel over `riders.laneDropTaperM`
// instead of a wall at the drop: a rider in an outer lane is eased in, with no barrier event, no
// sideways jump and no crash. On a road whose width does not change, riding is exactly as before.
import { describe, expect, it } from 'vitest';
import { highwayLanes, type FixtureEdgeSpec } from '../../road';
import { funnelLimits, ridingLimitsAt } from './funnel';
import { input, riderHarness, testConfig } from './testing';

const HIGHWAY3 = highwayLanes(3, 3.4);

describe('lane drops: the edge funnels in (W-R)', () => {
  it('a rider in the outer lane of a highway that ends is eased onto the two-lane road', () => {
    const edges: FixtureEdgeSpec[] = [
      { id: 'a', lengthM: 600, kappa: 0, lanes: HIGHWAY3 },
      { id: 'b', lengthM: 1400, kappa: 0 },
    ];
    // Outer right lane (R3, d 8.5), riding straight at 35 m/s, 250 m before the drop.
    const h = riderHarness(testConfig({ edges }), { s: 350, d: 8.5, speed: 35 });
    const events: string[] = [];
    let maxJump = 0;
    let crossed = NaN;
    for (let t = 0; t < 12 * 60 && Number.isNaN(crossed); t++) {
      const d0 = h.rider.pos.d;
      const e0 = h.rider.pos.edge;
      for (const e of h.step(input(1))) events.push(e.type);
      if (h.rider.pos.edge === e0) maxJump = Math.max(maxJump, Math.abs(h.rider.pos.d - d0));
      if (h.rider.pos.edge === 1) crossed = h.rider.pos.d;
    }
    console.log(`lane drop: events ${JSON.stringify(events)}, largest sideways step ${maxJump.toFixed(3)} m`);
    expect(events.filter((e) => e === 'wobble' || e === 'crash')).toEqual([]);
    // Inside the two-lane road's limits when it gets there, and never a jump bigger than a fast swerve.
    expect(crossed).toBeLessThanOrEqual(4.9 - 0.5 + 1e-9);
    expect(maxJump).toBeLessThan(0.35);
    expect(h.rider.speed).toBeGreaterThan(30);
  });

  it('a rider riding back the wrong way off a highway is eased in too', () => {
    const edges: FixtureEdgeSpec[] = [
      { id: 'a', lengthM: 1400, kappa: 0 },
      { id: 'b', lengthM: 600, kappa: 0, lanes: HIGHWAY3 },
    ];
    // On b, heading back toward a (dir -1), in b's outermost lane on the +d side.
    const h = riderHarness(testConfig({ edges }), { edge: 1, s: 300, d: 8.5, dir: -1, speed: 30 });
    const events: string[] = [];
    let maxJump = 0;
    for (let t = 0; t < 12 * 60 && h.rider.pos.edge === 1; t++) {
      const d0 = h.rider.pos.d;
      for (const e of h.step(input(1))) events.push(e.type);
      if (h.rider.pos.edge === 1) maxJump = Math.max(maxJump, Math.abs(h.rider.pos.d - d0));
    }
    expect(h.rider.pos.edge).toBe(0);
    expect(events.filter((e) => e === 'wobble' || e === 'crash')).toEqual([]);
    expect(Math.abs(h.rider.pos.d)).toBeLessThanOrEqual(4.4 + 1e-9);
    expect(maxJump).toBeLessThan(0.35);
  });

  it('eases toward the riding limits: with off-road on, the verge edge, not the lanes', () => {
    const edges: FixtureEdgeSpec[] = [
      { id: 'a', lengthM: 600, kappa: 0, lanes: HIGHWAY3 },
      { id: 'b', lengthM: 1400, kappa: 0 },
    ];
    const road = testConfig({ edges }).road;
    // 10 m before the drop: off, the edge is nearly in to the two-lane road's lanes (4.4 m less half a
    // bike: 4.9 - 0.5); on, untagged roads have a sand band past the lanes (cross-section defaults),
    // so the edge eases toward that band's outer edge instead and a rider at d 9 is left alone.
    const at = { edge: 0, s: 590, d: 9, dir: 1 as const };
    const off = funnelLimits(road, 90, at, ridingLimitsAt(road, { 'ground.offRoad': 0 }, 0.5));
    const on = funnelLimits(road, 90, at, ridingLimitsAt(road, { 'ground.offRoad': 1 }, 0.5));
    expect(off?.hi).toBeLessThan(5.5);
    expect(on === null || on.hi > 9).toBe(true);
  });

  it('on a road whose width never changes, riding into the wall is exactly as with the funnel off', () => {
    const trace = (tuning: Record<string, number>) => {
      const h = riderHarness(testConfig({ tuning }), { s: 400, d: 2, speed: 30 });
      const out: (number | string)[] = [];
      for (let t = 0; t < 3 * 60; t++) {
        for (const e of h.step(input(1, 0, t < 60 ? 1 : -0.4))) out.push(e.type);
        out.push(h.rider.pos.s, h.rider.pos.d, h.rider.yaw, h.rider.speed);
      }
      return out;
    };
    const on = trace({});
    expect(on).toContain('wobble');
    expect(on).toEqual(trace({ 'riders.laneDropTaperM': 0 }));
  });
});
