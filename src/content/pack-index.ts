// The pack indexer (docs/content-packs.md, "Pack layout and manifest"): `pack.index.json` lists
// every file in a pack with its type, size and hash, and turns files under `assets/` into the
// asset manifest rows the architecture doc defines ({id, kind, source, path, bytes, hash, packId}).
// It is generated, never committed: tools/packs writes it at check time. The digest function is
// injected (SHA-256 from node:crypto in the tool), so this stays platform-free.
import type { AssetIndexEntry } from '../core';
import { error, type Finding } from './findings';

export interface PackIndexInput {
  /** Pack-relative path. */
  path: string;
  bytes: Uint8Array;
}

export interface PackIndexFile {
  path: string;
  /** The entry `type` for JSON entry files, `asset` under assets/, `other` otherwise. */
  type: string;
  id?: string;
  bytes: number;
  hash: string;
}

export interface PackIndex {
  formatVersion: 1;
  packId: string;
  files: PackIndexFile[];
  assets: AssetIndexEntry[];
}

/** Allowed asset formats (docs/content-packs.md, "Asset references"): nothing executable. */
const ASSET_KIND: Readonly<Record<string, (id: string) => AssetIndexEntry['kind']>> = {
  glb: () => 'mesh',
  png: (id) => (id.startsWith('textures/') ? 'texture' : 'image'),
  webp: (id) => (id.startsWith('textures/') ? 'texture' : 'image'),
  ogg: (id) => (id.startsWith('audio/music/') ? 'music-stem' : 'audio'),
  opus: (id) => (id.startsWith('audio/music/') ? 'music-stem' : 'audio'),
  json: () => 'data-page',
  bin: () => 'data-page',
};

/** A glob on asset ids: `**` spans folders, `*` stays inside one. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*' && glob.charAt(i + 1) === '*') {
      re += '.*';
      i++;
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const decoder = new TextDecoder();

/** Builds a pack's index from its raw files. Findings flag disallowed asset formats. */
export function buildPackIndex(
  files: readonly PackIndexInput[],
  sha256: (bytes: Uint8Array) => string,
): { index: PackIndex; findings: Finding[] } {
  const findings: Finding[] = [];
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifestFile = sorted.find((f) => f.path === 'pack.json');
  const manifest = manifestFile
    ? (JSON.parse(decoder.decode(manifestFile.bytes)) as Record<string, unknown>)
    : {};
  const packId = typeof manifest['id'] === 'string' ? manifest['id'] : '';
  const sources = (manifest['assetSources'] ?? {}) as {
    default?: string;
    rules?: { match: string; source: string }[];
  };
  const rules = (sources.rules ?? []).map((r) => ({ re: globToRegExp(r.match), source: r.source }));

  const out: PackIndex = { formatVersion: 1, packId, files: [], assets: [] };
  for (const f of sorted) {
    const hash = sha256(f.bytes);
    const row: PackIndexFile = { path: f.path, type: 'other', bytes: f.bytes.length, hash };
    if (f.path.startsWith('assets/')) {
      row.type = 'asset';
      const ext = /\.([a-z0-9]+)$/i.exec(f.path)?.[1]?.toLowerCase() ?? '';
      const id = f.path.slice('assets/'.length).replace(/\.[^./]+$/, '');
      const kind = ASSET_KIND[ext];
      if (!kind) {
        findings.push(
          error(
            'assets',
            f.path,
            '',
            `asset format .${ext} is not allowed (glb, png, webp, ogg, opus, json, bin)`,
          ),
        );
      } else {
        const source = (rules.find((r) => r.re.test(id))?.source ?? sources.default ?? 'baked') as
          'baked' | 'remote';
        out.assets.push({ id, kind: kind(id), source, path: f.path, bytes: f.bytes.length, hash, packId });
      }
    } else if (f.path.endsWith('.json')) {
      try {
        const json = JSON.parse(decoder.decode(f.bytes)) as { type?: unknown; id?: unknown };
        if (typeof json.type === 'string') row.type = json.type;
        if (typeof json.id === 'string') row.id = json.id;
      } catch {
        // Strict-JSON errors are reported by the schema step; the index still lists the file.
      }
    }
    out.files.push(row);
  }
  return { index: out, findings };
}
