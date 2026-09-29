#!/usr/bin/env node
// perf (docs/engineering.md, perf check). Needs a build in dist/.
//  1. The download budget from tests/perf/budget.json: JavaScript gzip size, and the whole first
//     load counted as the raw bytes of every file in dist/ (a conservative stand-in for transfer).
//  2. The Playwright perf probe (project `perf`), once dev-2 adds tests/perf/*.spec.ts.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { examined, fmtBytes, repoRoot } from './lib.mjs';

const dist = path.join(repoRoot, 'dist');
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('perf: dist/index.html is missing; run npm run build first');
  process.exit(1);
}
const budget = JSON.parse(readFileSync(path.join(repoRoot, 'tests/perf/budget.json'), 'utf8'));

let files = 0;
let raw = 0;
let jsGzip = 0;
let jsFiles = 0;
for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const buf = readFileSync(path.join(entry.parentPath, entry.name));
  files++;
  raw += buf.length;
  if (/\.m?js$/.test(entry.name)) {
    jsFiles++;
    jsGzip += gzipSync(buf, { level: 9 }).length;
  }
}
const problems = [];
if (jsGzip > budget.jsGzipKB * 1024)
  problems.push(`JavaScript ${fmtBytes(jsGzip)} gzip is over ${budget.jsGzipKB} KB`);
if (raw > budget.firstLoadKB * 1024)
  problems.push(`first load ${fmtBytes(raw)} is over ${budget.firstLoadKB} KB`);
examined(
  `${files} dist files: JavaScript ${fmtBytes(jsGzip)} gzip in ${jsFiles} files (budget ${budget.jsGzipKB} KB), ` +
    `first load ${fmtBytes(raw)} (budget ${budget.firstLoadKB} KB)`,
);
for (const p of problems) console.error(`perf: ${p}`);

const probeSpecs = existsSync(path.join(repoRoot, 'tests/perf'))
  ? readdirSync(path.join(repoRoot, 'tests/perf')).filter((f) => f.endsWith('.spec.ts'))
  : [];
let probeStatus = 0;
if (probeSpecs.length) {
  const res = spawnSync('npx', ['--no-install', 'playwright', 'test', '--project=perf'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  probeStatus = res.status ?? 1;
} else {
  console.log('perf: no perf probe specs yet (dev-2 adds tests/perf/*.spec.ts); the size budget ran alone');
}
if (problems.length || probeStatus !== 0) process.exit(1);
