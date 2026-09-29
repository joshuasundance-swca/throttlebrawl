import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type RoadPos } from './index';

function threeEdges() {
  return fixtureNetwork([
    { id: 'a', lengthM: 300, kappa: 0 },
    { id: 'b', lengthM: 400, kappa: 1 / 200 },
    { id: 'c', lengthM: 300, kappa: 0 },
  ]);
}

describe('road: the network model', () => {
  const net = createRoadNetwork(threeEdges());

  it('round-trips toWorld and project within 1 cm on a straight and a bend', () => {
    for (const [edge, s, d] of [
      [0, 120, 1.7],
      [1, 210, -2.5],
      [1, 333, 3.9],
      [2, 50, 0],
    ] as const) {
      const w = net.toWorld(edge, s, d, 0);
      const p = net.project(w.x, w.z, edge);
      expect(p.edge).toBe(edge);
      expect(Math.abs(p.s - s)).toBeLessThan(0.01);
      expect(Math.abs(p.d - d)).toBeLessThan(0.01);
    }
  });

  it('puts positive d on the right and positive kappa on a right-hand bend', () => {
    // Facing north (edge a, heading 0), the right is east (+x).
    expect(net.toWorld(0, 100, 2, 0).x).toBeGreaterThan(net.toWorld(0, 100, 0, 0).x);
    const f0 = net.frameAt(1, 10);
    const f1 = net.frameAt(1, 200);
    // Turning right from north swings the tangent toward +x.
    expect(f1.tx).toBeGreaterThan(f0.tx);
    expect(net.kappaAt(1, 100)).toBeGreaterThan(0);
  });

  it('carries overshoot across a pass-through junction without losing or doubling distance', () => {
    const pos: RoadPos = { edge: 0, s: 300 + 7.5, d: 1.2, dir: 1 };
    expect(net.advance(pos)).toBe('ok');
    expect(pos).toEqual({ edge: 1, s: 7.5, d: 1.2, dir: 1 });
    const back: RoadPos = { edge: 2, s: -4, d: -1, dir: -1 };
    net.advance(back);
    expect(back.edge).toBe(1);
    expect(back.s).toBeCloseTo(396, 9);
    const end: RoadPos = { edge: 2, s: 305, d: 0, dir: 1 };
    expect(net.advance(end)).toBe('deadEnd');
    expect(end.s).toBe(300);
  });

  it('lists lanes and the next edge at each end', () => {
    expect(net.lanesAt(1, 50).map((l) => l.id)).toEqual(['L0', 'L1', 'R1', 'R0']);
    expect(net.nextEdges(0, 'to')).toEqual([{ edge: 1, entersAt: 'from' }]);
    expect(net.nextEdges(0, 'from')).toEqual([]);
    expect(net.neighbours(0, 295, 10)).toEqual([{ edge: 1, sOffset: 300 }]);
  });

  it('measures distance to the finish along the route', () => {
    const route = createRouteProgress(net, {
      id: 'r',
      network: 'fixture',
      start: { road: 'a', s: 20, dir: 1 },
      finish: { road: 'c', s: 280 },
      mainPath: ['a', 'b', 'c'],
      allowedRoads: ['a', 'b', 'c'],
      closed: false,
    });
    expect(route.length).toBeCloseTo(280 + 400 + 280, 9);
    // 300 m left on b, then 280 m of c.
    expect(route.distanceToFinish(1, 100)).toBeCloseTo(300 + 280, 9);
    expect(route.progressAt(0, 20)).toBe(0);
    expect(route.distanceToFinish(2, 280)).toBe(0);
  });
});
