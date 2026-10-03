import { describe, expect, it } from 'vitest';
import { compileTrack, type RoadSource, type RouteSource } from './compile';
import { FIXTURE_LANES, fixtureBranchTrack, highwayLanes } from './fixture';
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

  it('bakes a road with its own lanes, or lanes that change along it (W-R highways)', () => {
    const src = track();
    const wide = highwayLanes(3, 3.4);
    const mid = highwayLanes(2, 3.4);
    src.roads = src.roads.map((r) =>
      r.id === 'd'
        ? {
            ...r,
            laneSections: [
              { s0: 0, lanes: FIXTURE_LANES },
              { s0: 60, lanes: mid },
              { s0: 120, lanes: wide },
            ],
          }
        : r.id === 'a'
          ? { ...r, lanes: mid }
          : r,
    );
    const baked = compileTrack(src);
    const d = (baked.roads as unknown as BakedRoad[]).find((x) => x.id === 'd');
    const a = (baked.roads as unknown as BakedRoad[]).find((x) => x.id === 'a');
    expect(d?.laneSections.map((s) => [s.s0, s.lanes.filter((l) => l.kind === 'drive').length])).toEqual([
      [0, 2],
      [60, 4],
      [120, 6],
    ]);
    expect(a?.laneSections).toEqual([{ s0: 0, lanes: mid }]);
    const lint = lintRoadNetwork({
      network: baked.network as unknown as BakedNetwork,
      roads: baked.roads as unknown as BakedRoad[],
      routes: baked.routes as unknown as BakedRoute[],
    });
    expect(lint).toEqual([]);
  });

  it('names a branch for every route that allows it, with its roads and its sign (W-R junction choices)', () => {
    const src = track();
    const branch = src.branches?.[0];
    if (!branch) throw new Error('the fixture has a branch');
    src.branches = [{ ...branch, named: { id: 'the-cut', kind: 'shortcut', sign: 'THE CUT. Shorter.' } }];
    const baked = compileTrack(src);
    const routes = baked.routes as unknown as BakedRoute[];
    const full = routes.find((r) => r.id === 'r');
    const short = routes.find((r) => r.id === 'short');
    expect(full?.branches).toEqual([
      { id: 'the-cut', kind: 'shortcut', sign: 'THE CUT. Shorter.', roads: ['c-in', 'cut', 'c-out'] },
    ]);
    // The short route ends before the branch rejoins, so it names none.
    expect(short?.branches).toBeUndefined();
    const network = baked.network as unknown as BakedNetwork;
    const roads = baked.roads as unknown as BakedRoad[];
    expect(lintRoadNetwork({ network, roads, routes })).toEqual([]);
    const p = createRouteProgress(createRoadNetwork({ network, roads }), full as BakedRoute);
    expect(p.branches.map((b) => [b.id, b.kind, b.sign, b.declared])).toEqual([
      ['the-cut', 'shortcut', 'THE CUT. Shorter.', true],
    ]);
  });

  it('bakes a branch off a branch, through a via point (run W-U: the Keys secret island)', () => {
    const src = track();
    const branch = src.branches?.[0];
    if (!branch) throw new Error('the fixture has a branch');
    const piece = (id: string, extra: Partial<RoadSource> = {}): RoadSource => ({
      id,
      name: id,
      speedLimitMps: 24.6,
      surface: 'sand',
      humps: [],
      tags: [],
      features: [],
      barriers: [],
      ...extra,
    });
    src.branches = [
      {
        ...branch,
        named: { id: 'cut1', kind: 'shortcut', sign: 'THE CUT.' },
        roads: [
          piece('c-in', { lengthM: 30, connector: true }),
          piece('cut1', { lengthM: 120 }),
          piece('c-fork', { lengthM: 30, connector: true }),
          piece('cut2'),
          piece('c-rejoin', { lengthM: 30, connector: true }),
          piece('cut3', { lengthM: 80 }),
          piece('c-out', { lengthM: 30, connector: true }),
        ],
      },
      {
        leave: { road: 'cut1', offsetM: 2, lane: 'S1', zone: { lengthM: 30, d0: 2, d1: 6 } },
        join: { road: 'cut3', offsetM: 2, lane: 'S1' },
        turnsM: [30, 30],
        via: [{ x: 60, z: -418, headingDeg: 0, turnM: 30 }],
        lanes: [{ id: 'S1', dCenterM: 0, widthM: 5, direction: 1, kind: 'shortcut' }],
        roads: [
          piece('c-isle-in', { lengthM: 30, connector: true }),
          piece('isle'),
          piece('c-isle-out', { lengthM: 30, connector: true }),
        ],
      },
    ];
    const baked = compileTrack(src);
    const network = baked.network as unknown as BakedNetwork;
    const roads = baked.roads as unknown as BakedRoad[];
    const routes = baked.routes as unknown as BakedRoute[];
    expect(lintRoadNetwork({ network, roads, routes })).toEqual([]);
    // The fork inside the cut: the cut runs on through it, and the island leaves it by position.
    const fork = network.junctions.find((j) => j.ends.some((e) => e.road === 'isle' && e.end === 'from'));
    expect(fork?.ends.map((e) => `${e.road}:${e.end}`).sort()).toEqual(['cut1:to', 'cut2:from', 'isle:from']);
    expect(fork?.connectors.map((c) => String((c as { id?: unknown }).id)).sort()).toEqual([
      'cx-c-fork-s1',
      'cx-c-isle-in',
    ]);
    // The island bows out through its via point, 55 m off the cut's chord, and lands exactly.
    const isle = roads.find((r) => r.id === 'isle');
    const xs = isle?.samples.data['x'] ?? [];
    const zs = isle?.samples.data['z'] ?? [];
    const nearVia = Math.min(...xs.map((x, i) => Math.hypot(x - 60, (zs[i] ?? 0) + 418)));
    expect(nearVia).toBeLessThan(1);
    // A route allows it with its parent, under the parent's name; it is no branch of its own.
    const full = routes.find((r) => r.id === 'r');
    expect(full?.allowedRoads).toEqual(expect.arrayContaining(['c-isle-in', 'isle', 'c-isle-out']));
    expect(full?.branches?.map((b) => b.id)).toEqual(['cut1']);
    expect(full?.branches?.[0]?.roads).toEqual(expect.arrayContaining(['isle']));
    const net = createRoadNetwork({ network, roads });
    const p = createRouteProgress(net, full as BakedRoute);
    expect(p.shortcuts).toHaveLength(1);
    // Progress falls steadily along the island and lands on the cut's own distance where it rejoins.
    const e = net.edgeIndex('isle');
    const L = net.edges[e]?.length ?? 0;
    let last = -Infinity;
    for (let s = 0; s <= L; s += 10) {
      const here = p.progressAt(e, s);
      expect(here).toBeGreaterThan(last);
      last = here;
    }
    expect(p.progressAt(e, L)).toBeCloseTo(p.progressAt(net.edgeIndex('c-isle-out'), 0), 6);
    // A rider at the left of the cut rides on; one at its right edge takes the island.
    const cut1 = net.edgeIndex('cut1');
    const L1 = net.edges[cut1]?.length ?? 0;
    const on = { edge: cut1, s: L1 + 1, d: 0, dir: 1 as const };
    net.advance(on);
    expect(net.edges[on.edge]?.id).toBe('c-fork');
    const off = { edge: cut1, s: L1 + 1, d: 2.2, dir: 1 as const };
    net.advance(off);
    expect(net.edges[off.edge]?.id).toBe('c-isle-in');
    // A branch off a branch is not named on its own.
    const named = src.branches.map((b, i) => (i === 1 ? { ...b, named: { id: 'isle' } } : b));
    expect(() => compileTrack({ ...src, branches: named })).toThrow(/branch off a branch/);
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
