// Dial-Up's road-wide swerve shows in traffic (W-S follow-up). The weaver (Dial-Up) "swerves across
// the road, not just its lane" (rivals-1). On a clear road it did; in traffic it hardly showed: over
// 10 SF races he spent no more time out of his lane with the quirks on than off (34 % against 36 %,
// the main-green-2 report). Every oncoming car within about 150 m (2.5 s of closing) made the
// road-wide line unsafe, and he then fell back to the plain centre of his lane: no swerve at all, less
// than the quirks-off in-lane weave. Now a blocked road-wide line falls back to the widest swerve
// that is clear: across his own side of the road (his lanes and the shoulder), then inside his lane.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import { raceSystem } from '../race';
import { ridersSystem } from '../riders';
import { trafficSystem } from '../traffic';
import type { SimConfig, SimRiderDef } from '../types';
import {
  addMover,
  createWorld,
  orderSystems,
  stepWorld,
  TICK_ORDER,
  type SimSystem,
  type SystemName,
} from '../world';
import { aiSystem } from './index';

const noop = (name: SystemName): SimSystem => ({ name, init() {}, step() {} });
const REAL: Partial<Record<SystemName, SimSystem>> = {
  controllers: aiSystem,
  riders: ridersSystem,
  traffic: trafficSystem,
  race: raceSystem,
};
const SYSTEMS = orderSystems(TICK_ORDER.map((n) => REAL[n] ?? noop(n)));

const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 4000, kappa: 0 }]));
const route = createRouteProgress(road, {
  id: 'r',
  network: 'fixture',
  start: { road: 'a', s: 20, dir: 1 },
  finish: { road: 'a', s: 3960 },
  mainPath: ['a'],
  allowedRoads: ['a'],
  closed: false,
});
const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const WEAVER: SimRiderDef = {
  contentId: 'base:dial-up',
  name: 'Dial-Up',
  role: 'rival',
  faction: 'rider',
  controller: { kind: 'ai', style: 'weaver' },
  bike,
  massKg: 90,
  healthMax: 100,
};
const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'You',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 80,
  healthMax: 100,
};

/** Fixture lanes: his (R1) is d 0 to 3.4, centre 1.7. */
const LANE_LO = 0;
const LANE_HI = 3.4;

function config(seed: number, quirks: number): SimConfig {
  return {
    seed,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [1],
      raceEndTimeoutTicks: 1800,
    },
    riders: [WEAVER, PLAYER],
    weapons: [],
    trafficTypes: [
      {
        contentId: 'base:car',
        category: 'car',
        lengthM: 4.5,
        widthM: 1.9,
        cruiseMps: 24.6,
        hazard: 'normal',
      },
      { contentId: 'base:van', category: 'car', lengthM: 5.4, widthM: 2.1, cruiseMps: 22, hazard: 'normal' },
    ],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      'riders.steerScale': 1,
      'ai.paceScale': 1,
      'ai.aggressionScale': 1,
      'ai.styleQuirks': quirks,
      'traffic.density': 1.5,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

interface Ride {
  /** Share of ticks with him outside his own lane. */
  outShare: number;
  /** Mean lateral speed, m/s. */
  swayMps: number;
  /** His crashes and wobbles off traffic. */
  contacts: number;
  /** Ticks with an oncoming car within 150 m ahead of him (traffic he rides in). */
  oncomingTicks: number;
  ticks: number;
}

/** One minute of Dial-Up riding alone in two-way traffic (the player waits 500 m back). */
function ride(seed: number, quirks: number): Ride {
  const cfg = config(seed, quirks);
  const world = createWorld(cfg);
  const me = addMover(world, 'rider', { edge: 0, s: 600, d: 1.7, dir: 1 }, 0);
  me.speed = 28;
  addMover(world, 'rider', { edge: 0, s: 100, d: 1.7, dir: 1 }, 1);
  for (const s of SYSTEMS) s.init(world, cfg);
  let out = 0;
  let sway = 0;
  let oncoming = 0;
  let contacts = 0;
  let ticks = 0;
  let lastD = me.pos.d;
  for (let t = 0; t < 60 * 60; t++) {
    const events = stepWorld(world, cfg, SYSTEMS, [{ steer: 0, throttle: 0, brake: 255, flags: 0 }]);
    for (const e of events)
      if ((e.type === 'crash' || e.type === 'wobble') && e.actor === me.id && e.data['cause'] === 'traffic')
        contacts++;
    if (t < 180 || me.mode !== 'Road') {
      lastD = me.pos.d;
      continue;
    }
    ticks++;
    if (me.pos.d < LANE_LO || me.pos.d > LANE_HI) out++;
    sway += Math.abs(me.pos.d - lastD) * 60;
    lastD = me.pos.d;
    for (const v of world.movers) {
      if (v.kind !== 'vehicle' || v.pos.dir === me.pos.dir) continue;
      const ahead = v.pos.s - me.pos.s;
      if (ahead > 0 && ahead < 150) {
        oncoming++;
        break;
      }
    }
  }
  return {
    outShare: out / Math.max(1, ticks),
    swayMps: sway / Math.max(1, ticks),
    contacts,
    oncomingTicks: oncoming,
    ticks,
  };
}

const SEEDS = [1, 2, 3, 4, 5, 6];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => sum(xs) / Math.max(1, xs.length);

describe("ai: Dial-Up's road-wide swerve shows in traffic (W-S follow-up)", () => {
  it('in two-way traffic the quirk still takes him out of his lane and sways him well past the quirks-off weave', () => {
    const on = SEEDS.map((s) => ride(s, 1));
    const off = SEEDS.map((s) => ride(s, 0));
    const onOut = mean(on.map((r) => r.outShare));
    const offOut = mean(off.map((r) => r.outShare));
    const onSway = mean(on.map((r) => r.swayMps));
    const offSway = mean(off.map((r) => r.swayMps));
    const busy = mean(on.map((r) => r.oncomingTicks / Math.max(1, r.ticks)));
    console.log(
      `[weaver-traffic] ${SEEDS.length} seeds, a minute each: oncoming car within 150 m ${(busy * 100).toFixed(0)} % of the time; ` +
        `out of his lane ${(onOut * 100).toFixed(1)} % with quirks on, ${(offOut * 100).toFixed(1)} % off; ` +
        `sway ${onSway.toFixed(2)} m/s on, ${offSway.toFixed(2)} m/s off; ` +
        `traffic contacts ${sum(on.map((r) => r.contacts))} on, ${sum(off.map((r) => r.contacts))} off`,
    );
    // The road really is busy: an oncoming car is near for most of the minute.
    expect(busy).toBeGreaterThan(0.5);
    // Bands, not floors at the measured rate (W-S measured 1.01 against 0.49 m/s, and 51 % against
    // 41 % out of his lane; before the fix 0.50 against 0.49 m/s): clearly more sway, more time out
    // of his lane, and the show costs no extra brushes with traffic.
    expect(onSway).toBeGreaterThan(offSway * 1.5);
    expect(onOut).toBeGreaterThan(offOut + 0.05);
    expect(sum(on.map((r) => r.contacts))).toBeLessThanOrEqual(sum(off.map((r) => r.contacts)) + 1);
  });
});
