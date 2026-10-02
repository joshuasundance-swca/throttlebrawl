// The Blender prop catalog: one row per model the pipeline builds (tools/blender/README.md).
// build.mjs, render.mjs and score.mjs read it, and models.test.ts checks every committed GLB
// against it. Budgets are [default] tuning numbers: the phone holds 60 fps at about 50 draws and
// 50k triangles for the WHOLE scene (road, riders, traffic, water and scenery), so each prop is
// lean and instancing-friendly.
//
// `asset` is the asset id under packs/base/assets/ (docs/content-packs.md, "Asset references");
// the GLB lives at packs/base/assets/<asset>.glb. Node names inside a GLB are snake_case.

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
];

/** Roles allowed to export doubleSided (single-sided leaf geometry). Everything else is culled. */
export const DOUBLE_SIDED_ROLES = ['foliage', 'foliage_dark'];

const VARIANT_VIEWS = ['front34', 'front', 'rear34'];
const VIEWS = ['front34', 'side', 'rear34'];

/**
 * @typedef {[number, number]} Range
 * @typedef {object} Prop
 * @property {string} name          snake_case prop name (the script stem)
 * @property {string} script        Blender script, relative to tools/blender/
 * @property {string} asset         asset id under packs/base/assets/
 * @property {'tow_truck' | 'boat' | 'variants' | 'single'} kind  which geometry rules apply
 * @property {{tris?: number, draws?: number, materials: number}} budget  draws = draws_instanced
 * @property {string[]} views       render.py camera views
 * @property {{root: string, hull: string, length: Range, beam: Range, draft: Range,
 *   freeboard: Range, maxHeight: number, maxOverhangM: number}} [boat]
 * @property {{roots: string[], xs: number[], parts: string[], perVariant: {tris: number, draws: number},
 *   height: Range, heights?: Range[], tris?: number[], sway: boolean, sharedMaterials: boolean}} [variants]
 *   `heights` and `tris`, when given, are per root (a kit of small and large props in one GLB).
 * @property {{root: string, nodes: string[], size: [Range, Range, Range]}} [single]
 * @property {string[]} [textSurfaces]  panels the game paints words on (UVs, extras)
 * @property {{names: string[], minHeight: number}} [attach]  wire attach empties
 */

/** @type {Prop[]} */
export const PROPS = [
  {
    name: 'tow_truck',
    script: 'props/tow_truck.py',
    asset: 'models/props/tow-truck',
    kind: 'tow_truck',
    // 9 materials, not the trial's 8: the headlights got their own pale `light_head` lens
    // (the trial's dark-headlight issue). The draw count stays at 16: the lower-deck sedan's
    // windows moved to the dark tyre colour to pay for it.
    budget: { tris: 3000, draws: 16, materials: 9 },
    views: VIEWS,
  },
  {
    name: 'boat',
    script: 'props/boat.py',
    asset: 'models/props/boat',
    kind: 'boat',
    budget: { tris: 1500, draws: 8, materials: 6 },
    boat: {
      root: 'boat',
      hull: 'hull',
      length: [6.5, 8.5],
      beam: [2.2, 2.9],
      draft: [0.2, 0.7],
      freeboard: [0.5, 1.3],
      maxHeight: 3.2,
      // the trial's rods made the boat 3.60 m wide on a 2.52 m hull; nothing may stick out
      // past the hull beam by more than the rub rail
      maxOverhangM: 0.12,
    },
    views: VIEWS,
  },
  {
    name: 'palms',
    script: 'props/palms.py',
    asset: 'models/scenery/palms',
    kind: 'variants',
    budget: { materials: 4 },
    variants: {
      roots: ['palm_a', 'palm_b', 'palm_c'],
      xs: [-4, 0, 4],
      parts: ['trunk', 'fronds'],
      perVariant: { tris: 600, draws: 3 },
      height: [5, 10],
      sway: true,
      sharedMaterials: true,
    },
    views: VARIANT_VIEWS,
  },
  {
    name: 'mangroves',
    script: 'props/mangroves.py',
    asset: 'models/scenery/mangroves',
    kind: 'variants',
    budget: { materials: 3 },
    variants: {
      roots: ['mangrove_a', 'mangrove_b'],
      xs: [-3, 3],
      parts: ['roots', 'canopy'],
      perVariant: { tris: 600, draws: 3 },
      height: [2.5, 6],
      sway: true,
      sharedMaterials: true,
    },
    views: VARIANT_VIEWS,
  },
  {
    name: 'bait_shack',
    script: 'props/bait_shack.py',
    asset: 'models/scenery/bait-shack',
    kind: 'single',
    budget: { tris: 1000, draws: 4, materials: 4 },
    single: {
      root: 'bait_shack',
      nodes: ['bait_shack_body', 'bait_shack_sign'],
      size: [
        [4, 7],
        [3, 6],
        [3, 6],
      ],
    },
    textSurfaces: ['bait_shack_sign'],
    views: VIEWS,
  },
  {
    name: 'power_pole',
    script: 'props/power_pole.py',
    asset: 'models/scenery/power-pole',
    kind: 'single',
    budget: { tris: 300, draws: 2, materials: 2 },
    single: {
      root: 'power_pole',
      nodes: ['power_pole_body'],
      size: [
        [2, 3.2],
        [9, 12],
        [0.2, 0.6],
      ],
    },
    attach: { names: ['wire_attach_1', 'wire_attach_2', 'wire_attach_3'], minHeight: 9 },
    views: VIEWS,
  },
  {
    name: 'skiff',
    script: 'props/skiff.py',
    asset: 'models/scenery/skiff',
    kind: 'boat',
    budget: { tris: 400, draws: 3, materials: 3 },
    boat: {
      root: 'skiff',
      hull: 'skiff_hull',
      length: [4.5, 6],
      beam: [1.5, 2.2],
      draft: [0.1, 0.4],
      freeboard: [0.35, 0.8],
      maxHeight: 2.0,
      maxOverhangM: 0.12,
    },
    views: VIEWS,
  },
  {
    name: 'road_signs',
    script: 'props/road_signs.py',
    asset: 'models/scenery/road-signs',
    kind: 'variants',
    budget: { materials: 4 },
    variants: {
      roots: ['sign_a', 'sign_b'],
      xs: [-2.5, 2.5],
      parts: ['face'],
      perVariant: { tris: 150, draws: 2 },
      height: [1, 4],
      sway: false,
      sharedMaterials: false,
    },
    textSurfaces: ['sign_a_face', 'sign_b_face'],
    views: VARIANT_VIEWS,
  },
  // ---- the region build-out (W-O, maintainer 2026-10-01: "better visuals and experience")
  {
    name: 'conifers',
    script: 'props/conifers.py',
    asset: 'models/scenery/conifers',
    kind: 'variants',
    budget: { materials: 3 },
    variants: {
      roots: ['conifer_a', 'conifer_b', 'conifer_c', 'conifer_d'],
      xs: [-9, -3, 3, 9],
      parts: ['trunk', 'boughs'],
      // a forest road shows hundreds at once: keep each tree lean
      perVariant: { tris: 120, draws: 3 },
      height: [6, 24],
      sway: false,
      sharedMaterials: true,
    },
    views: VARIANT_VIEWS,
  },
  {
    name: 'row_houses',
    script: 'props/row_houses.py',
    asset: 'models/scenery/row-houses',
    kind: 'variants',
    budget: { materials: 9 },
    variants: {
      roots: ['row_house_a', 'row_house_b', 'row_house_c', 'row_house_d'],
      xs: [-10.5, -3.5, 3.5, 10.5],
      parts: ['body'],
      perVariant: { tris: 260, draws: 6 },
      height: [9, 16],
      sway: false,
      sharedMaterials: false,
    },
    views: VARIANT_VIEWS,
  },
  {
    name: 'cable_car',
    script: 'props/cable_car.py',
    asset: 'models/props/cable-car',
    kind: 'single',
    budget: { tris: 900, draws: 8, materials: 8 },
    single: {
      root: 'cable_car',
      nodes: ['cable_car_body'],
      size: [
        [2.4, 3.2],
        [2.8, 3.6],
        [8, 9.2],
      ],
    },
    views: VIEWS,
  },
  {
    name: 'sawmill',
    script: 'props/sawmill.py',
    asset: 'models/scenery/sawmill',
    kind: 'single',
    budget: { tris: 2000, draws: 6, materials: 6 },
    single: {
      root: 'sawmill',
      nodes: ['sawmill_body'],
      size: [
        [25, 40],
        [12, 22],
        [12, 24],
      ],
    },
    views: VIEWS,
  },
  {
    name: 'trestle_bent',
    script: 'props/trestle_bent.py',
    asset: 'models/scenery/trestle-bent',
    kind: 'single',
    budget: { tris: 300, draws: 2, materials: 2 },
    single: {
      root: 'trestle_bent',
      nodes: ['trestle_bent_body'],
      size: [
        [14, 17],
        [9.5, 10.5],
        [0.5, 1.2],
      ],
    },
    views: VIEWS,
  },
  {
    name: 'fog_banks',
    script: 'props/fog_banks.py',
    asset: 'models/scenery/fog-banks',
    kind: 'variants',
    budget: { materials: 1 },
    variants: {
      roots: ['fog_bank_a', 'fog_bank_b'],
      xs: [-40, 40],
      parts: ['body'],
      perVariant: { tris: 320, draws: 1 },
      height: [6, 20],
      sway: false,
      sharedMaterials: true,
    },
    views: VARIANT_VIEWS,
  },
  // ---- the roadside kits (run W-P, "fill the world": roadside density close to the road, so
  // speed is felt, with unique regional flavor). Many small props per GLB, one body each; the game
  // merges them per stretch of road, so their draws do not add up per prop.
  {
    name: 'pnw_roadside',
    script: 'props/pnw_roadside.py',
    asset: 'models/scenery/pnw-roadside',
    kind: 'variants',
    budget: { materials: 17 },
    variants: {
      roots: [
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
      xs: [-40, -34, -28, -22, -16, -10, -2, 8, 16, 24, 34, 46],
      parts: ['body'],
      perVariant: { tris: 240, draws: 10 },
      // fern, salal, stump, rock, mailbox, firewood, split rail, log fence, sign, espresso hut,
      // bigleaf maple, red alder
      tris: [24, 24, 40, 16, 90, 80, 60, 60, 44, 200, 100, 60],
      height: [0.5, 15],
      heights: [
        [0.6, 1.1],
        [0.6, 1.4],
        [0.6, 1.0],
        [0.6, 1.3],
        [1.2, 1.6],
        [1.3, 1.8],
        [1.1, 1.5],
        [0.9, 1.3],
        [2.1, 2.6],
        [3.6, 4.6],
        [11, 15],
        [9.5, 13],
      ],
      sway: false,
      sharedMaterials: false,
    },
    views: VARIANT_VIEWS,
  },
  {
    name: 'sf_roadside',
    script: 'props/sf_roadside.py',
    asset: 'models/scenery/sf-roadside',
    kind: 'variants',
    budget: { materials: 20 },
    variants: {
      roots: [
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
      xs: [-36, -30, -24, -18, -14, -11, -8, -5, -2, 8, 15, 18, 21],
      parts: ['body'],
      perVariant: { tris: 260, draws: 10 },
      // sedan, hatch, robotaxi, street tree, hydrant, scooter, three boards, corner store, parking
      // meter, the three bins, street lamp
      tris: [90, 60, 150, 56, 56, 60, 100, 120, 120, 260, 40, 80, 50],
      height: [0.1, 9],
      heights: [
        [1.3, 1.7],
        [1.3, 1.7],
        [1.6, 2.0],
        [4.5, 6.5],
        [0.7, 1.1],
        [0.1, 0.4],
        [0.9, 1.2],
        [0.9, 1.2],
        [0.9, 1.2],
        [7.5, 8.5],
        [1.3, 1.5],
        [0.9, 1.2],
        [4.4, 4.8],
      ],
      sway: false,
      sharedMaterials: false,
    },
    views: VARIANT_VIEWS,
  },
  {
    name: 'keys_roadside',
    script: 'props/keys_roadside.py',
    asset: 'models/scenery/keys-roadside',
    kind: 'variants',
    // Run W-Q (interview, 2026-10-02: "KEYS FIRST = DISTINCT KEYS") adds each key's props: 30 roles.
    budget: { materials: 30 },
    variants: {
      roots: [
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
      xs: [
        -40, -34, -28, -24, -18, -8, 4, 14, 19, 23, 30, 46, 62, 74, 90, 108, 124, 136, 146, 158, 172, 184,
        194, 203, 212, 222,
      ],
      parts: ['body'],
      perVariant: { tris: 180, draws: 10 },
      // sea grape, sea grape tree, lobster traps, pelican, boat trailer, two cottages, picket
      // section, mailbox, bait board, key lime pie stand; then (W-Q) the fishing village's shrimp
      // boat, fish house and buoy line, the resort strip's two hotels, pool, tiki bar and scooters,
      // the junkyard key's boat rack, bus stack and junk-art robot, and the party key's bunting,
      // coolers, closed bar and flamingo
      tris: [
        40, 60, 120, 64, 80, 180, 180, 48, 60, 120, 170, 170, 180, 190, 220, 220, 120, 200, 380, 140, 70, 190,
        70, 140, 190, 100,
      ],
      height: [0.5, 12],
      heights: [
        [0.8, 1.8],
        [2.4, 3.8],
        [1.1, 1.5],
        [2.8, 3.4],
        [1.3, 1.8],
        [5, 6.2],
        [5, 6.2],
        [0.9, 1.1],
        [1.4, 1.7],
        [1.8, 2.1],
        [2.2, 2.5],
        [7.5, 8.5],
        [5.2, 6],
        [1.8, 2.2],
        [11, 12],
        [11, 12],
        [2.6, 3.2],
        [4, 4.8],
        [1.6, 2],
        [4.3, 4.9],
        [5.4, 6.2],
        [4, 4.6],
        [2.8, 3.2],
        [0.8, 1.1],
        [4.3, 4.9],
        [0.7, 1],
      ],
      sway: false,
      sharedMaterials: false,
    },
    views: VARIANT_VIEWS,
  },
  // ---- run W-Q, distinct keys (interview, 2026-10-02; playtest 2: "Maybe islands in the Keys"):
  // little islands on the open water off every Keys bridge, instanced like the boats.
  {
    name: 'keys_islets',
    script: 'props/keys_islets.py',
    asset: 'models/scenery/keys-islets',
    kind: 'variants',
    budget: { materials: 15 },
    variants: {
      roots: ['keys_islet_shack', 'keys_islet_wreck', 'keys_islet_mangrove', 'keys_islet_stilts'],
      xs: [-60, -20, 20, 60],
      parts: ['body'],
      perVariant: { tris: 320, draws: 9 },
      // the lowest point is 0.8 m under the waterline (the game sinks each islet that far)
      height: [5, 10.5],
      sway: false,
      sharedMaterials: false,
    },
    views: VARIANT_VIEWS,
  },
];

export const ASSET_ROOT = 'packs/base/assets';

/**
 * Repo-relative path of a prop's committed GLB.
 * @param {Prop} prop
 * @returns {string}
 */
export const glbPath = (prop) => `${ASSET_ROOT}/${prop.asset}.glb`;
