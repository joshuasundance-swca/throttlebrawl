#!/usr/bin/env node
// sizecheck: fails on any file over 1 MB that is not allowlisted (docs/engineering.md, npm scripts).
//   (no flag)  the whole tree: tracked files plus untracked files git does not ignore
//   --staged   staged files only (pre-commit hook)
// To allow a big file, add it to scripts/size-allowlist.json with the reason, in a normal PR.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { examined, fmtBytes, repoRoot, stagedContent, stagedFiles, treeFiles } from './lib.mjs';

const LIMIT = 1024 * 1024;
const allowlist = JSON.parse(readFileSync(path.join(repoRoot, 'scripts/size-allowlist.json'), 'utf8'));

const staged = process.argv.includes('--staged');
const files = staged ? stagedFiles() : treeFiles();
let total = 0;
const over = [];
for (const file of files) {
  const size = staged ? stagedContent(file).length : statSync(path.join(repoRoot, file)).size;
  total += size;
  if (size > LIMIT && !(file in allowlist.files)) over.push(`  ${file}  ${fmtBytes(size)}`);
}
examined(
  `${files.length} ${staged ? 'staged ' : ''}files, ${fmtBytes(total)}, limit ${fmtBytes(LIMIT)} per file`,
);
if (over.length) {
  console.error(
    'sizecheck: files over the limit (allowlist them with a reason, or move them to the asset store):',
  );
  for (const o of over) console.error(o);
  process.exit(1);
}
if (!staged && files.length === 0) {
  console.error('sizecheck examined zero files');
  process.exit(1);
}
console.log('sizecheck: clean');
