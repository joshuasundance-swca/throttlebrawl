// The build's pre-parse of one pack file (lane F1, the first-load headroom): what a production
// build ships in a pack file's place, so the page's loader needs no Zod (validate-prebuilt.ts).
// scripts/pre-parse-packs.mjs runs it, through Vite's module runner, on every pack JSON the bundle
// imports and every one it ships as a file (road data); src/content/validate.test.ts runs it on every
// pack on disk and holds that the registry built from its output equals the one built today.
import type { Finding } from './findings';
import { isEntryFile } from './parse';
import { checkEntry, checkManifest } from './validate';

/**
 * A pack file as the loader would see it after the schema check: Zod's output for the manifest and
 * for every entry, the file as it is for anything else (assets' data, the index), or the findings
 * that refuse it (the build then fails, as the loader would at boot).
 * `path` is pack-relative (`bikes/rustbucket-400.json`, `regions/florida-keys/roads/x.json`).
 */
export function preParsePackFile(path: string, json: unknown): { data: unknown } | { findings: Finding[] } {
  if (path === 'pack.json') {
    const r = checkManifest(path, json);
    return r.ok ? { data: r.data } : { findings: r.findings };
  }
  if (!isEntryFile(path)) return { data: json };
  const r = checkEntry(path, json);
  return r.ok ? { data: r.data.data } : { findings: r.findings };
}

/**
 * The pack and pack-relative path of a repo-relative file under `packs/<pack>/` (`/packs/...` as a
 * glob key, or with Windows separators), or null for any other file.
 */
export function packFileOf(repoPath: string): { packId: string; path: string } | null {
  const m = /^\/?packs\/([^/]+)\/(.+)$/.exec(repoPath.replace(/\\/g, '/'));
  return m ? { packId: m[1] as string, path: m[2] as string } : null;
}
