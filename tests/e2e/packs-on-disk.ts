import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The packs as they sit on disk, for browser specs that check the screen against the content
// (docs/engineering.md, "Assert the rule, not today's content"): a spec reads what it expects from
// here instead of copying a list or a line of player-facing text out of a pack. Plain JSON reads,
// so nothing of the game's bundling is needed in the test runner. Ids come back qualified
// (`<packId>:<id>`), as the game's registry keys them.

/** A reference as the registry keys it: bare refs belong to the pack that holds them. */
export const qualifyIn = (packId: string, ref: string): string =>
  ref.includes(':') ? ref : `${packId}:${ref}`;

/** The DOM id fragment the menu builds from a qualified id (`region-sf:x` -> `region-sf-x`). */
export const domId = (id: string): string => id.replace(/[^a-z0-9-]/gi, '-');

const packIds = (): string[] => readdirSync('packs').filter((p) => existsSync(join('packs', p, 'pack.json')));

const jsonIn = <T>(dir: string): T[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T)
    : [];

/** Each pack's region folders (packs/<pack>/regions/<region>/). */
const regionDirs = (pack: string): string[] => {
  const dir = join('packs', pack, 'regions');
  return existsSync(dir) ? readdirSync(dir).map((r) => join(dir, r)) : [];
};

export interface DiskEvent {
  key: string;
  pack: string;
  id: string;
  name?: string;
  region: string;
  tier?: number;
  lengths: { route: string }[];
  [field: string]: unknown;
}
export interface DiskRegion {
  key: string;
  name?: string;
  chapter?: number;
  [field: string]: unknown;
}
export interface DiskNetwork {
  key: string;
  region: string;
  realRoad: boolean;
  name: string;
  /** Its road ids, bare as the file lists them. */
  roads: string[];
}
export interface DiskRoute {
  key: string;
  name?: string;
  network: string;
}

type EventFile = { id: string; region: string; lengths?: { route: string }[] } & Record<string, unknown>;

/** Every event file in every pack, its region qualified. */
export function diskEvents(): DiskEvent[] {
  return packIds().flatMap((pack) =>
    jsonIn<EventFile>(join('packs', pack, 'events')).map((e) => ({
      ...e,
      key: qualifyIn(pack, e.id),
      pack,
      region: qualifyIn(pack, e.region),
      lengths: e.lengths ?? [],
    })),
  );
}

type RegionFile = { id: string } & Record<string, unknown>;

/** Every region file (packs/<pack>/regions/<region>/region.json). */
export function diskRegions(): DiskRegion[] {
  return packIds().flatMap((pack) =>
    regionDirs(pack)
      .filter((d) => existsSync(join(d, 'region.json')))
      .map((d) => {
        const r = JSON.parse(readFileSync(join(d, 'region.json'), 'utf8')) as RegionFile;
        return { ...r, key: qualifyIn(pack, r.id) };
      }),
  );
}

interface NetworkFile {
  id: string;
  name?: string;
  region: string;
  roads?: string[];
  provenance?: { origin?: string };
}

/** Every road network, its region qualified; `realRoad` when it was baked from map data. */
export function diskNetworks(): Map<string, DiskNetwork> {
  const out = new Map<string, DiskNetwork>();
  for (const pack of packIds())
    for (const d of regionDirs(pack))
      for (const n of jsonIn<NetworkFile>(join(d, 'networks')))
        out.set(qualifyIn(pack, n.id), {
          key: qualifyIn(pack, n.id),
          region: qualifyIn(pack, n.region),
          realRoad: n.provenance?.origin === 'gis-pipeline',
          name: n.name ?? n.id,
          roads: n.roads ?? [],
        });
  return out;
}

export interface DiskCareer {
  key: string;
  pack: string;
  name: string;
  /** Qualified. */
  region: string;
  startingCash: number;
  startingBike: string;
  tutorialEvent: string;
  tiers: { id: string; name?: string }[];
  nodes: { id: string; event: string; tier: string; at: { road: string }; requires?: string[] }[];
  shop: { bike: string; priceCash: number; unlockTier: string }[];
  paints: { id: string; name: string; priceCash: number; unlockTier: string }[];
}

/** Every career file (packs/<pack>/careers/), its region qualified. */
export function diskCareers(): DiskCareer[] {
  return packIds().flatMap((pack) =>
    jsonIn<Omit<DiskCareer, 'key' | 'pack'> & { id: string }>(join('packs', pack, 'careers')).map((c) => ({
      ...c,
      key: qualifyIn(pack, c.id),
      pack,
      region: qualifyIn(pack, c.region),
    })),
  );
}

/**
 * What the career browser spec checks, picked from the packs by rule: the careers in the menu's
 * chapter order; the first one's opening node (its tutorial event, the one the menu's Start career suggests) and a
 * first-tier node waiting on it alone; a first-tier paint the starting cash buys and a bike sold
 * only from a later tier; the starting bike's name; the next career's map panel that holds its first
 * node (its network's name without the bake note in brackets).
 */
export function careerPicks() {
  const order = menuRegions().map((r) => r.region.key);
  const careers = diskCareers()
    .filter((c) => order.includes(c.region))
    .sort((a, b) => order.indexOf(a.region) - order.indexOf(b.region));
  const [first, next] = careers;
  if (!first || !next) throw new Error('fewer than two careers on disk');
  const events = new Map(diskEvents().map((e) => [e.key, e]));
  const eventOf = (ref: string) => {
    const e = events.get(qualifyIn(first.pack, ref));
    if (!e) throw new Error(`no event ${ref}`);
    return e;
  };
  const opening = first.nodes.find((n) => eventOf(n.event).key === eventOf(first.tutorialEvent).key);
  const firstTier = first.tiers[0]?.id;
  const waiting = first.nodes.find(
    (n) => n.tier === firstTier && n.requires?.length === 1 && n.requires[0] === opening?.id,
  );
  if (!opening || !waiting) throw new Error(`${first.key}: no opening node and one waiting on it`);
  const paint = first.paints.find(
    (p) => p.unlockTier === firstTier && p.priceCash > 0 && p.priceCash <= first.startingCash,
  );
  const laterBike = first.shop.find((s) => s.unlockTier !== firstTier);
  if (!paint || !laterBike) throw new Error(`${first.key}: no affordable paint or later bike`);
  const road = next.nodes[0]?.at.road ?? '';
  const net = [...diskNetworks().values()].find((n) => n.region === next.region && n.roads.includes(road));
  if (!net) throw new Error(`${next.key}: no network holds ${road}`);
  return {
    careers,
    first,
    next,
    opening,
    openingEvent: eventOf(opening.event),
    waiting,
    paint,
    laterBike,
    startingBikeName: diskName('bikes', first.pack, first.startingBike),
    nextPanel: net.name.replace(/ \([^)]*\)$/, ''),
  };
}

/** A content file's `name` by its pack folder and qualified or pack-local id (`bikes`, `riders`). */
export function diskName(folder: string, pack: string, ref: string): string {
  const key = qualifyIn(pack, ref);
  const [p, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const hit = jsonIn<{ id: string; name: string }>(join('packs', p, folder)).find((x) => x.id === id);
  if (!hit) throw new Error(`no ${folder} file for ${key}`);
  return hit.name;
}

/** Every route, its network qualified. */
export function diskRoutes(): DiskRoute[] {
  return packIds().flatMap((pack) =>
    regionDirs(pack).flatMap((d) =>
      jsonIn<{ id: string; name?: string; network: string }>(join(d, 'routes')).map((r) => ({
        key: qualifyIn(pack, r.id),
        ...(r.name ? { name: r.name } : {}),
        network: qualifyIn(pack, r.network),
      })),
    ),
  );
}

/**
 * The regions the menu offers, in its order (chapter, then id), each with the event a pick races:
 * its first free-play event by qualified id (no career `tier`), else its first event. The rule is
 * app/regions.ts's `regionChoices`, restated from its doc comment as this spec's oracle.
 */
export function menuRegions(): { region: DiskRegion; event: DiskEvent }[] {
  const events = diskEvents().sort((a, b) => (a.key < b.key ? -1 : 1));
  const byRegion = new Map<string, DiskEvent>();
  for (const e of [
    ...events.filter((e) => e.tier === undefined),
    ...events.filter((e) => e.tier !== undefined),
  ])
    if (!byRegion.has(e.region)) byRegion.set(e.region, e);
  const chapter = (r: DiskRegion) => (typeof r.chapter === 'number' ? r.chapter : Number.MAX_SAFE_INTEGER);
  return diskRegions()
    .filter((r) => byRegion.has(r.key))
    .sort((a, b) => chapter(a) - chapter(b) || (a.key < b.key ? -1 : 1))
    .map((region) => ({ region, event: byRegion.get(region.key)! }));
}

/**
 * The routes the route picker offers for an event after its own hand-made road, by qualified id in
 * id order: every route on a network of the event's region that is not one of the event's own
 * lengths, when the network was baked from map data, or when it is another network than the
 * event's own (San Francisco's downtown). The rule is app/config.ts's `realRoutes`, restated from
 * its doc comment.
 */
export function offeredRoutes(event: DiskEvent): DiskRoute[] {
  const networks = diskNetworks();
  const routes = diskRoutes();
  const own = new Set(event.lengths.map((l) => qualifyIn(event.pack, l.route)));
  const ownNetworks = new Set(routes.filter((r) => own.has(r.key)).map((r) => r.network));
  return routes
    .filter((r) => {
      const network = networks.get(r.network);
      if (own.has(r.key) || !network || network.region !== event.region) return false;
      return network.realRoad || (ownNetworks.size > 0 && !ownNetworks.has(r.network));
    })
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}
