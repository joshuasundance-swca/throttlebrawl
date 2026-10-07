/// <reference types="vite/client" />
// A missed Seven Mile staging hop pays nothing and finds nothing (playtest 4, run A's live check: a
// bike that left the lip too slow fell, splashed and woke on the highway, which is right, yet the
// ticker said FOUND IT and had counted AIRTIME up to +$40 on the way down).
//
// The rule these protect: a respawn is never a shortcut found, and air that ends in a crash or a
// splash pays nothing. The old road is a route shortcut (RouteProgress.shortcuts: its zone's link
// onto `osm-keys-seven-mile-old-road-in`), so a rider who wakes on the main road from a splash used
// to look to sim/race/shortcuts.ts like one who rode back onto it (a negative `savedS`: the splash
// penalty ate the "saved" seconds). Both staging hops are covered, the turn-off's (east) and the one
// back onto the highway (west). The controls: a clean ride of the old road still finds it, once, and
// a clean landing off the first hop still pays its airtime, so a pass above cannot be a check that
// sees nothing.
//
// One rider alone on the real road with the real systems (no field, no traffic), driven by sim ticks
// only. Everything is read from the packs (the zone, the trucks, the gaps, the bikes).
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  type BakedFeature,
  type BakedNetwork,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { aiSystem } from '../../src/sim/ai';
import { combatSystem } from '../../src/sim/combat';
import { copsSystem } from '../../src/sim/cops';
import { modifiersSystem } from '../../src/sim/modifiers';
import { pedsSystem } from '../../src/sim/peds';
import { raceSystem } from '../../src/sim/race';
import { barrierLimits, ridersSystem } from '../../src/sim/riders';
import { trafficSystem } from '../../src/sim/traffic';
import { tumbleSystem } from '../../src/sim/tumble';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimBikeDef, SimConfig, SimEvent } from '../../src/sim/types';
import { addMover, createWorld, orderSystems, stepWorld, type Mover } from '../../src/sim/world';

const print = (line: string) => process.stdout.write(`[seven-mile-failed-hop] ${line}\n`);

const networks = import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/osm-*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/osm-*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<BakedRoute>('../../packs/base/regions/florida-keys/routes/osm-*.json', {
  eager: true,
  import: 'default',
});
const bikeFiles = import.meta.glob<{ id: string; handling: Omit<SimBikeDef, 'contentId'> }>(
  '../../packs/*/bikes/*.json',
  { eager: true, import: 'default' },
);

const NETWORK = 'osm-keys-seven-mile';
const network = Object.values(networks).find((n) => n.id === NETWORK);
if (!network) throw new Error(`no network ${NETWORK}`);
const roads = network.roads.map((id) => {
  const r = Object.values(roadFiles).find((x) => x.id === id);
  if (!r) throw new Error(`no road ${id}`);
  return r;
});
const route = Object.values(routeFiles).find((r) => r.network === NETWORK);
if (!route) throw new Error(`no route on ${NETWORK}`);
const bundle: BakedNetworkBundle = { network, roads };
const ROAD = createRoadNetwork(bundle);

function featuresOf(id: string): BakedFeature[] {
  const r = roads.find((x) => x.id === id);
  return (r as unknown as { features?: BakedFeature[] } | undefined)?.features ?? [];
}

const OLD = route.branches?.find((b) =>
  b.roads.some((id) => featuresOf(id).some((f) => f.kind === 'rampTruck')),
);
if (!OLD) throw new Error('no branch with a ramp truck on it');
const OLD_ROADS = new Set(OLD.roads);
const MAIN = new Set(route.mainPath);
/** The split zone onto the old road. */
const ZONE = ROAD.splitZones().find((z) => OLD_ROADS.has(ROAD.edges[z.toEdge]?.id ?? ''));
if (!ZONE) throw new Error('no split zone onto the old road');
/** The staging roads (each a truck before a gap): the turn-off's (east) first, the way back (west) last. */
const STAGINGS = OLD.roads
  .map((id) => ({ id, truck: featuresOf(id).find((f) => f.kind === 'rampTruck') }))
  .filter((x): x is { id: string; truck: BakedFeature } => !!x.truck);
const EAST = STAGINGS[0]!;
const WEST = STAGINGS[STAGINGS.length - 1]!;
if (EAST === WEST) throw new Error('the old road has one staging road, not two');
const WEST_LEAD = OLD.roads[OLD.roads.indexOf(WEST.id) - 1];
if (!WEST_LEAD) throw new Error('nothing before the way-back staging road');
const ZONE_EDGE = ROAD.edges[ZONE.edge]?.id ?? '';
/** Where every ride starts: the zone's start, pressed against its rail, so the rider takes the old road. */
const START = { edge: ZONE.edge, s: ZONE.s0, s1: ZONE.s1 };
const gapOf = (id: string) => featuresOf(id).find((f) => f.kind === 'gap');

const RUSTBUCKET = Object.values(bikeFiles).find((b) => b.id === 'rustbucket-400');
if (!RUSTBUCKET) throw new Error('no Rustbucket in the packs');
const BIKE: SimBikeDef = { contentId: 'base:rustbucket-400', ...RUSTBUCKET.handling };

const SYSTEMS = orderSystems([
  aiSystem,
  ridersSystem,
  combatSystem,
  copsSystem,
  trafficSystem,
  pedsSystem,
  tumbleSystem,
  raceSystem,
  modifiersSystem,
]);
const AIRTIME_CASH = 40;
const BASE = gapSimConfig(bundle, { route });
const CONFIG: SimConfig = {
  ...BASE,
  event: {
    ...BASE.event,
    style: {
      perNearMissCash: 0,
      perAirtimeCash: AIRTIME_CASH,
      perOncomingSecondCash: 0,
      perTakedownCash: 0,
      takedownComboScale: 0,
      perStealCash: 0,
    },
  },
  riders: [{ ...BASE.riders[0]!, bike: BIKE }],
};

interface Ride {
  events: (SimEvent & { at: number })[];
  edgeAt: (tick: number) => string;
  ticks: number;
}

const ofType = (r: Ride, type: SimEvent['type']) => r.events.filter((e) => e.type === type);

/**
 * One rider at the Rustbucket's top speed at the turn-off zone's start, pressed against its rail, so
 * it takes the old road. On the old road's bridges it holds the middle of the deck; on the staging
 * run-ups it brakes to `slow` (m/s) when asked (the thumb of the live check) and then holds that
 * speed. It rides until `done`, a rider that has woken on the highway, or the cap.
 */
function ride(
  slowOn: (edge: string, s: number) => boolean,
  slow: number,
  done: (edge: string, events: SimEvent[]) => boolean,
): Ride {
  const world = createWorld(CONFIG);
  const reach = barrierLimits(BASE, START.edge, START.s1).hi;
  const p: Mover = addMover(world, 'rider', { edge: START.edge, s: START.s, d: reach, dir: 1 }, 0);
  for (const sys of SYSTEMS) sys.init(world, CONFIG);
  p.speed = BIKE.topSpeedMps;
  const events: (SimEvent & { at: number })[] = [];
  const trail: string[] = [];
  const lastTrail = (t: number) => trail[Math.min(t, trail.length - 1)] ?? '';
  for (let t = 0; t < 60 * 600; t++) {
    const id = CONFIG.road.edges[p.pos.edge]?.id ?? '';
    let steer = 0;
    if (OLD_ROADS.has(id) && p.mode === 'Road') {
      steer = Math.max(-1, Math.min(1, -0.8 * p.pos.d - 6 * p.yaw));
    }
    let throttle = 255;
    let brake = 0;
    if (slowOn(id, p.pos.s) && p.mode === 'Road') {
      if (p.speed > slow) {
        throttle = 0;
        brake = 255;
      } else throttle = p.speed < slow - 1 ? 255 : 0;
    }
    const fresh = stepWorld(world, CONFIG, SYSTEMS, [
      { steer: Math.round(steer * 127), throttle, brake, flags: 0 },
    ]);
    trail.push(CONFIG.road.edges[p.pos.edge]?.id ?? '');
    for (const e of fresh) events.push({ ...e, at: t });
    if (done(id, events)) return { events, edgeAt: lastTrail, ticks: t };
  }
  return { events, edgeAt: lastTrail, ticks: 60 * 600 };
}

/** The airtime cash scored at or after tick `from`. */
const airtimeFrom = (r: Ride, from: number) =>
  ofType(r, 'style').filter((e) => e.data['kind'] === 'airtime' && e.at >= from);
/** The flight that ended in `crash`: the last `jump` before it (a ramp's lip, or the rim of the gap). */
const fallOf = (r: Ride, crash: { at: number } | undefined) =>
  ofType(r, 'jump')
    .filter((e) => e.at <= (crash?.at ?? -1))
    .at(-1);

describe('a missed staging hop finds no shortcut and pays no airtime', () => {
  // The east hop, arriving slow two ways: 23 m/s, as the live check's seed 7 (the lip's ramp flings
  // it and the gap takes it), and 13 m/s, which clears the staging truck's empty top deck low and
  // rolls into the gap (the fall, paid nothing). Lower flights can instead meet the solid cab.
  it.each([23, 13])(
    'the turn-off hop (east), left at %i m/s: it falls, wakes on the highway, and is neither found nor paid',
    (slow) => {
      const r = ride(
        (id, s) =>
          (id === ZONE_EDGE && s >= ZONE.s0) ||
          (OLD.roads.indexOf(id) >= 0 && OLD.roads.indexOf(id) <= OLD.roads.indexOf(EAST.id)),
        slow,
        (_id, events) => events.some((e) => e.type === 'respawn'),
      );
      const crash = ofType(r, 'crash')[0];
      const respawn = ofType(r, 'respawn')[0];
      const found = ofType(r, 'shortcutFound');
      const fall = fallOf(r, crash);
      print(
        `east miss at ${slow}: fall from ${JSON.stringify(fall?.data)} @${fall?.at}, crash ${JSON.stringify(crash?.data)} @${crash?.at}, respawn @${respawn?.at} on ${r.edgeAt(respawn?.at ?? 0)}; found ${JSON.stringify(found.map((e) => e.data))}; style paid ${JSON.stringify(ofType(r, 'style').map((e) => `${e.at}:${e.data['kind']}:${e.data['points']}`))}`,
      );
      // The scene is the miss: the hop's gap took it, and the respawn is on the main road.
      expect(fall, 'it left the ground before the gap').toBeDefined();
      expect(crash?.data).toMatchObject({ cause: 'gap', feature: gapOf(EAST.id)?.id });
      expect(respawn?.data).toMatchObject({ reason: 'splash', at: 'main' });
      // The rule.
      expect(found).toEqual([]);
      expect(airtimeFrom(r, fall?.at ?? 0)).toEqual([]);
    },
  );

  it.each([
    { side: 'east', slow: 12, staging: EAST },
    { side: 'west', slow: 14, staging: WEST },
  ])(
    '$side hop at $slow m/s meets the drawn cab and pays nothing for the crashed flight',
    ({ side, slow, staging }) => {
      // The full lip tangent now gives these flights enough height to reach the cab before landing
      // on the empty deck. A downward cap contact wobbles, then its end meets the rider above 10 m/s.
      const r = ride(
        (id, s) =>
          side === 'east'
            ? (id === ZONE_EDGE && s >= ZONE.s0) ||
              (OLD.roads.indexOf(id) >= 0 && OLD.roads.indexOf(id) <= OLD.roads.indexOf(EAST.id))
            : id === WEST.id ||
              (id === WEST_LEAD && s > (ROAD.edges[ROAD.edgeIndex(WEST_LEAD)]?.length ?? 0) - 230),
        slow,
        (_id, events) => events.some((e) => e.type === 'crash' && e.data['feature'] === staging.truck.id),
      );
      const crash = ofType(r, 'crash').find((e) => e.data['feature'] === staging.truck.id);
      const top = ofType(r, 'wobble').find((e) => e.data['feature'] === staging.truck.id);
      const found = ofType(r, 'shortcutFound');
      const fall = fallOf(r, crash);
      print(
        `${side}, ${slow} m/s: fall ${JSON.stringify(fall?.data)} @${fall?.at}, top ${JSON.stringify(top?.data)} @${top?.at}, crash ${JSON.stringify(crash?.data)} @${crash?.at}; found ${JSON.stringify(found.map((e) => e.data))}`,
      );
      expect(fall, 'it left the ground at the lip').toBeDefined();
      expect(top?.data).toMatchObject({ object: 'rampTruck', hit: 'top' });
      expect(Number(top?.data['impactMps'])).toBeLessThan(10);
      expect(crash?.data).toMatchObject({ cause: 'barrier', object: 'rampTruck', hit: 'end' });
      expect(Number(crash?.data['impactMps'])).toBeGreaterThanOrEqual(10);
      expect(found).toEqual([]);
      expect(airtimeFrom(r, fall?.at ?? 0)).toEqual([]);
    },
  );

  it('a lower east flight lands on the actual empty deck and pays no short-hop airtime', () => {
    const r = ride(
      (id, s) =>
        (id === ZONE_EDGE && s >= ZONE.s0) ||
        (OLD.roads.indexOf(id) >= 0 && OLD.roads.indexOf(id) <= OLD.roads.indexOf(EAST.id)),
      10,
      (_id, events) => events.some((e) => e.type === 'land' && e.data['on'] === 'truck'),
    );
    const landed = ofType(r, 'land').find((e) => e.data['on'] === 'truck');
    expect(landed?.data).toMatchObject({ on: 'truck', object: 'rampTruck', quality: 'clean' });
    expect(Number(landed?.data['airTicks'])).toBeLessThan(30);
    expect(ofType(r, 'crash')).toEqual([]);
    expect(ofType(r, 'shortcutFound')).toEqual([]);
    expect(airtimeFrom(r, 0)).toEqual([]);
  });

  it('the way-back hop (west), left too slow: it falls, wakes on the highway, and is neither found nor paid', () => {
    const r = ride(
      (id, s) =>
        id === WEST.id ||
        (id === WEST_LEAD && s > (ROAD.edges[ROAD.edgeIndex(WEST_LEAD)]?.length ?? 0) - 230),
      // At about 17 m/s at this 2.8/11.5 lip the flight clears the 3.21 m cab/markers, but
      // its ballistic range still cannot span the authored 30 m gap beyond the carrier.
      18,
      (_id, events) => events.some((e) => e.type === 'respawn' && e.data['gap'] === gapOf(WEST.id)?.id),
    );
    const crash = ofType(r, 'crash').find((e) => e.data['feature'] === gapOf(WEST.id)?.id);
    const respawn = ofType(r, 'respawn')[0];
    const found = ofType(r, 'shortcutFound');
    const fall = fallOf(r, crash);
    print(
      `west miss: fall ${JSON.stringify(fall?.data)} @${fall?.at}, crash @${crash?.at}, respawn ${JSON.stringify(respawn?.data)}; found ${JSON.stringify(found.map((e) => e.data))}; style paid on the way ${JSON.stringify(ofType(r, 'style').map((e) => `${e.at}:${e.data['points']}`))}`,
    );
    expect(fall, 'it left the ground before the gap').toBeDefined();
    expect(crash?.data, 'the hop took it').toMatchObject({ cause: 'gap' });
    expect(respawn?.data).toMatchObject({ reason: 'splash', at: 'main' });
    expect(found).toEqual([]);
    // The turn-off hop and the Moser jump were cleared on the way (those clean landings paid), so
    // the check can see airtime cash; none of it is for the fall.
    expect(airtimeFrom(r, 0).length, 'the earlier clean landings paid').toBeGreaterThan(0);
    expect(airtimeFrom(r, fall?.at ?? 0)).toEqual([]);
  });

  it('control: a clean ride of the whole old road still finds it, once, and its landings still pay', () => {
    const r = ride(
      () => false,
      0,
      (id, events) => MAIN.has(id) && events.some((e) => e.type === 'jump'),
    );
    const found = ofType(r, 'shortcutFound');
    const airtime = airtimeFrom(r, 0);
    print(
      `clean ride: ${r.ticks} ticks; found ${JSON.stringify(found.map((e) => e.data))}; airtime ${JSON.stringify(airtime.map((e) => `${e.at}:${e.data['points']}`))}; crashes ${JSON.stringify(ofType(r, 'crash').map((e) => e.data))}`,
    );
    expect(ofType(r, 'crash')).toEqual([]);
    expect(ofType(r, 'respawn')).toEqual([]);
    expect(found).toHaveLength(1);
    expect(found[0]?.data['toEdge']).toBe(ZONE.toEdge);
    expect(airtime.length, 'a clean landing pays').toBeGreaterThan(0);
    expect(airtime.every((e) => e.data['points'] === AIRTIME_CASH)).toBe(true);
  });
});
