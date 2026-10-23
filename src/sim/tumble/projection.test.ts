import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../../road';
import { projectCluster } from './projection';

const circle = () =>
  createRoadNetwork(fixtureNetwork([{ id: 'loop', lengthM: 1000, kappa: (2 * Math.PI) / 1000 }]));
const point = (x: number, y: number, z: number) => ({ x, y, z, vx: 0, vy: 0, vz: 0 });

describe('tumble station continuity', () => {
  it('keeps an off-pavement return arm local, including the final Newton station', () => {
    const road = circle();
    const w = road.toWorld(0, 990, 30, 0);
    expect(road.project(w.x, w.z, 0).s).toBeGreaterThan(980);
    const p = projectCluster(road, { edge: 0, s: 10, d: 30 }, [point(w.x, w.y, w.z)], 1 / 60);
    expect(p.s).toBeGreaterThanOrEqual(6);
    expect(p.s).toBeLessThanOrEqual(14);
  });

  it('accepts actual pavement contact on a remote arm of the same edge', () => {
    const road = circle();
    const w = road.toWorld(0, 990, 0, 0);
    expect(projectCluster(road, { edge: 0, s: 10, d: 0 }, [point(w.x, w.y, w.z)], 1 / 60).s).toBeCloseTo(
      990,
      2,
    );
  });

  it('rejects a remote arm at the wrong elevation and beyond its endpoint', () => {
    const road = circle();
    const w = road.toWorld(0, 990, 0, 8);
    expect(
      projectCluster(road, { edge: 0, s: 10, d: 0 }, [point(w.x, w.y, w.z)], 1 / 60).s,
    ).toBeLessThanOrEqual(14);
    const straight = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 100, kappa: 0 }]));
    const end = straight.toWorld(0, 100, 0, 0);
    expect(
      projectCluster(straight, { edge: 0, s: 10, d: 0 }, [point(end.x, end.y, end.z - 20)], 1 / 60).s,
    ).toBeLessThanOrEqual(14);
  });

  it('crosses a real connected junction within the reachable station window', () => {
    const road = createRoadNetwork(
      fixtureNetwork([
        { id: 'a', lengthM: 100, kappa: 0 },
        { id: 'b', lengthM: 100, kappa: 0 },
      ]),
    );
    const w = road.toWorld(1, 2, 0, 3);
    const p = projectCluster(road, { edge: 0, s: 99, d: 0 }, [point(w.x, w.y, w.z)], 1 / 60);
    expect(p.edge).toBe(1);
    expect(p.s).toBeCloseTo(2, 5);
  });

  it('accepts contact with an adjacent road but rejects its vertically separated deck', () => {
    const bundle = fixtureNetwork([
      { id: 'a', lengthM: 100, kappa: 0 },
      { id: 'b', lengthM: 100, kappa: 0 },
    ]);
    const b = bundle.roads[1]!;
    const data = b.samples.data;
    const road = createRoadNetwork({
      ...bundle,
      roads: bundle.roads.map((r) =>
        r.id !== b.id
          ? r
          : {
              ...b,
              samples: {
                ...b.samples,
                data: {
                  ...data,
                  x: data['x']!.map(() => 3),
                  y: data['y']!.map(() => 20),
                  z: data['z']!.map((_, i) => -i * b.sampleSpacingM),
                },
              },
            },
      ),
    });
    const w = road.toWorld(1, 90, 0, 0);
    expect(road.project(w.x, w.z, 0).edge).toBe(1);
    const anchor = { edge: 0, s: 10, d: 0 };
    const wrongHeight = projectCluster(road, anchor, [point(w.x, 0, w.z)], 1 / 60);
    expect(wrongHeight.edge).toBe(0);
    expect(wrongHeight.s).toBeLessThanOrEqual(14);
    const contact = projectCluster(road, anchor, [point(w.x, w.y, w.z)], 1 / 60);
    expect(contact.edge).toBe(1);
    expect(contact.s).toBeCloseTo(90, 5);
  });
});
