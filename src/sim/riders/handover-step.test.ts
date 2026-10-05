import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureBranchNetwork } from '../../road';
import { input, riderHarness, testConfig } from './testing';

// Playtest 3 (T9.4, Bridge City): two branches leaving a real junction can climb and fall apart
// while still drawn overlapping. The rider-only handover (playtest 1b) moved a rider across onto a
// branch 0.6 m higher, the grounded rider's vertical speed came out as that step over one tick
// (36 m/s), and on the next tick the bike launched off flat road and crashed landing 7 s later.
// A handover is a move between two drawn surfaces, never a launch. The fixture's c-in is lifted
// from the split at `grade`, so 8 m in it stands about 8·grade above c-split.

function harness(grade: number) {
  const f = fixtureBranchNetwork();
  const cin = f.roads.find((r) => r.id === 'c-in') as unknown as {
    sampleSpacingM: number;
    samples: { data: { y: number[] } };
  };
  const ys = cin.samples.data.y;
  ys.forEach((y, i) => (ys[i] = y + grade * i * cin.sampleSpacingM));
  const road = createRoadNetwork(f);
  const route = createRouteProgress(road, f.route);
  const config = { ...testConfig(), road, route };
  // On c-split just past the split, heading right across its edge toward c-in at speed.
  const h = riderHarness(config, { edge: road.edgeIndex('c-split'), s: 2, d: 3.9, speed: 44, yaw: 0.12 });
  return { h, road };
}

/** Rides until the handover, then 10 ticks on: the handover's tick, the step, the jumps after it. */
function ride(grade: number) {
  const { h, road } = harness(grade);
  const cin = road.edgeIndex('c-in');
  let handedAt = -1;
  let step = 0;
  const jumps: number[] = [];
  for (let t = 0; t < 120 && (handedAt < 0 || t <= handedAt + 10); t++) {
    const y0 = road.surfaceHeight(h.rider.pos.edge, h.rider.pos.s, h.rider.pos.d);
    const wasOn = h.rider.pos.edge;
    for (const ev of h.step(input(1, 0, 0))) if (ev.type === 'jump') jumps.push(t);
    if (handedAt < 0 && wasOn !== cin && h.rider.pos.edge === cin) {
      handedAt = t;
      step = road.surfaceHeight(cin, h.rider.pos.s, h.rider.pos.d) - y0;
    }
  }
  return { handedAt, step, jumps };
}

describe('the branch handover never launches the rider (playtest 3, T9.4)', () => {
  it('a handover onto a branch a step above: no jump in the ten ticks after it', () => {
    const r = ride(0.08);
    expect(r.handedAt, 'the rider is handed over').toBeGreaterThanOrEqual(0);
    expect(r.step, 'the control: the step is there').toBeGreaterThan(0.3);
    expect(r.jumps).toEqual([]);
  });

  it('a level handover is unchanged: no jump either', () => {
    const r = ride(0);
    expect(r.handedAt).toBeGreaterThanOrEqual(0);
    expect(Math.abs(r.step)).toBeLessThan(0.05);
    expect(r.jumps).toEqual([]);
  });
});
