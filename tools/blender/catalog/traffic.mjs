// The shared traffic kit (playtest 3, Codex batch CX1): kind `vehicle` rows and the static ramp
// trailer, all in the base pack with no region, because every region's traffic uses them. CX1
// appends here; no other batch edits this file. The vehicle contract is in ../README.md.

import { VIEWS } from './views.mjs';

/** @type {import('../catalog.mjs').Prop[]} */
export const TRAFFIC_PROPS = [
  {
    name: 'sedan',
    script: 'props/sedan.py',
    asset: 'models/traffic/sedan',
    pack: 'base',
    kind: 'vehicle',
    budget: { tris: 360, draws: 6, materials: 6 },
    views: VIEWS,
  },
  {
    name: 'hatchback',
    script: 'props/hatchback.py',
    asset: 'models/traffic/hatchback',
    pack: 'base',
    kind: 'vehicle',
    budget: { tris: 320, draws: 6, materials: 6 },
    views: VIEWS,
  },
  {
    name: 'pickup',
    script: 'props/pickup.py',
    asset: 'models/traffic/pickup',
    pack: 'base',
    kind: 'vehicle',
    budget: { tris: 420, draws: 6, materials: 6 },
    views: VIEWS,
  },
  {
    name: 'suv',
    script: 'props/suv.py',
    asset: 'models/traffic/suv',
    pack: 'base',
    kind: 'vehicle',
    budget: { tris: 380, draws: 6, materials: 6 },
    views: VIEWS,
  },
  {
    name: 'minivan',
    script: 'props/minivan.py',
    asset: 'models/traffic/minivan',
    pack: 'base',
    kind: 'vehicle',
    budget: { tris: 360, draws: 6, materials: 6 },
    views: VIEWS,
  },
  {
    name: 'box_truck',
    script: 'props/box_truck.py',
    asset: 'models/traffic/box-truck',
    pack: 'base',
    kind: 'vehicle',
    budget: { tris: 420, draws: 7, materials: 6 },
    textSurfaces: ['side_panel'],
    views: VIEWS,
  },
  {
    name: 'city_bus',
    script: 'props/city_bus.py',
    asset: 'models/traffic/city-bus',
    pack: 'base',
    kind: 'vehicle',
    budget: { tris: 600, draws: 8, materials: 7 },
    textSurfaces: ['side_panel'],
    views: VIEWS,
  },
  {
    name: 'semi',
    script: 'props/semi.py',
    asset: 'models/traffic/semi',
    pack: 'base',
    kind: 'vehicle',
    budget: { tris: 700, draws: 6, materials: 6 },
    views: VIEWS,
  },
  {
    name: 'ramp_trailer',
    script: 'props/ramp_trailer.py',
    asset: 'models/props/ramp-trailer',
    pack: 'base',
    kind: 'tow_truck',
    rampTrailer: true,
    budget: { tris: 500, draws: 5, materials: 5 },
    views: VIEWS,
  },
];
