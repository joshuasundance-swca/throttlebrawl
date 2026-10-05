/// <reference types="vite/client" />
// Playtest 3's two Keys bakes (T9.2; tools/gis networks/osm-keys-seven-mile.json and
// osm-keys-duval.json), checked against what the maintainer asked for:
//
// - The Seven Mile Bridge (round 3): "real geometry and length (about 11 km); ramp trucks on repair
//   platforms hop about 30 m between the bridges; the real 80 m missing span is the big jump (a
//   miss = splash, respawn on the highway); rivals and cops stay on the highway". The critic's C1
//   resolution: the old bridge from its OSM ways including way D onto Little Duck Key, bridges
//   sampled at 6 m, and the kicker sized so the Rustbucket at full throttle clears the Moser gap
//   with a small margin while a rider well under top speed misses (measured here in the sim, with
//   its air drag, per bike: T3.1 found the vacuum figures too optimistic).
// - Duval Street (round 1: "Duval St, downtown Portland, Golden Gate"; "real landmarks"): Whitehead,
//   South and Duval at their real size, the buoy and the Mile 0 marker where the real ones stand, and
//   Mallory Square's pier where the finish can see it (T10.4: its real spot is about 190 m from the
//   road, so the race never showed it).
//
// The bikes are read from the packs, so a new bike is measured the day it lands. The road lint, the
// licence, the 4 m lanes and the scenery and land sweeps run on both networks in
// region-routes.test.ts; the bot races them in tests/sim/road-real-routes.test.ts.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, regionChoices } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { geoFrame } from '../../src/render/backdrop/geo';
import {
  createRoadNetwork,
  type BakedFeature,
  type BakedNetwork,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { createSim } from '../../src/sim/api';
import { aiSystem } from '../../src/sim/ai';
import { combatSystem } from '../../src/sim/combat';
import { copsSystem } from '../../src/sim/cops';
import { modifiersSystem } from '../../src/sim/modifiers';
import { pedsSystem } from '../../src/sim/peds';
import { raceSystem } from '../../src/sim/race';
import { BIKE_HALF_WIDTH_M, ridersSystem } from '../../src/sim/riders';
import { trafficSystem } from '../../src/sim/traffic';
import { tumbleSystem } from '../../src/sim/tumble';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimBikeDef, SimConfig, SimEvent } from '../../src/sim/types';
import { addMover, createWorld, orderSystems, stepWorld } from '../../src/sim/world';

const networks = import.meta.glob<BakedNetwork & { crs: { originLatDeg: number; originLonDeg: number } }>(
  '../../packs/base/regions/florida-keys/networks/osm-*.json',
  { eager: true, import: 'default' },
);
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/osm-*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<BakedRoute>('../../packs/base/regions/florida-keys/routes/osm-*.json', {
  eager: true,
  import: 'default',
});
const bikeFiles = import.meta.glob<{ id: string; name: string; handling: Omit<SimBikeDef, 'contentId'> }>(
  '../../packs/*/bikes/*.json',
  { eager: true, import: 'default' },
);

function bundleOf(id: string) {
  const network = Object.values(networks).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = network.roads.map((rid) => {
    const r = Object.values(roadFiles).find((x) => x.id === rid);
    if (!r) throw new Error(`no road ${rid}`);
    return r;
  });
  const route = Object.values(routeFiles).find((r) => r.network === id);
  if (!route) throw new Error(`no route on ${id}`);
  return { network, roads, route, bundle: { network, roads, routes: [route] } as BakedNetworkBundle };
}

const print = (line: string) => process.stdout.write(`[examined] ${line}\n`);
const roadOf = (roads: readonly BakedRoad[], id: string) => {
  const r = roads.find((x) => x.id === id);
  if (!r) throw new Error(`no road ${id}`);
  return r;
};
const featuresOf = (r: BakedRoad) => (r as unknown as { features?: BakedFeature[] }).features ?? [];
const tagRows = (r: BakedRoad, tag: string) =>
  ((r as unknown as { tags?: { s0: number; s1: number; tag: string }[] }).tags ?? [])
    .filter((t) => t.tag === tag)
    .map((t) => ({ s0: t.s0, s1: t.s1 }));
const samplesOf = (r: BakedRoad) =>
  (r as unknown as { samples: { data: Record<string, number[]> } }).samples.data;

// ---- The Seven Mile Bridge ----------------------------------------------------------------------

const SM = bundleOf('osm-keys-seven-mile');
const SM_ROAD = createRoadNetwork(SM.bundle);
const OLD_ROAD = SM.route.branches?.find((b) => b.id === 'osm-sm-old-road');
const frameSM = geoFrame(SM.network.crs.originLatDeg, SM.network.crs.originLonDeg);

/** Where a real point lies along a road's sample polyline: (s, distance off it). */
function nearestOn(road: BakedRoad, x: number, z: number): { s: number; off: number } {
  const d = samplesOf(road);
  const xs = d['x'] ?? [];
  const zs = d['z'] ?? [];
  const sp = road.sampleSpacingM;
  let best = { s: 0, off: Infinity };
  for (let i = 0; i + 1 < xs.length; i++) {
    const ax = xs[i] ?? 0;
    const az = zs[i] ?? 0;
    const dx = (xs[i + 1] ?? 0) - ax;
    const dz = (zs[i + 1] ?? 0) - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const off = Math.hypot(ax + t * dx - x, az + t * dz - z);
    if (off < best.off) best = { s: (i + t) * sp, off };
  }
  return best;
}

describe('the Seven Mile Bridge: real geometry, the old road beside it', () => {
  it('runs Knights Key to Little Duck Key at its real length (about 11 km), the bridge one 10.9 km deck', () => {
    const length = SM.roads
      .filter((r) => SM.route.mainPath.includes(r.id))
      .reduce((sum, r) => sum + r.lengthM, 0);
    const deck = SM.roads
      .filter((r) => SM.route.mainPath.includes(r.id))
      .flatMap((r) => tagRows(r, 'bridge'))
      .reduce((sum, t) => sum + t.s1 - t.s0, 0);
    print(
      `main path ${length.toFixed(0)} m over ${SM.route.mainPath.length} roads, bridge deck ${deck.toFixed(0)} m`,
    );
    // The 1982 bridge is 6.765 miles (10.89 km); OSM's two ways measure 10,922 m.
    expect(length).toBeGreaterThan(10_900);
    expect(length).toBeLessThan(12_500);
    expect(deck).toBeGreaterThan(10_800);
    expect(deck).toBeLessThan(11_000);
  });

  it('samples every long bridge road at 6 m, and only the kicker road finer', () => {
    for (const r of SM.roads) {
      const bridge = tagRows(r, 'bridge').reduce((sum, t) => sum + t.s1 - t.s0, 0);
      if (r.lengthM < 1000) continue;
      expect(bridge, r.id).toBeGreaterThan(0.9 * r.lengthM);
      expect(r.sampleSpacingM, r.id).toBeCloseTo(6, 1);
    }
    const moser = roadOf(SM.roads, 'osm-sm-old-moser');
    expect(featuresOf(moser).some((f) => f.kind === 'gap')).toBe(true);
    expect(moser.sampleSpacingM).toBeCloseTo(2, 1);
  });

  it("follows the old bridge's real line on the north side, way D onto Little Duck Key included", () => {
    // The old road's own roads, sampled against the main line: always to the right (north, riding
    // west), and their west end past the start of way D (the path onto Little Duck Key, OSM way
    // 39107118, which the real-world spec's bake had left out).
    const main = SM.route.mainPath.map((id) => roadOf(SM.roads, id));
    const old = ['osm-sm-old-east', 'osm-sm-old-moser', 'osm-sm-old-west'].map((id) => roadOf(SM.roads, id));
    let checked = 0;
    for (const r of old) {
      const d = samplesOf(r);
      for (let i = 0; i < (d['x']?.length ?? 0); i += 25) {
        const x = d['x']?.[i] ?? 0;
        const z = d['z']?.[i] ?? 0;
        const near = main
          .map((m) => ({ m, n: nearestOn(m, x, z) }))
          .reduce((a, b) => (b.n.off < a.n.off ? b : a));
        const md = samplesOf(near.m);
        const k = Math.min((md['x']?.length ?? 2) - 2, Math.floor(near.n.s / near.m.sampleSpacingM));
        const tx = (md['x']?.[k + 1] ?? 0) - (md['x']?.[k] ?? 0);
        const tz = (md['z']?.[k + 1] ?? 0) - (md['z']?.[k] ?? 0);
        const mx = md['x']?.[k] ?? 0;
        const mz = md['z']?.[k] ?? 0;
        // Right of the travel direction: x east, z south, so right is (-tz, tx).
        const side = (x - mx) * -tz + (z - mz) * tx;
        expect(side, `${r.id} sample ${i}`).toBeGreaterThan(0);
        checked++;
      }
    }
    const [dx, dz] = frameSM.toWorld(24.6854355, -81.2185292); // way D's east end
    const west = roadOf(SM.roads, 'osm-sm-old-west');
    const end = samplesOf(west);
    const last = (end['x']?.length ?? 1) - 1;
    const pastD = nearestOn(west, dx, dz);
    print(
      `${checked} old-road samples all north of the highway; way D's east end ${pastD.off.toFixed(1)} m off the old road at s ${pastD.s.toFixed(0)} of ${west.lengthM.toFixed(0)}; the road ends at (${end['x']?.[last]?.toFixed(0)}, ${end['z']?.[last]?.toFixed(0)})`,
    );
    expect(checked).toBeGreaterThan(20);
    expect(pastD.off).toBeLessThan(3);
    expect(west.lengthM - pastD.s).toBeGreaterThan(300);
  });

  it("puts the 64 m Moser gap at the real missing span, the new bridge's hump beside it", () => {
    const moser = roadOf(SM.roads, 'osm-sm-old-moser');
    const gap = featuresOf(moser).find((f) => f.kind === 'gap');
    if (!gap) throw new Error('no gap');
    // The span the map does not draw: between the ends of OSM ways 39107582 and 39107581 (79.7 m),
    // the stub piers trimmed 8 m each side.
    const [ax, az] = frameSM.toWorld(24.7003378, -81.1692412);
    const [bx, bz] = frameSM.toWorld(24.700112, -81.1699901);
    const span = Math.hypot(bx - ax, bz - az);
    const a = nearestOn(moser, ax, az);
    const b = nearestOn(moser, bx, bz);
    print(
      `gap ${gap.s0.toFixed(1)}..${gap.s1.toFixed(1)} (${(gap.s1 - gap.s0).toFixed(1)} m) between the way ends at s ${a.s.toFixed(1)} and ${b.s.toFixed(1)} (${span.toFixed(1)} m apart), params ${JSON.stringify(gap.params)}`,
    );
    expect(span).toBeCloseTo(79.7, 0);
    expect(Math.abs(gap.s1 - gap.s0 - (span - 16))).toBeLessThan(1.5);
    expect(a.off).toBeLessThan(1);
    expect(b.off).toBeLessThan(1);
    expect(gap.s0).toBeGreaterThan(a.s);
    expect(gap.s1).toBeLessThan(b.s);
    // A miss: splash, respawn on the highway (the maintainer, round 3; the critic's far side does not
    // apply here).
    expect(gap.params?.['respawn']).toBe('main');
    // The new bridge humps over Moser Channel, beside the gap, not at its own middle.
    const bridge = roadOf(SM.roads, 'osm-sm-bridge');
    const y = samplesOf(bridge)['y'] ?? [];
    const top = y.indexOf(Math.max(...y));
    const gx = (ax + bx) / 2;
    const gz = (az + bz) / 2;
    const beside = nearestOn(bridge, gx, gz);
    print(
      `the bridge's hump peaks at s ${(top * bridge.sampleSpacingM).toFixed(0)} (${Math.max(...y).toFixed(1)} m); the gap is ${beside.off.toFixed(0)} m off it at s ${beside.s.toFixed(0)}`,
    );
    expect(Math.abs(top * bridge.sampleSpacingM - beside.s)).toBeLessThan(60);
  });

  it('is one alternate branch, marked, with aiTake 0, its decks tagged old-bridge', () => {
    expect(SM.route.branches ?? []).toHaveLength(1);
    for (const b of SM.route.branches ?? []) {
      expect(b.kind).toBe('alternate');
      expect(b.marked).toBe(true);
      expect(b.aiTake).toBe(0);
    }
    for (const id of ['osm-sm-old-east', 'osm-sm-old-moser', 'osm-sm-old-west']) {
      const r = roadOf(SM.roads, id);
      expect(tagRows(r, 'old-bridge'), id).toEqual(tagRows(r, 'bridge'));
      expect(tagRows(r, 'old-bridge').length, id).toBeGreaterThan(0);
    }
  });

  it('stages a ramp truck before a 30 m gap on each repair platform, on and off the old road', () => {
    for (const id of ['osm-sm-old-road', 'osm-sm-old-road-back']) {
      const r = roadOf(SM.roads, id);
      const truck = featuresOf(r).find((f) => f.kind === 'rampTruck');
      const gap = featuresOf(r).find((f) => f.kind === 'gap');
      if (!truck || !gap) throw new Error(`${id}: no truck or gap`);
      print(
        `${id}: truck ${truck.s0.toFixed(1)}..${truck.s1.toFixed(1)}, gap ${gap.s0.toFixed(1)}..${gap.s1.toFixed(1)}`,
      );
      // Static, never seeded off (no slot): the shortcut is always there.
      expect(truck.params?.['slot']).toBeUndefined();
      expect(gap.s1 - gap.s0).toBeCloseTo(30, 0);
      expect(gap.s0 - truck.s1).toBeGreaterThanOrEqual(0);
      expect(gap.s0 - truck.s1).toBeLessThan(5);
      expect(OLD_ROAD?.roads).toContain(id);
      // Playtest 4 (P4-10): the truck is as wide as the deck, so a rider anywhere on the platform
      // rides up its ramp rather than past it into the water.
      const edge = SM_ROAD.edgeIndex(id);
      const deck = SM_ROAD.lanesAt(edge, truck.s0);
      const lo = Math.min(...deck.map((l) => l.dCenterM - l.widthM / 2));
      const hi = Math.max(...deck.map((l) => l.dCenterM + l.widthM / 2));
      expect(Math.min(truck.d0, truck.d1), id).toBeLessThanOrEqual(lo);
      expect(Math.max(truck.d0, truck.d1), id).toBeGreaterThanOrEqual(hi);
    }
  });

  it('wakes a rider who misses any Seven Mile jump on the highway (playtest 4: "a miss respawns on the highway")', () => {
    const gaps = SM.roads.flatMap((r) =>
      featuresOf(r)
        .filter((f) => f.kind === 'gap')
        .map((f) => `${r.id} ${f.id}`),
    );
    const far = SM.roads.flatMap((r) =>
      featuresOf(r)
        .filter((f) => f.kind === 'gap' && f.params?.['respawn'] !== 'main')
        .map((f) => `${r.id} ${f.id}`),
    );
    print(`gaps: ${gaps.join(', ')}`);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    expect(far).toEqual([]);
  });
});

// ---- The jumps, measured in the sim, per bike ---------------------------------------------------

const BIKES = Object.values(bikeFiles)
  .map((b) => ({ id: b.id, bike: { contentId: `base:${b.id}`, ...b.handling } }))
  .sort((a, b) => a.bike.topSpeedMps - b.bike.topSpeedMps || a.id.localeCompare(b.id))
  .filter((b, i, all) => all.findIndex((c) => c.id === b.id) === i);
const RUSTBUCKET = BIKES.find((b) => b.id === 'rustbucket-400');

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
const BASE = gapSimConfig(SM.bundle, { route: SM.route });

interface Run {
  lipSpeed: number;
  clear: boolean;
  crash: SimEvent | undefined;
  respawn: SimEvent | undefined;
  edge: string;
  s: number;
}

/** One rider alone on the real road, the real systems around it, full throttle, straight ahead. */
function ride(
  bike: SimBikeDef,
  edgeId: string,
  s: number,
  d: number,
  speed: number,
  untilRespawn = false,
): Run {
  const config: SimConfig = { ...BASE, riders: [{ ...BASE.riders[0]!, bike }] };
  const world = createWorld(config);
  const edge = config.road.edges.findIndex((e) => e.id === edgeId);
  const p = addMover(world, 'rider', { edge, s, d, dir: 1 }, 0);
  for (const sys of SYSTEMS) sys.init(world, config);
  p.speed = speed;
  const events: SimEvent[] = [];
  for (let t = 0; t < 60 * 20; t++) {
    events.push(...stepWorld(world, config, SYSTEMS, [{ steer: 0, throttle: 255, brake: 0, flags: 0 }]));
    const crashed = events.some((e) => e.type === 'crash');
    if (
      untilRespawn
        ? events.some((e) => e.type === 'respawn')
        : crashed || events.some((e) => e.type === 'land')
    )
      break;
  }
  const crash = events.find((e) => e.type === 'crash');
  return {
    lipSpeed: Number(events.find((e) => e.type === 'jump')?.data['speed'] ?? NaN),
    clear: !crash && events.some((e) => e.type === 'land'),
    crash,
    respawn: events.find((e) => e.type === 'respawn'),
    edge: config.road.edges[p.pos.edge]?.id ?? '?',
    s: p.pos.s,
  };
}

describe('the Moser gap: the Rustbucket clears it flat out, a rider well under top speed does not', () => {
  const moser = roadOf(SM.roads, 'osm-sm-old-moser');
  const gap = featuresOf(moser).find((f) => f.kind === 'gap');
  const kicker = featuresOf(moser).find((f) => f.kind === 'ramp');
  if (!gap || !kicker) throw new Error('no Moser gap or kicker');

  it('every bike at least as fast as the Rustbucket clears it at full throttle; the Rustbucket by a small margin', () => {
    if (!RUSTBUCKET) throw new Error('no Rustbucket in the packs');
    const rows: string[] = [];
    let rustMargin = NaN;
    for (const b of BIKES) {
      // Flat out from 250 m back, at its top speed: what "full throttle" is on the old bridge's
      // kilometre-long straight before the gap.
      const run = ride(b.bike, moser.id, kicker.s0 - 250, 2, b.bike.topSpeedMps);
      const margin = run.edge === moser.id ? run.s - gap.s1 : NaN;
      rows.push(
        `${b.id}: top ${b.bike.topSpeedMps} m/s, lip ${run.lipSpeed.toFixed(2)} m/s, ${run.clear ? `lands ${Number.isNaN(margin) ? 'on the next road' : `${margin.toFixed(1)} m past the gap`}` : `misses (${JSON.stringify(run.crash?.data['cause'])})`}`,
      );
      if (b.bike.topSpeedMps >= RUSTBUCKET.bike.topSpeedMps) expect(run.clear, b.id).toBe(true);
      if (b.id === RUSTBUCKET.id) rustMargin = margin;
    }
    print(
      `Moser gap ${(gap.s1 - gap.s0).toFixed(1)} m, kicker ${JSON.stringify(kicker.params)}:\n  ${rows.join('\n  ')}`,
    );
    // A small margin: it lands past the far edge, and less than a third of the gap past it.
    expect(rustMargin).toBeGreaterThan(2);
    expect(rustMargin).toBeLessThan((gap.s1 - gap.s0) / 3);
  });

  it('the slowest lip speed that clears is well under the Rustbucket top speed, and above 85 % of it', () => {
    if (!RUSTBUCKET) throw new Error('no Rustbucket in the packs');
    const rows: string[] = [];
    for (const b of BIKES.filter((x) => x.bike.topSpeedMps >= RUSTBUCKET.bike.topSpeedMps)) {
      // Entering 2 m before the kicker, so the lip speed is the entry speed less the climb.
      let lo = 20;
      let hi = b.bike.topSpeedMps;
      let clearLip = NaN;
      let missLip = NaN;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        const run = ride(b.bike, moser.id, kicker.s0 - 2, 2, mid);
        if (run.clear) {
          hi = mid;
          clearLip = run.lipSpeed;
        } else {
          lo = mid;
          missLip = run.lipSpeed;
        }
      }
      rows.push(
        `${b.id}: misses at ${missLip.toFixed(2)} m/s, clears at ${clearLip.toFixed(2)} m/s at the lip`,
      );
      expect(clearLip, b.id).toBeGreaterThan(0.85 * RUSTBUCKET.bike.topSpeedMps);
      expect(clearLip, b.id).toBeLessThan(RUSTBUCKET.bike.topSpeedMps - 2);
    }
    print(`clearing speed at the lip:\n  ${rows.join('\n  ')}`);
  });

  it('a miss splashes and wakes the rider on the highway', () => {
    if (!RUSTBUCKET) throw new Error('no Rustbucket in the packs');
    const speed = 0.85 * RUSTBUCKET.bike.topSpeedMps;
    const run = ride(RUSTBUCKET.bike, moser.id, kicker.s0 - 2, 2, speed, true);
    print(
      `Rustbucket at ${speed.toFixed(1)} m/s: crash ${JSON.stringify(run.crash?.data)}, respawn ${JSON.stringify(run.respawn?.data)} on ${run.edge} s ${run.s.toFixed(0)}`,
    );
    expect(run.crash?.data).toMatchObject({ cause: 'gap', overboard: true, feature: gap.id });
    expect(run.respawn?.data).toMatchObject({ reason: 'splash', gap: gap.id, at: 'main' });
    expect(SM.route.mainPath).toContain(run.edge);
  });
});

describe('the repair platforms: a ramp truck hops the 30 m gap between the bridges', () => {
  it('every bike at least as fast as the Rustbucket clears both hops over the truck; a moped wakes on the highway', () => {
    if (!RUSTBUCKET) throw new Error('no Rustbucket in the packs');
    const rows: string[] = [];
    for (const id of ['osm-sm-old-road', 'osm-sm-old-road-back']) {
      const r = roadOf(SM.roads, id);
      const truck = featuresOf(r).find((f) => f.kind === 'rampTruck');
      const gap = featuresOf(r).find((f) => f.kind === 'gap');
      if (!truck || !gap) throw new Error(`${id}: no truck or gap`);
      for (const b of BIKES) {
        const run = ride(b.bike, id, truck.s0 - 8, (truck.d0 + truck.d1) / 2, b.bike.topSpeedMps, false);
        rows.push(
          `${id} ${b.id}: lip ${run.lipSpeed.toFixed(1)} m/s, ${run.clear ? `lands on ${run.edge} s ${run.s.toFixed(0)}` : 'misses'}`,
        );
        if (b.bike.topSpeedMps >= RUSTBUCKET.bike.topSpeedMps) expect(run.clear, `${id} ${b.id}`).toBe(true);
      }
      const moped = BIKES.find((b) => b.id === 'moped');
      if (moped) {
        const slow = ride(
          moped.bike,
          id,
          truck.s0 - 8,
          (truck.d0 + truck.d1) / 2,
          moped.bike.topSpeedMps,
          true,
        );
        rows.push(`${id} moped: ${JSON.stringify(slow.respawn?.data)} on ${slow.edge}`);
        // Playtest 4 (P4-10, wave C's check): a miss at either hop wakes on the highway, not past the gap.
        expect(slow.respawn?.data).toMatchObject({ gap: gap.id, at: 'main' });
        expect(SM.route.mainPath).toContain(slow.edge);
      }
    }
    print(`staging hops:\n  ${rows.join('\n  ')}`);
  });
});

// ---- Rivals and cops stay on the highway --------------------------------------------------------

describe('the turn-off: a rider who keeps right takes the old road, the field rides on', () => {
  it("puts the split zone over the shoulder: well inside a rider's reach, clear of the travel lane's centre, out to the edge", () => {
    // Playtest 4 (P4-10, the maintainer: "too hard to get on"; the feel audit's F10a): the zone used to
    // start 0.05 m inside a rider's reach (BIKE_HALF_WIDTH_M inside the rail), so only a bike pressed
    // against the rail took the turn-off; every other shortcut's zone starts 2 to 3 m inside it. It
    // sat past the lines the AI keeps so the field would not be swept onto the old road; since #489
    // the sim keeps rivals and cops off it (sim/ai/branches.ts), so the zone no longer has that job.
    // A rider holding the right lane's centre line still rides on along the highway.
    const zone = SM_ROAD.splitZones().find((z) =>
      OLD_ROAD?.roads.includes(SM_ROAD.edges[z.toEdge]?.id ?? ''),
    );
    if (!zone) throw new Error('no split zone onto the old road');
    const lanes = SM_ROAD.lanesAt(zone.edge, zone.s1);
    const edge = Math.max(...lanes.map((l) => l.dCenterM + l.widthM / 2));
    const reach = edge - BIKE_HALF_WIDTH_M;
    const laneCentre = Math.max(...lanes.filter((l) => l.kind === 'drive').map((l) => l.dCenterM));
    print(
      `zone on ${SM_ROAD.edges[zone.edge]?.id} s ${zone.s0.toFixed(0)}..${zone.s1.toFixed(0)} d ${zone.d0}..${zone.d1}; the right lane's centre at d ${laneCentre}, a rider's reach d ${reach}, the road's edge d ${edge}`,
    );
    expect(reach - zone.d0).toBeGreaterThanOrEqual(1.5);
    expect(zone.d0).toBeGreaterThan(laneCentre + 1);
    expect(zone.d1).toBeGreaterThan(edge);
    // Long enough to aim at: about 80 m, twice the old 40 m.
    expect(zone.s1 - zone.s0).toBeGreaterThan(75);
  });

  it(
    'in a race, a rider keeping right rides the old road to the finish while the field races the bridge',
    { timeout: 300_000 },
    () => {
      const reg = registryFromGlob(
        import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
      );
      const choice = regionChoices(reg).find((c) => lookup(reg.events, c.eventId).region === 'florida-keys');
      if (!choice) throw new Error('no Keys free-play event');
      const route = 'base:osm-seven-mile-run';
      const config = buildSimConfig(
        reg,
        createStreamCache().forEvent(reg, choice.eventId, undefined, route),
        {
          seed: 1,
          eventId: choice.eventId,
          route,
        },
      );
      expect(config.event.routeId).toBe(route);
      const branch = new Set((OLD_ROAD?.roads ?? []).map((id) => config.road.edgeIndex(id)));
      const sim = createSim(config);
      const bot = createBot();
      const player = config.riders.findIndex((r) => r.controller.kind === 'player');
      // The bot keeps 0.6 m off every edge, so here it rides like a person taking the old road: full
      // right through the zone's lead-in, then the bot's own riding.
      const zone = config.route.shortcuts.find((z) =>
        OLD_ROAD?.roads.includes(config.road.edges[z.toEdge]?.id ?? ''),
      );
      if (!zone) throw new Error('no split zone onto the old road');
      let snap = sim.snapshot();
      let playerOn = 0;
      let finishTick = -1;
      const others = new Map<string, number>();
      const farthest = new Map<number, number>();
      while (!sim.isOver() && sim.tick < 60 * 600) {
        const actions = emptyActions();
        bot.drive(snap, player, config.route, actions);
        const me = snap.entities[player];
        if (me && me.road.edge === zone.edge && me.road.s > zone.s0 - 90 && me.road.s <= zone.s1)
          actions.steer = 1;
        sim.step([toSimInput(actions)]);
        snap = sim.snapshot();
        if (finishTick < 0 && snap.race.finishOrder.includes(player)) finishTick = sim.tick;
        for (const [i, e] of snap.entities.entries()) {
          if (e.kind !== 'rider' || i >= config.riders.length) continue;
          farthest.set(i, Math.max(farthest.get(i) ?? 0, config.route.progressAt(e.road.edge, e.road.s)));
          if (!branch.has(e.road.edge)) continue;
          const who = config.riders[i]?.contentId ?? '?';
          if (i === player) playerOn++;
          else others.set(who, (others.get(who) ?? 0) + 1);
        }
      }
      const field = config.riders.map((r, i) => ({ r, i })).filter(({ i }) => i !== player);
      const cops = field.filter(({ r }) => r.faction === 'law').length;
      // Not asserted here: whether a rival or cop ever lands on the old road is the sim's rule
      // (sim/ai's branch rule and sim/cops); a kick, or a pack passing a car on the shoulder, can still
      // put one against the rail in the zone.
      print(
        `${sim.tick} ticks; the player on the old road for ${playerOn} ticks, finished at tick ${finishTick}; ${field.length} others (${cops} cops) rode to ${field.map(({ i }) => ((farthest.get(i) ?? 0) / 1000).toFixed(1)).join(', ')} km; others on the old road: ${others.size ? JSON.stringify([...others]) : 'none'}`,
      );
      expect(playerOn).toBeGreaterThan(60 * 60);
      expect(finishTick).toBeGreaterThan(0);
      // The field raced the bridge past the old road's span.
      const leave = config.route.progressAt(config.road.edgeIndex('osm-sm-bridge'), 0);
      expect(field.filter(({ i }) => (farthest.get(i) ?? 0) > leave + 1000).length).toBeGreaterThan(0);
    },
  );
});

// ---- Duval Street -------------------------------------------------------------------------------

const DV = bundleOf('osm-keys-duval');
const DV_ROAD = createRoadNetwork(DV.bundle);
const frameDV = geoFrame(DV.network.crs.originLatDeg, DV.network.crs.originLonDeg);

describe('Duval Street: Whitehead, the Southernmost Point and Duval at their real size', () => {
  it('rides Whitehead south, South Street at the buoy, and all of Duval north to Front Street', () => {
    const real = DV.roads.map((r) => (r as unknown as { realName?: string }).realName);
    const length = DV.roads.reduce((sum, r) => sum + r.lengthM, 0);
    const tightest = Math.min(
      ...DV.roads.map((r) => 1 / Math.max(...(samplesOf(r)['kappa'] ?? []).map((k) => Math.abs(k)))),
    );
    print(
      `${DV.roads.length} roads (${real.join(', ')}), ${length.toFixed(0)} m, tightest corner ${tightest.toFixed(1)} m`,
    );
    expect(real).toEqual(['Whitehead Street', 'Duval Street']);
    // Duval is "just over 1.25 miles"; Whitehead from Mallory Square to the buoy about 1.5 km.
    expect(length).toBeGreaterThan(3200);
    expect(length).toBeLessThan(3800);
    // The two right-angle corners: tight, but no tighter than Russian Hill's 16 m.
    expect(tightest).toBeGreaterThan(14);
  });

  it('stands the buoy and the Mile 0 marker where the real ones are', () => {
    // The real points from OpenStreetMap (2026-10-04): node 1283754992 "Southernmost Point Buoy" and
    // node 4898623221 "Mile 0". (Mallory Square's pier is placed for sight, in the next case.)
    const REAL: Record<string, { at: [number, number]; within: number }> = {
      'southernmost-buoy': { at: [24.5465112, -81.7974964], within: 8 },
      // On the sidewalk: the OSM point is 2.3 m from the road's centre line, so the marker stands a
      // few metres out, past the verge.
      'mile-0': { at: [24.5552807, -81.8040252], within: 7 },
    };
    const found = new Set<string>();
    for (const [i, r] of DV.roads.entries()) {
      for (const f of featuresOf(r).filter((x) => x.kind === 'landmark')) {
        const want = REAL[f.id];
        if (!want) continue;
        found.add(f.id);
        const edge = DV_ROAD.edgeIndex(r.id);
        expect(edge, r.id).toBeGreaterThanOrEqual(0);
        const at = DV_ROAD.toWorld(edge, (f.s0 + f.s1) / 2, (f.d0 + f.d1) / 2, 0);
        const [x, z] = frameDV.toWorld(want.at[0], want.at[1]);
        const off = Math.hypot(at.x - x, at.z - z);
        print(
          `${f.id} (${String(f.params?.['model'])}) on ${r.id} s ${f.s0.toFixed(0)} d ${f.d0.toFixed(1)}..${f.d1.toFixed(1)}: ${off.toFixed(1)} m from the real point`,
        );
        expect(off, f.id).toBeLessThan(want.within);
        expect(String(f.params?.['model'])).toMatch(/^models\/landmarks\/keys-landmarks#/);
        void i;
      }
    }
    expect([...found].sort()).toEqual(Object.keys(REAL).sort());
  });

  it("stands Mallory Square's pier where the finish can see it, on the Gulf side, its deck square to the road", () => {
    // T10.4, wave B's punch list (item 2): the real pier is about 190 m from Duval's end, so the race
    // never showed it. The rule is sight: the pier stands within SIGHT_M of the finish line, on the
    // side the Mallory Square zone is, clear of the verge (the road lint's `landmark-clear` runs on
    // every network in region-routes.test.ts), and turned about square to the road.
    const SIGHT_M = 60;
    /** The verge ends 7 m from the centre line here; the forecourt starts within 5 m of that. */
    const FORECOURT_FROM_ROAD_M = 12;
    const road = roadOf(DV.roads, DV.route.finish.road);
    const edge = DV_ROAD.edgeIndex(road.id);
    const pier = featuresOf(road).find((f) => f.id === 'mallory-pier');
    const zone = featuresOf(road).find((f) => f.id === 'mallory-sunset');
    expect(pier, 'the pier is a landmark of the finish road').toBeDefined();
    expect(zone, 'the Mallory Square zone').toBeDefined();
    if (!pier || !zone) return;
    const at = DV_ROAD.toWorld(edge, (pier.s0 + pier.s1) / 2, (pier.d0 + pier.d1) / 2, 0);
    const line = DV_ROAD.toWorld(edge, DV.route.finish.s, 0, 0);
    const away = Math.hypot(at.x - line.x, at.z - line.z);
    print(
      `Mallory pier ${away.toFixed(1)} m from the finish line (s ${((pier.s0 + pier.s1) / 2).toFixed(0)}, d ${((pier.d0 + pier.d1) / 2).toFixed(1)}, yaw ${String(pier.params?.['yawDeg'])})`,
    );
    expect(away).toBeLessThan(SIGHT_M);
    // Nothing stands between the road and the pier: its footprint (the ground the scenery keeps off)
    // reaches back to within a few metres of the verge, an open forecourt rather than a lone box at the
    // water's edge a row of facades could hide.
    const nearEdge = Math.min(Math.abs(pier.d0), Math.abs(pier.d1));
    expect(nearEdge).toBeLessThanOrEqual(FORECOURT_FROM_ROAD_M);
    expect(Math.sign(pier.d0 + pier.d1)).toBe(Math.sign(zone.d0 + zone.d1));
    const yaw = Number(pier.params?.['yawDeg']);
    // The kit's +Z lies along the road and its seaward edge on -Z: a quarter turn puts that edge away
    // from the road, a left-hand pier (d < 0) at -90 and a right-hand one at +90.
    expect(Math.abs(yaw - 90 * Math.sign(pier.d0 + pier.d1))).toBeLessThanOrEqual(10);
  });
});
