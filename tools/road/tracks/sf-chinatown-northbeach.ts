// San Francisco's Chinatown and North Beach, hand-authored (run W-U; the pitch deck's #8, "Chinatown
// and North Beach (lantern strings, awnings, cafe tables)"; interview, 2026-10-02: the maintainer
// picked all four SF districts; playtest 2, 2026-10-02: "I expected some city feeling not just all
// row houses"). It is only inspired by the city: no real street names, no real shop and no landmark
// branded (the fluted tower on the hill is never named, like the bridge).
//
// The course: north up a narrow, lantern-strung street of steep blocks (Chinatown), a crest lip at
// every block where the cross street flattens out, through the bend where the two districts meet,
// north-west along a street of cafes (North Beach), into a hard right-hand elbow you brake for (the
// maintainer, interview round 1: "Braking around tight corners was satisfying"), and up the climb
// to a finish at the crest under the tower on the hill. One lane each way and a parking shoulder:
// the old city's streets are narrower than downtown's avenue.
//
// Taste (the coordinator's brief, the pitch deck's cuts, docs/tone-guide.md): the satire aims at
// institutions and the startup scene, never at the neighbourhoods or their people. Nothing smashes
// in Chinatown (the deck CUT the chase-film grocery crates): its tags are in no region smashable's
// list. Only North Beach's pavement cafe tables smash (`cafes`). Every sign is invented, deadpan
// and about the city's institutions, its robotaxis and shuttles, or the startups in the cafes.
//
// The scenery tags this track adds (docs/content-packs.md, "Scenery tags"; src/render/scenery.ts):
//   - `lanterns`: a Chinatown frontage, a 4 m pavement then the shopfronts (the hard edge), awnings,
//     balconies and blade signs, and lantern strings across the street (render/chinatown-northbeach.ts);
//   - `cafes`: a North Beach frontage, a 3.2 m pavement to a low patio rail (the hard edge), then the
//     cafe patios with their tables, the striped awnings and the bay windows;
//   - `side-street`: a block's cross street, both sides, flat at the crest, presentation only;
//   - `hill-park`: the grass, trees and benches of the hill's park (the bend and the finish).
// Every name and number is a placeholder the maintainer may veto. Bake with `node tools/road/bake.mjs`.
//
// Frame: metres, x east, z south (north is -z).
import type { TrackSource } from '../../../src/road/compile';

/** The pack this track bakes into (tools/road/bake.mjs reads it). */
export const PACK = 'region-sf';

// One 4 m drive lane each way and a 1.5 m parking shoulder (the same lanes as sf-hills): 5.5 m from
// the centre line to the edge, so the shopfronts stand 9.5 m out and the street is 19 m wall to wall.
const LANES = [
  { id: 'L0', dCenterM: -4.75, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L1', dCenterM: -2, widthM: 4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 2, widthM: 4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 4.75, widthM: 1.5, direction: 1, kind: 'shoulder' },
] as const;

/** A city speed limit (25 mph on these streets). Informational: traffic cruises at its own speed. */
const CITY = 11.2;

/** A side street's half width along the road, m (two lanes and its pavements). */
export const SIDE_HALF_M = 7;

/** A block's cross street at s, both sides. */
const side = (s: number) => ({
  s0: s - SIDE_HALF_M,
  s1: s + SIDE_HALF_M,
  side: 'both' as const,
  tag: 'side-street',
});

/** A frontage of one district over s0..s1 on a side. */
const front = (
  tag: 'lanterns' | 'cafes',
  sideName: 'left' | 'right' | 'both',
  s0 = 0,
  s1: number | 'end' = 'end',
) => ({
  s0,
  s1,
  side: sideName,
  tag,
});

/** A sign on the pavement (past the 5.5 m edge and its 0.6 m verge), on one side. */
const sign = (id: string, item: string, s: number, sd: -1 | 1) => ({
  kind: 'billboard',
  id,
  s0: s,
  s1: s + 10,
  d0: sd < 0 ? -9 : 6.5,
  d1: sd < 0 ? -6.5 : 9,
  item,
});

/** People on a pavement over s0..s1 on a side (inside the band, clear of the shopfronts). */
const walkers = (id: string, s0: number, s1: number, sd: -1 | 1) => ({
  kind: 'roadsideZone',
  id,
  s0,
  s1,
  d0: sd < 0 ? -8.4 : 6.3,
  d1: sd < 0 ? -6.3 : 8.4,
  params: { spawns: 'pedestrians' },
});

/** A boost pad in the right lane (two per slot; the race seed picks one). */
const pad = (id: string, s: number, slot: string) => ({
  kind: 'boostPad',
  id,
  s0: s,
  s1: s + 6,
  d0: 0.5,
  d1: 3.5,
  params: { boostMps: 8, holdS: 1.5, slot },
});

/**
 * The Dragon Gate (playtest 4, P4-19, CX5's `sf-landmarks#sf_dragon_gate`): Chinatown's south entry, an
 * `overRoad` landmark across Lantern Row a few metres past the start grid (the front row of the grid is at
 * s 40), so a rider passes under it in the first second. Its kit: a 12.4 m clear opening, red posts at
 * 6.7 m out with the pagoda-roofed lintel over them, two side gates and a guardian on a plinth at each
 * outer post (10 m out). The footprint is 4.4 m along the road and 24 m across (the outer posts, the side
 * roofs and the guardians). The two inner posts stand on the pavement, 0.7 m past the shoulder's edge, so
 * they are solid hazards (sim/riders/features.ts): a rider on the pavement meets them, and nobody rides
 * through a post that is drawn. [default]
 */
export const GATE = {
  s: 52,
  halfAlongM: 2.2,
  halfAcrossM: 12,
  postD: [6.2, 7.2],
  postHalfAlongM: 0.7,
} as const;

/** A solid hazard (sim/riders/features.ts): a box on the pavement nobody rides through. */
const post = (id: string, d: readonly [number, number]) => ({
  kind: 'hazard',
  id,
  s0: GATE.s - GATE.postHalfAlongM,
  s1: GATE.s + GATE.postHalfAlongM,
  d0: d[0],
  d1: d[1],
  params: { solid: true, object: 'gate-post', heightM: 7.6 },
});

/**
 * The church by the park (playtest 4, P4-19, CX5's `sf-landmarks#sf_twin_spire`): its footprint on the
 * elbow's outer side, centred at `s`, `d` (left is negative), `alongM` along the road and `acrossM` across
 * (the model is 30 m wide and 18 m deep), 18.5 m from the apex's centre line and 4 m past the park's grass
 * (the verge ends at 14.5 m). Its `_lod1` stands in past `farM`. [default]
 */
export const CHURCH = { s: 78, d: -27.5, alongM: 30, acrossM: 18, farM: 260 } as const;

export const SF_CHINATOWN_NORTHBEACH: TrackSource = {
  network: {
    id: 'sf-chinatown-northbeach',
    name: 'San Francisco Chinatown and North Beach (hand-authored)',
    region: 'san-francisco',
    // Between the two districts, so the backdrop's own hills, bay and towers stand round them.
    crs: { kind: 'tmerc', originLatDeg: 37.7955, originLonDeg: -122.4065, originElevM: 0 },
    notes:
      'Chinatown and North Beach (run W-U; pitch deck #8; interview, 2026-10-02: all four SF districts): north up a narrow lantern-strung street of steep blocks with a crest lip at each cross street, the bend where the districts meet, a street of cafes, a hard right-hand elbow, and the climb to a finish under the tower on the hill. Nothing smashes in Chinatown; only North Beach cafe tables do. One route.',
  },
  createdAt: '2026-10-03',
  // North from the south end of Chinatown, dead straight for the crest jumps; the bend turns
  // north-west into North Beach; the elbow turns hard right, up the hill to the east-north-east.
  points: [
    [0, 0],
    [0, -200],
    [0, -400],
    [0, -600],
    [0, -800],
    [0, -1000],
    [0, -1150],
    [-40, -1250],
    [-150, -1360],
    [-300, -1500],
    [-450, -1640],
    [-600, -1780],
    [-690, -1862],
    [-722, -1910],
    [-672, -1950],
    [-560, -1995],
    [-380, -2055],
    [-180, -2115],
    [20, -2165],
    [220, -2210],
  ],
  baseElevationM: 1,
  spacingM: 2,
  smoothingM: 30,
  lanes: LANES,
  roads: [
    {
      // The start, then the first steep block: its crest lip where the cross street flattens out.
      id: 'sf-cn-lantern-row',
      name: 'Lantern Row',
      lengthM: 560,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 390, lengthM: 300, heightM: 13 }],
      ramps: [{ id: 'crest-lantern-row', s0: 382, lengthM: 8, heightM: 0.5, backM: 4 }],
      tags: [front('lanterns', 'both'), side(170), side(390)],
      features: [
        // The lot cop waits on the pavement beside the grid.
        { kind: 'copSpawn', id: 'cn-lantern-lot', s0: 4, s1: 20, d0: 6.1, d1: 9.2 },
        // The Dragon Gate, Chinatown's south entry (yawDeg 180: its plaque faces a rider coming up the street).
        {
          kind: 'landmark',
          id: 'dragon-gate',
          s0: GATE.s - GATE.halfAlongM,
          s1: GATE.s + GATE.halfAlongM,
          d0: -GATE.halfAcrossM,
          d1: GATE.halfAcrossM,
          params: { model: 'sf-landmarks#sf_dragon_gate', yawDeg: 180, overRoad: true },
        },
        post('dragon-gate-post-r', GATE.postD),
        post('dragon-gate-post-l', [-GATE.postD[1], -GATE.postD[0]]),
        walkers('cn-lantern-walkers', 60, 150, 1),
        walkers('cn-lantern-walkers-2', 200, 300, -1),
        sign('sign-cn-lantern-clearance', 'cn-lantern-clearance', 110, -1),
        sign('sign-cn-robotaxi-narrow', 'cn-robotaxi-narrow', 250, 1),
        sign('sign-cn-grade-brakes', 'cn-grade-brakes', 470, -1),
        pad('pad-cn-lantern', 120, 'cn-pad-lantern'),
        pad('pad-cn-lantern-late', 290, 'cn-pad-lantern'),
      ],
      barriers: [],
    },
    {
      // Two steeper blocks, each with a lip at its crest.
      id: 'sf-cn-bell-grade',
      name: 'Bell Grade',
      lengthM: 560,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [
        { centreM: 150, lengthM: 260, heightM: 15 },
        { centreM: 410, lengthM: 260, heightM: 16 },
      ],
      ramps: [
        { id: 'crest-bell-first', s0: 142, lengthM: 8, heightM: 0.55, backM: 4 },
        { id: 'crest-bell-second', s0: 402, lengthM: 8, heightM: 0.6, backM: 4 },
      ],
      tags: [front('lanterns', 'both'), side(150), side(410)],
      features: [
        sign('sign-cn-no-scooters', 'cn-no-scooter-parking', 60, 1),
        sign('sign-cn-bell-zone', 'cn-bell-zone', 250, -1),
        walkers('cn-bell-walkers', 200, 290, 1),
        walkers('cn-bell-walkers-2', 470, 540, -1),
      ],
      barriers: [],
    },
    {
      // Where the districts meet: the lanterns end at a cross street and the cafes begin.
      id: 'sf-cn-crossover',
      name: 'The Crossover',
      lengthM: 380,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 190, lengthM: 300, heightM: 4 }],
      tags: [front('lanterns', 'both', 0, 180), side(190), front('cafes', 'both', 200)],
      features: [
        sign('sign-cn-crossover-shuttles', 'cn-shuttle-turns', 100, 1),
        sign('sign-nb-laptops', 'nb-laptops', 290, -1),
        walkers('cn-crossover-corner', 150, 176, -1),
        walkers('nb-crossover-corner', 206, 260, 1),
      ],
      barriers: [],
    },
    {
      // The cafes, north-west on a gentle rise.
      id: 'sf-nb-espresso-row',
      name: 'Espresso Row',
      lengthM: 640,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 330, lengthM: 420, heightM: 8 }],
      ramps: [{ id: 'crest-espresso-row', s0: 322, lengthM: 8, heightM: 0.45, backM: 4 }],
      tags: [front('cafes', 'both'), side(120), side(330), side(540)],
      features: [
        sign('sign-nb-no-pitching', 'nb-no-pitching', 60, 1),
        sign('sign-nb-wifi', 'nb-wifi-ends', 210, -1),
        sign('sign-nb-founders', 'nb-loading-founders', 430, 1),
        walkers('nb-espresso-walkers', 150, 300, 1),
        walkers('nb-espresso-walkers-2', 360, 520, -1),
        pad('pad-nb-espresso', 180, 'nb-pad-espresso'),
        pad('pad-nb-espresso-late', 420, 'nb-pad-espresso'),
      ],
      barriers: [],
    },
    {
      // The elbow: a hard right-hander. The hill's park is on the outside, the cafes on the inside.
      id: 'sf-nb-the-elbow',
      name: 'The Elbow',
      lengthM: 280,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        front('cafes', 'right'),
        front('cafes', 'left', 0, 60),
        { s0: 60, s1: 230, side: 'left', tag: 'hill-park' },
        front('cafes', 'left', 230),
      ],
      features: [
        {
          kind: 'billboard',
          id: 'bb-nb-elbow-ai-poet',
          s0: 120,
          s1: 160,
          d0: -14.5,
          d1: -9,
          item: 'nb-ai-poet',
        },
        sign('sign-nb-elbow-brake', 'nb-elbow-brake', 30, -1),
        // The twin-spired church (CX5's `sf-landmarks#sf_twin_spire`), across the park from the elbow's
        // apex: its facade faces the road, so a rider coming up Espresso Row has it 23 to 25 degrees off
        // its axis from 400 m out. The model's origin is its facade (the nave runs 18 m behind it), so
        // `frontM` 9 puts the footprint's middle in the nave: the 30 by 18 m box is the church's own.
        {
          kind: 'landmark',
          id: 'twin-spire-church',
          s0: CHURCH.s - CHURCH.alongM / 2,
          s1: CHURCH.s + CHURCH.alongM / 2,
          d0: CHURCH.d - CHURCH.acrossM / 2,
          d1: CHURCH.d + CHURCH.acrossM / 2,
          params: { model: 'sf-landmarks#sf_twin_spire', yawDeg: -90, frontM: 9, farM: CHURCH.farM },
        },
        {
          kind: 'roadsideZone',
          id: 'nb-elbow-park',
          s0: 170,
          s1: 220,
          d0: -13,
          d1: -7,
          params: { spawns: 'pedestrians' },
        },
      ],
      barriers: [],
    },
    {
      // The climb to the finish at the crest, the park and the tower on the hill.
      id: 'sf-nb-overlook-climb',
      name: 'Overlook Climb',
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 360, lengthM: 640, heightM: 22 }],
      tags: [
        front('cafes', 'both', 0, 200),
        side(210),
        { s0: 220, s1: 'end', side: 'both', tag: 'hill-park' },
      ],
      features: [
        sign('sign-nb-overlook-view', 'nb-overlook-fog', 150, 1),
        {
          kind: 'billboard',
          id: 'bb-nb-overlook-puckbench',
          s0: 280,
          s1: 320,
          d0: 9,
          d1: 14.5,
          item: 'nb-puckbench',
        },
        {
          kind: 'roadsideZone',
          id: 'nb-overlook-park',
          s0: 380,
          s1: 460,
          d0: -13,
          d1: -7,
          params: { spawns: 'pedestrians' },
        },
      ],
      barriers: [],
    },
  ],
  routes: [
    {
      id: 'sf-chinatown-northbeach-run',
      name: 'Chinatown & North Beach',
      start: { road: 'sf-cn-lantern-row', s: 40, dir: 1 },
      finish: { road: 'sf-nb-overlook-climb', s: 360 },
      checkpoints: [
        { road: 'sf-cn-bell-grade', s: 300 },
        { road: 'sf-cn-crossover', s: 200 },
        { road: 'sf-nb-espresso-row', s: 400 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    },
  ],
};
