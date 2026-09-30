// The M1 track, hand-authored (M1 road-1): about 3.5 km of Keys-flavoured coastal highway, only
// inspired by the Overseas Highway (the real one is the GIS side quest's). One main road through
// Catmull-Rom control points, cut into three roads joined by pass-through junctions. The Keys are
// nearly flat, so the hills are exaggerated bridge humps. Every name and joke is a placeholder
// the maintainer may veto. Bake with `node tools/road/bake.mjs`.
//
// Frame: metres, x east, z south (north is -z). The start faces north.
import type { TrackSource } from '../../../src/road/compile';

const LANES = [
  { id: 'L0', dCenterM: -4.15, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 4.15, widthM: 1.5, direction: 1, kind: 'shoulder' },
] as const;

export const KEYS_M1: TrackSource = {
  network: {
    id: 'keys-m1',
    name: 'Keys M1 coastal highway (hand-authored)',
    region: 'florida-keys',
    crs: { kind: 'tmerc', originLatDeg: 24.7, originLonDeg: -81.1, originElevM: 0 },
    notes:
      'The M1 track: one main road cut into three roads joined end to end by pass-through junctions. road-2 adds the junction and the ramp shortcut.',
  },
  createdAt: '2026-09-30',
  points: [
    [0, 0],
    [0, -220],
    [40, -410],
    [150, -570],
    [190, -760],
    [110, -960],
    [110, -1200],
    [160, -1430],
    [280, -1630],
    [440, -1780],
    [640, -1880],
    [860, -1920],
    [1060, -1930],
    [1240, -2010],
    [1330, -2190],
    [1320, -2400],
    [1250, -2600],
    [1250, -2800],
  ],
  baseElevationM: 1.5,
  spacingM: 2,
  smoothingM: 60,
  lanes: LANES,
  roads: [
    {
      id: 'm1-marina-run',
      name: 'Marina Run',
      lengthM: 1200,
      speedLimitMps: 24.6,
      surface: 'asphalt',
      humps: [{ centreM: 760, lengthM: 220, heightM: 2.5 }],
      tags: [
        { s0: 0, s1: 520, side: 'right', tag: 'marina' },
        { s0: 0, s1: 520, side: 'left', tag: 'strip-mall' },
        { s0: 520, s1: 'end', side: 'both', tag: 'palms' },
      ],
      features: [
        { kind: 'copSpawn', id: 'bait-shop-lot', s0: 4, s1: 20, d0: 5.5, d1: 9 },
        {
          kind: 'roadsideZone',
          id: 'marina-boardwalk',
          s0: 380,
          s1: 480,
          d0: 5,
          d1: 12,
          params: { spawns: 'pedestrians' },
        },
      ],
      barriers: [],
    },
    {
      id: 'm1-pelican-bridge',
      name: 'Pelican Channel Bridge',
      lengthM: 1250,
      speedLimitMps: 24.6,
      surface: 'asphalt',
      humps: [
        { centreM: 420, lengthM: 380, heightM: 8 },
        { centreM: 950, lengthM: 260, heightM: 4.5 },
      ],
      tags: [
        { s0: 0, s1: 'end', side: 'both', tag: 'bridge' },
        { s0: 0, s1: 'end', side: 'both', tag: 'water-open' },
      ],
      features: [
        {
          kind: 'roadsideZone',
          id: 'fishing-rail',
          s0: 680,
          s1: 780,
          d0: -6.5,
          d1: -4.9,
          params: { spawns: 'pedestrians' },
        },
      ],
      barriers: [{ s0: 0, s1: 'end', side: 'both', kind: 'rail', heightM: 1 }],
    },
    {
      id: 'm1-sandbar-causeway',
      name: 'Sandbar Causeway',
      speedLimitMps: 24.6,
      surface: 'asphalt',
      humps: [{ centreM: 560, lengthM: 240, heightM: 4 }],
      tags: [
        { s0: 0, s1: 'end', side: 'both', tag: 'causeway' },
        { s0: 0, s1: 400, side: 'right', tag: 'beach' },
        { s0: 0, s1: 'end', side: 'left', tag: 'water-shallow' },
        { s0: 700, s1: 'end', side: 'right', tag: 'mangrove' },
      ],
      features: [
        {
          kind: 'roadsideZone',
          id: 'sandbar-beach',
          s0: 150,
          s1: 260,
          d0: 5,
          d1: 14,
          params: { spawns: 'pedestrians' },
        },
        {
          kind: 'roadsideZone',
          id: 'tiki-stand',
          s0: 820,
          s1: 900,
          d0: -12,
          d1: -5,
          params: { spawns: 'pedestrians' },
        },
      ],
      barriers: [],
    },
  ],
  route: {
    id: 'm1-skeleton-sprint',
    start: { road: 'm1-marina-run', s: 40, dir: 1 },
    finish: { road: 'm1-sandbar-causeway', s: -40 },
    checkpoints: [
      { road: 'm1-marina-run', s: 900 },
      { road: 'm1-pelican-bridge', s: 625 },
      { road: 'm1-sandbar-causeway', s: 500 },
    ],
    startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
  },
};
