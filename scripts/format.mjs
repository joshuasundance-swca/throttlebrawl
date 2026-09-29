#!/usr/bin/env node
// format / format:check: Prettier over every file in the tree that Prettier understands and
// .prettierignore does not exclude. Prints how many files it checked.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as prettier from 'prettier';
import { examined, repoRoot, treeFiles } from './lib.mjs';

const write = process.argv.includes('--write');
const ignorePath = path.join(repoRoot, '.prettierignore');
let checked = 0;
const unformatted = [];
for (const file of treeFiles()) {
  const abs = path.join(repoRoot, file);
  const info = await prettier.getFileInfo(abs, { ignorePath });
  if (info.ignored || !info.inferredParser) continue;
  const options = { ...(await prettier.resolveConfig(abs)), filepath: abs };
  const source = readFileSync(abs, 'utf8');
  checked++;
  if (write) {
    const out = await prettier.format(source, options);
    if (out !== source) {
      writeFileSync(abs, out);
      unformatted.push(file);
    }
  } else if (!(await prettier.check(source, options))) {
    unformatted.push(file);
  }
}
examined(
  `${checked} files ${write ? 'formatted' : 'checked'}, ${unformatted.length} ${write ? 'rewritten' : 'not formatted'}`,
);
for (const f of unformatted) console.log(`  ${f}`);
if (checked === 0) {
  console.error('format examined zero files');
  process.exit(1);
}
if (!write && unformatted.length) {
  console.error('format:check: run npm run format');
  process.exit(1);
}
