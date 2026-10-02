import { describe, expect, it } from 'vitest';
import { ROUTE_BRANCH_ALTERNATE_M } from '../core';
import { fixtureBranchNetwork } from './fixture';
import { createRoadNetwork } from './network';
import { createRouteProgress } from './route';
import type { BakedRoute } from './types';
import { lintRoadNetwork } from './validate';

// W-Q contracts (interview, 2026-10-02: "junction choices in races", "U-turns", and marked dirt
// shortcuts as extra routes): a route's branches off its main path, each picked by position at its
// split zone, named by the route file or derived; and the route's orientation of each edge, the
// heading sign a U-turn flips. The fixture's split is the last 40 m of road `a` (d 2.4 to 4.9),
// into `c-in`, the straight `cut`, and `c-out`, rejoining at `d`.

function track(branches?: BakedRoute['branches'], surface?: 'dirt') {
  const f = fixtureBranchNetwork();
  const roads = f.roads.map((r) => (r.id === 'cut' && surface ? { ...r, surface } : r));
  const net = createRoadNetwork({ network: f.network, roads });
  const route = createRouteProgress(net, { ...f.route, ...(branches ? { branches } : {}) });
  return { f, net, route };
}

describe('route branches', () => {
  it('derives one branch per split zone when the route file names none', () => {
    const { net, route } = track();
    expect(route.shortcuts).toHaveLength(1);
    const zone = route.shortcuts[0];
    expect(route.branches).toHaveLength(1);
    const b = route.branches[0];
    const ids = b?.edges.map((e) => net.edges[e]?.id);
    expect(ids).toEqual(['c-in', 'cut', 'c-out']);
    const gain = zone?.gainM ?? NaN;
    expect(b).toMatchObject({
      id: 'cut',
      kind:
        gain > ROUTE_BRANCH_ALTERNATE_M
          ? 'shortcut'
          : gain < -ROUTE_BRANCH_ALTERNATE_M
            ? 'detour'
            : 'alternate',
      marked: true,
      sign: null,
      surface: 'asphalt',
      choice: zone,
      gainM: gain,
      declared: false,
    });
    console.log(`[examined] fixture split: gain ${gain.toFixed(1)} m, branch ${b?.id} (${b?.kind})`);
  });

  it("takes a named branch's id, kind, mark and sign, and a dirt road makes it a dirt shortcut", () => {
    const { net, route } = track(
      [{ id: 'sandbar', roads: ['cut'], kind: 'shortcut', marked: false, sign: 'SANDBAR: NOT ADVISED.' }],
      'dirt',
    );
    expect(route.branches).toHaveLength(1);
    const b = route.branches[0];
    expect(b).toMatchObject({
      id: 'sandbar',
      kind: 'shortcut',
      marked: false,
      sign: 'SANDBAR: NOT ADVISED.',
      surface: 'dirt',
      declared: true,
    });
    // The connectors belong to it too, so a rider on any of them is on the branch.
    for (const id of ['c-in', 'cut', 'c-out']) expect(route.branchAt(net.edgeIndex(id))?.id).toBe('sandbar');
    for (const id of ['a', 'c-split', 'b', 'c-merge', 'd'])
      expect(route.branchAt(net.edgeIndex(id))).toBeNull();
  });

  it('keeps a named branch no split zone reaches, with no choice and no gain', () => {
    const { route } = track([
      { id: 'ghost', roads: ['cut'] },
      { id: 'nowhere', roads: ['no-such-road'] },
    ]);
    expect(route.branches.map((b) => [b.id, b.choice === null, b.gainM, b.edges.length])).toEqual([
      ['ghost', false, route.shortcuts[0]?.gainM, 3],
      ['nowhere', true, 0, 0],
    ]);
  });

  it('gives each edge its orientation toward the finish: 1 along this route, 0 off it', () => {
    const { net, route } = track();
    for (const e of route.mainEdges) expect(route.orientation(e)).toBe(1);
    for (const id of ['c-in', 'cut', 'c-out']) expect(route.orientation(net.edgeIndex(id))).toBe(1);
    const narrow = createRouteProgress(net, {
      ...fixtureBranchNetwork().route,
      allowedRoads: ['a', 'c-split', 'b', 'c-merge', 'd'],
    });
    expect(narrow.orientation(net.edgeIndex('cut'))).toBe(0);
    expect(narrow.branches).toEqual([]);
  });

  it('the road lint names a bad branch: off allowedRoads, on the main path, twice, or unknown', () => {
    const f = fixtureBranchNetwork();
    const route: BakedRoute = {
      ...f.route,
      allowedRoads: f.route.allowedRoads.filter((r) => r !== 'c-out'),
      branches: [
        { id: 'one', roads: ['cut', 'c-out', 'b', 'nope'] },
        { id: 'one', roads: ['cut'] },
      ],
    };
    const issues = lintRoadNetwork({ network: f.network, roads: f.roads, routes: [route] })
      .filter((i) => i.pointer.startsWith('/branches'))
      .map((i) => `${i.pointer} ${i.message}`);
    expect(issues).toEqual([
      '/branches/0/roads/1 branch road c-out is not in allowedRoads',
      '/branches/0/roads/2 branch road b is on the main path',
      '/branches/0/roads/3 unknown road nope',
      '/branches/1/id branch one is named twice',
    ]);
    const clean = lintRoadNetwork({
      network: f.network,
      roads: f.roads,
      routes: [{ ...f.route, branches: [{ id: 'sandbar', roads: ['c-in', 'cut', 'c-out'] }] }],
    });
    expect(clean.filter((i) => i.pointer.startsWith('/branches'))).toEqual([]);
  });
});
