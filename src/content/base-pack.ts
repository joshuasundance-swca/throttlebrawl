// The base pack, bundled into the build (docs/content-packs.md, "The base game as pack zero").
// Vite's import.meta.glob is the generated index here: the bundler lists every JSON file under
// packs/base at build time, so nothing is hand-maintained and a static host never lists folders.
// content-1 adds the committed-never `pack.index.json` with sizes and hashes.
import { buildRegistry, type ContentRegistry, type LoadOptions, type PackFile } from './registry';

const RAW = import.meta.glob<unknown>('/packs/base/**/*.json', { eager: true, import: 'default' });

/** The base pack's files as parsed JSON, with pack-relative paths, in path order. */
export function basePackFiles(): PackFile[] {
  return Object.keys(RAW)
    .sort()
    .map((key) => ({ path: key.replace(/^\/packs\/base\//, ''), json: RAW[key] }));
}

let cached: ContentRegistry | null = null;
let cachedDrafts: boolean | null = null;

/** Loads, validates and freezes the base pack (once per option set). */
export function loadBasePack(options: LoadOptions = {}): ContentRegistry {
  const drafts = options.includeDrafts ?? false;
  if (!cached || cachedDrafts !== drafts) {
    cached = buildRegistry(basePackFiles(), { includeDrafts: drafts });
    cachedDrafts = drafts;
  }
  return cached;
}
