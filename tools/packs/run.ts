// packs:check (docs/content-packs.md, "Validation"): one command, one gate step. For every pack
// folder under packs/ it parses each file as strict JSON, validates it with the Zod schema for its
// type (the same validator the loader uses), runs the cross-file lint plus the rules other lanes
// hook in, and writes the generated pack.index.json (never committed) under .cache/packs/<id>/.
// tools/packs/check.mjs runs this module through Vite's module runner, because src/ uses
// extensionless imports that plain Node cannot resolve.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// Imported file by file rather than through src/content/index.ts, which also pulls in the
// bundled base pack (import.meta.glob, a Vite-only API this Node tool does not use).
import { formatFinding, type Finding } from '../../src/content/findings';
import { BUILT_IN_RULES, lintPacks, type PackRule } from '../../src/content/lint';
import { buildPackIndex, type PackIndex } from '../../src/content/pack-index';
import { isEntryFile, parsePack, type PackFile, type ParsedPack } from '../../src/content/parse';
import { ALL_TUNING } from './tuning';

/**
 * Modules that contribute lint rules, as repo-root paths; each exports `packRules: PackRule[]`.
 * A missing module is skipped, so a lane's hook switches on when its file lands.
 */
export const HOOK_MODULES: readonly string[] = ['/tools/road/pack-rules.ts'];

export interface CheckOptions {
  /** The repo root. */
  root: string;
  /** Folder holding the pack folders, relative to root (default `packs`). */
  packsDir?: string;
  /** Rule modules to load (default HOOK_MODULES). */
  hookModules?: readonly string[];
  /** Where to write each pack's index, relative to root; null skips writing. */
  indexDir?: string | null;
}

export interface ReportedFinding extends Finding {
  /** Repo-relative path of the file, for messages. */
  repoFile: string;
}

export interface CheckResult {
  packs: number;
  files: number;
  jsonFiles: number;
  entries: number;
  rules: string[];
  findings: ReportedFinding[];
  indexes: PackIndex[];
}

function listFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...listFiles(path.join(dir, d.name), rel));
    else if (d.isFile()) out.push(rel);
  }
  return out.sort();
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Loads the rules the hook modules export. A module that fails to load is itself a finding. */
export async function loadHookRules(
  root: string,
  modules: readonly string[],
): Promise<{ rules: PackRule[]; findings: Finding[] }> {
  const rules: PackRule[] = [];
  const findings: Finding[] = [];
  for (const mod of modules) {
    if (!existsSync(path.join(root, mod))) continue;
    try {
      const loaded = (await import(/* @vite-ignore */ mod)) as { packRules?: unknown };
      if (!Array.isArray(loaded.packRules)) throw new Error('it does not export packRules: PackRule[]');
      rules.push(...(loaded.packRules as PackRule[]));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      findings.push({
        level: 'error',
        rule: 'hooks',
        file: mod.slice(1),
        pointer: '',
        message: `rule module failed to load: ${why}`,
      });
    }
  }
  return { rules, findings };
}

export async function checkPacks(options: CheckOptions): Promise<CheckResult> {
  const { root } = options;
  const packsDir = options.packsDir ?? 'packs';
  const indexDir = options.indexDir === undefined ? '.cache/packs' : options.indexDir;
  const result: CheckResult = {
    packs: 0,
    files: 0,
    jsonFiles: 0,
    entries: 0,
    rules: [],
    findings: [],
    indexes: [],
  };
  const report = (dir: string, f: Finding) =>
    result.findings.push({ ...f, repoFile: f.file ? `${dir}/${f.file}` : dir });

  const absPacks = path.join(root, packsDir);
  if (!existsSync(absPacks)) return result;
  const parsed: { dir: string; pack: ParsedPack }[] = [];
  for (const d of readdirSync(absPacks, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = `${packsDir}/${d.name}`;
    const absDir = path.join(absPacks, d.name);
    result.packs++;
    const rels = listFiles(absDir);
    result.files += rels.length;
    const files: PackFile[] = [];
    const raw = rels.map((rel) => ({
      path: rel,
      bytes: new Uint8Array(readFileSync(path.join(absDir, rel))),
    }));
    for (const f of raw) {
      if (!f.path.endsWith('.json')) continue;
      result.jsonFiles++;
      try {
        // JSON.parse is strict: no comments, no trailing commas.
        files.push({ path: f.path, json: JSON.parse(new TextDecoder().decode(f.bytes)) });
      } catch (err) {
        report(dir, {
          level: 'error',
          rule: 'schema',
          file: f.path,
          pointer: '',
          message: `not strict JSON: ${(err as Error).message}`,
        });
      }
    }
    const { pack, findings } = parsePack(files);
    for (const f of findings) report(dir, f);
    if (pack) {
      parsed.push({ dir, pack });
      // A licence rule's licence text ships in the pack (the lint cannot see non-entry files).
      (pack.manifest.licenseRules ?? []).forEach((r, i) => {
        if (r.licenseFile === undefined || rels.includes(r.licenseFile)) return;
        report(dir, {
          level: 'error',
          rule: 'licenses',
          file: 'pack.json',
          pointer: `/licenseRules/${i}/licenseFile`,
          message: `the licence text "${r.licenseFile}" is not in the pack`,
        });
      });
      result.entries += pack.entries.length;
      if (pack.packId !== d.name) {
        report(dir, {
          level: 'error',
          rule: 'ids',
          file: 'pack.json',
          pointer: '/id',
          message: `the pack id "${pack.packId}" must equal its folder name "${d.name}"`,
        });
      }
    }
    const { index, findings: indexFindings } = buildPackIndex(
      raw.filter((f) => isEntryFile(f.path) || f.path === 'pack.json' || f.path.startsWith('assets/')),
      sha256,
    );
    for (const f of indexFindings) report(dir, f);
    result.indexes.push(index);
    if (indexDir !== null && index.packId) {
      const out = path.join(root, indexDir, index.packId);
      mkdirSync(out, { recursive: true });
      writeFileSync(path.join(out, 'pack.index.json'), `${JSON.stringify(index, null, 2)}\n`);
    }
  }

  const hooks = await loadHookRules(root, options.hookModules ?? HOOK_MODULES);
  for (const f of hooks.findings) result.findings.push({ ...f, repoFile: f.file });
  result.rules = [...BUILT_IN_RULES.map((r) => r.id), ...hooks.rules.map((r) => r.id)];
  const lint = lintPacks(
    parsed.map((p) => p.pack),
    { tuning: ALL_TUNING, rules: hooks.rules },
  );
  for (const f of lint) {
    // Findings name pack-relative files; attribute each to the pack that has that file.
    const owner = parsed.find((p) => f.file === 'pack.json' || p.pack.entries.some((e) => e.path === f.file));
    report(owner?.dir ?? packsDir, f);
  }
  return result;
}

/** The CLI: prints every finding, the examined line and a verdict; returns the exit code. */
export async function main(root: string, argv: readonly string[] = []): Promise<number> {
  const started = Date.now();
  const at = argv.indexOf('--packs');
  const packsDir = at >= 0 ? argv[at + 1] : undefined;
  // A fixture folder (--packs) is checked without writing indexes.
  const res = await checkPacks(packsDir ? { root, packsDir, indexDir: null } : { root });
  const errors = res.findings.filter((f) => f.level === 'error');
  const warnings = res.findings.filter((f) => f.level === 'warning');
  for (const f of errors) console.error(`error   ${formatFinding({ ...f, file: f.repoFile })}  [${f.rule}]`);
  for (const f of warnings) console.warn(`warning ${formatFinding({ ...f, file: f.repoFile })}  [${f.rule}]`);
  console.log(
    `[examined] ${res.files} pack files in ${res.packs} pack(s): ${res.jsonFiles} JSON, ${res.entries} entries; rules: ${res.rules.join(', ')}; ${errors.length} error(s), ${warnings.length} warning(s)`,
  );
  const indexed = res.indexes
    .map((i) => `${i.packId} (${i.files.length} files, ${i.assets.length} assets)`)
    .join(', ');
  if (indexed)
    console.log(
      `index: ${indexed}${packsDir ? ' (not written for --packs)' : ' -> .cache/packs/<id>/pack.index.json'}`,
    );
  console.log(`packs:check: ${errors.length ? 'FAILED' : 'ok'} in ${Date.now() - started} ms`);
  return errors.length ? 1 : 0;
}
