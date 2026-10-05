// Playtest 3, traffic manners ("Things like bike riders cause collisions when they should arguably get
// out of the way off the sidewalk etc."; the maintainer's answer to the cyclist you still hit: you
// wobble and he topples onto the sidewalk, never a crash). Each case runs a scripted straight 1 km
// road, two 3.5 m lanes and a `town` tag (a 4 m kerb verge), with a kerb rider placed ahead of a
// player rider held at 40 m/s. What it checks, in the order of the lane's brief (T4.1):
//   - a light kerb rider (a bicycle, a scooter) steps out of the rider's way as the time to contact
//     drops under 2 s, keeps clear, is never touched, and is back on its kerb line afterwards;
//   - with no verge it hugs the edge and slows;
//   - playtest 4 (P4-3, "golf carts and similar things should swerve out of the way"): a golf cart
//     takes the verge too where there is room, on a road with a shoulder as on one without, keeping
//     its outer edge inside the smashables' line; where there is no room it hugs the edge;
//   - a rider steered into a light kerb rider only wobbles (`data.kerb`), and the cyclist topples
//     for 2 s; a solid frontal into a golf cart still crashes (the maintainer: "Keep it a crash");
//   - the sliders: `traffic.kerbYield` 0 turns the dodge off and `traffic.kerbSoft` 0 the soft
//     contact; with the keys absent a race rides exactly as before (the old rear-end crash);
//   - two runs give the same hash at every 60th tick (no RNG draws, fixed iteration order).
import { describe, expect, it } from 'vitest';
import { tuningDefaults, type LaneInfo } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  type BakedBarrier,
  type BakedNetworkBundle,
  type BakedTag,
} from '../../road';
import { createSim, SIM_TUNING } from '../create';
import { ridersSystem } from '../riders';
import { SMASH } from '../smash';
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, stepWorld, type SimSystem, type World } from '../world';
import { KERB_YIELD, takesVerge, vergeOffsetFor } from './kerb-yield';
import { kerbCd, placeVehicle, TRAFFIC, trafficState, trafficSystem } from './index';

// ---- fixtures ----------------------------------------------------------------------------

const BICYCLE: SimTrafficTypeDef = {
  contentId: 'test:bicycle',
  category: 'car',
  lengthM: 1.8,
  widthM: 0.6,
  cruiseMps: 5.5,
  hazard: 'normal',
  behaviour: { kerb: true },
};
const SCOOTER: SimTrafficTypeDef = {
  ...BICYCLE,
  contentId: 'test:scooter',
  lengthM: 1.1,
  widthM: 0.55,
  cruiseMps: 6,
  behaviour: { kerb: true, weaveM: 0.45 },
};
const GOLF_CART: SimTrafficTypeDef = {
  ...BICYCLE,
  contentId: 'test:golf-cart',
  lengthM: 2.4,
  widthM: 1.3,
  cruiseMps: 7.5,
};
const CAR: SimTrafficTypeDef = {
  contentId: 'test:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
const TYPES = [BICYCLE, SCOOTER, GOLF_CART, CAR];
const [T_BICYCLE, T_SCOOTER, T_CART] = [0, 1, 2];

/** Two 3.5 m lanes and no shoulders: the kerb is the lane's outer edge, 3.5 m from the centre line. */
const LANES: readonly LaneInfo[] = [
  { id: 'L1', dCenterM: -1.75, widthM: 3.5, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 1.75, widthM: 3.5, direction: 1, kind: 'drive' },
];
const EDGE_M = 3.5;
const NO_TRAFFIC = { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 };
const RIDER_SPEED = 40;

const bike = {
  contentId: 'base:bike',
  topSpeedMps: 45,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'Player',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 85,
  healthMax: 100,
};

interface Opts {
  /** The road's verge: a `town` tag gives the 4 m kerb band; rails on both sides give none. */
  verge?: 'town' | 'rails';
  /** 1.5 m shoulders outside both directions' lanes (the Keys roads' shape): the cart rides in one. */
  shoulder?: boolean;
  tuning?: Record<string, number>;
  /** Tuning keys left out of the config altogether, as in a race made before they existed. */
  omit?: readonly string[];
  seed?: number;
}

const SHOULDER_LANES: readonly LaneInfo[] = [
  { id: 'L0', dCenterM: -4.25, widthM: 1.5, direction: -1, kind: 'shoulder' },
  ...LANES,
  { id: 'R0', dCenterM: 4.25, widthM: 1.5, direction: 1, kind: 'shoulder' },
];
/** Where the road's drivable surface ends with the shoulders on: the verge starts here. */
const SHOULDER_EDGE_M = 5;

function bundle(verge: 'town' | 'rails', shoulder: boolean): BakedNetworkBundle {
  const b = fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0, lanes: shoulder ? SHOULDER_LANES : LANES }]);
  const tags: BakedTag[] = verge === 'town' ? [{ s0: 0, s1: 1000, side: 'both', tag: 'town' }] : [];
  const barriers: BakedBarrier[] =
    verge === 'rails' ? [{ s0: 0, s1: 1000, side: 'both', kind: 'rail', heightM: 1 }] : [];
  return { network: b.network, roads: b.roads.map((r) => ({ ...r, tags, barriers })) };
}

function makeConfig(o: Opts = {}): SimConfig {
  const road = createRoadNetwork(bundle(o.verge ?? 'town', o.shoulder ?? false));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  const tuning: Record<string, number> = {
    ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
    ...NO_TRAFFIC,
    'ground.offRoad': 1,
    ...(o.tuning ?? {}),
  };
  for (const id of o.omit ?? []) delete tuning[id];
  return {
    seed: o.seed ?? 7,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: TYPES,
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning,
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SCENARIO: SimSystem[] = [ridersSystem, trafficSystem];
const hold: SimInput = { steer: 0, throttle: 255, brake: 0, flags: 0 };

interface Scene {
  config: SimConfig;
  world: World;
  slot: number;
  /** Steps one tick with the rider held at its speed and lane position, and returns the events. */
  step(): SimEvent[];
  rider(): { u: number; d: number; speed: number };
  kerb(): { u: number; cd: number; speed: number };
}

/**
 * A kerb rider of `type` at u = 250 (the rider, held at 40 m/s in `riderD`, starts at u = 100, so
 * 150 m behind it), `riderD` from the centre line.
 */
function scene(
  type: number,
  o: Opts & { riderD?: number; riderU?: number; kerbU?: number; riderSpeed?: number } = {},
): Scene {
  const config = makeConfig(o);
  const world = createWorld(config);
  const speed = o.riderSpeed ?? RIDER_SPEED;
  const m = addMover(world, 'rider', { edge: 0, s: o.riderU ?? 100, d: o.riderD ?? 1.75, dir: 1 }, 0);
  m.speed = speed;
  for (const s of SCENARIO) s.init(world, config);
  const slot = placeVehicle(world, config, { type, u: o.kerbU ?? 250, dir: 1 });
  const st = trafficState(world);
  const d = o.riderD ?? 1.75;
  return {
    config,
    world,
    slot,
    step() {
      const mover = world.movers[0];
      if (mover) {
        mover.speed = speed;
        mover.pos.d = d;
        mover.yaw = 0;
      }
      return stepWorld(world, config, SCENARIO, [hold]);
    },
    rider: () => {
      const r = world.movers[0];
      return { u: r?.pos.s ?? 0, d: r?.pos.d ?? 0, speed: r?.speed ?? 0 };
    },
    kerb: () => ({
      u: st.u[slot] ?? 0,
      cd: st.cd[slot] ?? 0,
      speed: world.movers[st.id[slot] ?? -1]?.speed ?? -1,
    }),
  };
}

const kerbLine = (s: Scene, widthM: number) => {
  const c = trafficState(s.world).corridor;
  return kerbCd(s.config.road, c, 250, 1, widthM / 2)?.cd ?? NaN;
};

/** The kerb rider's box against the rider's box, side to side, m (negative while overlapping). */
const sideClear = (s: Scene, widthM: number) =>
  Math.abs(s.kerb().cd - s.rider().d) - (widthM + TRAFFIC.riderWidthM) / 2;

// ---- tests -------------------------------------------------------------------------------

describe('kerb riders yield (playtest 3): a bicycle steps out of the way', () => {
  const run = (type: number, widthM: number, o: Opts & { riderD?: number } = {}) => {
    const s = scene(type, o);
    const home = kerbLine(s, widthM);
    const events: SimEvent[] = [];
    let firstMove = -1;
    let ttcTick = -1;
    let passTick = -1;
    let minClear = Infinity;
    let backTick = -1;
    const cds: number[] = [];
    for (let t = 0; t < 600; t++) {
      events.push(...s.step());
      const r = s.rider();
      const k = s.kerb();
      cds.push(k.cd);
      const half = (BICYCLE.lengthM + TRAFFIC.riderLengthM) / 2;
      const closing = r.speed - k.speed;
      const ttc = (k.u - r.u - half) / closing;
      if (ttcTick < 0 && k.u > r.u && ttc <= KERB_YIELD.lookS) ttcTick = t;
      if (firstMove < 0 && Math.abs(k.cd - home) > 0.05) firstMove = t;
      if (passTick < 0 && r.u >= k.u) passTick = t;
      if (Math.abs(k.u - r.u) < (BICYCLE.lengthM + TRAFFIC.riderLengthM) / 2 + 1)
        minClear = Math.min(minClear, sideClear(s, widthM));
      if (passTick >= 0 && backTick < 0 && Math.abs(k.cd - home) <= 0.05) backTick = t;
    }
    return { s, home, events, firstMove, ttcTick, passTick, minClear, backTick, cds };
  };

  it('starts to move when the time to contact drops to 2 s, within a tick', () => {
    const r = run(T_BICYCLE, BICYCLE.widthM);
    expect(r.ttcTick).toBeGreaterThan(0);
    expect(r.firstMove).toBeGreaterThan(0);
    expect(Math.abs(r.firstMove - r.ttcTick)).toBeLessThanOrEqual(1);
  });

  it('steps onto the verge (clear of the rider and inside the smashables line) and is never touched', () => {
    const r = run(T_BICYCLE, BICYCLE.widthM);
    expect(r.passTick).toBeGreaterThan(0);
    expect(r.minClear).toBeGreaterThanOrEqual(0.4);
    // 0.2 m past the road edge, its outer edge no further out than the smashables' inner line.
    const far = Math.max(...r.cds);
    expect(far - EDGE_M - BICYCLE.widthM / 2).toBeCloseTo(0.2, 6);
    expect(far + BICYCLE.widthM / 2 - EDGE_M).toBeLessThanOrEqual(SMASH.gapM + 1e-9);
    expect(r.events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
  });

  it('is back on its kerb line within 120 ticks of the pass', () => {
    const r = run(T_BICYCLE, BICYCLE.widthM);
    expect(r.backTick).toBeGreaterThan(0);
    expect(r.backTick - r.passTick).toBeLessThanOrEqual(120);
  });

  it('the verge spot clears the smashables line for every light width', () => {
    // dInner + (w/2 + 0.2) + w/2 = dInner + w + 0.2: under the smashables' 0.9 m gap up to 0.7 m wide.
    for (const w of [0.55, 0.6, 0.7]) {
      expect(w + KERB_YIELD.vergeOffsetM).toBeLessThanOrEqual(SMASH.gapM + 1e-9);
    }
    expect(KERB_YIELD.softMaxWidthM).toBeLessThanOrEqual(0.8);
  });

  it('slows to 0.6 of its cruise speed within 30 ticks, with rails on both sides it hugs the edge', () => {
    const s = scene(T_BICYCLE, { verge: 'rails' });
    const home = kerbLine(s, BICYCLE.widthM);
    let start = -1;
    let slowBy = -1;
    let far = 0;
    for (let t = 0; t < 400; t++) {
      s.step();
      const k = s.kerb();
      if (start < 0 && Math.abs(k.cd - home) > 0.05) start = t;
      if (start >= 0 && slowBy < 0 && k.speed <= 0.6 * BICYCLE.cruiseMps + 0.05) slowBy = t;
      far = Math.max(far, k.cd + BICYCLE.widthM / 2);
      expect(k.cd + BICYCLE.widthM / 2).toBeLessThanOrEqual(EDGE_M + 1e-9);
    }
    expect(start).toBeGreaterThan(0);
    expect(slowBy).toBeGreaterThan(0);
    expect(slowBy - start).toBeLessThanOrEqual(30);
    // The hug: 0.05 m off the edge.
    expect(EDGE_M - far).toBeCloseTo(KERB_YIELD.hugM, 6);
  });

  it('a golf cart with no verge stays inside the road, and a solid frontal still crashes the rider', () => {
    const s = scene(T_CART, { verge: 'rails' });
    for (let t = 0; t < 600; t++) {
      s.step();
      expect(s.kerb().cd + GOLF_CART.widthM / 2).toBeLessThanOrEqual(EDGE_M + 1e-9);
    }
    // Not soft: yielding off, the rider meets its tail at 40 m/s and it is still a crash.
    const hit = scene(T_CART, { tuning: { 'traffic.kerbYield': 0 }, riderD: 2.85 });
    const events: SimEvent[] = [];
    for (let t = 0; t < 600 && !events.some((e) => e.type === 'crash'); t++) events.push(...hit.step());
    const crash = events.find((e) => e.type === 'crash');
    expect(crash?.data['cause']).toBe('traffic');
    expect(crash?.data['kerb']).toBeUndefined();
    expect(events.filter((e) => e.type === 'wobble')).toEqual([]);
  });

  it('a golf cart takes the verge where there is room, inside the smashables line (P4-3)', () => {
    const s = scene(T_CART);
    const events: SimEvent[] = [];
    const home = kerbLine(s, GOLF_CART.widthM);
    let far = -Infinity;
    let minClear = Infinity;
    for (let t = 0; t < 600; t++) {
      events.push(...s.step());
      far = Math.max(far, s.kerb().cd);
      if (Math.abs(s.kerb().u - s.rider().u) < (GOLF_CART.lengthM + TRAFFIC.riderLengthM) / 2 + 1)
        minClear = Math.min(minClear, sideClear(s, GOLF_CART.widthM));
    }
    // Past the road's edge, not just hugging it, and its outer edge stops at the smashables' line.
    expect(far).toBeGreaterThan(home + 0.5);
    expect(far - GOLF_CART.widthM / 2).toBeLessThan(EDGE_M);
    expect(far + GOLF_CART.widthM / 2).toBeCloseTo(EDGE_M + SMASH.gapM, 6);
    expect(minClear).toBeGreaterThanOrEqual(0.4);
    expect(events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
  });

  describe('a shoulder road (the Keys shape): the cart rides in the shoulder and moves onto the verge', () => {
    const run = (riderD: number, riderSpeed: number, tuning: Record<string, number> = {}) => {
      const s = scene(T_CART, { shoulder: true, riderD, riderSpeed, tuning });
      const events: SimEvent[] = [];
      const home = kerbLine(s, GOLF_CART.widthM);
      let far = -Infinity;
      let minClear = Infinity;
      let passed = false;
      // 150 m at 20 m/s against a cart at 7.5 m/s takes 12 s (720 ticks), then the cart returns.
      for (let t = 0; t < 1000; t++) {
        events.push(...s.step());
        far = Math.max(far, s.kerb().cd);
        if (s.rider().u >= s.kerb().u) passed = true;
        if (Math.abs(s.kerb().u - s.rider().u) < (GOLF_CART.lengthM + TRAFFIC.riderLengthM) / 2 + 1)
          minClear = Math.min(minClear, sideClear(s, GOLF_CART.widthM));
      }
      return { s, events, home, far, minClear, passed };
    };

    it('rides in the middle of the shoulder when not dodging', () => {
      const s = scene(T_CART, { shoulder: true });
      expect(kerbLine(s, GOLF_CART.widthM)).toBeCloseTo(4.25, 6);
    });

    // A rider on the cart's own line used to meet it end-on: the dodge moved the cart 5 cm. Now the cart
    // is 1.0 m further out (its outer edge on the prop line, the most the verge may give it), so a
    // rider on the shoulder's inner half is never touched.
    for (const speed of [20, 35]) {
      it(`a rider on the shoulder's inner half closing at ${speed} m/s never touches it`, () => {
        const r = run(3.6, speed);
        expect(r.passed).toBe(true);
        expect(r.events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
        expect(r.far).toBeGreaterThan(r.home + 0.9);
        expect(r.far + GOLF_CART.widthM / 2).toBeCloseTo(SHOULDER_EDGE_M + SMASH.gapM, 6);
        expect(r.minClear).toBeGreaterThanOrEqual(0.4);
      });

      // Dead on the cart's line the boxes still just touch beside each other, so there may be a side
      // brush or a graze (a wobble, as for any vehicle) as the rider passes, but never the end-on crash it had before.
      it(`a rider on the cart's own line closing at ${speed} m/s is not crashed into it`, () => {
        const r = run(4.25, speed);
        expect(r.passed).toBe(true);
        expect(r.events.filter((e) => e.type === 'crash')).toEqual([]);
        const hits = r.events.filter((e) => e.type === 'wobble').map((e) => e.data['hit']);
        expect(hits.every((h) => h === 'side' || h === 'graze')).toBe(true);
        expect(r.far).toBeGreaterThan(r.home + 0.9);
        expect(r.far + GOLF_CART.widthM / 2).toBeLessThanOrEqual(SHOULDER_EDGE_M + SMASH.gapM + 1e-9);
      });
    }

    it('a rider in the lane never makes it move', () => {
      const r = run(2.0, 35);
      expect(r.far).toBeCloseTo(r.home, 6);
      expect(r.events).toEqual([]);
    });

    it('it is back on its line after the rider has passed', () => {
      const r = run(4.25, 20);
      expect(r.s.kerb().cd).toBeCloseTo(r.home, 3);
    });

    it('yielding off, the same rider still crashes into it from behind (a solid rear-end stays a crash)', () => {
      const r = run(4.25, 20, { 'traffic.kerbYield': 0 });
      expect(r.events.some((e) => e.type === 'crash' && e.data['cause'] === 'traffic')).toBe(true);
    });
  });

  it('every kerb type may take a verge with room for it, and no other', () => {
    for (const t of [BICYCLE, SCOOTER, GOLF_CART]) {
      expect(takesVerge(t, t.widthM + KERB_YIELD.vergeSpareM)).toBe(true);
      expect(takesVerge(t, t.widthM + KERB_YIELD.vergeSpareM - 0.05)).toBe(false);
    }
  });

  it('the verge spot keeps any kerb type inside the smashables line, and a light one where it was', () => {
    for (const w of [0.55, 0.6, 0.7, 1.3]) {
      expect(vergeOffsetFor(w) + w / 2).toBeLessThanOrEqual(SMASH.gapM + 1e-9);
    }
    // The light widths ride exactly 0.2 m past the edge, as in playtest 3.
    for (const w of [0.55, 0.6, 0.7])
      expect(vergeOffsetFor(w)).toBeCloseTo(w / 2 + KERB_YIELD.vergeOffsetM, 9);
    expect(KERB_YIELD.propLineM).toBe(SMASH.gapM);
  });

  it('a rider on the verge: the bicycle stays inside the road', () => {
    const s = scene(T_BICYCLE, { riderD: EDGE_M + 0.5 });
    let moved = false;
    for (let t = 0; t < 600; t++) {
      s.step();
      expect(s.kerb().cd + BICYCLE.widthM / 2).toBeLessThanOrEqual(EDGE_M + 1e-9);
      if (t > 60 && s.kerb().u < s.rider().u) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('the weaving scooter dodges too, and stays out of the rider', () => {
    const s = scene(T_SCOOTER);
    const events: SimEvent[] = [];
    let minClear = Infinity;
    let passed = false;
    for (let t = 0; t < 400; t++) {
      events.push(...s.step());
      if (!passed && s.rider().u >= s.kerb().u) passed = true;
      if (Math.abs(s.rider().u - s.kerb().u) < (SCOOTER.lengthM + TRAFFIC.riderLengthM) / 2 + 1)
        minClear = Math.min(minClear, sideClear(s, SCOOTER.widthM));
    }
    expect(passed).toBe(true);
    expect(minClear).toBeGreaterThanOrEqual(0.4);
    expect(events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
  });

  it('a rider coming the other way past a kerb rider on a narrow road also clears it', () => {
    // The kerb rider heads +u at the kerb on one side; the player rides -u in the other lane. Their
    // boxes are 4 m apart, so there is no threat and no move.
    const config = makeConfig();
    const world = createWorld(config);
    const m = addMover(world, 'rider', { edge: 0, s: 400, d: -1.75, dir: -1 }, 0);
    m.speed = RIDER_SPEED;
    for (const s of SCENARIO) s.init(world, config);
    const slot = placeVehicle(world, config, { type: T_BICYCLE, u: 250, dir: 1 });
    const st = trafficState(world);
    const home = st.cd[slot] ?? 0;
    for (let t = 0; t < 200; t++) {
      const mover = world.movers[0];
      if (mover) {
        mover.speed = RIDER_SPEED;
        mover.pos.d = -1.75;
      }
      stepWorld(world, config, SCENARIO, [hold]);
    }
    expect(st.cd[slot]).toBeCloseTo(home, 6);
  });
});

describe('kerb riders: soft contact (a clipped cyclist topples, you only wobble)', () => {
  /** Yielding off, so the rider really meets it; the rider rides at the kerb line. */
  const clip = (type: number, tuning: Record<string, number> = {}) => {
    const s = scene(type, { tuning: { 'traffic.kerbYield': 0, ...tuning }, riderD: 2.95 });
    const events: SimEvent[] = [];
    const speeds: number[] = [];
    const cds: number[] = [];
    let hitTick = -1;
    for (let t = 0; t < 500; t++) {
      events.push(...s.step());
      if (hitTick < 0 && events.some((e) => e.type === 'wobble' || e.type === 'crash')) hitTick = t;
      speeds.push(s.kerb().speed);
      cds.push(s.kerb().cd);
    }
    return { s, events, speeds, cds, hitTick };
  };

  it('a rear-end into a bicycle at 40 m/s is a wobble with data.kerb, never a crash', () => {
    const r = clip(T_BICYCLE);
    expect(r.events.filter((e) => e.type === 'crash')).toEqual([]);
    const wobbles = r.events.filter((e) => e.type === 'wobble');
    expect(wobbles).toHaveLength(1);
    const data = wobbles[0]?.data ?? {};
    expect(data['cause']).toBe('traffic');
    expect(data['kerb']).toBe(true);
    expect(data['contact']).toBe('wobble');
    expect(data['vehicle']).toBe(BICYCLE.contentId);
    expect(data['hit']).toBe('frontal');
    expect(Number(data['impactMps'])).toBeGreaterThan(30);
    expect(wobbles[0]?.target).toBe(trafficState(r.s.world).id[r.s.slot]);
  });

  it('the rider keeps 85 % of its speed and is unstable afterwards', () => {
    const s = scene(T_BICYCLE, { tuning: { 'traffic.kerbYield': 0 }, riderD: 2.95 });
    let before = 0;
    let after = -1;
    for (let t = 0; t < 500 && after < 0; t++) {
      before = s.rider().speed;
      const ev = s.step();
      if (ev.some((e) => e.type === 'wobble')) after = s.rider().speed;
    }
    expect(after).toBeGreaterThan(0);
    expect(after).toBeCloseTo(before * KERB_YIELD.bumpScrub, 0);
    expect(after).toBeLessThan(RIDER_SPEED * KERB_YIELD.bumpScrub + 0.1);
    expect(trafficState(s.world).unstableS[0]).toBeGreaterThan(1);
  });

  it('the bicycle topples: speed 0 for 2 s, pushed outward onto the verge, then it rides on', () => {
    const r = clip(T_BICYCLE);
    const first = r.speeds.findIndex((v, i) => i >= r.hitTick && v === 0);
    expect(first).toBeGreaterThanOrEqual(r.hitTick);
    const lying = r.speeds.slice(first).findIndex((v) => v > 0);
    expect(lying).toBeGreaterThanOrEqual(118);
    expect(lying).toBeLessThanOrEqual(124);
    // Pushed outward past the road edge and inside the verge's 4 m.
    const cds = r.cds.slice(r.hitTick, r.hitTick + 100);
    const out = Math.max(...cds);
    expect(out - BICYCLE.widthM / 2).toBeGreaterThan(EDGE_M);
    expect(out + BICYCLE.widthM / 2).toBeLessThanOrEqual(EDGE_M + 4);
    // It rides on afterwards, and is back on its kerb line later.
    expect(r.speeds[r.speeds.length - 1]).toBeGreaterThan(0);
  });

  it('a toppled cyclist is skipped by contacts: no second event while it lies there', () => {
    const r = clip(T_BICYCLE);
    expect(r.events.filter((e) => e.type === 'wobble' || e.type === 'crash')).toHaveLength(1);
  });

  it('with kerbSoft at 0 the old rules stand: the rear-end crashes the rider', () => {
    const r = clip(T_BICYCLE, { 'traffic.kerbSoft': 0 });
    expect(r.events.some((e) => e.type === 'crash')).toBe(true);
    expect(r.events.filter((e) => e.type === 'wobble' && e.data['kerb'] === true)).toEqual([]);
  });

  it('with both keys absent a race rides as before: the old rear-end crash is pinned', () => {
    const s = scene(T_BICYCLE, { riderD: 2.95, omit: ['traffic.kerbYield', 'traffic.kerbSoft'] });
    const events: SimEvent[] = [];
    for (let t = 0; t < 500 && !events.some((e) => e.type === 'crash'); t++) events.push(...s.step());
    const crash = events.find((e) => e.type === 'crash');
    expect(crash?.data['hit']).toBe('frontal');
    expect(crash?.data['kerb']).toBeUndefined();
    expect(events.filter((e) => e.type === 'wobble')).toEqual([]);
    // And the cyclist did not move out of the way, nor topple.
    expect(trafficState(s.world).toppleS.every((v) => (v ?? 0) === 0)).toBe(true);
    expect(s.kerb().cd).toBeCloseTo(kerbLine(s, BICYCLE.widthM), 6);
  });
});

describe('kerb riders: determinism', () => {
  it('two runs give equal hashes at every 60th tick, yielding and toppling included', () => {
    const run = () => {
      const config = makeConfig({ tuning: { 'traffic.densitySame': 1, 'traffic.densityOncoming': 1 } });
      const sim = createSim({ ...config, trafficTypes: TYPES });
      const hashes: number[] = [];
      for (let t = 0; t < 60 * 40; t++) {
        sim.step([{ steer: Math.round(Math.sin(t / 90) * 8), throttle: 255, brake: 0, flags: 0 }]);
        if (t % 60 === 0) hashes.push(sim.hash());
      }
      return hashes;
    };
    expect(run()).toEqual(run());
  }, 60_000);
});
