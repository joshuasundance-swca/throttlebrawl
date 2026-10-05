// The region atlas at runtime (playtest 3, round 2, "Mix: models + small atlases"; T12.1). Each region
// has one baked sheet, `textures/atlas/<region>` (PNG-8, 1024 x 1024, tools/atlas/), and its layout,
// `textures/atlas/<region>-layout`. A model's atlas surfaces carry UVs into one tile of it; every other
// vertex sits on the white tile, so a merged mesh of many models draws with ONE material whose `map`
// is the sheet: no new draw call, and the looks hatch and grade the pictures like flat colour.
//
// - Decoding: the sheet is decoded here (the browser's own inflate, then the PNG filters and the
//   palette) into a DataTexture, so the bytes the game draws are the bytes the tests read.
// - UVs: glTF's convention, (0, 0) at the image's top-left; the texture keeps `flipY` off.
// - Far stand-ins (scenery-merge.ts): a picture far away is its tile's mean colour times the vertex
//   colour (`farColor`), so a block does not change colour when it switches to its stand-in.
// - Missing sheet: the model draws with the plain material, each picture as its tile's mean; missing
//   layout: the plain material and the model's own colours. Nothing throws.
// It is part of the lazy model-reader chunk (models.ts imports it): the first load never pays for it.
import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from 'three';
import type { AssetManifest } from '../assets';
import type { SceneryModel } from './models';
import { ATLAS_WHITE_UV } from './scenery-merge';

/** The white tile's centre: every baked vertex that is not on an atlas surface takes this UV. */
export { ATLAS_WHITE_UV };

/** A sheet's asset id and its layout's (asset ids drop the extension, so the layout has its own name). */
export const atlasAsset = (sheet: string): string => `textures/atlas/${sheet}`;
export const atlasLayoutAsset = (sheet: string): string => `textures/atlas/${sheet}-layout`;

export interface AtlasTile {
  /** The tile's inner rect (gutter excluded), [u0, v0, u1, v1], v down from the image's top. */
  rect: readonly [number, number, number, number];
  kind: 'facade' | 'art';
  /** Its mean colour, '#rrggbb' (a far stand-in's colour). */
  mean: string;
}

export interface AtlasLayout {
  size: number;
  tile: number;
  white: readonly [number, number];
  tiles: Readonly<Record<string, AtlasTile>>;
}

/** A region's sheet as loaded: its layout, and its texture (null when the sheet failed to load). */
export interface RegionAtlas {
  sheet: string;
  layout: AtlasLayout;
  texture: Texture | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Reads a layout file (tools/atlas/layout.mjs's format 1). Throws on anything else. */
export function parseAtlasLayout(json: unknown): AtlasLayout {
  const o = json as Partial<Record<string, unknown>> | null;
  if (!o || o['formatVersion'] !== 1) throw new Error('atlas layout: not format version 1');
  const size = o['size'];
  const tile = o['tile'];
  if (!isNum(size) || !isNum(tile)) throw new Error('atlas layout: no size or tile');
  const white = o['white'] as unknown[] | undefined;
  if (
    !Array.isArray(white) ||
    Math.abs(Number(white[0]) - ATLAS_WHITE_UV[0]) > 1e-9 ||
    Math.abs(Number(white[1]) - ATLAS_WHITE_UV[1]) > 1e-9
  )
    throw new Error(`atlas layout: the white tile is not at ${ATLAS_WHITE_UV.join(', ')}`);
  const tiles: Record<string, AtlasTile> = {};
  for (const [id, t] of Object.entries((o['tiles'] ?? {}) as Record<string, Partial<AtlasTile>>)) {
    const r = t.rect;
    if (!Array.isArray(r) || r.length !== 4 || !r.every((x) => isNum(x) && x >= 0 && x <= 1))
      throw new Error(`atlas layout: tile ${id} has no rect`);
    if (typeof t.mean !== 'string' || !/^#[0-9a-f]{6}$/i.test(t.mean))
      throw new Error(`atlas layout: tile ${id} has no mean`);
    tiles[id] = {
      rect: [r[0], r[1], r[2], r[3]],
      kind: t.kind === 'art' ? 'art' : 'facade',
      mean: t.mean,
    };
  }
  return { size, tile, white: [ATLAS_WHITE_UV[0], ATLAS_WHITE_UV[1]], tiles };
}

/** A decoded sheet: RGBA bytes, rows from the image's top. */
export interface AtlasImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** zlib-inflates bytes with the platform's own decoder (browsers and Node both have it). */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Decodes an 8-bit indexed, non-interlaced PNG (the atlas tool's format; any row filter, an optional
 * tRNS). The manifest has already checked the file's hash, so chunk CRCs are not re-checked.
 */
export async function decodeAtlasPng(data: ArrayBuffer): Promise<AtlasImage> {
  const b = new Uint8Array(data);
  const view = new DataView(data);
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 8 || SIG.some((v, i) => b[i] !== v)) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let palette: Uint8Array | null = null;
  let alpha: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 12 <= b.length;) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(b[at + 4]!, b[at + 5]!, b[at + 6]!, b[at + 7]!);
    const body = b.subarray(at + 8, at + 8 + len);
    if (body.length !== len) throw new Error(`PNG chunk ${type} runs past the end`);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, colour, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || colour !== 3 || interlace !== 0)
        throw new Error('the atlas is not a non-interlaced 8-bit indexed PNG');
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') alpha = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!width || !height || !palette) throw new Error('PNG lacks IHDR or PLTE');
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }
  const raw = await inflate(joined);
  const stride = width + 1;
  if (raw.length < stride * height) throw new Error('PNG image data is short');
  const index = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const src = y * stride + 1;
    const dst = y * width;
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? index[dst + x - 1]! : 0;
      const up = y > 0 ? index[dst - width + x]! : 0;
      const c = x > 0 && y > 0 ? index[dst - width + x - 1]! : 0;
      const pred =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? up
              : filter === 3
                ? (a + up) >> 1
                : filter === 4
                  ? paeth(a, up, c)
                  : -1;
      if (pred < 0) throw new Error(`PNG row ${y} has filter ${filter}`);
      index[dst + x] = (raw[src + x]! + pred) & 0xff;
    }
  }
  const colours = palette.length / 3;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < index.length; i++) {
    const k = index[i]!;
    if (k >= colours) throw new Error(`PNG pixel ${i} is past the palette`);
    rgba[i * 4] = palette[k * 3]!;
    rgba[i * 4 + 1] = palette[k * 3 + 1]!;
    rgba[i * 4 + 2] = palette[k * 3 + 2]!;
    rgba[i * 4 + 3] = alpha && k < alpha.length ? alpha[k]! : 255;
  }
  return { width, height, rgba };
}

/**
 * The sheet as a texture: mipmapped, sRGB, anisotropy 4 (the scenes layer's settings), and `flipY`
 * off, so a UV's v runs down from the image's top, as glTF's does.
 */
export function atlasTexture(img: AtlasImage): DataTexture {
  const tex = new DataTexture(img.rgba, img.width, img.height, RGBAFormat, UnsignedByteType);
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  tex.colorSpace = SRGBColorSpace;
  tex.name = 'region-atlas';
  tex.needsUpdate = true;
  return tex;
}

/**
 * Loads a region's sheet and layout through the asset manifest. Null when the layout is missing or
 * unreadable (the models then draw plain); a layout with a sheet that fails has a null texture.
 */
export async function loadRegionAtlas(manifest: AssetManifest, sheet: string): Promise<RegionAtlas | null> {
  const layout = await manifest.load<AtlasLayout | null>(atlasLayoutAsset(sheet), () => null, {
    decode: (data) => parseAtlasLayout(JSON.parse(new TextDecoder().decode(data))),
  });
  if (!layout.value) return null;
  const texture = await manifest.load<Texture | null>(atlasAsset(sheet), () => null, {
    decode: async (data) => atlasTexture(await decodeAtlasPng(data)),
  });
  return { sheet, layout: layout.value, texture: texture.value };
}

/**
 * The model ready for its region's atlas: each variant gets `farColor` (its colour times each atlas
 * vertex's tile mean, for the far stand-ins) and the model the sheet as its `map`. Without a texture
 * the means go into the colours themselves (the plain material shows each picture as its mean);
 * without a layout the model is returned as it is. The copies' geometries are new.
 */
export function withAtlas(model: SceneryModel, atlas: RegionAtlas | null): SceneryModel {
  if (!atlas || !model.tiles) return model;
  const mean = new Color();
  const variants = model.variants.map((g, v): BufferGeometry => {
    const copy = g.clone();
    const col = copy.getAttribute('color');
    const far = new Float32Array(col.array);
    for (const run of model.tiles?.[v] ?? []) {
      const tile = atlas.layout.tiles[run.tile];
      if (!tile) continue;
      mean.set(tile.mean);
      for (let i = run.start; i < run.start + run.count; i++) {
        far[i * 3] = col.getX(i) * mean.r;
        far[i * 3 + 1] = col.getY(i) * mean.g;
        far[i * 3 + 2] = col.getZ(i) * mean.b;
      }
    }
    copy.setAttribute('farColor', new Float32BufferAttribute(far, 3));
    if (!atlas.texture) copy.setAttribute('color', new Float32BufferAttribute(far.slice(), 3));
    return copy;
  });
  const out: SceneryModel = { ...model, variants };
  if (atlas.texture) out.map = atlas.texture;
  else delete out.map;
  return out;
}
