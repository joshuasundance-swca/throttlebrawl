// The San Francisco track, hand-authored (playtest 1c, 2026-09-30: "Pnw and sf first then
// others"): a crude first city course for the region-sf pack. It is only inspired by the city: no
// real street names and no landmark branding. From the waterfront it turns uphill into a grid of
// steep blocks with crest lips you catch air over, snakes down a switchback street (or drops
// straight down the stair alley shortcut), runs along a row of painted houses, climbs into the fog
// and finishes on the approach to a big orange suspension bridge, a freeway that widens to three
// lanes each way (W-R: the first multi-lane highway, for lane splitting). Every name and number is a
// placeholder the maintainer may veto. Bake with `node tools/road/bake.mjs`.
//
// Limits of the road format this track works inside (follow-ups in the region-sf report):
//   - elevation is a base height plus humps per road, so every road starts and ends at the base
//     height: the hills are separate humps, and the course never climbs for good;
//   - beyond the verge the renderer draws water, not city ground.
//
// Frame: metres, x east, z south (north is -z). The start faces north along the waterfront.
import type { TrackSource } from '../../../src/road/compile';

/** The pack this track bakes into (tools/road/bake.mjs reads it; the default is `base`). */
export const PACK = 'region-sf';

// The same lanes as keys-m1: 4 m travel lanes, rideable 1.5 m shoulders, 5.5 m to the edge.
const LANES = [
  { id: 'L0', dCenterM: -4.75, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L1', dCenterM: -2, widthM: 4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 2, widthM: 4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 4.75, widthM: 1.5, direction: 1, kind: 'shoulder' },
] as const;

/** A city speed limit (35 mph). Informational: traffic cruises at its own type's speed. */
const CITY = 15.6;

/**
 * The bridge approach's freeway lanes (W-R; interview, 2026-10-02: "multi-lane highways (4-6
 * lanes, lane splitting)"; "Surprised no 4 lane highway"): `perSide` 4 m drive lanes each way, the
 * innermost exactly the course's own L1 and R1, so riders and cars carry straight on, plus a 1.5 m
 * shoulder each side.
 */
function freewayLanes(perSide: number) {
  const right = Array.from({ length: perSide }, (_v, i) => ({
    id: `R${i + 1}`,
    dCenterM: 2 + 4 * i,
    widthM: 4,
    direction: 1 as const,
    kind: 'drive' as const,
  }));
  const shoulder = {
    id: 'R0',
    dCenterM: 4 * perSide + 0.75,
    widthM: 1.5,
    direction: 1 as const,
    kind: 'shoulder' as const,
  };
  const mirror = (l: (typeof right)[number] | typeof shoulder) => ({
    ...l,
    id: `L${l.id.slice(1)}`,
    dCenterM: -l.dCenterM,
    direction: -1 as const,
  });
  return [mirror(shoulder), ...[...right].reverse().map(mirror), ...right, shoulder];
}

/** A freeway speed limit (55 mph). Informational, like CITY. */
const FREEWAY = 24.6;

/** Row houses as walls along a block, both sides, short of the road's ends. */
const rowHouses = (s0: number, s1: number) => ({
  s0,
  s1,
  side: 'both' as const,
  kind: 'wall' as const,
  heightM: 3,
});

export const SF_HILLS: TrackSource = {
  network: {
    id: 'sf-hills',
    name: 'San Francisco hills course (hand-authored)',
    region: 'san-francisco',
    crs: { kind: 'tmerc', originLatDeg: 37.77, originLonDeg: -122.42, originElevM: 0 },
    notes:
      'The hand-made San Francisco course (playtest 1c): waterfront, two steep blocks with crest lips, a switchback street with a stair-alley shortcut, painted row houses, a foggy climb and the bridge approach. One route, the standard length.',
  },
  createdAt: '2026-10-01',
  points: [
    // The waterfront, north.
    [0, 0],
    [0, -420],
    // Left, up into the grid: the cable-car blocks run straight west.
    [-60, -490],
    [-200, -500],
    [-450, -500],
    [-700, -500],
    // Right, north, onto the switchback street. Its bends swing west of the straight line, so the
    // stair alley runs straight down their east side.
    [-770, -560],
    [-770, -700],
    [-810, -750],
    [-860, -800],
    [-820, -860],
    [-870, -920],
    [-820, -980],
    [-775, -1030],
    [-770, -1120],
    // Left, west along the painted row houses.
    [-830, -1190],
    [-1000, -1200],
    [-1300, -1200],
    // Right, north, up into the fog.
    [-1370, -1270],
    [-1380, -1500],
    [-1380, -1780],
    // A long bend left onto the bridge approach.
    [-1430, -1940],
    [-1580, -2080],
    [-1820, -2180],
    [-2120, -2230],
  ],
  baseElevationM: 3,
  spacingM: 2,
  smoothingM: 30,
  lanes: LANES,
  roads: [
    {
      id: 'sf-pier-row',
      name: 'Pier Row',
      lengthM: 520,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        { s0: 0, s1: 'end', side: 'right', tag: 'piers' },
        { s0: 0, s1: 'end', side: 'right', tag: 'water-open' },
        { s0: 0, s1: 'end', side: 'left', tag: 'warehouses' },
      ],
      features: [
        {
          kind: 'billboard',
          id: 'sign-pier-robotaxi',
          s0: 260,
          s1: 270,
          d0: -9,
          d1: -6.5,
          item: 'robotaxi-cones',
        },
        {
          kind: 'billboard',
          id: 'bb-pier-prompt-whisperer',
          s0: 380,
          s1: 420,
          d0: -16,
          d1: -7,
          item: 'prompt-whisperer',
        },
        // Officer Meter waits here, on the shoulder beside the pier lot, not in the drive lane
        // behind the grid where traffic hit him (W-O polish run; keys-m1 and pnw-c1's lots).
        { kind: 'copSpawn', id: 'pier-lot', s0: 4, s1: 20, d0: 6.1, d1: 9.6 },
        {
          kind: 'roadsideZone',
          id: 'pier-row-sidewalk',
          s0: 120,
          s1: 220,
          d0: -12.6,
          d1: -5.6,
          params: { spawns: 'pedestrians', kinds: ['sea-lion', 'e-scooter-commuter', 'dog-walker-sf'] },
        },
        {
          kind: 'billboard',
          id: 'bb-pier-row',
          s0: 160,
          s1: 200,
          d0: -16,
          d1: -7,
          item: 'sleep-as-a-service',
        },
        {
          kind: 'boostPad',
          id: 'pad-pier-row',
          s0: 90,
          s1: 96,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'sf-pad-pier' },
        },
        // Playtest 1c item 2: the pier pad's other spot (the race seed picks one).
        {
          kind: 'boostPad',
          id: 'pad-pier-row-late',
          s0: 300,
          s1: 306,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'sf-pad-pier' },
        },
      ],
      barriers: [],
    },
    {
      // Two steep blocks, each with a lip at the crest where the cross street flattens out.
      id: 'sf-cable-line-grade',
      name: 'Cable Line Grade',
      lengthM: 760,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [
        { centreM: 190, lengthM: 240, heightM: 13 },
        { centreM: 450, lengthM: 240, heightM: 15 },
      ],
      ramps: [
        { id: 'crest-first-block', s0: 182, lengthM: 10, heightM: 0.6, backM: 4 },
        { id: 'crest-second-block', s0: 442, lengthM: 10, heightM: 0.6, backM: 4 },
      ],
      tags: [
        { s0: 0, s1: 'end', side: 'both', tag: 'row-houses' },
        { s0: 0, s1: 'end', side: 'both', tag: 'cable-line' },
      ],
      features: [
        {
          kind: 'billboard',
          id: 'sign-cable-shuttles',
          s0: 300,
          s1: 310,
          d0: -9,
          d1: -6.5,
          item: 'shuttles-only',
        },
        { kind: 'billboard', id: 'sign-cable-grip', s0: 560, s1: 570, d0: 6.5, d1: 9, item: 'cable-grip' },
        // The junction choice, signed (W-R; interview, 2026-10-02: "junction choices in races"): the
        // stair alley's split starts 40 m before the block's end, on the right.
        {
          kind: 'billboard',
          id: 'sign-cable-alley-ahead',
          s0: 660,
          s1: 670,
          d0: 6.5,
          d1: 9,
          item: 'alley-keep-right',
        },
        {
          kind: 'billboard',
          id: 'bb-cable-delegatron',
          s0: 600,
          s1: 640,
          d0: -16,
          d1: -7,
          item: 'delegatron',
        },
        {
          kind: 'billboard',
          id: 'sign-cable-grade',
          s0: 60,
          s1: 70,
          d0: 6.5,
          d1: 9,
          item: 'yield-cable-cars',
        },
      ],
      barriers: [rowHouses(80, 300), rowHouses(340, 560)],
    },
    {
      id: 'c-switchback-split-main',
      name: 'Switchback split',
      connector: true,
      lengthM: 30,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'row-houses' }],
      features: [],
      barriers: [],
    },
    {
      id: 'sf-switchback-street',
      name: 'Switchback Street',
      lengthM: 520,
      speedLimitMps: CITY,
      surface: 'brick',
      humps: [{ centreM: 285, lengthM: 370, heightM: 6 }],
      tags: [
        { s0: 0, s1: 'end', side: 'both', tag: 'gardens' },
        { s0: 0, s1: 'end', side: 'both', tag: 'row-houses' },
      ],
      features: [
        {
          kind: 'billboard',
          id: 'sign-switchback-curb',
          s0: 100,
          s1: 110,
          d0: 6.5,
          d1: 9,
          item: 'curb-wheels',
        },
        {
          kind: 'billboard',
          id: 'bb-switchback-toastwise',
          s0: 380,
          s1: 420,
          d0: 7,
          d1: 16,
          item: 'toastwise',
        },
        {
          kind: 'roadsideZone',
          id: 'switchback-tourists',
          s0: 200,
          s1: 300,
          d0: -12.6,
          d1: -5.6,
          params: { spawns: 'pedestrians' },
        },
      ],
      barriers: [],
    },
    {
      id: 'c-switchback-merge-main',
      name: 'Switchback merge',
      connector: true,
      lengthM: 30,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'row-houses' }],
      features: [],
      barriers: [],
    },
    {
      id: 'sf-painted-row',
      name: 'Painted Row',
      lengthM: 620,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        { s0: 0, s1: 'end', side: 'both', tag: 'painted-houses' },
        { s0: 0, s1: 'end', side: 'both', tag: 'row-houses' },
      ],
      features: [
        {
          kind: 'billboard',
          id: 'sign-painted-row-no-reason',
          s0: 90,
          s1: 100,
          d0: -9,
          d1: -6.5,
          item: 'no-reason',
        },
        {
          kind: 'billboard',
          id: 'bb-painted-row-emptyseat',
          s0: 300,
          s1: 340,
          d0: -16,
          d1: -7,
          item: 'emptyseat',
        },
        {
          kind: 'billboard',
          id: 'sign-painted-row',
          s0: 190,
          s1: 200,
          d0: 6.5,
          d1: 9,
          item: 'street-cleaning',
        },
        {
          kind: 'roadsideZone',
          id: 'painted-row-stoops',
          s0: 420,
          s1: 520,
          d0: 5.6,
          d1: 12.6,
          params: { spawns: 'pedestrians' },
        },
        {
          kind: 'billboard',
          id: 'sign-painted-row-parking',
          s0: 560,
          s1: 570,
          d0: -9,
          d1: -6.5,
          item: 'zero-spaces',
        },
        // A car carrier double-parked on the right, its deck down as a ramp.
        {
          kind: 'rampTruck',
          id: 'carrier-painted-row',
          s0: 250,
          s1: 271.1,
          d0: 3.4,
          d1: 5.4,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'sf-truck' },
        },
        // Playtest 1c item 2: the truck's other spot, at the far end of the block's straight (the
        // only stretch straight from the foot to a top-speed landing), short of the stoops' sidewalk.
        {
          kind: 'rampTruck',
          id: 'carrier-painted-row-late',
          s0: 398,
          s1: 419.1,
          d0: 3.4,
          d1: 5.4,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'sf-truck' },
        },
      ],
      barriers: [],
    },
    {
      // Run W-R: the park cut's split, the Fogline Climb's first 30 m.
      id: 'c-sf-park-split-main',
      name: 'Park cut split',
      connector: true,
      lengthM: 30,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'row-houses' }],
      features: [],
      barriers: [],
    },
    {
      id: 'sf-fogline-climb',
      name: 'Fogline Climb',
      // Run W-R: 60 m shorter (the park cut's split and merge, 30 m each end); every s is 30 m less.
      lengthM: 560,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 300, lengthM: 380, heightM: 22 }],
      ramps: [{ id: 'crest-fogline', s0: 292, lengthM: 10, heightM: 0.6, backM: 4 }],
      tags: [
        { s0: 0, s1: 'end', side: 'both', tag: 'row-houses' },
        { s0: 170, s1: 'end', side: 'both', tag: 'fog' },
      ],
      features: [
        {
          kind: 'billboard',
          id: 'sign-fogline-summer',
          s0: 190,
          s1: 200,
          d0: 6.5,
          d1: 9,
          item: 'summer-fog',
        },
        { kind: 'billboard', id: 'bb-fogline-gpu', s0: 420, s1: 460, d0: -16, d1: -7, item: 'gpu-hour' },
        // At the climb's new foot (its old spot, s 15, is in the park cut's split now).
        { kind: 'billboard', id: 'sign-fogline-grade', s0: 2, s1: 12, d0: 6.5, d1: 9, item: 'steeper-one' },
        { kind: 'billboard', id: 'bb-fogline', s0: 50, s1: 90, d0: 7, d1: 16, item: 'reinvent-the-bus' },
        // Moved off the bridge approach, which has no land beside it (run W-P's verifier: the
        // billboard's posts stood in the bay). Row-house land on both sides here.
        {
          kind: 'billboard',
          id: 'bb-fogline-coldcase',
          s0: 170,
          s1: 210,
          d0: -16,
          d1: -7,
          item: 'coldcase-ai',
        },
        { kind: 'billboard', id: 'sign-fogline-toll', s0: 540, s1: 550, d0: 6.5, d1: 9, item: 'toll-view' },
      ],
      barriers: [],
    },
    {
      // Run W-R: the park cut's merge, the Fogline Climb's last 30 m.
      id: 'c-sf-park-merge-main',
      name: 'Park cut merge',
      connector: true,
      lengthM: 30,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        { s0: 0, s1: 'end', side: 'both', tag: 'row-houses' },
        { s0: 0, s1: 'end', side: 'both', tag: 'fog' },
      ],
      features: [],
      barriers: [],
    },
    {
      // The two-lane on-ramp out of the fog (W-R): it keeps the freeway's width clear of the last
      // row houses at the top of the climb (render draws a road's shoulders at its widest lanes).
      id: 'sf-bridge-onramp',
      name: 'Bridge On-ramp',
      lengthM: 70,
      speedLimitMps: FREEWAY,
      surface: 'asphalt',
      humps: [],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'fog' }],
      features: [],
      barriers: [],
    },
    {
      // The freeway onto the bridge (W-R): two lanes each way, a third from 70 m, so the finish
      // sprint is six lanes of shuttles and robotaxis to thread between. Everything below sits where
      // it stood before the on-ramp took the first 70 m.
      id: 'sf-bridge-approach',
      name: 'Bridge Approach',
      speedLimitMps: FREEWAY,
      surface: 'asphalt',
      laneSections: [
        { s0: 0, lanes: freewayLanes(2) },
        { s0: 70, lanes: freewayLanes(3) },
      ],
      humps: [{ centreM: 410, lengthM: 800, heightM: 14 }],
      tags: [
        { s0: 0, s1: 'end', side: 'both', tag: 'fog' },
        { s0: 180, s1: 'end', side: 'both', tag: 'bridge' },
        { s0: 180, s1: 'end', side: 'both', tag: 'water-open' },
      ],
      // No signs or billboards here: neither side has land (fog, then the bridge over the bay), so
      // a board would stand in the water (run W-P's verifier). Its coldcase-ai billboard and toll
      // sign stand on the fogline climb's row-house land instead.
      features: [
        // A boost for the sprint up onto the bridge, on the open approach.
        {
          kind: 'boostPad',
          id: 'pad-bridge-approach',
          s0: 230,
          s1: 236,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'sf-pad-bridge' },
        },
        // Playtest 1c item 2: the bridge pad's other spot, past the crest, for the sprint home.
        {
          kind: 'boostPad',
          id: 'pad-bridge-approach-late',
          s0: 550,
          s1: 556,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'sf-pad-bridge' },
        },
      ],
      barriers: [{ s0: 180, s1: 'end', side: 'both', kind: 'rail', heightM: 1 }],
    },
  ],
  branches: [
    {
      // Run W-R (interview, 2026-10-02: marked dirt shortcuts, "an SF dirt lot or park cut"): the Park
      // Cut, a dirt path across the park on the inside of the corner, off the end of Painted Row and
      // out at the foot of the bridge on-ramp. It skips the Fogline Climb's 22 m hill and its crest:
      // flatter and shorter, but loose, with garden fences along it. Hug the right edge at the end of
      // Painted Row to take it.
      leave: {
        road: 'sf-painted-row',
        offsetM: 4,
        lane: 'R1',
        zone: { lengthM: 40, d0: 3, d1: 5.5 },
      },
      // It joins the two-lane on-ramp (W-R's freeway), where the bridge approach began before it.
      join: { road: 'sf-bridge-onramp', offsetM: 3, lane: 'R1' },
      // The gate turn is wide enough for a 30 m/s arrival (the shortcut lint needs 100 m here); the
      // join's turn is 50 m, so the cut meets the on-ramp before it runs beside the Fogline Climb's
      // descent (at 70 m it ran 1.3 m under that road's kerb for about 40 m: src/render/verge.test.ts).
      turnsM: [100, 50],
      lanes: [{ id: 'S1', dCenterM: 0, widthM: 5, direction: 1, kind: 'shortcut' }],
      // Named for the routes (W-R): the id it would derive, written into every route that allows it.
      named: {
        id: 'sf-park-cut',
        kind: 'shortcut',
        marked: true,
        sign: 'PARK CUT. Flatter. Muddier. Unfunded.',
      },
      roads: [
        {
          id: 'c-sf-park-in',
          name: 'Park gate',
          connector: true,
          lengthM: 30,
          speedLimitMps: CITY,
          surface: 'dirt',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'gardens' }],
          features: [],
          barriers: [],
        },
        {
          id: 'sf-park-cut',
          name: 'Park Cut',
          speedLimitMps: CITY,
          surface: 'dirt',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'gardens' }],
          features: [
            // The deadpan sign at the park gate, past the grass and the fence, on the park's land.
            { kind: 'billboard', id: 'sign-park-cut', s0: 30, s1: 40, d0: 7, d1: 9.5, item: 'park-cut' },
          ],
          barriers: [],
        },
        {
          id: 'c-sf-park-out',
          name: 'Park exit',
          connector: true,
          lengthM: 30,
          speedLimitMps: CITY,
          surface: 'dirt',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'gardens' }],
          features: [],
          barriers: [],
        },
      ],
    },
    {
      // The stair alley: a narrow lane straight down the east side of the switchback street, with a
      // lip where the stairs start. Hug the right edge before the split to take it.
      leave: {
        road: 'sf-cable-line-grade',
        offsetM: 4,
        lane: 'R1',
        zone: { lengthM: 40, d0: 3, d1: 5.5 },
      },
      join: { road: 'sf-painted-row', offsetM: 3, lane: 'R1' },
      turnsM: [50, 50],
      lanes: [{ id: 'S1', dCenterM: 0, widthM: 5, direction: 1, kind: 'shortcut' }],
      // Named for the routes (W-R): the id the race derived before, so nothing keyed on it changes.
      named: {
        id: 'sf-stair-alley',
        kind: 'shortcut',
        marked: true,
        sign: 'STAIR ALLEY: KEEP RIGHT. No vehicles. Especially yours.',
      },
      roads: [
        {
          id: 'c-stair-alley-in',
          name: 'Alley gate',
          connector: true,
          lengthM: 30,
          speedLimitMps: CITY,
          surface: 'asphalt',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'row-houses' }],
          features: [],
          barriers: [],
        },
        {
          id: 'sf-stair-alley',
          name: 'Stair Alley',
          speedLimitMps: CITY,
          surface: 'concrete',
          humps: [],
          ramps: [{ id: 'stair-lip', s0: 150, lengthM: 12, heightM: 1.2, backM: 5 }],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'row-houses' }],
          features: [],
          barriers: [],
        },
        {
          id: 'c-stair-alley-out',
          name: 'Alley exit',
          connector: true,
          lengthM: 30,
          speedLimitMps: CITY,
          surface: 'asphalt',
          humps: [],
          tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'painted-houses' }],
          features: [],
          barriers: [],
        },
      ],
    },
  ],
  routes: [
    {
      id: 'sf-standard-run',
      start: { road: 'sf-pier-row', s: 40, dir: 1 },
      finish: { road: 'sf-bridge-approach', s: -40 },
      // On roads both paths share, so a stair-alley or park-cut rider passes them too (the park cut
      // skips the Fogline Climb, run W-R).
      checkpoints: [
        { road: 'sf-cable-line-grade', s: 400 },
        { road: 'sf-painted-row', s: 300 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    },
  ],
};
