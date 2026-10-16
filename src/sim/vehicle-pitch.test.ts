import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { createSimWithWorld } from './create';
import { testConfig } from './riders/testing';
import { addMover } from './world';

function scene(grade: number, bank: number) {
  const spec = [{ id: 'a', lengthM: 3000, kappa: 0, grade }] as const;
  const baked = fixtureNetwork(spec);
  for (const road of baked.roads)
    road.samples.data['bankRad'] = road.samples.data['bankRad']!.map(() => bank);
  const config = { ...testConfig({ edges: spec }), road: createRoadNetwork(baked) };
  return { config, ...createSimWithWorld(config) };
}

function expectedPitch(
  config: ReturnType<typeof scene>['config'],
  at: { s: number; d: number; dir: 1 | -1; yaw: number },
) {
  const step = 0.5;
  const ds = at.dir * Math.cos(at.yaw) * step;
  const dd = at.dir * Math.sin(at.yaw) * step;
  const before = config.road.toWorld(0, at.s - ds, at.d - dd, 0);
  const after = config.road.toWorld(0, at.s + ds, at.d + dd, 0);
  return Math.atan2(after.y - before.y, step * 2);
}

describe('vehicle snapshot road pitch', () => {
  it.each([
    { label: 'flat', grade: 0, bank: 0, dir: 1 as const, yaw: 0 },
    { label: 'uphill', grade: 0.12, bank: 0, dir: 1 as const, yaw: 0 },
    { label: 'downhill', grade: -0.08, bank: 0, dir: 1 as const, yaw: 0 },
    { label: 'reverse', grade: 0.12, bank: 0, dir: -1 as const, yaw: 0 },
    { label: 'yawed across bank', grade: 0.08, bank: 0.1, dir: 1 as const, yaw: 0.4 },
    { label: 'reverse yawed across bank', grade: 0.08, bank: 0.1, dir: -1 as const, yaw: -0.3 },
  ])('publishes the $label surface slope without mutating the sim', ({ grade, bank, dir, yaw }) => {
    const { config, sim, world } = scene(grade, bank);
    const at = { edge: 0, s: 100, d: 1.2, dir };
    const vehicle = addMover(world, 'vehicle', at);
    vehicle.yaw = yaw;
    const before = sim.hash();
    const snap = sim.snapshot();
    const drawn = snap.entities.find((entity) => entity.id === vehicle.id);
    expect(drawn?.pitch).toBeCloseTo(expectedPitch(config, { ...at, yaw }), 9);
    expect(sim.hash()).toBe(before);
  });
});
