// The atlas layout sidecar, `<region>-layout.json` (README.md, "Layout file").
//
// UVs follow glTF: (0, 0) is the sheet image's top-left, u to the right, v down. The runtime loads
// the PNG with flipY = false, as three's GLTFLoader does. Each tile's rect is its inner rect (the
// gutter excluded), so a model whose UVs stay inside it never samples a neighbour.
import { hexToRgb, rgbToHex } from './png.mjs';

export const LAYOUT_FORMAT_VERSION = 1;

/** The mean colour of a raster rect through the palette, as '#rrggbb' (integer sums, rounded). */
export function meanColour(raster, palette, { x, y, w, h }) {
  const rgb = palette.map(hexToRgb);
  const sum = [0, 0, 0];
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const c = rgb[raster.data[yy * raster.width + xx]];
      sum[0] += c[0];
      sum[1] += c[1];
      sum[2] += c[2];
    }
  }
  return rgbToHex(sum.map((s) => Math.round(s / (w * h))));
}

/**
 * The layout object for a baked sheet.
 * @param {{ size: number, tile: number, palette: { hex: string, role: string }[] }} sheet
 * @param {{ id: string, kind: string, inner: { x: number, y: number, w: number, h: number } }[]} tiles
 *   every tile, the white one first, with its inner rect in pixels
 * @param {{ width: number, data: Uint8Array }} raster the baked sheet
 * @param {number} gutter
 */
export function makeLayout(sheet, tiles, raster, gutter) {
  const { size } = sheet;
  const palette = sheet.palette.map((p) => p.hex);
  const white = tiles[0].inner;
  const out = {
    formatVersion: LAYOUT_FORMAT_VERSION,
    size,
    tile: sheet.tile,
    gutterPx: gutter,
    white: [(white.x + white.w / 2) / size, (white.y + white.h / 2) / size],
    tiles: {},
    palette: sheet.palette.map(({ hex, role }) => ({ hex, role })),
  };
  for (const t of tiles) {
    const { x, y, w, h } = t.inner;
    out.tiles[t.id] = {
      rect: [x / size, y / size, (x + w) / size, (y + h) / size],
      kind: t.kind,
      mean: meanColour(raster, palette, t.inner),
    };
  }
  return out;
}

/**
 * The layout's committed text: the JSON as the repo's Prettier formats it, so the pre-commit
 * formatter and `format:check` leave the written file alone. `--check` compares parsed JSON, not
 * text, so a formatting difference can never fail it.
 */
export async function layoutText(layout, filepath) {
  const prettier = await import('prettier');
  const options = { ...(await prettier.resolveConfig(filepath)), filepath };
  return prettier.format(JSON.stringify(layout), options);
}
