# tools/atlas: the region atlases

Each region gets one small texture sheet, an **atlas**: 1024 x 1024 pixels, PNG-8 (indexed, at most 64 colours), cut into 128 px tiles on an 8 x 8 grid. Facades, storefront art, murals and real landmark lettering live on it. The merged scenery draws it through its existing material, so an atlas costs no extra draw calls (the playtest-3 asset plan, `[default]`).

A sheet is code, not a painting: `sheets/<region>.mjs` draws every tile with the integer primitives in `raster.mjs`, and `build.mjs` bakes it into the region's pack. Because every pixel decision is integer arithmetic with a seeded random stream, a bake is the same on every machine, and CI rebakes and compares without Blender. Blender stays the geometry tool; a Blender render is GPU and driver dependent, so it is not used for atlases.

Status `[default]`: the tool is "done, not phone-verified". The Keys sheet (`sheets/florida-keys.mjs`, CX2) has 16 facade and 28 art tiles and holds no lettering at all: the Southernmost Point buoy's words and the `MILE 0` sign are text surfaces on their models, so the in-game veto covers them too (`cx2-keys.test.ts` fails the sheet if a tile draws glyphs). The San Francisco and Pacific Northwest sheets come from CX3 and CX4.

## Commands

| npm script | Same as | What it does |
| --- | --- | --- |
| `npm run atlas:build [-- <region> ...]` | `node tools/atlas/build.mjs` | Bakes each sheet and writes `packs/<pack>/assets/textures/atlas/<region>.png` and `<region>-layout.json`. It writes a file only when its pixels, palette or layout changed. |
| `npm run atlas:check` | `node tools/atlas/build.mjs --check` | Rebakes in memory and compares with the committed files. Nothing is written. |

`--check` compares the **decoded** palette and indices (a sha-256 of both), never the PNG bytes, so a different `zlib` build cannot fail it. The layout is compared as parsed JSON. It also fails on a committed atlas PNG that no sheet bakes. `atlas.test.ts` runs the same check over the repo in the unit tier, so `npm test` and CI catch a committed atlas that drifted from its sheet.

Every run prints an `[examined]` line: how many sheets it baked and how many committed atlas PNGs it found. Exit codes: 0 clean, 1 a problem, 2 an unknown region.

## Files

| File | Role |
| --- | --- |
| `png.mjs` | PNG-8 encode and decode with `node:zlib` only. The encoder writes IHDR, PLTE, IDAT and IEND (colour type 3, bit depth 8, filter 0 on every row, deflate level 9). The decoder reads any non-interlaced 8-bit indexed PNG, all five row filters included. |
| `raster.mjs` | Integer drawing into an index buffer: `fill`, `pixel`, `rect`, `poly` (even-odd scanline), `stripes`, `circle` and `ring` (integer midpoint rule), `glyphs5x7`, plus `edgeExtend` for gutters and `mulberry32` for randomness. A non-integer coordinate throws. |
| `layout.mjs` | Writes the layout sidecar (below). |
| `lettering.mjs` | The only words an atlas may hold (below). |
| `build.mjs` | The command, and the bake: validation, drawing, gutters, the sheet rules, the size cap. |
| `atlas.test.ts` | The unit tests and the repo-wide `--check`. |
| `fixtures/` | A test sheet and a PNG-8 written by Pillow (`make-pillow-fixture.py` makes it), for the tests. |
| `sheets/` | One `<region>.mjs` per region, named by the region id (`florida-keys`, `san-francisco`, `pacific-northwest`). |

## Writing a sheet

`sheets/<region>.mjs` default-exports:

```js
export default {
  region: 'florida-keys', // the file name, and a folder under some pack's regions/
  size: 1024,
  tile: 128,
  palette: [
    { hex: '#ffffff', role: 'grey_0' }, // always first: the white tile and the top of the grey ramp
    { hex: '#c8c8c8', role: 'grey_2' },
    { hex: '#1b2a34', role: 'line' },
    // ... at most 64 entries
  ],
  tiles: [
    {
      id: 'lap-siding-wide', // lower-case; 'white' is reserved
      x: 1, // grid cell, 0 to 7
      y: 0,
      // w: 2, h: 1,       // optional: span several cells (a wide mural)
      kind: 'facade', // or 'art'
      draw(r) {
        r.fill('grey_2');
        r.stripes(0, 0, r.w, r.h, 12, 2, 'grey_6');
      },
    },
  ],
};
```

- **The pack.** A sheet bakes into the one pack that has `regions/<region>/` (the Keys into `base`, San Francisco into `region-sf`, the Pacific Northwest into `region-pnw`). A sheet may set `pack` to override it.
- **The white tile.** Cell (0, 0) is always the white tile: all palette index 0, `#ffffff`. The bake adds it; no sheet tile may claim the cell. Every mesh vertex without atlas art points at its centre, the layout's `white` UV.
- **Drawing.** `draw(r)` gets a painter whose coordinates are the tile's inner rect, (0, 0) at its top-left, `r.w` by `r.h` pixels (120 x 120 for one cell). Drawing is clipped to that rect, so a tile can never paint its neighbour. Colours are a palette role (it must name exactly one entry) or a palette index. `r.randInt(n)` and `r.rand()` come from the tile's own seeded stream (seeded from the region and tile id), so adding a tile never changes another one.
- **Gutters.** Each tile keeps a 4 px gutter on every side, filled by copying its own edge pixels outward, so mipmaps and filtering never bleed a neighbour's colours.
- **Facade tiles are greyscale.** They may paint only with palette roles `grey_0` to `grey_8`, and those entries must be grey. In game the texel multiplies the vertex colour, so a region palette still repaints the wall and the atlas adds the windows, trim and siding.
- **Art tiles are colour**: storefront art, murals, landmark lettering. They go on meshes painted with the white `art` role, so they show as drawn.
- **Size cap.** Each region's PNG must stay at or under 160 KB.

## No vetoable words

Atlas tiles never hold invented words `[default]`. A word baked into a texture could not be removed by the in-game "cut this" veto, which is `[decided]` in AGENTS.md. Billboards, shop names, signs and cart names stay in pack data, drawn by the game's canvas code.

`glyphs5x7` (a 5 x 7 pixel font defined in `raster.mjs`: A to Z, 0 to 9, space and `.,-'!&`; no font file, nothing to license) is the only way to draw text, and the bake records every string it draws. Each string must be on an art tile and be a whole-word run of a phrase in `lettering.mjs`: real landmark lettering only, today `SOUTHERNMOST POINT` and `MILE 0`. Adding a phrase is a reviewed edit to `lettering.mjs` naming the landmark it is on; the Codex batches write sheets only, never that file.

## Layout file

`<region>-layout.json` sits beside the PNG (a different asset id from it, since asset ids drop the extension):

| Field | Meaning |
| --- | --- |
| `formatVersion` | `1`. |
| `size`, `tile`, `gutterPx` | The sheet's size, cell size and gutter, in pixels. |
| `white` | `[u, v]`: the white tile's centre. |
| `tiles` | `{ <id>: { rect, kind, mean } }`, the white tile included. `rect` is `[u0, v0, u1, v1]`, the inner rect (gutter excluded), so UVs inside it never sample a neighbour. `mean` is the tile's average colour, `#rrggbb`, for far stand-ins, so a block does not change colour at the level-of-detail switch. |
| `palette` | `[{ hex, role }]`, by palette index: a seam for a later per-look palette swap. Nothing reads it yet. |

**UVs follow glTF**: (0, 0) is the image's top-left, u runs right and v runs down. The runtime loads the atlas with `flipY = false`, as three's GLTFLoader does. The test sheet's asymmetric F tile pins this.

The bake writes the layout as the repo's Prettier formats it, so the pre-commit formatter leaves it alone.
