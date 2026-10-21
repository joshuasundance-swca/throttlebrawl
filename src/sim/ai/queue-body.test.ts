import { describe, expect, it } from 'vitest';
import { loadSimSteps } from '../api';
import { raceSystem } from '../race';
import { ridersSystem } from '../riders';
import { testConfig } from '../riders/testing';
import { trafficState, vehicleInfo } from '../traffic';
import type { SimConfig, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, riderHitbox } from '../world';
import { aiSystem } from './index';

await loadSimSteps();

const CAR: SimTrafficTypeDef = {
  contentId: 'base:queue-car',
  category: 'car',
  lengthM: 4.8,
  widthM: 1.8,
  cruiseMps: 0,
  hazard: 'normal',
};
const TRUCK: SimTrafficTypeDef = {
  ...CAR,
  contentId: 'base:queue-truck',
  category: 'truck',
  lengthM: 20,
  widthM: 2.6,
  hazard: 'big',
};

/** Only the rival, riding and race phases run: the registered queue stays stationary. */
function queue(includeTruck: boolean, blockerType = 0, registered = true) {
  const base = testConfig({ rivals: 1, rubberBand: 0 });
  const def = base.riders[0]!;
  const config: SimConfig = {
    ...base,
    riders: [{ ...def, controller: { kind: 'ai', style: 'racer', personality: { weave: 0 } } }],
    trafficTypes: includeTruck ? [CAR, TRUCK] : [CAR],
    tuning: { ...base.tuning, 'riders.furniture': 0, 'riders.structures': 0 },
  };
  const world = createWorld(config);
  // The blocked control begins at the existing four-metre following clearance, already stopped.
  const rider = addMover(
    world,
    'rider',
    {
      edge: 0,
      s: blockerType === 1 ? 96 : 100,
      d: blockerType === 1 ? 1.7 : 3.3,
      dir: 1,
    },
    0,
  );
  const positions =
    blockerType === 1
      ? [-3.4, 0, 3.4].map((d) => ({ s: 110, d }))
      : [110, 118, 134].map((s) => ({ s, d: 2 }));
  const cars = positions.map((pos) => addMover(world, 'vehicle', { edge: 0, ...pos, dir: 1 }));
  if (registered) {
    const traffic = trafficState(world);
    traffic.id = cars.map((car) => car.id);
    traffic.type = cars.map(() => blockerType);
  }
  for (const system of [ridersSystem, raceSystem, aiSystem]) system.init(world, config);
  const box = riderHitbox(config, 0);
  const samples: { s: number; d: number; speed: number }[] = [];
  let overlaps = 0;
  return {
    world,
    config,
    rider,
    cars,
    samples,
    run(ticks: number) {
      for (let tick = 0; tick < ticks; tick++) {
        world.events = [];
        aiSystem.step(world, config);
        ridersSystem.step(world, config);
        raceSystem.step(world, config);
        world.tick++;
        samples.push({ s: rider.pos.s, d: rider.pos.d, speed: rider.speed });
        for (const car of cars) {
          const info = vehicleInfo(world, config, car.id);
          const type = info ?? config.trafficTypes[blockerType]!;
          if (
            Math.abs(rider.pos.s - car.pos.s) < (type.lengthM + box.lengthM) / 2 &&
            Math.abs(rider.pos.d - car.pos.d) < (type.widthM + box.widthM) / 2
          )
            overlaps++;
        }
      }
      return overlaps;
    },
  };
}

describe('rival avoidance uses the registered traffic body', () => {
  it('passes a stationary car queue without overlaps even with an unused long truck in the catalogue', () => {
    const scene = queue(true);
    expect(vehicleInfo(scene.world, scene.config, scene.cars[0]!.id)?.contentId).toBe(CAR.contentId);
    expect(scene.run(1200)).toBe(0);
    expect(scene.rider.pos.s).toBeGreaterThan(scene.cars.at(-1)!.pos.s + 30);
  });

  it('an unused truck does not change the narrow cars or the rival’s driven path', () => {
    const narrow = queue(false);
    const catalogue = queue(true);
    expect(narrow.run(600)).toBe(0);
    expect(catalogue.run(600)).toBe(0);
    expect(
      catalogue.samples.every((sample, i) => {
        const other = narrow.samples[i];
        return sample.s === other?.s && sample.d === other.d && sample.speed === other.speed;
      }),
    ).toBe(true);
  });

  it('still stops safely when the actual long wide bodies leave no passing line', () => {
    const scene = queue(true, 1);
    expect(scene.run(600)).toBe(0);
    expect(scene.rider.pos.s).toBeLessThan(scene.cars[0]!.pos.s - TRUCK.lengthM / 2);
    expect(scene.rider.speed).toBeLessThan(1);
  });

  it('keeps conservative catalogue dimensions for unregistered synthetic vehicles', () => {
    const scene = queue(true, 1, false);
    expect(vehicleInfo(scene.world, scene.config, scene.cars[0]!.id)).toBeNull();
    expect(scene.run(600)).toBe(0);
    expect(scene.rider.pos.s).toBeLessThan(scene.cars[0]!.pos.s - TRUCK.lengthM / 2);
    expect(scene.rider.speed).toBeLessThan(1);
  });
});
