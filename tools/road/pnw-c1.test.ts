import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { roadNetworkSchema, roadSchema, routeSchema } from '../../src/content/schema';
import {
  compileTrack,
  createRoadNetwork,
  createRouteProgress,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { PACK, PNW_C1 } from './tracks/pnw-c1';

// The Pacific Northwest track as baked into its region pack (playtest 1c, 2026-09-30: "Pnw and sf
// first then others"): the files are fresh, pass the schemas and the road lint, and the track has
// the region's shape: three race lengths about 2.4, 3.9 and 6.2 km, real forest bends, a railed
// trestle, the Logging Spur shortcut with its log-deck ramp, a ramp truck and boost pads.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const region = path.join(root, 'packs', PACK, 'regions/pacific-northwest');
const read = (dir: string, id: string): unknown =>
  JSON.parse(readFileSync(path.join(region, dir, `${id}.json`), 'utf8')) as unknown;

const compiled = compileTrack(PNW_C1);
const network = read('networks', 'pnw-c1') as BakedNetwork;
const roads = network.roads.map((id) => read('roads', id) as BakedRoad);
const ROUTE_IDS = ['pnw-hollow-sprint', 'pnw-espresso-run', 'pnw-sawmill-haul'] as const;
const routes = ROUTE_IDS.map((id) => read('routes', id) as BakedRoute);
const net = createRoadNetwork({ network, roads });
const id = (name: string) => net.edgeIndex(name);

describe('tools/road: the baked Pacific Northwest track', () => {
  it('is fresh: the pack files equal a new compile of tools/road/tracks/pnw-c1.ts', () => {
    expect(PACK).toBe('region-pnw');
    expect(network).toEqual(compiled.network);
    expect(roads).toEqual(compiled.roads);
    expect(routes).toEqual(compiled.routes);
  });

  it('passes the content schemas and the road lint with no issues', () => {
    expect(roadNetworkSchema.safeParse(network).success).toBe(true);
    for (const r of roads) expect(roadSchema.safeParse(r).success, r.id).toBe(true);
    for (const r of routes) expect(routeSchema.safeParse(r).success, r.id).toBe(true);
    expect(lintRoadNetwork({ network, roads, routes })).toEqual([]);
  });

  it('has three race lengths, about 2.4, 3.9 and 6.2 km, each carrying on from the last', () => {
    const lengths = routes.map((r) => createRouteProgress(net, r).length);
    console.log(`PNW routes: ${ROUTE_IDS.map((r, i) => `${r} ${lengths[i]?.toFixed(0)} m`).join(', ')}`);
    const [short = 0, standard = 0, long = 0] = lengths;
    expect(short).toBeGreaterThan(2200);
    expect(short).toBeLessThan(2600);
    expect(standard).toBeGreaterThan(3700);
    expect(standard).toBeLessThan(4100);
    expect(long).toBeGreaterThan(6000);
    expect(long).toBeLessThan(6400);
  });

  it('is twisty: bends tighter than a 200 m radius both ways, and over a quarter of it tighter than 300 m', () => {
    const ks = roads.flatMap((r) => r.samples.data['kappa'] ?? []);
    expect(Math.max(...ks)).toBeGreaterThan(1 / 200);
    expect(Math.min(...ks)).toBeLessThan(-1 / 200);
    // Share of the road bending tighter than a 300 m radius.
    const bendy = ks.filter((k) => Math.abs(k) > 1 / 300).length / ks.length;
    console.log(`PNW: ${(bendy * 100).toFixed(0)} % of samples bend tighter than 300 m`);
    expect(bendy).toBeGreaterThan(0.25);
  });

  it('rails the trestle over the water and nothing else; the deck stays above sea level', () => {
    const trestle = id('pnw-trestle');
    for (let s = 110; s <= 750; s += 20) {
      for (const side of ['left', 'right'] as const)
        expect(net.barrierAt(trestle, s, side), `trestle ${s} ${side}`).toEqual({ kind: 'rail', heightM: 1 });
      expect(net.surfaceHeight(trestle, s, 0)).toBeGreaterThan(0);
    }
    for (const name of ['pnw-ferry-landing', 'pnw-cedar-hollow', 'pnw-espresso-row', 'pnw-logging-spur'])
      for (let s = 0; s <= (net.edges[id(name)]?.length ?? 0); s += 50)
        expect(net.barrierAt(id(name), s, 'right'), `${name} ${s}`).toBeNull();
  });

  it('the Logging Spur saves 40–100 m, carries only a shortcut lane, and its log-deck ramp is straight', () => {
    const progress = createRouteProgress(net, routes[0] as BakedRoute);
    expect(progress.shortcuts).toHaveLength(1);
    const cut = progress.shortcuts[0];
    console.log(`Logging Spur saves ${cut?.gainM.toFixed(1)} m`);
    expect(cut?.edge).toBe(id('pnw-ferry-landing'));
    expect(cut?.gainM).toBeGreaterThan(40);
    expect(cut?.gainM).toBeLessThan(100);
    for (const name of ['c-pnw-spur-in', 'pnw-logging-spur', 'c-pnw-spur-out'])
      expect(net.lanesAt(id(name), 5).map((l) => l.kind)).toEqual(['shortcut']);
    const ramps = net.featuresOf(id('pnw-logging-spur'), 'ramp');
    expect(ramps).toHaveLength(1);
    const r = ramps[0];
    for (let s = r?.s0 ?? 0; s <= (r?.s1 ?? 0) + 80; s += 2)
      expect(Math.abs(net.kappaAt(id('pnw-logging-spur'), s))).toBeLessThan(1e-4);
  });

  it('places the set-piece slots: a ramp truck on the trestle straight, two boost pads, a cop spawn', () => {
    const all = net.edges.flatMap((e) => e.features.map((f) => ({ e, f })));
    const trucks = all.filter(({ f }) => f.kind === 'rampTruck');
    expect(trucks.map(({ e }) => e.id)).toEqual(['pnw-trestle']);
    const t = trucks[0]?.f;
    // Straight from the truck's foot to well past a top-speed landing.
    for (let s = t?.s0 ?? 0; s <= (t?.s1 ?? 0) + 150; s += 2)
      expect(Math.abs(net.kappaAt(id('pnw-trestle'), s))).toBeLessThanOrEqual(0.002);
    expect(all.filter(({ f }) => f.kind === 'boostPad')).toHaveLength(2);
    expect(all.filter(({ f }) => f.kind === 'copSpawn')).toHaveLength(1);
  });

  it('names a live region sign or billboard in every board slot, off the road, on the long route', () => {
    const regionFile = JSON.parse(readFileSync(path.join(region, 'region.json'), 'utf8')) as {
      signs: { id: string; status?: string }[];
      billboards: { id: string; status?: string }[];
    };
    const items = new Map([...regionFile.signs, ...regionFile.billboards].map((i) => [i.id, i]));
    expect(regionFile.signs.length).toBeGreaterThanOrEqual(3);
    expect(regionFile.signs.length).toBeLessThanOrEqual(5);
    expect(regionFile.billboards).toHaveLength(2);
    const slots = net.edges.flatMap((e) =>
      e.features.filter((f) => f.kind === 'billboard').map((f) => ({ e, f })),
    );
    // Every item has a slot, so each one can be seen and vetoed in a race.
    expect(new Set(slots.map(({ f }) => f.item))).toEqual(new Set(items.keys()));
    const all = routes.map((r) => createRouteProgress(net, r));
    for (const { e, f } of slots) {
      expect(items.get(f.item ?? '')?.status, f.id).toBe('live');
      expect(Math.sign(f.d0), f.id).toBe(Math.sign(f.d1));
      expect(Math.min(Math.abs(f.d0), Math.abs(f.d1)), f.id).toBeGreaterThanOrEqual(6.5);
      expect(all[2]?.allows(e.index), f.id).toBe(true);
    }
    // All but the ridge's sign are on the standard route too.
    expect(slots.filter(({ e }) => all[1]?.allows(e.index)).length).toBe(slots.length - 1);
  });
});
