// The world's receipts on the race's roadside boards (run W-T, the pitch deck's #14): the career
// picks which board slots say what (src/career/receipts.ts); this puts them into what the renderer
// already draws, as ordinary board items. A rewritten slot names its receipt item instead of its
// region item or pool; nothing new reaches render/, and a race without receipts is untouched.
import type { BoardCatalog, BoardItem, EdgeDressing, RoadDressing } from '../render';
import type { RoadNetwork } from '../sim/api';

export interface BoardSpotAt {
  road: string;
  index: number;
  x: number;
  z: number;
}

/** Every board slot on the network's roads (by its index among the road's features), and where it stands. */
export function boardSpots(road: RoadNetwork, dressing: RoadDressing): BoardSpotAt[] {
  const out: BoardSpotAt[] = [];
  for (const e of road.edges) {
    (dressing[e.id]?.features ?? []).forEach((f, index) => {
      if (f.kind !== 'billboard') return;
      const s = Math.min(e.length, Math.max(0, (f.s0 + f.s1) / 2));
      const p = road.toWorld(e.index, s, (f.d0 + f.d1) / 2, 0);
      out.push({ road: e.id, index, x: p.x, z: p.z });
    });
  }
  return out;
}

/** Where a road spot is in the world on this network, or null when the road is not on it. */
export function spotOn(road: RoadNetwork): (roadId: string, s: number) => { x: number; z: number } | null {
  return (roadId, s) => {
    const e = road.edges.find((x) => x.id === roadId);
    if (!e) return null;
    const p = road.toWorld(e.index, Math.min(e.length, Math.max(0, s)), 0, 0);
    return { x: p.x, z: p.z };
  };
}

/** The dressing and catalog with each receipt board's slot pointing at its own item. */
export function withReceiptBoards(
  dressing: RoadDressing,
  catalog: BoardCatalog,
  boards: readonly { road: string; index: number; ref: string; text: string; kind: BoardItem['kind'] }[],
): { dressing: RoadDressing; catalog: BoardCatalog } {
  if (boards.length === 0) return { dressing, catalog };
  const items: Record<string, BoardItem> = { ...catalog.items };
  const roads: Record<string, EdgeDressing> = { ...dressing };
  boards.forEach((b, i) => {
    const own = roads[b.road];
    if (!own?.features?.[b.index]) return;
    const id = `receipt-${i + 1}`;
    items[id] = { ref: b.ref, text: b.text, kind: b.kind };
    roads[b.road] = {
      ...own,
      features: own.features.map((f, j) => (j === b.index ? { ...f, item: id, pool: undefined } : f)),
    };
  });
  return { dressing: roads, catalog: { ...catalog, items } };
}
