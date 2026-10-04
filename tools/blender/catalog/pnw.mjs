// The Pacific Northwest's own models (playtest 3, Codex batch CX4). Every row has
// `pack: 'region-pnw'` and `region: 'pacific-northwest'`, so its GLB lands in
// packs/region-pnw/assets/ and the per-region model budget counts it as the region's. CX4 appends
// here, after the two step-up bikes' rows (playtest 3, T10.2); no other batch edits this file.
import { VIEWS } from './views.mjs';

/** The nodes every bike export names, in the order the scripts make them. */
const BIKE_NODES = [
  'bike_body',
  'wheel_front',
  'wheel_rear',
  'fork',
  'seat_anchor',
  'bar_l',
  'bar_r',
  'peg_l',
  'peg_r',
  'light_head',
  'light_tail',
];

/** @type {import('../catalog.mjs').Prop[]} */
export const PNW_PROPS = [
  // The Grand Tourer 1100 and the Supersport 900 (playtest 3, T10.2, "Six bikes"): the region's two
  // step-up bikes, byte copies of the touring flagship and the Superbike under their own ids (the
  // rider-look rule draws `models/bikes/<bike id>`). Each row reuses its source bike's script, so a
  // rebuild writes the same bytes; Codex replaces the script with the bike's own later, under the
  // same name.
  {
    name: 'grand_tourer_1100',
    script: 'props/touring_flagship.py',
    asset: 'models/bikes/grand-tourer-1100',
    pack: 'region-pnw',
    region: 'pacific-northwest',
    kind: 'single',
    budget: { tris: 1500, draws: 7, materials: 7 },
    single: {
      root: 'bike',
      nodes: BIKE_NODES,
      size: [
        [0.5, 1.5],
        [0.6, 1.9],
        [1.2, 2.9],
      ],
    },
    views: VIEWS,
  },
  {
    name: 'supersport_900',
    script: 'props/superbike_1000.py',
    asset: 'models/bikes/supersport-900',
    pack: 'region-pnw',
    region: 'pacific-northwest',
    kind: 'single',
    budget: { tris: 1500, draws: 7, materials: 7 },
    single: {
      root: 'bike',
      nodes: BIKE_NODES,
      size: [
        [0.5, 1.4],
        [0.8, 1.8],
        [1.7, 2.7],
      ],
    },
    views: VIEWS,
  },
];
