// The schema check in a production build (lane F1, the first-load headroom): the build swaps it in
// for validate.ts (scripts/pre-parse-packs.mjs). The build has already run validate.ts on every pack
// file it bundles or ships, failed on any finding, and written Zod's output in the file's place, so
// this check only hands back a copy: the registry trims and freezes what it is given, and the
// bundled JSON must stay as it is for the next registry built from it. No Zod, no schemas: neither
// rides in the first-load JavaScript. src/content/validate.test.ts holds that both checks give the
// same registry, byte for byte, and the same content hashes.
import type { EntryType, PackManifest } from './schema';
import type { Checked } from './validate';

export type { Checked } from './validate';

/** The pack manifest, already Zod's output. */
export function checkManifest(_file: string, json: unknown): Checked<PackManifest> {
  return { ok: true, data: structuredClone(json) as PackManifest };
}

/** One entry file, already Zod's output for its `type`. */
export function checkEntry(
  _file: string,
  json: unknown,
): Checked<{ type: EntryType; data: Record<string, unknown> }> {
  const data = structuredClone(json) as Record<string, unknown> & { type: EntryType };
  return { ok: true, data: { type: data.type, data } };
}
