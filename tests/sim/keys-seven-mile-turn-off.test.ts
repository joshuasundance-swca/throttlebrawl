/// <reference types="vite/client" />
// The Seven Mile's old road is easy to take (playtest 4, P4-10; the maintainer: "too hard to get
// on... as long as it's reasonably and fairly truly accessible then the current respawn is fine").
// The feel audit measured why it was not: the turn-off counted only against the rail, the run-up
// to the ramp truck bent tighter than a fast bike can hold, and the truck was narrower than the deck,
// so a rider who let go at the split rode beside it into the water.
//
// The rule this protects: at its top speed, every bike that can clear the truck's hop (every bike at
// least as fast as the Rustbucket) and that takes the turn-off anywhere across its zone lands on the
// old road, whether the rider then lets go of the steering or keeps to the run-up's centreline. And
// a rider who misses a Seven Mile jump wakes on the highway (the decision for P4-10: "a miss respawns
// on the highway"), the truck hops included.
//
// Run A's R3 left one habit open: a rider who keeps holding right after the split scraped along the
// platform's water edge (10 m/s² of drag) for the whole connector and fell short of the hop on the
// Chopper and the Rustbucket. A staging road's edges now guide (sim/riders/features.ts), so the
// third habit, 'hold right', is held to the same bar.
//
// One rider alone on the real road with the real systems (no field, no traffic): the road's shape is
// what is under test. Everything is read from the packs (the zone, the trucks, the gaps, the bikes),
// so a re-bake is measured as it lands.
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
import { guidedZone, ZONE_GUIDE_REACH_M, ZONE_LEAD_PAINT_M } from '../../src/render/road-mesh';
import { barrierLimits, BIKE_HALF_WIDTH_M, ridersSystem, SPLIT_GUIDE_LEAD_M } from '../../src/sim/riders';
import { trafficSystem } from '../../src/sim/traffic';
import { tumbleSystem } from '../../src/sim/tumble';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimBikeDef, SimConfig, SimEvent } from '../../src/sim/types';
import { addMover, createWorld, orderSystems, stepWorld, type Mover } from '../../src/sim/world';

const print = (line: string) => process.stdout.write(`[seven-mile-turn-off] ${line}\n`);

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
const OLD = route.branches?.find((b) =>
  b.roads.some((id) => featuresOf(id).some((f) => f.kind === 'rampTruck')),
);
if (!OLD) throw new Error('no branch with a ramp truck on it');
const OLD_ROADS = new Set(OLD.roads);

function featuresOf(id: string): BakedFeature[] {
  const r = roads.find((x) => x.id === id);
  return (r as unknown as { features?: BakedFeature[] } | undefined)?.features ?? [];
}

/** The split zone onto the old road, and the staging roads (each with a truck before a gap). */
const ZONE = ROAD.splitZones().find((z) => OLD_ROADS.has(ROAD.edges[z.toEdge]?.id ?? ''));
if (!ZONE) throw new Error('no split zone onto the old road');
const STAGINGS = OLD.roads
  .map((id) => ({ id, truck: featuresOf(id).find((f) => f.kind === 'rampTruck') }))
  .filter((x): x is { id: string; truck: BakedFeature } => !!x.truck);
/** The staging road the turn-off leads to (the first one along the branch), and the road after it. */
const IN = STAGINGS[0]!;
const AFTER_IN = OLD.roads[OLD.roads.indexOf(IN.id) + 1];
if (!AFTER_IN) throw new Error('nothing after the first staging road');

/** The bikes that can clear a truck's hop: every bike at least as fast as the Rustbucket. */
const ALL_BIKES = Object.values(bikeFiles)
  .map((b) => ({ id: b.id, bike: { contentId: `base:${b.id}`, ...b.handling } }))
  .filter((b, i, all) => all.findIndex((c) => c.id === b.id) === i)
  .sort((a, b) => a.bike.topSpeedMps - b.bike.topSpeedMps || a.id.localeCompare(b.id));
const RUSTBUCKET = ALL_BIKES.find((b) => b.id === 'rustbucket-400');
if (!RUSTBUCKET) throw new Error('no Rustbucket in the packs');
const FAST = ALL_BIKES.filter((b) => b.bike.topSpeedMps >= RUSTBUCKET.bike.topSpeedMps);
const SLOW = ALL_BIKES.filter((b) => b.bike.topSpeedMps < RUSTBUCKET.bike.topSpeedMps);

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
const BASE = gapSimConfig(bundle, { route });
const CAP_TICKS = 60 * 30;

/** What the rider does with the steering once it is on the old road's roads. */
type Habit = 'let go' | 'centreline' | 'hold right';

interface Run {
  took: boolean;
  arrived: boolean;
  crash: SimEvent | undefined;
  wobbles: string[];
  jump: SimEvent | undefined;
  /** Its d on the staging road as it reached the truck. */
  dAtTruck: number;
  where: string;
}

/**
 * One rider at its bike's top speed at (edge, s, d), heading along the road, full throttle. Off the
 * old road it holds the steering still; on it, it lets go, or keeps to the centreline of the road it
 * is on. It rides until it reaches a road `goal` names, crashes, or the cap.
 */
function ride(
  bike: SimBikeDef,
  from: { edge: string; s: number; d: number },
  habit: Habit,
  staging: { id: string; truck: BakedFeature },
  goal: (id: string) => boolean,
): Run {
  const config: SimConfig = { ...BASE, riders: [{ ...BASE.riders[0]!, bike }] };
  const world = createWorld(config);
  const edge = config.road.edgeIndex(from.edge);
  const p: Mover = addMover(world, 'rider', { edge, s: from.s, d: from.d, dir: 1 }, 0);
  for (const sys of SYSTEMS) sys.init(world, config);
  p.speed = bike.topSpeedMps;
  const events: SimEvent[] = [];
  const truckEdge = config.road.edgeIndex(staging.id);
  let took = false;
  let arrived = false;
  let dAtTruck = NaN;
  for (let t = 0; t < CAP_TICKS; t++) {
    const id = config.road.edges[p.pos.edge]?.id ?? '';
    const onBranch = OLD_ROADS.has(id);
    took ||= onBranch;
    let steer = 0;
    if (onBranch && habit === 'hold right' && p.mode === 'Road') steer = 1;
    if (onBranch && habit === 'centreline' && p.mode === 'Road') {
      // A thumb holding the middle of the deck: toward d = 0, damped by the heading.
      steer = Math.max(-1, Math.min(1, -0.8 * p.pos.d - 6 * p.yaw));
    }
    if (p.pos.edge === truckEdge && Number.isNaN(dAtTruck) && p.pos.s >= staging.truck.s0) dAtTruck = p.pos.d;
    events.push(
      ...stepWorld(world, config, SYSTEMS, [
        { steer: Math.round(steer * 127), throttle: 255, brake: 0, flags: 0 },
      ]),
    );
    if (events.some((e) => e.type === 'crash')) break;
    if (p.mode === 'Road' && goal(config.road.edges[p.pos.edge]?.id ?? '')) {
      arrived = true;
      break;
    }
  }
  const crash = events.find((e) => e.type === 'crash');
  return {
    took,
    arrived: arrived && !crash,
    crash,
    wobbles: events.filter((e) => e.type === 'wobble').map((e) => String(e.data['cause'] ?? '?')),
    jump: events.find((e) => e.type === 'jump'),
    dAtTruck,
    where: `${config.road.edges[p.pos.edge]?.id} s ${p.pos.s.toFixed(0)} d ${p.pos.d.toFixed(2)}`,
  };
}

function row(name: string, b: { id: string; bike: SimBikeDef }, habit: Habit, d: number, run: Run): string {
  const outcome = run.arrived
    ? 'made it'
    : `MISSED (${run.took ? 'on the old road' : 'stayed on the highway'}; ${run.crash ? JSON.stringify(run.crash.data) : 'no crash'})`;
  return `${name} ${b.id} (${b.bike.topSpeedMps} m/s) ${habit} from d ${d.toFixed(2)}: ${outcome}, wobbles [${run.wobbles.join(' ')}], d ${run.dAtTruck.toFixed(2)} at the truck, lip ${Number(run.jump?.data['speed'] ?? NaN).toFixed(1)} m/s, ends ${run.where}`;
}

/** The speed a rider holding right loses riding `ticks` from (edge, s) at the bike's top speed, m/s. */
function holdRightLoss(bike: SimBikeDef, edgeId: string, s: number, ticks: number): number {
  const config: SimConfig = { ...BASE, riders: [{ ...BASE.riders[0]!, bike }] };
  const world = createWorld(config);
  const p = addMover(world, 'rider', { edge: config.road.edgeIndex(edgeId), s, d: 0, dir: 1 }, 0);
  for (const sys of SYSTEMS) sys.init(world, config);
  p.speed = bike.topSpeedMps;
  for (let t = 0; t < ticks; t++) {
    stepWorld(world, config, SYSTEMS, [{ steer: 127, throttle: 255, brake: 0, flags: 0 }]);
  }
  return bike.topSpeedMps - p.speed;
}

describe('a rider held against a staging deck keeps its speed', () => {
  it('loses nothing along the connector and the platform, where the old bridge beside it scrapes', () => {
    const bike = RUSTBUCKET.bike;
    // Full throttle at top speed, so only the edge can slow the rider. Two seconds of holding right.
    const TICKS = 120;
    const connector = holdRightLoss(bike, ROAD.edges[ZONE.toEdge]!.id, 0, 60);
    const platform = holdRightLoss(bike, IN.id, IN.truck.s1 + 40, TICKS);
    // The check can see a scrape: the same hold on the old bridge, which is no staging road, loses speed.
    const bridge = holdRightLoss(bike, AFTER_IN, 1000, TICKS);
    print(
      `held right (connector 60 ticks, the rest ${TICKS}), speed lost: connector ${connector.toFixed(2)}, platform ${platform.toFixed(2)}, old bridge ${bridge.toFixed(2)} m/s`,
    );
    expect(bridge, 'a hold on the old bridge scrapes').toBeGreaterThan(2);
    expect(connector).toBeLessThan(1);
    expect(platform).toBeLessThan(1);
  });
});

describe("the turn-off's paint shows where the sim guides", () => {
  it('paints the split guide’s lead-in, and reads a guided zone at the riders’ half-width', () => {
    // render/road-mesh.ts paints chevrons over a guided zone's lead-in and does not import sim/riders,
    // so it carries the two numbers itself; they must stay the riders' own.
    expect(ZONE_LEAD_PAINT_M).toBe(SPLIT_GUIDE_LEAD_M);
    expect(ZONE_GUIDE_REACH_M).toBe(BIKE_HALF_WIDTH_M);
    // The Seven Mile's turn-off is guided: its zone runs out to the rail.
    expect(guidedZone(ROAD, ZONE.edge, ZONE)).toBe(true);
  });
});

describe('the Seven Mile old road is easy to take: at top speed, anywhere across the way in', () => {
  it('lands every fast bike on the old road from anywhere across the turn-off zone, letting go or on the centreline', () => {
    const z = ZONE;
    const zoneEdge = ROAD.edges[z.edge]!.id;
    const reach = barrierLimits(BASE, z.edge, z.s1).hi;
    const inner = Math.min(z.d0, z.d1);
    // Across the zone's drivable band: its inner edge, the middle, and pressed against the rail.
    const offsets = [inner + 0.05, (inner + reach) / 2, reach];
    print(
      `zone on ${zoneEdge} s ${z.s0.toFixed(0)}..${z.s1.toFixed(0)} d ${z.d0}..${z.d1}, the rider's reach d ${reach.toFixed(2)}; truck ${IN.truck.s0}..${IN.truck.s1} d ${IN.truck.d0}..${IN.truck.d1} on ${IN.id}`,
    );
    const rows: string[] = [];
    const missed: string[] = [];
    for (const b of FAST) {
      for (const habit of ['let go', 'centreline', 'hold right'] as const) {
        for (const d of offsets) {
          const run = ride(b.bike, { edge: zoneEdge, s: z.s0, d }, habit, IN, (id) => id === AFTER_IN);
          rows.push(row('turn-off', b, habit, d, run));
          if (!run.took || !run.arrived) missed.push(`${b.id} ${habit} d ${d.toFixed(2)}`);
        }
      }
    }
    print(`${rows.length} runs:\n  ${rows.join('\n  ')}`);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(missed).toEqual([]);
  });

  it('hops every fast bike back onto the highway at the far staging, letting go or on the centreline', () => {
    const OUT = STAGINGS[STAGINGS.length - 1]!;
    const before = OLD.roads[OLD.roads.indexOf(OUT.id) - 1];
    if (!before || OUT === IN) throw new Error('no far staging after the old bridge');
    const edge = ROAD.edgeIndex(before);
    const s = ROAD.edges[edge]!.length - 150;
    // Across the old bridge's travel lanes: each lane's centre and the middle between them.
    const drive = ROAD.lanesAt(edge, s).filter((l) => l.kind === 'drive');
    const offsets = [...drive.map((l) => l.dCenterM), 0].sort((a, b) => a - b);
    const main = new Set(route.mainPath);
    const rows: string[] = [];
    const missed: string[] = [];
    for (const b of FAST) {
      for (const habit of ['let go', 'centreline', 'hold right'] as const) {
        for (const d of offsets) {
          const run = ride(b.bike, { edge: before, s, d }, habit, OUT, (id) => main.has(id));
          rows.push(row('way back', b, habit, d, run));
          if (!run.arrived) missed.push(`${b.id} ${habit} d ${d.toFixed(2)}`);
        }
      }
    }
    print(`${rows.length} runs from ${before} s ${s.toFixed(0)}:\n  ${rows.join('\n  ')}`);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(missed).toEqual([]);
  });

  it('a bike that misses the hop off the turn-off wakes on the highway, never on the old road', () => {
    const z = ZONE;
    const reach = barrierLimits(BASE, z.edge, z.s1).hi;
    const main = new Set(route.mainPath);
    const rows: string[] = [];
    let woke = 0;
    for (const b of SLOW) {
      const config: SimConfig = { ...BASE, riders: [{ ...BASE.riders[0]!, bike: b.bike }] };
      const world = createWorld(config);
      const p = addMover(world, 'rider', { edge: z.edge, s: z.s0, d: reach, dir: 1 }, 0);
      for (const sys of SYSTEMS) sys.init(world, config);
      p.speed = b.bike.topSpeedMps;
      const events: SimEvent[] = [];
      const afterEdge = config.road.edgeIndex(AFTER_IN);
      for (let t = 0; t < 60 * 90; t++) {
        events.push(...stepWorld(world, config, SYSTEMS, [{ steer: 0, throttle: 255, brake: 0, flags: 0 }]));
        if (events.some((e) => e.type === 'respawn')) break;
        if (p.mode === 'Road' && p.pos.edge === afterEdge) break;
      }
      const respawn = events.find((e) => e.type === 'respawn');
      const on = config.road.edges[p.pos.edge]?.id ?? '?';
      rows.push(
        `${b.id} (${b.bike.topSpeedMps} m/s): ${respawn ? JSON.stringify(respawn.data) : 'no respawn'}, on ${on}`,
      );
      if (!respawn) {
        // Fast enough to clear it after all: then it is on the old road past the hop.
        expect(on, b.id).toBe(AFTER_IN);
        continue;
      }
      woke++;
      expect(respawn.data, b.id).toMatchObject({ reason: 'splash', at: 'main' });
      expect(main.has(on), `${b.id} wakes on ${on}`).toBe(true);
    }
    print(`slower than the Rustbucket:\n  ${rows.join('\n  ')}`);
    // The check could see a miss: at least one bike is too slow for the hop.
    expect(woke).toBeGreaterThan(0);
  });
});
