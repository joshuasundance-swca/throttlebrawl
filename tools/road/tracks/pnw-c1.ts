// The Pacific Northwest track, hand-authored (playtest 1c, 2026-09-30: "Pnw and sf first then
// others"): a twisty forest two-lane, only inspired by the peninsula roads around a ferry town.
// It starts at the ferry landing, climbs the Switchback Grade (or cuts straight up the gravel
// Logging Spur over a log-deck ramp), winds through Cedar Hollow, crosses a timber trestle over
// the river mouth, runs Espresso Row through town, rolls over Fogline Ridge and ends on the
// Sawmill Flats. Three race lengths share it: short to the end of Cedar Hollow, standard to the
// line on Espresso Row (2 to 3 minutes for the bot with the region's traffic), long to the mill.
// Every name and joke is a placeholder the maintainer may veto. Bake with
// `node tools/road/bake.mjs`.
//
// The compiler pins every junction to the base elevation and builds hills from humps that return
// to it at each road's ends, so the region's climbs are long humps (up to 20 m), not a real grade
// from sea to ridge. That gap is in the region-pnw lane report.
//
// Frame: metres, x east, z south (north is -z). The start faces north.
import type { TrackSource } from '../../../src/road/compile';

/** The pack this track bakes into (the baker reads this export): packs/region-pnw. */
export const PACK = 'region-pnw';

// The same lanes as keys-m1 (playtest 1: 4 m travel lanes, 1.5 m rideable shoulders).
const LANES = [
  { id: 'L0', dCenterM: -4.75, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L1', dCenterM: -2, widthM: 4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 2, widthM: 4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 4.75, widthM: 1.5, direction: 1, kind: 'shoulder' },
] as const;

/** Forest speed limit: 50 mph, below the Keys highway's 55 (nothing reads it yet). */
const FOREST_MPS = 22.4;

export const PNW_C1: TrackSource = {
  network: {
    id: 'pnw-c1',
    name: 'Pacific Northwest forest two-lane (hand-authored)',
    region: 'pacific-northwest',
    crs: { kind: 'tmerc', originLatDeg: 47.6, originLonDeg: -122.9, originElevM: 0 },
    notes:
      'The hand-made Pacific Northwest track: one main road from the ferry landing to the sawmill, and the Logging Spur that splits off at the landing and rejoins at Cedar Hollow. Three routes share it, one per race length.',
  },
  createdAt: '2026-10-01',
  points: [
    // Ferry landing, then the Switchback Grade swinging west (left), so the Logging Spur runs
    // straight up its east side.
    [0, 0],
    [0, -220],
    [-50, -410],
    [-170, -560],
    [-210, -760],
    [-120, -960],
    [-110, -1200],
    // Cedar Hollow: tight bends under the big trees.
    [-70, -1370],
    [30, -1480],
    [150, -1520],
    [250, -1620],
    [260, -1780],
    [190, -1910],
    [190, -2060],
    [270, -2170],
    // The timber trestle: a long straight east over the river mouth.
    [400, -2230],
    [600, -2290],
    [800, -2350],
    [960, -2400],
    // Espresso Row: gentle bends through town.
    [1110, -2490],
    [1180, -2650],
    [1170, -2850],
    [1240, -3020],
    [1380, -3100],
    // Fogline Ridge: rolling sweepers over the crest.
    [1560, -3110],
    [1720, -3200],
    [1800, -3360],
    [1960, -3460],
    [2160, -3440],
    [2320, -3520],
    [2400, -3680],
    // Sawmill Flats: the long straight past the mill.
    [2460, -3880],
    [2520, -4100],
    [2580, -4320],
    [2640, -4540],
  ],
  baseElevationM: 3,
  spacingM: 2,
  smoothingM: 50,
  lanes: LANES,
  roads: [
    {
      id: 'pnw-ferry-landing',
      name: 'Ferry Landing',
      lengthM: 300,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: [
        { s0: 0, s1: 'end', side: 'right', tag: 'marina' },
        { s0: 0, s1: 'end', side: 'left', tag: 'town' },
      ],
      features: [
        {
          kind: 'billboard',
          id: 'sign-landing-overflow',
          s0: 200,
          s1: 210,
          d0: -9,
          d1: -6.5,
          item: 'ferry-overflow',
        },
        {
          kind: 'billboard',
          id: 'bb-landing-priority',
          s0: 240,
          s1: 280,
          d0: -16,
          d1: -7,
          item: 'ferry-priority',
        },
        { kind: 'copSpawn', id: 'ferry-holding-lot', s0: 4, s1: 20, d0: 6.1, d1: 9.6 },
        {
          kind: 'roadsideZone',
          id: 'ferry-walk-ons',
          s0: 60,
          s1: 140,
          d0: -12.6,
          d1: -5.6,
          params: { spawns: 'pedestrians' },
        },
        {
          kind: 'billboard',
          id: 'sign-landing-ferry-wait',
          s0: 150,
          s1: 160,
          d0: 6.5,
          d1: 9,
          item: 'ferry-wait',
        },
        // A boost pad on the right of the lane, lining you up for the Logging Spur's split zone.
        {
          kind: 'boostPad',
          id: 'pad-ferry-landing',
          s0: 230,
          s1: 236,
          d0: 2.5,
          d1: 4.5,
          params: { boostMps: 8, holdS: 1.5, slot: 'pnw-pad-landing' },
        },
        // Playtest 1c item 2: the landing pad's other spot (the race seed picks one), mid-lane.
        {
          kind: 'boostPad',
          id: 'pad-ferry-landing-early',
          s0: 150,
          s1: 156,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'pnw-pad-landing' },
        },
      ],
      barriers: [],
    },
    {
      id: 'c-pnw-spur-split',
      name: 'Spur split',
      connector: true,
      lengthM: 30,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
      features: [],
      barriers: [],
    },
    {
      id: 'pnw-switchback-grade',
      name: 'Switchback Grade',
      lengthM: 840,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [{ centreM: 420, lengthM: 700, heightM: 14 }],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
      features: [
        { kind: 'billboard', id: 'sign-grade-slide', s0: 450, s1: 460, d0: 6.5, d1: 9, item: 'slide-area' },
        { kind: 'billboard', id: 'sign-grade-elk', s0: 620, s1: 630, d0: -9, d1: -6.5, item: 'elk-schedule' },
        {
          kind: 'billboard',
          id: 'sign-grade-log-trucks',
          s0: 40,
          s1: 50,
          d0: 6.5,
          d1: 9,
          item: 'log-trucks',
        },
      ],
      barriers: [],
    },
    {
      id: 'c-pnw-spur-merge',
      name: 'Spur merge',
      connector: true,
      lengthM: 30,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
      features: [],
      barriers: [],
    },
    {
      id: 'pnw-cedar-hollow',
      name: 'Cedar Hollow',
      lengthM: 1250,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [
        { centreM: 380, lengthM: 320, heightM: 7 },
        { centreM: 900, lengthM: 300, heightM: 6 },
      ],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
      features: [
        {
          kind: 'billboard',
          id: 'bb-hollow-summit-smug',
          s0: 250,
          s1: 290,
          d0: -16,
          d1: -7,
          item: 'summit-smug',
        },
        { kind: 'billboard', id: 'sign-hollow-dry', s0: 400, s1: 410, d0: 6.5, d1: 9, item: 'dry-pavement' },
        {
          kind: 'billboard',
          id: 'sign-hollow-no-plaster',
          s0: 560,
          s1: 570,
          d0: 6.5,
          d1: 9,
          item: 'no-plaster',
        },
        {
          kind: 'billboard',
          id: 'sign-hollow-trailhead',
          s0: 900,
          s1: 910,
          d0: -9,
          d1: -6.5,
          item: 'trailhead-full',
        },
        {
          kind: 'billboard',
          id: 'sign-hollow-bigfoot',
          s0: 160,
          s1: 170,
          d0: 6.5,
          d1: 9,
          item: 'bigfoot-crossing',
        },
        {
          kind: 'roadsideZone',
          id: 'bigfoot-photo-op',
          s0: 620,
          s1: 700,
          d0: 5.6,
          d1: 12.6,
          params: { spawns: 'pedestrians' },
        },
        {
          kind: 'billboard',
          id: 'bb-hollow-bigfoot-museum',
          s0: 1080,
          s1: 1120,
          d0: -16,
          d1: -7,
          item: 'bigfoot-museum',
        },
      ],
      barriers: [],
    },
    {
      id: 'pnw-trestle',
      name: 'Timber Trestle',
      lengthM: 850,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: [
        { s0: 0, s1: 100, side: 'both', tag: 'forest' },
        { s0: 100, s1: 760, side: 'both', tag: 'bridge' },
        { s0: 100, s1: 760, side: 'both', tag: 'water-open' },
        { s0: 760, s1: 'end', side: 'both', tag: 'forest' },
      ],
      features: [
        { kind: 'billboard', id: 'bb-trestle-gutter', s0: 780, s1: 820, d0: 7, d1: 16, item: 'gutter-truth' },
        // Run W-R: the fire road's sign, where the split begins (past the dirt band, on the land).
        {
          kind: 'billboard',
          id: 'sign-trestle-fire-road',
          s0: 765,
          s1: 775,
          d0: -14.5,
          d1: -12,
          item: 'fire-road',
        },
        {
          kind: 'roadsideZone',
          id: 'trestle-anglers',
          s0: 560,
          s1: 640,
          d0: -7.1,
          d1: -5.5,
          params: { spawns: 'pedestrians' },
        },
        // The ramp truck parked on the right shoulder near the start of the trestle's straight,
        // with the rest of the straight to land on (the same truck and offsets as keys-m1's).
        {
          kind: 'rampTruck',
          id: 'carrier-trestle',
          s0: 160,
          s1: 182,
          d0: 3.4,
          d1: 5.4,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'pnw-truck' },
        },
        // Playtest 1c item 2: the truck's other spots along the trestle's straight, each landing on it.
        {
          kind: 'rampTruck',
          id: 'carrier-trestle-mid',
          s0: 300,
          s1: 322,
          d0: 3.4,
          d1: 5.4,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'pnw-truck' },
        },
        {
          kind: 'rampTruck',
          id: 'carrier-trestle-far',
          s0: 440,
          s1: 462,
          d0: 3.4,
          d1: 5.4,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'pnw-truck' },
        },
      ],
      barriers: [{ s0: 100, s1: 760, side: 'both', kind: 'rail', heightM: 1 }],
    },
    {
      // Run W-R: the fire road's split, cut from the start of Espresso Row (its features keep their
      // places: every s on the row below is 30 m less than before).
      id: 'c-pnw-fire-split-main',
      name: 'Fire road split',
      connector: true,
      lengthM: 30,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
      features: [],
      barriers: [],
    },
    {
      id: 'pnw-espresso-row',
      name: 'Espresso Row',
      lengthM: 940,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [{ centreM: 570, lengthM: 260, heightM: 4 }],
      tags: [
        { s0: 0, s1: 670, side: 'both', tag: 'town' },
        { s0: 670, s1: 'end', side: 'both', tag: 'forest' },
      ],
      features: [
        {
          kind: 'billboard',
          id: 'sign-row-zipper',
          s0: 70,
          s1: 80,
          d0: -9,
          d1: -6.5,
          item: 'espresso-zipper',
        },
        {
          kind: 'billboard',
          id: 'bb-row-drizzlewood',
          s0: 230,
          s1: 270,
          d0: -16,
          d1: -7,
          item: 'drizzlewood-roast',
        },
        { kind: 'billboard', id: 'bb-row-sogproof', s0: 530, s1: 570, d0: 7, d1: 16, item: 'sogproof-shell' },
        {
          kind: 'roadsideZone',
          id: 'espresso-stand-line',
          s0: 90,
          s1: 190,
          d0: 5.6,
          d1: 12.6,
          params: { spawns: 'pedestrians' },
        },
        {
          kind: 'billboard',
          id: 'sign-row-last-espresso',
          s0: 30,
          s1: 40,
          d0: 6.5,
          d1: 9,
          item: 'last-espresso',
        },
        {
          kind: 'billboard',
          id: 'bb-row-view-lots',
          s0: 390,
          s1: 430,
          d0: -16,
          d1: -7,
          item: 'view-lots',
        },
      ],
      barriers: [],
    },
    {
      // Run W-R: the fire road's merge, cut from the end of Espresso Row.
      id: 'c-pnw-fire-merge-main',
      name: 'Fire road merge',
      connector: true,
      lengthM: 30,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
      features: [],
      barriers: [],
    },
    {
      id: 'pnw-fogline-ridge',
      name: 'Fogline Ridge',
      lengthM: 1000,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [{ centreM: 500, lengthM: 900, heightM: 20 }],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
      features: [
        {
          kind: 'billboard',
          id: 'sign-ridge-wet-road',
          s0: 30,
          s1: 40,
          d0: 6.5,
          d1: 9,
          item: 'wet-road',
        },
      ],
      barriers: [],
    },
    {
      id: 'pnw-sawmill-flats',
      name: 'Sawmill Flats',
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: [
        { s0: 0, s1: 'end', side: 'left', tag: 'forest' },
        { s0: 0, s1: 'end', side: 'right', tag: 'sawmill' },
      ],
      features: [
        {
          kind: 'roadsideZone',
          id: 'sawmill-gate',
          s0: 300,
          s1: 380,
          d0: 5.6,
          d1: 12.6,
          params: { spawns: 'pedestrians' },
        },
        // The sprint to the standard finish.
        {
          kind: 'boostPad',
          id: 'pad-sawmill-sprint',
          s0: 640,
          s1: 646,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'pnw-pad-sprint' },
        },
        // Playtest 1c item 2: the sprint pad's other spots on the flats.
        {
          kind: 'boostPad',
          id: 'pad-sawmill-gate',
          s0: 450,
          s1: 456,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'pnw-pad-sprint' },
        },
        {
          kind: 'boostPad',
          id: 'pad-sawmill-final',
          s0: 800,
          s1: 806,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'pnw-pad-sprint' },
        },
      ],
      barriers: [],
    },
  ],
  branches: [
    {
      // Run W-R (interview, 2026-10-02: marked dirt shortcuts, "fire roads and clear-cuts"): Fire Road
      // 9, a dirt track through the trees behind town, off the end of the trestle and back at the foot
      // of Fogline Ridge. It skips Espresso Row and its line: shorter, loose, over a water bar and a
      // rise of its own. Hug the right edge off the trestle to take it. Its first turn is long, so it
      // holds the trestle's line while the row bends away north.
      leave: {
        road: 'pnw-trestle',
        offsetM: 4,
        lane: 'R1',
        zone: { lengthM: 40, d0: 3, d1: 5.5 },
      },
      join: { road: 'pnw-fogline-ridge', offsetM: 3, lane: 'R1' },
      turnsM: [220, 80],
      lanes: [{ id: 'S1', dCenterM: 0, widthM: 5, direction: 1, kind: 'shortcut' }],
      roads: [
        {
          id: 'c-pnw-fire-in',
          name: 'Fire road gate',
          connector: true,
          lengthM: 30,
          speedLimitMps: FOREST_MPS,
          surface: 'dirt',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
          features: [],
          barriers: [],
        },
        {
          id: 'pnw-fire-road',
          name: 'Fire Road 9',
          speedLimitMps: FOREST_MPS,
          surface: 'dirt',
          humps: [{ centreM: 520, lengthM: 260, heightM: 6 }],
          ramps: [{ id: 'water-bar', s0: 320, lengthM: 15, heightM: 1.5, backM: 5 }],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
          features: [],
          barriers: [],
        },
        {
          id: 'c-pnw-fire-out',
          name: 'Fire road exit',
          connector: true,
          lengthM: 30,
          speedLimitMps: FOREST_MPS,
          surface: 'dirt',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
          features: [],
          barriers: [],
        },
      ],
    },
    {
      // The Logging Spur: a gravel haul road straight up the east side of the Switchback Grade,
      // over a log-deck ramp. Hug the right edge before the split to take it.
      leave: {
        road: 'pnw-ferry-landing',
        offsetM: 4,
        lane: 'R1',
        zone: { lengthM: 40, d0: 3, d1: 5.5 },
      },
      join: { road: 'pnw-cedar-hollow', offsetM: 3, lane: 'R1' },
      turnsM: [60, 60],
      lanes: [{ id: 'S1', dCenterM: 0, widthM: 5, direction: 1, kind: 'shortcut' }],
      roads: [
        {
          id: 'c-pnw-spur-in',
          name: 'Spur gate',
          connector: true,
          lengthM: 30,
          speedLimitMps: FOREST_MPS,
          surface: 'gravel',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
          features: [],
          barriers: [],
        },
        {
          id: 'pnw-logging-spur',
          name: 'Logging Spur',
          speedLimitMps: FOREST_MPS,
          surface: 'gravel',
          humps: [],
          ramps: [{ id: 'log-deck', s0: 400, lengthM: 15, heightM: 1.5, backM: 5 }],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
          features: [],
          barriers: [],
        },
        {
          id: 'c-pnw-spur-out',
          name: 'Spur exit',
          connector: true,
          lengthM: 30,
          speedLimitMps: FOREST_MPS,
          surface: 'gravel',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'forest' }],
          features: [],
          barriers: [],
        },
      ],
    },
  ],
  routes: [
    {
      // Short (about 2.4 km): the landing to the end of Cedar Hollow.
      id: 'pnw-hollow-sprint',
      start: { road: 'pnw-ferry-landing', s: 40, dir: 1 },
      finish: { road: 'pnw-cedar-hollow', s: -40 },
      checkpoints: [
        { road: 'pnw-cedar-hollow', s: 300 },
        { road: 'pnw-cedar-hollow', s: 900 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    },
    {
      // Standard (about 3.9 km, 2 to 3 minutes): over the trestle to the line at the end of the
      // espresso stands on Espresso Row.
      id: 'pnw-espresso-run',
      start: { road: 'pnw-ferry-landing', s: 40, dir: 1 },
      finish: { road: 'pnw-espresso-row', s: 670 },
      checkpoints: [
        { road: 'pnw-cedar-hollow', s: 300 },
        { road: 'pnw-cedar-hollow', s: 900 },
        { road: 'pnw-trestle', s: 400 },
        { road: 'pnw-espresso-row', s: 270 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    },
    {
      // Long (about 6.2 km): on over Fogline Ridge to the end of the Sawmill Flats.
      id: 'pnw-sawmill-haul',
      start: { road: 'pnw-ferry-landing', s: 40, dir: 1 },
      finish: { road: 'pnw-sawmill-flats', s: -40 },
      // On roads both paths share: the fire road skips Espresso Row (run W-R).
      checkpoints: [
        { road: 'pnw-cedar-hollow', s: 300 },
        { road: 'pnw-cedar-hollow', s: 900 },
        { road: 'pnw-trestle', s: 400 },
        { road: 'pnw-fogline-ridge', s: 500 },
        { road: 'pnw-sawmill-flats', s: 500 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
      branches: [
        {
          id: 'fire-road',
          roads: ['c-pnw-fire-in', 'pnw-fire-road', 'c-pnw-fire-out'],
          kind: 'shortcut',
          marked: true,
          sign: 'FIRE ROAD 9. Not a road. Not on fire.',
        },
      ],
    },
  ],
};
