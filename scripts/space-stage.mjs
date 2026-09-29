#!/usr/bin/env node
// Stages one Space deploy (docs/engineering.md, "Deploy: game Space and staging Space"): every
// file `git ls-files` lists, plus the prebuilt dist/, plus a README.md made of the Space template's
// frontmatter followed by the repo README's body. Git-ignored paths never reach the Space because
// only tracked files are copied; dist/ is the one ignored folder added on purpose.
//
//   node scripts/space-stage.mjs --out .cache/space --readme space/README.prod.md [--layout dist|root]
//
// Layouts: `dist` (the default) keeps the source tree at the Space root and serves
// app_file: dist/index.html. `root` is the documented fallback: dist/ contents at the root with
// app_file: index.html, and the source tree under source/.
// Also writes <out>.files.txt, the sorted list of staged paths, for the read-back check.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { examined, fmtBytes, git, repoRoot, splitZ } from './lib.mjs';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: '.cache/space' },
    readme: { type: 'string' },
    layout: { type: 'string', default: process.env.SPACE_LAYOUT || 'dist' },
  },
});
if (!values.readme) throw new Error('--readme space/README.<channel>.md is required');
if (!['dist', 'root'].includes(values.layout)) throw new Error('--layout must be dist or root');
const layout = values.layout;
const out = path.resolve(repoRoot, values.out);
const dist = path.join(repoRoot, 'dist');
if (!existsSync(path.join(dist, 'index.html'))) throw new Error('dist/index.html is missing: build first');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const staged = [];
let bytes = 0;
function put(src, rel) {
  const dest = path.join(out, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  staged.push(rel);
  bytes += readFileSync(dest).length;
}

const sourcePrefix = layout === 'root' ? 'source/' : '';
const tracked = splitZ(git(['ls-files', '-z'])).filter((f) => existsSync(path.join(repoRoot, f)));
for (const file of tracked) {
  if (layout === 'dist' && file === 'README.md') continue; // replaced by the Space README below
  put(path.join(repoRoot, file), `${sourcePrefix}${file}`);
}
let distFiles = 0;
for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const abs = path.join(entry.parentPath, entry.name);
  const rel = path.relative(dist, abs).split(path.sep).join('/');
  put(abs, layout === 'root' ? rel : `dist/${rel}`);
  distFiles++;
}

// README.md: the Space frontmatter, then the repo README's body.
const template = readFileSync(path.join(repoRoot, values.readme), 'utf8');
const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(template)?.[0];
if (!frontmatter) throw new Error(`${values.readme} has no frontmatter`);
const appFile = layout === 'root' ? 'index.html' : 'dist/index.html';
const body = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const readme = `${frontmatter.replace(/^app_file:.*$/m, `app_file: ${appFile}`)}\n${body}`;
writeFileSync(path.join(out, 'README.md'), readme);
staged.push('README.md');
bytes += Buffer.byteLength(readme);

staged.sort();
writeFileSync(`${out}.files.txt`, `${staged.join('\n')}\n`);
examined(
  `${staged.length} files staged (${tracked.length} tracked, ${distFiles} from dist/, layout ${layout}, ` +
    `app_file ${appFile}), ${fmtBytes(bytes)}`,
);
