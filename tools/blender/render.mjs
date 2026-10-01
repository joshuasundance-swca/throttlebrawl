#!/usr/bin/env node
// Renders the committed GLBs from three camera angles, then a contact sheet of all of them.
//
//   node tools/blender/render.mjs                  every prop -> .cache/blender/renders/
//   node tools/blender/render.mjs boat skiff       some of them
//   add --engine workbench for a fast preview, --out <dir> for another folder
//
// The renders are for looking, not gating; nothing here changes an exit code except a failed
// render. The contact sheet needs Python with Pillow (PYTHON, default `python`); without it the
// sheet is skipped with a note. Without Blender (BLENDER_EXE unset) it exits 0 with a note.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBlender, runBlender, SKIP_NOTE } from './blender.mjs';
import { glbPath, PROPS } from './catalog.mjs';
import { repoRoot } from './score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function main(argv) {
  const at = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const flagValues = new Set([at('--engine'), at('--out')].filter(Boolean));
  const names = argv.filter((a) => !a.startsWith('--') && !flagValues.has(a));
  const props = names.length ? PROPS.filter((p) => names.includes(p.name)) : PROPS;
  if (props.length !== (names.length || PROPS.length)) {
    console.error(`unknown prop in ${names.join(', ')}; known: ${PROPS.map((p) => p.name).join(', ')}`);
    return 2;
  }
  const blender = findBlender();
  if (!blender) {
    console.log(`asset:render ${SKIP_NOTE}`);
    return 0;
  }
  const out = path.resolve(at('--out') ?? path.join(repoRoot, '.cache/blender/renders'));
  mkdirSync(out, { recursive: true });
  let bad = 0;
  for (const prop of props) {
    const glb = path.join(repoRoot, glbPath(prop));
    if (!existsSync(glb)) {
      console.error(`RENDER ${prop.name}: no GLB at ${glbPath(prop)} (run the build first)`);
      bad++;
      continue;
    }
    const args = ['--glb', glb, '--out-dir', out, '--prop', prop.name, '--views', prop.views.join(',')];
    if (at('--engine')) args.push('--engine', at('--engine'));
    const r = runBlender(blender, path.join(HERE, 'render.py'), args);
    writeFileSync(path.join(out, `${prop.name}.render.log`), r.out);
    console.log(`RENDER ${prop.name}: ${r.code === 0 ? 'ok' : 'FAILED'} in ${r.secs}s`);
    if (r.code !== 0) bad++;
  }
  const python = process.env.PYTHON || 'python';
  const sheetPath = path.join(out, 'contact-sheet.png');
  const ok = props.filter((p) => existsSync(path.join(out, `${p.name}.render.json`))).map((p) => p.name);
  const sheet = spawnSync(python, [path.join(HERE, 'sheet.py'), out, sheetPath, ...ok], { encoding: 'utf8' });
  console.log(
    sheet.status === 0
      ? `contact sheet: ${sheetPath}`
      : `contact sheet skipped (needs Python with Pillow): ${(sheet.stderr || sheet.error?.message || '').trim().split('\n').pop()}`,
  );
  console.log(`[examined] ${props.length} props rendered to ${out}; ${bad} failed`);
  return bad ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
