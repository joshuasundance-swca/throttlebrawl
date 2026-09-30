#!/usr/bin/env node
// The road compiler's command line (M1 road-1): compiles tools/road/tracks/<network>.ts with
// src/road/compile.ts and writes the baked network, road and route files into the pack
// (docs/content-packs.md, "Road networks, roads and routes"). The compiler is TypeScript under the
// determinism rules, so this loads it through Vite's module runner. Output is Prettier-formatted,
// so a re-bake of an unchanged source changes nothing. tools/road/keys-m1.test.ts fails when the
// pack files and a fresh compile disagree.
//
//   node tools/road/bake.mjs            bake every track
//   node tools/road/bake.mjs --check    exit 1 if a baked file is stale (writes nothing)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { runnerImport } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const check = process.argv.includes('--check');
const opts = { root, configFile: false, logLevel: 'silent' };

/** Every track source, and the region folder it bakes into. */
const TRACKS = [{ source: 'tools/road/tracks/keys-m1.ts', exportName: 'KEYS_M1' }];

const { module: compiler } = await runnerImport(path.join(root, 'src/road/compile.ts'), opts);
let written = 0;
let stale = 0;
let files = 0;
for (const t of TRACKS) {
  const { module: mod } = await runnerImport(path.join(root, t.source), opts);
  const src = mod[t.exportName];
  const out = compiler.compileTrack(src);
  const region = path.join(root, 'packs/base/regions', src.network.region);
  const targets = [
    ['networks', out.network],
    ...out.roads.map((r) => ['roads', r]),
    ...out.routes.map((r) => ['routes', r]),
  ];
  for (const [dir, value] of targets) {
    const file = path.join(region, dir, `${value.id}.json`);
    const text = await prettier.format(JSON.stringify(value), {
      ...(await prettier.resolveConfig(file)),
      filepath: file,
    });
    files++;
    const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (before === text) continue;
    if (check) {
      console.error(`stale: ${path.relative(root, file)}`);
      stale++;
      continue;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    written++;
  }
}
if (check) {
  console.log(`[examined] ${files} baked road files, ${stale} stale`);
  process.exit(stale > 0 ? 1 : 0);
}
console.log(`baked ${files} road files (${written} changed)`);
