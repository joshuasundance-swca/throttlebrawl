// Regions as the player picks them (playtest 1c item 6, 2026-09-30: "I do think we should start
// adding other regions races etc"; "Pnw and sf first then others"). The menu's picker lists every
// carried region that has an event; a pick starts that event, on that region's road, with its
// field, cop, traffic, signs and palette (docs/content-packs.md, "Region packs at runtime").
import { stationsFromTable, type RadioStation } from '../audio';
import { lookup, packOf, type ContentRegistry, type Region } from '../content';
import type { BoardCatalog, BoardItem, BoardKind } from '../render';
import type { RegionStream } from '../stream';
import { eventKey, eventLength, networkKeyOf, qualifyIn, streamForRoute } from './config';

/** One region the picker offers, with the event a pick starts. */
export interface RegionChoice {
  /** The region's qualified id (`base:florida-keys`). */
  id: string;
  name: string;
  blurb?: string;
  chapter: number;
  /** The qualified event a pick races. */
  eventId: string;
  /** The pack that holds the event (its road data may still need fetching). */
  packId: string;
}

/**
 * Every region with at least one event, ordered by chapter then id. A region's event is its first
 * by qualified id (one per region today). [default]
 */
export function regionChoices(reg: ContentRegistry): RegionChoice[] {
  const out = new Map<string, RegionChoice>();
  for (const id of Object.keys(reg.events).sort()) {
    const event = reg.events[id];
    if (!event) continue;
    const regionId = qualifyIn(packOf(id), event.region);
    const region = reg.regions[regionId];
    if (!region || out.has(regionId)) continue;
    // `name`, `blurb` and `chapter` are envelope fields the schema keeps loose.
    const { name, blurb, chapter } = region as { name?: unknown; blurb?: unknown; chapter?: unknown };
    out.set(regionId, {
      id: regionId,
      name: typeof name === 'string' && name ? name : region.id,
      ...(typeof blurb === 'string' && blurb ? { blurb } : {}),
      chapter: typeof chapter === 'number' && Number.isFinite(chapter) ? chapter : Number.MAX_SAFE_INTEGER,
      eventId: id,
      packId: packOf(id),
    });
  }
  return [...out.values()].sort((a, b) => a.chapter - b.chapter || (a.id < b.id ? -1 : 1));
}

/** The region a race in `eventId` runs in, as its registry key. */
export function regionKeyOf(reg: ContentRegistry, eventId: string): string {
  const key = eventKey(eventId);
  return qualifyIn(packOf(key), lookup(reg.events, key).region);
}

type BoardEntry = NonNullable<Region['signs']>[number];

/**
 * The renderer's board catalog for a region: its live signs and billboards, minus the items cut
 * on this device. References follow the veto format `<packId>:region/<regionId>#<itemId>`.
 */
export function boardCatalog(
  reg: ContentRegistry,
  regionKey: string,
  vetoed: ReadonlySet<string> = new Set(),
): BoardCatalog {
  const region = lookup(reg.regions, regionKey);
  const pack = packOf(regionKey);
  const items: Record<string, BoardItem> = {};
  const pools: { signs: BoardItem[]; billboards: BoardItem[] } = { signs: [], billboards: [] };
  const add = (list: readonly BoardEntry[] | undefined, kind: BoardKind, pool: BoardItem[]) => {
    for (const it of list ?? []) {
      const status = (it as { status?: unknown }).status;
      if (status !== undefined && status !== 'live') continue;
      const ref = `${pack}:region/${region.id}#${it.id}`;
      if (vetoed.has(ref)) continue;
      const item: BoardItem = { ref, text: it.text, kind };
      items[it.id] = item;
      pool.push(item);
    }
  };
  add(region.signs, 'sign', pools.signs);
  add(region.billboards, 'billboard', pools.billboards);
  return { items, pools };
}

/**
 * The race's palette: the region's `palette`, overridden key by key by the palette of the event's
 * time of day. Keys that name a render material kind colour that material; the renderer ignores
 * the rest (docs/content-packs.md, "Region packs at runtime", Palette).
 */
export function racePalette(
  reg: ContentRegistry,
  regionKey: string,
  timeOfDay: string,
): Record<string, string> {
  const region = lookup(reg.regions, regionKey);
  const option = region.timeOfDayOptions.find((o) => o.id === timeOfDay);
  const own = (region.palette ?? {}) as Readonly<Record<string, string>>;
  const over = ((option as { palette?: unknown } | undefined)?.palette ?? {}) as Readonly<
    Record<string, string>
  >;
  return { ...own, ...over };
}

/** Region streams, one per network, built on first use. */
export interface StreamCache {
  /** The stream for an event's chosen length (default its first). */
  forEvent(reg: ContentRegistry, eventId: string, lengthId?: string): RegionStream;
  /** The stream for a route (by qualified id). */
  forRoute(reg: ContentRegistry, routeKey: string): RegionStream;
}

export function createStreamCache(): StreamCache {
  const byNetwork = new Map<string, RegionStream>();
  const forRoute = (reg: ContentRegistry, routeKey: string): RegionStream => {
    const key = networkKeyOf(reg, routeKey);
    let s = byNetwork.get(key);
    if (!s) {
      s = streamForRoute(reg, routeKey);
      byNetwork.set(key, s);
    }
    return s;
  };
  return {
    forRoute,
    forEvent(reg, eventId, lengthId) {
      const key = eventKey(eventId);
      const length = eventLength(lookup(reg.events, key), lengthId);
      return forRoute(reg, qualifyIn(packOf(key), length.route));
    },
  };
}

/** The route a race in `eventId` runs (its chosen length, default the first), as its registry key. */
export function routeKeyOf(reg: ContentRegistry, eventId: string, lengthId?: string): string {
  const key = eventKey(eventId);
  return qualifyIn(packOf(key), eventLength(lookup(reg.events, key), lengthId).route);
}

/** What the radio plays in a race's region: the stations to offer and the region to filter them by. */
export interface RaceRadio {
  stations: RadioStation[];
  /** The region audio filters by (`setRegion`), or null for every station given. */
  region: string | null;
}

/**
 * The race's radio (M4 radio-1 head start; the integration round): every carried station, filtered
 * to the region by each station's `regions` (genre stations play everywhere), when the region has
 * a station of its own. A region with none of its own yet gets the base pack's stations, all of
 * them, rather than silence. [default] Regions may add their own stations later as pack data.
 */
export function raceRadio(reg: ContentRegistry, regionKey: string): RaceRadio {
  const all = stationsFromTable(reg.stations);
  const bare = regionKey.slice(regionKey.indexOf(':') + 1);
  if (all.some((s) => s.regions.includes(bare))) return { stations: all, region: regionKey };
  return { stations: all.filter((s) => s.packId === 'base'), region: null };
}
