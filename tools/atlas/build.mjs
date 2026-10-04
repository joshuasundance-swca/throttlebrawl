#!/usr/bin/env node
// Bakes the region atlases from their sheets (README.md).
//
//   node tools/atlas/build.mjs                  bake every sheet in tools/atlas/sheets/ into its pack
//   node tools/atlas/build.mjs florida-keys     bake some of them
//   node tools/atlas/build.mjs --check          rebake in memory and compare with the committed
//                                               atlases (nothing is written)
//
// A sheet is code (sheets/<region>.mjs) drawn with raster.mjs's integer primitives, so a bake is
// the same on every machine and CI can rebake without Blender. `--check` compares the decoded
// palette and indices (a sha-256 of both), never the PNG bytes, so a different zlib build cannot
// fail it; the layout JSON is compared parsed. A bake writes a PNG only when its pixels or palette
// changed, so an unchanged sheet never churns the committed bytes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { makeLayout, layoutText } from './layout.mjs';
import { isRealLettering } from './lettering.mjs';
import { decodePng8, encodePng8, hexToRgb } from './png.mjs';
import { createRaster, edgeExtend, painter, seedFor } from './raster.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

/** Each tile's edge-extended band, in pixels. */
export const GUTTER = 4;
/** At most this many palette entries per sheet. */
export const MAX_COLOURS = 64;
/** Each region's PNG stays at or under this many bytes (assets.md, "The atlas plan"). */
export const MAX_PNG_BYTES = 160 * 1024;
/** The only roles a facade tile may paint with: a grey ramp that multiplies the vertex colour. */
const GREY_ROLE = /^grey_[0-8]$/;
const ID = /^[a-z0-9][a-z0-9_-]*$/;

/** Where a region's atlas and layout live, relative to the repo root. */
export function atlasPaths(pack, region) {
  const dir = `packs/${pack}/assets/textures/atlas`;
  return { png: `${dir}/${region}.png`, layout: `${dir}/${region}-layout.json` };
}

/** sha-256 of an image's size, palette and indices: what `--check` compares. */
export function pixelDigest({ width, height, palette, indices }) {
  return createHash('sha256')
    .update(`${width}x${height}|${palette.join(',')}|`)
    .update(indices)
    .digest('hex');
}

function validate(sheet) {
  const problems = [];
  const { size, tile, palette, tiles } = sheet;
  if (typeof sheet.region !== 'string' || !ID.test(sheet.region))
    problems.push('region must be a lower-case id');
  if (!Number.isInteger(size) || size < 64 || size > 2048 || (size & (size - 1)) !== 0) {
    problems.push(`size ${size} must be a power of two from 64 to 2048`);
  }
  if (!Number.isInteger(tile) || tile <= 2 * GUTTER || size % tile !== 0) {
    problems.push(`tile ${tile} must divide size and exceed twice the ${GUTTER} px gutter`);
  }
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > MAX_COLOURS) {
    problems.push(`palette must hold 1 to ${MAX_COLOURS} colours`);
    return problems;
  }
  palette.forEach((p, i) => {
    try {
      const [r, g, b] = hexToRgb(p.hex);
      if (GREY_ROLE.test(p.role) && !(r === g && g === b))
        problems.push(`palette ${i} (${p.role}) is not grey`);
    } catch (e) {
      problems.push(`palette ${i}: ${e.message}`);
    }
    if (typeof p.role !== 'string' || !p.role) problems.push(`palette ${i} has no role`);
  });
  if (palette[0].hex !== '#ffffff' || palette[0].role !== 'grey_0') {
    problems.push(
      "palette 0 must be { hex: '#ffffff', role: 'grey_0' }: the white tile and the top of the grey ramp",
    );
  }
  if (!Array.isArray(tiles)) {
    problems.push('tiles must be an array');
    return problems;
  }
  const cells = size / tile;
  const taken = new Map([['0,0', 'white']]);
  const ids = new Set(['white']);
  for (const t of tiles) {
    const w = t.w ?? 1;
    const h = t.h ?? 1;
    const name = `tile ${t.id}`;
    if (typeof t.id !== 'string' || !ID.test(t.id)) problems.push(`${name}: id must be a lower-case id`);
    else if (ids.has(t.id)) problems.push(`${name}: id used twice (or 'white', which is reserved)`);
    ids.add(t.id);
    if (t.kind !== 'facade' && t.kind !== 'art') problems.push(`${name}: kind must be 'facade' or 'art'`);
    if (typeof t.draw !== 'function') problems.push(`${name}: draw must be a function`);
    if (
      ![t.x, t.y, w, h].every(Number.isInteger) ||
      t.x < 0 ||
      t.y < 0 ||
      w < 1 ||
      h < 1 ||
      t.x + w > cells ||
      t.y + h > cells
    ) {
      problems.push(
        `${name}: cells x ${t.x}, y ${t.y}, w ${w}, h ${h} must be integers inside the ${cells} x ${cells} grid`,
      );
      continue;
    }
    for (let cy = t.y; cy < t.y + h; cy++) {
      for (let cx = t.x; cx < t.x + w; cx++) {
        const other = taken.get(`${cx},${cy}`);
        if (other) problems.push(`${name}: cell (${cx}, ${cy}) is already ${other}'s`);
        taken.set(`${cx},${cy}`, t.id);
      }
    }
  }
  return problems;
}

/** A role or palette index to a palette index; a role must name exactly one entry. */
function colourResolver(palette) {
  return (c) => {
    if (typeof c === 'number') {
      if (!Number.isInteger(c) || c < 0 || c >= palette.length)
        throw new Error(`palette index ${c} is out of range`);
      return c;
    }
    const hits = palette.flatMap((p, i) => (p.role === c ? [i] : []));
    if (hits.length !== 1) throw new Error(`role '${c}' names ${hits.length} palette entries (want 1)`);
    return hits[0];
  };
}

/**
 * Bakes a sheet in memory. `problems` lists everything wrong (a sheet with problems is never
 * written); the rest is the baked image, its layout object and its PNG.
 */
export function bakeSheet(sheet) {
  const problems = validate(sheet);
  if (problems.length) return { problems };
  const { size, tile, region } = sheet;
  const palette = sheet.palette.map((p) => p.hex);
  const raster = createRaster(size, size);
  const colour = colourResolver(sheet.palette);
  const inner = (x, y, w, h) => ({
    x: x * tile + GUTTER,
    y: y * tile + GUTTER,
    w: w * tile - 2 * GUTTER,
    h: h * tile - 2 * GUTTER,
  });
  const placed = [{ id: 'white', kind: 'facade', inner: inner(0, 0, 1, 1) }];
  for (const t of sheet.tiles) {
    const rect = inner(t.x, t.y, t.w ?? 1, t.h ?? 1);
    const p = painter(raster, rect, colour, seedFor(`${region}:${t.id}`));
    try {
      t.draw(p);
    } catch (e) {
      problems.push(`tile ${t.id}: ${e.message}`);
      continue;
    }
    for (const text of p.lettering) {
      if (t.kind !== 'art')
        problems.push(`tile ${t.id}: lettering '${text}' on a facade tile; lettering is art`);
      if (!isRealLettering(text)) {
        problems.push(
          `tile ${t.id}: lettering '${text}' is not real landmark lettering (lettering.mjs); invented words stay in pack data`,
        );
      }
    }
    if (t.kind === 'facade') {
      const bad = new Set();
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          const i = raster.data[y * size + x];
          if (!GREY_ROLE.test(sheet.palette[i].role)) bad.add(i);
        }
      }
      if (bad.size)
        problems.push(
          `tile ${t.id}: a facade tile paints with non-grey palette entries ${[...bad].join(', ')}`,
        );
    }
    placed.push({ id: t.id, kind: t.kind, inner: rect });
  }
  for (const t of placed) edgeExtend(raster, t.inner, GUTTER);
  const image = { width: size, height: size, palette, indices: raster.data };
  const png = encodePng8(image);
  if (png.length > MAX_PNG_BYTES)
    problems.push(`PNG is ${png.length} bytes, over the ${MAX_PNG_BYTES} byte cap`);
  return { problems, image, png, layout: makeLayout(sheet, placed, raster, GUTTER), tiles: placed };
}

/** The pack a sheet bakes into: its `pack`, else the one pack that has `regions/<region>/`. */
export function packFor(sheet, root) {
  if (sheet.pack) return sheet.pack;
  const packsDir = path.join(root, 'packs');
  const hits = existsSync(packsDir)
    ? readdirSync(packsDir).filter((p) => existsSync(path.join(packsDir, p, 'regions', sheet.region)))
    : [];
  if (hits.length !== 1)
    throw new Error(`region ${sheet.region} is in ${hits.length} packs (want 1); set the sheet's pack`);
  return hits[0];
}

/** Every sheet in a folder: `<region>.mjs` files whose default export is the sheet. */
export async function loadSheets(sheetsDir) {
  if (!existsSync(sheetsDir)) return [];
  const files = readdirSync(sheetsDir)
    .filter((f) => f.endsWith('.mjs'))
    .sort();
  const sheets = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(sheetsDir, f)).href);
    const sheet = mod.default;
    if (!sheet || sheet.region !== f.slice(0, -4)) {
      throw new Error(`sheets/${f}: the default export must be a sheet whose region is '${f.slice(0, -4)}'`);
    }
    sheets.push(sheet);
  }
  return sheets;
}

/** Committed atlas PNGs under every pack: [repo-relative path, region]. */
function committedAtlases(root) {
  const packsDir = path.join(root, 'packs');
  if (!existsSync(packsDir)) return [];
  const out = [];
  for (const pack of readdirSync(packsDir).sort()) {
    const dir = path.join(packsDir, pack, 'assets/textures/atlas');
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) {
      if (f.endsWith('.png')) out.push([`packs/${pack}/assets/textures/atlas/${f}`, f.slice(0, -4)]);
    }
  }
  return out;
}

/**
 * Compares a bake with the committed files. Returns why the PNG and why the layout differ, each
 * undefined when it matches.
 * @returns {{ png?: string, layout?: string }}
 */
export function compareWithCommitted(baked, pngBytes, layoutJson) {
  const out = {};
  if (!pngBytes) out.png = 'no committed PNG';
  else {
    let old;
    try {
      old = decodePng8(pngBytes);
    } catch (e) {
      out.png = `committed PNG does not decode: ${e.message}`;
    }
    if (old && pixelDigest(old) !== pixelDigest(baked.image)) {
      let differ = 0;
      if (old.width === baked.image.width && old.height === baked.image.height) {
        for (let i = 0; i < old.indices.length; i++) {
          if (old.palette[old.indices[i]] !== baked.image.palette[baked.image.indices[i]]) differ++;
        }
      }
      const palNote = isDeepStrictEqual(old.palette, baked.image.palette) ? '' : ', palette differs';
      out.png = `committed PNG differs from the sheet (${differ} pixels differ in colour${palNote})`;
    }
  }
  if (layoutJson === undefined) out.layout = 'no committed layout';
  else {
    let old;
    try {
      old = JSON.parse(layoutJson);
    } catch (e) {
      out.layout = `committed layout is not JSON: ${e.message}`;
    }
    if (old !== undefined && !isDeepStrictEqual(old, JSON.parse(JSON.stringify(baked.layout)))) {
      out.layout = 'committed layout differs from the sheet';
    }
  }
  return out;
}

/**
 * The command. Returns the exit code: 0 clean, 1 a problem, 2 bad arguments.
 * @param {string[]} argv
 * @param {{ root?: string, sheetsDir?: string, log?: (s: string) => void }} [opts]
 */
export async function main(argv, opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  const sheetsDir = opts.sheetsDir ?? path.join(HERE, 'sheets');
  const log = opts.log ?? console.log;
  const check = argv.includes('--check');
  const names = argv.filter((a) => !a.startsWith('--'));
  const all = await loadSheets(sheetsDir);
  const unknown = names.filter((n) => !all.some((s) => s.region === n));
  if (unknown.length) {
    log(`unknown sheet(s) ${unknown.join(', ')}; known: ${all.map((s) => s.region).join(', ') || 'none'}`);
    return 2;
  }
  const sheets = names.length ? all.filter((s) => names.includes(s.region)) : all;
  const read = (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel)) : undefined);
  let bad = 0;
  for (const sheet of sheets) {
    const baked = bakeSheet(sheet);
    let pack;
    try {
      pack = packFor(sheet, root);
    } catch (e) {
      baked.problems.push(e.message);
    }
    if (baked.problems.length) {
      log(`ATLAS ${sheet.region}: FAILED\n  ${baked.problems.join('\n  ')}`);
      bad++;
      continue;
    }
    const paths = atlasPaths(pack, sheet.region);
    const oldPng = read(paths.png);
    const oldLayout = read(paths.layout)?.toString('utf8');
    const cmp = compareWithCommitted(baked, oldPng, oldLayout);
    const diffs = [cmp.png, cmp.layout].filter(Boolean);
    const summary = `${baked.tiles.length} tiles, ${sheet.palette.length} colours, ${baked.png.length} bytes`;
    if (check) {
      log(
        `ATLAS ${sheet.region}: ${summary}; ${diffs.length ? `DIFFERS: ${diffs.join('; ')}` : `matches ${paths.png}`}`,
      );
      if (diffs.length) bad++;
      continue;
    }
    const wrote = [];
    mkdirSync(path.dirname(path.join(root, paths.png)), { recursive: true });
    if (cmp.png) {
      writeFileSync(path.join(root, paths.png), baked.png);
      wrote.push(paths.png);
    }
    if (cmp.layout) {
      writeFileSync(
        path.join(root, paths.layout),
        await layoutText(baked.layout, path.join(root, paths.layout)),
      );
      wrote.push(paths.layout);
    }
    log(`ATLAS ${sheet.region}: ${summary}; ${wrote.length ? `wrote ${wrote.join(' and ')}` : 'unchanged'}`);
  }
  let orphans = 0;
  const committed = committedAtlases(root);
  if (check && !names.length) {
    for (const [file, region] of committed) {
      if (!all.some((s) => s.region === region)) {
        log(`ATLAS ${file}: no sheet bakes it (tools/atlas/sheets/${region}.mjs is missing)`);
        orphans++;
      }
    }
  }
  log(
    `[examined] ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}` +
      `${sheets.length ? ` (${sheets.map((s) => s.region).join(', ')})` : ''}, ` +
      `${committed.length} committed atlas PNG${committed.length === 1 ? '' : 's'}; ` +
      `${bad + orphans} with a problem`,
  );
  return bad + orphans ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
