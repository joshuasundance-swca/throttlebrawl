// Test helper: a scenery model baked from the committed GLB, the way the game loads it, wherever its
// pack keeps it (the base pack for the Keys' kits, a region pack for its own: CX3's San Francisco
// tower modules live in `region-sf`), with its region atlas applied when the model has one
// (models.ts `ATLAS_SHEETS`), exactly as `loadSceneryModels` does.
import {
  atlasAsset,
  atlasLayoutAsset,
  atlasTexture,
  decodeAtlasPng,
  parseAtlasLayout,
  withAtlas,
} from './atlas';
import { readGlb } from './glb';
import { ATLAS_SHEETS, bakeModel, MODEL_ASSETS, type ModelKind, type SceneryModel } from './models';

const PACKS = ['base', 'region-sf', 'region-pnw'] as const;

type Fs = {
  readFileSync(p: string): Uint8Array;
  existsSync(p: string): boolean;
};

async function fs(): Promise<Fs> {
  const mod: string = 'node:fs';
  return (await import(/* @vite-ignore */ mod)) as Fs;
}

function arrayBuffer(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** The committed file of an asset id with an extension, from whichever pack carries it. */
export async function readAsset(id: string, ext: string): Promise<ArrayBuffer> {
  const f = await fs();
  for (const pack of PACKS) {
    const path = `packs/${pack}/assets/${id}.${ext}`;
    if (f.existsSync(path)) return arrayBuffer(f.readFileSync(path));
  }
  throw new Error(`no pack carries ${id}.${ext}`);
}

/** A region's sheet and its layout, from the committed files. */
export async function readAtlas(sheet: string) {
  const layout = parseAtlasLayout(
    JSON.parse(new TextDecoder().decode(await readAsset(atlasLayoutAsset(sheet), 'json'))),
  );
  const texture = atlasTexture(await decodeAtlasPng(await readAsset(atlasAsset(sheet), 'png')));
  return { sheet, layout, texture };
}

/** The model as the game loads it: baked, and given its region atlas when it has atlas surfaces. */
export async function bakeRepoModel(kind: ModelKind): Promise<SceneryModel> {
  const baked = bakeModel(kind, readGlb(await readAsset(MODEL_ASSETS[kind], 'glb')));
  const sheet = ATLAS_SHEETS[kind];
  return sheet && baked.tiles ? withAtlas(baked, await readAtlas(sheet)) : baked;
}
