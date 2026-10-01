// The first-load JavaScript (docs/engineering.md, perf check): the scripts a page loads before its
// first screen are its entry and modulepreload tags, plus everything those import statically. A
// chunk reached only through `import()` is lazy: it loads later, when the game first needs it.
import path from 'node:path';

const STATIC_IMPORT = /\b(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["']([^"']+\.m?js)["']/g;
const ENTRY_TAGS = [
  /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/g,
  /<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+)["']/g,
];

/**
 * The relative specifiers a (minified) ES module imports or re-exports statically, in order.
 * @param {string} code
 * @returns {string[]}
 */
export function staticImports(code) {
  return [...code.matchAll(STATIC_IMPORT)]
    .map((m) => m[1])
    .filter((s) => s !== undefined && (s.startsWith('.') || s.startsWith('/')));
}

/**
 * The first-load scripts of a built page, as posix paths relative to the build folder.
 * `read(path)` returns a script's code by that same relative path.
 * @param {string} html
 * @param {(path: string) => string} read
 * @returns {Set<string>}
 */
export function firstLoadScripts(html, read) {
  const out = new Set();
  const queue = [];
  const add = (rel) => {
    const p = path.posix.normalize(rel.replace(/^\/+/, ''));
    if (!out.has(p)) {
      out.add(p);
      queue.push(p);
    }
  };
  for (const re of ENTRY_TAGS) for (const m of html.matchAll(re)) if (m[1]) add(m[1]);
  while (queue.length > 0) {
    const file = queue.shift();
    for (const spec of staticImports(read(file))) {
      add(spec.startsWith('/') ? spec : path.posix.join(path.posix.dirname(file), spec));
    }
  }
  return out;
}
