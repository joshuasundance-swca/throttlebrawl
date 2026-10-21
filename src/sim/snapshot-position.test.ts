import { expect, it, vi } from 'vitest';
import { atan2, cos, sin } from '../core';
import { createSimWithWorld } from './create';
import { testConfig } from './riders/testing';
import { addMover } from './world';

it('projects fresh independent snapshots exactly on a curved graded road in either direction', () => {
  const config = testConfig({ edges: [{ id: 'curve', lengthM: 300, kappa: 0.012, grade: 0.08 }] });
  config.road.edges[0]!.bank.fill(0.12);
  const { sim, world } = createSimWithWorld(config);
  const mover = addMover(world, 'pickup', { edge: 0, s: 81.3, d: -3.7, dir: -1 });
  mover.h = 2.4;
  mover.yaw = 0.37;
  const hash = sim.hash();
  const retained = sim.snapshot();
  for (const dir of [-1, 1] as const) {
    mover.pos.dir = dir;
    mover.pos.s += 1.13;
    mover.pos.d *= -1;
    const expected = config.road.toWorld(0, mover.pos.s, mover.pos.d, mover.h);
    const f = config.road.frameAt(0, mover.pos.s);
    const c = cos(mover.yaw),
      s = sin(mover.yaw);
    const actual = sim.snapshot().entities.find((e) => e.id === mover.id)!;
    expect({ x: actual.x, y: actual.y, z: actual.z }).toEqual(expected);
    expect(actual.heading).toBe(
      atan2(-(c * f.tx * dir - s * f.tz * dir), -(c * f.tz * dir + s * f.tx * dir)),
    );
  }
  expect(retained.entities.find((e) => e.id === mover.id)?.road).toMatchObject({ s: 81.3, d: -3.7, dir: -1 });
  expect(sim.hash()).not.toBe(hash); // The within-tick world edits are visible, not cached by tick.
  const afterEdits = sim.hash();
  sim.snapshot();
  expect(sim.hash()).toBe(afterEdits);
});

it('does not transform a non-rider twice just to obtain its already needed road frame', () => {
  const config = testConfig();
  const { sim, world } = createSimWithWorld(config);
  const mover = addMover(world, 'pickup', { edge: 0, s: 173.25, d: 2, dir: 1 });
  const calls = vi.spyOn(config.road, 'toWorld');
  config.road.toWorld(0, mover.pos.s, mover.pos.d, mover.h);
  expect(calls).toHaveBeenCalledOnce(); // Positive control for the work observer.
  calls.mockClear();
  sim.snapshot();
  expect(calls.mock.calls.filter(([edge, s]) => edge === 0 && s === mover.pos.s)).toHaveLength(0);
  calls.mockRestore();
});
