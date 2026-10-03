import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../app';
import type { EntitySnapshot, MoverMode } from '../../sim/api';
import { createEdgeWatch, moverProblem } from './checks';

// The invariant must pass on real movers and fire on broken ones, through the same function the
// browser race and the seeded batch use.
describe('dev/handle: the per-tick mover check', () => {
  const { sim, route } = createHeadlessRace({ seed: 3 });
  const real = sim.snapshot().entities;

  it('passes every mover of a real race on the grid', () => {
    expect(real.length).toBeGreaterThan(0);
    for (const m of real) expect(moverProblem(m, route)).toBeNull();
  });

  it('fires on NaN, an unknown mode, a missing edge and s off the edge', () => {
    const m = real[0] as EntitySnapshot;
    const broken: [string, EntitySnapshot][] = [
      ['NaN speed', { ...m, speed: NaN }],
      ['infinite x', { ...m, x: Infinity }],
      ['unknown mode', { ...m, mode: 'Flying' as EntitySnapshot['mode'] }],
      ['missing edge', { ...m, road: { ...m.road, edge: 999 } }],
      ['fractional edge', { ...m, road: { ...m.road, edge: 0.5 } }],
      ['negative s', { ...m, road: { ...m.road, s: -0.01 } }],
      ['s past the edge', { ...m, road: { ...m.road, s: route.edgeLength(m.road.edge) + 1 } }],
    ];
    for (const [label, b] of broken) expect(moverProblem(b, route), label).not.toBeNull();
  });
});

// The browser race's "the bot never rides back" check (inventory R3, 2026-10-03).
describe('dev/handle: the edge watch', () => {
  type Step = [edge: number, mode: MoverMode];
  const watch = (steps: Step[]) => {
    const w = createEdgeWatch();
    return steps.map(([edge, mode], tick) => w.note(tick, edge, mode)).filter((x) => x !== null);
  };

  it('passes a forward ride, a shortcut rejoin and a ride with no junction', () => {
    expect(
      watch([
        [0, 'Road'],
        [11, 'Road'],
        [12, 'Airborne'],
        [13, 'Road'],
        [4, 'Road'],
        [5, 'Road'],
      ]),
    ).toEqual([]);
    expect(
      watch([
        [0, 'Road'],
        [0, 'Road'],
      ]),
    ).toEqual([]);
  });

  it('passes a crash thrown back across a join, the run back and the forward ride after the remount', () => {
    // Bundle 1's failing race: 0>11>12>13>4>5>4>5 after 9 crashes.
    const crash: Step[] = [
      [4, 'Road'],
      [5, 'Road'],
      [5, 'Tumble'],
      [4, 'Tumble'], // thrown back across the join
      [4, 'OnFoot'],
      [4, 'Road'], // the remount
      [5, 'Road'], // forward again, onto an edge it had been on
    ];
    expect(watch(crash)).toEqual([]);
    // The tumble's flick across a junction and back (the unit bot race's seed 7, edge 8 > 4 > 8).
    expect(
      watch([
        [4, 'Road'],
        [8, 'Road'],
        [4, 'Tumble'],
        [8, 'Tumble'],
        [8, 'Road'],
      ]),
    ).toEqual([]);
  });

  it('fires when the bot rides back onto an edge it had left (handed back facing the wrong way)', () => {
    expect(
      watch([
        [0, 'Road'],
        [11, 'Road'],
        [12, 'Road'],
        [13, 'Road'],
        [4, 'Road'],
        [13, 'Road'],
      ]),
    ).toEqual(['tick 5: rode from edge 4 back onto edge 13']);
    // Riding back through the air counts too.
    expect(
      watch([
        [1, 'Road'],
        [2, 'Airborne'],
        [1, 'Airborne'],
      ]),
    ).toHaveLength(1);
    // After a remount, riding back past where it got up still counts.
    expect(
      watch([
        [1, 'Road'],
        [2, 'Road'],
        [2, 'Tumble'],
        [2, 'OnFoot'],
        [2, 'Road'],
        [1, 'Road'],
      ]),
    ).toHaveLength(1);
  });
});
