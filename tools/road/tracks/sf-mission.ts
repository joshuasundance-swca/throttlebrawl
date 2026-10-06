// San Francisco's mural alleys, hand-authored (run W-U, the pitch deck after playtest 2, #8 "San
// Francisco: a real city": "the Mission's mural alleys, where a mural of the streaming outfit's
// mascot is being painted over mid-race"; interview, 2026-10-02: all four SF districts, the Mission
// among them; playtest 2: "I expected some city feeling not just all row houses"). It is only
// inspired by the district: no real street names, no real mural, no real business. The route
// zig-zags south-east through a flat grid, two-storey shopfronts on the streets and painted walls
// shoulder to shoulder down the alleys. Twice it turns under the corner wall where the streaming
// outfit's mascot was painted, and a crew on a scaffold is painting it over while the race runs
// (src/render/mission.ts: how far they have got follows the race's leader). The satire is on the
// outfit, never on the neighbourhood. Every name and number is a placeholder the maintainer may
// veto. Bake with `node tools/road/bake.mjs`.
//
// The scenery tags this track adds (docs/content-packs.md, "Scenery tags"; src/render/scenery.ts's
// `mission` theme; src/render/mission.ts draws what stands there):
//   - `shopfronts`: a 4 m sidewalk, then two- and three-storey shopfronts with awnings;
//   - `murals`: an alley's painted walls, 1.5 m past the shoulder, a mural on most of them;
//   - `mascot-mural`: the outfit's mascot on a corner wall, its scaffold and the crew painting it out.
//
// Frame: metres, x east, z south (north is -z).
import type { TrackSource } from '../../../src/road/compile';

/** The pack this track bakes into (tools/road/bake.mjs reads it). */
export const PACK = 'region-sf';

// One lane each way, 4 m like every hand-made road since playtest 1, and rideable 1.5 m shoulders:
// the same cross-section as the hills, 5.5 m from the centre line to the edge.
const LANES = [
  { id: 'L0', dCenterM: -4.75, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L1', dCenterM: -2, widthM: 4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 2, widthM: 4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 4.75, widthM: 1.5, direction: 1, kind: 'shoulder' },
] as const;

/** A city speed limit (25 mph). Informational: traffic cruises at its own type's speed. */
const CITY = 11.2;

/** The road's edge (lanes and shoulders), m. */
export const EDGE_M = 5.5;

/** How far the mascot's corner wall reaches back from the corner along each road, m. */
export const MASCOT_REACH_M = { before: 34, after: 56 } as const;

type Side = 'left' | 'right' | 'both';
const tag = (tagName: string, side: Side, s0 = 0, s1: number | 'end' = 'end') => ({
  s0,
  s1,
  side,
  tag: tagName,
});

/** A sign on a shopfront sidewalk (past the 5.5 m edge, inside the 4 m sidewalk), on one side. */
const sign = (id: string, item: string, s: number, side: -1 | 1) => ({
  kind: 'billboard',
  id,
  s0: s,
  s1: s + 8,
  d0: side < 0 ? -8.9 : 6.4,
  d1: side < 0 ? -6.4 : 8.9,
  item,
});

/** Pedestrians on a shopfront sidewalk. */
const walkers = (id: string, s0: number, s1: number, side: -1 | 1) => ({
  kind: 'roadsideZone',
  id,
  s0,
  s1,
  d0: side < 0 ? -9.1 : 6.1,
  d1: side < 0 ? -6.1 : 9.1,
  params: { spawns: 'pedestrians' },
});

/** A boost pad in the right lane. */
const pad = (id: string, s: number, slot: string) => ({
  kind: 'boostPad',
  id,
  s0: s,
  s1: s + 6,
  d0: 0.5,
  d1: 3,
  params: { boostMps: 8, holdS: 1.5, slot },
});

// Road lengths are cut from the smoothed curve so each boundary lies on its corner's apex (checked
// by tools/road/sf-mission.test.ts): the mascot's wall wraps the outside of two of those corners.
const LEN = {
  eggshell: 593.5,
  primer: 367,
  satin: 387,
  dropCloth: 466.5,
  semigloss: 547,
} as const;

/**
 * A square grid corner, rounded: points 66 and 30 m before it on the way in, one on the diagonal,
 * then 30 and 66 m after it on the way out. With the 14 m smoothing it turns at about a 24 m radius
 * (the Russian Hill corners are 16 m), over about 80 m of road.
 */
function corner(
  [px, pz]: readonly [number, number],
  [cx, cz]: readonly [number, number],
  [nx, nz]: readonly [number, number],
): [number, number][] {
  const la = Math.hypot(cx - px, cz - pz);
  const lb = Math.hypot(nx - cx, nz - cz);
  const [ax, az] = [(cx - px) / la, (cz - pz) / la];
  const [bx, bz] = [(nx - cx) / lb, (nz - cz) / lb];
  const at = (a: number, b: number): [number, number] => [cx - ax * a + bx * b, cz - az * a + bz * b];
  return [at(66, 0), at(30, 0), at(8.7, 8.7), at(0, 30), at(0, 66)];
}

/** The grid's corners: south, east, south, west, south, east. */
const GRID: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 600],
  [380, 600],
  [380, 1000],
  [-100, 1000],
  [-100, 1560],
  [560, 1560],
];

export const SF_MISSION: TrackSource = {
  network: {
    id: 'sf-mission',
    name: 'San Francisco mural alleys (hand-authored)',
    region: 'san-francisco',
    // The Mission's flats, so the backdrop's own hills and skyline stand where they should.
    crs: { kind: 'tmerc', originLatDeg: 37.7599, originLonDeg: -122.4148, originElevM: 0 },
    notes:
      "The mural alleys (run W-U; the pitch deck after playtest 2, #8: \"the Mission's mural alleys, where a mural of the streaming outfit's mascot is being painted over mid-race\"). One lane each way through a flat grid: shopfront streets and painted alleys, turning twice under the corner wall where a crew paints the outfit's mascot over while the race runs. One route.",
  },
  createdAt: '2026-10-03',
  // A staircase south-east: south, east, south, west, south, east. Square corners rounded into tight
  // city turns (about 24 m radius): hard braking into them is the point (interview, 2026-10-02:
  // "Braking around tight corners was satisfying").
  points: [
    GRID[0] as readonly [number, number],
    ...GRID.slice(1, -1).flatMap((c, i) =>
      corner(GRID[i] as readonly [number, number], c, GRID[i + 2] as readonly [number, number]),
    ),
    GRID[GRID.length - 1] as readonly [number, number],
  ],
  baseElevationM: 1,
  spacingM: 2,
  smoothingM: 14,
  lanes: LANES,
  roads: [
    {
      // The start: shopfronts both sides, the lot cop on the sidewalk beside the grid.
      id: 'sf-mi-eggshell-st',
      name: 'Eggshell Street',
      lengthM: LEN.eggshell,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [tag('shopfronts', 'both')],
      features: [
        { kind: 'copSpawn', id: 'mi-eggshell-lot', s0: 4, s1: 20, d0: 6.1, d1: 9.4 },
        walkers('mi-eggshell-walkers', 70, 170, -1),
        walkers('mi-eggshell-walkers-2', 330, 420, 1),
        sign('sign-mi-eggshell-ring-light', 'mi-ring-light', 120, 1),
        sign('sign-mi-eggshell-no-drones', 'mi-no-drones', 470, -1),
        pad('pad-mi-eggshell', 220, 'mi-pad-eggshell'),
        pad('pad-mi-eggshell-late', 380, 'mi-pad-eggshell'),
      ],
      barriers: [],
    },
    {
      id: 'sf-mi-primer-alley',
      name: 'Primer Alley',
      lengthM: LEN.primer,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [tag('murals', 'both')],
      features: [],
      barriers: [],
    },
    {
      // South to the first corner wall: the mascot looks back up the street at you.
      id: 'sf-mi-satin-st',
      name: 'Satin Street',
      lengthM: LEN.satin,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        tag('shopfronts', 'left', 0, LEN.satin - MASCOT_REACH_M.before),
        tag('mascot-mural', 'left', LEN.satin - MASCOT_REACH_M.before),
        tag('painted-houses', 'right'),
      ],
      features: [
        sign('sign-mi-satin-sponsored', 'mi-sponsored-wall', 150, -1),
        walkers('mi-satin-walkers', 60, 150, -1),
      ],
      barriers: [],
    },
    {
      id: 'sf-mi-drop-cloth-alley',
      name: 'Drop Cloth Alley',
      lengthM: LEN.dropCloth,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        tag('mascot-mural', 'left', 0, MASCOT_REACH_M.after),
        tag('murals', 'left', MASCOT_REACH_M.after),
        tag('murals', 'right'),
      ],
      features: [],
      barriers: [],
    },
    {
      // A long straight with the car carrier: then the second corner wall, the crew further on.
      id: 'sf-mi-semigloss-st',
      name: 'Semigloss Street',
      lengthM: LEN.semigloss,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 260, lengthM: 300, heightM: 2 }],
      tags: [
        tag('painted-houses', 'left'),
        tag('shopfronts', 'right', 0, LEN.semigloss - MASCOT_REACH_M.before),
        tag('mascot-mural', 'right', LEN.semigloss - MASCOT_REACH_M.before),
      ],
      features: [
        sign('sign-mi-semigloss-scaffold', 'mi-scaffold', 60, 1),
        sign('sign-mi-semigloss-wet-paint', 'mi-wet-paint', 420, 1),
        walkers('mi-semigloss-walkers', 120, 200, 1),
        // Both pad spots come after both truck spots: a pad within 400 m before a truck feeds it a
        // boosted approach that over-throws the jump (tests/sim/road-setpieces-live.test.ts). The
        // first spot sat at s 80, 64 m before the early truck, until 2026-10-03.
        pad('pad-mi-semigloss', 400, 'mi-pad-semigloss'),
        pad('pad-mi-semigloss-late', 330, 'mi-pad-semigloss'),
        // A car carrier double-parked in the right lane, its deck down as a ramp (two spots; the
        // race seed picks one), on the straight before the hump.
        {
          kind: 'rampTruck',
          id: 'carrier-mi-semigloss',
          s0: 150,
          s1: 171.1,
          d0: 3.4,
          d1: 5.4,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'mi-truck' },
        },
        {
          kind: 'rampTruck',
          id: 'carrier-mi-semigloss-late',
          s0: 300,
          s1: 321.1,
          d0: 3.4,
          d1: 5.4,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'mi-truck' },
        },
      ],
      barriers: [],
    },
    {
      // The finish alley, painted end to end.
      id: 'sf-mi-last-coat-alley',
      name: 'Last Coat Alley',
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        tag('mascot-mural', 'right', 0, MASCOT_REACH_M.after),
        tag('murals', 'right', MASCOT_REACH_M.after),
        tag('murals', 'left'),
      ],
      features: [
        // The mission chapel at the finish, on the left (yawDeg 180: its front faces a rider coming up the alley).
        {
          kind: 'landmark',
          id: 'mission-chapel',
          s0: 615,
          s1: 651,
          d0: -20,
          d1: -8,
          params: { model: 'sf-landmarks#sf_mission_church', yawDeg: 180, frontM: 18 },
        },
      ],
      barriers: [],
    },
  ],
  routes: [
    {
      id: 'sf-mission-run',
      name: 'Mural Alleys',
      start: { road: 'sf-mi-eggshell-st', s: 40, dir: 1 },
      finish: { road: 'sf-mi-last-coat-alley', s: -40 },
      checkpoints: [
        { road: 'sf-mi-primer-alley', s: 180 },
        { road: 'sf-mi-drop-cloth-alley', s: 240 },
        { road: 'sf-mi-semigloss-st', s: 280 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    },
  ],
};
