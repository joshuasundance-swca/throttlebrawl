import { describe, expect, it } from 'vitest';
import { basePackFiles, baseRoadsLoaded, fetchBaseRoads } from './base-pack';
import { wholeBasePackFiles } from './base-pack-whole';
import { isRealRoadPath, isRoadDataPath } from './packs';

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
