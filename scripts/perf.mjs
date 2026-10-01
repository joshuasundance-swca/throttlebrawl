#!/usr/bin/env node
// perf (docs/engineering.md, perf check). Needs a build in dist/.
//  1. The download budget from tests/perf/budget.json: the first-load JavaScript's gzip size (the
//     entry and its static imports, first-load.mjs; lazy `import()` chunks are listed apart, they
//     load later and on demand), and the whole first load counted as the raw bytes of every file in
//     dist/, lazy chunks included (a conservative stand-in for transfer).
//  2. The Playwright perf probe (project `perf`), once dev-2 adds tests/perf/*.spec.ts.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { firstLoadScripts } from './first-load.mjs';
import { examined, fmtBytes, repoRoot } from './lib.mjs';

const dist = path.join(repoRoot, 'dist');
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('perf: dist/index.html is missing; run npm run build first');
  process.exit(1);
}
const budget = JSON.parse(readFileSync(path.join(repoRoot, 'tests/perf/budget.json'), 'utf8'));

const toPosix = (p) => p.split(path.sep).join('/');
const first = firstLoadScripts(readFileSync(path.join(dist, 'index.html'), 'utf8'), (rel) =>
  readFileSync(path.join(dist, rel), 'utf8'),
);
let files = 0;
let raw = 0;
let jsGzip = 0;
let jsFiles = 0;
const lazy = [];
for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const buf = readFileSync(path.join(entry.parentPath, entry.name));
  files++;
  raw += buf.length;
  if (/\.m?js$/.test(entry.name)) {
    const gz = gzipSync(buf, { level: 9 }).length;
    const rel = toPosix(path.relative(dist, path.join(entry.parentPath, entry.name)));
    if (first.has(rel)) {
      jsFiles++;
      jsGzip += gz;
    } else lazy.push({ rel, gz });
  }
}
const lazyGzip = lazy.reduce((n, c) => n + c.gz, 0);
const problems = [];
if (jsFiles === 0) problems.push('found no first-load JavaScript in dist/index.html');
if (jsGzip > budget.jsGzipKB * 1024)
  problems.push(`first-load JavaScript ${fmtBytes(jsGzip)} gzip is over ${budget.jsGzipKB} KB`);
if (raw > budget.firstLoadKB * 1024)
  problems.push(`first load ${fmtBytes(raw)} is over ${budget.firstLoadKB} KB`);
for (const c of lazy.sort((a, b) => b.gz - a.gz))
  console.log(`perf: lazy chunk ${c.rel} ${fmtBytes(c.gz)} gzip`);
examined(
  `${files} dist files: first-load JavaScript ${fmtBytes(jsGzip)} gzip in ${jsFiles} files ` +
    `(budget ${budget.jsGzipKB} KB), lazy JavaScript ${fmtBytes(lazyGzip)} gzip in ${lazy.length} chunks, ` +
    `first load ${fmtBytes(raw)} (budget ${budget.firstLoadKB} KB)`,
);
for (const p of problems) console.error(`perf: ${p}`);

const probeSpecs = existsSync(path.join(repoRoot, 'tests/perf'))
  ? readdirSync(path.join(repoRoot, 'tests/perf')).filter((f) => f.endsWith('.spec.ts'))
  : [];
let probeStatus = 0;
if (probeSpecs.length) {
  // One probe at a time: each times frames under 4x CPU throttling with software WebGL, so two
  // probes running side by side (Playwright's default on CI is 2 workers) slow each other down and
  // the frame times measure the contention, not the game.
  const res = spawnSync('npx', ['--no-install', 'playwright', 'test', '--project=perf', '--workers=1'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  probeStatus = res.status ?? 1;
} else {
  console.log('perf: no perf probe specs yet (dev-2 adds tests/perf/*.spec.ts); the size budget ran alone');
}
if (problems.length || probeStatus !== 0) process.exit(1);
