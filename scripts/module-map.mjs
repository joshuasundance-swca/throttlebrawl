// The module map from docs/architecture.md ("Module map"), as the enforced import allow-list.
// This file is a contract: change it only in a small contract PR that also updates the graph in
// docs/architecture.md.
import path from 'node:path';

/** Each src/ module and the modules it may import. `main` is src/main.ts, the composition root. */
export const MODULE_MAP = {
  core: [],
  road: ['core'],
  sim: ['core', 'road'],
  content: ['core'],
  tuning: ['core'],
  input: ['core', 'sim'],
  assets: ['core'],
  stream: ['road', 'assets'],
  render: ['sim', 'road', 'assets', 'content'],
  camera: ['sim', 'road'],
  audio: ['sim', 'assets', 'content'],
  ui: ['sim', 'content', 'save', 'tuning', 'input', 'career'],
  career: ['core', 'sim', 'content', 'save'],
  save: ['core'],
  replay: ['sim'],
  platform: ['core'],
  app: [
    'sim',
    'render',
    'camera',
    'audio',
    'ui',
    'input',
    'replay',
    'stream',
    'content',
    'tuning',
    'save',
    'assets',
    'career',
    'platform',
  ],
  dev: ['app', 'sim'],
  main: ['app', 'dev'],
};

/**
 * The files another module may import: the module's index.ts, and for sim its public contract
 * api.ts ("every --> sim edge means imports src/sim/api.ts"). dev has two: index.ts, which
 * src/main.ts loads lazily (off the first-load JavaScript budget), and boot.ts, the small part
 * that loads with the first screen (the test flag and the error capture). Only main imports dev.
 */
const PUBLIC_ENTRIES = { sim: ['api'], dev: ['index', 'boot'] };

/** Which module a repo-relative posix path belongs to, or null if it is outside src/. */
export function moduleOf(relPath) {
  if (/^src\/main(?:\.[cm]?[jt]s)?$/.test(relPath)) return 'main';
  const inFolder = /^src\/([^/]+)\//.exec(relPath);
  if (inFolder) return inFolder[1];
  // A bare folder import such as '../render' resolves to src/render; other files directly in
  // src/ (such as vite-env.d.ts) belong to no module.
  const folder = /^src\/([^/.]+)$/.exec(relPath);
  return folder ? folder[1] : null;
}

/** Checks one import. Returns an error message, or null when the import is allowed. */
export function checkImport(fromRel, targetRel) {
  const from = moduleOf(fromRel);
  const to = moduleOf(targetRel);
  if (!from || !to || from === to) return null;
  if (!(from in MODULE_MAP)) return `src/${from}/ is not in the module map (scripts/module-map.mjs)`;
  if (!(to in MODULE_MAP)) return `src/${to}/ is not in the module map (scripts/module-map.mjs)`;
  if (!MODULE_MAP[from].includes(to)) {
    return `${from} may not import ${to} (docs/architecture.md module map; ${from} may import: ${
      MODULE_MAP[from].join(', ') || 'nothing in the project'
    })`;
  }
  const inside = targetRel.slice(`src/${to}/`.length).replace(/\.(?:[cm]?[jt]s|d\.ts)$/, '');
  const entries = PUBLIC_ENTRIES[to] ?? ['index'];
  if (targetRel === `src/${to}` || entries.includes(inside)) return null;
  return `import ${to} through its public entry (src/${to}/${entries[0]}.ts), not ${targetRel}`;
}

function posixRel(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

/** ESLint rule: every relative import between src/ modules must be an edge of MODULE_MAP. */
const moduleBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce the module map in docs/architecture.md' },
    schema: [],
  },
  create(context) {
    const root = context.cwd;
    const fromRel = posixRel(root, context.filename);
    if (!moduleOf(fromRel)) return {};
    function check(node, source) {
      if (!source || typeof source.value !== 'string') return;
      const spec = source.value;
      if (!spec.startsWith('.')) return; // package imports are handled by no-restricted-imports
      const target = posixRel(root, path.resolve(path.dirname(context.filename), spec));
      const message = checkImport(fromRel, target);
      if (message) context.report({ node, message });
    }
    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
    };
  },
};

export const modulesPlugin = { rules: { boundaries: moduleBoundaries } };
