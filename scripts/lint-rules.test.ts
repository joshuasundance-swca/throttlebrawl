import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { MODULE_MAP } from './module-map.mjs';

// The lint-rule tests (M1 infra-1): run the real eslint.config.js on small snippets placed at
// virtual paths, and assert that the module-map and determinism rules fire (and stay quiet on
// allowed code). Type-aware parsing is switched off because the snippets are not on disk.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

const PROJECT_RULES = new Set([
  'modules/boundaries',
  'no-restricted-imports',
  'no-restricted-properties',
  'no-restricted-globals',
  'no-restricted-syntax',
]);

async function lint(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
  if (!result) throw new Error('no lint result');
  const fatal = result.messages.filter((m) => m.fatal);
  if (fatal.length) throw new Error(`snippet did not parse: ${fatal[0]?.message}`);
  return result.messages.map((m) => m.ruleId ?? '').filter((id) => PROJECT_RULES.has(id));
}

describe('lint rules fire', () => {
  it.each([
    [
      'a sim file importing three',
      'src/sim/probe.ts',
      "export { Vector3 } from 'three';",
      'no-restricted-imports',
    ],
    [
      'a road file importing three/addons',
      'src/road/probe.ts',
      "export * from 'three/addons';",
      'no-restricted-imports',
    ],
    [
      'a sim file importing a Node built-in',
      'src/sim/probe.ts',
      "export * from 'node:fs';",
      'no-restricted-imports',
    ],
    [
      'Math.random() in the sim',
      'src/sim/probe.ts',
      'export const r = Math.random();',
      'no-restricted-properties',
    ],
    [
      'Math.sin in the road',
      'src/road/probe.ts',
      'export const s = Math.sin(1);',
      'no-restricted-properties',
    ],
    [
      'Math.pow in the sim',
      'src/sim/riders/probe.ts',
      'export const p = Math.pow(2, 0.5);',
      'no-restricted-properties',
    ],
    ['the ** operator in the sim', 'src/sim/probe.ts', 'export const p = 2 ** 0.5;', 'no-restricted-syntax'],
    ['Date.now() in the sim', 'src/sim/probe.ts', 'export const t = Date.now();', 'no-restricted-properties'],
    [
      'performance.now() in the road',
      'src/road/probe.ts',
      'export const t = performance.now();',
      'no-restricted-properties',
    ],
    ['window in the sim', 'src/sim/probe.ts', 'export const w = window;', 'no-restricted-globals'],
    ['sim importing render', 'src/sim/probe.ts', "export * from '../render';", 'modules/boundaries'],
    ['road importing the sim', 'src/road/probe.ts', "export * from '../sim/api';", 'modules/boundaries'],
    ['core importing anything', 'src/core/probe.ts', "export * from '../road';", 'modules/boundaries'],
    [
      'render reaching into sim internals',
      'src/render/probe.ts',
      "export * from '../sim/riders/state';",
      'modules/boundaries',
    ],
    [
      'render importing a folder index directly',
      'src/render/probe.ts',
      "export * from '../content/schema/bike';",
      'modules/boundaries',
    ],
    [
      'ui importing dev (composition root rule)',
      'src/ui/probe.ts',
      "export * from '../dev';",
      'modules/boundaries',
    ],
    [
      'main.ts reaching into dev past its two entries (index and boot)',
      'src/main.ts',
      "export * from './dev/handle';",
      'modules/boundaries',
    ],
    [
      "ui importing dev's boot entry (still the composition root rule)",
      'src/ui/probe.ts',
      "export * from '../dev/boot';",
      'modules/boundaries',
    ],
    [
      'ui importing app (composition root rule)',
      'src/ui/probe.ts',
      "export * from '../app/index';",
      'modules/boundaries',
    ],
    [
      'a dynamic import across the map',
      'src/audio/probe.ts',
      "export const m = import('../ui');",
      'modules/boundaries',
    ],
    ['a module importing main', 'src/app/probe.ts', "export * from '../main';", 'modules/boundaries'],
  ])('%s', async (_name, file, code, rule) => {
    expect(await lint(file, code)).toContain(rule);
  });
});

describe('lint rules stay quiet on allowed code', () => {
  it.each([
    [
      'sim importing core and road',
      'src/sim/probe.ts',
      "export * from '../core';\nexport * from '../road/index';",
    ],
    ['sim sub-folders importing each other', 'src/sim/riders/probe.ts', "export * from '../world/store';"],
    ['render importing the sim contract', 'src/render/probe.ts', "export type * from '../sim/api';"],
    ['render importing three', 'src/render/probe.ts', "export { Scene } from 'three';"],
    [
      'Math.sqrt and Math.random outside the sim',
      'src/render/probe.ts',
      'export const a = Math.sqrt(2) + Math.random();',
    ],
    ['Math.sqrt in the sim', 'src/sim/probe.ts', 'export const a = Math.sqrt(2);'],
    ['main.ts importing app and dev', 'src/main.ts', "export * from './app';\nexport * from './dev/index';"],
    [
      "main.ts importing dev's boot entry and loading its index lazily",
      'src/main.ts',
      "export * from './dev/boot';\nexport const load = () => import('./dev');",
    ],
    [
      'dev importing app and the sim contract',
      'src/dev/bot/probe.ts',
      "export * from '../../app';\nexport * from '../../sim/api';",
    ],
    ['a sim unit test using Math.random', 'src/sim/probe.test.ts', 'export const r = Math.random();'],
  ])('%s', async (_name, file, code) => {
    expect(await lint(file, code)).toEqual([]);
  });
});

describe('the lint module map', () => {
  it('matches the graph in docs/architecture.md exactly', () => {
    const doc = readFileSync(path.join(repoRoot, 'docs/architecture.md'), 'utf8');
    const block = /## Module map[\s\S]*?```mermaid\n([\s\S]*?)```/.exec(doc)?.[1] ?? '';
    const docEdges = [...block.matchAll(/^\s*(\w+) --> (\w+)\s*$/gm)].map((m) => `${m[1]} -> ${m[2]}`).sort();
    const mapEdges = Object.entries(MODULE_MAP)
      .flatMap(([from, tos]) => tos.map((to) => `${from} -> ${to}`))
      .sort();
    expect(docEdges.length).toBeGreaterThan(40);
    expect(mapEdges).toEqual(docEdges);
  });
});
