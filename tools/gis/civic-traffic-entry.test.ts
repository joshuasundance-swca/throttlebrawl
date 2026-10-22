import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeContentHashes } from '../../src/content/hashes';
import { makeReplayKey } from '../../src/replay';
import {
  createRoadNetwork,
  createRouteProgress,
  readConnector,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { buildTrafficGraph } from '../../src/sim/traffic/network';
import source from './networks/osm-pnw-longview-civic.json';

const ROOT = 'packs/region-pnw/regions/pacific-northwest';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const network = read<BakedNetwork>(`${ROOT}/networks/${source.id}.json`);
const roads = network.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
const route = read<BakedRoute>(`${ROOT}/routes/${source.routes[0]!.id}.json`);
const road = createRoadNetwork({ network, roads });
const authored = source.branches.find((b) => b.traffic === 'road' && b.trafficIngress)!;
const branch = route.branches!.find((b) => b.id === authored.id)!;
const rows = network.junctions
  .flatMap((j) => j.connectors)
  .map(readConnector)
  .filter((r) => r !== null);
const rider = rows.find((r) => r.splitZone && r.road === `${source.id}-${authored.label}-in`)!;
const dedicated = rows.find((r) => r.trafficOnly && r.road === `${source.id}-${authored.label}-traffic-in`)!;

function withRiderMembership(include: boolean): BakedRoute {
  return {
    ...route,
    branches: route.branches!.map((b) =>
      b.id !== branch.id
        ? b
        : {
            ...b,
            roads: [...(include ? [rider.road] : []), ...b.roads.filter((id) => id !== rider.road)],
          },
    ),
  };
}

describe('Civic dedicated ambient entry preserves the independent rider choice', () => {
  it('ships the dedicated traffic membership and detects the escaped rider-member case', () => {
    expect(authored.trafficIngress).toBeDefined();
    expect(rider.splitZone).toBeDefined();
    expect(dedicated.trafficOnly).toBe(true);
    expect(route.allowedRoads).toEqual(expect.arrayContaining([rider.road, dedicated.road]));
    expect(branch.roads).toContain(dedicated.road);
    expect(branch.roads).not.toContain(rider.road);
    const riderEdge = road.edgeIndex(rider.road);
    const dedicatedEdge = road.edgeIndex(dedicated.road);
    const canonical = createRouteProgress(road, route);
    const stale = createRouteProgress(road, withRiderMembership(true));
    const currentGraph = buildTrafficGraph({ road, route: canonical });
    const staleGraph = buildTrafficGraph({ road, route: stale });
    expect(currentGraph.allowed).not.toContain(riderEdge);
    expect(currentGraph.viable[riderEdge]!.plus).toBe(false);
    expect(staleGraph.allowed, 'old membership is an actually eligible extra ambient entry').toContain(
      riderEdge,
    );
    expect(staleGraph.viable[riderEdge]!.plus).toBe(true);
    expect(currentGraph.allowed).toContain(dedicatedEdge);
    expect(currentGraph.viable[dedicatedEdge]!.plus).toBe(true);
    const approach = road.edgeIndex(rider.from.road);
    expect(road.splitZones().some((z) => z.toEdge === riderEdge)).toBe(true);
    expect(
      road.nextEdges(approach, rider.from.end).some((link) => link.edge === riderEdge && link.splitZone),
    ).toBe(true);
    expect(
      road
        .nextEdges(approach, rider.from.end)
        .some((link) => !link.splitZone && canonical.mainEdges.includes(link.edge)),
    ).toBe(true);
  });

  it('changes only ambient permission when both content views share the unchanged road network', () => {
    const oldRoute = withRiderMembership(true);
    const canonicalRoute = withRiderMembership(false);
    const old = createRouteProgress(road, oldRoute);
    const canonical = createRouteProgress(road, canonicalRoute);
    expect(oldRoute).toEqual({ ...canonicalRoute, branches: oldRoute.branches });
    expect(oldRoute.branches!.map(({ roads: _roads, ...b }) => b)).toEqual(
      canonicalRoute.branches!.map(({ roads: _roads, ...b }) => b),
    );
    expect(old.branches).toEqual(canonical.branches);
    expect(old.shortcuts).toEqual(canonical.shortcuts);
    expect(old.checkpoints).toEqual(canonical.checkpoints);
    expect(old.mainEdges).toEqual(canonical.mainEdges);
    expect(old.length).toBe(canonical.length);
    expect(old.start).toEqual(canonical.start);
    expect(old.finish).toEqual(canonical.finish);
    expect(old.startGrid).toEqual(canonical.startGrid);
    for (const edge of road.edges) {
      expect(old.allows(edge.index), edge.id).toBe(canonical.allows(edge.index));
      expect(old.orientation(edge.index), edge.id).toBe(canonical.orientation(edge.index));
      expect(old.branchAt(edge.index), edge.id).toEqual(canonical.branchAt(edge.index));
      for (const s of [0, edge.length / 2, edge.length]) {
        expect(old.progressAt(edge.index, s), edge.id).toBe(canonical.progressAt(edge.index, s));
        expect(old.distanceToFinish(edge.index, s), edge.id).toBe(canonical.distanceToFinish(edge.index, s));
      }
    }
    const riderEdge = road.edgeIndex(rider.road);
    expect(canonical.allows(riderEdge)).toBe(true);
    const riderBranch = canonical.branchAt(riderEdge)!;
    expect(riderBranch.id).toBe(authored.id);
    expect(riderBranch.choice?.toEdge).toBe(riderEdge);
    expect(riderBranch.aiTake).toBe(authored.aiTake);
    expect(old.trafficRoads.filter((edge) => edge !== riderEdge)).toEqual(canonical.trafficRoads);
    expect(old.trafficExcludedRoads).toEqual(canonical.trafficExcludedRoads);
    process.stdout.write(
      `[examined] same-network stale/canonical rider permissions, orientation and branches on ${road.edges.length} edges; progress and distance at each start/middle/end\n`,
    );
  });

  it('renews the replay key for the changed ambient membership', () => {
    const hash = (value: BakedRoute) =>
      computeContentHashes({
        manifests: [],
        tables: new Map([['route', { [value.id]: value }]]),
      }).sim;
    const old = hash(withRiderMembership(true));
    const canonical = hash(withRiderMembership(false));
    expect(canonical).not.toBe(old);
    expect(makeReplayKey('same-code', canonical)).not.toBe(makeReplayKey('same-code', old));
  });
});
