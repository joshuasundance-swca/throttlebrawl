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
import { CROSS_HALF_M, PACK, SF_DOWNTOWN } from './tracks/sf-downtown';

// San Francisco's downtown as baked into the region-sf pack (run W-R; interview, 2026-10-02: "SF
// first = downtown towers": a four-lane avenue between invented AI-startup towers, intersections with
// cross traffic, cable cars ONLY on the steep cable-line cross streets). The files are fresh, pass the
// schemas and the road lint, and the avenue is what the maintainer picked: two lanes each way the
// whole way, towers on both sides, a cross street every block, and exactly two cable-car streets.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const regionDir = path.join(root, 'packs', PACK, 'regions/san-francisco');
const read = (dir: string, id: string): unknown =>
  JSON.parse(readFileSync(path.join(regionDir, dir, `${id}.json`), 'utf8')) as unknown;

const compiled = compileTrack(SF_DOWNTOWN);
const network = read('networks', 'sf-downtown') as BakedNetwork;
const roads = network.roads.map((id) => read('roads', id) as BakedRoad);
const route = read('routes', 'sf-downtown-run') as BakedRoute & { name?: string };
const net = createRoadNetwork({ network, roads });
const progress = createRouteProgress(net, route);
const region = read('', 'region') as {
  networks: string[];
  signs: { id: string }[];
  billboards: { id: string }[];
  traffic: { mix: { kind: string }[] };
};

/** Every tag span of `tag` on the route, as global route s ranges in order. */
function spans(tag: string): { road: string; s0: number; s1: number; at: number }[] {
  const out: { road: string; s0: number; s1: number; at: number }[] = [];
  let offset = 0;
  for (const r of roads) {
    for (const t of r.tags ?? []) {
      if (t.tag === tag) out.push({ road: r.id, s0: t.s0, s1: t.s1, at: offset + (t.s0 + t.s1) / 2 });
    }
    offset += r.lengthM;
  }
  return out.sort((a, b) => a.at - b.at);
}

describe('tools/road: the baked San Francisco downtown', () => {
  it('bakes into the region-sf pack and is fresh: the files equal a new compile of tracks/sf-downtown.ts', () => {
    expect(PACK).toBe('region-sf');
    expect(network).toEqual(compiled.network);
    expect(roads).toEqual(compiled.roads);
    expect([route]).toEqual(compiled.routes);
    expect(region.networks).toContain('sf-downtown');
  });

  it('passes the content schemas and the road lint with no issues', () => {
    expect(roadNetworkSchema.safeParse(network).success).toBe(true);
    for (const r of roads) expect(roadSchema.safeParse(r).success, r.id).toBe(true);
    expect(routeSchema.safeParse(route).success).toBe(true);
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
  });

  it('is a named route of about 3.7 km, two drive lanes each way the whole way', () => {
    console.log(
      `SF downtown: ${roads.map((r) => `${r.id} ${r.lengthM.toFixed(1)} m`).join(', ')}; route ${progress.length.toFixed(1)} m`,
    );
    expect(route.name).toBe('Downtown');
    expect(progress.length).toBeGreaterThan(3300);
    expect(progress.length).toBeLessThan(4200);
    for (const r of roads) {
      for (const sec of r.laneSections)
        expect(lanesPerDirection(sec.lanes), r.id).toEqual({ forward: 2, oncoming: 2 });
    }
  });

  it('towers line both sides; a cross street comes every block; the plazas open at the start and the finish', () => {
    const crosses = [...spans('cross-street'), ...spans('cable-crossing')].sort((a, b) => a.at - b.at);
    const gaps = crosses.slice(1).map((c, i) => c.at - (crosses[i]?.at ?? 0));
    console.log(
      `[examined] ${crosses.length} cross streets, gaps ${gaps.map((g) => g.toFixed(0)).join(', ')} m`,
    );
    expect(crosses.length).toBeGreaterThanOrEqual(15);
    expect(Math.max(...gaps)).toBeLessThan(270);
    expect(Math.min(...gaps)).toBeGreaterThan(150);
    for (const c of crosses) expect(c.s1 - c.s0).toBeCloseTo(2 * CROSS_HALF_M, 5);
    // Every 20 m of the route, each side is towers, a cross street or a plaza: never row houses,
    // never the bare palm-land default.
    let towers = 0;
    let checked = 0;
    for (const r of roads) {
      for (let s = 0; s <= r.lengthM; s += 20) {
        for (const side of ['left', 'right'] as const) {
          const theme = themeAt(r.tags, side, s);
          checked++;
          if (theme === 'downtown') towers++;
          expect(['downtown', 'crossing', 'plaza'], `${r.id} s ${s} ${side}`).toContain(theme);
        }
      }
    }
    console.log(`[examined] ${checked} road stations: ${towers} beside towers`);
    expect(towers / checked).toBeGreaterThan(0.7);
    const first = roads[0];
    const last = roads[roads.length - 1];
    expect(themeAt(first?.tags, 'right', 100)).toBe('plaza');
    expect(themeAt(last?.tags, 'right', (last?.lengthM ?? 0) - 60)).toBe('plaza');
  });

  it('cable cars get exactly two steep cable-car streets, both on Cable Hill Crossing', () => {
    const cable = spans('cable-crossing');
    expect(cable.map((c) => c.road)).toEqual(['sf-dt-cable-crossing', 'sf-dt-cable-crossing']);
    // No road of the avenue is itself a cable line: no cable car runs along a race road.
    for (const r of roads)
      expect(
        (r.tags ?? []).some((t) => t.tag === 'cable-line'),
        r.id,
      ).toBe(false);
    // And the region's traffic carries no cable car at all (playtest 2: "including in forests").
    expect(region.traffic.mix.map((m) => m.kind)).not.toContain('cable-car');
  });

  it('the ground beside the avenue: a sidewalk then the towers, open asphalt at a cross street, a wide plaza', () => {
    const r = roads.find((x) => x.id === 'sf-dt-inference-ave');
    if (!r) throw new Error('no Inference Avenue');
    const sec = r.laneSections[0];
    if (!sec) throw new Error('no lane section');
    const kerb = resolveVerge(r, sec, 'left', 40);
    expect([kerb.surface, kerb.edge, kerb.widthM]).toEqual(['kerb', 'hard', 4]);
    const mouth = resolveVerge(r, sec, 'left', 150);
    expect([mouth.surface, mouth.edge]).toEqual(['shoulder', 'soft']);
    const plaza = resolveVerge(roads[0] as BakedRoad, roads[0]?.laneSections[0] as typeof sec, 'right', 100);
    expect([plaza.surface, plaza.edge]).toEqual(['kerb', 'soft']);
  });

  it('places its signs and billboards off the road on its own land, and has boost pads and a ramp truck', () => {
    const slots = roads.flatMap((r) => (r.features ?? []).filter((f) => f.kind === 'billboard'));
    const ids = new Set([...region.signs, ...region.billboards].map((x) => x.id));
    for (const f of slots) {
      expect(ids.has((f as { item?: string }).item ?? ''), f.id).toBe(true);
      // Past the 9.5 m edge and its verge: on the sidewalk or the plaza.
      expect(Math.min(Math.abs(f.d0), Math.abs(f.d1)), f.id).toBeGreaterThanOrEqual(10.1);
    }
    // The downtown's own signs and billboards are all placed here.
    for (const id of [...ids].filter((x) => x.startsWith('dt-')))
      expect(
        slots.some((f) => (f as { item?: string }).item === id),
        id,
      ).toBe(true);
    const all = roads.flatMap((r) => r.features ?? []);
    expect(all.filter((f) => f.kind === 'boostPad').length).toBeGreaterThanOrEqual(2);
    expect(all.filter((f) => f.kind === 'rampTruck').length).toBe(2);
    expect(all.filter((f) => f.kind === 'copSpawn').length).toBe(1);
  });
});
