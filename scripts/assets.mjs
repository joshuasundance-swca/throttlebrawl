#!/usr/bin/env node
// The dataset asset commands (scripts/dataset-assets.mjs has the why; docs/engineering.md, "Big and
// generated assets").
//   node scripts/assets.mjs fetch    download every pinned file into .cache/assets/ (sha256-checked)
//   node scripts/assets.mjs verify   check the lock against the repo and every cached file's sha256
//   node scripts/assets.mjs add <file> --as <packId>/<path> [--region <id>] [--note <text>]
//                                    copy a new or changed file into the cache and pin its hash
//   node scripts/assets.mjs upload [--message <text>]
//                                    upload the cached files the pinned revision lacks, or holds
//                                    with other bytes (compared by content, not by path), with the
//                                    signed-in `hf` CLI, then pin the commit it made
// Adding a model: `add`, then `upload`, then commit assets.lock.json in a normal PR. Two PRs that
// both bumped the lock: keep both file lists and the newer revision, then fetch and verify.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  CACHE_DIR,
  cachePath,
  cachedBytes,
  ensureCached,
  LOCK_FILE,
  lockProblems,
  readLock,
  remoteFiles,
  repoProblems,
  sha256,
  uploadPlan,
  writeLock,
} from './dataset-assets.mjs';
import { examined, fmtBytes, repoRoot } from './lib.mjs';

const [cmd, ...args] = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (msg) => {
  console.error(`assets: ${msg}`);
  process.exit(1);
};

function loadLock() {
  const { lock, problems } = readLock(repoRoot);
  if (problems.length) fail(`${LOCK_FILE}:\n  ${problems.join('\n  ')}`);
  return lock;
}

async function fetchAll() {
  const lock = loadLock();
  let downloaded = 0;
  let bytes = 0;
  for (const file of lock.files) {
    try {
      const r = await ensureCached(repoRoot, lock, file);
      if (r.downloaded) downloaded++;
      bytes += r.bytes.length;
    } catch (err) {
      fail(String(err?.message ?? err));
    }
  }
  examined(
    `${lock.files.length} pinned dataset files (${fmtBytes(bytes)}) at ${lock.repo}@${lock.revision.slice(0, 7)}: ` +
      `${downloaded} downloaded, ${lock.files.length - downloaded} already cached`,
  );
}

function verify() {
  const lock = loadLock();
  const problems = repoProblems(repoRoot, lock);
  let bytes = 0;
  for (const file of lock.files) {
    const have = cachedBytes(repoRoot, file);
    if (!have)
      problems.push(
        existsSync(cachePath(repoRoot, file.path))
          ? `${file.path}: the cached file does not match its pinned sha256 (npm run assets:fetch)`
          : `${file.path}: not in ${CACHE_DIR}/ yet (npm run assets:fetch)`,
      );
    else bytes += have.length;
  }
  examined(
    `${lock.files.length} pinned dataset files at ${lock.repo}@${lock.revision.slice(0, 7)}: ` +
      `${lock.files.length - problems.length} checked by sha256 (${fmtBytes(bytes)}), ${problems.length} problems`,
  );
  if (problems.length) fail(`\n  ${problems.join('\n  ')}`);
  console.log('assets: verified');
}

function add() {
  const src = args[0];
  const as = opt('as');
  if (!src || !as || !existsSync(src)) fail('usage: add <file> --as <packId>/<path> [--region <id>]');
  const lock = loadLock();
  const bytes = readFileSync(src);
  const entry = { path: as, bytes: bytes.length, sha256: sha256(bytes) };
  const region = opt('region');
  const note = opt('note');
  if (region) entry.region = region;
  if (note) entry.note = note;
  lock.files = lock.files.filter((f) => f.path !== as);
  lock.files.push(entry);
  const problems = [...lockProblems(lock), ...repoProblems(repoRoot, lock)];
  if (problems.length) fail(problems.join('\n  '));
  const dest = cachePath(repoRoot, as);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  writeLock(repoRoot, lock);
  console.log(`assets: pinned ${as} (${fmtBytes(bytes.length)}); run upload before you push`);
}

async function upload() {
  const lock = loadLock();
  const paths = lock.files.map((f) => f.path);
  const remote = await remoteFiles(lock, lock.revision, paths).catch((err) =>
    fail(String(err?.message ?? err)),
  );
  // A file not cached yet is fetched from the pinned revision first; that download is sha256-checked,
  // so it proves the dataset holds the pin, and gives the bytes the comparison needs.
  for (const file of lock.files)
    if (remote.has(file.path) && !cachedBytes(repoRoot, file))
      await ensureCached(repoRoot, lock, file).catch(() => undefined);
  const plan = uploadPlan(lock, remote, (f) => cachedBytes(repoRoot, f));
  if (plan.problems.length) fail(plan.problems.join('\n  '));
  if (!plan.upload.length)
    return examined(
      `${lock.files.length} pinned files compared by content with ${lock.repo}@${lock.revision.slice(0, 7)}: all already there`,
    );
  const stage = path.join(repoRoot, '.cache', 'assets-upload');
  rmSync(stage, { recursive: true, force: true });
  for (const { file } of plan.upload) {
    const dest = path.join(stage, ...file.path.split('/'));
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(cachePath(repoRoot, file.path), dest);
  }
  const message =
    opt('message') ??
    plan.upload
      .map(({ file, why }) => `${why === 'new' ? 'add' : 'update'} ${file.path}`)
      .join(', ')
      .slice(0, 200);
  const res = spawnSync(
    'hf',
    ['upload', lock.repo, stage, '.', '--repo-type', 'dataset', '--commit-message', message],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  rmSync(stage, { recursive: true, force: true });
  if (res.status !== 0) fail(`hf upload failed (is the hf CLI signed in?):\n${res.stderr}`);
  const commit = /\/commit\/([0-9a-f]{40})/.exec(`${res.stdout}\n${res.stderr}`)?.[1];
  if (!commit) fail(`hf upload printed no commit id:\n${res.stdout}`);
  // Check the new commit by content too: every pinned file there, with its pinned bytes.
  const after = await remoteFiles(lock, commit, paths).catch((err) => fail(String(err?.message ?? err)));
  const check = uploadPlan(lock, after, (f) => cachedBytes(repoRoot, f));
  const wrong = [
    ...check.problems,
    ...check.upload.map(({ file, why }) => `${file.path}: ${why === 'new' ? 'missing' : 'other bytes'}`),
  ];
  if (wrong.length)
    fail(`the new revision ${commit} does not hold the pinned files:\n  ${wrong.join('\n  ')}`);
  lock.revision = commit;
  writeLock(repoRoot, lock);
  const changed = plan.upload.filter((u) => u.why === 'changed').length;
  examined(
    `${plan.upload.length} files uploaded (${plan.upload.length - changed} new, ${changed} changed at an existing path); ` +
      `${lock.files.length} pinned files checked by content at ${commit.slice(0, 7)}`,
  );
}

const commands = { fetch: fetchAll, verify, add, upload };
if (!(cmd in commands)) fail(`unknown command "${cmd ?? ''}" (fetch, verify, add, upload)`);
await commands[cmd]();
