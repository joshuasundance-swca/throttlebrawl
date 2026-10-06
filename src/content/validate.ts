// The schema check of one pack file (docs/content-packs.md, "Validation", step 1): Zod, the source of
// truth, for the manifest and for each entry by its `type`. parse.ts runs it on every file and adds
// the checks a file's path makes; packs:check, the tests and the dev server run it as written.
//
// A production build swaps this module for validate-prebuilt.ts (scripts/pre-parse-packs.mjs, lane
// F1, the first-load headroom): the build runs this same check on every pack file it bundles or
// ships and writes Zod's output in its place, failing on any finding, so the page only copies what
// it is given and neither Zod nor the schemas ride in its first-load JavaScript. Both modules keep
// the same exports; src/content/validate.test.ts holds that they give the same registry.
import type { z } from 'zod';
import { error, pointer, type Finding } from './findings';
import { ENTRY_SCHEMAS, packSchema, RESERVED_TYPES, type EntryType, type PackManifest } from './schema';

/** What the check makes of one file: Zod's output (a fresh object), or the findings that refuse it. */
export type Checked<T> = { ok: true; data: T } | { ok: false; findings: Finding[] };

function zodFindings(file: string, err: z.ZodError): Finding[] {
  return err.issues.map((i) =>
    error('schema', file, pointer(i.path.filter((p) => typeof p !== 'symbol')), i.message),
  );
}

/** The pack manifest (`pack.json`). */
export function checkManifest(file: string, json: unknown): Checked<PackManifest> {
  const parsed = packSchema.safeParse(json);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, findings: zodFindings(file, parsed.error) };
}

/** One entry file, by its `type`: an unknown or reserved type is refused, as is a schema error. */
export function checkEntry(
  file: string,
  json: unknown,
): Checked<{ type: EntryType; data: Record<string, unknown> }> {
  const type = (json as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !(type in ENTRY_SCHEMAS))
    return { ok: false, findings: [error('schema', file, '/type', `unknown entry type ${String(type)}`)] };
  const entryType = type as EntryType;
  if (RESERVED_TYPES.includes(entryType)) {
    const msg = `${type} entries are reserved and not loaded yet (docs/content-packs.md)`;
    return { ok: false, findings: [error('schema', file, '/type', msg)] };
  }
  const parsed = ENTRY_SCHEMAS[entryType].safeParse(json);
  if (!parsed.success) return { ok: false, findings: zodFindings(file, parsed.error) };
  return { ok: true, data: { type: entryType, data: parsed.data } };
}
