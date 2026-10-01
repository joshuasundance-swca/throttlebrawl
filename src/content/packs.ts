// Every pack the build carries, not only base (docs/content-packs.md, "Region packs at runtime";
// playtest 1c item 6, 2026-09-30: "Pnw and sf first then others"). Base stays bundled whole
// (base-pack.ts). Another pack's entries are bundled too, except its baked road data (network,
// road and route files, most of its bytes), which ships as plain JSON files beside the build and
// is fetched the first time a race in that pack's region starts. So a new region costs the first
// load only its small entry files, and the JavaScript budget does not grow with every road.
//
// Packs combine into one registry keyed by qualified id, base first and then in dependency order
// (ties by id). A race reads the subset its own packs make (`packSubset`), so loading another
// region never changes the Keys race or its replay key.
import { basePackFiles, loadBasePack } from './base-pack';
import type { PackFile } from './parse';
import { buildRegistry, ContentError, type ContentRegistry, type LoadOptions } from './registry';

/** Baked road data: network, road and route files under `regions/<region>/`. */
export function isRoadDataPath(path: string): boolean {
  return /^regions\/[^/]+\/(?:networks|roads|routes)\//.test(path);
}

/**
 * Real-road data (`osm-*` networks, roads and routes, built from map data by tools/gis): the base
 * pack's are fetched on demand too (run W-P), never bundled, since only a race on a real road needs
 * them.
 */
export function isRealRoadPath(path: string): boolean {
  return /^regions\/[^/]+\/(?:networks|roads|routes)\/osm-[^/]+\.json$/.test(path);
}

/** The pack a qualified id (`region-pnw:old-growth`) belongs to; `base` for a bare id. */
export function packOf(id: string): string {
  const i = id.indexOf(':');
  return i < 0 ? 'base' : id.slice(0, i);
}

/**
 * Groups files keyed `/packs/<packId>/<pack-relative path>` (an `import.meta.glob` result) into
 * each pack's files, in path order. Keys outside `/packs/` are ignored.
 */
export function groupPackFiles(raw: Readonly<Record<string, unknown>>): Map<string, PackFile[]> {
  const out = new Map<string, PackFile[]>();
  for (const key of Object.keys(raw).sort()) {
    const m = /^\/?packs\/([^/]+)\/(.+)$/.exec(key);
    if (!m?.[1] || !m[2]) continue;
    const files = out.get(m[1]) ?? [];
    files.push({ path: m[2], json: raw[key] });
    out.set(m[1], files);
  }
  return out;
}

type Tables = Record<string, Record<string, unknown>>;
const NOT_TABLES = new Set(['packs', 'index']);

/**
 * Pack ids in load order: base first, then repeatedly the lowest id whose dependencies are all
 * placed (dependency order, ties broken by id).
 */
function loadOrder(deps: ReadonlyMap<string, readonly string[]>): string[] {
  const order: string[] = [];
  const placed = new Set<string>();
  const left = [...deps.keys()].sort((a, b) => (a === 'base' ? -1 : b === 'base' ? 1 : a < b ? -1 : 1));
  while (left.length > 0) {
    const i = left.findIndex((id) => (deps.get(id) ?? []).every((d) => placed.has(d)));
    if (i < 0) throw new ContentError(`pack dependency cycle among ${left.join(', ')}`);
    const [id] = left.splice(i, 1);
    if (id === undefined) break;
    placed.add(id);
    order.push(id);
  }
  return order;
}

/**
 * Combines registries (one pack each, or several) into one: every table merged by qualified id,
 * the manifests and the index in load order. A pack whose dependency is not among them, or a pack
 * loaded twice, is refused.
 */
export function combineRegistries(regs: readonly ContentRegistry[]): ContentRegistry {
  const owner = new Map<string, ContentRegistry>();
  const deps = new Map<string, readonly string[]>();
  for (const reg of regs) {
    for (const m of reg.packs) {
      if (owner.has(m.id)) throw new ContentError(`pack ${m.id} is loaded twice`);
      owner.set(m.id, reg);
      deps.set(m.id, Object.keys(m.dependencies ?? {}));
    }
  }
  for (const [id, needs] of deps) {
    for (const d of needs)
      if (!deps.has(d)) throw new ContentError(`pack ${id} needs pack ${d}, which is not loaded`);
  }
  const order = loadOrder(deps);
  const regOrder: ContentRegistry[] = [];
  for (const id of order) {
    const reg = owner.get(id);
    if (reg && !regOrder.includes(reg)) regOrder.push(reg);
  }
  const tables: Tables = {};
  for (const reg of regOrder) {
    for (const [name, table] of Object.entries(reg)) {
      if (NOT_TABLES.has(name)) continue;
      tables[name] = { ...(tables[name] ?? {}), ...(table as Record<string, unknown>) };
    }
  }
  const packs = order.flatMap((id) => owner.get(id)?.packs.filter((m) => m.id === id) ?? []);
  const index = order.flatMap((id) => owner.get(id)?.index.filter((r) => r.packId === id) ?? []);
  for (const t of Object.values(tables)) Object.freeze(t);
  return Object.freeze({ packs, index, ...tables }) as unknown as ContentRegistry;
}

/**
 * The registry restricted to some packs (a race's: its event's pack and that pack's dependencies),
 * so content from other packs never reaches that race's config or its content hash.
 */
export function packSubset(reg: ContentRegistry, packIds: readonly string[]): ContentRegistry {
  const keep = new Set(packIds);
  const tables: Tables = {};
  for (const [name, table] of Object.entries(reg)) {
    if (NOT_TABLES.has(name)) continue;
    tables[name] = Object.freeze(
      Object.fromEntries(
        Object.entries(table as Record<string, unknown>).filter(([id]) => keep.has(packOf(id))),
      ),
    );
  }
  return Object.freeze({
    packs: reg.packs.filter((m) => keep.has(m.id)),
    index: reg.index.filter((r) => keep.has(r.packId)),
    ...tables,
  }) as unknown as ContentRegistry;
}

/** A pack and every pack it depends on, transitively, in load order (base first). */
export function packClosure(reg: ContentRegistry, packId: string): string[] {
  const byId = new Map(reg.packs.map((m) => [m.id, m]));
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    const m = byId.get(id);
    if (!m) throw new ContentError(`pack ${id} is not loaded`);
    for (const d of Object.keys(m.dependencies ?? {})) visit(d);
    out.add(id);
  };
  visit(packId);
  return reg.packs.map((m) => m.id).filter((id) => out.has(id));
}

/** Every pack in an `import.meta.glob` result, whole, combined (tests and tools; no fetching). */
export function registryFromGlob(
  raw: Readonly<Record<string, unknown>>,
  options: LoadOptions = {},
): ContentRegistry {
  return combineRegistries(
    [...groupPackFiles(raw).values()].map((files) =>
      buildRegistry(files, { includeDrafts: options.includeDrafts ?? false }),
    ),
  );
}

// ---- The packs this build carries ----------------------------------------------------------

/** Where the other packs' files come from (the build's globs by default; tests inject their own). */
export interface PackSources {
  /** Every non-base pack file except road data, as parsed JSON, keyed `/packs/<id>/<path>`. */
  entries: Readonly<Record<string, unknown>>;
  /**
   * Every road data file's URL to fetch on demand, keyed the same way: a region pack's road data,
   * and the base pack's real-road data (`isRealRoadPath`; its hand-made roads are bundled).
   */
  roadUrls: Readonly<Record<string, string>>;
  /** Fetches and parses one road data file (default: `fetch`). */
  fetchJson?: (url: string) => Promise<unknown>;
}

function bundledSources(): PackSources {
  return {
    entries: import.meta.glob<unknown>(
      [
        '/packs/*/**/*.json',
        '!/packs/base/**',
        '!/packs/*/regions/*/networks/**',
        '!/packs/*/regions/*/roads/**',
        '!/packs/*/regions/*/routes/**',
        '!/packs/*/assets/**',
      ],
      { eager: true, import: 'default' },
    ),
    roadUrls: {
      ...import.meta.glob<string>(
        [
          '/packs/*/regions/*/networks/*.json',
          '/packs/*/regions/*/roads/*.json',
          '/packs/*/regions/*/routes/*.json',
          '!/packs/base/**',
        ],
        { eager: true, query: '?url', import: 'default' },
      ),
      // The base pack's real roads (the Bahia Honda run): base-pack.ts leaves them out of the bundle.
      ...import.meta.glob<string>(
        [
          '/packs/base/regions/*/networks/osm-*.json',
          '/packs/base/regions/*/roads/osm-*.json',
          '/packs/base/regions/*/routes/osm-*.json',
        ],
        { eager: true, query: '?url', import: 'default' },
      ),
    },
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new ContentError(`could not load ${url}: HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

/** The packs the build carries: base whole, the others' entries now and their roads on demand. */
export interface PackLibrary {
  /** Every carried pack combined (a pack's road data only once `loadRoads` has fetched it). */
  registry(): ContentRegistry;
  /** The carried pack ids in load order, base first. */
  readonly packIds: readonly string[];
  /**
   * True when the pack's road data is in the registry. For base, its real-road data (the Keys'
   * hand-made roads are always in): a race on the Keys' own road needs nothing fetched, but the
   * Keys' content hash covers the real roads too, so app/ starts a Keys race once they are in.
   */
  hasRoads(packId: string): boolean;
  /** Fetches a pack's road data once; resolves to the registry that includes it. */
  loadRoads(packId: string): Promise<ContentRegistry>;
}

export function createPackLibrary(options: LoadOptions & { sources?: PackSources } = {}): PackLibrary {
  const drafts = { includeDrafts: options.includeDrafts ?? false };
  const sources = options.sources ?? bundledSources();
  const load = sources.fetchJson ?? fetchJson;
  const entryFiles = groupPackFiles(sources.entries);
  const roadFiles = new Map<string, { path: string; url: string }[]>();
  for (const [packId, files] of groupPackFiles(sources.roadUrls)) {
    roadFiles.set(
      packId,
      files.map((f) => ({ path: f.path, url: String(f.json) })),
    );
  }
  // Base is the bundled base pack (base-pack.ts), whatever the sources list for it.
  entryFiles.set('base', basePackFiles());
  const perPack = new Map<string, ContentRegistry>([['base', loadBasePack(drafts)]]);
  const withRoads = new Set<string>();
  for (const [packId, files] of entryFiles) {
    if (packId !== 'base') perPack.set(packId, buildRegistry(files, drafts));
    if (!roadFiles.has(packId)) withRoads.add(packId);
  }
  let combined = combineRegistries([...perPack.values()]);
  const pending = new Map<string, Promise<ContentRegistry>>();

  return {
    registry: () => combined,
    packIds: combined.packs.map((m) => m.id),
    hasRoads: (packId) => withRoads.has(packId),
    loadRoads(packId) {
      if (withRoads.has(packId)) return Promise.resolve(combined);
      const files = entryFiles.get(packId);
      if (!files) return Promise.reject(new ContentError(`pack ${packId} is not carried by this build`));
      let p = pending.get(packId);
      if (!p) {
        const roads = roadFiles.get(packId) ?? [];
        p = Promise.all(roads.map(async (f) => ({ path: f.path, json: await load(f.url) }))).then(
          (fetched) => {
            perPack.set(packId, buildRegistry([...files, ...fetched], drafts));
            withRoads.add(packId);
            combined = combineRegistries([...perPack.values()]);
            return combined;
          },
        );
        // A failed fetch can be tried again (a dropped connection on the phone).
        p.catch(() => pending.delete(packId));
        pending.set(packId, p);
      }
      return p;
    },
  };
}
