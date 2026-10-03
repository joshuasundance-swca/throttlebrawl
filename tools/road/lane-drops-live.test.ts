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
// Everywhere else riding is exactly as before.

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
  it('the funnel appears only where a live road narrows: the SF freeway riding back, and Key West', () => {
    const found = new Map<string, number>();
    let stations = 0;
    for (const n of networks()) {
      const road = createRoadNetwork({ network: n.network, roads: n.roads });
      const config = { road } as SimConfig;
      const limits = (edge: number, s: number) => barrierLimits(config, edge, s);
      for (const e of road.edges) {
        for (let s = 0; s <= e.length; s += 10) {
          for (const dir of [1, -1] as const) {
            stations++;
            const f = funnelLimits(road, 90, { edge: e.index, s, d: 0, dir }, limits);
            if (f) found.set(`${e.id} dir ${dir}`, (found.get(`${e.id} dir ${dir}`) ?? 0) + 1);
          }
        }
      }
    }
    console.log(`[examined] ${stations} stations; funnels: ${JSON.stringify([...found])}`);
    expect(stations).toBeGreaterThan(5000);
    // Riding back, the freeway narrows twice on its own first 160 m (three lanes to two, then two to
    // the on-ramp's one). Key West's drops are one each, the funnel's 90 m taper (9 stations).
    expect([...found.keys()].sort()).toEqual([
      'osm-kw-north-roosevelt dir -1',
      'osm-kw-north-roosevelt dir 1',
      'osm-kw-smathers-beach dir 1',
      'sf-bridge-approach dir -1',
    ]);
    expect(found.get('sf-bridge-approach dir -1')).toBeLessThanOrEqual(18);
    for (const k of [
      'osm-kw-north-roosevelt dir -1',
      'osm-kw-north-roosevelt dir 1',
      'osm-kw-smathers-beach dir 1',
    ])
      expect(found.get(k), k).toBeLessThanOrEqual(10);
  });
});
