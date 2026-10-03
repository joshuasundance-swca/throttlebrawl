import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { roadNetworkSchema, roadSchema, routeSchema } from '../../src/content/schema';
import { themeAt } from '../../src/render/scenery';
import {
  compileTrack,
  createRoadNetwork,
  createRouteProgress,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { lanesPerDirection } from '../../src/road/cross-section';
import { PACK, SF_WATERFRONT, STREET_HALF_M } from './tracks/sf-waterfront';

// San Francisco's waterfront as baked into the region-sf pack (run W-U; the pitch deck's #8,
// "Later": "the waterfront (palms, piers, sea lions, an invented clock-tower ferry building)"). The
// files are fresh, pass the schemas and the road lint, and the boulevard is what the pitch drew: two
// lanes each way along the bay, a promenade and pier sheds the whole way on the bay side, the ferry
// hall halfway, waterfront blocks and side streets on the city side, the sea lions at the finish, a
// tight bend before it, and its own signs, billboards and smashables (pop-ups and cafe tables only).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const regionDir = path.join(root, 'packs', PACK, 'regions/san-francisco');
const read = (dir: string, id: string): unknown =>
  JSON.parse(readFileSync(path.join(regionDir, dir, `${id}.json`), 'utf8')) as unknown;

const compiled = compileTrack(SF_WATERFRONT);
const network = read('networks', 'sf-waterfront') as BakedNetwork;
const roads = network.roads.map((id) => read('roads', id) as BakedRoad);
const route = read('routes', 'sf-waterfront-run') as BakedRoute & { name?: string };
const net = createRoadNetwork({ network, roads });
const progress = createRouteProgress(net, route);
const region = read('', 'region') as {
  networks: string[];
  signs: { id: string; text: string }[];
  billboards: { id: string; text: string }[];
  smashables: { id: string; kind: string; tags?: string[] }[];
};

/** Every span of `tag` on the route, by road, in road order. */
function spans(tag: string): { road: string; s0: number; s1: number }[] {
  return roads.flatMap((r) =>
    (r.tags ?? []).filter((t) => t.tag === tag).map((t) => ({ road: r.id, s0: t.s0, s1: t.s1 })),
  );
}

describe('tools/road: the baked San Francisco waterfront', () => {
  it('bakes into the region-sf pack and is fresh: the files equal a new compile of tracks/sf-waterfront.ts', () => {
    expect(PACK).toBe('region-sf');
    expect(network).toEqual(compiled.network);
    expect(roads).toEqual(compiled.roads);
    expect([route]).toEqual(compiled.routes);
    expect(region.networks).toContain('sf-waterfront');
  });

  it('passes the content schemas and the road lint with no issues', () => {
    expect(roadNetworkSchema.safeParse(network).success).toBe(true);
    for (const r of roads) expect(roadSchema.safeParse(r).success, r.id).toBe(true);
    expect(routeSchema.safeParse(route).success).toBe(true);
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
  });

  it('is a named route of about 3.3 km, two lanes each way, long sweeps and one tight bend before the finish', () => {
    expect(route.name).toBe('Waterfront');
    expect(progress.length).toBeGreaterThan(3000);
    expect(progress.length).toBeLessThan(3800);
    for (const r of roads)
      for (const sec of r.laneSections)
        expect(lanesPerDirection(sec.lanes), r.id).toEqual({ forward: 2, oncoming: 2 });
    const radius = roads.map((r) => {
      const e = net.edges[net.edgeIndex(r.id)]!;
      let k = 0;
      for (let s = 0; s <= e.length; s += 2) k = Math.max(k, Math.abs(net.kappaAt(e.index, s)));
      return 1 / k;
    });
    console.log(
      `SF waterfront: ${roads.map((r, i) => `${r.id} ${r.lengthM.toFixed(0)} m (tightest radius ${radius[i]!.toFixed(0)} m)`).join(', ')}; route ${progress.length.toFixed(1)} m`,
    );
    // Every road but the last is a long sweep you take flat out; the last has the braking bend.
    for (const r of radius.slice(0, -1)) expect(r).toBeGreaterThan(600);
    expect(radius.at(-1)).toBeLessThan(220);
  });

  it('the bay side is promenade the whole way, the pier sheds and the ferry hall on its edge; the city side its blocks', () => {
    let checked = 0;
    for (const r of roads) {
      for (let s = 0; s <= r.lengthM; s += 20) {
        expect(themeAt(r.tags, 'right', s), `${r.id} s ${s} right`).toBe('promenade');
        expect(themeAt(r.tags, 'left', s), `${r.id} s ${s} left`).toBe('wharf');
        checked += 2;
      }
    }
    const sheds = spans('pier-shed');
    const halls = spans('ferry-hall');
    const streets = spans('side-street');
    console.log(
      `[examined] ${checked} road stations; ${sheds.length} pier sheds, ${halls.length} ferry hall, ${streets.length} side streets, ${spans('sea-lions').length} sea lion stretch`,
    );
    expect(sheds.length).toBeGreaterThanOrEqual(15);
    expect(halls).toHaveLength(1);
    expect(halls[0]?.road).toBe('sf-wf-ferry-plaza');
    for (const s of streets) expect(s.s1 - s.s0).toBeCloseTo(2 * STREET_HALF_M, 5);
    expect(streets.length).toBeGreaterThanOrEqual(8);
    expect(spans('sea-lions').map((x) => x.road)).toEqual(['sf-wf-sea-lion-landing']);
    // The ferry plaza faces the hall across the boulevard.
    const plaza = spans('ferry-plaza')[0];
    expect(plaza && halls[0] && plaza.s0 <= halls[0].s0 && plaza.s1 >= halls[0].s1).toBe(true);
  });

  it('the ground beside it: a splash at the seawall, the building fronts hard, open asphalt at a side street', () => {
    const verge = (road: string, s: number, side: 'left' | 'right') =>
      net.vergeAt(net.edgeIndex(road), s, side);
    const open = verge('sf-wf-clocktower-reach', 170, 'right');
    expect([open.surface, open.edge, open.widthM]).toEqual(['kerb', 'water', 12]);
    const shed = verge('sf-wf-clocktower-reach', 250, 'right');
    expect([shed.surface, shed.edge, shed.widthM]).toEqual(['kerb', 'hard', 12]);
    const hall = verge('sf-wf-ferry-plaza', 200, 'right');
    expect([hall.edge, hall.widthM]).toEqual(['hard', 12]);
    const front = verge('sf-wf-clocktower-reach', 300, 'left');
    expect([front.surface, front.edge, front.widthM]).toEqual(['kerb', 'hard', 4]);
    const mouth = verge('sf-wf-clocktower-reach', 120, 'left');
    expect([mouth.surface, mouth.edge]).toEqual(['shoulder', 'soft']);
    const plaza = verge('sf-wf-ferry-plaza', 200, 'left');
    expect([plaza.surface, plaza.edge, plaza.widthM]).toEqual(['kerb', 'soft', 18]);
  });

  it('places its own signs and billboards on its own land, and has boost pads, a ramp truck and a cop lot', () => {
    const slots = roads.flatMap((r) => (r.features ?? []).filter((f) => f.kind === 'billboard'));
    const ids = new Set([...region.signs, ...region.billboards].map((x) => x.id));
    for (const f of slots) {
      expect(ids.has((f as { item?: string }).item ?? ''), f.id).toBe(true);
      expect(Math.min(Math.abs(f.d0), Math.abs(f.d1)), f.id).toBeGreaterThanOrEqual(10.1);
    }
    // Every `wf-` sign and billboard is placed here, once.
    const wf = [...ids].filter((x) => x.startsWith('wf-'));
    expect(wf.length).toBe(12);
    for (const id of wf) expect(slots.filter((f) => (f as { item?: string }).item === id).length, id).toBe(1);
    const all = roads.flatMap((r) => r.features ?? []);
    expect(all.filter((f) => f.kind === 'boostPad').length).toBe(4);
    expect(all.filter((f) => f.kind === 'rampTruck').length).toBe(2);
    expect(all.filter((f) => f.kind === 'copSpawn').length).toBe(1);
  });

  it('smashes only startup pop-ups and cafe tables along it', () => {
    const tags = new Set(roads.flatMap((r) => (r.tags ?? []).map((t) => t.tag)));
    const here = region.smashables.filter((d) => (d.tags ?? []).some((t) => tags.has(t)) || !d.tags?.length);
    expect(new Set(here.map((d) => d.kind))).toEqual(new Set(['pop-up-desk', 'cafe-table']));
    expect(here.map((d) => d.id).every((id) => id.startsWith('wf-'))).toBe(true);
  });
});
