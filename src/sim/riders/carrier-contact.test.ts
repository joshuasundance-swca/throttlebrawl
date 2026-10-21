import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  highwayLanes,
  type BakedFeature,
} from '../../road';
import type { SimConfig, SimEvent } from '../types';
import { worldHash } from '../world';
import { riderState } from './index';
import { RIDER_CONTACT_HALF_WIDTH_M } from './contact';
import { carrierTopAt } from './carrier-shape';
import { deckHeight } from './features';
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
function config(features: BakedFeature[] = [TRUCK], wideRoad = false): SimConfig {
  const base = testConfig();
  const bundle = fixtureNetwork([
    { id: 'a', lengthM: 3000, kappa: 0, ...(wideRoad ? { lanes: highwayLanes(2) } : {}) },
  ]);
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
  it('keeps the thin raised trailer rail solid without treating it as rideable ground', () => {
    const cfg = config([TRUCK], true);
    const s = TRUCK.s0 + 9;
    const d = D + 1.33;
    const railTop = carrierTopAt(TRUCK, s, d);
    expect(railTop).toBeGreaterThan(2);
    expect(deckHeight(cfg, 0, s, d, { bodies: false })).toBe(0);

    const h = riderHarness(cfg, { s, d, speed: 0 });
    h.rider.mode = 'Airborne';
    h.rider.h = railTop + 0.01;
    const st = riderState(h.world);
    st.yAbs[h.rider.id] = cfg.road.surfaceHeight(0, s, d) + h.rider.h;
    st.vy[h.rider.id] = -1;
    const events = h.step(input(0));
    expect(events.some((event) => event.type === 'land')).toBe(false);
    expect(h.rider.mode).toBe('Airborne');
  });
  it('records the ramp actually ridden off and forgets it on landing', () => {
    const cfg = config([TRUCK], true);
    const s = TRUCK.s0 + 9;
    const d = TRUCK.d1 - 0.05;
    const h = riderHarness(cfg, { s, d, speed: 34.4, yaw: 0.12 });
    const st = riderState(h.world);
    h.rider.h = deckHeight(cfg, 0, s, d, { bodies: false });
    st.yAbs[h.rider.id] = cfg.road.surfaceHeight(0, s, d) + h.rider.h;
    st.vy[h.rider.id] = (34.4 * 2.8) / 11.5;
    st.lastTick[h.rider.id] = h.world.tick - 1;
    const first = h.step(input(0, 0, 1));
    expect(
      first.some((event) => event.type === 'jump'),
      JSON.stringify(first),
    ).toBe(true);
    expect(st.rampLaunch[h.rider.id]).toBe(`0:${TRUCK.id}`);
    let landed = false;
    for (let t = 0; t < 180 && !landed; t++) landed = h.step(input(0)).some((event) => event.type === 'land');
    expect(landed).toBe(true);
    expect(st.rampLaunch[h.rider.id]).toBeNull();
  });
  it.each([
    { origin: null, vy: 6, clears: false },
    { origin: '0:other-truck', vy: 6, clears: false },
    { origin: `0:${TRUCK.id}`, vy: -6, clears: false },
    { origin: `0:${TRUCK.id}`, vy: 6, clears: true },
  ])(
    'limits the rising rail step to an actual same-truck takeoff: $origin, vy $vy',
    ({ origin, vy, clears }) => {
      const cfg = config([TRUCK], true);
      const s = TRUCK.s0 + 10.3;
      const d = D + 1.33;
      const h = riderHarness(cfg, { s, d, speed: 34.4 });
      h.rider.mode = 'Airborne';
      h.rider.h = 2.6;
      const st = riderState(h.world);
      st.yAbs[h.rider.id] = cfg.road.surfaceHeight(0, s, d) + h.rider.h;
      st.vy[h.rider.id] = vy;
      st.rampLaunch[h.rider.id] = origin;
      const withOrigin = worldHash(h.world);
      st.rampLaunch[h.rider.id] = null;
      if (origin !== null) expect(worldHash(h.world)).not.toBe(withOrigin);
      st.rampLaunch[h.rider.id] = origin;
      const events = h.step(input(0));
      const hit = events.find((event) => event.data['object'] === 'rampTruck');
      expect(Boolean(hit), JSON.stringify(events)).toBe(!clears);
      if (!clears && vy > 0) expect(hit?.type).toBe('crash');
      if (clears) expect(h.rider.speed).toBeGreaterThan(30);
    },
  );
  it('a rider below road height still clears the parked cab mirror after its overlapping roof', () => {
    const h = riderHarness(config([TRUCK], true), {
      s: TRUCK.s0 + 18.78,
      d: D + 1.3,
      speed: 0,
    });
    h.rider.mode = 'Airborne';
    h.rider.h = -2;
    const st = riderState(h.world);
    st.yAbs[h.rider.id] = h.config.road.surfaceHeight(0, h.rider.pos.s, h.rider.pos.d) - 2;
    st.vy[h.rider.id] = 0;
    h.step(input(0));
    expect(
      h.rider.pos.d,
      'the mirror outside the roof remains solid below road height',
    ).toBeGreaterThanOrEqual(D + 1.4 + RIDER_CONTACT_HALF_WIDTH_M - 0.02);
  });
  it('meets a wide trailer side sill before the bike enters the drawn rail', () => {
    const wide: BakedFeature = { ...TRUCK, id: 'wide-side-sill', d0: -3, d1: 3 };
    const h = riderHarness(config([wide], true), { s: wide.s0 + 8.2, d: 4.8, speed: 8, yaw: -1.2 });
    h.rider.mode = 'Airborne';
    h.rider.h = 0.6;
    const st = riderState(h.world);
    st.yAbs[h.rider.id] = h.config.road.surfaceHeight(0, h.rider.pos.s, h.rider.pos.d) + h.rider.h;
    st.vy[h.rider.id] = 0;
    const contactAt = (1.39 * (wide.d1 - wide.d0)) / 2.5 + 0.4;
    let met = false;
    for (let t = 0; t < 20 && !met; t++) {
      const events = h.step(input(0));
      met = events.some((event) => event.data['object'] === 'rampTruck');
      if (h.rider.pos.d < contactAt - 0.15) {
        expect(
          met,
          `bike entered the drawn side sill at tick ${t}: d=${h.rider.pos.d.toFixed(3)}, h=${h.rider.h.toFixed(3)}, events=${events.map((event) => event.type).join(',')}`,
        ).toBe(true);
      }
    }
    expect(met).toBe(true);
  });
  it('keeps the open air below a raised rail while meeting the actual nearby post', () => {
    const wide: BakedFeature = { ...TRUCK, id: 'wide-post-gap', d0: -3, d1: 3 };
    const probe = (into: number) => {
      const h = riderHarness(config([wide], true), { s: wide.s0 + into, d: 3.5, speed: 0 });
      h.rider.mode = 'Airborne';
      h.rider.h = 0.85;
      const st = riderState(h.world);
      st.yAbs[h.rider.id] = h.config.road.surfaceHeight(0, h.rider.pos.s, h.rider.pos.d) + h.rider.h;
      st.vy[h.rider.id] = 0;
      const events = h.step(input(0));
      return { d: h.rider.pos.d, events };
    };
    const gap = probe(15.3);
    expect(
      gap.d,
      `air between side sill and upper rail remains passable; events ${JSON.stringify(gap.events)}`,
    ).toBeCloseTo(3.5, 3);
    expect(gap.events.some((event) => event.data['object'] === 'rampTruck')).toBe(false);
    const post = probe(14);
    expect(post.d, 'the vertical post is physical in the same height band').toBeGreaterThan(3.7);
  });
  it.each([0, 0.1, 0.2, 0.3].flatMap((offset) => ([1, -1] as const).map((facing) => ({ offset, facing }))))(
    'leaves a continuous ramp along its lip tangent at offset $offset m, facing $facing',
    ({ offset, facing }) => {
      const truck: BakedFeature = {
        ...TRUCK,
        s1: 627.5,
        params: { rampLengthM: 15, lipHeightM: 2.8, facing },
      };
      const h = riderHarness(config([truck]), {
        s: facing === 1 ? 598 + offset : 629.5 - offset,
        d: D,
        speed: 24,
        dir: facing,
      });
      let jump: SimEvent | undefined;
      for (let t = 0; t < 100 && !jump; t++) jump = h.step(input(1)).find((e) => e.type === 'jump');
      expect(jump).toBeDefined();
      // This straight drawn ramp rises 2.8 m over 15 m. Its launch tangent cannot shrink with the
      // fraction of a sim tick spent beyond the lip on the flat platform.
      expect(Number(jump?.data['vyMps'])).toBeCloseTo((Number(jump?.data['speed']) * 2.8) / 15, 6);
    },
  );

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
    riderState(h.world).rampLaunch[h.rider.id] = `0:${TRUCK.id}`;
    const events: SimEvent[] = [];
    for (let t = 0; t < 90 && !events.some((e) => e.data['object'] === 'rampTruck'); t++) {
      events.push(...h.step(input(0)));
    }
    const hit = events.find((e) => e.data['object'] === 'rampTruck');
    expect(hit?.type).toBe(speed < 10 ? 'wobble' : 'crash');
    expect(Number(hit?.data['impactMps'])).toBeGreaterThan(0);
    if (speed >= 10) expect(riderState(h.world).rampLaunch[h.rider.id]).toBeNull();
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
