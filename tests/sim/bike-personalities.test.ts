// Competition-depth acceptance 5: actual pack bikes, identical inputs, observable tradeoffs.
import { describe, expect, it } from 'vitest';
import mudflap from '../../packs/base/bikes/dirt-bike.json';
import rustbucket from '../../packs/base/bikes/rustbucket-400.json';
import streetfighter from '../../packs/base/bikes/streetfighter-750.json';
import tourer from '../../packs/region-pnw/bikes/grand-tourer-1100.json';
import type { SimBikeDef } from '../../src/sim/api';
import { input, packHarness, riderHarness, testConfig } from '../../src/sim/riders/testing';

const bikes = {
  mudflap: { contentId: 'base:dirt-bike', ...mudflap.handling },
  rustbucket: { contentId: 'base:rustbucket-400', ...rustbucket.handling },
  streetfighter: { contentId: 'base:streetfighter-750', ...streetfighter.handling },
  tourer: { contentId: 'region-pnw:grand-tourer-1100', ...tourer.handling },
} satisfies Record<string, SimBikeDef>;

function ride(bike: SimBikeDef, speed = 0) {
  const config = testConfig();
  return riderHarness(
    { ...config, riders: config.riders.map((r) => ({ ...r, bike })) },
    { s: 100, d: 1.7, speed },
  );
}

function launch(bike: SimBikeDef) {
  const h = ride(bike);
  // Half a second isolates the launch before the Mudflap's low speed ceiling dominates.
  for (let tick = 0; tick < 30; tick++) h.step(input(1));
  expect(h.rider.mode).toBe('Road');
  return { speed: h.rider.speed, distance: h.rider.pos.s - 100 };
}

function turn(bike: SimBikeDef) {
  const h = ride(bike, 20);
  for (let tick = 0; tick < 30; tick++) h.step(input(0, 0, 0.35));
  expect(h.rider.mode).toBe('Road');
  return { across: h.rider.pos.d - 1.7, yaw: h.rider.yaw };
}

function stop(bike: SimBikeDef) {
  const h = ride(bike, 25);
  let ticks = 0;
  while (h.rider.speed > 0 && ticks < 300) {
    h.step(input(0, 1));
    ticks++;
  }
  expect(h.rider.speed).toBe(0);
  expect(h.rider.mode).toBe('Road');
  return { ticks, distance: h.rider.pos.s - 100 };
}

/** A stationary shoulder rub isolates mass from engine/steering and avoids a hard crash. */
function rub(bike: SimBikeDef) {
  const config = testConfig({ rivals: 1 });
  const h = packHarness(
    {
      ...config,
      riders: config.riders.map((r, i) => ({ ...r, bike: i === 0 ? bikes.rustbucket : bike })),
    },
    [
      { s: 100, d: 1.2 },
      { s: 100, d: 1.7 },
    ],
  );
  for (let tick = 0; tick < 30; tick++) h.step([input(0), input(0)]);
  const player = h.riders[1];
  if (!player) throw new Error('missing contact rider');
  expect(player.mode).toBe('Road');
  expect(player.pos.d - h.riders[0]!.pos.d).toBeGreaterThan(0.8);
  return player.pos.d - 1.7;
}

describe('representative bike personalities from shipped handling', () => {
  it('the lightweight Mudflap launches ahead of the long-legged Tourer despite a lower ceiling', () => {
    const light = launch(bikes.mudflap);
    const heavy = launch(bikes.tourer);
    console.log('[examined] launch after 30 sim ticks, m/s and metres', { light, heavy });
    expect(light.speed).toBeGreaterThan(heavy.speed * 1.08);
    expect(light.distance).toBeGreaterThan(heavy.distance * 1.08);
    expect(bikes.mudflap.topSpeedMps).toBeLessThan(bikes.tourer.topSpeedMps);
  });

  it('the nimble bikes change heading and lane more readily than the Tourer at equal speed', () => {
    const light = turn(bikes.mudflap);
    const road = turn(bikes.streetfighter);
    const heavy = turn(bikes.tourer);
    console.log('[examined] turn after 30 sim ticks, lateral metres and yaw radians', { light, road, heavy });
    expect(light.across).toBeGreaterThan(road.across * 1.08);
    expect(road.across).toBeGreaterThan(heavy.across * 1.2);
    expect(road.yaw).toBeGreaterThan(heavy.yaw * 1.2);
  });

  it('the Streetfighter stops sooner than both the Tourer and Mudflap from equal speed', () => {
    const road = stop(bikes.streetfighter);
    const heavy = stop(bikes.tourer);
    const light = stop(bikes.mudflap);
    console.log('[examined] full braking from 25 m/s, sim ticks and stopping metres', { road, heavy, light });
    expect(road.distance).toBeLessThan(heavy.distance * 0.9);
    expect(road.ticks).toBeLessThan(heavy.ticks);
    expect(road.distance).toBeLessThan(light.distance * 0.85);
  });

  it('the Tourer gives up less lateral ground to the same rider contact than the nimble bikes', () => {
    const heavy = rub(bikes.tourer);
    const road = rub(bikes.streetfighter);
    const light = rub(bikes.mudflap);
    console.log('[examined] displacement after the same shoulder rub, metres', { heavy, road, light });
    expect(heavy).toBeGreaterThan(0);
    expect(heavy).toBeLessThan(road * 0.9);
    expect(road).toBeLessThan(light * 0.9);
  });

  it('identical handling under another id is identical, and repeated scripted inputs reproduce the trace', () => {
    const trace = (bike: SimBikeDef) => {
      const h = ride(bike, 15);
      return Array.from({ length: 120 }, (_, tick) => {
        h.step(input(tick < 45 ? 1 : 0, tick >= 90 ? 1 : 0, tick < 30 ? 0.2 : 0));
        return [h.rider.speed, h.rider.pos.s, h.rider.pos.d, h.rider.yaw, h.rider.mode];
      });
    };
    const control = { ...bikes.rustbucket, contentId: 'base:same-handling-control' };
    expect(trace(control)).toEqual(trace(bikes.rustbucket));
    for (const bike of Object.values(bikes)) expect(trace(bike)).toEqual(trace(bike));
    expect(rub(control)).toBe(rub(bikes.rustbucket));
    expect(launch(control)).toEqual(launch(bikes.rustbucket));
    expect(turn(control)).toEqual(turn(bikes.rustbucket));
    expect(stop(control)).toEqual(stop(bikes.rustbucket));
  });
});
