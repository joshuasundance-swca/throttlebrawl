#!/usr/bin/env node
// typecheck: tsc for the app (DOM), the DOM-free sim/road config, and the Node-side files.
// Prints how many project files each config checked. The three configs run at once (each tsc is
// one thread), which cuts the wall time on the dev machine; the pre-push hook runs this.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { examined, repoRoot } from './lib.mjs';

const CONFIGS = [
  ['app', 'tsconfig.json'],
  ['sim/road (no DOM)', 'tsconfig.sim.json'],
  ['node', 'tsconfig.node.json'],
];
const tsc = path.join(repoRoot, 'node_modules/typescript/bin/tsc');
const root = repoRoot.replaceAll('\\', '/').toLowerCase();

/** Runs one tsc and resolves with its exit status and output. */
function run(config) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsc, '-p', config, '--listFiles', '--pretty', 'false'], {
      cwd: repoRoot,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const results = await Promise.all(CONFIGS.map(([, config]) => run(config)));

let failed = false;
const counts = [];
CONFIGS.forEach(([name, config], i) => {
  const res = results[i];
  const lines = res.stdout.split(/\r?\n/).filter(Boolean);
  const listed = lines.filter((l) => {
    const p = l.replaceAll('\\', '/').toLowerCase();
    return p.startsWith(root) && !p.includes('/node_modules/');
  });
  const other = lines.filter(
    (l) => !l.replaceAll('\\', '/').toLowerCase().startsWith(root) || l.includes(' error '),
  );
  const errors = lines.filter((l) => / error TS\d+/.test(l));
  counts.push(`${name} ${listed.length}`);
  if (res.status !== 0) {
    failed = true;
    console.error(`typecheck: ${config} failed`);
    for (const l of errors.length ? errors : other) console.error(`  ${l}`);
    if (res.stderr) console.error(res.stderr);
  }
  if (listed.length === 0) {
    failed = true;
    console.error(`typecheck: ${config} checked zero project files`);
  }
});
examined(`project files type-checked: ${counts.join(', ')}`);
if (failed) process.exit(1);
console.log('typecheck: 0 errors');
