import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { checkImport, MODULE_MAP, moduleOf } from '../../scripts/module-map.mjs';

// M1 app-1 acceptance: infra-1's lint rules hold against the real src/ folders, not only against
// snippets. Every module in the map exists behind its public entry, the real tree lints clean
// under the module-map and determinism rules, and the composition-root rule holds: only
// src/main.ts imports dev/, and only main.ts and dev/ import app/.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT_RULES = new Set([
  'modules/boundaries',
  'no-restricted-imports',
  'no-restricted-properties',
  'no-restricted-globals',
  'no-restricted-syntax',
]);

function srcFiles(): string[] {
  return readdirSync(path.join(repoRoot, 'src'), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => path.relative(repoRoot, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

/** Relative import specifiers of a file, resolved to repo-relative posix paths. */
function importsOf(file: string): string[] {
  const text = readFileSync(path.join(repoRoot, file), 'utf8');
  const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']*)'/g)].map((m) => m[1] ?? '');
  return specs.map((s) =>
    path
      .relative(repoRoot, path.resolve(path.dirname(path.join(repoRoot, file)), s))
      .split(path.sep)
      .join('/'),
  );
}

describe('the lint rules against the real folders', () => {
  const files = srcFiles();

  it('has every module of the map behind its public entry', () => {
    for (const mod of Object.keys(MODULE_MAP)) {
      const entry = mod === 'main' ? 'src/main.ts' : mod === 'sim' ? 'src/sim/api.ts' : `src/${mod}/index.ts`;
      expect(existsSync(path.join(repoRoot, entry)), entry).toBe(true);
    }
    // Every sim sub-folder the architecture names has a stub index.
    for (const sub of [
      'riders',
      'traffic',
      'peds',
      'cops',
      'combat',
      'ai',
      'tumble',
      'race',
      'modifiers',
      'world',
    ]) {
      expect(existsSync(path.join(repoRoot, `src/sim/${sub}/index.ts`)), `src/sim/${sub}/index.ts`).toBe(
        true,
      );
    }
  });

  // ESLint over the whole src/ tree takes 5-9 s on the dev machine while parallel lanes build, so
  // the default 5 s test timeout failed the pre-push hook with no lint finding; the tree grows.
  it(
    'lints the real tree clean under the module-map and determinism rules',
    { timeout: 60_000 },
    async () => {
      const eslint = new ESLint({ cwd: repoRoot, overrideConfig: [tseslint.configs.disableTypeChecked] });
      const results = await eslint.lintFiles(['src']);
      const findings = results.flatMap((r) =>
        r.messages
          .filter((m) => PROJECT_RULES.has(m.ruleId ?? '') || m.fatal)
          .map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line} ${m.ruleId ?? 'fatal'} ${m.message}`),
      );
      console.log(`[examined] ${results.length} real src files against the project lint rules`);
      expect(results.length).toBe(files.length);
      expect(results.length).toBeGreaterThan(50);
      expect(findings).toEqual([]);
    },
  );

  it('keeps every relative import on a drawn edge, and app/ and dev/ behind the composition root', () => {
    let edges = 0;
    for (const file of files) {
      const from = moduleOf(file);
      for (const target of importsOf(file)) {
        const to = moduleOf(target);
        expect(checkImport(file, target), `${file} -> ${target}`).toBeNull();
        if (to === 'dev' && from !== 'dev') expect(file, `${file} imports dev/`).toBe('src/main.ts');
        if (to === 'app' && from !== 'app') expect(['main', 'dev'], `${file} imports app/`).toContain(from);
        edges++;
      }
    }
    expect(edges).toBeGreaterThan(100);
    expect(importsOf('src/main.ts').map(moduleOf).sort()).toEqual(['app', 'dev']);
  });
});
