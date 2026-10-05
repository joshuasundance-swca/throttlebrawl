import { describe, expect, it } from 'vitest';
import { assetIndex, basePackFiles, baseRoadsLoaded, fetchBaseRoads, loadBasePack } from './base-pack';
import { wholeBasePackFiles } from './base-pack-whole';
import { createPackLibrary, isRealRoadPath, isRoadDataPath } from './packs';

// The Keys' hand-made road data (run W-S, main keeper: the first-load JavaScript budget) ships as
// JSON files beside the build and is fetched at boot, before the app starts, instead of riding in
// the first-load JavaScript. The test setup (tests/setup/base-roads.ts) gives it from disk, as the
// build's self-test race does, so the base pack every test reads is the one the game reads.

const authored = wholeBasePackFiles();
const handMadeRoads = authored.filter((f) => isRoadDataPath(f.path) && !isRealRoadPath(f.path));

describe('the Keys hand-made road data', () => {
  it('is fetched file by file, each by its own URL, once', async () => {
    const asked: string[] = [];
    const files = await fetchBaseRoads((url) => {
      asked.push(url);
      const file = handMadeRoads.find((f) => url.endsWith(f.path));
      return file ? Promise.resolve(file.json) : Promise.reject(new Error(`not a road data file: ${url}`));
    });
    console.log(`[examined] ${handMadeRoads.length} hand-made road data files, ${asked.length} fetched`);
    // The networks, roads and routes of the Keys' own course: a dozen or more files.
    expect(handMadeRoads.length).toBeGreaterThan(10);
    expect(asked).toHaveLength(handMadeRoads.length);
    expect(new Set(asked).size).toBe(asked.length);
    expect(files).toEqual(handMadeRoads);
  });

  it('a failed fetch rejects, so boot can say so', async () => {
    await expect(fetchBaseRoads(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  });

  it('once in, makes the bundled base the base pack as authored without its real roads (every content hash holds)', () => {
    expect(baseRoadsLoaded()).toBe(true);
    const expected = authored.filter((f) => !isRealRoadPath(f.path) && !f.path.startsWith('assets/'));
    expect(basePackFiles().map((f) => f.path)).toEqual(expected.map((f) => f.path));
    expect(basePackFiles()).toEqual(expected);
  });
});

// A region's own models are baked into its region pack (tools/blender/README.md, "Pack and region"),
// so the game must find them through the asset manifest like the base pack's: playtest 3's landmark
// kits (the Golden Gate, Coit Tower) and the step-up bikes live in region packs.
describe('the asset manifest rows', () => {
  interface Dirent {
    name: string;
    isDirectory(): boolean;
  }
  interface Fs {
    readdirSync(p: string, o: { withFileTypes: true }): Dirent[];
    readdirSync(p: string, o: { recursive: true; encoding: 'utf8' }): string[];
  }
  /** Every GLB committed under a pack's assets/, as `<packId>:<id>` (id: the path under assets/, no extension). */
  async function bakedOnDisk(): Promise<string[]> {
    const mod: string = 'node:fs';
    const fs = (await import(/* @vite-ignore */ mod)) as Fs;
    return fs
      .readdirSync('packs', { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => {
        let files: string[];
        try {
          files = fs.readdirSync(`packs/${d.name}/assets`, { recursive: true, encoding: 'utf8' });
        } catch {
          return [];
        }
        return files
          .map((f) => f.replace(/\\/g, '/'))
          .filter((f) => f.endsWith('.glb'))
          .map((f) => `${d.name}:${f.replace(/\.glb$/, '')}`);
      });
  }

  it('list every baked GLB of every pack the build carries, under its own pack', async () => {
    const onDisk = await bakedOnDisk();
    const rows = assetIndex(createPackLibrary().registry());
    const listed = new Set(rows.map((r) => `${r.packId}:${r.id}`));
    const regionModels = onDisk.filter((m) => !m.startsWith('base:'));
    console.log(
      `[examined] ${onDisk.length} committed GLBs (${regionModels.length} in region packs), ${rows.length} manifest rows`,
    );
    expect(regionModels.length).toBeGreaterThan(0);
    for (const m of onDisk) expect(listed, m).toContain(m);
    for (const r of rows) {
      expect(r.kind).toBe('mesh');
      expect(r.source).toBe('baked');
      expect(r.path).toMatch(/\.glb$/);
    }
  });

  it('leave out a pack the registry does not carry', async () => {
    const onDisk = await bakedOnDisk();
    const rows = assetIndex(loadBasePack());
    expect(rows.length).toBe(onDisk.filter((m) => m.startsWith('base:')).length);
    expect(rows.every((r) => r.packId === 'base')).toBe(true);
  });
});
