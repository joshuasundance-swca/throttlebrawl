// What lies below a rider in the air (`EntitySnapshot.floorY`, sim/riders `floorOf`; the maintainer,
// 2026-10-06: "consistent physics and gameplay is important here so players know what to expect"):
// the world height of the surface straight under him, so a shadow falls on the roof he is over and
// the camera measures his height over it. Each case reads the snapshot the sim publishes, with the
// rule's control: the old rules (`riders.supports` 0) put the floor on the road; a rider beside the
// truck, or on the road, has none to read. Fixture road, no population, counted in sim ticks.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../../road';
import { createSimWithWorld, SIM_TUNING } from '../create';
import { placeVehicle, trafficState } from '../traffic';
import type { EntitySnapshot, SimConfig, SimRiderDef, SimTrafficTypeDef } from '../types';
import { riderState } from './index';
import { SUPPORTS_KEY } from './supports';

const BOX_TRUCK: SimTrafficTypeDef = {
  contentId: 'base:box-truck',
  category: 'truck',
  lengthM: 7.5,
  widthM: 2.4,
  heightM: 3.4,
  cruiseMps: 15,
  hazard: 'big',
};
const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'You',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike: {
    contentId: 'base:bike',
    topSpeedMps: 40,
    accelMps2: 4.2,
    brakeMps2: 9,
    steerRateMps: 5.5,
    massKg: 180,
  },
  massKg: 85,
  healthMax: 100,
};
/** The ferry deck's parked pickup (a solid hazard, 5.4 by 2.1 m, 1.9 m tall). */
const PICKUP: BakedFeature = {
  kind: 'hazard',
  id: 'deck-pickup-1',
  s0: 700,
  s1: 705.4,
  d0: 2.4,
  d1: 4.5,
  params: { solid: true, object: 'pickup', heightM: 1.9 },
};

function makeConfig(tuning: Record<string, number> = {}): SimConfig {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 2000, kappa: 0 }]);
  const road0 = bundle.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({ ...bundle, roads: [{ ...road0, features: [PICKUP], tags: [] }] });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 1980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return {
    seed: 7,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: [BOX_TRUCK],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
      'traffic.densitySame': 0,
      'traffic.densityOncoming': 0,
      ...tuning,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

/**
 * The player in the air at (s, d), `h` above the road, and a standing box truck centred at s 300 (or
 * none). Returns the snapshot's player entity and the truck's lane.
 */
function airborneOver(
  h: number,
  at: { s: number; d: number | 'truck' },
  tuning: Record<string, number> = {},
) {
  const config = makeConfig(tuning);
  const { sim, world } = createSimWithWorld(config);
  const slot = placeVehicle(world, config, { type: 0, u: 300, dir: 1, v0: 0, speed: 0 });
  const vid = trafficState(world).id[slot] ?? -1;
  const truckD = world.movers[vid]?.pos.d ?? 0;
  const m = world.movers[0];
  if (!m) throw new Error('no rider');
  m.pos.s = at.s;
  m.pos.d = at.d === 'truck' ? truckD : at.d;
  m.mode = 'Airborne';
  m.speed = 0;
  m.h = h;
  const st = riderState(world);
  st.yAbs[m.id] = config.road.surfaceHeight(0, at.s, m.pos.d) + h;
  st.vy[m.id] = 0;
  const me = (): EntitySnapshot => {
    const e = sim.snapshot().entities.find((x) => x.id === m.id);
    if (!e) throw new Error('no snapshot entity');
    return e;
  };
  return { me, world, m, sim };
}

describe('the snapshot says what lies below a rider in the air', () => {
  it('over a box truck: its roof (3.4 m), not the road under it', () => {
    const { me } = airborneOver(5, { s: 300, d: 'truck' });
    const e = me();
    console.log(`[examined] 5 m up over a box truck: y ${e.y.toFixed(2)}, floorY ${e.floorY}`);
    expect(e.mode).toBe('Airborne');
    expect(e.floorY).toBeCloseTo(3.4, 9);
    expect(e.y).toBeCloseTo(5, 9);
  });

  it('over a parked pickup (a solid hazard that holds a bike): its top, 1.9 m', () => {
    const { me } = airborneOver(4, { s: 702, d: 3.4 });
    expect(me().floorY).toBeCloseTo(1.9, 9);
  });

  it('control: with the supports off (every recording made before) the floor is the road', () => {
    const { me } = airborneOver(5, { s: 300, d: 'truck' }, { [SUPPORTS_KEY]: 0 });
    expect(me().floorY).toBe(0);
  });

  it('control: beside the truck, or past the pickup, the floor is the road', () => {
    expect(airborneOver(5, { s: 300, d: -6 }).me().floorY).toBe(0);
    expect(airborneOver(5, { s: 720, d: 3.4 }).me().floorY).toBe(0);
  });

  it('control: below the roof’s height (inside the box, about to hit it) the roof is not under him', () => {
    expect(airborneOver(2, { s: 300, d: 'truck' }).me().floorY).toBe(0);
  });

  it('control: a rider on the road has no floor to read (the field is absent, not 0)', () => {
    const config = makeConfig();
    const { sim } = createSimWithWorld(config);
    const e = sim.snapshot().entities[0];
    expect(e?.mode).toBe('Road');
    expect(e && 'floorY' in e).toBe(false);
  });

  it('reading it never changes the world: the hash is the same before and after a snapshot (no state made)', () => {
    const { me, sim } = airborneOver(5, { s: 300, d: 'truck' });
    const before = sim.hash();
    me();
    me();
    expect(sim.hash()).toBe(before);
  });
});
