import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, fixtureBranchNetwork } from '../../road';
import type { Mover } from '../world';
import { seeVehicle } from './sense';

const mover = (edge: number, s: number, d: number, dir: 1 | -1, kind: 'rider' | 'vehicle'): Mover => ({
  id: kind === 'rider' ? 0 : 1,
  kind,
  mode: 'Road',
  pos: { edge, s, d, dir },
  h: 0,
  yaw: 0,
  speed: 10,
  riderIndex: -1,
});

describe('vehicle sensing across short connectors', () => {
  it('transforms a reversed edge’s distance, lane and travel direction', () => {
    const f = fixtureNetwork([
      { id: 'a', lengthM: 100, kappa: 0 },
      { id: 'b', lengthM: 100, kappa: 0 },
    ]);
    const b = f.roads[1]!;
    [b.from, b.to] = [b.to, b.from];
    b.samples = {
      ...b.samples,
      data: Object.fromEntries(
        Object.entries(b.samples.data).map(([key, values]) => [key, [...values].reverse()]),
      ),
    };
    b.laneSections = b.laneSections.map((s) => ({
      ...s,
      lanes: s.lanes.map((l) => ({
        ...l,
        direction: l.direction === 1 ? (-1 as const) : (1 as const),
        dCenterM: -l.dCenterM,
      })),
    }));
    for (const j of f.network.junctions)
      j.ends = j.ends.map((e) => (e.road === 'b' ? { ...e, end: e.end === 'from' ? 'to' : 'from' } : e));
    const road = createRoadNetwork(f);
    const me = mover(0, 95, 1.7, 1, 'rider');
    const seen = seeVehicle(road, me, mover(1, 94, -1.7, -1, 'vehicle'), 20);
    expect(seen?.ahead).toBeCloseTo(11);
    expect(seen?.dd).toBeCloseTo(0);
    expect(seen?.vAlong).toBe(10);
    expect(seen?.mover.pos.dir).toBe(1);
  });
  it('sees physically overlapping traffic-only approaches, but not a separate deck at that progress', () => {
    const f = fixtureNetwork([
      { id: 'a', lengthM: 100, kappa: 0 },
      { id: 'b', lengthM: 100, kappa: 0 },
    ]);
    f.network.junctions.forEach((j) => {
      j.connectors = [];
    });
    f.roads[1]!.samples = {
      ...f.roads[1]!.samples,
      data: { ...f.roads[1]!.samples.data, z: [...f.roads[0]!.samples.data['z']!] },
    };
    const road = createRoadNetwork(f);
    const me = mover(0, 50, 1.7, 1, 'rider');
    const car = mover(1, 55, 1.7, 1, 'vehicle');
    expect(seeVehicle(road, me, car, 20)?.ahead).toBeCloseTo(5);
    f.roads[1]!.samples = {
      ...f.roads[1]!.samples,
      data: { ...f.roads[1]!.samples.data, y: f.roads[1]!.samples.data['y']!.map(() => 8) },
    };
    expect(seeVehicle(createRoadNetwork(f), me, car, 20)).toBeNull();
  });
  it('sees a downstream car beyond multiple connectors and transforms its lateral position', () => {
    const road = createRoadNetwork(
      fixtureNetwork([
        { id: 'a', lengthM: 100, kappa: 0 },
        { id: 'tiny', lengthM: 2, kappa: 0 },
        { id: 'short', lengthM: 4, kappa: 0 },
        { id: 'b', lengthM: 100, kappa: 0 },
      ]),
    );
    const me = mover(0, 95, 1.7, 1, 'rider');
    const car = mover(3, 6, -1.7, -1, 'vehicle');
    const seen = seeVehicle(road, me, car, 30);
    expect(seen?.ahead).toBeCloseTo(17);
    expect(seen?.dd).toBeCloseTo(-3.4);
    expect(seen?.vAlong).toBe(-10);
    expect(seeVehicle(road, me, car, 10)).toBeNull();
  });
  it('preserves the connector offset instead of treating a branch car as a center-line car', () => {
    const f = fixtureBranchNetwork();
    const road = createRoadNetwork(f);
    const seen = seeVehicle(
      road,
      mover(road.edgeIndex('a'), 195, 1.7, 1, 'rider'),
      mover(road.edgeIndex('c-in'), 2, 0, 1, 'vehicle'),
      30,
    );
    expect(seen?.ahead).toBeCloseTo(7);
    expect(seen?.mover.pos.d).toBeCloseTo(3.4, 1);
    expect(seen?.dd).toBeCloseTo(1.7, 1);
  });
});
