import { expect, it, vi } from 'vitest';
import { createSimWithWorld } from './create';
import { testConfig } from './riders/testing';
import * as traffic from './traffic';
import { addMover } from './world';

it('derives owned scalar footprints from physical rider and registered vehicle dimensions', () => {
  const config = testConfig();
  config.riders = config.riders.map((r) => ({ ...r, hitbox: { lengthM: 3.2, widthM: 1.1 } }));
  config.trafficTypes = [
    { contentId: 'fixture:long', category: 'car', lengthM: 20, widthM: 2.4, cruiseMps: 18, hazard: 'big' },
  ];
  const { sim, world } = createSimWithWorld(config);
  const slot = traffic.placeVehicle(world, config, { type: 0, u: 200, dir: 1, speed: 0 });
  const id = traffic.trafficState(world).id[slot]!;
  const unknown = addMover(world, 'vehicle', { edge: 0, s: 500, d: 0, dir: 1 });
  const pickup = addMover(world, 'pickup', { edge: 0, s: 600, d: 0, dir: 1 });
  const hash = sim.hash();
  const spy = vi.spyOn(traffic, 'vehicleInfo');
  traffic.vehicleInfo(world, config, id);
  expect(spy).toHaveBeenCalledOnce();
  spy.mockClear();
  const first = sim.snapshot();
  expect(spy.mock.calls.filter((args) => args[2] === id)).toHaveLength(1);
  spy.mockRestore();
  expect(first.entities[0]).toMatchObject({ footprintLengthM: 3.2, footprintWidthM: 1.1 });
  expect(first.entities[id]).toMatchObject({ footprintLengthM: 20, footprintWidthM: 2.4 });
  for (const entity of [first.entities[unknown.id]!, first.entities[pickup.id]!]) {
    expect(entity.footprintLengthM).toBeUndefined();
    expect(entity.footprintWidthM).toBeUndefined();
  }
  expect(sim.hash()).toBe(hash);
  first.entities[0]!.footprintLengthM = 99;
  first.entities[id]!.footprintWidthM = 99;
  expect(config.riders[0]!.hitbox).toEqual({ lengthM: 3.2, widthM: 1.1 });
  expect(config.trafficTypes[0]!.widthM).toBe(2.4);
  for (const dir of [-1, 1] as const) {
    world.movers[id]!.pos.dir = dir;
    world.movers[id]!.yaw = Math.PI / 2;
    const before = sim.hash();
    const snap = sim.snapshot();
    expect(snap.entities[0]!.footprintLengthM).toBe(3.2);
    expect(snap.entities[id]).toMatchObject({ footprintLengthM: 20, footprintWidthM: 2.4 });
    expect(sim.hash()).toBe(before);
  }
});

it('keeps the same input replay hashes when derived snapshot scalars are read and edited between ticks', () => {
  const config = testConfig();
  const observed = createSimWithWorld(config).sim;
  const control = createSimWithWorld(config).sim;
  for (let tick = 0; tick < 90; tick++) {
    const snap = observed.snapshot();
    snap.entities[0]!.footprintWidthM = 99;
    const input = [{ throttle: 255, brake: 0, steer: tick < 45 ? 15 : -15, flags: 0 }];
    observed.step(input);
    control.step(input);
    expect(observed.hash()).toBe(control.hash());
  }
});
