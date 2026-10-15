import type { RoadNetwork, RoadPos } from './network';

/** A read view in the viewer's road frame; alignment scales the other's signed speed. */
export function projectRoadPosition(
  road: RoadNetwork,
  a: RoadPos,
  b: RoadPos,
  range: number,
): { pos: RoadPos; alignment: number } | null {
  if (a.edge === b.edge) return Math.abs(b.s - a.s) <= range ? { pos: { ...b }, alignment: 1 } : null;
  const fromEdge = road.edges[a.edge];
  const toEdge = road.edges[b.edge];
  const mePoint = road.toWorld(a.edge, a.s, a.d, 0);
  const otherPoint = road.toWorld(b.edge, b.s, b.d, 0);
  const padding =
    Math.abs(fromEdge?.dMin ?? 0) +
    Math.abs(fromEdge?.dMax ?? 0) +
    Math.abs(toEdge?.dMin ?? 0) +
    Math.abs(toEdge?.dMax ?? 0) +
    Math.abs(a.d) +
    Math.abs(b.d);
  const reach = range + padding;
  const dx = otherPoint.x - mePoint.x,
    dz = otherPoint.z - mePoint.z;
  if (dx * dx + dz * dz > reach * reach) return null;
  const physical = road.surfaceUnder(b, 0.2, (edge) => edge === a.edge);
  if (physical && Math.abs(physical.s - a.s) <= range) {
    const from = road.frameAt(b.edge, b.s);
    const to = road.frameAt(a.edge, physical.s);
    const aligned = from.tx * to.tx + from.tz * to.tz;
    return { pos: { ...physical, dir: b.dir * aligned >= 0 ? 1 : -1 }, alignment: aligned };
  }
  const frontier = [{ edge: a.edge, sOffset: 0, sSign: 1, dOffset: 0, walk: 0 }];
  const visited = new Set<number>();
  for (let head = 0; head < frontier.length && head < 64; head++) {
    const row = frontier[head];
    if (!row || visited.has(row.edge)) continue;
    visited.add(row.edge);
    const s = row.sOffset + row.sSign * b.s;
    if (row.edge === b.edge) {
      if (Math.abs(s - a.s) > range) continue;
      return {
        pos: { edge: a.edge, s, d: row.dOffset + row.sSign * b.d, dir: b.dir * row.sSign === 1 ? 1 : -1 },
        alignment: row.sSign,
      };
    }
    const edge = road.edges[row.edge];
    if (!edge) continue;
    const localS = (a.s - row.sOffset) * row.sSign;
    for (const next of road.neighbours(row.edge, localS, range)) {
      if (visited.has(next.edge)) continue;
      const offset = row.sOffset + row.sSign * next.sOffset;
      const sign = row.sSign * next.sSign;
      const len = road.edges[next.edge]?.length ?? 0;
      const lo = Math.min(offset, offset + sign * len),
        hi = Math.max(offset, offset + sign * len);
      const rowLo = Math.min(row.sOffset, row.sOffset + row.sSign * edge.length);
      const rowHi = Math.max(row.sOffset, row.sOffset + row.sSign * edge.length);
      // Keep walking away from the viewer. Returning through an arrival end would fold the
      // other arm of a fork onto this one, although the two cars cannot meet there.
      if ((row.walk > 0 && lo < rowHi - 1e-6) || (row.walk < 0 && hi > rowLo + 1e-6)) continue;
      if (lo - a.s > range || a.s - hi > range) continue;
      frontier.push({
        edge: next.edge,
        sOffset: offset,
        sSign: sign,
        dOffset: row.dOffset + row.sSign * next.dOffset,
        walk: row.walk || (lo >= rowHi - 1e-6 ? 1 : -1),
      });
    }
  }
  return null;
}
