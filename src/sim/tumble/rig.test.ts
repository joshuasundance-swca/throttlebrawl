import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../../road';
import { centre, makeCluster, stepCluster } from './rig';

describe('crash bodies past drawn edges', () => {
  it('clears the parapet, travels over its shelf and lands on the drawn ground', () => {
    const bundle = fixtureNetwork([{ id: 'a', lengthM: 200, kappa: 0 }]);
    const road = createRoadNetwork({
      ...bundle,
      roads: bundle.roads.map((r) => ({
        ...r,
        barriers: [],
        tags: [{ tag: 'bluff', side: 'right' as const, s0: 0, s1: 200 }],
      })),
    });
    const outer = road.vergeAt(0, 100, 'right').dOuter;
    const base = road.toWorld(0, 100, outer + 0.5, 3);
    const f = road.frameAt(0, 100);
    const c = makeCluster(
      'bike',
      base,
      { fx: f.tx, fz: f.tz, rx: -f.tz, rz: f.tx },
      { x: -f.tz, y: 0, z: f.tx },
      { x: 0, y: 0, z: 0 },
      0,
    );
    stepCluster(road, c, 1 / 60, 0.5, true, undefined, true);
    const at = centre(c.p);
    expect(road.project(at.x, at.z, 0).d).toBeGreaterThan(outer);
    expect(c.overboard).toBe(true);
    for (let tick = 0; tick < 180 && !c.splashed; tick++)
      stepCluster(road, c, 1 / 60, 0.5, true, undefined, true);
    expect(c.splashed).toBe(true);
    expect(Math.min(...c.p.map((p) => p.y))).toBeCloseTo(-0.09, 5);
  });
});
