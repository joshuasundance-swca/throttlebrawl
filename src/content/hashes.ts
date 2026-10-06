// The two content hashes (docs/architecture.md, "Content registry"; docs/content-packs.md, "Which
// fields count as sim-facing"). The sim content hash covers only the sim-facing fields of each
// loaded entry, using the per-type lists in schema/, and goes into every replay key; the full
// content hash covers everything loaded, including the pack manifests. Both are computed over the
// frozen registry, so vetoed entries and items (which the loader drops) never count.
import { FNV_OFFSET, fnvString, hashHex } from '../core';
import type { EntryType } from './schema';
import { SIM_EXCLUDED_FIELDS } from './schema/tables';

type Json = Record<string, unknown>;

export interface ContentHashes {
  sim: string;
  full: string;
}

/** Folds a JSON value into an FNV-1a hash with sorted keys, skipping top-level `skip` fields. */
function fold(h: number, value: unknown, skip: ReadonlySet<string> | null = null): number {
  if (Array.isArray(value)) {
    let out = fnvString(h, '[');
    for (const v of value) out = fnvString(fold(out, v), ',');
    return fnvString(out, ']');
  }
  if (value !== null && typeof value === 'object') {
    let out = fnvString(h, '{');
    for (const key of Object.keys(value).sort()) {
      if (skip?.has(key)) continue;
      out = fnvString(fold(fnvString(out, JSON.stringify(key)), (value as Json)[key]), ',');
    }
    return fnvString(out, '}');
  }
  // JSON.stringify prints the shortest round-trip form of a number, so equal doubles fold equally.
  return fnvString(h, JSON.stringify(value) ?? 'null');
}

export interface HashInput {
  /** The loaded pack manifests (full hash only, except `defaults.tuning`, which picks sim values). */
  manifests: readonly object[];
  /** Loaded entries by type, each keyed by qualified id. */
  tables: ReadonlyMap<EntryType, Readonly<Record<string, unknown>>>;
}

/** Computes both hashes; the order entries or packs arrive in does not matter. */
export function computeContentHashes(input: HashInput): ContentHashes {
  let sim = FNV_OFFSET;
  let full = FNV_OFFSET;
  const manifests = ([...input.manifests] as Json[]).sort((a, b) =>
    String(a['id']) < String(b['id']) ? -1 : 1,
  );
  for (const m of manifests) {
    full = fold(fnvString(full, 'pack'), m);
    const defaults = m['defaults'] as Json | undefined;
    sim = fold(fnvString(fnvString(sim, 'pack'), String(m['id'])), defaults?.['tuning'] ?? null);
  }
  for (const type of [...input.tables.keys()].sort()) {
    const table = input.tables.get(type) ?? {};
    const excluded = SIM_EXCLUDED_FIELDS[type];
    const skip = excluded ? new Set(excluded) : null;
    for (const id of Object.keys(table).sort()) {
      full = fold(fnvString(fnvString(full, type), id), table[id]);
      if (skip) sim = fold(fnvString(fnvString(sim, type), id), table[id], skip);
    }
  }
  return { sim: hashHex(sim), full: hashHex(full) };
}
