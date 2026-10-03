// The whole base pack, real-road data included, for Node-side callers (tests and tools) that check
// the pack as authored. The app never imports this module: its bundled base pack (base-pack.ts)
// leaves the `osm-*` road data out, and the pack library fetches it on demand (run W-P); it leaves
// the hand-made Keys road data out too, and boot fetches it before the app starts (run W-S).
import { provideBaseRoads } from './base-pack';
import { isRealRoadPath, isRoadDataPath } from './packs';
import type { PackFile } from './parse';
import { buildRegistry, type ContentRegistry, type LoadOptions } from './registry';

const RAW = import.meta.glob<unknown>('/packs/base/**/*.json', { eager: true, import: 'default' });

/** Every base pack file as parsed JSON, with pack-relative paths, in path order. */
export function wholeBasePackFiles(): PackFile[] {
  return Object.keys(RAW)
    .sort()
    .map((key) => ({ path: key.replace(/^\/packs\/base\//, ''), json: RAW[key] }));
}

/** The whole base pack, validated and frozen (not cached: tests only). */
export function loadWholeBasePack(options: LoadOptions = {}): ContentRegistry {
  return buildRegistry(wholeBasePackFiles(), { includeDrafts: options.includeDrafts ?? false });
}

/**
 * Gives the bundled base pack (base-pack.ts) its hand-made Keys road data from disk, as boot's fetch
 * does in the browser: for Node-side callers of `loadBasePack()` (the unit and sim test setup,
 * tests/setup/base-roads.ts, and the build's self-test race, scripts/selftest-race.ts).
 */
export function provideBaseRoadsFromDisk(): void {
  provideBaseRoads(wholeBasePackFiles().filter((f) => isRoadDataPath(f.path) && !isRealRoadPath(f.path)));
}
