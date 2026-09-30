import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  createRouteProgress,
  curvedRoadRates,
  fixtureNetwork,
  type RoadPos,
} from './index';

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
    expect(net.neighbours(0, 295, 10)).toEqual([{ edge: 1, sOffset: 300, sSign: 1, dOffset: 0 }]);
    expect(net.neighbours(1, 5, 10)).toEqual([{ edge: 0, sOffset: -300, sSign: 1, dOffset: 0 }]);
  });

  it('curved-road kinematics: the same speed covers the same world distance inside and outside a bend', () => {
    // Edge b is a right bend (kappa 1/200). Two movers hold their lanes (yaw 0: their own turn
    // cancels the road's pull) at 30 m/s for 10 s. The 1 − kappa·d rule makes each cover
    // 300 m of world ground; without it the outside mover would cover more than the inside one.
    const walk = (d: number) => {
      const pos: RoadPos = { edge: 1, s: 20, d, dir: 1 };
      let world = 0;
      let prev = net.toWorld(pos.edge, pos.s, pos.d, 0);
      const rates = { ds: 0, dd: 0, yawDrift: 0 };
      for (let t = 0; t < 600; t++) {
        curvedRoadRates(net.kappaAt(pos.edge, pos.s), pos.d, pos.dir, 30, 0, rates);
        pos.s += rates.ds / 60;
        pos.d += rates.dd / 60;
        const w = net.toWorld(pos.edge, pos.s, pos.d, 0);
        world += Math.sqrt((w.x - prev.x) ** 2 + (w.z - prev.z) ** 2);
        prev = w;
      }
      return { gained: pos.s - 20, world };
    };
    const inside = walk(1.7); // positive d is the inside of a right bend
    const outside = walk(-1.7);
    expect(inside.world).toBeCloseTo(300, 0);
    expect(outside.world).toBeCloseTo(300, 0);
    // The inside mover gains more s per metre: the ratio is (1 − κ·d_out) / (1 − κ·d_in).
    expect(inside.gained / outside.gained).toBeCloseTo((1 + 1.7 / 200) / (1 - 1.7 / 200), 3);
    // The yaw coupling pulls a mover's heading against the bend.
    const r = { ds: 0, dd: 0, yawDrift: 0 };
    curvedRoadRates(1 / 200, 0, 1, 30, 0, r);
    expect(r.yawDrift).toBeCloseTo(-30 / 200, 9);
  });

  it('curved-road kinematics: an oncoming mover travels toward decreasing s', () => {
    const pos: RoadPos = { edge: 1, s: 300, d: -1.7, dir: -1 };
    const start = net.toWorld(1, 300, -1.7, 0);
    const f = net.frameAt(1, 300);
    const rates = { ds: 0, dd: 0, yawDrift: 0 };
    for (let t = 0; t < 120; t++) {
      curvedRoadRates(net.kappaAt(pos.edge, pos.s), pos.d, pos.dir, 25, 0, rates);
      expect(rates.ds).toBeLessThan(0);
      pos.s += rates.ds / 60;
      pos.d += rates.dd / 60;
    }
    expect(pos.s).toBeLessThan(300 - 45);
    // In the world it moved against the road's tangent.
    const end = net.toWorld(pos.edge, pos.s, pos.d, 0);
    expect((end.x - start.x) * f.tx + (end.z - start.z) * f.tz).toBeLessThan(0);
    // The oncoming mover steering to its right (positive yaw) moves toward negative d.
    curvedRoadRates(0, -1.7, -1, 25, 0.1, rates);
    expect(rates.dd).toBeLessThan(0);
  });

  it('carries a stepping mover across both junctions with no lost or doubled distance', () => {
    const pos: RoadPos = { edge: 0, s: 250, d: 1.7, dir: 1 };
    let travelled = 0;
    let prev = net.toWorld(0, 250, 1.7, 0);
    const edges: number[] = [0];
    for (let t = 0; t < 600; t++) {
      pos.s += 1.3; // 1.3 m a step does not divide any edge length
      expect(net.advance(pos)).toBe('ok');
      if (edges[edges.length - 1] !== pos.edge) edges.push(pos.edge);
      const w = net.toWorld(pos.edge, pos.s, pos.d, 0);
      const step = Math.sqrt((w.x - prev.x) ** 2 + (w.z - prev.z) ** 2);
      // Every step, the junction steps included, covers 1.3 m of ground (± the lane offset on
      // the bend and the sampled positions).
      expect(Math.abs(step - 1.3 * (1 - net.kappaAt(pos.edge, pos.s) * pos.d))).toBeLessThan(0.01);
      travelled += 1.3;
      prev = w;
      if (pos.edge === 2 && pos.s > 100) break;
    }
    expect(edges).toEqual([0, 1, 2]);
    // Distance along s adds up exactly across the transfers.
    expect(pos.s).toBeCloseTo(250 + travelled - 300 - 400, 9);
  });

  it('answers features, barriers and neighbours across a flipped join', () => {
    const b = fixtureNetwork([
      { id: 'a', lengthM: 300, kappa: 0 },
      { id: 'b', lengthM: 200, kappa: 0 },
    ]);
    const a0 = b.roads[0];
    if (!a0) throw new Error('fixture');
    const withData = {
      ...b,
      roads: [
        {
          ...a0,
          features: [
            { kind: 'copSpawn', id: 'lot', s0: 5, s1: 20, d0: 5, d1: 9 },
            { kind: 'roadsideZone', id: 'z', s0: 100, s1: 150, d0: 5, d1: 9 },
          ],
          barriers: [{ s0: 50, s1: 250, side: 'right' as const, kind: 'rail' as const, heightM: 1 }],
        },
        ...b.roads.slice(1),
      ],
    };
    const n2 = createRoadNetwork(withData);
    expect(n2.featuresOf(0, 'roadsideZone').map((f) => f.id)).toEqual(['z']);
    expect(n2.featuresOf(0).length).toBe(2);
    expect(n2.featuresOf(1)).toEqual([]);
    expect(n2.barrierAt(0, 100, 'right')).toEqual({ kind: 'rail', heightM: 1 });
    expect(n2.barrierAt(0, 100, 'left')).toBeNull();
    expect(n2.barrierAt(0, 260, 'right')).toBeNull();

    // Join b's `to` end to a's `to` end: b runs the other way round.
    const flipped = fixtureNetwork([
      { id: 'a', lengthM: 300, kappa: 0 },
      { id: 'b', lengthM: 200, kappa: 0 },
    ]);
    const j1 = flipped.network.junctions[1];
    const j2 = flipped.network.junctions[2];
    if (!j1 || !j2) throw new Error('fixture');
    const nf = createRoadNetwork({
      ...flipped,
      network: {
        ...flipped.network,
        junctions: [
          flipped.network.junctions[0] ?? j1,
          {
            ...j1,
            ends: [
              { road: 'a', end: 'to' },
              { road: 'b', end: 'to' },
            ],
          },
          { ...j2, ends: [{ road: 'b', end: 'from' }] },
        ],
      },
    });
    const [nb] = nf.neighbours(0, 290, 20);
    expect(nb?.edge).toBe(1);
    // a's s = sOffset + sSign · b's s: b's s 190 is 10 m past a's end.
    expect(nb?.sSign).toBe(-1);
    expect((nb?.sOffset ?? 0) + (nb?.sSign ?? 0) * 190).toBeCloseTo(310, 9);
    const back = nf.neighbours(1, 195, 20);
    expect(back[0]?.edge).toBe(0);
    expect((back[0]?.sOffset ?? 0) + (back[0]?.sSign ?? 0) * 290).toBeCloseTo(210, 9);
  });

  it('measures distance to the finish along the route', () => {
    const route = createRouteProgress(net, {
      id: 'r',
      network: 'fixture',
      start: { road: 'a', s: 20, dir: 1 },
      finish: { road: 'c', s: 280 },
      mainPath: ['a', 'b', 'c'],
      allowedRoads: ['a', 'b', 'c'],
      checkpoints: [{ road: 'b', s: 200 }],
      closed: false,
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    });
    expect(route.checkpoints).toEqual([{ edge: 1, s: 200, progress: 280 + 200 }]);
    expect(route.startGrid).toEqual({ rows: 3, perRow: 2, rowGapM: 8 });
    expect(route.length).toBeCloseTo(280 + 400 + 280, 9);
    // 300 m left on b, then 280 m of c.
    expect(route.distanceToFinish(1, 100)).toBeCloseTo(300 + 280, 9);
    expect(route.progressAt(0, 20)).toBe(0);
    expect(route.distanceToFinish(2, 280)).toBe(0);
  });
});
