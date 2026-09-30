import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../app';
import type { EntitySnapshot } from '../../sim/api';
import { moverProblem } from './checks';

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
