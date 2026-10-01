import { describe, expect, it } from 'vitest';
import { loadBasePack } from './base-pack';
import {
  combineRegistries,
  createPackLibrary,
  groupPackFiles,
  isRoadDataPath,
  packClosure,
  packOf,
  packSubset,
  registryFromGlob,
  type PackSources,
} from './packs';
import { buildRegistry, contentHashes, ContentError } from './registry';

const ALL = import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' });

/** The build's split, made from the eager glob: entries now, road data "fetched" from memory. */
function sources(): PackSources & { fetched: string[] } {
  const entries: Record<string, unknown> = {};
  const roadUrls: Record<string, string> = {};
  for (const [key, json] of Object.entries(ALL)) {
    if (key.startsWith('/packs/base/')) continue;
    const path = key.replace(/^\/packs\/[^/]+\//, '');
    if (isRoadDataPath(path)) roadUrls[key] = `mem:${key}`;
    else entries[key] = json;
  }
  const fetched: string[] = [];
  return {
    entries,
    roadUrls,
    fetched,
    fetchJson: (url) => {
      fetched.push(url);
      return Promise.resolve(ALL[url.slice('mem:'.length)]);
    },
  };
}

const manifest = (id: string, dependencies: Record<string, string> = {}) => ({
  path: 'pack.json',
  json: {
    type: 'pack',
    id,
    name: id,
    version: '0.1.0',
    formatVersion: 1,
    gameVersion: '>=0.1.0',
    dependencies,
    license: 'MIT',
    defaults: { tuning: 'registry', hud: 'classic' },
    idAliases: {},
  },
});

describe('content: region packs at runtime', () => {
  it('classifies road data paths and pack ids', () => {
    expect(isRoadDataPath('regions/pacific-northwest/roads/pnw-trestle.json')).toBe(true);
    expect(isRoadDataPath('regions/pacific-northwest/networks/pnw-c1.json')).toBe(true);
    expect(isRoadDataPath('regions/pacific-northwest/routes/pnw-espresso-run.json')).toBe(true);
    expect(isRoadDataPath('regions/pacific-northwest/region.json')).toBe(false);
    expect(isRoadDataPath('riders/old-growth.json')).toBe(false);
    expect(packOf('region-sf:pivot')).toBe('region-sf');
    expect(packOf('pivot')).toBe('base');
  });

  it('groups glob keys by pack, in path order', () => {
    const g = groupPackFiles({
      '/packs/b/z.json': 1,
      '/packs/b/a.json': 2,
      '/packs/a/pack.json': 3,
      '/x.json': 4,
    });
    expect([...g.keys()]).toEqual(['a', 'b']);
    expect(g.get('b')?.map((f) => f.path)).toEqual(['a.json', 'z.json']);
  });

  it('combines every carried pack: base first, region ids qualified by their own pack', () => {
    const reg = registryFromGlob(ALL);
    expect(reg.packs.map((p) => p.id)).toEqual(['base', 'region-pnw', 'region-sf']);
    expect(reg.regions['base:florida-keys']).toBeDefined();
    expect(reg.regions['region-pnw:pacific-northwest']).toBeDefined();
    expect(reg.regions['region-sf:san-francisco']).toBeDefined();
    expect(reg.events['region-pnw:pnw-fogline-run']).toBeDefined();
    expect(reg.riders['region-sf:officer-meter']).toBeDefined();
    expect(reg.roads['region-pnw:pnw-trestle']).toBeDefined();
    expect(packClosure(reg, 'region-pnw')).toEqual(['base', 'region-pnw']);
  });

  it('a subset of base alone is exactly the base pack, so the Keys content hash never moves', () => {
    const reg = registryFromGlob(ALL);
    const base = loadBasePack();
    expect(contentHashes(packSubset(reg, ['base']))).toEqual(contentHashes(base));
    expect(Object.keys(packSubset(reg, ['base']).trafficTypes)).toEqual(Object.keys(base.trafficTypes));
    // A region race's subset holds base plus that region, and not the other region.
    const pnw = packSubset(reg, packClosure(reg, 'region-pnw'));
    expect(Object.keys(pnw.riders).some((k) => k.startsWith('region-sf:'))).toBe(false);
    expect(contentHashes(pnw).sim).not.toBe(contentHashes(base).sim);
  });

  it('refuses a pack whose dependency is not loaded, and a pack loaded twice', () => {
    const orphan = buildRegistry([manifest('orphan', { missing: '^0.1.0' })]);
    expect(() => combineRegistries([orphan])).toThrow(ContentError);
    expect(() => combineRegistries([orphan])).toThrow(/needs pack missing/);
    const solo = buildRegistry([manifest('solo')]);
    expect(() => combineRegistries([solo, solo])).toThrow(/loaded twice/);
  });

  it('orders packs by dependency, ties by id', () => {
    const a = buildRegistry([manifest('aa', { zz: '*' })]);
    const z = buildRegistry([manifest('zz')]);
    const m = buildRegistry([manifest('mm')]);
    expect(combineRegistries([a, m, z]).packs.map((p) => p.id)).toEqual(['mm', 'zz', 'aa']);
  });

  it('the library carries the regions at once and fetches a region road data on demand, once', async () => {
    const src = sources();
    const lib = createPackLibrary({ sources: src });
    expect(lib.packIds).toEqual(['base', 'region-pnw', 'region-sf']);
    // Entries now (the picker lists the region and its event); roads not yet.
    expect(lib.registry().regions['region-sf:san-francisco']?.name).toBe('San Francisco');
    expect(lib.registry().events['region-sf:sf-hill-sprint']).toBeDefined();
    expect(lib.hasRoads('base')).toBe(true);
    expect(lib.hasRoads('region-sf')).toBe(false);
    expect(lib.registry().roads['region-sf:sf-pier-row']).toBeUndefined();
    const [a, b] = await Promise.all([lib.loadRoads('region-sf'), lib.loadRoads('region-sf')]);
    expect(a).toBe(b);
    expect(lib.hasRoads('region-sf')).toBe(true);
    expect(a.roads['region-sf:sf-pier-row']).toBeDefined();
    expect(a.routes['region-sf:sf-standard-run']).toBeDefined();
    const sfRoadFiles = Object.keys(src.roadUrls).filter((k) => k.startsWith('/packs/region-sf/')).length;
    expect(src.fetched).toHaveLength(sfRoadFiles);
    await lib.loadRoads('region-sf');
    expect(src.fetched, 'fetched once').toHaveLength(sfRoadFiles);
    // The other region is untouched, and the combined registry equals loading every file whole.
    expect(lib.hasRoads('region-pnw')).toBe(false);
    await lib.loadRoads('region-pnw');
    expect(contentHashes(lib.registry())).toEqual(contentHashes(registryFromGlob(ALL)));
  });

  it('a failed road fetch can be tried again', async () => {
    const src = sources();
    let fail = true;
    const lib = createPackLibrary({
      sources: {
        ...src,
        fetchJson: (url) =>
          fail
            ? Promise.reject(new Error('offline'))
            : (src.fetchJson?.(url) ?? Promise.reject(new Error('no source'))),
      },
    });
    await expect(lib.loadRoads('region-pnw')).rejects.toThrow('offline');
    expect(lib.hasRoads('region-pnw')).toBe(false);
    fail = false;
    const reg = await lib.loadRoads('region-pnw');
    expect(reg.networks['region-pnw:pnw-c1']).toBeDefined();
  });
});
