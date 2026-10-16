import { describe, expect, it } from 'vitest';
import { landIntervalPlan, terrainProfilePlan, type TerrainProfileRow } from './land-topology';

const row = (s: number, flat = 4): TerrainProfileRow => [
  { x: 0, y: 4, z: s },
  { x: 4, y: 0, z: s },
  { x: 4 + flat, y: 0, z: s },
  { x: 10, y: -0.4, z: s },
];

describe('landIntervalPlan', () => {
  it('uses a common reach only for an eligible sharp width change', () => {
    expect(landIntervalPlan(24, 6, true)).toEqual({ kind: 'common', reachM: 6, narrow: 1 });
    expect(landIntervalPlan(6, 24, true)).toEqual({ kind: 'common', reachM: 6, narrow: 0 });
    expect(landIntervalPlan(24, 6, false)).toEqual({ kind: 'joined', reach0M: 24, reach1M: 6 });
    expect(landIntervalPlan(0, 24, true)).toEqual({ kind: 'absent' });
  });
});

describe('terrainProfilePlan', () => {
  it('does not simplify or fan across a common-reach break', () => {
    const rows = [row(0), row(2), row(4), row(6), row(8)];
    const plan = terrainProfilePlan(rows, [false, false, false, true, false], 0.02, 128);

    expect(plan.kept).toEqual([true, false, true, true, true]);
    expect(plan.fans).toEqual([
      { from: 0, to: 2, mid: 1 },
      { from: 3, to: 4, mid: 3 },
    ]);
  });

  it('breaks nullable runs and keeps both sides of a flat-band transition', () => {
    const rows = [row(0), row(2), null, row(6, 0), row(8), row(10)];
    const plan = terrainProfilePlan(rows, [], 0.02, 128);

    expect(plan.kept).toEqual([true, true, false, true, true, true]);
    expect(plan.fans).toEqual([
      { from: 0, to: 1, mid: 0 },
      { from: 3, to: 4, mid: 3 },
      { from: 4, to: 5, mid: 4 },
    ]);
  });
});
