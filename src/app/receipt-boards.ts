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

/**
 * Run W-U: how far beyond the road's outer edge an incident site's middle stands, metres. Its
 * placard and cones span about 5.5 m across, so the nearest cone stands just off the road. [default]
 */
export const INCIDENT_EDGE_M = 3.2;
/** A site on a bridge or over water slides along its road in these steps, this many each way. */
const INCIDENT_SLIDE_M = 40;
const INCIDENT_SLIDES = 5;
const WET = new Set(['water-open', 'water-shallow', 'swamp']);

/**
 * Where an incident site stands for a bust at (road, s): beside the road's outer edge, on its right
 * (+d) where that is land, else its left; never on a bridge or over water, so it slides along the
 * road (40 m steps, up to 200 m each way) to the nearest dry stretch. Null when the road is not on
 * this network or no dry stretch is near.
 */
export function incidentSpot(
  road: RoadNetwork,
  dressing: RoadDressing,
  roadId: string,
  s: number,
): { s: number; d: number } | null {
  const e = road.edges.find((x) => x.id === roadId);
  if (!e) return null;
  const tags = dressing[roadId]?.tags ?? [];
  const tagged = (at: number, ok: (tag: string, side: string) => boolean) =>
    tags.some((t) => t.s0 <= at && at <= t.s1 && ok(t.tag, t.side ?? 'both'));
  for (let i = 0; i <= INCIDENT_SLIDES * 2; i++) {
    const off = Math.ceil(i / 2) * INCIDENT_SLIDE_M * (i % 2 === 1 ? 1 : -1);
    const at = s + off;
    if (at < 0 || at > e.length) continue;
    if (tagged(at, (tag) => tag === 'bridge')) continue;
    for (const side of [1, -1]) {
      const name = side > 0 ? 'right' : 'left';
      if (tagged(at, (tag, sd) => WET.has(tag) && (sd === 'both' || sd === name))) continue;
      const lanes = road.lanesAt(e.index, at);
      if (lanes.length === 0) continue;
      const edge =
        side > 0
          ? Math.max(...lanes.map((l) => l.dCenterM + l.widthM / 2))
          : Math.min(...lanes.map((l) => l.dCenterM - l.widthM / 2));
      return { s: at, d: edge + side * INCIDENT_EDGE_M };
    }
  }
  return null;
}

/**
 * The dressing and catalog with an incident site (run W-U, the pitch deck's #14: "an 'INCIDENT SITE
 * #3' cone where you were busted") at each bust's own spot: a new board slot on its road, beside the
 * road (incidentSpot), naming a `cone` item (render/boards.ts draws traffic cones round a small
 * placard). Added after the road's own features, so their indices (and receipt boards) hold.
 */
export function withIncidentSites(
  road: RoadNetwork,
  dressing: RoadDressing,
  catalog: BoardCatalog,
  sites: readonly { road: string; s: number; ref: string; text: string }[],
): { dressing: RoadDressing; catalog: BoardCatalog } {
  if (sites.length === 0) return { dressing, catalog };
  const items: Record<string, BoardItem> = { ...catalog.items };
  const roads: Record<string, EdgeDressing> = { ...dressing };
  sites.forEach((site, i) => {
    const spot = incidentSpot(road, roads, site.road, site.s);
    if (!spot) return;
    const id = `incident-site-${i + 1}`;
    items[id] = { ref: site.ref, text: site.text, kind: 'cone' };
    const own = roads[site.road] ?? {};
    const slot = { kind: 'billboard', id, s0: spot.s, s1: spot.s, d0: spot.d, d1: spot.d, item: id };
    roads[site.road] = { ...own, features: [...(own.features ?? []), slot] };
  });
  return { dressing: roads, catalog: { ...catalog, items } };
}
