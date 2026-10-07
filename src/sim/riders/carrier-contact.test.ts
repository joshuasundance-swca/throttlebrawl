import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../../road';
import type { SimConfig, SimEvent } from '../types';
import { riderState } from './index';
import { supportKeyOf } from './supports';
import { input, riderHarness, testConfig } from './testing';

const TRUCK: BakedFeature = {
  kind: 'rampTruck',
  id: 'carrier-contact',
  s0: 600,
  s1: 621.1,
  d0: 2.15,
  d1: 4.65,
  params: { rampLengthM: 11.5, lipHeightM: 2.8 },
};
const D = 3.4;
function config(features: BakedFeature[] = [TRUCK]): SimConfig {
  const base = testConfig();
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 3000, kappa: 0 }]);
  const road0 = bundle.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({ ...bundle, roads: [{ ...road0, features }] });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 2980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return { ...base, road, route };
}
function air(s: number, h: number, speed: number, vy = 0) {
  const run = riderHarness(config(), { s, d: D, speed });
  run.rider.mode = 'Airborne';
  run.rider.h = h;
  const st = riderState(run.world);
  st.yAbs[run.rider.id] = run.config.road.surfaceHeight(0, s, D) + h;
  st.vy[run.rider.id] = vy;
  st.airTicks[run.rider.id] = 0;
  return run;
}
describe('carrier contacts obey actual surfaces and the vehicle closing-speed rule', () => {
  it('a standing 2.4 m step remains solid at the fastest bike speed (continuous-ramp control)', () => {
    const step: BakedFeature = {
      kind: 'hazard',
      id: 'standing-step',
      s0: 600,
      s1: 605,
      d0: 2.15,
      d1: 4.65,
      params: { solid: true, heightM: 2.4, object: 'pickup' },
    };
    const h = riderHarness(config([step]), { s: 590, d: D, speed: 71.5 });
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 && !events.some((e) => e.type === 'crash'); t++) events.push(...h.step(input(1)));
    expect(events.find((e) => e.type === 'crash')?.data).toMatchObject({
      object: 'pickup',
      feature: 'standing-step',
    });
    expect(h.rider.pos.s).toBeLessThan(600);
  });
  it.each([6, 12])('an airborne hit at %s m/s is decided by closing speed', (speed) => {
    const h = air(622.5, 1.7, speed);
    h.rider.pos.dir = -1;
    const events: SimEvent[] = [];
    for (let t = 0; t < 90 && !events.some((e) => e.data['object'] === 'rampTruck'); t++) {
      events.push(...h.step(input(0)));
    }
    const hit = events.find((e) => e.data['object'] === 'rampTruck');
    expect(hit?.type).toBe(speed < 10 ? 'wobble' : 'crash');
    expect(Number(hit?.data['impactMps'])).toBeGreaterThan(0);
  });

  it('a stopped rider can use the existing U-turn gesture on the deck and ride back off', () => {
    const h = air(614, 2.9, 0, -1);
    for (let t = 0; t < 30 && supportKeyOf(h.world, h.rider.id) === ''; t++) h.step(input(0, 1));
    expect(supportKeyOf(h.world, h.rider.id)).toBe('d:carrier-contact');
    h.step(input(0));
    for (let t = 0; t < 6; t++) h.step(input(0, 1));
    for (let t = 0; t < 6; t++) h.step(input(0));
    for (let t = 0; t < 6; t++) h.step(input(0, 1));
    for (let t = 0; t < 90; t++) h.step(input(0, 1, 1));
    expect(h.rider.pos.dir).toBe(-1);
    for (let t = 0; t < 240; t++) h.step(input(0.3));
    expect(h.rider.pos.s).toBeLessThan(611.95);
    expect(supportKeyOf(h.world, h.rider.id)).toBe('');
  });
});
