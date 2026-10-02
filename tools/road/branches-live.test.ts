import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress } from '../../src/road';
import type { BakedNetwork, BakedRoad, BakedRoute } from '../../src/road/types';
import { rideLimits } from '../../src/sim/ground';
import { barrierLimits, BIKE_HALF_WIDTH_M } from '../../src/sim/riders';
import type { SimConfig } from '../../src/sim/types';

// The W-Q sim and route contracts over every live network (interview, 2026-10-02: "junction
// choices in races", "U-turns", "Anywhere with ground"). Every split zone is a branch: each
// hand-made network's shortcuts and spurs, named and signed in the route files (W-R: the Keys boat
// ramp, the PNW spur and the SF stair alley; a split no track names would be derived); the map-data roads (no
// splits) have none. Every main-path edge points toward the
// finish. And with the off-road switch at its default (off), a rider's limits are exactly the M1
// barrier limits on every road, so nothing about an existing race changes.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;

interface Live {
  network: BakedNetwork;
  roads: BakedRoad[];
  routes: BakedRoute[];
}

function live(): Live[] {
  const out: Live[] = [];
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
      const routes = list<BakedRoute>('routes');
      for (const network of list<BakedNetwork>('networks')) {
        const mine = new Set(network.roads);
        out.push({
          network,
          roads: roads.filter((r) => mine.has(r.id)),
          routes: routes.filter((r) => r.network === network.id),
        });
      }
    }
  }
  return out;
}

describe('route branches and ride limits on every live network', () => {
  const nets = live();

  it('derive a branch per split zone, orient the main path to the finish, and keep M1 limits', () => {
    let routes = 0;
    let branches = 0;
    let named = 0;
    let stations = 0;
    const handMade: string[] = [];
    const lines: string[] = [];
    for (const n of nets) {
      const road = createRoadNetwork({ network: n.network, roads: n.roads });
      for (const r of n.routes) {
        routes++;
        const route = createRouteProgress(road, r);
        branches += route.branches.length;
        expect(route.branches.length, r.id).toBe(new Set(route.shortcuts.map((z) => z.toEdge)).size);
        for (const b of route.branches) {
          // A named branch (W-R) is signed at its split and keeps the id it would derive.
          if (b.declared) {
            named++;
            expect(b.sign ?? '', b.id).not.toBe('');
            const first = b.edges.map((e) => road.edges[e]).find((e) => e && !e.isConnector);
            expect(b.id).toBe(first?.id);
          } else expect(b.sign).toBeNull();
          expect(b.marked).toBe(true);
          expect(b.edges.length).toBeGreaterThan(0);
          for (const e of b.edges) expect(route.branchAt(e)?.id).toBe(b.id);
        }
        for (const e of route.mainEdges) {
          expect(route.orientation(e), `${r.id} ${road.edges[e]?.id}`).toBe(1);
          expect(route.branchAt(e)).toBeNull();
        }
        if (!r.id.startsWith('osm-')) handMade.push(r.id);
        else expect(route.branches, r.id).toEqual([]);
        lines.push(
          `${r.id}: ${route.branches.map((b) => `${b.id} ${b.kind} ${b.gainM.toFixed(0)} m`).join(', ') || 'none'}`,
        );
      }
      const config = { road } as SimConfig;
      for (const e of road.edges) {
        for (let s = 0; s <= e.length; s += 25) {
          const off = rideLimits(road, {}, e.index, s, BIKE_HALF_WIDTH_M);
          expect({ lo: off.lo, hi: off.hi }).toEqual(barrierLimits(config, e.index, s));
          stations++;
        }
      }
    }
    console.log(
      `[examined] ${nets.length} networks, ${routes} routes, ${branches} branches (${named} named), ${stations} stations of ride limits\n  ${lines.join('\n  ')}`,
    );
    expect(routes).toBeGreaterThanOrEqual(12);
    expect(handMade.length).toBeGreaterThanOrEqual(7);
    expect(branches).toBeGreaterThanOrEqual(handMade.length);
    // Every hand-made route names its shortcut (W-R junction choices, signed): the Keys' three, the
    // PNW's three and SF's one.
    expect(named).toBeGreaterThanOrEqual(7);
    expect(named).toBe(handMade.length);
    expect(stations).toBeGreaterThan(1000);
  });
});
