// The region atlas tool (tools/atlas/README.md): the PNG-8 codec, the integer raster, the layout
// sidecar and `--check`. The last block runs `--check` over the real repo, so a committed atlas
// that drifts from its sheet fails the unit tier, with no Blender needed.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { atlasPaths, bakeSheet, GUTTER, main, MAX_PNG_BYTES, pixelDigest } from './build.mjs';
import { isRealLettering } from './lettering.mjs';
import { decodePng8, encodePng8 } from './png.mjs';
import { GLYPHS, mulberry32 } from './raster.mjs';
import fixtureSheet, { F_STROKES } from './fixtures/sheets/test-region.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(HERE, '../..');
const FIXTURE_SHEETS = path.join(HERE, 'fixtures/sheets');

type Sheet = typeof fixtureSheet;
type Baked = {
  problems: string[];
  image: { width: number; height: number; palette: string[]; indices: Uint8Array };
  png: Buffer;
  layout: {
    size: number;
    gutterPx: number;
    white: [number, number];
    tiles: Record<string, { rect: [number, number, number, number]; kind: string; mean: string }>;
    palette: { hex: string; role: string }[];
  };
};
const bake = (sheet: unknown) => bakeSheet(sheet) as Baked;
/** The fixture with some fields swapped, for the negative cases. */
const variant = (edit: (s: Sheet) => Partial<Sheet>): Sheet => ({ ...fixtureSheet, ...edit(fixtureSheet) });
const at = (img: Baked['image'], x: number, y: number) => img.palette[img.indices[y * img.width + x]!];

/** A PNG-8 assembled by hand from filtered rows, at any deflate level, optionally with a tEXt chunk. */
function pngFromRaw(
  w: number,
  h: number,
  palette: string[],
  raw: Buffer,
  level: number,
  text = false,
): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const plte = Buffer.from(palette.flatMap((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    ...(text ? [chunk('tEXt', Buffer.from('Comment\0an ancillary chunk to skip', 'latin1'))] : []),
    chunk('IDAT', deflateSync(raw, { level })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('png.mjs', () => {
  it('round-trips a 1024 x 1024 index buffer exactly', () => {
    const next = mulberry32(42);
    const palette = Array.from({ length: 64 }, (_, i) => `#${(i * 0x040404).toString(16).padStart(6, '0')}`);
    const indices = new Uint8Array(1024 * 1024).map(() => next() % 64);
    const out = decodePng8(encodePng8({ width: 1024, height: 1024, palette, indices }));
    expect(out.width).toBe(1024);
    expect(out.height).toBe(1024);
    expect(out.palette).toEqual(palette);
    expect(Buffer.from(out.indices).equals(Buffer.from(indices))).toBe(true);
  });

  it('reads a PNG-8 that Pillow wrote (fixtures/make-pillow-fixture.py)', () => {
    const out = decodePng8(readFileSync(path.join(HERE, 'fixtures/pillow-48.png')));
    expect([out.width, out.height]).toEqual([37, 23]);
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    expect(out.palette).toEqual(
      Array.from({ length: 48 }, (_, i) => `#${hex(i * 5)}${hex(255 - i * 5)}${hex((i * 37) % 256)}`),
    );
    let wrong = 0;
    for (let y = 0; y < 23; y++)
      for (let x = 0; x < 37; x++) if (out.indices[y * 37 + x] !== (x * 7 + y * 3) % 48) wrong++;
    expect(wrong).toBe(0);
  });

  it('undoes all five row filters (other writers use them)', () => {
    const w = 6;
    const h = 5;
    const px = Uint8Array.from({ length: w * h }, (_, i) => (i * 11) % 9);
    const get = (x: number, y: number) => (x < 0 || y < 0 ? 0 : px[y * w + x]!);
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    const raw: number[] = [];
    for (let y = 0; y < h; y++) {
      const f = y; // rows use filters 0, 1, 2, 3, 4 in turn
      raw.push(f);
      for (let x = 0; x < w; x++) {
        const [a, b, c] = [get(x - 1, y), get(x, y - 1), get(x - 1, y - 1)];
        const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]!;
        raw.push((get(x, y) - pred) & 0xff);
      }
    }
    const png = pngFromRaw(w, h, Array<string>(9).fill('#7f7f7f'), Buffer.from(raw), 6, true);
    expect(Array.from(decodePng8(png).indices)).toEqual(Array.from(px));
  });

  it('refuses a PNG that is not 8-bit indexed, and a broken CRC', () => {
    const good = encodePng8({ width: 2, height: 2, palette: ['#000000'], indices: new Uint8Array(4) });
    const rgb = Buffer.from(good);
    rgb[8 + 8 + 9] = 2; // IHDR colour type -> truecolour (the CRC now fails first)
    expect(() => decodePng8(rgb)).toThrow(/CRC/);
    expect(() => decodePng8(Buffer.from('not a png'))).toThrow(/not a PNG/);
  });
});

describe('a baked sheet', () => {
  const baked = bake(fixtureSheet);

  it('bakes the fixture with no problems, the same twice', () => {
    expect(baked.problems).toEqual([]);
    expect(pixelDigest(bake(fixtureSheet).image)).toBe(pixelDigest(baked.image));
  });

  it('the white tile is all palette index 0 = #ffffff, gutter included', () => {
    expect(baked.image.palette[0]).toBe('#ffffff');
    let other = 0;
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) if (baked.image.indices[y * 1024 + x] !== 0) other++;
    expect(other).toBe(0);
    expect(baked.layout.white).toEqual([64 / 1024, 64 / 1024]);
  });

  it('pins the orientation: the F tile lands right way up at its layout rect (glTF UVs, v down)', () => {
    const rect = baked.layout.tiles['f-glyph']!.rect;
    expect(rect).toEqual([260 / 1024, 4 / 1024, 380 / 1024, 124 / 1024]);
    // Read the decoded PNG through the layout, as the runtime will (flipY = false: v is the row).
    const img = decodePng8(baked.png);
    const x0 = rect[0] * 1024;
    const y0 = rect[1] * 1024;
    const ink = '#101820';
    const red = '#d23c28';
    type Stroke = [x: number, y: number, w: number, h: number];
    const strokes = F_STROKES as Record<'stem' | 'top' | 'middle', Stroke>;
    const [sx, sy, , sh] = strokes.stem;
    const [tx, ty, tw] = strokes.top;
    const [, my, mw] = strokes.middle;
    expect(at(img, x0 + sx, y0 + sy)).toBe(ink); // top-left corner of the F
    expect(at(img, x0 + tx + tw - 1, y0 + ty)).toBe(ink); // the top bar's right end
    expect(at(img, x0 + sx + mw - 1, y0 + my)).toBe(ink); // the middle bar's right end
    expect(at(img, x0 + sx, y0 + sy + sh - 1)).toBe(ink); // the stem's foot
    expect(at(img, x0 + tx + tw - 1, y0 + sy + sh - 1)).toBe(red); // bottom right is empty
    expect(at(img, x0 + 2, y0 + 2)).toBe(red);
  });

  it("fills each gutter from the tile's own edge", () => {
    const [u0, v0] = baked.layout.tiles['f-glyph']!.rect;
    const x = u0 * 1024;
    const y = v0 * 1024;
    for (let g = 1; g <= GUTTER; g++) {
      expect(at(baked.image, x - g, y + 20)).toBe(at(baked.image, x, y + 20));
      expect(at(baked.image, x + 20, y - g)).toBe(at(baked.image, x + 20, y));
      expect(at(baked.image, x - g, y - g)).toBe(at(baked.image, x, y));
    }
  });

  it("the layout's inner rects sit inside the sheet and never overlap", () => {
    const rects = Object.entries(baked.layout.tiles).map(([id, t]) => [id, t.rect] as const);
    expect(rects.map(([id]) => id).sort()).toEqual(['f-glyph', 'lap-siding', 'mile-sign', 'mural', 'white']);
    for (const [, [u0, v0, u1, v1]] of rects) {
      expect(u0).toBeGreaterThanOrEqual(0);
      expect(v0).toBeGreaterThanOrEqual(0);
      expect(u1).toBeLessThanOrEqual(1);
      expect(v1).toBeLessThanOrEqual(1);
      expect(u1).toBeGreaterThan(u0);
      expect(v1).toBeGreaterThan(v0);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [a, b] = [rects[i]![1], rects[j]![1]];
        const overlap = a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
        expect(overlap, `${rects[i]![0]} and ${rects[j]![0]}`).toBe(false);
      }
    }
    expect(baked.layout.tiles['mural']!.rect).toEqual([388 / 1024, 4 / 1024, 636 / 1024, 124 / 1024]);
    expect(baked.layout.tiles['lap-siding']!.kind).toBe('facade');
    expect(baked.layout.tiles['white']!.mean).toBe('#ffffff');
  });

  it('stays far under the 160 KB cap', () => {
    expect(baked.png.length).toBeLessThan(MAX_PNG_BYTES);
  });
});

describe('the sheet rules', () => {
  const problemsOf = (s: Sheet) => bake(s).problems.join('\n');
  const swapTile = (id: string, edit: object) =>
    variant((s) => ({ tiles: s.tiles.map((t) => (t.id === id ? { ...t, ...edit } : t)) }));

  it('a facade tile may paint only with the grey ramp', () => {
    const s = swapTile('lap-siding', {
      draw: (r: { pixel: (x: number, y: number, c: string) => void }) => r.pixel(5, 5, 'red'),
    });
    expect(problemsOf(s)).toMatch(/lap-siding: a facade tile paints with non-grey palette entries 5/);
  });

  it('lettering must be real landmark lettering, on an art tile', () => {
    const shop = swapTile('mile-sign', {
      draw: (r: { glyphs5x7: (t: string, x: number, y: number, c: string) => void }) =>
        r.glyphs5x7('EAT HERE', 0, 0, 'red'),
    });
    expect(problemsOf(shop)).toMatch(/'EAT HERE' is not real landmark lettering/);
    const onFacade = swapTile('mile-sign', { kind: 'facade' });
    expect(problemsOf(onFacade)).toMatch(/lettering 'MILE' on a facade tile/);
    expect(isRealLettering('SOUTHERNMOST')).toBe(true);
    expect(isRealLettering('MILE 0')).toBe(true);
    expect(isRealLettering('POINT MILE')).toBe(false);
    expect(isRealLettering('MILES')).toBe(false);
  });

  it('pixel decisions are integers only', () => {
    const s = swapTile('mural', {
      draw: (r: { rect: (...a: unknown[]) => void }) => r.rect(0.5, 0, 4, 4, 'red'),
    });
    expect(problemsOf(s)).toMatch(/mural: x must be an integer, got 0.5/);
  });

  it('tiles keep their cells: (0, 0) is the white tile, and no two tiles share a cell', () => {
    expect(problemsOf(swapTile('mural', { x: 0, y: 0 }))).toMatch(/cell \(0, 0\) is already white's/);
    expect(problemsOf(swapTile('mural', { x: 2 }))).toMatch(/cell \(2, 0\) is already f-glyph's/);
    expect(problemsOf(swapTile('mural', { x: 7 }))).toMatch(/inside the 8 x 8 grid/);
    expect(problemsOf(swapTile('mural', { id: 'white' }))).toMatch(/id used twice/);
  });

  it('palette: index 0 is white grey_0, at most 64 entries, grey roles are grey, roles resolve once', () => {
    expect(
      problemsOf(variant((s) => ({ palette: [{ hex: '#fefefe', role: 'grey_0' }, ...s.palette.slice(1)] }))),
    ).toMatch(/palette 0 must be/);
    const many = Array.from({ length: 65 }, (_, i) => ({ hex: i ? '#000000' : '#ffffff', role: `c${i}` }));
    expect(problemsOf(variant(() => ({ palette: many })))).toMatch(/1 to 64 colours/);
    expect(
      problemsOf(variant((s) => ({ palette: [...s.palette, { hex: '#ff0000', role: 'grey_8' }] }))),
    ).toMatch(/\(grey_8\) is not grey/);
    expect(
      problemsOf(variant((s) => ({ palette: [...s.palette, { hex: '#d23c29', role: 'red' }] }))),
    ).toMatch(/role 'red' names 2 palette entries/);
  });

  it('a sheet over the 160 KB cap fails', () => {
    const noise = {
      id: 'noise',
      x: 0,
      y: 2,
      w: 8,
      h: 6,
      kind: 'art',
      draw(r: {
        w: number;
        h: number;
        randInt: (n: number) => number;
        pixel: (x: number, y: number, c: number) => void;
      }) {
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) r.pixel(x, y, r.randInt(7));
      },
    };
    expect(problemsOf(variant((s) => ({ tiles: [...s.tiles, noise] })))).toMatch(/over the 163840 byte cap/);
  });
});

describe('build.mjs and --check', () => {
  mkdirSync(path.join(repoRoot, '.cache'), { recursive: true });
  const root = mkdtempSync(path.join(repoRoot, '.cache', 'atlas-test-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'packs/base/regions/test-region'), { recursive: true });
  const run = async (...argv: string[]) => {
    const lines: string[] = [];
    const code = await main(argv, { root, sheetsDir: FIXTURE_SHEETS, log: (s: string) => lines.push(s) });
    return { code, out: lines.join('\n') };
  };
  const { png: pngRel, layout: layoutRel } = atlasPaths('base', 'test-region');
  const pngFile = path.join(root, pngRel);

  it('bakes into the region pack, then --check matches and a rebuild changes nothing', async () => {
    const missing = await run('--check');
    expect(missing.code).toBe(1);
    expect(missing.out).toMatch(/no committed PNG/);

    const built = await run();
    expect(built.code).toBe(0);
    expect(built.out).toContain(`wrote ${pngRel} and ${layoutRel}`);
    expect(statSync(pngFile).size).toBeLessThan(MAX_PNG_BYTES);
    const layout = JSON.parse(readFileSync(path.join(root, layoutRel), 'utf8')) as {
      formatVersion: number;
      gutterPx: number;
    };
    expect(layout.formatVersion).toBe(1);
    expect(layout.gutterPx).toBe(4);

    const checked = await run('--check');
    expect(checked.code).toBe(0);
    expect(checked.out).toMatch(
      /\[examined\] 1 sheet \(test-region\), 1 committed atlas PNG; 0 with a problem/,
    );
    expect((await run()).out).toMatch(/unchanged/);
  });

  it('--check compares pixels, not bytes: a re-encode passes, one changed pixel fails', async () => {
    const committed = decodePng8(readFileSync(pngFile));
    // The same pixels deflated differently (as another zlib build might) are different bytes, and pass.
    const raw = Buffer.alloc(1025 * 1024);
    for (let y = 0; y < 1024; y++)
      raw.set(committed.indices.subarray(y * 1024, (y + 1) * 1024), y * 1025 + 1);
    const level1 = pngFromRaw(1024, 1024, committed.palette, raw, 1);
    expect(level1.equals(readFileSync(pngFile))).toBe(false);
    writeFileSync(pngFile, level1);
    expect((await run('--check')).code).toBe(0);

    const indices = Uint8Array.from(committed.indices);
    indices[600 * 1024 + 600] = (indices[600 * 1024 + 600]! + 1) % committed.palette.length;
    writeFileSync(pngFile, encodePng8({ ...committed, indices }));
    const bad = await run('--check');
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/committed PNG differs from the sheet \(1 pixels differ in colour\)/);

    writeFileSync(pngFile, encodePng8(committed));
    expect((await run('--check')).code).toBe(0);
  });

  it('--check flags a committed atlas with no sheet, and an unknown region is a usage error', async () => {
    const orphan = path.join(root, 'packs/base/assets/textures/atlas/nowhere.png');
    writeFileSync(orphan, readFileSync(pngFile));
    const out = await run('--check');
    expect(out.code).toBe(1);
    expect(out.out).toMatch(/nowhere.png: no sheet bakes it/);
    rmSync(orphan);
    expect((await run('atlantis')).code).toBe(2);
  });
});

describe('the committed atlases', () => {
  it('every committed atlas matches its sheet (atlas:check, run in the unit tier)', async () => {
    const lines: string[] = [];
    const code = await main(['--check'], { log: (s: string) => lines.push(s) });
    expect(lines.join('\n'), lines.join('\n')).toMatch(/\[examined\] \d+ sheets?.*; 0 with a problem/);
    expect(code).toBe(0);
  });

  it("the 5 x 7 font draws A to Z, 0 to 9 and . , - ' ! &", () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,-'!& ") expect(GLYPHS).toContain(ch);
  });
});
