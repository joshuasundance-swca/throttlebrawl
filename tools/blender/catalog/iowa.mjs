// Original stylized Iowa assets. Proportions are authoring choices, not surveyed dimensions.
import { VARIANT_VIEWS } from './views.mjs';

/** @type {import('../catalog.mjs').Prop[]} */
export const IOWA_PROPS = [
  {
    name: 'eagle_stone_tower',
    script: 'props/eagle_stone_tower.py',
    asset: 'models/landmarks/eagle-stone-tower',
    pack: 'region-clinton',
    storage: 'dataset',
    region: 'clinton-iowa',
    kind: 'variants',
    budget: { materials: 5 },
    variants: {
      roots: ['eagle_stone_tower_lod0', 'eagle_stone_tower_lod1'],
      xs: [0, 14],
      parts: ['body'],
      perVariant: { tris: 1400, draws: 5 },
      tris: [1400, 420],
      height: [10, 11],
      sway: false,
      sharedMaterials: true,
      lods: [{ lod0: 'eagle_stone_tower_lod0', lod1: 'eagle_stone_tower_lod1' }],
    },
    views: VARIANT_VIEWS,
  },
];
