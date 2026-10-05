// The Blender models (playtest 1c item 4, approved 2026-09-30: "We can start"): the ramp truck,
// the palms, mangrove clumps, the bait shack, the power pole and the boats, from the base pack's
// GLBs (tools/blender/README.md has the node contract). Each model loads through the asset manifest
// by id and is baked here into one vertex-coloured geometry per variant: every flat material colour
// becomes a vertex colour, so a whole prop is one draw call per instance batch and every look
// recolours it the way it recolours the code-made props (one `prop` or `vehicle` material, no
// textures). Until a model has loaded, or if it fails, the road scene draws a code-made stand-in.
// The region build-out (W-O, the maintainer, 2026-10-01) adds the Pacific Northwest's conifers,
// sawmill and trestle bent and San Francisco's row houses, cable car and fog banks. They load only
// when a race's network needs them (`modelKindsFor`), and a region palette repaints them by role.
// Playtest 3 (T12.1, "models + small atlases"): a model with atlas surfaces (Codex CX2's Duval kit)
// bakes their UVs, every other vertex on the atlas's white tile, and loads its region's atlas with it
// (atlas.ts, `ATLAS_SHEETS`), so it still draws in its merged mesh's one material, with the sheet
// as that material's map.
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix4,
  Vector3,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import type { AssetManifest } from '../assets';
import { ATLAS_WHITE_UV, loadRegionAtlas, withAtlas } from './atlas';
import { BAY_ROOT, BAY_ROOTS, belowDeck } from './bridge-bays';
import { readGlb } from './glb';
import { markAtlasUv } from './scenery-merge';

/** Each model's asset id (docs/content-packs.md, "Asset references"). */
export const MODEL_ASSETS = {
  truck: 'models/props/tow-truck',
  palms: 'models/scenery/palms',
  mangroves: 'models/scenery/mangroves',
  baitShack: 'models/scenery/bait-shack',
  powerPole: 'models/scenery/power-pole',
  skiff: 'models/scenery/skiff',
  boat: 'models/props/boat',
  conifers: 'models/scenery/conifers',
  rowHouses: 'models/scenery/row-houses',
  sawmill: 'models/scenery/sawmill',
  trestleBent: 'models/scenery/trestle-bent',
  fogBanks: 'models/scenery/fog-banks',
  cableCar: 'models/props/cable-car',
  pnwRoadside: 'models/scenery/pnw-roadside',
  sfRoadside: 'models/scenery/sf-roadside',
  keysRoadside: 'models/scenery/keys-roadside',
  // run W-Q: the little islands off every Keys bridge (scenery.ts, the islet kind)
  keysIslets: 'models/scenery/keys-islets',
  // run W-R: San Francisco's downtown towers, screens, headquarters, lamps and signals (downtown.ts)
  sfDowntown: 'models/scenery/sf-downtown',
  // Playtest 3 (T12.4, Codex CX3): San Francisco's stackable towers, in region-sf's pack (downtown.ts)
  sfTowerModules: 'models/scenery/sf-tower-modules',
  // Playtest 3 (T12.1, Codex CX2): Key West's Old Town, the street front along Duval (roadside.ts)
  duvalKit: 'models/scenery/duval-kit',
  // playtest 3, T12.3: the Seven Mile's bays, repair platforms and gap end (bridge-bays.ts)
  sevenMileKit: 'models/scenery/seven-mile-kit',
} as const;
export type ModelKind = keyof typeof MODEL_ASSETS;
export const MODEL_KINDS = Object.keys(MODEL_ASSETS) as ModelKind[];

/** The root nodes of each model: one variant per root, its origin at the anchor the README names. */
const ROOTS: Readonly<Record<ModelKind, readonly string[]>> = {
  truck: ['tow_truck'],
  palms: ['palm_a', 'palm_b', 'palm_c'],
  mangroves: ['mangrove_a', 'mangrove_b'],
  baitShack: ['bait_shack'],
  powerPole: ['power_pole'],
  skiff: ['skiff'],
  boat: ['boat'],
  conifers: ['conifer_a', 'conifer_b', 'conifer_c', 'conifer_d'],
  rowHouses: ['row_house_a', 'row_house_b', 'row_house_c', 'row_house_d'],
  sawmill: ['sawmill'],
  trestleBent: ['trestle_bent'],
  fogBanks: ['fog_bank_a', 'fog_bank_b'],
  cableCar: ['cable_car'],
  pnwRoadside: [
    'pnw_fern',
    'pnw_salal',
    'pnw_stump',
    'pnw_rock',
    'pnw_mailbox',
    'pnw_firewood',
    'pnw_split_rail',
    'pnw_log_fence',
    'pnw_sign',
    'pnw_espresso',
    'pnw_maple',
    'pnw_alder',
  ],
  sfRoadside: [
    'sf_sedan',
    'sf_hatch',
    'sf_robotaxi',
    'sf_tree',
    'sf_hydrant',
    'sf_scooter',
    'sf_board_ai',
    'sf_board_agi',
    'sf_board_gpu',
    'sf_store',
    'sf_meter',
    'sf_bins',
    'sf_lamp',
  ],
  keysIslets: ['keys_islet_shack', 'keys_islet_wreck', 'keys_islet_mangrove', 'keys_islet_stilts'],
  // The kit also holds the cottages, dock and barge of Pigeon Key; only the bays are baked here.
  sevenMileKit: BAY_ROOTS,
  sfDowntown: [
    'dt_tower_glass',
    'dt_tower_stone',
    'dt_tower_screen_agi',
    'dt_tower_screen_series',
    'dt_tower_crown',
    'dt_hq',
    'dt_midrise',
    'dt_lamp',
    'dt_signal',
    'dt_planter',
    'dt_bench',
    'dt_orb',
  ],
  // Five styles (glass, stone, screen, crown, midrise), each a 7 m base, a 14 m four-storey mid and an
  // 8 m crown, in that order: variant = style * 3 + module (downtown.ts stacks them).
  sfTowerModules: [
    'glass_base',
    'glass_mid',
    'glass_crown',
    'stone_base',
    'stone_mid',
    'stone_crown',
    'screen_base',
    'screen_mid',
    'screen_crown',
    'crown_base',
    'crown_mid',
    'crown_crown',
    'midrise_base',
    'midrise_mid',
    'midrise_crown',
  ],
  keysRoadside: [
    'keys_seagrape',
    'keys_seagrape_tree',
    'keys_traps',
    'keys_pelican',
    'keys_trailer',
    'keys_cottage_a',
    'keys_cottage_b',
    'keys_picket',
    'keys_mailbox',
    'keys_bait',
    'keys_pie',
    // run W-Q: each key's own props (roadside.ts KEYS_KIT, by district)
    'keys_shrimp_boat',
    'keys_fish_house',
    'keys_buoy_line',
    'keys_hotel_a',
    'keys_hotel_b',
    'keys_pool',
    'keys_tiki',
    'keys_scooters',
    'keys_boat_stack',
    'keys_bus_stack',
    'keys_junk_art',
    'keys_bunting',
    'keys_coolers',
    'keys_closed_bar',
    'keys_flamingo',
  ],
  // Its variants: 0 to 2 balconied shopfronts, 3 and 4 conch houses, 5 the corner bar, 6 a scooter
  // rack, 7 a palm in a planter (roadside.ts KEYS_KIT, the `oldtown` rules).
  duvalKit: [
    'duval_balcony_a',
    'duval_balcony_b',
    'duval_balcony_c',
    'duval_conch_a',
    'duval_conch_b',
    'duval_corner_bar',
    'duval_scooter_rack',
    'duval_planter_palm',
  ],
};

/**
 * The region atlas each model's atlas surfaces sample (atlas.ts; `textures/atlas/<sheet>`): it loads
 * with the model, and the model draws with it as its map.
 */
export const ATLAS_SHEETS: Readonly<Partial<Record<ModelKind, string>>> = {
  duvalKit: 'florida-keys',
  sfTowerModules: 'san-francisco',
};

/** San Francisco's waterfront tags (run W-U; tools/road/tracks/sf-waterfront.ts). */
export const WATERFRONT_TAGS: readonly string[] = [
  'promenade',
  'pier-shed',
  'ferry-hall',
  'sea-lions',
  'wharf',
  'wharf-street',
  'ferry-plaza',
  'wharf-lot',
];

/** Whether a network has a waterfront at all (any waterfront tag). */
export function hasWaterfrontTags(tags: ReadonlySet<string>): boolean {
  return WATERFRONT_TAGS.some((t) => tags.has(t));
}

/** The models every network draws (the ramp truck, poles, shacks and boats). */
const ALWAYS: readonly ModelKind[] = ['truck', 'powerPole', 'baitShack', 'skiff', 'boat'];

/** What a network's dressing says about the models it needs (see `modelKindsFor`). */
export interface ModelNeeds {
  tropical: boolean;
  /** Every scenery tag on the network's roads. */
  tags: ReadonlySet<string>;
  /** The region's palette keys (fog banks follow `fogBank`). */
  palette: ReadonlySet<string>;
  /** Traffic content ids (the cable car follows a `cable-car` type). */
  traffic: readonly string[];
}

/**
 * The models a race needs, so a region's models load only when a race there starts (the GLBs are
 * separate files: a Keys race never fetches San Francisco's houses).
 */
export function modelKindsFor(n: ModelNeeds): ModelKind[] {
  const out = new Set<ModelKind>(ALWAYS);
  if (n.tropical) {
    out.add('palms');
    out.add('mangroves');
    out.add('keysRoadside');
    out.add('keysIslets');
    // Playtest 3 (T12.1): Key West's Old Town (Duval and Whitehead Streets) lines its street with
    // the Duval kit.
    if (n.tags.has('key-oldtown')) out.add('duvalKit');
    // Playtest 3 (T12.3): the Seven Mile's bays, for the network with the old bridge on it.
    if (n.tags.has('old-bridge')) out.add('sevenMileKit');
  } else {
    if (n.tags.has('forest') || n.tags.has('sawmill')) out.add('conifers');
    if (n.tags.has('sawmill')) out.add('sawmill');
    if (n.tags.has('forest') && n.tags.has('bridge')) out.add('trestleBent');
    const urban = ['row-houses', 'painted-houses', 'gardens'].some((t) => n.tags.has(t));
    if (urban) {
      out.add('rowHouses');
      out.add('sfRoadside');
    }
    // Run W-P: each region's roadside kit (roadside.ts). San Francisco's forest (Twin Peaks)
    // keeps the city's kit; a forest road with no city on it is the Pacific Northwest's.
    else if (n.tags.has('forest') || n.tags.has('sawmill')) out.add('pnwRoadside');
    // Run W-R: San Francisco's downtown (downtown.ts): its own kit, the city kit's cars for the
    // cross traffic and its sidewalk clutter, and the cable car on a cable-car street.
    if (['towers', 'plaza', 'cross-street', 'cable-crossing'].some((t) => n.tags.has(t))) {
      out.add('sfDowntown');
      // Playtest 3 (T12.4): the towers stack CX3's modules, with the San Francisco atlas.
      out.add('sfTowerModules');
      out.add('sfRoadside');
    }
    if (n.tags.has('cable-crossing')) out.add('cableCar');
    // Run W-U: San Francisco's waterfront (waterfront.ts): the Keys' palms along the promenade (the
    // scatter grows no palm off a tropical network, so only that layer stands them), and the city
    // kit's cars, hydrants, scooters and lamps.
    if (hasWaterfrontTags(n.tags)) {
      out.add('palms');
      out.add('sfRoadside');
    }
    // Run W-U: San Francisco's mural alleys (mission.ts) borrow the city kit's lamps and bins.
    if (['shopfronts', 'murals', 'mascot-mural'].some((t) => n.tags.has(t))) out.add('sfRoadside');
  }
  if (n.palette.has('fogBank')) out.add('fogBanks');
  if (n.traffic.some((id) => /cable-car/.test(id))) out.add('cableCar');
  return MODEL_KINDS.filter((k) => out.has(k));
}

/**
 * Region palette keys that repaint a model's material roles (docs/content-packs.md, "Region packs
 * at runtime", Palette): the conifers' greens and bark, the row houses' four paints, the cable
 * car's body. Only these models are repainted; the Keys' models keep their own colours.
 */
export const ROLE_PALETTE: Readonly<Partial<Record<ModelKind, Readonly<Record<string, string>>>>> = {
  conifers: { foliage: 'foliage', foliage_dark: 'foliageDark', bark: 'trunk' },
  rowHouses: {
    paint_pink: 'rowHousePink',
    paint_mint: 'rowHouseMint',
    paint_yellow: 'rowHouseYellow',
    paint_blue: 'rowHouseBlue',
  },
  cableCar: { body: 'cableCar' },
};

/** The truck's ramp, measured on the model (the `ramp_surface` node and its extras). */
export interface RampMeasure {
  /** Run from the foot to the lip along the truck, m. */
  runM: number;
  /** Lip height above the ground, m. */
  lipM: number;
  /** The ramp surface's width, m. */
  widthM: number;
  /** The whole truck's length from the ramp foot, m. */
  lengthM: number;
}

export interface SceneryModel {
  kind: ModelKind;
  /** One merged geometry per variant (position, normal, color), in the variant's own frame. */
  variants: BufferGeometry[];
  /** True when a part is single-sided leaf geometry, so the batch draws both faces. */
  doubleSided: boolean;
  /** The truck's ramp numbers (the truck only). */
  ramp?: RampMeasure;
  /** Per variant, the vertex runs of each material role, so a palette can repaint a role. */
  roles?: readonly RoleRun[][];
  /**
   * Per variant, the vertex runs of each atlas surface and its tile (a mesh with an `atlas_tile`
   * extra). A model with any has a `uv` attribute on every variant: its atlas surfaces' own UVs,
   * and the atlas's white tile for every other vertex (atlas.ts).
   */
  tiles?: readonly TileRun[][];
  /** The region atlas its UVs sample, once loaded (atlas.ts `withAtlas`); without it, it draws plain. */
  map?: Texture;
}

/** A run of vertices baked from one material role. */
export interface RoleRun {
  role: string;
  start: number;
  count: number;
}

/** A run of vertices baked from one atlas surface, and the atlas tile it samples. */
export interface TileRun {
  tile: string;
  start: number;
  count: number;
}

export type SceneryModels = Partial<Record<ModelKind, SceneryModel>>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The atlas tile a mesh's surface samples (its own `atlas_tile` extra, or its node's), or null. */
function atlasTileOf(mesh: Object3D): string | null {
  const own: unknown = mesh.userData['atlas_tile'];
  if (typeof own === 'string' && own) return own;
  const node: unknown = mesh.parent?.userData['atlas_tile'];
  return typeof node === 'string' && node ? node : null;
}

/**
 * Bakes one variant: every mesh under `root`, in the root's frame, flat colours as vertex colours.
 * An atlas surface (playtest 3, T12.1) keeps its UVs; when a variant has any, every other vertex gets
 * the atlas's white tile, so the whole variant draws with the atlas as its map.
 */
function bakeVariant(root: Object3D): {
  geometry: BufferGeometry;
  doubleSided: boolean;
  roles: RoleRun[];
  tiles: TileRun[];
} {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const tiles: TileRun[] = [];
  const m = new Matrix4();
  const nm = new Matrix4();
  const p = new Vector3();
  const n = new Vector3();
  const c = new Color();
  let doubleSided = false;
  const roles: RoleRun[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const col = (mat as { color?: Color } | undefined)?.color;
    c.copy(col ?? new Color(1, 1, 1));
    if (mat && mat.side !== 0) doubleSided = true;
    m.multiplyMatrices(toRoot, mesh.matrixWorld);
    nm.copy(m).invert().transpose();
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const index = g.getIndex();
    const count = index ? index.count : pos.count;
    const start = positions.length / 3;
    roles.push({ role: mat?.name ?? '', start, count });
    const uv = g.getAttribute('uv');
    const tile = uv ? atlasTileOf(mesh) : null;
    if (tile) tiles.push({ tile, start, count });
    for (let i = 0; i < count; i++) {
      const k = index ? index.getX(i) : i;
      p.fromBufferAttribute(pos, k).applyMatrix4(m);
      positions.push(p.x, p.y, p.z);
      if (nrm) n.fromBufferAttribute(nrm, k).applyMatrix4(nm).normalize();
      else n.set(0, 1, 0);
      normals.push(n.x, n.y, n.z);
      colors.push(c.r, c.g, c.b);
      if (tile && uv) uvs.push(uv.getX(k), uv.getY(k));
      else uvs.push(ATLAS_WHITE_UV[0], ATLAS_WHITE_UV[1]);
    }
    // A GLB shipped without normals (the roadside kits, run W-P, to halve their bytes) is faceted:
    // each triangle's normal is its face's.
    if (!nrm) faceNormals(positions, normals, start, count);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  if (tiles.length) geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, doubleSided, roles, tiles };
}

/** Sets the normals of `count` triangle-list vertices from `start` to their faces' normals. */
function faceNormals(positions: number[], normals: number[], start: number, count: number): void {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let v = start; v + 2 < start + count; v += 3) {
    a.fromArray(positions, v * 3);
    b.fromArray(positions, v * 3 + 3).sub(a);
    c.fromArray(positions, v * 3 + 6).sub(a);
    b.cross(c).normalize();
    for (let k = 0; k < 3; k++) b.toArray(normals, (v + k) * 3);
  }
}

/** Bakes a loaded glTF scene into a scenery model. Throws when a root node is missing. */
export function bakeModel(kind: ModelKind, scene: Object3D): SceneryModel {
  scene.updateMatrixWorld(true);
  const variants: BufferGeometry[] = [];
  const roles: RoleRun[][] = [];
  const tiles: TileRun[][] = [];
  let doubleSided = false;
  for (const name of ROOTS[kind]) {
    const root = scene.getObjectByName(name);
    if (!root) throw new Error(`${MODEL_ASSETS[kind]} has no node ${name}`);
    const v = bakeVariant(root);
    // The gap end's barricade and board stand across the lanes at the lip, where a rider passes (the
    // sim has nothing there): only the stub under the deck is drawn (bridge-bays.ts `belowDeck`). Its
    // trimmed geometry keeps no UVs, so it takes no atlas tile runs either.
    const trimmed = kind === 'sevenMileKit' && name === BAY_ROOT.gapEnd;
    variants.push(trimmed ? belowDeck(v.geometry) : v.geometry);
    roles.push(trimmed ? [] : v.roles);
    tiles.push(trimmed ? [] : v.tiles);
    doubleSided ||= v.doubleSided;
  }
  const out: SceneryModel = { kind, variants, doubleSided, roles };
  if (tiles.some((t) => t.length)) {
    out.tiles = tiles;
    // Every variant of an atlas model samples the atlas: the plain ones on its white tile.
    for (const g of variants) {
      markAtlasUv(g);
      if (g.getAttribute('uv')) continue;
      const n = g.getAttribute('position').count;
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) uv.set(ATLAS_WHITE_UV, i * 2);
      g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    }
  }
  if (kind === 'truck') {
    const ramp = scene.getObjectByName('ramp_surface') as Mesh | undefined;
    if (!ramp?.isMesh) throw new Error(`${MODEL_ASSETS.truck} has no ramp_surface`);
    ramp.geometry.computeBoundingBox();
    const box = ramp.geometry.boundingBox;
    const whole = variants[0]?.boundingBox;
    out.ramp = {
      runM: num(ramp.userData['ramp_run_m']) ?? 11.5,
      lipM: num(ramp.userData['ramp_lip_height_m']) ?? 2.8,
      widthM: box ? box.max.x - box.min.x : 2.5,
      lengthM: whole ? whole.max.z : 21,
    };
  }
  return out;
}

/**
 * The model repainted by a region palette: a copy whose variants carry the palette's colour for
 * each role `ROLE_PALETTE` maps, or the model itself when the palette repaints nothing. The copy's
 * geometries are new (the road scene that asked for them disposes them).
 */
export function paintModel(
  model: SceneryModel,
  palette: Readonly<Record<string, string>> | undefined,
): SceneryModel {
  const map = ROLE_PALETTE[model.kind];
  if (!map || !palette || !model.roles) return model;
  const colours = new Map<string, Color>();
  for (const [role, key] of Object.entries(map)) {
    const hex = palette[key];
    if (hex) colours.set(role, new Color(hex));
  }
  if (!colours.size) return model;
  const variants = model.variants.map((g, v) => {
    const copy = g.clone();
    const col = copy.getAttribute('color');
    for (const run of model.roles?.[v] ?? []) {
      const c = colours.get(run.role);
      if (!c) continue;
      for (let i = run.start; i < run.start + run.count; i++) col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    return copy;
  });
  return { ...model, variants };
}

export interface ModelLoadReport {
  loaded: ModelKind[];
  /** Kinds that fell back to the code-made stand-in, with the manifest's reason. */
  fellBack: { kind: ModelKind; error: string }[];
}

/**
 * Loads every model through the asset manifest. A model that is missing, fails its hash or does not
 * parse is left out (the road scene keeps its stand-in) and listed in the report.
 */
export async function loadSceneryModels(
  manifest: AssetManifest,
  kinds: readonly ModelKind[] = MODEL_KINDS,
): Promise<{ models: SceneryModels; report: ModelLoadReport }> {
  const models: SceneryModels = {};
  const report: ModelLoadReport = { loaded: [], fellBack: [] };
  await Promise.all(
    kinds.map(async (kind) => {
      const res = await manifest.load<SceneryModel | null>(MODEL_ASSETS[kind], () => null, {
        decode: (data) => bakeModel(kind, readGlb(data)),
      });
      if (res.value) {
        // Its region atlas loads with it (the manifest loads each file once, however many ask).
        const sheet = ATLAS_SHEETS[kind];
        models[kind] =
          sheet && res.value.tiles ? withAtlas(res.value, await loadRegionAtlas(manifest, sheet)) : res.value;
        report.loaded.push(kind);
      } else report.fellBack.push({ kind, error: res.error ?? 'no stand-in model' });
    }),
  );
  return { models, report };
}

// Landmark kits (playtest 3, round 1: "real landmarks"; docs/content-packs.md, "Gaps and landmarks").
// A kit is a GLB of named root nodes under `models/landmarks/<kit>` that a road file's `landmark`
// features place by name (`<asset id>#<node>`); src/render/landmarks.ts draws them. Unlike the
// scenery kits above, a landmark kit's nodes are not a fixed list: every named root of the file is
// baked, with its numeric extras (`top_m`, `cable_saddle_x_m`, `bay_m`, `cable_entry_m`), so a new
// node needs no code here. A kit the list below does not name is never fetched.

/** Each landmark kit, by its asset id's last part (`models/landmarks/<kit>`). [default] */
export const LANDMARK_KITS = [
  'golden-gate',
  'keys-landmarks',
  'sf-landmarks',
  'pdx-landmarks',
  'gorge-landmarks',
] as const;
export type LandmarkKitId = (typeof LANDMARK_KITS)[number];

const LANDMARK_PREFIX = 'models/landmarks/';

/** A landmark kit's asset id. */
export const landmarkKitAsset = (kit: LandmarkKitId): string => `${LANDMARK_PREFIX}${kit}`;

/**
 * A feature's `model` (`<asset id>#<node>`, or `<kit>#<node>`) split into its kit and node, or null
 * when it names no node or a kit this list does not know (it then draws nothing).
 */
export function parseLandmarkModel(model: string | null): { kit: LandmarkKitId; node: string } | null {
  if (!model) return null;
  const at = model.indexOf('#');
  if (at <= 0 || at === model.length - 1) return null;
  const head = model.slice(0, at);
  const short = head.startsWith(LANDMARK_PREFIX) ? head.slice(LANDMARK_PREFIX.length) : head;
  const kit = LANDMARK_KITS.find((k) => k === short);
  return kit ? { kit, node: model.slice(at + 1) } : null;
}

/**
 * Region palette keys that repaint a landmark kit's material roles: `bridge_paint` (a landmark
 * bridge's paint) follows the palette's `bridgePaint`, so one bridge kit can be repainted per region.
 */
export const LANDMARK_ROLE_PALETTE: Readonly<Record<string, string>> = { bridge_paint: 'bridgePaint' };

/** One root node of a landmark kit, baked in its own frame (origin at the node's own origin). */
export interface LandmarkNode {
  /** Position, normal and colour as a triangle soup (no index). */
  geometry: BufferGeometry;
  /** The node's numeric extras (and its meshes'), by name; the node's own win. */
  extras: Readonly<Record<string, number>>;
  /** The vertex runs of each material role, so a palette can repaint a role. */
  roles: readonly RoleRun[];
}

export interface LandmarkKit {
  id: LandmarkKitId;
  nodes: ReadonlyMap<string, LandmarkNode>;
  /** True when any node has single-sided geometry, so the kit's mesh draws both faces. */
  doubleSided: boolean;
}

/** The numeric extras on a node and under it (a deeper node's never override a shallower one's). */
function numericExtras(root: Object3D): Record<string, number> {
  const out: Record<string, number> = {};
  root.traverse((o) => {
    for (const [k, v] of Object.entries(o.userData)) if (!(k in out) && num(v) !== null) out[k] = v as number;
  });
  return out;
}

/** Bakes a loaded glTF scene into a landmark kit: every named root under the scene is one node. */
export function bakeLandmarkKit(id: LandmarkKitId, scene: Object3D): LandmarkKit {
  scene.updateMatrixWorld(true);
  const nodes = new Map<string, LandmarkNode>();
  let doubleSided = false;
  for (const root of scene.children) {
    if (!root.name || nodes.has(root.name)) continue;
    const v = bakeVariant(root);
    if (v.geometry.getAttribute('position').count === 0) continue;
    nodes.set(root.name, { geometry: v.geometry, extras: numericExtras(root), roles: v.roles });
    doubleSided ||= v.doubleSided;
  }
  return { id, nodes, doubleSided };
}

/**
 * Loads each named landmark kit through the asset manifest. A kit that is missing, fails its hash or
 * does not parse is left out, and a feature that names it draws nothing (never a placeholder box).
 */
export async function loadLandmarkKits(
  manifest: AssetManifest,
  ids: readonly LandmarkKitId[],
): Promise<Map<LandmarkKitId, LandmarkKit>> {
  const kits = new Map<LandmarkKitId, LandmarkKit>();
  await Promise.all(
    ids.map(async (id) => {
      const res = await manifest.load<LandmarkKit | null>(landmarkKitAsset(id), () => null, {
        decode: (data) => bakeLandmarkKit(id, readGlb(data)),
      });
      if (res.value) kits.set(id, res.value);
    }),
  );
  return kits;
}
