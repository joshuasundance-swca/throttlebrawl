#!/usr/bin/env node
// packs:check (docs/content-packs.md, "Validation"). content-1 builds the real validator as
// tools/packs/check.mjs (or .ts); this entry runs it when it exists. Until then it checks that
// every JSON file under packs/ parses as strict JSON, which is the first thing the validator does.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { examined, repoRoot, treeFiles } from './lib.mjs';

for (const [file, flags] of [
  ['tools/packs/check.mjs', []],
  ['tools/packs/check.ts', ['--experimental-strip-types', '--no-warnings']],
]) {
  if (existsSync(path.join(repoRoot, file))) {
    const res = spawnSync(process.execPath, [...flags, file, ...process.argv.slice(2)], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    process.exit(res.status ?? 1);
  }
}

const files = treeFiles().filter((f) => f.startsWith('packs/') && f.endsWith('.json'));
const errors = [];
for (const file of files) {
  try {
    JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));
  } catch (err) {
    errors.push(`  ${file}: ${err.message}`);
  }
}
examined(`${files.length} pack files parsed as strict JSON (interim check until tools/packs/check lands)`);
for (const e of errors) console.error(e);
if (errors.length) process.exit(1);
