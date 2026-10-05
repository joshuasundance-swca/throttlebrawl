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
//
// The places (run W-U, the pitch deck's #12, "Ride up the ramp onto a car ferry, weave across the
// deck, and roll off the far side"): the race now starts 400 m further back, on the ferry dock. The
// bridge is out, so the car ferry moored across the slip is the road: up the transfer span, across a
// deck of parked pickups and a coffee cart, off the far ramp. The Logging Spur runs through a fresh
// clear-cut (stumps, a log deck either side of its jump), and the Switchback Grade beside it is the
// log trucks' road. Espresso Row is the main street on the day of the Stump Social (Fir County's
// logging festival): closed, a chainsaw-carved bear on
// every corner and a crowd that parts. The pickups, the cart, the stumps, the log piles and the
// bears are solid `hazard` features (sim/riders/features.ts), all on the verge bands; render draws
// them (src/render/pnw-places.ts). No timed ferry jump, and no Bigfoot.
import type { BakedBarrier, BakedFeature } from '../../../src/road';
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

/** A solid hazard (sim/riders/features.ts): a box on the verge band nobody rides through. */
function solid(
  id: string,
  object: string,
  s0: number,
  lengthM: number,
  d: readonly [number, number],
  heightM: number,
): BakedFeature {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    kind: 'hazard',
    id,
    s0: r2(s0),
    s1: r2(s0 + lengthM),
    d0: r2(d[0]),
    d1: r2(d[1]),
    params: { solid: true, object, heightM },
  };
}
/** Mirrors a right-hand (positive d) range to the left. */
const left = (d: readonly [number, number]): [number, number] => [-d[1], -d[0]];

// ---- The ferry (the landing's s) ----
/** Where the race's road rises onto the ferry, how long it stays up, and how high; the hull's ends. */
export const FERRY = { rampUpS: 148, rampM: 20, deckM: 152, heightM: 1.6, hullS0: 164, hullS1: 326 } as const;
/** The car deck's outer lanes (the `ferry` verge band, 4.5 m past the shoulder's 5.5 m). */
const DECK_INNER: [number, number] = [5.7, 7.6];
const DECK_OUTER: [number, number] = [8.0, 9.95];
const PICKUP_M = 5.3;

/**
 * The deck's parked pickups and its coffee cart, both sides, staggered between the inner and the
 * outer row so a rider on the deck's outer lane slaloms them; a stair tower closes each end of each
 * outer lane (what a rider who stays out there meets, rather than the hull's end).
 */
function ferryDeck(): BakedFeature[] {
  const out: BakedFeature[] = [];
  const towerD: [number, number] = [5.6, 10];
  for (const [i, s0] of [FERRY.hullS0, FERRY.hullS1 - 8].entries()) {
    out.push(solid(`ferry-stairs-r${i}`, 'stair-tower', s0, 8, towerD, 6.4));
    out.push(solid(`ferry-stairs-l${i}`, 'stair-tower', s0, 8, left(towerD), 6.4));
  }
  for (let k = 0; k < 10; k++) {
    const s0 = 180 + 14 * k;
    if (k === 4) out.push(solid('ferry-coffee-cart', 'coffee-cart', s0, 2.4, [8.3, 9.9], 2.3));
    else out.push(solid(`ferry-pickup-r${k}`, 'pickup', s0, PICKUP_M, k % 2 ? DECK_OUTER : DECK_INNER, 1.9));
    if (k < 9)
      out.push(
        solid(`ferry-pickup-l${k}`, 'pickup', s0 + 7, PICKUP_M, left(k % 2 ? DECK_INNER : DECK_OUTER), 1.9),
      );
  }
  return out;
}

// ---- The clear-cut (the Logging Spur's s) ----
/** The log deck's jump on the spur (its ramp), and the stumps' stretch. */
const LOG_DECK = { s0: 400, lengthM: 15, heightM: 1.5, backM: 5 } as const;
const STUMPS = { everyM: 10, dNear: 3.3, dFar: 16.8, clearS0: 385, clearS1: 480 } as const;
/**
 * Where the clear-cut runs on each side of the spur: all along its right (east), and on its left only
 * where the Switchback Grade is far enough off that the two roads' open dirt never overlaps (the
 * grade's own clear-cut faces it; two 16 m bands need about 42 m between the roads).
 */
export const CLEARCUT = { spurRight: [0, 'end'], spurLeft: [130, 580], gradeRight: [130, 670] } as const;
const STUMP_RUNS = { right: [24, 700], left: [CLEARCUT.spurLeft[0] + 4, CLEARCUT.spurLeft[1] - 4] } as const;

/**
 * The clear-cut's stumps on the spur's open dirt, each side it runs: one about every 10 m a side, at
 * a spread of distances out to the band's edge, from a fixed little generator (the same every bake).
 * The log deck's stretch is left clear for its log piles and the landing.
 */
function clearCut(): BakedFeature[] {
  const out: BakedFeature[] = [];
  let h = 0x2545f491;
  const next = () => {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    return h / 4294967296;
  };
  for (const side of [1, -1] as const) {
    const [from, to] = side > 0 ? STUMP_RUNS.right : STUMP_RUNS.left;
    for (let s = from + (side > 0 ? 0 : STUMPS.everyM / 2); s < to; s += STUMPS.everyM) {
      const at = s + (next() - 0.5) * 6;
      const size = 0.9 + next() * 0.5;
      const d0 = STUMPS.dNear + next() * (STUMPS.dFar - STUMPS.dNear - size);
      if (at + size > STUMPS.clearS0 && at < STUMPS.clearS1) continue;
      const d: [number, number] = [d0, d0 + size];
      out.push(solid(`stump-${out.length}`, 'stump', at, size, side > 0 ? d : left(d), 0.8));
    }
  }
  // The log deck: a stack of logs each side of the jump, the ramp built between them.
  const pile: [number, number] = [3.0, 6.8];
  out.push(solid('log-deck-pile-r', 'log-pile', LOG_DECK.s0 - 4, 28, pile, 2.4));
  out.push(solid('log-deck-pile-l', 'log-pile', LOG_DECK.s0 - 4, 28, left(pile), 2.4));
  return out;
}

// ---- the Stump Social (Espresso Row's s) ----
/** The festival's stretch of Espresso Row, and its side streets (each 12 m wide, both sides). */
export const FESTIVAL = { s0: 120, s1: 620, sideStreets: [200, 300, 400, 500], streetM: 12 } as const;

/**
 * A chainsaw-carved bear on every corner of every side street, the barricades pushed aside onto the
 * sidewalk at each end of the closure, and the crowd: roadside zones along both sidewalks.
 */
function stumpSocial(): BakedFeature[] {
  const out: BakedFeature[] = [];
  const bear: [number, number] = [8.2, 9.3];
  for (const c of FESTIVAL.sideStreets) {
    const half = FESTIVAL.streetM / 2;
    for (const [k, s0] of [c - half - 1.1, c + half].entries()) {
      out.push(solid(`bear-${c}-r${k}`, 'bear', s0, 1.1, bear, 2.3));
      out.push(solid(`bear-${c}-l${k}`, 'bear', s0, 1.1, left(bear), 2.3));
    }
  }
  const barricade: [number, number] = [6.2, 9.4];
  for (const [k, s0] of [FESTIVAL.s0 + 4, FESTIVAL.s1 - 6].entries()) {
    out.push(solid(`barricade-r${k}`, 'barricade', s0, 1.2, barricade, 1.2));
    out.push(solid(`barricade-l${k}`, 'barricade', s0, 1.2, left(barricade), 1.2));
  }
  for (let s0 = FESTIVAL.s0 + 10; s0 < FESTIVAL.s1 - 10; s0 += 80) {
    const s1 = Math.min(s0 + 80, FESTIVAL.s1 - 10);
    const zone = (id: string, d0: number, d1: number): BakedFeature => ({
      kind: 'roadsideZone',
      id,
      s0,
      s1,
      d0,
      d1,
      params: { spawns: 'pedestrians' },
    });
    out.push(zone(`stump-social-crowd-r${s0}`, 5.8, 8), zone(`stump-social-crowd-l${s0}`, -8, -5.8));
  }
  return out;
}

// ---- The Mill Yard Cut (playtest 3, T5.2; the maintainer: "the static one could be used to get to
// shortcuts") ----
/**
 * A truck-only way round the last of the flats' straight: a concrete haul road through the mill's
 * yard, beside the main road, behind a low `jumpable` wall. Only a bike in the air gets over the
 * wall. A rider rides up the ramp truck parked on the right shoulder, leaves its lip and steers
 * right; the split zone lies past the lanes' outer edge (d from 5.5), so nobody on the ground can
 * reach it, and one who misses the truck rides on past on the main road. No rival and no cop takes
 * it (`aiTake` 0), and it carries no traffic.
 */
export const MILL_CUT = {
  /** The end of the flats' first piece: where the split connector starts, in that road's s. */
  splitS: 600,
  connectorM: 30,
  /** The main road's piece beside the cut. */
  yardM: 240,
  /** The truck's ramp foot and the lip, 25 m short of the split (a ramp is 11.5 m long). */
  truckS0: 563.5,
  lipS: 575,
  /**
   * Where the yard road starts: its reference line, 5 m right of the main road's centre line, half a
   * metre inside the road's edge (a junction must lie on the road it leaves), and its one lane, 8 m
   * wide, starting on that line: d 5 to 13 beside the main road. (The sim counts a road's band from
   * its reference line out to its lanes' far edge, so the near edge is the line.) It overlaps the
   * main road's outer half metre, which a rider on the ground (centre at most 5, half a bike in from
   * the edge) never gets half a bike into, so nobody on the ground is handed across, and a rider in
   * the air out past the edge is.
   */
  offsetM: 5,
  laneM: 8,
  laneCentreM: 4,
  truck: {
    kind: 'rampTruck',
    id: 'carrier-mill-cut',
    s0: 563.5,
    s1: 585.5,
    d0: 3.4,
    d1: 5.4,
    params: { rampLengthM: 11.5, lipHeightM: 2.8 },
  } satisfies BakedFeature,
  /** From the ramp's foot to the end of the road, on the right; 1.2 m, the default wall height. */
  wall: {
    s0: 563.5,
    s1: 600,
    side: 'right',
    kind: 'wall',
    heightM: 1.2,
    jumpable: true,
  } satisfies BakedBarrier,
  /**
   * The wall goes on along the main road beside the yard road, over the split connector and the first
   * 125 m of the next piece (155 m past the split): where the yard road lies beside it, a rider on the
   * ground could otherwise ride out onto the verge (the off-road switch is on) and be handed across.
   */
  wallAfter: { s0: 0, s1: 'end', side: 'right', kind: 'wall', heightM: 1.2, jumpable: true } satisfies Omit<
    BakedBarrier,
    's1'
  > & { s1: 'end' },
  wallAlongM: 125,
  sign: 'MILL YARD CUT-THROUGH. Authorised vehicles only. Airborne is authorised.',
} as const;

/** The flats' scenery: forest on the left, the sawmill on the right, on every piece of it. */
const SAWMILL_TAGS = [
  { s0: 0, s1: 'end', side: 'left', tag: 'forest' },
  { s0: 0, s1: 'end', side: 'right', tag: 'sawmill' },
] as const;

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
    // The ferry dock and the ferry (run W-U), then the old landing, then the Switchback Grade
    // swinging west (left), so the Logging Spur runs straight up its east side.
    [0, 400],
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
      lengthM: 700,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      // Run W-U: up the transfer span onto the ferry, level across its deck, down the far ramp. No
      // lip: a fast bike floats off the top of each ramp by the crest rule (a hop, not a timed jump).
      decks: [
        {
          s0: FERRY.rampUpS,
          upM: FERRY.rampM,
          lengthM: FERRY.deckM,
          downM: FERRY.rampM,
          heightM: FERRY.heightM,
        },
      ],
      tags: [
        { s0: 0, s1: 150, side: 'right', tag: 'marina' },
        { s0: 0, s1: 150, side: 'left', tag: 'town' },
        { s0: 150, s1: FERRY.hullS0, side: 'both', tag: 'bridge' },
        // Playtest 4 (P4-19): a deck's supports follow its own tag; the slip's spans stand on timber.
        { s0: 150, s1: FERRY.hullS0, side: 'both', tag: 'trestle' },
        { s0: FERRY.hullS0, s1: FERRY.hullS1, side: 'both', tag: 'ferry' },
        { s0: FERRY.hullS1, s1: 340, side: 'both', tag: 'bridge' },
        { s0: FERRY.hullS1, s1: 340, side: 'both', tag: 'trestle' },
        { s0: 340, s1: 420, side: 'right', tag: 'marina' },
        { s0: 340, s1: 420, side: 'left', tag: 'town' },
        { s0: 420, s1: 'end', side: 'both', tag: 'forest' },
      ],
      features: [
        { kind: 'copSpawn', id: 'ferry-holding-lot', s0: 4, s1: 20, d0: 6.1, d1: 9.6 },
        {
          kind: 'billboard',
          id: 'sign-landing-overflow',
          s0: 60,
          s1: 70,
          d0: -9,
          d1: -6.5,
          item: 'ferry-overflow',
        },
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
          s0: 80,
          s1: 90,
          d0: 6.5,
          d1: 9,
          item: 'ferry-wait',
        },
        // Run W-U: the bridge is out, and the deck has rules.
        {
          kind: 'billboard',
          id: 'sign-landing-bridge-out',
          s0: 112,
          s1: 122,
          d0: 6.5,
          d1: 9,
          item: 'ferry-bridge-out',
        },
        {
          kind: 'billboard',
          id: 'sign-landing-engines-off',
          s0: 130,
          s1: 140,
          d0: -9,
          d1: -6.5,
          item: 'ferry-engines-off',
        },
        ...ferryDeck(),
        {
          kind: 'billboard',
          id: 'sign-landing-far-side',
          s0: 356,
          s1: 366,
          d0: 6.5,
          d1: 9,
          item: 'ferry-far-side',
        },
        {
          kind: 'billboard',
          id: 'bb-landing-priority',
          s0: 372,
          s1: 412,
          d0: -16,
          d1: -7,
          item: 'ferry-priority',
        },
        // Playtest 1c item 2: the landing pad's other spot (the race seed picks one), mid-lane.
        {
          kind: 'boostPad',
          id: 'pad-ferry-landing-early',
          s0: 480,
          s1: 486,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'pnw-pad-landing' },
        },
        // The junction choice, signed (W-R; interview, 2026-10-02: "junction choices in races"): the
        // Logging Spur's split is the last 40 m of the landing, on the right.
        {
          kind: 'billboard',
          id: 'sign-landing-spur-ahead',
          s0: 600,
          s1: 610,
          d0: 6.5,
          d1: 9,
          item: 'spur-keep-right',
        },
        // A boost pad on the right of the lane, lining you up for the Logging Spur's split zone.
        {
          kind: 'boostPad',
          id: 'pad-ferry-landing',
          s0: 630,
          s1: 636,
          d0: 2.5,
          d1: 4.5,
          params: { boostMps: 8, holdS: 1.5, slot: 'pnw-pad-landing' },
        },
      ],
      // The transfer spans from the docks to the ferry: railed, over the water.
      barriers: [
        { s0: 150, s1: FERRY.hullS0, side: 'both', kind: 'rail', heightM: 1.1 },
        { s0: FERRY.hullS1, s1: 340, side: 'both', kind: 'rail', heightM: 1.1 },
      ],
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
      // Run W-U: the log trucks' road (`logging`, the region's traffic area: mostly log trucks, both
      // ways), with the clear-cut on its right, between it and the Logging Spur.
      tags: [
        { s0: 0, s1: 'end', side: 'both', tag: 'forest' },
        { s0: 0, s1: 'end', side: 'both', tag: 'logging' },
        { s0: CLEARCUT.gradeRight[0], s1: CLEARCUT.gradeRight[1], side: 'right', tag: 'clearcut' },
      ],
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
        // Playtest 4 (P4-19): the Timber Trestle stands on timber bents by its own tag (render/road-mesh.ts).
        { s0: 100, s1: 760, side: 'both', tag: 'trestle' },
        { s0: 100, s1: 760, side: 'both', tag: 'water-open' },
        { s0: 760, s1: 'end', side: 'both', tag: 'forest' },
      ],
      features: [
        { kind: 'billboard', id: 'bb-trestle-gutter', s0: 780, s1: 820, d0: 7, d1: 16, item: 'gutter-truth' },
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
      id: 'pnw-espresso-row',
      name: 'Espresso Row',
      lengthM: 1000,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [{ centreM: 600, lengthM: 260, heightM: 4 }],
      // Run W-U: the town's main street is closed for the Stump Social (`festival`) between the barricades.
      tags: [
        { s0: 0, s1: FESTIVAL.s0, side: 'both', tag: 'town' },
        { s0: FESTIVAL.s0, s1: FESTIVAL.s1, side: 'both', tag: 'festival' },
        { s0: FESTIVAL.s1, s1: 700, side: 'both', tag: 'town' },
        { s0: 700, s1: 'end', side: 'both', tag: 'forest' },
      ],
      features: [
        {
          kind: 'roadsideZone',
          id: 'espresso-stand-line',
          s0: 20,
          s1: 110,
          d0: 5.6,
          d1: 12.6,
          params: { spawns: 'pedestrians' },
        },
        {
          kind: 'billboard',
          id: 'sign-row-last-espresso',
          s0: 60,
          s1: 70,
          d0: 6.5,
          d1: 9,
          item: 'last-espresso',
        },
        {
          kind: 'billboard',
          id: 'sign-row-zipper',
          s0: 90,
          s1: 100,
          d0: -9,
          d1: -6.5,
          item: 'espresso-zipper',
        },
        {
          kind: 'billboard',
          id: 'sign-row-closed',
          s0: 100,
          s1: 110,
          d0: 6.5,
          d1: 9,
          item: 'stump-social-closed',
        },
        ...stumpSocial(),
        {
          kind: 'billboard',
          id: 'sign-row-log-rolling',
          s0: 250,
          s1: 260,
          d0: -9,
          d1: -6.5,
          item: 'log-rolling',
        },
        {
          kind: 'billboard',
          id: 'sign-row-carving',
          s0: 350,
          s1: 360,
          d0: 6.5,
          d1: 9,
          item: 'carving-demo',
        },
        {
          kind: 'billboard',
          id: 'sign-row-parade',
          s0: 450,
          s1: 460,
          d0: -9,
          d1: -6.5,
          item: 'parade-route',
        },
        {
          kind: 'billboard',
          id: 'sign-row-festival-end',
          s0: 630,
          s1: 640,
          d0: 6.5,
          d1: 9,
          item: 'stump-social-end',
        },
        {
          kind: 'billboard',
          id: 'bb-row-drizzlewood',
          s0: 645,
          s1: 685,
          d0: -16,
          d1: -7,
          item: 'drizzlewood-roast',
        },
        { kind: 'billboard', id: 'bb-row-sogproof', s0: 720, s1: 760, d0: 7, d1: 16, item: 'sogproof-shell' },
        {
          kind: 'billboard',
          id: 'bb-row-view-lots',
          s0: 790,
          s1: 830,
          d0: -16,
          d1: -7,
          item: 'view-lots',
        },
      ],
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
      // The flats up to the mill yard's gate (playtest 3, T5.2): the truck, the wall and the split
      // zone of the Mill Yard Cut stand on its last 40 m.
      id: 'pnw-sawmill-flats',
      name: 'Sawmill Flats',
      lengthM: MILL_CUT.splitS,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: SAWMILL_TAGS,
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
          kind: 'billboard',
          id: 'sign-sawmill-cut-ahead',
          s0: 518,
          s1: 528,
          d0: 6.5,
          d1: 9,
          item: 'mill-cut',
        },
        // Playtest 3 (T5.2; the maintainer: "the static one could be used to get to shortcuts"): the
        // truck that is always there (no slot), parked on the right shoulder with its ramp down. Its lip is
        // 25 m short of the split zone, so a bike that leaves it and steers right is still in the air
        // when it reaches the zone, out past the wall.
        MILL_CUT.truck,
      ],
      barriers: [MILL_CUT.wall],
    },
    {
      id: 'c-pnw-mill-split',
      name: 'Mill yard gate',
      connector: true,
      lengthM: MILL_CUT.connectorM,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: SAWMILL_TAGS,
      features: [],
      barriers: [MILL_CUT.wallAfter],
    },
    {
      // Beside the Mill Yard Cut: the same flats, the main road's own traffic.
      id: 'pnw-sawmill-yard',
      name: 'Sawmill Flats',
      lengthM: MILL_CUT.yardM,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: SAWMILL_TAGS,
      features: [
        // The sprint to the standard finish.
        {
          kind: 'boostPad',
          id: 'pad-sawmill-sprint',
          s0: 10,
          s1: 16,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'pnw-pad-sprint' },
        },
        {
          kind: 'boostPad',
          id: 'pad-sawmill-final',
          s0: 170,
          s1: 176,
          d0: 0.5,
          d1: 3,
          params: { boostMps: 8, holdS: 1.5, slot: 'pnw-pad-sprint' },
        },
      ],
      barriers: [{ ...MILL_CUT.wallAfter, s1: MILL_CUT.wallAlongM }],
    },
    {
      id: 'c-pnw-mill-merge',
      name: 'Mill yard exit',
      connector: true,
      lengthM: MILL_CUT.connectorM,
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: SAWMILL_TAGS,
      features: [],
      barriers: [],
    },
    {
      // The last of the flats, to the mill's end: the long route's finish is on it.
      id: 'pnw-sawmill-end',
      name: 'Sawmill Flats',
      speedLimitMps: FOREST_MPS,
      surface: 'asphalt',
      humps: [],
      tags: SAWMILL_TAGS,
      features: [],
      barriers: [],
    },
  ],
  branches: [
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
      // Named for the routes (W-R): the id the race derived before, so nothing keyed on it changes.
      named: {
        id: 'pnw-logging-spur',
        kind: 'shortcut',
        marked: true,
        sign: 'LOGGING SPUR: KEEP RIGHT. Shorter by a hill. Longer by a log truck.',
      },
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
          ramps: [{ id: 'log-deck', ...LOG_DECK }],
          // Run W-U: a fresh clear-cut, stumps and all, and the region's billboard for it.
          tags: [
            { s0: 0, s1: 'end', side: 'both', tag: 'forest' },
            { s0: CLEARCUT.spurRight[0], s1: CLEARCUT.spurRight[1], side: 'right', tag: 'clearcut' },
            { s0: CLEARCUT.spurLeft[0], s1: CLEARCUT.spurLeft[1], side: 'left', tag: 'clearcut' },
          ],
          features: [
            ...clearCut(),
            {
              kind: 'billboard',
              id: 'bb-spur-replanting',
              s0: 120,
              s1: 160,
              d0: 19,
              d1: 28,
              item: 'replanting',
            },
          ],
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
    {
      // The Mill Yard Cut (playtest 3, T5.2): a concrete haul road through the mill's yard, behind a
      // jumpable wall on the right of the flats; only the ramp truck's flight reaches it. The zone
      // starts at the lanes' outer edge, so a rider on the ground can never pick it.
      leave: {
        road: 'pnw-sawmill-flats',
        offsetM: MILL_CUT.offsetM,
        lane: 'R1',
        zone: { lengthM: MILL_CUT.splitS - MILL_CUT.lipS, d0: 5.5, d1: 12.5 },
      },
      join: { road: 'pnw-sawmill-end', offsetM: -0.5, lane: 'R1' },
      turnsM: [20, 60],
      // Two points of the flats' straight, 5 m right of its centre line, 85 and 170 m past the split:
      // they hold the yard road parallel to the main road while the sim's hand-over between the two
      // can act (the first 150 m), so a rider pressing the wall on the ground is never taken across.
      // The yard road then eases back to the main road's lane for the merge.
      via: [
        { x: 2567.07, z: -4240.35, headingDeg: 15.26, turnM: 20 },
        { x: 2589.44, z: -4322.35, headingDeg: 15.26, turnM: 20 },
      ],
      lanes: [
        { id: 'S1', dCenterM: MILL_CUT.laneCentreM, widthM: MILL_CUT.laneM, direction: 1, kind: 'shortcut' },
      ],
      named: {
        id: 'pnw-mill-yard-cut',
        kind: 'alternate',
        marked: true,
        sign: MILL_CUT.sign,
        aiTake: 0,
      },
      roads: [
        {
          id: 'c-pnw-mill-in',
          name: 'Mill yard gate',
          connector: true,
          lengthM: MILL_CUT.connectorM,
          speedLimitMps: FOREST_MPS,
          surface: 'concrete',
          humps: [],
          tags: SAWMILL_TAGS,
          features: [],
          barriers: [],
        },
        {
          id: 'pnw-mill-yard-cut',
          name: 'Mill Yard Cut',
          lengthM: MILL_CUT.yardM,
          speedLimitMps: FOREST_MPS,
          surface: 'concrete',
          humps: [],
          tags: SAWMILL_TAGS,
          features: [
            // The reward for the jump, besides a road with no traffic on it.
            {
              kind: 'boostPad',
              id: 'pad-mill-cut',
              s0: 110,
              s1: 116,
              d0: 2.5,
              d1: 5.5,
              params: { boostMps: 8, holdS: 1.5 },
            },
          ],
          barriers: [],
        },
        {
          id: 'c-pnw-mill-out',
          name: 'Mill yard exit',
          connector: true,
          speedLimitMps: FOREST_MPS,
          surface: 'concrete',
          humps: [],
          tags: SAWMILL_TAGS,
          features: [],
          barriers: [],
        },
      ],
    },
  ],
  routes: [
    {
      // Short (about 2.8 km): the ferry dock, the ferry and the landing to the end of Cedar Hollow.
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
      // Standard (about 4.4 km, 2 to 3 minutes): over the trestle to the line at the end of the
      // espresso stands on Espresso Row.
      id: 'pnw-espresso-run',
      start: { road: 'pnw-ferry-landing', s: 40, dir: 1 },
      finish: { road: 'pnw-espresso-row', s: 700 },
      checkpoints: [
        { road: 'pnw-cedar-hollow', s: 300 },
        { road: 'pnw-cedar-hollow', s: 900 },
        { road: 'pnw-trestle', s: 400 },
        { road: 'pnw-espresso-row', s: 300 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    },
    {
      // Long (about 6.6 km): on over Fogline Ridge to the end of the Sawmill Flats.
      id: 'pnw-sawmill-haul',
      start: { road: 'pnw-ferry-landing', s: 40, dir: 1 },
      finish: { road: 'pnw-sawmill-end', s: -40 },
      checkpoints: [
        { road: 'pnw-cedar-hollow', s: 300 },
        { road: 'pnw-cedar-hollow', s: 900 },
        { road: 'pnw-trestle', s: 400 },
        { road: 'pnw-espresso-row', s: 300 },
        { road: 'pnw-fogline-ridge', s: 500 },
        { road: 'pnw-sawmill-flats', s: 500 },
      ],
      startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
    },
  ],
};
