import { describe, expect, it, vi } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type RoadNetwork } from '../road';
import { EdgeLocator } from './overlap';

/** Retained linear reference: globally nearest sample followed by the original tangent projection. */
function linearHits(road: RoadNetwork, x: number, z: number, except: number, pastM = 0.25) {
  return road.edges.flatMap((e) => {
    if (
      e.index === except ||
      x < Math.min(...e.x) - 40 ||
      x > Math.max(...e.x) + 40 ||
      z < Math.min(...e.z) - 40 ||
      z > Math.max(...e.z) + 40
    )
      return [];
    const distances = Array.from({ length: e.count }, (_, i) => (x - e.x[i]!) ** 2 + (z - e.z[i]!) ** 2);
    let s = distances.indexOf(Math.min(...distances)) * e.spacing;
    let d = 0;
    for (let i = 0; i < 3; i++) {
      const clamped = Math.min(e.length, Math.max(0, s));
      const f = road.frameAt(e.index, clamped);
      const dx = x - f.x;
      const dz = z - f.z;
      d = -dx * f.tz + dz * f.tx;
      s = clamped + dx * f.tx + dz * f.tz;
    }
    const past = Math.max(0, -s, s - e.length);
    return past > pastM || Math.abs(d) > 40
      ? []
      : [{ edge: e.index, s: Math.min(e.length, Math.max(0, s)), d }];
  });
}

describe('road overlap nearest-vertex lookup', () => {
  it('reuses its index rather than scanning every vertex for each scenery query', () => {
    const road = createRoadNetwork(fixtureNetwork([{ id: 'long', lengthM: 8192, kappa: 0 }]));
    const edge = road.edges[0]!;
    let reads = 0;
    const counted = (values: Float64Array) =>
      new Proxy(values, {
        get(target, key) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
          return Reflect.get(target, key, target) as unknown;
        },
      });
    edge.x = counted(edge.x);
    edge.z = counted(edge.z);
    const loc = new EdgeLocator(road);
    const boxReads = reads;
    reads = 0;
    expect(loc.at(1, -4000, 0)).toEqual([]);
    expect(loc.at(1000, -4000, -1)).toEqual([]);
    expect(reads).toBe(0);
    loc.at(1, -4000, -1);
    const coldReads = boxReads + reads;
    reads = 0;
    for (let i = 0; i < 20; i++) {
      expect(loc.at(1, -4000 - i, -1)).toHaveLength(1);
    }
    // Frame interpolation still reads a few coordinates. The whole-edge control below proves that
    // the counter detects the work this contract excludes, without a wall-clock benchmark.
    expect(reads).toBeLessThan(edge.count);
    expect(coldReads + reads).toBeLessThan(edge.count * 8);
    reads = 0;
    for (let i = 0; i < edge.count; i++) {
      void edge.x[i];
      void edge.z[i];
    }
    expect(reads).toBe(edge.count * 2);
  });

  it('matches complete ordered linear projections across curves, joins and negative controls', () => {
    const road = createRoadNetwork(
      fixtureNetwork([
        { id: 'approach', lengthM: 100, kappa: 0 },
        { id: 'loop', lengthM: 600, kappa: 1 / 40 },
        { id: 'exit', lengthM: 100, kappa: -1 / 80 },
      ]),
    );
    const loc = new EdgeLocator(road);
    let positives = 0;
    let negatives = 0;
    for (let i = 0; i < 300; i++) {
      const x = ((i * 37) % 220) - 80;
      const z = ((i * 61) % 260) - 210;
      const except = (i % 4) - 1;
      const expected = linearHits(road, x, z, except);
      expect(loc.at(x, z, except)).toEqual(expected);
      if (expected.length) positives++;
      else negatives++;
    }
    expect(positives).toBeGreaterThan(0);
    expect(negatives).toBeGreaterThan(0);
  });

  it('starts projection at the globally nearest vertex, retaining earliest-index ties on folded roads', () => {
    const bundle = fixtureNetwork([{ id: 'fold', lengthM: 200, kappa: 0 }]);
    const baked = bundle.roads[0]!;
    // Two parallel runs with repeated points: nearest arclength cannot be inferred from world x.
    const xs = Array.from({ length: 101 }, (_, i) => (i <= 50 ? i * 2 : (100 - i) * 2));
    const zs = xs.map((_, i) => (i <= 50 ? 0 : 20));
    baked.samples = { ...baked.samples, data: { ...baked.samples.data, x: xs, z: zs } };
    const road = createRoadNetwork(bundle);
    const edge = road.edges[0]!;
    const loc = new EdgeLocator(road);
    const frame = vi.spyOn(road, 'frameAt');
    for (const [x, z] of [
      [50, 10],
      [50, 11],
      [50, 9],
      [99, 10],
      [0, 10],
      [12.4, -5],
    ] as const) {
      const distances = Array.from(
        { length: edge.count },
        (_, i) => (x - edge.x[i]!) ** 2 + (z - edge.z[i]!) ** 2,
      );
      const expected = distances.indexOf(Math.min(...distances));
      const hits = linearHits(road, x, z, -1);
      frame.mockClear();
      expect(loc.at(x, z, -1)).toEqual(hits);
      expect(frame.mock.calls[0]?.[1]).toBe(expected * edge.spacing);
    }
    frame.mockRestore();
  });

  it('searches equal-distance alternate branches for the first coincident vertex', () => {
    const bundle = fixtureNetwork([{ id: 'coincident', lengthM: 100, kappa: 0 }]);
    const baked = bundle.roads[0]!;
    baked.samples = {
      ...baked.samples,
      data: {
        ...baked.samples.data,
        x: Array.from({ length: 51 }, () => 0),
        z: Array.from({ length: 51 }, () => 0),
      },
    };
    const road = createRoadNetwork(bundle);
    const loc = new EdgeLocator(road);
    const frame = vi.spyOn(road, 'frameAt');
    loc.at(0, 0, -1);
    expect(frame.mock.calls[0]?.[1]).toBe(0);
    frame.mockRestore();
  });

  it('retains lateral reach, excluded-edge, endpoint tolerance and covered controls', () => {
    const road = createRoadNetwork(fixtureNetwork([{ id: 'straight', lengthM: 100, kappa: 0 }]));
    const loc = new EdgeLocator(road);
    const boundary = loc.at(40, -50, -1);
    expect(boundary).toHaveLength(1);
    expect(boundary[0]?.s).toBeCloseTo(50, 8);
    expect(boundary[0]?.d).toBeCloseTo(40, 8);
    expect(loc.at(40.1, -50, -1)).toEqual([]);
    expect(loc.at(0, -50, 0)).toEqual([]);
    expect(loc.at(0, 0.2, -1)).toEqual([{ edge: 0, s: 0, d: 0 }]);
    expect(loc.at(0, 0.3, -1)).toEqual([]);
    expect(loc.at(0, 0.3, -1, 0.5)).toHaveLength(1);
    expect(loc.covered(1, -50, -1, () => [-2, 2])).toBe(true);
    expect(loc.covered(3, -50, -1, () => [-2, 2])).toBe(false);
    expect(
      loc.covered(
        1,
        -50,
        -1,
        () => [-2, 2],
        () => false,
      ),
    ).toBe(false);
  });
});
