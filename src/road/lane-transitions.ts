import type { LaneInfo } from '../core';
import type { Edge, EdgeLink } from './network';
import { readConnector, type BakedNetworkBundle } from './types';

/** One legal directed lane movement. Unlike rider links, connector rows are never collapsed. */
export interface LaneTransition extends EdgeLink {
  fromLane: string;
  toLane: string;
}

export function buildLaneTransitions(bundle: BakedNetworkBundle, edges: readonly Edge[]) {
  const table: { from: LaneTransition[]; to: LaneTransition[] }[] = edges.map(() => ({ from: [], to: [] }));
  const index = new Map(edges.map((e) => [e.id, e.index]));
  const endLanes = (e: Edge, end: 'from' | 'to'): readonly LaneInfo[] =>
    (end === 'from' ? e.sections[0] : e.sections[e.sections.length - 1])?.lanes ?? [];
  const add = (
    a: Edge,
    end: 'from' | 'to',
    fromLane: LaneInfo,
    b: Edge,
    target: 'from' | 'to',
    toLane: LaneInfo,
    connector?: string,
    trafficOnly = false,
  ) => {
    if (fromLane.direction !== (end === 'to' ? 1 : -1) || toLane.direction !== (target === 'from' ? 1 : -1))
      return;
    const link = (end === 'to' ? a.nextLinks : a.prevLinks).find(
      (l) => l.edge === b.index && l.entersAt === target,
    );
    if (!link && !trafficOnly) return;
    const ai = end === 'from' ? 0 : a.count - 1;
    const bi = target === 'from' ? 0 : b.count - 1;
    const sigma = end === target ? -1 : 1;
    const dx = (b.x[bi] ?? 0) - (a.x[ai] ?? 0);
    const dz = (b.z[bi] ?? 0) - (a.z[ai] ?? 0);
    const dShift = link?.dShift ?? -sigma * (-dx * (a.tz[ai] ?? 0) + dz * (a.tx[ai] ?? 1));
    table[a.index]?.[end].push({
      edge: b.index,
      entersAt: target,
      fromLane: fromLane.id,
      toLane: toLane.id,
      dShift,
      ...(connector ? { connector } : {}),
    });
  };
  for (const junction of bundle.network.junctions) {
    if (junction.ends.length === 2 && junction.connectors.length === 0) {
      const [aa, bb] = junction.ends;
      if (!aa || !bb) continue;
      for (const [aEnd, bEnd] of [
        [aa, bb],
        [bb, aa],
      ] as const) {
        const a = edges[index.get(aEnd.road) ?? -1];
        const b = edges[index.get(bEnd.road) ?? -1];
        if (!a || !b) continue;
        const sigma = aEnd.end === bEnd.end ? -1 : 1;
        const targets = endLanes(b, bEnd.end).filter((l) => l.direction === (bEnd.end === 'from' ? 1 : -1));
        for (const lane of endLanes(a, aEnd.end)) {
          const target =
            targets.find((l) => l.id === lane.id) ??
            [...targets].sort(
              (p, q) =>
                Math.abs(p.dCenterM - sigma * lane.dCenterM) - Math.abs(q.dCenterM - sigma * lane.dCenterM) ||
                p.id.localeCompare(q.id),
            )[0];
          if (target) add(a, aEnd.end, lane, b, bEnd.end, target);
        }
      }
    }
    for (const raw of junction.connectors) {
      const row = readConnector(raw);
      if (!row) continue;
      const a = edges[index.get(row.from.road) ?? -1];
      const b = edges[index.get(row.to.road) ?? -1];
      const c = edges[index.get(row.road) ?? -1];
      if (!a || !b || !c) continue;
      const al = endLanes(a, row.from.end).find((l) => l.id === row.from.lane);
      const bl = endLanes(b, row.to.end).find((l) => l.id === row.to.lane);
      if (!al || !bl) continue;
      // Normal rows retain their lane id. A branch connector commonly has its own single S1
      // lane; only an unambiguous lane of the row's direction may stand in for that id.
      const forward = al.direction === (row.from.end === 'to' ? 1 : -1);
      const cDir = forward ? 1 : -1;
      const lanes = endLanes(c, 'from').filter((l) => l.direction === cDir);
      const cl =
        lanes.find((l) => l.id === al.id) ??
        lanes.find((l) => l.id === bl.id) ??
        (lanes.length === 1 ? lanes[0] : undefined);
      if (!cl) continue;
      const ct = endLanes(c, 'to').find((l) => l.id === cl.id && l.direction === cDir);
      if (!ct) continue;
      if (forward) {
        add(a, row.from.end, al, c, 'from', cl, row.id, row.trafficOnly);
        add(c, 'to', ct, b, row.to.end, bl, row.id, row.trafficOnly);
      } else {
        add(b, row.to.end, bl, c, 'to', ct, row.id, row.trafficOnly);
        add(c, 'from', cl, a, row.from.end, al, row.id, row.trafficOnly);
      }
    }
  }
  for (const row of table)
    for (const end of ['from', 'to'] as const)
      row[end].sort(
        (a, b) =>
          a.edge - b.edge ||
          a.fromLane.localeCompare(b.fromLane) ||
          a.toLane.localeCompare(b.toLane) ||
          (a.connector ?? '').localeCompare(b.connector ?? ''),
      );
  return (edge: number, end: 'from' | 'to'): readonly LaneTransition[] => table[edge]?.[end] ?? [];
}
