import { createRoadNetwork } from './network';
import { readConnector, type BakedNetworkBundle, type BakedRoute } from './types';

/** Content validation uses the same public legal lane rows as runtime, without importing sim. */
export function trafficAccessIssues(
  bundle: BakedNetworkBundle,
  route: BakedRoute,
): { pointer: string; message: string }[] {
  const branches = route.branches ?? [];
  if (!branches.some((b) => b.traffic === 'road')) return [];
  const findings: { pointer: string; message: string }[] = [];
  try {
    const road = createRoadNetwork(bundle);
    const main = new Set(route.mainPath.map((id) => road.edgeIndex(id)));
    for (const j of bundle.network.junctions)
      for (const raw of j.connectors) {
        const row = readConnector(raw);
        if (row && route.mainPath.includes(row.from.road) && route.mainPath.includes(row.to.road))
          main.add(road.edgeIndex(row.road));
      }
    const allowed = new Set([
      ...main,
      ...branches.filter((b) => b.traffic === 'road').flatMap((b) => b.roads.map((id) => road.edgeIndex(id))),
    ]);
    const links = road.edges.flatMap((e) =>
      (['from', 'to'] as const).flatMap((end) =>
        road
          .laneTransitions(e.index, end)
          .filter((l) => allowed.has(e.index) && allowed.has(l.edge))
          .map((l) => ({
            source: `${e.index}:${end}`,
            target: `${l.edge}:${l.entersAt === 'from' ? 'to' : 'from'}`,
          })),
      ),
    );
    const reachable = new Set([...main].flatMap((e) => [`${e}:from`, `${e}:to`]));
    const exit = new Set(reachable);
    for (let pass = 0; pass < allowed.size * 2; pass++) {
      let changed = false;
      for (const link of links) {
        if (reachable.has(link.source) && !reachable.has(link.target)) {
          reachable.add(link.target);
          changed = true;
        }
        if (exit.has(link.target) && !exit.has(link.source)) {
          exit.add(link.source);
          changed = true;
        }
      }
      if (!changed) break;
    }
    branches.forEach((b, i) => {
      if (b.traffic !== 'road') return;
      const pointer = `/branches/${i}/traffic`;
      let legal = false;
      for (const id of b.roads) {
        const edge = road.edgeIndex(id);
        if (road.featuresOf(edge, 'gap').length)
          findings.push({ pointer, message: `traffic branch ${b.id} includes a gap on ${id}` });
        const carries = ['from', 'to'].some(
          (end) => reachable.has(`${edge}:${end}`) && exit.has(`${edge}:${end}`),
        );
        if (carries) legal = true;
        // A branch can retain a separate rider-only access connector. Its ordinary interior
        // roads must be reachable by traffic and must lead back out through valid lane rows.
        if (!carries && !road.edges[edge]?.isConnector)
          findings.push({ pointer, message: `branch road ${id} has no legal traffic entry and exit` });
      }
      if (!legal)
        findings.push({
          pointer,
          message: `branch ${b.id} has no legal traffic movement between the main roads`,
        });
    });
  } catch {
    findings.push({
      pointer: '/branches',
      message: 'legal traffic access could not be derived from this road network',
    });
  }
  return findings;
}
