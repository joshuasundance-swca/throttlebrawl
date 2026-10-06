// Parsing one pack (docs/content-packs.md, "Validation", step 1): every entry file is validated
// with the Zod schema for its `type` (validate.ts), and the checks a single file can make on its own
// path run here (filename equals id, the folder matches the type, one id per type). The registry and
// the packs:check tool both start from this, so the loader and the linter share one validator. A
// production build swaps validate.ts for validate-prebuilt.ts: the build ran the schemas already.
import { error, type Finding } from './findings';
import type { EntryType, PackManifest } from './schema';
import * as validate from './validate';

/** The pack format versions this build reads (docs/content-packs.md, "Versioning and migration"). */
export const FORMAT_VERSION = 1;

/** One raw pack file: its pack-relative path (`bikes/rustbucket-400.json`) and parsed JSON. */
export interface PackFile {
  path: string;
  json: unknown;
}

export type EntryStatus = 'live' | 'vetoed' | 'draft';

/** One schema-valid entry. `data` is Zod's output: a fresh object, safe to trim before freezing. */
export interface ParsedEntry {
  packId: string;
  path: string;
  type: EntryType;
  id: string;
  status: EntryStatus;
  data: Record<string, unknown>;
}

export interface ParsedPack {
  packId: string;
  manifest: PackManifest;
  entries: ParsedEntry[];
}

/** The folder each type lives in (docs/content-packs.md, "Folder layout"). */
const FOLDER_TYPE: Readonly<Record<string, EntryType>> = {
  bikes: 'bike',
  riders: 'rider',
  crews: 'crew',
  weapons: 'weapon',
  events: 'event',
  careers: 'career',
  traffic: 'traffic-type',
  modifiers: 'event-modifier',
  stations: 'station',
  barks: 'bark-set',
  hud: 'hud-layout',
  tuning: 'tuning-preset',
  patches: 'patch',
  networks: 'road-network',
  roads: 'road',
  routes: 'route',
};

/** Pack files that are not entries: assets (data files included) and licence texts. */
export function isEntryFile(path: string): boolean {
  return path.endsWith('.json') && !/^(?:assets|LICENSES)\//.test(path) && path !== 'pack.index.json';
}

/** The type a file's folder implies, or null when the folder is not a typed one. */
function folderType(path: string): { type: EntryType; folder: string } | null {
  const parts = path.split('/');
  if (parts[0] === 'regions') {
    if (parts.length === 3 && parts[2] === 'region.json') return { type: 'region', folder: 'regions/<id>/' };
    const folder = parts[2] ?? '';
    const type = parts.length > 3 ? FOLDER_TYPE[folder] : undefined;
    return type ? { type, folder: `regions/<region>/${folder}/` } : null;
  }
  const folder = parts[0] ?? '';
  const type = parts.length > 1 ? FOLDER_TYPE[folder] : undefined;
  return type ? { type, folder: `${folder}/` } : null;
}

/** The folder a type belongs in, for messages. */
function folderOf(type: EntryType): string {
  if (type === 'region') return 'regions/<id>/region.json';
  const folder = Object.keys(FOLDER_TYPE).find((k) => FOLDER_TYPE[k] === type) ?? '?';
  return ['networks', 'roads', 'routes'].includes(folder) ? `regions/<region>/${folder}/` : `${folder}/`;
}

/** The schema check parsePack runs: validate.ts, or a production build's validate-prebuilt.ts. */
export type SchemaCheck = Pick<typeof validate, 'checkManifest' | 'checkEntry'>;

/**
 * Validates one pack's files. Returns the parsed pack (null when the manifest is missing, invalid
 * or in a format this build cannot read, since the pack is then refused whole) and the findings.
 */
export function parsePack(files: readonly PackFile[]): { pack: ParsedPack | null; findings: Finding[] } {
  return parsePackWith(files, validate);
}

/** parsePack with a given schema check (the tests compare validate.ts with validate-prebuilt.ts). */
export function parsePackWith(
  files: readonly PackFile[],
  check: SchemaCheck,
): { pack: ParsedPack | null; findings: Finding[] } {
  const findings: Finding[] = [];
  const manifestFile = files.find((f) => f.path === 'pack.json');
  if (!manifestFile)
    return { pack: null, findings: [error('schema', 'pack.json', '', 'pack.json is missing')] };
  const manifest = check.checkManifest('pack.json', manifestFile.json);
  if (!manifest.ok) return { pack: null, findings: manifest.findings };
  const packId = manifest.data.id;
  if (manifest.data.formatVersion !== FORMAT_VERSION) {
    const msg = `pack ${packId} needs format ${manifest.data.formatVersion}; this game reads format ${FORMAT_VERSION} (this pack needs a newer game version)`;
    return { pack: null, findings: [error('schema', 'pack.json', '/formatVersion', msg)] };
  }

  const entries: ParsedEntry[] = [];
  const seen = new Map<string, string>();
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (file.path === 'pack.json' || !isEntryFile(file.path)) continue;
    const checked = check.checkEntry(file.path, file.json);
    if (!checked.ok) {
      findings.push(...checked.findings);
      continue;
    }
    const entryType = checked.data.type;
    const type: string = entryType;
    const data = checked.data.data as Record<string, unknown> & {
      id: string;
      meta?: { status?: EntryStatus };
    };
    const id = data.id;

    // The filename equals the id; a region file is `regions/<id>/region.json`.
    const parts = file.path.replace(/\.json$/, '').split('/');
    const named = entryType === 'region' ? parts[parts.length - 2] : parts[parts.length - 1];
    if (named !== id) findings.push(error('ids', file.path, '/id', `filename must equal the id (${id})`));
    const folder = folderType(file.path);
    if (folder && folder.type !== entryType) {
      findings.push(
        error(
          'ids',
          file.path,
          '/type',
          `a ${type} entry belongs in ${folderOf(entryType)}, not ${folder.folder}`,
        ),
      );
    }
    const key = `${type}:${id}`;
    const first = seen.get(key);
    if (first) findings.push(error('ids', file.path, '/id', `duplicate ${type} id ${id} (also in ${first})`));
    else seen.set(key, file.path);

    entries.push({ packId, path: file.path, type: entryType, id, status: data.meta?.status ?? 'live', data });
  }
  return { pack: { packId, manifest: manifest.data, entries }, findings };
}
