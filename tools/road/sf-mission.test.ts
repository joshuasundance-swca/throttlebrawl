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
import { EDGE_M, MASCOT_REACH_M, PACK, SF_MISSION } from './tracks/sf-mission';

// San Francisco's mural alleys as baked into the region-sf pack (run W-U; the pitch deck after
// playtest 2, #8: "the Mission's mural alleys, where a mural of the streaming outfit's mascot is being
// painted over mid-race"). The files are fresh, pass the schemas and the road lint, and the route is
// the district: one lane each way through a grid of shopfront streets and painted alleys, tight
// corners, and the mascot's wall on the outside of two of them.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const regionDir = path.join(root, 'packs', PACK, 'regions/san-francisco');
const read = (dir: string, id: string): unknown =>
  JSON.parse(readFileSync(path.join(regionDir, dir, `${id}.json`), 'utf8')) as unknown;

const compiled = compileTrack(SF_MISSION);
const network = read('networks', 'sf-mission') as BakedNetwork;
const roads = network.roads.map((id) => read('roads', id) as BakedRoad);
const route = read('routes', 'sf-mission-run') as BakedRoute & { name?: string };
const net = createRoadNetwork({ network, roads });
const progress = createRouteProgress(net, route);
const region = read('', 'region') as {
  networks: string[];
  signs: { id: string; text: string }[];
  billboards: { id: string }[];
  smashables: { id: string; tags: string[] }[];
};
const road = (id: string): BakedRoad => {
  const r = roads.find((x) => x.id === id);
  if (!r) throw new Error(`no ${id}`);
  return r;
};

describe('tools/road: the baked San Francisco mural alleys', () => {
  it('bakes into the region-sf pack and is fresh: the files equal a new compile of tracks/sf-mission.ts', () => {
    expect(PACK).toBe('region-sf');
    // As the bake writes them: through JSON, where a compiled -0 is written 0.
    const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    expect(network).toEqual(json(compiled.network));
    expect(roads).toEqual(json(compiled.roads));
    expect([route]).toEqual(json(compiled.routes));
    expect(region.networks).toContain('sf-mission');
  });

  it('passes the content schemas and the road lint with no issues', () => {
    expect(roadNetworkSchema.safeParse(network).success).toBe(true);
    for (const r of roads) expect(roadSchema.safeParse(r).success, r.id).toBe(true);
    expect(routeSchema.safeParse(route).success).toBe(true);
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
  });

  it('is a named route of about 3 km, one drive lane each way, with five tight corners', () => {
    console.log(
      `[examined] SF mural alleys: ${roads.map((r) => `${r.id} ${r.lengthM.toFixed(1)} m`).join(', ')}; route ${progress.length.toFixed(1)} m`,
    );
    expect(route.name).toBe('Mural Alleys');
    expect(progress.length).toBeGreaterThan(2700);
    expect(progress.length).toBeLessThan(3400);
    for (const r of roads)
      for (const sec of r.laneSections)
        expect(lanesPerDirection(sec.lanes), r.id).toEqual({ forward: 1, oncoming: 1 });
    // Each road ends on its corner's apex: the sharpest bend of its last 50 m sits within 4 m of its end.
    const radii: number[] = [];
    roads.forEach((r, i) => {
      if (i === roads.length - 1) return;
      const k = r.samples.data['kappa'] ?? [];
      const step = r.lengthM / (k.length - 1);
      let at = 0;
      let best = 0;
      k.forEach((v, j) => {
        if (j * step > r.lengthM - 50 && Math.abs(v) > best) {
          best = Math.abs(v);
          at = j * step;
        }
      });
      radii.push(1 / best);
      expect(r.lengthM - at, r.id).toBeLessThan(4);
    });
    console.log(`[examined] corner radii ${radii.map((x) => x.toFixed(1)).join(', ')} m`);
    expect(radii.length).toBe(5);
    // Tight city corners, tighter than any of downtown's sweeps; no tighter than Russian Hill's.
    for (const r of radii) expect(r).toBeGreaterThan(16);
    for (const r of radii) expect(r).toBeLessThan(40);
  });

  it('every station is the mural district or a row of painted houses; the alleys are painted on both sides', () => {
    let mission = 0;
    let checked = 0;
    for (const r of roads) {
      for (let s = 0; s <= r.lengthM; s += 20) {
        for (const side of ['left', 'right'] as const) {
          const theme = themeAt(r.tags, side, s);
          checked++;
          if (theme === 'mission') mission++;
          expect(['mission', 'urban'], `${r.id} s ${s} ${side}`).toContain(theme);
        }
      }
    }
    console.log(`[examined] ${checked} road stations: ${mission} in the mural district`);
    expect(mission / checked).toBeGreaterThan(0.75);
    for (const id of ['sf-mi-primer-alley', 'sf-mi-drop-cloth-alley', 'sf-mi-last-coat-alley']) {
      const r = road(id);
      for (let s = 0; s <= r.lengthM; s += 10)
        for (const side of ['left', 'right'] as const)
          expect(
            (r.tags ?? []).some(
              (t) =>
                (t.tag === 'murals' || t.tag === 'mascot-mural') &&
                s >= t.s0 &&
                s <= t.s1 &&
                (t.side === side || t.side === 'both'),
            ),
            `${id} s ${s} ${side}`,
          ).toBe(true);
    }
  });

  it("the mascot's wall wraps the outside of two corners, one before halfway and one late", () => {
    const spans: { road: string; side: string; s0: number; s1: number }[] = [];
    for (const r of roads)
      for (const t of r.tags ?? [])
        if (t.tag === 'mascot-mural') spans.push({ road: r.id, side: t.side ?? 'both', s0: t.s0, s1: t.s1 });
    expect(spans).toEqual([
      {
        road: 'sf-mi-satin-st',
        side: 'left',
        s0: road('sf-mi-satin-st').lengthM - MASCOT_REACH_M.before,
        s1: road('sf-mi-satin-st').lengthM,
      },
      { road: 'sf-mi-drop-cloth-alley', side: 'left', s0: 0, s1: MASCOT_REACH_M.after },
      {
        road: 'sf-mi-semigloss-st',
        side: 'right',
        s0: road('sf-mi-semigloss-st').lengthM - MASCOT_REACH_M.before,
        s1: road('sf-mi-semigloss-st').lengthM,
      },
      { road: 'sf-mi-last-coat-alley', side: 'right', s0: 0, s1: MASCOT_REACH_M.after },
    ]);
    // The outside of each corner: Satin turns right (kappa > 0), so its outside is the left; Semigloss
    // turns left, so its outside is the right.
    const turn = (id: string) => {
      const k = road(id).samples.data['kappa'] ?? [];
      return Math.sign(k[k.length - 1] ?? 0);
    };
    expect(turn('sf-mi-satin-st')).toBe(1);
    expect(turn('sf-mi-semigloss-st')).toBe(-1);
    // Where the field meets each wall, as a share of the race.
    const start = road('sf-mi-eggshell-st');
    let at = -40;
    const shares: number[] = [];
    for (const r of roads) {
      at += r.lengthM;
      if (r.id === 'sf-mi-satin-st' || r.id === 'sf-mi-semigloss-st') shares.push(at / progress.length);
    }
    console.log(
      `[examined] mascot corners at ${shares.map((x) => (x * 100).toFixed(0)).join('% and ')}% of the race`,
    );
    expect(start.id).toBe('sf-mi-eggshell-st');
    expect(shares[0]).toBeGreaterThan(0.35);
    expect(shares[0]).toBeLessThan(0.5);
    expect(shares[1]).toBeGreaterThan(0.7);
    expect(shares[1]).toBeLessThan(0.9);
  });

  it('the ground beside the road: a 4 m sidewalk to the shopfronts, 1.5 m of kerb to an alley wall, both hard', () => {
    const shop = road('sf-mi-eggshell-st');
    const alley = road('sf-mi-primer-alley');
    const corner = road('sf-mi-drop-cloth-alley');
    const sec = (r: BakedRoad) => {
      const x = r.laneSections[0];
      if (!x) throw new Error('no lane section');
      return x;
    };
    const s1 = resolveVerge(shop, sec(shop), 'right', 300);
    expect([s1.surface, s1.edge, s1.widthM, s1.dInner]).toEqual(['kerb', 'hard', 4, EDGE_M]);
    const s2 = resolveVerge(alley, sec(alley), 'left', 200);
    expect([s2.surface, s2.edge, s2.widthM]).toEqual(['kerb', 'hard', 1.5]);
    const s3 = resolveVerge(corner, sec(corner), 'left', 10);
    expect([s3.surface, s3.edge, s3.widthM]).toEqual(['kerb', 'hard', 1.5]);
  });

  it('places its signs on the shopfront sidewalks, every mi- sign is placed, and its set pieces are there', () => {
    const slots = roads.flatMap((r) => (r.features ?? []).filter((f) => f.kind === 'billboard'));
    const ids = new Set([...region.signs, ...region.billboards].map((x) => x.id));
    for (const f of slots) {
      expect(ids.has((f as { item?: string }).item ?? ''), f.id).toBe(true);
      // On the sidewalk: past the road's 5.5 m edge, short of the shopfronts at 9.5 m.
      expect(Math.min(Math.abs(f.d0), Math.abs(f.d1)), f.id).toBeGreaterThan(EDGE_M + 0.5);
      expect(Math.max(Math.abs(f.d0), Math.abs(f.d1)), f.id).toBeLessThan(EDGE_M + 4);
    }
    const mine = region.signs.filter((x) => x.id.startsWith('mi-'));
    expect(mine.length).toBe(5);
    for (const sign of mine)
      expect(
        slots.some((f) => (f as { item?: string }).item === sign.id),
        sign.id,
      ).toBe(true);
    const all = roads.flatMap((r) => r.features ?? []);
    expect(all.filter((f) => f.kind === 'boostPad').length).toBe(4);
    expect(all.filter((f) => f.kind === 'rampTruck').length).toBe(2);
    expect(all.filter((f) => f.kind === 'copSpawn').length).toBe(1);
    // Smashables stand on the shopfront sidewalks, the ring-light pop-up only there.
    expect(region.smashables.find((x) => x.id === 'content-break')?.tags).toEqual(['shopfronts']);
    expect(region.smashables.find((x) => x.id === 'meter-expired')?.tags).toContain('shopfronts');
  });
});
