#!/usr/bin/env node
// notes:check: a branch must add at least one valid note under changes/ (docs/engineering.md).
// It compares with the merge base of NOTES_BASE (default origin/main), counting committed,
// staged and untracked new notes, so it works before and after committing. On a push to main
// there is no branch to compare, so it is skipped.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NOTE_NAME, parseNote } from './notes.mjs';
import { examined, git, refExists, repoRoot, splitZ } from './lib.mjs';

if (process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main') {
  examined('0 notes: skipped on push to main (the squash commit already carries the note)');
  process.exit(0);
}

const base = process.env.NOTES_BASE ?? 'origin/main';
if (!refExists(base)) {
  console.error(`notes:check: cannot find ${base}; run git fetch origin`);
  process.exit(1);
}
const mergeBase = git(['merge-base', base, 'HEAD']).trim();
const added = new Set([
  ...splitZ(git(['diff', '--name-only', '-z', '--diff-filter=A', mergeBase, '--', 'changes/'])),
  ...splitZ(git(['ls-files', '-z', '--others', '--exclude-standard', '--', 'changes/'])),
]);

const errors = [];
let valid = 0;
for (const file of [...added].sort()) {
  if (!file.endsWith('.md')) continue;
  if (!NOTE_NAME.test(file)) {
    errors.push(`${file}: name it changes/<yyyy-mm-dd>-<slug>.md (lowercase slug)`);
    continue;
  }
  try {
    parseNote(file, readFileSync(path.join(repoRoot, file), 'utf8'));
    valid++;
  } catch (err) {
    errors.push(err.message);
  }
}
examined(
  `${added.size} new file(s) under changes/ since ${base} (${mergeBase.slice(0, 7)}), ${valid} valid note(s)`,
);
for (const e of errors) console.error(`  ${e}`);
if (errors.length || valid === 0) {
  if (valid === 0)
    console.error('notes:check: add a plain-words note under changes/ (see docs/engineering.md)');
  process.exit(1);
}
console.log('notes:check: ok');
