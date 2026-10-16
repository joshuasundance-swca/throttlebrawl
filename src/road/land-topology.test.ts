import { describe, expect, it } from 'vitest';
import * as topology from './land-topology';
import {
  landIntervalPlan,
  landWidthChangeOverRoad,
  terrainProfilePlan,
  type TerrainProfileRow,
} from './land-topology';

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

  it('detects only covered points in the omitted unequal-width wedge', () => {
    const seen: [number, number][] = [];
    const covered = landWidthChangeOverRoad(0, 2, 14, 20, 1, (s, d) => {
      seen.push([s, d]);
      return s === 1 && d === 17;
    });

    expect(covered).toBe(true);
    expect(seen).toContainEqual([1, 17]);
    expect(seen.every(([, d]) => d > 14)).toBe(true);
    expect(landWidthChangeOverRoad(0, 2, 24, 6, 1, () => false)).toBe(false);
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

describe('endpoint terrain joins', () => {
  it('retains the canonical zero-width flat point and joins a mixed flat without degenerate faces', () => {
    const a = topology.terrainEndProfile({ x: -2, y: 4, z: 0 }, row(0, 0)!);
    const b = topology.terrainEndProfile({ x: -2, y: 4, z: 1 }, row(1)!);
    expect(a).toHaveLength(b.length);
    expect(a[2]).toEqual(a[3]);
    const triangles = topology.landJoinTriangles(
      { level: 3, points: a },
      { level: 3, points: b },
      1,
      [a[1]!, b[1]!],
      -0.4,
    );
    expect(triangles.some((t) => t.includes(a[2]!) && t.includes(b[2]!))).toBe(true);
    for (const [p, q, r] of triangles) {
      const cross = [
        (q.y - p.y) * (r.z - p.z) - (q.z - p.z) * (r.y - p.y),
        (q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z),
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x),
      ];
      expect(cross.some((v) => v !== 0)).toBe(true);
    }
  });

  it.each([-1, 1] as const)(
    'keeps the existing quad diagonal and winding for equal profiles on side %s',
    (side) => {
      for (const flat of [0, 4]) {
        const canonicalA = topology.terrainEndProfile({ x: -2, y: 4, z: 0 }, row(0, flat)!);
        const canonicalB = topology.terrainEndProfile({ x: -2, y: 4, z: 1 }, row(1, flat)!);
        const a = canonicalA.filter((_, i) => flat > 0 || i !== 3);
        const b = canonicalB.filter((_, i) => flat > 0 || i !== 3);
        const expected = a.slice(0, -1).flatMap((_, k) => {
          const lo = side > 0 ? k : k + 1,
            hi = side > 0 ? k + 1 : k;
          return [
            [a[lo], a[hi], b[lo]],
            [a[hi], b[hi], b[lo]],
          ];
        });
        expect(
          topology.landJoinTriangles(
            { level: 3, points: canonicalA },
            { level: 3, points: canonicalB },
            side,
            [a[1]!, b[1]!],
            -0.4,
          ),
        ).toEqual(expected);
      }
    },
  );

  it('preserves absent/height-ineligible joins and unequal-profile retaining curtains', () => {
    const a = [
      { x: 0, y: 4, z: 0 },
      { x: 4, y: 4, z: 0 },
    ];
    const b = [
      { x: 0, y: 4, z: 1 },
      { x: 4, y: 4, z: 1 },
      { x: 8, y: -0.4, z: 1 },
    ];
    expect(
      topology.landJoinTriangles({ level: 0, points: [] }, { level: 2, points: b }, 1, [a[1]!, b[1]!], -0.4),
    ).toEqual([]);
    expect(
      topology.landJoinTriangles(
        { level: 1, points: a },
        { level: 2, points: b.map((p) => ({ ...p, y: p.y + 0.51 })) },
        1,
        [a[1]!, b[1]!],
        -0.4,
      ),
    ).toEqual([]);
    const triangles = topology.landJoinTriangles(
      { level: 1, points: a },
      { level: 2, points: b },
      1,
      [a[1]!, b[1]!],
      -0.4,
    );
    expect(triangles.some((t) => t.some((p) => p.y === -0.4))).toBe(true);
    expect(triangles.some((t) => t.includes(b[2]!))).toBe(false);
  });
});
