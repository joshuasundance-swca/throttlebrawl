#!/usr/bin/env node
// Builds catalog props with headless Blender. Legacy rows write packs/<pack>/assets/;
// dataset rows leave candidates under .cache/blender/build/ for explicit publication.
//
//   node tools/blender/build.mjs              build every prop, twice each, and commit-ready copy
//   node tools/blender/build.mjs boat palms   build some of them
//   node tools/blender/build.mjs --check      rebuild into .cache only and compare with the
//                                             canonical GLBs byte for byte (sources unchanged)
//
// Each prop is built twice; the two GLBs must be byte-identical (deterministic scripts), and the
// first is scored (score.mjs) before it is copied into the pack. Without Blender (BLENDER_EXE
// unset, as on CI) it prints a note and exits 0.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBlender, runBlender, SKIP_NOTE } from './blender.mjs';
import { glbPath, PROPS } from './catalog.mjs';
import { repoRoot, scoreGlb } from './score.mjs';
import { optimizeFile } from './optimize.mjs';
import { propFile, propSource, propTarget } from './prop-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Score both deterministic rebuilds and select the existing storage-specific output policy. */
export async function acceptBuild(root, prop, outs, { check = false, fetchFn = fetch } = {}) {
  const dataset = prop.storage === 'dataset';
  const source = dataset && !check ? propTarget(root, prop) : propSource(root, prop);
  const [a, b] = outs.map((out) => optimizeFile(out, prop));
  const same = sha(a) === sha(b);
  const score = scoreGlb(a, prop);
  let published;
  if (check && dataset) published = (await propFile(root, prop, fetchFn)).bytes;
  else if (!dataset && existsSync(source.file)) published = readFileSync(source.file);
  const matches = !!published && [a, b].every((bytes) => sha(bytes) === sha(published));
  let note;
  if (check) note = matches ? 'matches the canonical GLB' : 'DIFFERS from the canonical GLB';
  else if (!same || score.summary.failed.length) note = 'not written: determinism or score failed';
  else if (dataset)
    note = `candidate at ${path.relative(root, outs[0]).split(path.sep).join('/')}; publish explicitly with assets:add and assets:upload`;
  else if (matches) note = 'unchanged';
  else {
    mkdirSync(path.dirname(source.file), { recursive: true });
    copyFileSync(outs[0], source.file);
    note = `written to ${glbPath(prop)}`;
  }
  return { same, score, matches, note, bytes: a.length };
}

async function main(argv) {
  const check = argv.includes('--check');
  const names = argv.filter((a) => !a.startsWith('--'));
  const props = names.length ? names.map((n) => PROPS.find((p) => p.name === n) ?? n) : PROPS;
  const unknown = props.filter((p) => typeof p === 'string');
  if (unknown.length) {
    console.error(`unknown prop(s) ${unknown.join(', ')}; known: ${PROPS.map((p) => p.name).join(', ')}`);
    return 2;
  }
  const blender = findBlender();
  if (!blender) {
    console.log(`asset:${check ? 'check' : 'build'} ${SKIP_NOTE}`);
    return 0;
  }
  const work = path.join(repoRoot, '.cache/blender/build');
  mkdirSync(work, { recursive: true });
  let bad = 0;
  for (const prop of props) {
    const script = path.join(HERE, prop.script);
    const outs = ['a', 'b'].map((k) => path.join(work, `${prop.name}.${k}.glb`));
    const runs = outs.map((out) => runBlender(blender, script, ['--out', out]));
    writeFileSync(
      path.join(work, `${prop.name}.log`),
      runs.map((r) => r.out).join('\n=== second build ===\n'),
    );
    const failed = runs.find((r) => r.code !== 0) || outs.find((o) => !existsSync(o));
    if (failed) {
      console.error(`BUILD FAIL ${prop.name}: see .cache/blender/build/${prop.name}.log`);
      bad++;
      continue;
    }
    let result;
    try {
      result = await acceptBuild(repoRoot, prop, outs, { check });
    } catch (err) {
      console.error(`BUILD FAIL ${prop.name}: ${err.message}`);
      bad++;
      continue;
    }
    const { same, score, matches, note, bytes } = result;
    const s = score.summary;
    console.log(
      `BUILD ${prop.name}: ${runs[0].secs}s + ${runs[1].secs}s, ${bytes} bytes, deterministic ${same}, ` +
        `score ${s.passed}/${s.total}${s.failed.length ? ` (FAILED: ${s.failed.join(', ')})` : ''}, ` +
        `${score.counts.triangles} tris, ${score.draws.draws_instanced} draws; ${note}`,
    );
    if (!same || s.failed.length || (check && !matches)) bad++;
  }
  console.log(`[examined] ${props.length} props built twice each; ${bad} with a problem`);
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
