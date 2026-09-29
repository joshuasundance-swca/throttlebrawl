#!/usr/bin/env node
// Collects the player notes added since the last build-* tag into a release body
// (docs/engineering.md, "GitHub releases"). Writes the body to --out and prints the count; in
// GitHub Actions it also sets the step output `count`. A merge with only dev notes makes no release.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseNote } from './notes.mjs';
import { examined, git, repoRoot, splitZ } from './lib.mjs';

const { values } = parseArgs({ options: { out: { type: 'string', default: '.cache/release-notes.md' } } });
const lastTag = git(['describe', '--tags', '--match', 'build-*', '--abbrev=0'], { allowFail: true }).trim();
const added = lastTag
  ? splitZ(git(['diff', '--name-only', '-z', '--diff-filter=A', `${lastTag}..HEAD`, '--', 'changes/']))
  : splitZ(git(['ls-files', '-z', '--', 'changes/']));

const lines = [];
for (const file of added.filter((f) => f.endsWith('.md')).sort()) {
  const note = parseNote(file, readFileSync(path.join(repoRoot, file), 'utf8'));
  if (note.audience === 'player') lines.push(`- ${note.text.replace(/\s*\n\s*/g, ' ')}`);
}
const out = path.resolve(repoRoot, values.out);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, lines.length ? `## What's new\n\n${lines.join('\n')}\n` : '');
examined(`${added.length} notes added since ${lastTag || 'the start'}, ${lines.length} for players`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${lines.length}\n`);
