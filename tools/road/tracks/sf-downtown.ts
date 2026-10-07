// San Francisco's downtown, hand-authored (run W-R; interview, 2026-10-02: "SF first = downtown
// towers": a four-lane avenue between invented AI-startup towers, intersections with cross traffic,
// cable cars only on the steep cable-line cross streets; playtest 2, 2026-10-02: "I expected some
// city feeling not just all row houses"). It is only inspired by the city: no real street names and
// no real company. From a waterfront plaza the avenue runs south-west between towers, two lanes each
// way, across a cross street every block (two of them the steep cable-car streets), past the tower
// screens of Burn Rate Row, and finishes at the plaza in front of a deadpan headquarters. Every name
// and number is a placeholder the maintainer may veto. Bake with `node tools/road/bake.mjs`.
//
// The scenery tags this track adds (docs/content-packs.md, "Scenery tags"; src/render/scenery.ts):
//   - `towers`: the downtown frontage, a sidewalk then the towers (src/render/downtown.ts);
//   - `plaza`: open paving with lamps, planters and benches (the waterfront, the headquarters);
//   - `cross-street`: a block's cross street, both sides, with its own traffic waiting at the line;
//   - `cable-crossing`: a steep cable-car cross street, the only place a cable car runs.
// The cross streets are drawn by render and are not roads: nobody turns into them (the network map
// and junction choices are other lanes' work). Their traffic is presentation only and crosses the
// avenue only while no racer or traffic vehicle is near (render/downtown.ts), so it never passes
// through a rider.
//
// Frame: metres, x east, z south (north is -z). The avenue heads south-west from the bay.
import type { BakedBarrier, BakedFeature } from '../../../src/road';
import type { TrackSource } from '../../../src/road/compile';

/** The pack this track bakes into (tools/road/bake.mjs reads it). */
export const PACK = 'region-sf';

// Two drive lanes each way (the merged cross-section contract, #287), 4 m like every hand-made road
// since playtest 1, ids counting out from the middle as the GIS bake names them, and rideable 1.5 m
// shoulders: 9.5 m from the centre line to the edge.
const LANES = [
  { id: 'L0', dCenterM: -8.75, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L2', dCenterM: -6, widthM: 4, direction: -1, kind: 'drive' },
  { id: 'L1', dCenterM: -2, widthM: 4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 2, widthM: 4, direction: 1, kind: 'drive' },
  { id: 'R2', dCenterM: 6, widthM: 4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 8.75, widthM: 1.5, direction: 1, kind: 'shoulder' },
] as const;

/** A city speed limit (35 mph). Informational: traffic cruises at its own type's speed. */
const CITY = 15.6;

/** A cross street's half width along the avenue (two lanes and a parking lane), m. */
export const CROSS_HALF_M = 8;

/** A block's cross street at s, both sides (`cable` for a steep cable-car street). */
const cross = (s: number, cable = false) => ({
  s0: s - CROSS_HALF_M,
  s1: s + CROSS_HALF_M,
  side: 'both' as const,
  tag: cable ? 'cable-crossing' : 'cross-street',
});

/** A side of towers along a whole road (cross streets cut through them: their theme wins). */
const towers = (side: 'left' | 'right' | 'both', s0 = 0, s1: number | 'end' = 'end') => ({
  s0,
  s1,
  side,
  tag: 'towers',
});

/** A sign on the sidewalk (past the 9.5 m edge and its 0.6 m verge), on one side. */
const sign = (id: string, item: string, s: number, side: -1 | 1) => ({
  kind: 'billboard',
  id,
  s0: s,
  s1: s + 10,
  d0: side < 0 ? -13 : 10.5,
  d1: side < 0 ? -10.5 : 13,
  item,
});

// ---- The Plaza Cut (playtest 3, T5.2; the maintainer: "the static one could be used to get to
// shortcuts") ----
/**
 * A truck-only way through the headquarters' plaza: a paved cut-through beside the avenue where the
 * plaza opens, behind a low `jumpable` wall on the right. Only a bike in the air gets over the wall: a
 * rider rides up the car carrier parked in the kerb lane, leaves its lip and steers right. The split
 * zone starts at the lanes' outer edge, so nobody on the ground can pick it, and one who misses the
 * truck rides on along the avenue. No rival and no cop takes it (`aiTake` 0), it carries no traffic,
 * and a boost pad waits on it.
 */
export const PLAZA_CUT = {
  /** The end of Campus Way's first piece, where the split connector starts, in that road's s. */
  splitS: 665,
  connectorM: 30,
  /** The cut returns only after the protected wall ends, through this open main-road merge. */
  mergeM: 48,
  /**
   * The avenue's piece beside the cut, and the cut's own middle road (polish M, punch items 1 and 2:
   * the cut ran beside the avenue as long as the stretch it skipped, so it saved nothing). The avenue
   * now swings 80 m left round the headquarters' plaza in one long sweep (BOW) and back, while the cut
   * runs straight through it: the cut is about 32 m shorter (tools/road/truck-shortcuts.test.ts and
   * tests/sim/ramp-truck-cuts.test.ts hold it). The avenue's piece reaches from the split connector
   * to where it is back on its line, 60 m past the sweep. [default]
   */
  yardM: 688,
  cutM: 655,
  /**
   * Where the cut's road starts: its reference line, 9 m right of the avenue's centre line, half a
   * metre inside the avenue's edge (a junction must lie on the road it leaves), and its one lane,
   * 8 m wide, starting a metre farther right: d 10 to 18 beside the avenue. The junction reference
   * line stays on the avenue, while the usable lane clears its wall and the renderer's 0.3 m lane
   * clearance. The truck's flight reaches this lane; a grounded bike meets the visible wall.
   */
  offsetM: 9,
  laneM: 8,
  laneCentreM: 5,
  /**
   * The car carrier, its lip at s 640 as before. Polish M (punch item 2): off the default 13.7° deck a
   * bike that leaves the lip faster than about 50 m/s comes down on the level harder than the landing's
   * 14 m/s wobble line, however well it is flown. This carrier's deck is longer and shallower, 15 m to
   * the same 2.8 m lip (10.6°), so a straight flight lands clean to about 65 m/s; the truck is drawn
   * 1.3 times as long to match (render scales the model by the run). [default]
   */
  truck: {
    kind: 'rampTruck',
    id: 'carrier-dt-plaza-cut',
    s0: 625,
    s1: 652.5,
    d0: 7.2,
    d1: 9.2,
    params: { rampLengthM: 15, lipHeightM: 2.8 },
  } satisfies BakedFeature,
  /**
   * From the lip to the end of the road, on the right; 1.2 m, the default wall height. It starts where
   * the towers' frontage ends and the plaza opens (s 640): beside the towers the sim's edge is theirs.
   */
  wall: {
    s0: 640,
    s1: 665,
    side: 'right',
    kind: 'wall',
    heightM: 1.2,
    jumpable: true,
  } satisfies BakedBarrier,
  /**
   * The wall goes on along the avenue beside the cut, over the split connector and the next piece: where
   * the cut lies beside it, a rider on the ground could otherwise ride out onto the verge (the off-road
   * switch is on) and be handed across. It stopped 125 m into the piece. Since polish M the avenue swings
   * round the plaza and the cut goes straight through it, and with the course's honest edges (2026-10-06)
   * nothing undrawn holds a rider who leaves the avenue on its right there: he could ride across the
   * plaza onto the cut, or cut the avenue's sweep. So the wall that shuts the plaza runs the whole
   * piece (`yardM`, tools/road/truck-shortcuts.test.ts).
   */
  wallAfter: { s0: 0, s1: 'end', side: 'right', kind: 'wall', heightM: 1.2, jumpable: true } satisfies Omit<
    BakedBarrier,
    's1'
  > & { s1: 'end' },
  wallAlongM: 688,
  sign: 'PLAZA ENTRANCE: DELIVERIES ONLY. Founders arrive by ramp.',
} as const;

/**
 * The scenery of every piece of Campus Way after the cut's split: towers on the left, and the plaza
 * that opens at s 640 on the right.
 */
const CAMPUS_TAIL_TAGS = [towers('left'), { s0: 0, s1: 'end', side: 'right', tag: 'plaza' }] as const;

/**
 * The cut's own roads carry a tag no theme reads, so render draws no towers, plaza or scatter of its
 * own beside them (the avenue's pieces draw the plaza they run through). It is on their right only:
 * road/cross-section.ts gives that side 2 m of soft paving, so a bike that is held to the right
 * through its whole flight is stopped at the cut's side with no crash (before, the cut's right edge
 * was a hard one and it crashed there, in the air). The left side is the avenue's, where a rider is
 * handed back across.
 */
const PLAZA_CUT_TAGS = [{ s0: 0, s1: 'end', side: 'right', tag: 'plaza-cut' }] as const;

export const SF_DOWNTOWN: TrackSource = {
  network: {
    id: 'sf-downtown',
    name: 'San Francisco downtown (hand-authored)',
    region: 'san-francisco',
    // The financial district, so the backdrop's own skyline stands beyond these towers.
    crs: { kind: 'tmerc', originLatDeg: 37.7948, originLonDeg: -122.3945, originElevM: 0 },
    notes:
      'The downtown avenue (run W-R; interview, 2026-10-02: "SF first = downtown towers"): two lanes each way from a waterfront plaza between invented AI-startup towers, a cross street every block with its own traffic, two steep cable-car cross streets, the tower screens of Burn Rate Row, and a deadpan headquarters at the finish. One route.',
  },
  createdAt: '2026-10-02',
  // South-west from the bay: along (-0.7071, 0.7071), swinging 35 m off that line and back three
  // times (long sweeps you take flat out, not corners). The stretch from 1500 m to 2800 m is
  // straight, for the ramp truck's flight.
  // Polish M (punch item 1): past the Plaza Cut's split the avenue swings 80 m left round the
  // headquarters' plaza and back, one sweep over 450 m (a sin² bow, sampled every 28 m; its tightest
  // radius is about 130 m), while the cut goes straight through the plaza. The last point before the
  // sweep is three quarters of the way along the old last chord, so Campus Way up to the split stays
  // where it was (within half a metre). [default]
  points: [
    [0, 0],
    [-212.13, 212.13],
    [-519.72, 470.23],
    [-802.57, 753.07],
    [-1035.91, 1085.41],
    [-1318.75, 1368.25],
    [-1601.6, 1651.09],
    [-1955.15, 2004.65],
    [-2283.95, 2241.53],
    [-2549.12, 2506.69],
    [-2566.85, 2528.73],
    [-2580.61, 2554.75],
    [-2591.32, 2583.81],
    [-2600.39, 2614.53],
    [-2609.45, 2645.24],
    [-2620.16, 2674.3],
    [-2633.92, 2700.32],
    [-2651.65, 2722.36],
    [-2673.69, 2740.09],
    [-2699.71, 2753.85],
    [-2728.78, 2764.56],
    [-2759.49, 2773.62],
    [-2790.2, 2782.69],
    [-2819.26, 2793.4],
    [-2845.28, 2807.15],
    [-2867.32, 2824.89],
    [-2913.29, 2870.85],
    // Keep the finish's plaza frontage after the longer, accessible shortcut merge.
    [-2971.98, 2929.54],
  ],
  baseElevationM: 1,
  spacingM: 2,
  smoothingM: 30,
  lanes: LANES,
  roads: [
    {
      id: 'sf-dt-founders-plaza',
      name: 'Founders Plaza',
      lengthM: 380,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        towers('left'),
        { s0: 0, s1: 300, side: 'right', tag: 'plaza' },
        towers('right', 300),
        cross(345),
      ],
      features: [
        // The lot cop waits on the plaza beside the grid, off the road.
        { kind: 'copSpawn', id: 'dt-plaza-lot', s0: 4, s1: 20, d0: 10.4, d1: 13.9 },
        {
          kind: 'roadsideZone',
          id: 'dt-plaza-walkers',
          s0: 60,
          s1: 160,
          d0: 10.4,
          d1: 17.4,
          params: { spawns: 'pedestrians' },
        },
        {
          kind: 'billboard',
          id: 'bb-dt-plaza-agi-tuesday',
          s0: 170,
          s1: 210,
          d0: 13,
          d1: 22,
          item: 'dt-agi-tuesday',
        },
        sign('sign-dt-plaza-beta', 'dt-intersection-beta', 250, -1),
        {
          kind: 'boostPad',
          id: 'pad-dt-plaza',
          s0: 110,
          s1: 116,
          d0: 0.5,
          d1: 3.5,
          params: { boostMps: 8, holdS: 1.5, slot: 'dt-pad-plaza' },
        },
        {
          kind: 'boostPad',
          id: 'pad-dt-plaza-late',
          s0: 230,
          s1: 236,
          d0: 0.5,
          d1: 3.5,
          params: { boostMps: 8, holdS: 1.5, slot: 'dt-pad-plaza' },
        },
      ],
      barriers: [],
    },
    {
      id: 'sf-dt-inference-ave',
      name: 'Inference Avenue',
      lengthM: 820,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 430, lengthM: 520, heightM: 3 }],
      tags: [towers('both'), cross(150), cross(360), cross(570), cross(770)],
      features: [
        sign('sign-dt-inference-no-turns', 'dt-no-turns', 60, 1),
        sign('sign-dt-inference-launch', 'dt-lane-launch', 250, -1),
        sign('sign-dt-inference-walk', 'dt-walk-legacy', 470, 1),
        {
          kind: 'roadsideZone',
          id: 'dt-inference-corner',
          s0: 330,
          s1: 390,
          d0: -14.4,
          d1: -10.4,
          params: { spawns: 'pedestrians' },
        },
        {
          kind: 'roadsideZone',
          id: 'dt-inference-corner-2',
          s0: 680,
          s1: 740,
          d0: 10.4,
          d1: 14.4,
          params: { spawns: 'pedestrians' },
        },
      ],
      barriers: [],
    },
    {
      // The avenue crosses the flank of the hill the cable cars climb: two steep cable streets.
      id: 'sf-dt-cable-crossing',
      name: 'Cable Hill Crossing',
      lengthM: 700,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 330, lengthM: 560, heightM: 5 }],
      tags: [towers('both'), cross(160, true), cross(420, true), cross(640)],
      features: [
        sign('sign-dt-cable-seniority', 'dt-cable-seniority', 90, 1),
        sign('sign-dt-cable-grip', 'cable-grip', 380, -1),
        sign('sign-dt-cable-yield', 'yield-cable-cars', 545, 1),
        {
          kind: 'roadsideZone',
          id: 'dt-cable-stop',
          s0: 470,
          s1: 530,
          d0: -14.4,
          d1: -10.4,
          params: { spawns: 'pedestrians' },
        },
      ],
      barriers: [],
    },
    {
      // The tower screens. Straight from end to end: the car carrier's flight lands on straight road.
      id: 'sf-dt-burn-rate-row',
      name: 'Burn Rate Row',
      lengthM: 820,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [towers('both'), cross(110), cross(340), cross(600), cross(790)],
      features: [
        sign('sign-dt-burn-shuttles', 'shuttles-only', 40, -1),
        sign('sign-dt-burn-robotaxi', 'robotaxi-cones', 400, 1),
        sign('sign-dt-burn-servers', 'dt-servers', 680, -1),
        // A car carrier double-parked in the kerb lane, its deck down as a ramp (two spots; the race
        // seed picks one).
        {
          kind: 'rampTruck',
          id: 'carrier-dt-burn-rate',
          s0: 180,
          s1: 201.1,
          d0: 7.2,
          d1: 9.2,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'dt-truck' },
        },
        {
          kind: 'rampTruck',
          id: 'carrier-dt-burn-rate-late',
          s0: 440,
          s1: 461.1,
          d0: 7.2,
          d1: 9.2,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'dt-truck' },
        },
      ],
      barriers: [],
    },
    {
      // Campus Way up to the plaza's gate (playtest 3, T5.2): the truck, the wall and the split zone
      // of the Plaza Cut stand on its last 40 m.
      id: 'sf-dt-campus-way',
      name: 'Campus Way',
      lengthM: PLAZA_CUT.splitS,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 300, lengthM: 400, heightM: 2 }],
      tags: [
        towers('left'),
        towers('right', 0, 640),
        { s0: 640, s1: 'end', side: 'right', tag: 'plaza' },
        cross(150),
        cross(380),
        cross(600),
      ],
      features: [
        sign('sign-dt-campus-badge', 'dt-badge-only', 60, 1),
        {
          kind: 'boostPad',
          id: 'pad-dt-campus',
          s0: 260,
          s1: 266,
          d0: 0.5,
          d1: 3.5,
          params: { boostMps: 8, holdS: 1.5, slot: 'dt-pad-campus' },
        },
        {
          kind: 'boostPad',
          id: 'pad-dt-campus-late',
          s0: 470,
          s1: 476,
          d0: 0.5,
          d1: 3.5,
          params: { boostMps: 8, holdS: 1.5, slot: 'dt-pad-campus' },
        },
        sign('sign-dt-plaza-cut', 'dt-plaza-cut', 575, 1),
        // Playtest 3 (T5.2; the maintainer: "the static one could be used to get to shortcuts"): a car
        // carrier that is always there (no slot), double-parked in the kerb lane with its deck down. Its
        // lip is 25 m short of the split zone, so a bike that leaves it and steers right is still in the
        // air when it reaches the zone, out past the wall.
        PLAZA_CUT.truck,
      ],
      barriers: [PLAZA_CUT.wall],
    },
    {
      id: 'c-dt-plaza-split',
      name: 'Campus Way',
      connector: true,
      lengthM: PLAZA_CUT.connectorM,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: CAMPUS_TAIL_TAGS,
      features: [],
      barriers: [PLAZA_CUT.wallAfter],
    },
    {
      // Beside the Plaza Cut, then round the plaza and back (polish M): the same avenue, with the main
      // road's own traffic.
      id: 'sf-dt-campus-yard',
      name: 'Campus Way',
      lengthM: PLAZA_CUT.yardM,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: CAMPUS_TAIL_TAGS,
      features: [
        // The plaza's board and its walkers stand clear of the cut (its band reaches d 16.5).
        {
          kind: 'billboard',
          id: 'bb-dt-campus-inevitable',
          s0: 10,
          s1: 50,
          d0: 17.5,
          d1: 26,
          item: 'dt-inevitable',
        },
        {
          kind: 'roadsideZone',
          id: 'dt-campus-plaza',
          s0: 65,
          s1: 165,
          d0: 17,
          d1: 24,
          params: { spawns: 'pedestrians' },
        },
      ],
      barriers: [{ ...PLAZA_CUT.wallAfter, s1: PLAZA_CUT.wallAlongM }],
    },
    {
      id: 'c-dt-plaza-merge',
      name: 'Campus Way',
      connector: true,
      lengthM: PLAZA_CUT.mergeM,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: CAMPUS_TAIL_TAGS,
      features: [],
      barriers: [],
    },
    {
      // The last of Campus Way, to the headquarters' plaza: the route's finish is on it.
      id: 'sf-dt-campus-end',
      name: 'Campus Way',
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: CAMPUS_TAIL_TAGS,
      features: [
        {
          kind: 'billboard',
          id: 'bb-dt-campus-series-z',
          s0: 6,
          s1: 46,
          d0: 17.5,
          d1: 26,
          item: 'dt-series-z',
        },
      ],
      barriers: [],
    },
  ],
  branches: [
    {
      // The Plaza Cut (playtest 3, T5.2): a paved cut-through beside the avenue where the plaza opens,
      // behind a jumpable wall on the right; only the car carrier's flight reaches it. The zone starts
      // at the lanes' outer edge, so a rider on the ground can never pick it.
      leave: {
        road: 'sf-dt-campus-way',
        offsetM: PLAZA_CUT.offsetM,
        lane: 'R2',
        zone: { lengthM: 25, d0: 9.5, d1: 16.5 },
      },
      join: { road: 'sf-dt-campus-end', offsetM: 2, lane: 'R2' },
      turnsM: [20, 20],
      // Points 9 m right of the avenue's centre line, 70 and 150 m past the split, keep its entrance
      // clear of the curved wall while the sim's hand-over can act. The last point lies at the bowed
      // avenue's wall end: the cut crosses the plaza, then returns through the open merge.
      via: [
        { x: -2463.815587, z: 2402.292058, headingDeg: -136.063537, turnM: 20 },
        { x: -2518.937842, z: 2460.482229, headingDeg: -137.045372, turnM: 20 },
        { x: -2895.973971, z: 2840.377424, headingDeg: -135.299784, turnM: 20 },
      ],
      lanes: [
        {
          id: 'S1',
          dCenterM: PLAZA_CUT.laneCentreM,
          widthM: PLAZA_CUT.laneM,
          direction: 1,
          kind: 'shortcut',
        },
      ],
      named: {
        // A shortcut since polish M: about 32 m shorter than the avenue round the plaza.
        id: 'sf-dt-plaza-cut',
        kind: 'shortcut',
        marked: true,
        sign: PLAZA_CUT.sign,
        aiTake: 0,
      },
      roads: [
        {
          id: 'c-dt-plaza-in',
          name: 'Plaza gate',
          connector: true,
          lengthM: PLAZA_CUT.connectorM,
          speedLimitMps: CITY,
          surface: 'concrete',
          humps: [],
          tags: PLAZA_CUT_TAGS,
          features: [],
          barriers: [],
        },
        {
          id: 'sf-dt-plaza-cut',
          name: 'Plaza Cut',
          lengthM: PLAZA_CUT.cutM,
          speedLimitMps: CITY,
          surface: 'concrete',
          humps: [],
          tags: PLAZA_CUT_TAGS,
          features: [
            // The reward for the jump, besides a road with no traffic on it.
            {
              kind: 'boostPad',
              id: 'pad-dt-plaza-cut',
              s0: 80,
              s1: 86,
              d0: 2.5,
              d1: 5.5,
              params: { boostMps: 8, holdS: 1.5 },
            },
          ],
          barriers: [],
        },
        {
          id: 'c-dt-plaza-out',
          name: 'Plaza gate',
          connector: true,
          // One bike lane and its soft edge return inside the avenue's open merge band.
          lanes: [{ id: 'S1', dCenterM: 2.75, widthM: 3.5, direction: 1, kind: 'shortcut' }],
          speedLimitMps: CITY,
          surface: 'concrete',
          humps: [],
          tags: PLAZA_CUT_TAGS,
          features: [],
          barriers: [],
        },
      ],
    },
  ],
  routes: [
    {
      id: 'sf-downtown-run',
      name: 'Downtown',
      start: { road: 'sf-dt-founders-plaza', s: 40, dir: 1 },
      finish: { road: 'sf-dt-campus-end', s: -40 },
      checkpoints: [
        { road: 'sf-dt-inference-ave', s: 400 },
        { road: 'sf-dt-cable-crossing', s: 300 },
        { road: 'sf-dt-burn-rate-row', s: 650 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    },
  ],
};
