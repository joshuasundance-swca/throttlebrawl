// San Francisco's waterfront, hand-authored (run W-U; the pitch deck's #8, "Later": "the waterfront
// (palms, piers, sea lions, an invented clock-tower ferry building)"; interview, 2026-10-02: all four
// SF districts, downtown first, then the waterfront). It is only inspired by the city: no real
// street, pier or building names and no real company. From the foot of the big bridge a four-lane
// boulevard runs north along the bay: a wide promenade and the pier sheds on the right (even piers
// before the ferry hall, odd ones after, as the city numbers them), low waterfront blocks on the
// left, the clock-tower ferry hall halfway, then a sweep west past more piers and a tight right-hand
// bend to the sea lions' floats at the finish. Every name and number is a placeholder the maintainer
// may veto. Bake with `node tools/road/bake.mjs`.
//
// The scenery tags this track adds (docs/content-packs.md, "Scenery tags"; src/render/scenery.ts and
// src/render/waterfront.ts, which draws what stands on them):
//   - bay side (right): `promenade` (12 m of paving to the seawall, a splash past it), `pier-shed`
//     (a pier's bulkhead shed, its front on the seawall: a hard edge), `ferry-hall` (the clock-tower
//     ferry hall, likewise), and `sea-lions` (the floats between two piers; render only);
//   - city side (left): `wharf` (a sidewalk, then low waterfront blocks: a hard edge), `wharf-street`
//     (a short street running inland, open asphalt at its mouth), `ferry-plaza` (the open plaza
//     facing the ferry hall) and `wharf-lot` (an open parking lot by the bridge).
// Smashables on these tags are only startup pop-ups and cafe tables (the region file).
//
// Frame: metres, x east, z south (north is -z). The start faces north with the bay to the east.
import type { TrackSource } from '../../../src/road/compile';

/** The pack this track bakes into (tools/road/bake.mjs reads it). */
export const PACK = 'region-sf';

// Two drive lanes each way, as downtown's avenue (4 m lanes, 1.5 m shoulders: 9.5 m to the edge).
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

/** A side street's half width along the boulevard, m. */
export const STREET_HALF_M = 8;

type Tag = { s0: number; s1: number | 'end'; side: 'left' | 'right' | 'both'; tag: string };

/** The promenade along a whole stretch of the bay side. */
const promenade = (s0 = 0, s1: number | 'end' = 'end'): Tag => ({ s0, s1, side: 'right', tag: 'promenade' });
/** A pier's bulkhead shed, its front `width` m wide and centred on s. */
const shed = (s: number, width: number): Tag => ({
  s0: s - width / 2,
  s1: s + width / 2,
  side: 'right',
  tag: 'pier-shed',
});
/** The low waterfront blocks along a stretch of the city side. */
const wharf = (s0 = 0, s1: number | 'end' = 'end'): Tag => ({ s0, s1, side: 'left', tag: 'wharf' });
/** A short side street running inland from s. */
const street = (s: number): Tag => ({
  s0: s - STREET_HALF_M,
  s1: s + STREET_HALF_M,
  side: 'left',
  tag: 'wharf-street',
});

/** A sign on the promenade (right) or the sidewalk (left), past the 9.5 m edge and its verge. */
const sign = (id: string, item: string, s: number, side: -1 | 1) => ({
  kind: 'billboard',
  id,
  s0: s,
  s1: s + 10,
  d0: side < 0 ? -13 : 10.5,
  d1: side < 0 ? -10.5 : 13,
  item,
});
/** A billboard on open ground on the city side (a lot or the plaza). */
const billboard = (id: string, item: string, s: number) => ({
  kind: 'billboard',
  id,
  s0: s,
  s1: s + 40,
  d0: -22,
  d1: -13,
  item,
});
/**
 * The waterfront's strays (playtest 4, run B's check: sea lions and doodles stood at every zone of the city): a
 * waterfront zone names its own kinds, the sea lions the joke is for and the city's two kinds of people, no
 * dogs (the neighbourhoods have those). The region lists the sea lion nowhere else.
 */
const WATERFRONT_KINDS = ['sea-lion', 'e-scooter-commuter', 'dog-walker-sf'];
/** People walking the promenade. */
const walkers = (id: string, s0: number, s1: number) => ({
  kind: 'roadsideZone',
  id,
  s0,
  s1,
  d0: 10.4,
  d1: 17.4,
  params: { spawns: 'pedestrians', kinds: WATERFRONT_KINDS },
});
const pad = (id: string, s: number, slot: string) => ({
  kind: 'boostPad',
  id,
  s0: s,
  s1: s + 6,
  d0: 0.5,
  d1: 3.5,
  params: { boostMps: 8, holdS: 1.5, slot },
});

export const SF_WATERFRONT: TrackSource = {
  network: {
    id: 'sf-waterfront',
    name: 'San Francisco waterfront (hand-authored)',
    region: 'san-francisco',
    // The south end of the waterfront, under the big bridge: the backdrop's bridge and skyline
    // stand where they should round it.
    crs: { kind: 'tmerc', originLatDeg: 37.7885, originLonDeg: -122.3885, originElevM: 0 },
    notes:
      'The waterfront boulevard (run W-U; the pitch deck\'s #8, "Later": "the waterfront (palms, piers, sea lions, an invented clock-tower ferry building)"): two lanes each way along the bay, a promenade and the pier sheds on the right, low waterfront blocks and side streets on the left, the clock-tower ferry hall halfway, and the sea lions\' floats at the finish. One route.',
  },
  createdAt: '2026-10-03',
  // North from the bridge's foot, a long straight past the even piers (the ramp truck's), the ferry
  // hall, a sweep to the west past the odd piers, and a tight right-hand bend to the finish.
  points: [
    [0, 0],
    [0, -320],
    [-30, -640],
    [-90, -1000],
    [-150, -1360],
    [-250, -1720],
    [-450, -2050],
    [-740, -2310],
    [-1060, -2470],
    [-1250, -2555],
    [-1310, -2650],
    [-1320, -2880],
  ],
  baseElevationM: 2.4,
  spacingM: 2,
  smoothingM: 30,
  lanes: LANES,
  roads: [
    {
      id: 'sf-wf-bridgefoot',
      name: 'Bridgefoot Promenade',
      lengthM: 640,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        promenade(),
        shed(150, 44),
        shed(280, 48),
        shed(420, 40),
        shed(560, 52),
        { s0: 0, s1: 220, side: 'left', tag: 'wharf-lot' },
        wharf(220),
        street(330),
        street(520),
      ],
      features: [
        // The lot cop waits on the promenade beside the grid, off the road.
        { kind: 'copSpawn', id: 'wf-promenade-lot', s0: 4, s1: 20, d0: 10.4, d1: 13.9 },
        walkers('wf-bridgefoot-walkers', 60, 120),
        walkers('wf-bridgefoot-walkers-2', 340, 400),
        billboard('bb-wf-lot-ferrychain', 'wf-ferrychain', 70),
        billboard('bb-wf-lot-arfscribe', 'wf-arfscribe', 150),
        sign('sign-wf-seawall', 'wf-seawall', 240, 1),
        sign('sign-wf-no-pitching', 'wf-no-pitching', 460, -1),
        pad('pad-wf-bridgefoot', 110, 'wf-pad-bridgefoot'),
        pad('pad-wf-bridgefoot-late', 230, 'wf-pad-bridgefoot'),
      ],
      barriers: [],
    },
    {
      // Straight from end to end: the car carrier's flight lands on straight road.
      id: 'sf-wf-clocktower-reach',
      name: 'Clocktower Reach',
      lengthM: 700,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 600, lengthM: 160, heightM: 0.8 }],
      tags: [
        promenade(),
        shed(90, 46),
        shed(250, 50),
        shed(410, 44),
        shed(560, 50),
        wharf(),
        street(120),
        street(470),
      ],
      features: [
        sign('sign-wf-even-piers', 'wf-even-piers', 30, -1),
        sign('sign-wf-foghorn', 'wf-foghorn', 320, 1),
        walkers('wf-reach-walkers', 140, 200),
        // A car carrier double-parked in the kerb lane, its deck down as a ramp (two spots; the race
        // seed picks one).
        {
          kind: 'rampTruck',
          id: 'carrier-wf-reach',
          s0: 200,
          s1: 221.1,
          d0: 7.2,
          d1: 9.2,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'wf-truck' },
        },
        {
          kind: 'rampTruck',
          id: 'carrier-wf-reach-late',
          s0: 380,
          s1: 401.1,
          d0: 7.2,
          d1: 9.2,
          params: { rampLengthM: 11.5, lipHeightM: 2.8, slot: 'wf-truck' },
        },
      ],
      barriers: [],
    },
    {
      id: 'sf-wf-ferry-plaza',
      name: 'Ferry Plaza',
      lengthM: 520,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        promenade(),
        { s0: 120, s1: 300, side: 'right', tag: 'ferry-hall' },
        shed(420, 50),
        wharf(0, 110),
        { s0: 110, s1: 310, side: 'left', tag: 'ferry-plaza' },
        wharf(310),
        street(400),
      ],
      features: [
        sign('sign-wf-ferry-schedule', 'wf-ferry-schedule', 60, 1),
        walkers('wf-ferry-walkers', 130, 230),
        {
          kind: 'roadsideZone',
          id: 'wf-ferry-plaza-walkers',
          s0: 160,
          s1: 260,
          d0: -17.4,
          d1: -10.4,
          params: { spawns: 'pedestrians', kinds: WATERFRONT_KINDS },
        },
        billboard('bb-wf-plaza-fogcastr', 'wf-fogcastr', 250),
      ],
      barriers: [],
    },
    {
      id: 'sf-wf-odd-piers',
      name: 'Odd Pier Row',
      lengthM: 900,
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [{ centreM: 450, lengthM: 300, heightM: 1.2 }],
      tags: [
        promenade(),
        shed(60, 46),
        shed(200, 52),
        shed(350, 44),
        shed(560, 50),
        shed(700, 46),
        shed(840, 48),
        wharf(),
        street(160),
        street(420),
        street(690),
      ],
      features: [
        sign('sign-wf-odd-piers', 'wf-odd-piers', 20, 1),
        sign('sign-wf-tide', 'wf-tide', 300, -1),
        walkers('wf-odd-walkers', 240, 320),
        walkers('wf-odd-walkers-2', 600, 660),
        pad('pad-wf-odd', 250, 'wf-pad-odd'),
        pad('pad-wf-odd-late', 520, 'wf-pad-odd'),
      ],
      barriers: [],
    },
    {
      id: 'sf-wf-sea-lion-landing',
      name: 'Sea Lion Landing',
      speedLimitMps: CITY,
      surface: 'asphalt',
      humps: [],
      tags: [
        promenade(),
        shed(70, 44),
        shed(230, 46),
        { s0: 290, s1: 'end', side: 'right', tag: 'sea-lions' },
        wharf(),
        street(150),
      ],
      features: [
        sign('sign-wf-sea-lions', 'wf-sea-lions', 120, -1),
        sign('sign-wf-meal-plan', 'wf-meal-plan', 300, 1),
        walkers('wf-landing-walkers', 320, 420),
      ],
      barriers: [],
    },
  ],
  routes: [
    {
      id: 'sf-waterfront-run',
      name: 'Waterfront',
      start: { road: 'sf-wf-bridgefoot', s: 40, dir: 1 },
      finish: { road: 'sf-wf-sea-lion-landing', s: -40 },
      checkpoints: [
        { road: 'sf-wf-clocktower-reach', s: 300 },
        { road: 'sf-wf-ferry-plaza', s: 260 },
        { road: 'sf-wf-odd-piers', s: 450 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    },
  ],
};
