// A cop rides round traffic (W-S follow-up). In a San Francisco race (seed 7, a player trying to
// steal the cop's baton) the cops hit traffic 13 times, one sedan three times and a box truck twice.
// Two causes, both fixed here:
// - A cop who had moved in alongside his man stayed "moving in" after the man got away (or after
//   the cop was knocked off), so from 100 to 300 m back he rode the man's line, in the traffic
//   lane, at his pursuit burst (59 m/s), into the back of the car ahead; got back on behind it, and
//   did it again. The move-in now ends once his man is out of reach ahead.
// - A cop never looked at the cars: on the centre line between both ways a small drift met a
//   mirror. Now he sees the cars ahead in his line: he goes round one on a side that is clear, or
//   follows it until one is, and never steers into one alongside.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type RoadPos } from '../../road';
import { SIM_TUNING, type SimConfig, type SimEvent, type SimRiderDef, type SimTrafficTypeDef } from '../api';
import { ridersSystem } from '../riders';
import { placeVehicle, trafficState, trafficSystem } from '../traffic';
import { tumbleSystem } from '../tumble';
import { addMover, createWorld, stepWorld, type World } from '../world';
import { COP_CHASING, copsState, copsSystem } from './index';

const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
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
const COP: SimRiderDef = {
  contentId: 'base:sgt-pruitt',
  name: 'Sgt. Pruitt',
  role: 'cop',
  faction: 'law',
  controller: { kind: 'cop' },
  bike: { ...bike, topSpeedMps: 38 * 1.05 },
  massKg: 95,
  healthMax: 100,
  law: { agency: 'base:test', bustRadiusM: 14, bustDwellS: 1, fineCash: 400, pursuitSpeedScale: 1.05 },
};
/** A slow car that keeps its lane, so the pass is exactly the one set up. */
const CAR: SimTrafficTypeDef = {
  contentId: 'base:sedan',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 11,
  hazard: 'normal',
  behaviour: { laneChanges: false },
};

function config(): SimConfig {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 3000, kappa: 0 }]));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 2980 },
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
    riders: [PLAYER, COP],
    weapons: [],
    trafficTypes: [CAR],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
      'cops.spawnDelayS': 0,
      'cops.sirenLeadS': 0,
      'traffic.densitySame': 0,
      'traffic.densityOncoming': 0,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SYSTEMS = [ridersSystem, copsSystem, trafficSystem, tumbleSystem];

/**
 * The player rides the centre line (as the dev bot did in the SF race) at `playerMps` (held by
 * throttle), the cop chases from behind in the lane at the player's speed, and slow cars sit in the
 * lane between them (`cars`: metres ahead of the cop; `oncoming`:
 * metres ahead of the cop of cars coming the other way in the other lane; `heat`: he is a heat cop,
 * so he bursts; `movedIn`: he was moving in alongside when the player got away). The player starts
 * 150 m ahead with `heat` or `movedIn`, else 100 m. Returns the cop's contacts with traffic over
 * `seconds`, how far he ended behind the player, and his move-in state.
 */
function chase(o: {
  cars: number[];
  oncoming?: number[];
  playerMps?: number;
  seconds?: number;
  heat?: boolean;
  movedIn?: boolean;
}) {
  const cfg = config();
  const world: World = createWorld(cfg);
  const at = (s: number, d: number): RoadPos => ({ edge: 0, s, d, dir: 1 });
  const me = addMover(world, 'rider', at(o.heat || o.movedIn ? 350 : 300, 0), 0);
  const cop = addMover(world, 'rider', at(200, 1.7), 1);
  me.speed = o.playerMps ?? 24;
  cop.speed = 24;
  for (const s of SYSTEMS) s.init(world, cfg);
  // A heat cop (playtest 2) closes with a pursuit burst well above his top speed: the SF hits came
  // from those bursts, and from a cop back on his bike in the lane behind the car he had just hit.
  const cs = copsState(world);
  if (o.heat) cs.heatCop[cop.id] = 1;
  if (o.movedIn) {
    cs.phase[cop.id] = COP_CHASING;
    cs.target[cop.id] = me.id;
    cs.closing[cop.id] = 1;
  }
  for (const ahead of o.cars) placeVehicle(world, cfg, { type: 0, u: 200 + ahead, dir: 1, rank: 0 });
  for (const ahead of o.oncoming ?? [])
    placeVehicle(world, cfg, { type: 0, u: 200 + ahead, dir: -1, rank: 0 });
  const contacts: SimEvent[] = [];
  let chased = 0;
  const ticks = (o.seconds ?? 20) * 60;
  for (let t = 0; t < ticks; t++) {
    // Hold the player's speed: throttle below it, coast above it.
    const throttle = me.speed < (o.playerMps ?? 24) ? 200 : 0;
    const out = stepWorld(world, cfg, SYSTEMS, [{ steer: 0, throttle, brake: 0, flags: 0 }]);
    for (const e of out) {
      if ((e.type === 'crash' || e.type === 'wobble') && e.actor === cop.id && e.data['cause'] === 'traffic')
        contacts.push(e);
    }
    if (cs.phase[cop.id] === COP_CHASING) chased++;
  }
  return {
    contacts,
    chased,
    behind: me.pos.s - cop.pos.s,
    mode: cop.mode,
    closing: cs.closing[cop.id],
    vehicles: trafficState(world).id.length,
  };
}

const seen = (r: { contacts: SimEvent[] }) =>
  r.contacts.map(
    (e) => `${e.type} at tick ${e.tick} (${String(e.data['vehicle'])}, ${String(e.data['hit'])})`,
  );

describe('cops: a cop rides round traffic (W-S follow-up, SF seed 7)', () => {
  it('the SF chain: a heat cop still "moving in" 150 m back, bursting up the lane behind a slow car', () => {
    const r = chase({ cars: [50], heat: true, movedIn: true });
    expect(r.vehicles).toBe(1);
    expect(r.chased).toBeGreaterThan(0);
    expect(seen(r)).toEqual([]);
    expect(r.mode).toBe('Road');
    // He caught up with the player (the follow gap is 40 m) rather than sitting behind the car.
    expect(r.behind).toBeLessThan(60);
  });

  it("the move-in ends once his man is out of reach ahead: he does not ride the man's lane from far back", () => {
    const r = chase({ cars: [], movedIn: true, seconds: 1 });
    expect(r.closing).toBe(0);
  });

  it('a file of slow cars in his lane: he passes them all without a touch', () => {
    for (const heat of [false, true]) {
      for (const movedIn of [false, true]) {
        const r = chase({ cars: [30, 55, 80, 120], heat, movedIn });
        expect(seen(r), `heat ${heat}, moved in ${movedIn}`).toEqual([]);
        expect(r.behind, `heat ${heat}, moved in ${movedIn}`).toBeLessThan(60);
      }
    }
  });

  it('a slow car ahead and oncoming cars in the other lane: he waits behind it rather than hit either', () => {
    const r = chase({
      cars: [50],
      oncoming: [150, 260, 370, 480, 590, 700],
      seconds: 15,
      heat: true,
      movedIn: true,
    });
    expect(seen(r)).toEqual([]);
    expect(r.mode).toBe('Road');
  });
});
