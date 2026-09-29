// Small helpers shared by the scripts in this folder. Node built-ins only.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Runs git in the repo root and returns stdout. Throws on a non-zero exit unless allowFail. */
export function git(args, { allowFail = false, input } = {}) {
  const res = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1 << 29,
    input,
  });
  if (res.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed:\n${res.stderr}`);
  }
  return res.status === 0 ? res.stdout : '';
}

/** Splits NUL-separated git output into a list. */
export function splitZ(out) {
  return out.split('\0').filter(Boolean);
}

/** Tracked files plus untracked files that git does not ignore, as repo-relative posix paths. */
export function treeFiles() {
  const files = new Set(splitZ(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])));
  return [...files].filter((f) => existsSync(path.join(repoRoot, f))).sort();
}

/** Files staged for the next commit (added, copied, modified or renamed). */
export function stagedFiles() {
  return splitZ(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])).sort();
}

/** Contents of a staged file (the index blob, not the working copy). */
export function stagedContent(file) {
  const res = spawnSync('git', ['show', `:${file}`], { cwd: repoRoot, maxBuffer: 1 << 29 });
  if (res.status !== 0) throw new Error(`cannot read staged ${file}`);
  return res.stdout;
}

export function readRepoFile(file) {
  return readFileSync(path.join(repoRoot, file));
}

/** True if a ref resolves. */
export function refExists(ref) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: repoRoot }).status === 0;
}

export function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** The one line every gate step prints, so `npm run check` can read what it examined. */
export function examined(summary) {
  console.log(`[examined] ${summary}`);
}
