#!/usr/bin/env node
// changelog:build: turns changes/ into dist/changelog.json (docs/engineering.md).
// Each note gets the date and commit where its file first appeared in history; a note that is
// not committed yet gets null for both.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseNote } from './notes.mjs';
import { examined, git, repoRoot, treeFiles } from './lib.mjs';

const files = treeFiles().filter((f) => f.startsWith('changes/') && f.endsWith('.md'));

// One pass over history: for each added file under changes/, remember the oldest commit.
const firstSeen = new Map();
const log = git(['log', '--diff-filter=A', '--name-only', '--format=%x00%h %cI', '--', 'changes/']);
for (const block of log.split('\0').filter(Boolean)) {
  const [head, ...names] = block.split('\n').filter(Boolean);
  const [commit, date] = head.split(' ');
  for (const name of names) firstSeen.set(name, { commit, date }); // later blocks are older
}

const notes = files.map((file) => {
  const note = parseNote(file, readFileSync(path.join(repoRoot, file), 'utf8'));
  const seen = firstSeen.get(file) ?? { commit: null, date: null };
  return { id: path.basename(file, '.md'), ...note, date: seen.date, commit: seen.commit };
});
notes.sort((a, b) => (b.date ?? '9999').localeCompare(a.date ?? '9999') || b.id.localeCompare(a.id));

const outDir = path.join(repoRoot, 'dist');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'changelog.json'), `${JSON.stringify({ format: 1, notes }, null, 2)}\n`);
const players = notes.filter((n) => n.audience === 'player').length;
examined(`${notes.length} notes (${players} player, ${notes.length - players} dev) -> dist/changelog.json`);
