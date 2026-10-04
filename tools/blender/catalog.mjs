// The Blender prop catalog: one row per model the pipeline builds (tools/blender/README.md).
// build.mjs, render.mjs and score.mjs read it, and models.test.ts checks every committed GLB
// against it. Budgets are [default] tuning numbers: the phone holds 60 fps at about 50 draws and
// 50k triangles for the WHOLE scene (road, riders, traffic, water and scenery), so each prop is
// lean and instancing-friendly.
//
// The rows live in one file per batch under catalog/ (playtest 3, C0a): base.mjs holds every row
// made before the split, traffic.mjs the shared traffic kit, and keys.mjs, sf.mjs and pnw.mjs each
// region's own models. This file keeps the roles, the views and the helpers, and concatenates the
// rows into PROPS, so two Codex batches never edit the same rows.
//
// `asset` is the asset id under packs/<pack>/assets/ (docs/content-packs.md, "Asset references");
// the GLB lives at packs/<pack>/assets/<asset>.glb, `pack` defaulting to 'base'. Node names inside
// a GLB are snake_case.
import { BASE_PROPS } from './catalog/base.mjs';
import { KEYS_PROPS } from './catalog/keys.mjs';
import { PNW_PROPS } from './catalog/pnw.mjs';
import { SF_PROPS } from './catalog/sf.mjs';
import { TRAFFIC_PROPS } from './catalog/traffic.mjs';

/** Material roles a prop may use. Flat colours only, one role per slot, so every look applies. */
export const ROLES = [
  'body',
  'body_alt',
  'trim',
  'chrome',
  'glass',
  'tyre',
  'rim',
  'light_head',
  'light_tail',
  'deck',
  'frame',
  'hull',
  'hull_bottom',
  'canvas',
  'seat',
  'engine',
  'bark',
  'foliage',
  'foliage_dark',
  'coconut',
  'car_red',
  'car_blue',
  'car_white',
  'car_yellow',
  'car_green',
  // added for the scenery pack (playtest 1c): buildings, poles and sign blanks
  'wood',
  'roof',
  'sign_face',
  'sign_board',
  // added for the region build-out (W-O, maintainer 2026-10-01): San Francisco's painted houses
  // (one paint role per colour, so a region palette can repaint each) and the fog banks
  'paint_pink',
  'paint_mint',
  'paint_yellow',
  'paint_blue',
  'fog',
  // added for the roadside kits (run W-P, maintainer 2026-10-01b: "unique regional flavor
  // everywhere, like NW tree species"): moss, stone, a lighter leaf green and pale alder bark
  'moss',
  'stone',
  'leaf_light',
  'bark_pale',
  // Bike paints: recolour the tank, fairings and contrasting panels by rider palette.
  'paint_primary',
  'paint_secondary',
  'paint_accent',
  // Police light lenses are flat colour; the renderer supplies any flashing effect.
  'light_red',
  'light_blue',
  // Sticker patches are geometry without logos or textures.
  'decal_a',
  'decal_b',
  'decal_c',
  // added for the playtest 3 asset plan (C0a; scratch plan "assets.md", decision 2), one each:
  // white, so a mesh sampling a colour atlas tile shows the art as authored
  'art',
  // a landmark bridge's paint; a region palette repaints it through its `bridgePaint` key
  'bridge_paint',
  // bridge piers, decks, kerbs and plinths
  'concrete',
  // dark structural steel: truss members, lift towers, gantries
  'steel_dark',
  // brick walls, bonds and edging (a facade tile's greys multiply it)
  'brick',
  // three more house paints, each repaintable on its own, like paint_pink
  'paint_lilac',
  'paint_sage',
  'paint_cream',
  // sign tubing; the game decides any glow, the model stays a flat colour
  'neon',
  // asphalt that is part of a model (a parking pad, a pier deck), not the game's road
  'asphalt',
];

/** Roles allowed to export doubleSided (single-sided leaf geometry). Everything else is culled. */
export const DOUBLE_SIDED_ROLES = ['foliage', 'foliage_dark'];

export { VARIANT_VIEWS, VIEWS } from './catalog/views.mjs';

/**
 * @typedef {[number, number]} Range
 * @typedef {object} Prop
 * @property {string} name          snake_case prop name (the script stem); unique across the catalog
 * @property {string} script        Blender script, relative to tools/blender/
 * @property {string} asset         asset id under packs/<pack>/assets/
 * @property {string} [pack]        the pack the GLB is baked into (default 'base'): a region's own
 *   models go in its region pack (packs/region-sf, packs/region-pnw); the Keys' stay in base
 * @property {string} [region]      informational: the region id the model belongs to (a folder
 *   under packs/<pack>/regions/). The per-region model budget counts a base-pack model as that
 *   region's own only when its row says so; without it a base-pack model counts as shared
 * @property {'tow_truck' | 'boat' | 'variants' | 'single' | 'vehicle'} kind  which geometry rules apply
 * @property {{tris?: number, draws?: number, materials: number}} budget  draws = draws_instanced
 * @property {string[]} views       render.py camera views
 * @property {{root: string, hull: string, length: Range, beam: Range, draft: Range,
 *   freeboard: Range, maxHeight: number, maxOverhangM: number}} [boat]
 * @property {{roots: string[], xs: number[], parts: string[], perVariant: {tris: number, draws: number},
 *   height: Range, heights?: Range[], tris?: number[], sway: boolean, sharedMaterials: boolean,
 *   bays?: {roots: string[], lengthM: number[]},
 *   lods?: {lod0: string, lod1: string, maxRatio?: number}[]}} [variants]
 *   `heights` and `tris`, when given, are per root (a kit of small and large props in one GLB).
 *   `bays` are roots the game repeats along a deck it builds itself: each runs `lengthM` (its
 *   `bay_m` extra) along +Z from its root at deck level (y = 0 is the deck top), and its piers may
 *   reach down to `-pier_m`. `lods` pair a near root with its far stand-in: lod1 keeps at most
 *   `maxRatio` (default 0.3) of lod0's triangles inside lod0's box (5% per axis).
 * @property {{root: string, nodes: string[], size: [Range, Range, Range]}} [single]
 * @property {string[]} [textSurfaces]  panels the game paints words on (UVs, extras)
 * @property {{sheet: string, surfaces: string[]}} [atlas]  mesh nodes whose UVs sample the region's
 *   texture atlas (`sheet` is the region id; the layout is
 *   packs/<pack>/assets/textures/atlas/<sheet>-layout.json); every triangle stays in one tile
 * @property {string[]} [convexParts]  closed convex mesh nodes; the score checks every face is
 *   wound outward (the only front a face has once its normals are dropped)
 * @property {boolean} [keepNormals]  ship the NORMAL attribute (the optimiser drops it otherwise)
 * @property {{names: string[], minHeight: number}} [attach]  wire attach empties
 */

/** The catalog's files, in order (catalog/<file>.mjs); each batch appends to its own file only. */
export const CATALOG_FILES = [
  { file: 'base', rows: BASE_PROPS },
  { file: 'traffic', rows: TRAFFIC_PROPS },
  { file: 'keys', rows: KEYS_PROPS },
  { file: 'sf', rows: SF_PROPS },
  { file: 'pnw', rows: PNW_PROPS },
];

/** @type {Prop[]} */
export const PROPS = CATALOG_FILES.flatMap((f) => f.rows);

/** The pack a prop's GLB is baked into. @param {Prop} prop @returns {string} */
export const packOf = (prop) => prop.pack ?? 'base';

/**
 * Repo-relative path of a prop's committed GLB.
 * @param {Prop} prop
 * @returns {string}
 */
export const glbPath = (prop) => `packs/${packOf(prop)}/assets/${prop.asset}.glb`;

/**
 * Repo-relative path of the layout JSON for a prop's atlas sheet (tools/atlas writes it).
 * @param {Prop} prop
 * @returns {string | null}
 */
export const atlasLayoutPath = (prop) =>
  prop.atlas ? `packs/${packOf(prop)}/assets/textures/atlas/${prop.atlas.sheet}-layout.json` : null;
