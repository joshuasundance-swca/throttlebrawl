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
import { lanesPerDirection, resolveVerge } from '../../src/road/cross-section';
import { PACK, SF_CHINATOWN_NORTHBEACH, SIDE_HALF_M } from './tracks/sf-chinatown-northbeach';

// San Francisco's Chinatown and North Beach as baked into the region-sf pack (run W-U; the pitch
// deck's #8: "Chinatown and North Beach (lantern strings, awnings, cafe tables)"; interview,
// 2026-10-02: all four SF districts). The files are fresh, pass the schemas and the road lint, and
// the streets are what the deck pitched: narrow (one lane each way), steep blocks with a crest lip at
// each cross street, lanterns then cafes on both sides, a hard corner to brake for, and the taste
// rules the brief set: NOTHING smashes in Chinatown, and only North Beach's cafe tables smash.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const regionDir = path.join(root, 'packs', PACK, 'regions/san-francisco');
const read = (dir: string, id: string): unknown =>
  JSON.parse(readFileSync(path.join(regionDir, dir, `${id}.json`), 'utf8')) as unknown;

const compiled = compileTrack(SF_CHINATOWN_NORTHBEACH);
const network = read('networks', 'sf-chinatown-northbeach') as BakedNetwork;
const roads = network.roads.map((id) => read('roads', id) as BakedRoad);
const route = read('routes', 'sf-chinatown-northbeach-run') as BakedRoute & { name?: string };
const net = createRoadNetwork({ network, roads });
const progress = createRouteProgress(net, route);
const region = read('', 'region') as {
  networks: string[];
  signs: { id: string }[];
  billboards: { id: string }[];
  smashables: { id: string; kind: string; tags?: string[]; status?: string }[];
};
const road = (id: string): BakedRoad => {
  const r = roads.find((x) => x.id === id);
  if (!r) throw new Error(`no road ${id}`);
  return r;
};
/** Chinatown's roads, and the lantern stretch of the bend. */
const CHINATOWN = ['sf-cn-lantern-row', 'sf-cn-bell-grade'];
const NORTH_BEACH = ['sf-nb-espresso-row', 'sf-nb-the-elbow', 'sf-nb-overlook-climb'];

describe('tools/road: the baked Chinatown and North Beach', () => {
  it('bakes into the region-sf pack and is fresh: the files equal a new compile of its track', () => {
    expect(PACK).toBe('region-sf');
    expect(network).toEqual(compiled.network);
    expect(roads).toEqual(compiled.roads);
    expect([route]).toEqual(compiled.routes);
    expect(region.networks).toContain('sf-chinatown-northbeach');
  });

  it('passes the content schemas and the road lint with no issues', () => {
    expect(roadNetworkSchema.safeParse(network).success).toBe(true);
    for (const r of roads) expect(roadSchema.safeParse(r).success, r.id).toBe(true);
    expect(routeSchema.safeParse(route).success).toBe(true);
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
  });

  it('is a named route of about 2.7 km on narrow streets: one drive lane each way the whole way', () => {
    console.log(
      `[examined] ${roads.map((r) => `${r.id} ${r.lengthM.toFixed(1)} m`).join(', ')}; route ${progress.length.toFixed(1)} m`,
    );
    expect(route.name).toBe('Chinatown & North Beach');
    expect(progress.length).toBeGreaterThan(2400);
    expect(progress.length).toBeLessThan(3200);
    for (const r of roads) {
      for (const sec of r.laneSections)
        expect(lanesPerDirection(sec.lanes), r.id).toEqual({ forward: 1, oncoming: 1 });
    }
  });

  it('Chinatown is steep blocks with a crest lip at each cross street; the elbow is a corner to brake for', () => {
    let steepest = 0;
    for (const id of CHINATOWN) {
      const g = road(id).samples.data['grade'] ?? [];
      for (const x of g) steepest = Math.max(steepest, Math.abs(x));
    }
    const lips = roads.flatMap((r) =>
      (r.features ?? []).filter((f) => f.kind === 'ramp').map((f) => ({ road: r.id, s: (f.s0 + f.s1) / 2 })),
    );
    // Every lip sits in a side street's span: "the crest of each one where the cross street flattens out".
    for (const l of lips) {
      const tags = road(l.road).tags ?? [];
      expect(
        tags.some((t) => t.tag === 'side-street' && l.s >= t.s0 - 4 && l.s <= t.s1 + 4),
        `${l.road} lip at ${l.s}`,
      ).toBe(true);
    }
    const elbow = road('sf-nb-the-elbow').samples.data['kappa'] ?? [];
    const sharpest = Math.max(...elbow.map((k) => Math.abs(k)));
    console.log(
      `[examined] steepest Chinatown grade ${(steepest * 100).toFixed(1)}%, ${lips.length} crest lips, the elbow's tightest radius ${(1 / sharpest).toFixed(0)} m`,
    );
    expect(steepest).toBeGreaterThan(0.15);
    expect(lips.length).toBeGreaterThanOrEqual(4);
    // Tight enough to brake for at speed (a racer at 40 m/s would pull over 2 g), wide enough to ride.
    expect(1 / sharpest).toBeLessThan(70);
    expect(1 / sharpest).toBeGreaterThan(20);
  });

  it('lanterns line Chinatown, cafes line North Beach, and a side street comes every block', () => {
    const counts: Record<string, number> = {};
    for (const r of roads) {
      for (let s = 0; s <= r.lengthM; s += 20) {
        for (const side of ['left', 'right'] as const) {
          const theme = themeAt(r.tags, side, s);
          counts[theme] = (counts[theme] ?? 0) + 1;
          expect(['lanterns', 'cafes', 'crossing', 'park'], `${r.id} s ${s} ${side}`).toContain(theme);
          if (CHINATOWN.includes(r.id)) expect(['lanterns', 'crossing'], `${r.id} s ${s}`).toContain(theme);
          if (NORTH_BEACH.includes(r.id)) expect(theme, `${r.id} s ${s}`).not.toBe('lanterns');
        }
      }
    }
    const sides = roads.flatMap((r) => (r.tags ?? []).filter((t) => t.tag === 'side-street'));
    console.log(`[examined] stations by theme ${JSON.stringify(counts)}; ${sides.length} side streets`);
    expect(sides.length).toBeGreaterThanOrEqual(9);
    for (const t of sides) expect(t.s1 - t.s0).toBeCloseTo(2 * SIDE_HALF_M, 5);
    expect(counts['lanterns'] ?? 0).toBeGreaterThan(80);
    expect(counts['cafes'] ?? 0).toBeGreaterThan(80);
  });

  it('the ground beside the road: a pavement to the shopfronts, a pavement to the patio rail, open mouths, grass', () => {
    const at = (id: string, side: 'left' | 'right', s: number) => {
      const r = road(id);
      const sec = r.laneSections[0];
      if (!sec) throw new Error('no lane section');
      const v = resolveVerge(r, sec, side, s);
      return [v.surface, v.edge, v.widthM];
    };
    expect(at('sf-cn-lantern-row', 'left', 60)).toEqual(['kerb', 'hard', 4]);
    expect(at('sf-nb-espresso-row', 'right', 60)).toEqual(['kerb', 'hard', 3.2]);
    expect(at('sf-cn-bell-grade', 'left', 150)).toEqual(['shoulder', 'soft', 14]);
    expect(at('sf-nb-the-elbow', 'left', 140)).toEqual(['grass', 'soft', 9]);
  });

  it('nothing smashes in Chinatown, and only the cafe tables smash in North Beach (the brief; pitch deck cuts)', () => {
    const live = region.smashables.filter((x) => x.status !== 'vetoed');
    const tagsOf = (ids: string[]) =>
      new Set(roads.filter((r) => ids.includes(r.id)).flatMap((r) => (r.tags ?? []).map((t) => t.tag)));
    // Chinatown's tags, plus the bend's lantern stretch and its side street.
    const chinatown = tagsOf(CHINATOWN);
    const bend = road('sf-cn-crossover').tags ?? [];
    for (const t of bend) if (t.s0 < 195) chinatown.add(t.tag);
    for (const x of live) {
      // A smashable with no tags stands on any open road: none may exist in the region.
      expect(x.tags?.length ?? 0, `${x.id} has no tags`).toBeGreaterThan(0);
      for (const t of x.tags ?? []) expect(chinatown.has(t), `${x.id} on Chinatown's ${t}`).toBe(false);
    }
    const all = tagsOf(roads.map((r) => r.id));
    const here = live.filter((x) => (x.tags ?? []).some((t) => all.has(t)));
    console.log(
      `[examined] ${live.length} SF smashables against ${chinatown.size} Chinatown tags (${[...chinatown].join(', ')}); on this network: ${here.map((x) => `${x.id} (${x.kind})`).join(', ')}`,
    );
    expect(here.length).toBeGreaterThan(0);
    for (const x of here) {
      expect(x.kind, x.id).toBe('cafe-table');
      expect(
        (x.tags ?? []).filter((t) => all.has(t)),
        x.id,
      ).toEqual(['cafes']);
    }
  });

  it('places its signs and billboards off the road, and has its pads, its cop lot and its walkers', () => {
    const slots = roads.flatMap((r) => (r.features ?? []).filter((f) => f.kind === 'billboard'));
    const ids = new Set([...region.signs, ...region.billboards].map((x) => x.id));
    for (const f of slots) {
      expect(ids.has((f as { item?: string }).item ?? ''), f.id).toBe(true);
      // Past the 5.5 m edge and its verge: on the pavement or in the park.
      expect(Math.min(Math.abs(f.d0), Math.abs(f.d1)), f.id).toBeGreaterThanOrEqual(6.1);
    }
    // The district's own signs and billboards (`cn-`, `nb-`) are all placed here.
    for (const id of [...ids].filter((x) => x.startsWith('cn-') || x.startsWith('nb-')))
      expect(
        slots.some((f) => (f as { item?: string }).item === id),
        id,
      ).toBe(true);
    const all = roads.flatMap((r) => r.features ?? []);
    console.log(`[examined] ${slots.length} board slots, ${all.length} features`);
    expect(all.filter((f) => f.kind === 'boostPad').length).toBe(4);
    expect(all.filter((f) => f.kind === 'copSpawn').length).toBe(1);
    expect(all.filter((f) => f.kind === 'roadsideZone').length).toBeGreaterThanOrEqual(8);
  });
});
