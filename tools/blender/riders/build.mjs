#!/usr/bin/env node
// Builds the rider models with headless Blender (README.md in this folder).
//
//   node tools/blender/riders/build.mjs                 every rider, twice each, into .cache/riders/
//   node tools/blender/riders/build.mjs player dial-up  some of them
//   add --pin to pin each built GLB in assets.lock.json (scripts/assets.mjs add); then
//   `npm run assets:upload` uploads them to the dataset repo and pins the commit.
//
// Each rider is built twice and the two GLBs must be byte-identical (deterministic scripts) and
// within the triangle budget. Without Blender (BLENDER_EXE unset, as on CI) it exits 0 with a note:
// the pinned GLBs are checked from the dataset instead (src/render/riders/riders.test.ts).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBlender, runBlender, SKIP_NOTE } from '../blender.mjs';
import { datasetPath, RIDERS } from './catalog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function main(argv) {
  const pin = argv.includes('--pin');
  const names = argv.filter((a) => !a.startsWith('--'));
  const rows = names.length ? names.map((n) => RIDERS.find((r) => r.id === n) ?? n) : RIDERS;
  const unknown = rows.filter((r) => typeof r === 'string');
  if (unknown.length) {
    console.error(`unknown rider(s) ${unknown.join(', ')}; known: ${RIDERS.map((r) => r.id).join(', ')}`);
    return 2;
  }
  const blender = findBlender();
  if (!blender) {
    console.log(`riders:build ${SKIP_NOTE}`);
    return 0;
  }
  const work = path.join(ROOT, '.cache/riders/build');
  mkdirSync(work, { recursive: true });
  const script = path.join(HERE, 'build_rider.py');
  let bad = 0;
  for (const row of rows) {
    const outs = ['a', 'b'].map((k) => path.join(work, `${row.id}.${k}.glb`));
    const runs = outs.map((out) => runBlender(blender, script, ['--rider', row.id, '--out', out]));
    writeFileSync(path.join(work, `${row.id}.log`), runs.map((r) => r.out).join('\n=== second build ===\n'));
    if (runs.some((r) => r.code !== 0) || outs.some((o) => !existsSync(o))) {
      console.error(`BUILD FAIL ${row.id}: see .cache/riders/build/${row.id}.log`);
      bad++;
      continue;
    }
    const [a, b] = outs.map((o) => readFileSync(o));
    const same = sha(a) === sha(b);
    const tris = Number(/RIDER_OK \S+ (\d+) tris/.exec(runs[0].out)?.[1] ?? NaN);
    const final = path.join(ROOT, '.cache/riders', `${row.id}.glb`);
    copyFileSync(outs[0], final);
    const over = !(tris <= row.maxTris);
    console.log(
      `RIDER ${row.id}: ${runs[0].secs}s, ${a.length} bytes, ${tris} tris (budget ${row.maxTris}), ` +
        `deterministic ${same}`,
    );
    if (!same || over) {
      bad++;
      continue;
    }
    if (pin) {
      const args = ['scripts/assets.mjs', 'add', final, '--as', datasetPath(row)];
      if (row.region) args.push('--region', row.region);
      args.push(
        '--note',
        `Rider model: ${row.id}, scripted in Blender by an AI agent (THIRD_PARTY_ASSETS.md)`,
      );
      const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
      process.stdout.write(res.stdout ?? '');
      if (res.status !== 0) {
        console.error(res.stderr);
        bad++;
      }
    }
  }
  console.log(`[examined] ${rows.length} riders built twice each; ${bad} with a problem`);
  return bad ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
