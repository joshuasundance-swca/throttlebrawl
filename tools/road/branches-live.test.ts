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
// choices in races", "U-turns", "Anywhere with ground"). Every split zone on a route is a branch:
// each hand-made network's shortcuts and spurs, derived, or named in the route file (run W-R's marked
// dirt shortcuts: the sandbar, the park cut); the map-data roads (no splits) have none. Every main-path edge points toward the
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
          // Named in the route file (run W-R's dirt shortcuts) or derived from the split.
          expect(b.declared).toBe((r.branches ?? []).some((x) => x.id === b.id));
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
      `[examined] ${nets.length} networks, ${routes} routes, ${branches} derived branches, ${stations} stations of ride limits\n  ${lines.join('\n  ')}`,
    );
    expect(routes).toBeGreaterThanOrEqual(12);
    expect(handMade.length).toBeGreaterThanOrEqual(7);
    expect(branches).toBeGreaterThanOrEqual(handMade.length);
    expect(stations).toBeGreaterThan(1000);
  });

  // Run W-R: the sim's junctions pick a split by position, and a crashed rider's body lands on the
  // nearest road, whatever the route allows (a seeded batch race on a branch past the short route's
  // finish never finished). So a route that passes a split must take the branch too: every split
  // zone it rides through before its finish leads onto a road it allows.
  it('every split zone a route passes before its finish leads onto a road the route allows', () => {
    let examined = 0;
    for (const n of nets) {
      const road = createRoadNetwork({ network: n.network, roads: n.roads });
      for (const r of n.routes) {
        const route = createRouteProgress(road, r);
        const main = new Set(route.mainEdges);
        for (const z of road.splitZones()) {
          if (!main.has(z.edge)) continue;
          const at = route.progressAt(z.edge, (z.s0 + z.s1) / 2);
          if (!Number.isFinite(at) || at >= route.length) continue;
          examined++;
          expect(route.allows(z.toEdge), `${r.id}: the split onto ${road.edges[z.toEdge]?.id}`).toBe(true);
        }
      }
    }
    console.log(`[examined] ${examined} split zones on routes' main paths before their finishes`);
    expect(examined).toBeGreaterThanOrEqual(10);
  });
});
