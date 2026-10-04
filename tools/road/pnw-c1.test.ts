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
import { FERRY, FESTIVAL, PACK, PNW_C1 } from './tracks/pnw-c1';

// The Pacific Northwest track as baked into its region pack (playtest 1c, 2026-09-30: "Pnw and sf
// first then others"): the files are fresh, pass the schemas and the road lint, and the track has
// the region's shape: three race lengths about 2.8, 4.4 and 6.6 km, real forest bends, a railed
// trestle, the Logging Spur shortcut with its log-deck ramp, a ramp truck and boost pads. Run W-U
// (the pitch deck's #12) adds the places: the car ferry the race rides across, the clear-cut round
// the spur, and the Stump Social on Espresso Row.

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

  it('has three race lengths, about 2.8, 4.4 and 6.6 km, each carrying on from the last', () => {
    const lengths = routes.map((r) => createRouteProgress(net, r).length);
    console.log(`PNW routes: ${ROUTE_IDS.map((r, i) => `${r} ${lengths[i]?.toFixed(0)} m`).join(', ')}`);
    const [short = 0, standard = 0, long = 0] = lengths;
    // Run W-U: each 400 m longer than before, for the ferry dock and the ferry.
    expect(short).toBeGreaterThan(2600);
    expect(short).toBeLessThan(3000);
    expect(standard).toBeGreaterThan(4100);
    expect(standard).toBeLessThan(4500);
    expect(long).toBeGreaterThan(6400);
    expect(long).toBeLessThan(6800);
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

  it('rails the trestle and the ferry slip spans over the water and nothing else; decks stay above sea level', () => {
    const trestle = id('pnw-trestle');
    for (let s = 110; s <= 750; s += 20) {
      for (const side of ['left', 'right'] as const)
        expect(net.barrierAt(trestle, s, side), `trestle ${s} ${side}`).toEqual({ kind: 'rail', heightM: 1 });
      expect(net.surfaceHeight(trestle, s, 0)).toBeGreaterThan(0);
    }
    // Run W-U: the two transfer spans between the docks and the ferry are railed; the ferry is not.
    const landing = id('pnw-ferry-landing');
    const spans = (s: number) => (s >= 150 && s <= FERRY.hullS0) || (s >= FERRY.hullS1 && s <= 340);
    for (let s = 0; s <= (net.edges[landing]?.length ?? 0); s += 2)
      for (const side of ['left', 'right'] as const) {
        const rail = net.barrierAt(landing, s, side);
        if (spans(s)) expect(rail, `landing ${s} ${side}`).toEqual({ kind: 'rail', heightM: 1.1 });
        else expect(rail, `landing ${s} ${side}`).toBeNull();
      }
    for (const name of ['pnw-cedar-hollow', 'pnw-espresso-row', 'pnw-logging-spur'])
      for (let s = 0; s <= (net.edges[id(name)]?.length ?? 0); s += 50)
        expect(net.barrierAt(id(name), s, 'right'), `${name} ${s}`).toBeNull();
  });

  it('rides up the ramp onto the ferry, level across its deck, and off the far ramp (run W-U)', () => {
    const landing = id('pnw-ferry-landing');
    const y = (s: number) => net.surfaceHeight(landing, s, 0);
    const base = y(40);
    const deck = base + FERRY.heightM;
    expect(y(FERRY.rampUpS - 1)).toBeCloseTo(base, 3);
    for (let s = FERRY.rampUpS + FERRY.rampM; s <= FERRY.rampUpS + FERRY.rampM + FERRY.deckM; s += 2)
      expect(y(s), `deck ${s}`).toBeCloseTo(deck, 3);
    expect(y(FERRY.rampUpS + 2 * FERRY.rampM + FERRY.deckM + 1)).toBeCloseTo(base, 3);
    // The hull covers the level deck and the top of each ramp.
    expect(FERRY.hullS0).toBeLessThan(FERRY.rampUpS + FERRY.rampM);
    expect(FERRY.hullS1).toBeGreaterThan(FERRY.rampUpS + FERRY.rampM + FERRY.deckM);
    for (const side of ['left', 'right'] as const) {
      const v = net.vergeAt(landing, 240, side);
      expect([v.widthM, v.surface, v.edge]).toEqual([4.5, 'shoulder', 'hard']);
    }
    // Parked pickups and a coffee cart on the deck's outer lanes, a stair tower at each end of each,
    // all off the lanes (the road lint checks that) and inside the hull.
    const deckFeatures = net.featuresOf(landing, 'hazard');
    const count = (o: string) => deckFeatures.filter((f) => f.params?.['object'] === o).length;
    expect([count('pickup'), count('coffee-cart'), count('stair-tower')]).toEqual([18, 1, 4]);
    for (const f of deckFeatures) {
      expect(f.params?.['solid'], f.id).toBe(true);
      expect(f.s0, f.id).toBeGreaterThanOrEqual(FERRY.hullS0);
      expect(f.s1, f.id).toBeLessThanOrEqual(FERRY.hullS1);
      expect(Math.max(Math.abs(f.d0), Math.abs(f.d1)), f.id).toBeLessThanOrEqual(10);
    }
  });

  it('runs the Logging Spur through a fresh clear-cut, stumps all over its dirt and a log deck at its jump', () => {
    const spur = id('pnw-logging-spur');
    for (const side of ['left', 'right'] as const) {
      const v = net.vergeAt(spur, 200, side);
      expect([v.widthM, v.surface, v.edge]).toEqual([16, 'dirt', 'soft']);
    }
    const hazards = net.featuresOf(spur, 'hazard');
    const stumps = hazards.filter((f) => f.params?.['object'] === 'stump');
    console.log(`clear-cut: ${stumps.length} stumps on the spur`);
    expect(stumps.length).toBeGreaterThan(80);
    expect(stumps.length).toBeLessThan(120);
    for (const f of stumps) {
      const near = Math.min(Math.abs(f.d0), Math.abs(f.d1));
      const far = Math.max(Math.abs(f.d0), Math.abs(f.d1));
      expect(near, f.id).toBeGreaterThanOrEqual(3.3);
      expect(far, f.id).toBeLessThanOrEqual(18.5);
    }
    const ramp = net.featuresOf(spur, 'ramp')[0];
    const piles = hazards.filter((f) => f.params?.['object'] === 'log-pile');
    expect(piles).toHaveLength(2);
    for (const p of piles) {
      expect(p.s0).toBeLessThan(ramp?.s0 ?? 0);
      expect(p.s1).toBeGreaterThan(ramp?.s1 ?? 0);
    }
    // Nothing stands where the jump lands, out to 60 m past the ramp.
    for (const f of stumps)
      expect(f.s1 < (ramp?.s0 ?? 0) - 10 || f.s0 > (ramp?.s1 ?? 0) + 60, f.id).toBe(true);
    // The grade beside it is the log trucks' road, the clear-cut on its right.
    const grade = net.edges[id('pnw-switchback-grade')];
    expect(grade?.tags.some((t) => t.tag === 'logging' && t.side === 'both')).toBe(true);
    expect(net.vergeAt(id('pnw-switchback-grade'), 400, 'right').widthM).toBe(16);
  });

  it('closes Espresso Row for the Stump Social: a bear on every corner, barricades, and a crowd on both sidewalks', () => {
    const row = id('pnw-espresso-row');
    for (const side of ['left', 'right'] as const) {
      const v = net.vergeAt(row, 300, side);
      expect([v.widthM, v.surface, v.edge]).toEqual([4, 'kerb', 'hard']);
    }
    const hazards = net.featuresOf(row, 'hazard');
    const bears = hazards.filter((f) => f.params?.['object'] === 'bear');
    expect(bears).toHaveLength(FESTIVAL.sideStreets.length * 4);
    for (const c of FESTIVAL.sideStreets) {
      const at = bears.filter((b) => Math.abs((b.s0 + b.s1) / 2 - c) < FESTIVAL.streetM);
      expect(at.map((b) => Math.sign(b.d0)).sort(), `corner ${c}`).toEqual([-1, -1, 1, 1]);
    }
    expect(hazards.filter((f) => f.params?.['object'] === 'barricade')).toHaveLength(4);
    const crowd = net.featuresOf(row, 'roadsideZone').filter((z) => z.id.startsWith('stump-social-crowd'));
    expect(crowd.length).toBeGreaterThanOrEqual(10);
    for (const z of crowd) {
      expect(z.s0).toBeGreaterThanOrEqual(FESTIVAL.s0);
      expect(z.s1).toBeLessThanOrEqual(FESTIVAL.s1);
    }
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

  it('places the set-piece slots: ramp truck spots on the trestle straight, boost pads, a cop spawn', () => {
    const all = net.edges.flatMap((e) => e.features.map((f) => ({ e, f })));
    const trucks = all.filter(({ f }) => f.kind === 'rampTruck');
    // Playtest 1c item 2: three candidate spots, one picked per race by the seed. Playtest 3 (T5.2)
    // adds a fourth that is always there, in no slot: the Mill Yard Cut's (tools/road/truck-shortcuts.test.ts).
    expect(trucks.map(({ e }) => e.id)).toEqual([
      'pnw-trestle',
      'pnw-trestle',
      'pnw-trestle',
      'pnw-sawmill-flats',
    ]);
    expect(trucks.filter(({ f }) => f.params?.['slot'] === 'pnw-truck')).toHaveLength(3);
    for (const { e, f: t } of trucks) {
      // Straight from the truck's foot to well past a top-speed landing (the cut's truck stands at
      // the end of its road: its flight goes on over the next).
      for (let s = t.s0; s <= Math.min(t.s1 + 150, e.length); s += 2)
        expect(Math.abs(net.kappaAt(e.index, s))).toBeLessThanOrEqual(0.002);
    }
    // Two pad slots: two spots at the landing and three on the sawmill flats, and the Mill Yard
    // Cut's own pad (T5.2), in no slot.
    expect(all.filter(({ f }) => f.kind === 'boostPad')).toHaveLength(6);
    expect(all.filter(({ f }) => f.kind === 'copSpawn')).toHaveLength(1);
  });

  it('names a live region sign or billboard in every board slot, off the road, on the long route', () => {
    const regionFile = JSON.parse(readFileSync(path.join(region, 'region.json'), 'utf8')) as {
      signs: { id: string; status?: string }[];
      billboards: { id: string; status?: string }[];
    };
    const items = new Map([...regionFile.signs, ...regionFile.billboards].map((i) => [i.id, i]));
    expect(regionFile.signs.length).toBeGreaterThanOrEqual(3);
    expect(regionFile.billboards.length).toBeGreaterThanOrEqual(2);
    const slots = net.edges.flatMap((e) =>
      e.features.filter((f) => f.kind === 'billboard').map((f) => ({ e, f })),
    );
    // Every item has a slot somewhere in the region, so each one can be seen and vetoed in a race,
    // on this track or another of the region's networks (run W-S: Lake Samish's junction sign):
    // tools/road/board-slots-on-land.test.ts checks that over all the region's roads. Here, each
    // slot of this track names a live item, off the road, on the long route.
    expect(slots.length).toBeGreaterThan(0);
    for (const { f } of slots) expect(items.has(f.item ?? ''), f.id).toBe(true);
    const all = routes.map((r) => createRouteProgress(net, r));
    for (const { e, f } of slots) {
      expect(items.get(f.item ?? '')?.status, f.id).toBe('live');
      expect(Math.sign(f.d0), f.id).toBe(Math.sign(f.d1));
      expect(Math.min(Math.abs(f.d0), Math.abs(f.d1)), f.id).toBeGreaterThanOrEqual(6.5);
      expect(all[2]?.allows(e.index), f.id).toBe(true);
    }
    // All but the ridge's sign and the mill yard's (T5.2: the flats are on the long route only) are
    // on the standard route too.
    expect(slots.filter(({ e }) => all[1]?.allows(e.index)).length).toBe(slots.length - 2);
  });
});
