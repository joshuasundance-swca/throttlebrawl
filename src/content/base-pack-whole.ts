// The whole base pack, real-road data included, for Node-side callers (tests and tools) that check
// the pack as authored. The app never imports this module: its bundled base pack (base-pack.ts)
// leaves the `osm-*` road data out, and the pack library fetches it on demand (run W-P).
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
