#!/usr/bin/env node
// Leak scan (docs/engineering.md, "Pre-commit hooks and leak scan").
//
//   --staged              staged files (pre-commit hook; `npm run leakscan`)
//   --all                 the whole tree, plus the author/committer email of every commit in
//                         LEAKSCAN_IDENTITY_RANGE (default origin/main..HEAD) (`npm run leakscan:all`)
//   --commit-msg <file>   a commit message plus the author/committer of the commit being made
//   --history [range]     every commit's metadata and added lines, `git log -p` (default: all of HEAD)
//
// Generic rules live in leak-rules.mjs. The maintainer's private denylist is read from user-level
// git config (throttlebrawl.leakscan.deny) and is never printed. Findings are masked.
import { readFileSync } from 'node:fs';
import { lintSource } from '@secretlint/core';
import { creator as presetRecommend } from '@secretlint/secretlint-rule-preset-recommend';
import { identEmail, isAllowedEmail, scanFileName, scanText } from './leak-rules.mjs';
import {
  examined,
  fmtBytes,
  git,
  looksBinary,
  readRepoFile,
  refExists,
  stagedContent,
  stagedFiles,
  treeFiles,
} from './lib.mjs';

const secretlintConfig = {
  rules: [{ id: '@secretlint/secretlint-rule-preset-recommend', rule: presetRecommend }],
};

function denylist() {
  const out = git(['config', '--get-all', 'throttlebrawl.leakscan.deny'], { allowFail: true });
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new RegExp(s, 'i'));
}

async function scanContent(file, text, deny) {
  const findings = scanText(text, { deny });
  const res = await lintSource({
    source: { filePath: file, content: text, contentType: 'text' },
    options: { config: secretlintConfig, maskSecrets: true, noPhysicFilePath: true },
  });
  for (const m of res.messages) {
    findings.push({ rule: `secretlint:${m.ruleId}`, line: m.loc.start.line, excerpt: '' });
  }
  return findings;
}

function report(where, findings, sink) {
  for (const f of findings) {
    sink.push(`  ${where}${f.line ? `:${f.line}` : ''}  ${f.rule}${f.excerpt ? `  ${f.excerpt}` : ''}`);
  }
}

async function scanFiles(files, read, deny, sink) {
  let bytes = 0;
  for (const file of files) {
    const buf = read(file);
    bytes += buf.length;
    report(file, scanFileName(file), sink);
    if (looksBinary(buf)) continue;
    report(file, await scanContent(file, buf.toString('utf8'), deny), sink);
  }
  return bytes;
}

function identityRange() {
  if (process.env.LEAKSCAN_IDENTITY_RANGE) return process.env.LEAKSCAN_IDENTITY_RANGE;
  if (refExists('origin/main')) return 'origin/main..HEAD';
  return '';
}

function checkIdentities(range, sink) {
  if (!range) return 0;
  const out = git(['log', '--format=%H %ae %ce', ...range.split(/\s+/)]);
  const rows = out.split('\n').filter(Boolean);
  for (const row of rows) {
    const [sha, ae = '', ce = ''] = row.split(' ');
    // Allowed (no-reply) addresses are printed so the check shows what it saw; others are not.
    const shown = (email) => (isAllowedEmail(email) ? email : '(not shown: not on the allowlist)');
    console.log(`  commit ${sha.slice(0, 7)}  author ${shown(ae)}  committer ${shown(ce)}`);
    if (!isAllowedEmail(ae)) sink.push(`  commit ${sha.slice(0, 7)}  author email is not on the allowlist`);
    if (!isAllowedEmail(ce))
      sink.push(`  commit ${sha.slice(0, 7)}  committer email is not on the allowlist`);
  }
  return rows.length;
}

async function history(range, deny, sink) {
  const out = git([
    'log',
    '-p',
    '--no-color',
    '--no-ext-diff',
    '--format=%x00%H%x01%ae%x01%ce%x01%B%x02',
    range,
  ]);
  const commits = out.split('\0').filter(Boolean);
  let lines = 0;
  for (const chunk of commits) {
    const [head, diff = ''] = chunk.split('\x02');
    const [sha, ae, ce, message = ''] = head.split('\x01');
    const short = sha.slice(0, 7);
    if (!isAllowedEmail(ae)) sink.push(`  commit ${short}  author email is not on the allowlist`);
    if (!isAllowedEmail(ce)) sink.push(`  commit ${short}  committer email is not on the allowlist`);
    report(`commit ${short} message`, await scanContent('message', message, deny), sink);
    // Group added lines by file.
    let file = '';
    const added = new Map();
    for (const l of diff.split('\n')) {
      if (l.startsWith('+++ ')) {
        file = l.replace(/^\+\+\+ (?:b\/)?/, '');
        report(`commit ${short} ${file}`, scanFileName(file), sink);
      } else if (l.startsWith('+') && file) {
        added.set(file, `${added.get(file) ?? ''}${l.slice(1)}\n`);
        lines++;
      }
    }
    for (const [f, text] of added)
      report(`commit ${short} ${f} (added lines)`, await scanContent(f, text, deny), sink);
  }
  return { commits: commits.length, lines };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] ?? '--staged';
  const deny = denylist();
  const sink = [];
  const privateNote = deny.length ? `, ${deny.length} private rules` : ', no private rules (generic only)';

  if (mode === '--all') {
    const files = treeFiles();
    const bytes = await scanFiles(files, readRepoFile, deny, sink);
    const range = identityRange();
    const commits = checkIdentities(range, sink);
    examined(
      `${files.length} files, ${fmtBytes(bytes)}; ${commits} commit identities (${range || 'no range'})${privateNote}`,
    );
    if (files.length === 0) sink.push('  the tree scan examined zero files');
  } else if (mode === '--staged') {
    const files = stagedFiles();
    const bytes = await scanFiles(files, stagedContent, deny, sink);
    examined(`${files.length} staged files, ${fmtBytes(bytes)}${privateNote}`);
  } else if (mode === '--commit-msg') {
    const file = args[1];
    if (!file) throw new Error('--commit-msg needs the message file path');
    const text = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => !l.startsWith('#'))
      .join('\n');
    report('commit message', await scanContent('COMMIT_EDITMSG', text, deny), sink);
    for (const who of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
      const email = identEmail(git(['var', who]));
      if (!isAllowedEmail(email)) {
        sink.push(
          `  ${who === 'GIT_AUTHOR_IDENT' ? 'author' : 'committer'} email is not on the allowlist` +
            ' (use your GitHub no-reply address; see docs/engineering.md#commit-identity)',
        );
      }
    }
    examined(`1 commit message, 2 identities${privateNote}`);
  } else if (mode === '--history') {
    const { commits, lines } = await history(args[1] ?? 'HEAD', deny, sink);
    examined(`${commits} commits, ${lines} added lines${privateNote}`);
    if (commits === 0) sink.push('  the history scan examined zero commits');
  } else {
    throw new Error(`unknown mode ${mode}`);
  }

  if (sink.length) {
    console.error(`leak scan: ${sink.length} finding(s):`);
    for (const s of sink) console.error(s);
    process.exit(1);
  }
  console.log('leak scan: clean');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
