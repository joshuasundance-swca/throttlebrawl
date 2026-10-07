import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork } from '../../src/road';
import type { BakedNetwork, BakedRoad } from '../../src/road/types';
import { barrierLimits } from '../../src/sim/riders';
import { funnelLimits } from '../../src/sim/riders/funnel';
import type { SimConfig } from '../../src/sim/types';

// Lane drops on the live roads (W-R multi-lane highways): the riders' funnel (sim/riders/funnel.ts)
// exists only where the road's width changes. On every live network it is checked every 10 m, both
// ways along every road: it appears on San Francisco's freeway, riding back toward the city (the
// freeway widens the way the race goes), and since run W-S in Key West, where four-lane South
// Roosevelt Boulevard narrows into two-lane Bertha Street the way the race goes (the first drop a
// racer meets), and at both ends of North Roosevelt Boulevard, the four-lane junction choice, which
// narrows into 1st Street ahead and into its one-lane turn-off behind.
// The truck shortcuts also narrow from their 8 m yards into 3.5 m exits, and riding backward
// onto their streets brings the mapped right edge in. All four are checked against their data.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;

function networks(): { network: BakedNetwork; roads: BakedRoad[] }[] {
  const out: { network: BakedNetwork; roads: BakedRoad[] }[] = [];
  for (const pack of readdirSync(path.join(root, 'packs'))) {
    const regions = path.join(root, 'packs', pack, 'regions');
    if (!existsSync(regions)) continue;
    for (const region of readdirSync(regions)) {
      const dir = (sub: string) => path.join(regions, region, sub);
      const list = <T>(sub: string) =>
        existsSync(dir(sub))
          ? readdirSync(dir(sub))
              .filter((f) => f.endsWith('.json'))
              .map((f) => json<T>(path.join(dir(sub), f)))
          : [];
      const roads = list<BakedRoad>('roads');
      for (const network of list<BakedNetwork>('networks')) {
        const mine = new Set(network.roads);
        out.push({ network, roads: roads.filter((r) => mine.has(r.id)) });
      }
    }
  }
  return out;
}

describe('lane drops on the live roads (W-R)', () => {
  it('the funnel appears only where a live road narrows, including the truck shortcut interfaces', () => {
    const found = new Map<string, number>();
    const shortcutStations = new Map<string, number[]>();
    const cuts = new Set(['pnw-mill-yard-cut', 'sf-dt-plaza-cut']);
    let stations = 0;
    for (const n of networks()) {
      const road = createRoadNetwork({ network: n.network, roads: n.roads });
      const config = { road } as SimConfig;
      const limits = (edge: number, s: number) => barrierLimits(config, edge, s);
      for (const e of road.edges) {
        if (cuts.has(e.id)) {
          const extent = (edge: number, s: number) => {
            const lanes = road.lanesAt(edge, s);
            return [
              Math.min(...lanes.map((l) => l.dCenterM - l.widthM / 2)),
              Math.max(...lanes.map((l) => l.dCenterM + l.widthM / 2)),
            ];
          };
          expect(extent(e.index, 0), `${e.id}: the actual yard`).toEqual([1, 9]);
          expect(road.lanesAt(e.index, 0).map(({ widthM, direction }) => ({ widthM, direction }))).toEqual([
            { widthM: 8, direction: 1 },
          ]);
          expect(e.next).not.toBeNull();
          expect(extent(e.next!.edge, 0), `${e.id}: single-bike exit`).toEqual([1, 4.5]);
          expect(
            road.lanesAt(e.next!.edge, 0).map(({ widthM, direction }) => ({ widthM, direction })),
          ).toEqual([{ widthM: 3.5, direction: 1 }]);
          // Source-derived reverse narrowing: the street's right edge, mapped into this yard.
          const back = { edge: e.index, s: -90, d: 0, dir: -1 as const };
          expect(road.advance(back)).not.toBe('deadEnd');
          expect(back.dir).toBe(-1);
          expect(extent(back.edge, back.s)[1]! - back.d).toBeLessThan(9);
        }
        for (let s = 0; s <= e.length; s += 10) {
          for (const dir of [1, -1] as const) {
            stations++;
            const f = funnelLimits(road, 90, { edge: e.index, s, d: 0, dir }, limits);
            if (f) {
              const key = `${e.id} dir ${dir}`;
              found.set(key, (found.get(key) ?? 0) + 1);
              if (cuts.has(e.id)) {
                const stations = shortcutStations.get(key) ?? [];
                stations.push(s);
                shortcutStations.set(key, stations);
                // The real right lane edge must narrow within the 90 m lookahead, mapped
                // back through the actual default connector path (including d shifts).
                let narrowHi = Infinity;
                for (let x = 5; x <= 90; x += 5) {
                  const p = { edge: e.index, s: s + dir * x, d: 0, dir };
                  if (road.advance(p) === 'deadEnd') break;
                  const lanes = road.lanesAt(p.edge, p.s);
                  const lo = Math.min(...lanes.map((l) => l.dCenterM - l.widthM / 2));
                  const hi = Math.max(...lanes.map((l) => l.dCenterM + l.widthM / 2));
                  const mappedHi = p.dir === dir ? hi - p.d - 0.5 : -(lo - p.d) - 0.5;
                  narrowHi = Math.min(narrowHi, mappedHi);
                }
                expect(narrowHi, `${key} at ${s}: a real narrower edge ahead`).toBeLessThan(8.5);
                expect(f.hi).toBeLessThan(8.5);
                expect(f.hi).toBeGreaterThanOrEqual(narrowHi - 1e-9);
              }
            }
          }
        }
      }
    }
    console.log(`[examined] ${stations} stations; funnels: ${JSON.stringify([...found])}`);
    expect(stations).toBeGreaterThan(5000);
    // Riding back, the freeway narrows twice on its own first 160 m (three lanes to two, then two to
    // the on-ramp's one). Key West's drops are one each, the funnel's 90 m taper (9 stations).
    // Playtest 3's two SF bakes add three on purpose (T9.3): the Golden Gate's bridge narrows riding
    // back (its three oncoming lanes meet Vista Point's ramp, which has one), and Lombard's two-way
    // streets meet the one-lane, one-way crooked block (riding forward on the climb, and in the
    // oncoming lane on the flats). The Seven Mile's old road (playtest 3, T9.2) narrows from its two
    // lanes to the one-lane repair platforms (`osm-sm-old-road`, `osm-sm-old-road-back`) at both of
    // them.
    expect([...found.keys()].sort()).toEqual([
      'osm-kw-north-roosevelt dir -1',
      'osm-kw-north-roosevelt dir 1',
      'osm-kw-smathers-beach dir 1',
      'osm-sf-gg-bridge dir -1',
      'osm-sf-lombard-climb dir 1',
      'osm-sf-lombard-flats dir -1',
      'osm-sm-old-east dir -1',
      'osm-sm-old-road dir -1',
      'osm-sm-old-west dir 1',
      'pnw-mill-yard-cut dir -1',
      'pnw-mill-yard-cut dir 1',
      'sf-bridge-approach dir -1',
      'sf-dt-plaza-cut dir -1',
      'sf-dt-plaza-cut dir 1',
    ]);
    expect(shortcutStations.size).toBe(4);
    for (const [key, samples] of shortcutStations) {
      expect(samples.length, key).toBeLessThanOrEqual(10);
      expect(Math.max(...samples) - Math.min(...samples), `${key}: bounded taper`).toBeLessThanOrEqual(90);
    }
    expect(found.get('sf-bridge-approach dir -1')).toBeLessThanOrEqual(18);
    for (const k of [
      'osm-kw-north-roosevelt dir -1',
      'osm-kw-north-roosevelt dir 1',
      'osm-kw-smathers-beach dir 1',
      'osm-sm-old-east dir -1',
      'osm-sm-old-road dir -1',
      'osm-sm-old-west dir 1',
    ])
      expect(found.get(k), k).toBeLessThanOrEqual(10);
  });
});
