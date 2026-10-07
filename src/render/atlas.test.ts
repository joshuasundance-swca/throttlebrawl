// The region atlas at runtime (playtest 3, T12.1; scratch plan assets.md "How it reaches the screen"):
// the committed Keys sheet decodes with its picture where the layout says (the UV convention, glTF's
// top-left origin with flipY off), the Duval kit bakes its atlas surfaces' UVs and puts every other
// vertex on the white tile, a far stand-in takes the tile's mean, every look keeps the map, and a
// missing atlas falls back to the plain material without throwing.
import {
  BoxGeometry,
  Color,
  DataTexture,
  LinearMipmapLinearFilter,
  Mesh,
  MeshLambertMaterial,
  SRGBColorSpace,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { AssetManifest } from '../assets';
import {
  ATLAS_WHITE_UV,
  atlasAsset,
  atlasLayoutAsset,
  atlasTexture,
  decodeAtlasPng,
  loadRegionAtlas,
  parseAtlasLayout,
  withAtlas,
  type RegionAtlas,
} from './atlas';
import { readGlb } from './glb';
import { createFlatLook } from './look';
import { createLookSet, LOOK_IDS } from './looks';
import { ATLAS_SHEETS, bakeModel, MODEL_ASSETS } from './models';
import type { ScenerySpot } from './scenery';
import { formsOf, MergedScenery } from './scenery-merge';

/** The examined lines, printed even when the tests pass (console.log is not). */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

async function readRepoFile(rel: string): Promise<ArrayBuffer> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const buf = fs.readFileSync(rel);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const SHEET = 'florida-keys';
const pngBytes = await readRepoFile(`packs/base/assets/${atlasAsset(SHEET)}.png`);
const layoutJson = JSON.parse(
  new TextDecoder().decode(await readRepoFile(`packs/base/assets/${atlasLayoutAsset(SHEET)}.json`)),
) as unknown;
const duvalGlb = await readRepoFile(`packs/base/assets/${MODEL_ASSETS.duvalKit}.glb`);

/** A manifest over a few repo files by asset id; ids it lacks fall back to the stand-in. */
function fakeManifest(files: Record<string, ArrayBuffer | 'broken'>): AssetManifest {
  return {
    entries: () => [],
    resolve: () => null,
    progress: () => ({ total: 0, done: 0, fellBack: 0, bytesLoaded: 0, bytesTotal: 0, perAsset: {} }),
    onProgress: () => () => {},
    onRetryReady: () => () => {},
    async load<T>(
      id: string,
      standIn: () => T,
      opts?: { decode?: (d: ArrayBuffer, e: never) => T | Promise<T> },
    ) {
      const data = files[id];
      if (!data)
        return { id, source: 'procedural' as const, value: standIn(), fellBack: true, error: 'missing' };
      try {
        const bytes = data === 'broken' ? new ArrayBuffer(16) : data;
        const value = await opts!.decode!(bytes, undefined as never);
        return { id, source: 'baked' as const, value, fellBack: false };
      } catch (err) {
        return { id, source: 'procedural' as const, value: standIn(), fellBack: true, error: String(err) };
      }
    },
  };
}

describe('the atlas sheet, decoded', () => {
  it('puts each tile where the layout says, read top-down as glTF UVs with flipY off', async () => {
    const layout = parseAtlasLayout(layoutJson);
    const img = await decodeAtlasPng(pngBytes);
    expect([img.width, img.height]).toEqual([layout.size, layout.size]);
    // The texel a UV samples: u across from the left, v down from the image's top row.
    const texel = (u: number, v: number) => {
      const x = Math.min(img.width - 1, Math.floor(u * img.width));
      const y = Math.min(img.height - 1, Math.floor(v * img.height));
      return [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
    };
    expect(texel(...layout.white)).toEqual([255, 255, 255, 255]);
    // Each tile's mean over its rect, as the atlas tool computed it, so the orientation is pinned by
    // every tile at once (a flipped or mirrored read moves the pictures between rects).
    let tiles = 0;
    for (const [id, t] of Object.entries(layout.tiles)) {
      const [u0, v0, u1, v1] = t.rect;
      const x0 = Math.round(u0 * img.width);
      const x1 = Math.round(u1 * img.width);
      const y0 = Math.round(v0 * img.height);
      const y1 = Math.round(v1 * img.height);
      const sum = [0, 0, 0];
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          for (let c = 0; c < 3; c++) sum[c]! += img.rgba[(y * img.width + x) * 4 + c]!;
      const n = (x1 - x0) * (y1 - y0);
      const hex = `#${sum
        .map((v) =>
          Math.round(v / n)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')}`;
      expect(hex, id).toBe(t.mean);
      tiles++;
    }
    print(
      `[examined] ${SHEET}: ${img.width}x${img.height}, ${tiles} tile means match the layout, white at its UV`,
    );
    expect(tiles).toBeGreaterThan(40);
  });

  it('reads a PNG-8 another encoder wrote (tools/atlas/fixtures/make-pillow-fixture.py)', async () => {
    const img = await decodeAtlasPng(await readRepoFile('tools/atlas/fixtures/pillow-48.png'));
    expect([img.width, img.height]).toEqual([37, 23]);
    // The fixture script's own palette and pixels, recomputed.
    let wrong = 0;
    for (let y = 0; y < 23; y++)
      for (let x = 0; x < 37; x++) {
        const i = (x * 7 + y * 3) % 48;
        const at = (y * 37 + x) * 4;
        const want = [i * 5, 255 - i * 5, (i * 37) % 256, 255];
        if (want.some((v, c) => img.rgba[at + c] !== v)) wrong++;
      }
    print(`[examined] pillow-48.png: ${37 * 23} pixels, ${wrong} wrong`);
    expect(wrong).toBe(0);
  });

  it('becomes a mipmapped sRGB texture that keeps the image the right way up', async () => {
    const tex = atlasTexture(await decodeAtlasPng(pngBytes));
    expect(tex).toBeInstanceOf(DataTexture);
    expect(tex.flipY).toBe(false);
    expect(tex.generateMipmaps).toBe(true);
    expect(tex.minFilter).toBe(LinearMipmapLinearFilter);
    expect(tex.colorSpace).toBe(SRGBColorSpace);
    expect(tex.anisotropy).toBe(4);
  });

  it('refuses a layout whose white tile is not where every baked model puts its plain vertices', () => {
    expect(parseAtlasLayout(layoutJson).white).toEqual([...ATLAS_WHITE_UV]);
    const moved = { ...(layoutJson as object), white: [0.5, 0.5] };
    expect(() => parseAtlasLayout(moved)).toThrow(/white/);
    expect(() => parseAtlasLayout({ ...(layoutJson as object), formatVersion: 2 })).toThrow(/format/);
  });
});

describe('a model with atlas surfaces', () => {
  const layout = parseAtlasLayout(layoutJson);
  const model = bakeModel('duvalKit', readGlb(duvalGlb));

  it('bakes its atlas surfaces with their UVs inside their tiles, and every other vertex on white', () => {
    let atlasVerts = 0;
    let white = 0;
    model.variants.forEach((g, v) => {
      const uv = g.getAttribute('uv');
      expect(uv, `variant ${v}`).toBeDefined();
      const tileOf = new Map<number, string>();
      for (const run of model.tiles?.[v] ?? [])
        for (let i = run.start; i < run.start + run.count; i++) tileOf.set(i, run.tile);
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const w = uv.getY(i);
        const tile = tileOf.get(i);
        if (tile) {
          const rect = layout.tiles[tile]?.rect;
          expect(rect, tile).toBeDefined();
          const [u0, v0, u1, v1] = rect!;
          expect(
            u >= u0 - 1e-6 && u <= u1 + 1e-6 && w >= v0 - 1e-6 && w <= v1 + 1e-6,
            `${tile} ${u},${w}`,
          ).toBe(true);
          atlasVerts++;
        } else {
          expect([u, w]).toEqual([...ATLAS_WHITE_UV]);
          white++;
        }
      }
    });
    print(
      `[examined] duval-kit: ${atlasVerts} atlas-surface vertices inside their tiles, ${white} on the white tile`,
    );
    expect(atlasVerts).toBeGreaterThan(100);
    expect(white).toBeGreaterThan(atlasVerts);
  });

  it("gives its far stand-in the vertex colour times its tile's mean, and keeps the near colour", async () => {
    const atlas: RegionAtlas = {
      sheet: SHEET,
      layout,
      texture: atlasTexture(await decodeAtlasPng(pngBytes)),
    };
    const lit = withAtlas(model, atlas);
    expect(lit.map).toBe(atlas.texture);
    let checked = 0;
    lit.variants.forEach((g, v) => {
      const base = model.variants[v]!.getAttribute('color');
      const col = g.getAttribute('color');
      const far = g.getAttribute('farColor');
      expect(far, `variant ${v}`).toBeDefined();
      const mean = new Map<number, Color>();
      for (const run of model.tiles?.[v] ?? []) {
        const m = new Color(layout.tiles[run.tile]!.mean);
        for (let i = run.start; i < run.start + run.count; i++) mean.set(i, m);
      }
      for (let i = 0; i < col.count; i++) {
        const m = mean.get(i) ?? new Color(1, 1, 1);
        expect(col.getX(i)).toBe(base.getX(i));
        expect(Math.abs(far.getX(i) - base.getX(i) * m.r)).toBeLessThan(1 / 255);
        expect(Math.abs(far.getY(i) - base.getY(i) * m.g)).toBeLessThan(1 / 255);
        expect(Math.abs(far.getZ(i) - base.getZ(i) * m.b)).toBeLessThan(1 / 255);
        checked++;
      }
      // The merge's far stand-in averages the far colours and samples no picture.
      const f = formsOf(g);
      expect(f.near.fcol).toBeDefined();
      expect(f.far.uv ?? null).toBeNull();
    });
    expect(checked).toBeGreaterThan(1000);
  });

  it('falls back to the plain material, its pictures as their tile means, when the sheet is missing', async () => {
    // No layout: nothing to draw with, nothing thrown.
    expect(await loadRegionAtlas(fakeManifest({}), SHEET)).toBeNull();
    // A layout but a sheet that does not decode: no texture, and the model's own colours carry the means.
    const noSheet = await loadRegionAtlas(
      fakeManifest({
        [atlasLayoutAsset(SHEET)]: await readRepoFile(`packs/base/assets/${atlasLayoutAsset(SHEET)}.json`),
        [atlasAsset(SHEET)]: 'broken',
      }),
      SHEET,
    );
    expect(noSheet?.texture).toBeNull();
    const plain = withAtlas(model, noSheet);
    expect(plain.map ?? null).toBeNull();
    const run = model.tiles?.[0]?.find((r) => layout.tiles[r.tile]?.kind === 'art');
    expect(run).toBeDefined();
    const m = new Color(layout.tiles[run!.tile]!.mean);
    const base = model.variants[0]!.getAttribute('color');
    const col = plain.variants[0]!.getAttribute('color');
    expect(Math.abs(col.getX(run!.start) - base.getX(run!.start) * m.r)).toBeLessThan(1 / 255);
    // Both files present: the texture is made.
    const full = await loadRegionAtlas(
      fakeManifest({
        [atlasLayoutAsset(SHEET)]: await readRepoFile(`packs/base/assets/${atlasLayoutAsset(SHEET)}.json`),
        [atlasAsset(SHEET)]: pngBytes,
      }),
      SHEET,
    );
    expect(full?.texture).toBeInstanceOf(DataTexture);
    expect(ATLAS_SHEETS.duvalKit).toBe(SHEET);
  });
});

describe('the merged scenery', () => {
  it('merges an atlas model with plain ones into one block that carries UVs, the plain ones on white', () => {
    const model = bakeModel('duvalKit', readGlb(duvalGlb));
    const plain = new BoxGeometry(1, 1, 1).toNonIndexed();
    const spot = (x: number) =>
      ({
        kind: 'shack',
        variant: 0,
        p: { x, y: 0, z: 0 },
        turn: 0,
        size: 1,
        phase: 0,
        edge: 0,
        s: 0,
        d: 0,
      }) as ScenerySpot;
    const material = createFlatLook().material('prop', { vertexColors: true });
    const merged = new MergedScenery([
      { spot: spot(0), geometry: model.variants[0]!, material },
      { spot: spot(20), geometry: plain, material },
    ]);
    merged.update(0, 0, 1000, 1000, 10);
    const meshes = merged.group.children.filter((o): o is Mesh => o instanceof Mesh);
    expect(meshes).toHaveLength(1);
    const g = meshes[0]!.geometry;
    const uv = g.getAttribute('uv');
    expect(uv.count).toBe(g.getAttribute('position').count);
    const n0 = formsOf(model.variants[0]!).near.n;
    for (let i = n0; i < n0 + plain.getAttribute('position').count; i++)
      expect([uv.getX(i), uv.getY(i)]).toEqual([...ATLAS_WHITE_UV]);
    // A block of plain models only stays as it was: no UVs.
    const bare = new MergedScenery([{ spot: spot(0), geometry: plain, material }]);
    bare.update(0, 0, 1000, 1000, 10);
    expect((bare.group.children[0] as Mesh).geometry.getAttribute('uv')).toBeUndefined();
  });
});

describe('the atlas in every look', () => {
  it('keeps the map and the shared lit program (classic, or ink-solid) whichever look is on', async () => {
    const tex = atlasTexture(await decodeAtlasPng(pngBytes));
    const set = createLookSet(createFlatLook());
    const m = set.material('prop', { vertexColors: true, map: tex }) as MeshLambertMaterial;
    const plain = set.material('prop', { vertexColors: true }) as MeshLambertMaterial;
    for (const id of LOOK_IDS) {
      set.select(id);
      expect(m.map, id).toBe(tex);
      const key = m.customProgramCacheKey();
      expect(['classic', 'ink-solid'], `${id}: ${key}`).toContain(key);
      expect(key, id).toBe(plain.customProgramCacheKey());
    }
  });
});
