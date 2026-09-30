// The M1 track, hand-authored (M1 road-1): about 3.5 km of Keys-flavoured coastal highway, only
// inspired by the Overseas Highway (the real one is the GIS side quest's). One main road through
// Catmull-Rom control points, cut into roads. Road-2 adds one junction pair: the boat-ramp cut
// splits off after the Marina Run, jumps a ramp and rejoins at the Pelican Channel Bridge, about
// 50 m shorter than the S-bends it skips. The Keys are nearly flat, so the hills are exaggerated
// bridge humps. Every name and joke is a placeholder
// the maintainer may veto. Bake with `node tools/road/bake.mjs`.
//
// Frame: metres, x east, z south (north is -z). The start faces north.
import type { TrackSource } from '../../../src/road/compile';

// Travel lanes 4.0 m wide (M1 had 3.4 m): playtest 1 found the road too narrow to weave round
// traffic. The rideable shoulders stay 1.5 m, so the road's edge is 5.5 m either side of centre.
const LANES = [
  { id: 'L0', dCenterM: -4.75, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L1', dCenterM: -2, widthM: 4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 2, widthM: 4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 4.75, widthM: 1.5, direction: 1, kind: 'shoulder' },
] as const;

export const KEYS_M1: TrackSource = {
  network: {
    id: 'keys-m1',
    name: 'Keys M1 coastal highway (hand-authored)',
    region: 'florida-keys',
    crs: { kind: 'tmerc', originLatDeg: 24.7, originLonDeg: -81.1, originElevM: 0 },
    notes:
      'The M1 track: one main road, and the boat-ramp cut that splits off it at the marina and rejoins at the bridge. The split and merge junctions own connector roads; the other joins pass straight through.',
  },
  createdAt: '2026-09-30',
  points: [
    // The marina S-bends swing west (left) first, so the boat-ramp cut runs straight up their
    // east side. Everything after them is the road-1 shape, moved 220 m west.
    [0, 0],
    [0, -220],
    [-40, -410],
    [-150, -570],
    [-190, -760],
    [-110, -960],
    [-110, -1200],
    [-60, -1430],
    [60, -1630],
    [220, -1780],
    [420, -1880],
    [640, -1920],
    [840, -1930],
    [1020, -2010],
    [1110, -2190],
    [1100, -2400],
    [1030, -2600],
    [1030, -2800],
  ],
  baseElevationM: 1.5,
  spacingM: 2,
  smoothingM: 60,
  lanes: LANES,
  roads: [
    {
      id: 'm1-marina-run',
      name: 'Marina Run',
      lengthM: 300,
      speedLimitMps: 24.6,
      surface: 'asphalt',
      humps: [],
      tags: [
        { s0: 0, s1: 'end', side: 'right', tag: 'marina' },
        { s0: 0, s1: 'end', side: 'left', tag: 'strip-mall' },
      ],
      features: [
        { kind: 'copSpawn', id: 'bait-shop-lot', s0: 4, s1: 20, d0: 6.1, d1: 9.6 },
        // road-3: a billboard in view from the start grid, across from the strip mall's lot.
        {
          kind: 'billboard',
          id: 'bb-marina-timeshare',
          s0: 150,
          s1: 190,
          d0: -16,
          d1: -7,
          item: 'timeshare',
        },
        // Playtest 1b quick wins: a boost pad on the right of the lane, lining you up for the
        // boat-ramp cut's split zone just past it.
        {
          kind: 'boostPad',
          id: 'pad-marina-run',
          s0: 230,
          s1: 236,
          d0: 2.5,
          d1: 4.5,
          params: { boostMps: 8, holdS: 1.5 },
        },
      ],
      barriers: [],
    },
    {
      id: 'c-marina-split-main',
      name: 'Marina split',
      connector: true,
      lengthM: 30,
      speedLimitMps: 24.6,
      surface: 'asphalt',
      humps: [],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'marina' }],
      features: [],
      barriers: [],
    },
    {
      id: 'm1-marina-bends',
      name: 'Marina Bends',
      lengthM: 840,
      speedLimitMps: 24.6,
      surface: 'asphalt',
      humps: [{ centreM: 430, lengthM: 220, heightM: 2.5 }],
      tags: [
        { s0: 0, s1: 190, side: 'left', tag: 'marina' },
        { s0: 0, s1: 190, side: 'right', tag: 'strip-mall' },
        { s0: 190, s1: 'end', side: 'both', tag: 'palms' },
      ],
      features: [
        {
          kind: 'roadsideZone',
          id: 'marina-boardwalk',
          s0: 50,
          s1: 150,
          d0: -12.6,
          d1: -5.6,
          params: { spawns: 'pedestrians' },
        },
      ],
      barriers: [],
    },
    {
      id: 'c-marina-merge-main',
      name: 'Marina merge',
      connector: true,
      lengthM: 30,
      speedLimitMps: 24.6,
      surface: 'asphalt',
      humps: [],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'palms' }],
      features: [],
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
          d0: -7.1,
          d1: -5.5,
          params: { spawns: 'pedestrians' },
        },
        // road-3: a road sign at the foot of the bridge, just outside the right-hand rail.
        {
          kind: 'billboard',
          id: 'sign-bridge-ices',
          s0: 20,
          s1: 30,
          d0: 6.5,
          d1: 9,
          item: 'ices-before-road',
        },
        // Playtest 1b quick wins, on the flat between the humps: a boost pad lined up with a
        // car-carrier tow truck parked on the right shoulder, its rear deck down as a ramp. Hit the
        // pad, ride up the deck, fly. The truck's box stops 0.2 m clear of the widest traffic
        // vehicle in the right lane; the flight lands before the second hump at 44.7 m/s.
        {
          kind: 'boostPad',
          id: 'pad-bridge-flat',
          s0: 570,
          s1: 576,
          d0: 3,
          d1: 5,
          params: { boostMps: 8, holdS: 1.5 },
        },
        {
          kind: 'rampTruck',
          id: 'carrier-bridge-flat',
          s0: 620,
          s1: 642,
          d0: 3.4,
          d1: 5.4,
          params: { rampLengthM: 11.5, lipHeightM: 2.8 },
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
          d0: 5.6,
          d1: 14.6,
          params: { spawns: 'pedestrians' },
        },
        // road-3: the streaming outfit's billboard over the beach.
        {
          kind: 'billboard',
          id: 'bb-causeway-stream',
          s0: 320,
          s1: 360,
          d0: 7,
          d1: 16,
          item: 'stream-outfit',
        },
        {
          kind: 'roadsideZone',
          id: 'tiki-stand',
          s0: 820,
          s1: 900,
          d0: -12.6,
          d1: -5.6,
          params: { spawns: 'pedestrians' },
        },
        // Playtest 1b quick wins: a last boost pad in the right lane for the sprint to the line.
        {
          kind: 'boostPad',
          id: 'pad-causeway-sprint',
          s0: 1040,
          s1: 1046,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5 },
        },
      ],
      barriers: [],
    },
  ],
  branches: [
    {
      // The boat-ramp cut: a gravelly service lane through the boat yard, straight up the east
      // side of the S-bends, over one launch ramp. Hug the right edge before the split to take it.
      leave: {
        road: 'm1-marina-run',
        offsetM: 4,
        lane: 'R1',
        zone: { lengthM: 40, d0: 3, d1: 5.5 },
      },
      join: { road: 'm1-pelican-bridge', offsetM: 3, lane: 'R1' },
      turnsM: [60, 60],
      lanes: [{ id: 'S1', dCenterM: 0, widthM: 5, direction: 1, kind: 'shortcut' }],
      roads: [
        {
          id: 'c-boat-ramp-in',
          name: 'Boat yard gate',
          connector: true,
          lengthM: 30,
          speedLimitMps: 24.6,
          surface: 'asphalt',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'marina' }],
          features: [],
          barriers: [],
        },
        {
          id: 'm1-boat-ramp-cut',
          name: 'Boat Ramp Cut',
          speedLimitMps: 24.6,
          surface: 'asphalt',
          humps: [],
          ramps: [{ id: 'boat-ramp', s0: 400, lengthM: 15, heightM: 1.5, backM: 5 }],
          tags: [
            { s0: 0, s1: 'end', side: 'both', tag: 'marina' },
            { s0: 300, s1: 'end', side: 'right', tag: 'water-shallow' },
          ],
          features: [],
          barriers: [],
        },
        {
          id: 'c-boat-ramp-out',
          name: 'Boat yard exit',
          connector: true,
          lengthM: 30,
          speedLimitMps: 24.6,
          surface: 'asphalt',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'palms' }],
          features: [],
          barriers: [],
        },
      ],
    },
  ],
  routes: [
    {
      id: 'm1-skeleton-sprint',
      start: { road: 'm1-marina-run', s: 40, dir: 1 },
      finish: { road: 'm1-sandbar-causeway', s: -40 },
      // On roads both paths share, so a shortcut rider passes them too.
      checkpoints: [
        { road: 'm1-pelican-bridge', s: 300 },
        { road: 'm1-pelican-bridge', s: 1000 },
        { road: 'm1-sandbar-causeway', s: 500 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    },
  ],
};
