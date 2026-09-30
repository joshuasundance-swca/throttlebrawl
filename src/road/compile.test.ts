import { describe, expect, it } from 'vitest';
import { compileTrack, type RouteSource } from './compile';
import { fixtureBranchTrack } from './fixture';
import { createRoadNetwork, createRouteProgress, lintRoadNetwork } from './index';
import type { BakedNetwork, BakedRoad, BakedRoute } from './types';

// road-3: one network, several routes (race lengths). Each route's main path runs from its start
// road to its finish road; its allowed set is those roads, the connectors between them, and every
// branch that both leaves and rejoins inside that stretch.

const track = () => {
  const base = fixtureBranchTrack();
  return {
    ...base,
    routes: [
      ...base.routes,
      {
        id: 'short',
        start: { road: 'a', s: 20, dir: 1 as const },
        finish: { road: 'b', s: -10 },
        checkpoints: [],
        startGrid: { rows: 1, perRow: 2, rowGapM: 8 },
      },
    ],
  };
};

describe('road/compile: several routes on one track (road-3)', () => {
  const out = compileTrack(track());
  const network = out.network as unknown as BakedNetwork;
  const roads = out.roads as unknown as BakedRoad[];
  const routes = out.routes as unknown as BakedRoute[];
  const byId = (id: string) => routes.find((r) => r.id === id);

  it('emits every route, in source order, all passing the road lint', () => {
    expect(routes.map((r) => r.id)).toEqual(['r', 'short']);
    expect(lintRoadNetwork({ network, roads, routes })).toEqual([]);
  });

  it('keeps the full route as before: every main road, every allowed road', () => {
    const r = byId('r');
    expect(r?.mainPath).toEqual(['a', 'b', 'd']);
    expect(r?.allowedRoads).toEqual(roads.map((x) => x.id));
  });

  it('cuts a shorter route at its finish road, and leaves out a branch that rejoins past it', () => {
    const r = byId('short');
    expect(r?.mainPath).toEqual(['a', 'b']);
    expect(r?.allowedRoads).toEqual(['a', 'c-split', 'b']);
    // The finish counts back from the finish road's end.
    const b = roads.find((x) => x.id === 'b');
    expect(r?.finish).toEqual({ road: 'b', s: Math.round(((b?.lengthM ?? 0) - 10) * 1e4) / 1e4 });
    const net = createRoadNetwork({ network, roads });
    const p = createRouteProgress(net, r as BakedRoute);
    const full = createRouteProgress(net, byId('r') as BakedRoute);
    expect(p.length).toBeLessThan(full.length);
    expect(p.shortcuts).toEqual([]);
    expect(full.shortcuts).toHaveLength(1);
  });

  it('refuses a route whose finish road comes before its start road', () => {
    const bad = track();
    const r = bad.routes[0] as RouteSource;
    bad.routes = [
      { ...r, id: 'backwards', start: { road: 'd', s: 5, dir: 1 }, finish: { road: 'a', s: 50 } },
    ];
    expect(() => compileTrack(bad)).toThrow(/backwards/);
  });
});
