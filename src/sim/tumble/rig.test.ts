import { describe, expect, it, vi } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../../road';
import { centre, makeCluster, stepCluster } from './rig';
import { FNV_OFFSET } from '../../core';
import { hashPlain } from '../world';

describe('crash bodies past drawn edges', () => {
  it('corrects a terrain rail laterally with one candidate scan and no second station budget', () => {
    const bundle = fixtureNetwork([{ id: 'a', lengthM: 200, kappa: 0 }]);
    const road = createRoadNetwork({
      ...bundle,
      network: {
        ...bundle.network,
        terrain: {
          patches: [
            {
              surface: 'grass',
              vertices: [
                [-500, 0, -500],
                [-500, 0, 500],
                [500, 0, -500],
                [500, 0, 500],
              ],
              triangles: [
                [0, 1, 2],
                [2, 1, 3],
              ],
            },
          ],
        },
      },
      roads: bundle.roads.map((r) => ({
        ...r,
        barriers: [{ s0: 0, s1: 200, side: 'right', kind: 'rail', heightM: 2 }],
      })),
    });
    const base = road.toWorld(0, 100, 4.7, 0);
    const c = makeCluster(
      'bike',
      base,
      { fx: 0, fz: -1, rx: 1, rz: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      0,
      { edge: 0, s: 100, d: 4.7 },
    );
    const project = vi.spyOn(road, 'project');
    const contact = stepCluster(road, c, 1 / 60, 1, true);
    expect(project).toHaveBeenCalledTimes(1);
    expect(contact.d).toBeLessThan(4.7);
    const w = road.toWorld(contact.edge, contact.s, contact.d, 0);
    const at = centre(c.p);
    expect(Math.hypot(w.x - at.x, w.z - at.z)).toBeLessThan(1e-6);
    expect(c.anchor).toEqual({ edge: contact.edge, s: contact.s, d: contact.d });
    project.mockRestore();
  });
  it('persists the local station through terrain contact and paused steps, and hashes it', () => {
    const bundle = fixtureNetwork([{ id: 'loop', lengthM: 1000, kappa: (2 * Math.PI) / 1000 }]);
    const road = createRoadNetwork({
      ...bundle,
      network: {
        ...bundle.network,
        terrain: {
          patches: [
            {
              surface: 'grass',
              vertices: [
                [-500, 0, -500],
                [-500, 0, 500],
                [500, 0, -500],
                [500, 0, 500],
              ],
              triangles: [
                [0, 1, 2],
                [2, 1, 3],
              ],
            },
          ],
        },
      },
    });
    const base = road.toWorld(0, 990, 30, 0);
    const f = road.frameAt(0, 990);
    const c = makeCluster(
      'bike',
      base,
      { fx: f.tx, fz: f.tz, rx: -f.tz, rz: f.tx },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      0,
      { edge: 0, s: 10, d: 30 },
    );
    const contact = stepCluster(road, c, 1 / 60, 1, true);
    expect(contact.s).toBeLessThanOrEqual(14);
    expect(c.anchor?.s).toBe(contact.s);
    const hash = hashPlain(FNV_OFFSET, c);
    stepCluster(road, c, 0, 1, true);
    expect(hashPlain(FNV_OFFSET, c)).toBe(hash);
    c.anchor!.s += 1;
    expect(hashPlain(FNV_OFFSET, c)).not.toBe(hash);
    const uninitialized = makeCluster(
      'bike',
      base,
      { fx: f.tx, fz: f.tz, rx: -f.tz, rz: f.tx },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      0,
    );
    const before = hashPlain(FNV_OFFSET, uninitialized);
    stepCluster(road, uninitialized, 0, 1, true);
    expect(hashPlain(FNV_OFFSET, uninitialized)).toBe(before);
  });
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
