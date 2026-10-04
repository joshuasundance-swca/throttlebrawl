import { describe, expect, it } from 'vitest';
import { bakeSheet, pixelDigest, MAX_PNG_BYTES } from './build.mjs';
import { createRaster, painter, seedFor } from './raster.mjs';
import sourceSheet from './sheets/florida-keys.mjs';

const sheet = sourceSheet as {
  size: number;
  tile: number;
  palette: { role: string; hex: string }[];
  tiles: { id: string; kind: string; draw: (r: ReturnType<typeof painter>) => void }[];
};

describe('CX2 Keys picture atlas', () => {
  it('meets the requested sheet size, palette and tile allocation', () => {
    expect([sheet.size, sheet.tile]).toEqual([1024, 128]);
    expect(sheet.palette.length).toBeLessThanOrEqual(64);
    expect(new Set(sheet.palette.map((p: { role: string }) => p.role)).size).toBe(sheet.palette.length);
    expect(sheet.tiles.filter((t: { kind: string }) => t.kind === 'facade')).toHaveLength(16);
    expect(sheet.tiles.filter((t: { kind: string }) => t.kind === 'art')).toHaveLength(28);
    const baked = bakeSheet(sheet);
    expect(baked.problems).toEqual([]);
    if (!baked.png || !baked.image) throw new Error('sheet failed to bake');
    const repeat = bakeSheet(sheet);
    if (!repeat.image) throw new Error('repeat failed to bake');
    expect(baked.png.length).toBeLessThanOrEqual(MAX_PNG_BYTES);
    expect(pixelDigest(repeat.image)).toBe(pixelDigest(baked.image));
  });

  it('draws every picture without any lettering operation', () => {
    for (const tile of sheet.tiles) {
      const raster = createRaster(120, 120);
      const r = painter(
        raster,
        { x: 0, y: 0, w: 120, h: 120 },
        (role: string | number) =>
          typeof role === 'number' ? role : sheet.palette.findIndex((p) => p.role === role),
        seedFor(`florida-keys:${tile.id}`),
      );
      const pictureOnly = new Proxy(r, {
        get(target, property, receiver): unknown {
          if (property === 'glyphs5x7') throw new Error(`lettering forbidden: ${tile.id}`);
          return Reflect.get(target, property, receiver);
        },
      });
      expect(() => tile.draw(pictureOnly), tile.id).not.toThrow();
      expect(r.lettering, tile.id).toEqual([]);
      if (tile.kind === 'facade') {
        for (const index of new Set(raster.data)) {
          expect(sheet.palette[index]?.role, tile.id).toMatch(/^grey_[0-8]$/);
        }
      }
    }
  });
});
