// The build validates the packs, so the page does not (lane F1, the first-load headroom; docs/
// engineering.md, perf check). The loader ran every pack file through Zod at boot: Zod and the pack
// schemas were about 28 KB of the 500 KB first-load JavaScript budget, and the phone parsed some 500
// files before the first screen. A production build now runs the same check (src/content/
// pre-parse.ts, through Vite's module runner) on every pack JSON the bundle imports and every one
// it ships as a file (the road data), writes Zod's output in the file's place, and fails on any
// finding, as the loader would have at boot. The page's loader gets validate-prebuilt.ts in place of
// validate.ts, which only copies what it is given. The registry, both content hashes and every
// replay key are unchanged (src/content/validate.test.ts). Build only: the dev server, the tests and
// packs:check run Zod as before.
import path from 'node:path';
import { runnerImport } from 'vite';

const VALIDATE = /[\\/]src[\\/]content[\\/]validate\.ts$/;
const PRE_PARSE = '/src/content/pre-parse.ts';

/** A pack JSON module the bundle imports (not a `?url` file, which ships on its own). */
function isPackJsonModule(id) {
  return /[\\/]packs[\\/].+\.json$/.test(id) && !id.includes('?');
}

/** The repo-relative posix path of a file, or null outside the repo. */
function repoPath(root, file) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

/**
 * The text a build ships for one pack file: Zod's output as JSON, or the text as it is for a file
 * that is not a pack file. Throws, naming the findings, when the schemas refuse it.
 * @param {{ preParsePackFile: Function, packFileOf: Function }} m src/content/pre-parse.ts
 * @param {string} rel repo-relative path
 * @param {string} text
 * @returns {string | null} null when the file is not a pack file (left alone)
 */
export function preParsedText(m, rel, text) {
  const file = m.packFileOf(rel);
  if (!file) return null;
  const r = m.preParsePackFile(file.path, JSON.parse(text));
  if ('findings' in r)
    throw new Error(
      `${rel} fails its schema check:\n${r.findings.map((f) => `  ${f.pointer || '/'}: ${f.message}`).join('\n')}`,
    );
  return JSON.stringify(r.data);
}

/** The Vite plugin. `root` is the repo root. */
export function preParsePacksPlugin({ root }) {
  /** @type {{ preParsePackFile: Function, packFileOf: Function } | null} */
  let m = null;
  let modules = 0;
  return {
    name: 'throttlebrawl:pre-parse-packs',
    apply: 'build',
    enforce: 'pre',
    async buildStart() {
      modules = 0;
      ({ module: m } = await runnerImport(PRE_PARSE, { configFile: false, root, logLevel: 'error' }));
    },
    async resolveId(source, importer, options) {
      if (!importer || !/^\.\.?\//.test(source) || !/validate(\.ts)?$/.test(source)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || !VALIDATE.test(resolved.id)) return resolved;
      return path.join(root, 'src', 'content', 'validate-prebuilt.ts');
    },
    // After strip-pack-notes (also `pre`, listed before this plugin): the text is still JSON.
    transform(code, id) {
      if (!m || !isPackJsonModule(id)) return null;
      const rel = repoPath(root, id);
      if (!rel) return null;
      try {
        const out = preParsedText(m, rel, code);
        if (out === null) return null;
        modules++;
        return { code: out, map: null };
      } catch (err) {
        this.error(String(err instanceof Error ? err.message : err));
      }
    },
    generateBundle(_options, bundle) {
      let files = 0;
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.json')) continue;
        const sources = (file.originalFileNames ?? []).map((f) =>
          path.isAbsolute(f) ? repoPath(root, f) : f,
        );
        const rel = sources.find((f) => f && m?.packFileOf(f));
        if (!rel || !m) continue;
        const text = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
        try {
          const out = preParsedText(m, rel, text);
          if (out !== null) {
            file.source = out;
            files++;
          }
        } catch (err) {
          this.error(String(err instanceof Error ? err.message : err));
        }
      }
      this.info?.(`pre-parsed ${modules} bundled pack files and ${files} shipped ones`);
    },
  };
}
