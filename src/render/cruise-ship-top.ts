// The cruise ship's top deck, code-made (playtest 4, P4-19, run C's live check, lane J3: "the cruise ship
// reads as a small white block over Duval's end"). Codex CX6's `cruise_ship` is a navy hull under three
// white tiers, and from Duval Street the fronts hide everything under about 35 m, so what the rider sees
// over the roofs is the top tier: a plain white block. What a cruise ship shows over a roofline is its
// funnel, its mast and radar, a row of orange lifeboats along each deck edge and, above all, its water
// slides, so those are made here, in the model's own frame (root at the waterline, +Z the bow, +Y up,
// metres at scale 1) and drawn with it: the ship's own scale applies to them too. Presentation only, no
// words and no brand: an invented, unmarked funnel.
import { SoupBuilder } from './fred';
import type { Soup } from './fred';

/** Where the top deck's parts stand in the model's frame, m. [default] (the model's tiers: 45 to 52 m, and the bridge at 46 to 49 m) */
export const CRUISE_SHIP_TOP = {
  /** A circle that covers all of it, for the layer's levels of detail (the hull is 290 m long). */
  radiusM: 150,
  /** The funnel: its footprint along the ship and across it, and its height range. */
  funnel: { f0: -73, f1: -55, halfAcross: 4.4, y0: 52, y1: 64 },
  /** The highest point of any of it (the funnel's cap). */
  topM: 64.8,
  /** The lifeboats: along each deck edge of the second tier's roof, a boat every `pitch`, from `from` to `to`. */
  boats: { x: 14.5, halfAcross: 0.95, y0: 45, y1: 47.2, length: 9, from: -80, to: 62, pitch: 17 },
} as const;

/** One water slide: the points of its run in the model's frame, its tube's radius and its colour. */
export interface Slide {
  points: readonly (readonly [number, number, number])[];
  radius: number;
  hex: string;
}

/** Three slides coiling down aft from a tower on the top deck, in the park's red, yellow and blue. */
export const CRUISE_SLIDES: readonly Slide[] = [
  {
    points: [
      [-1.2, 63, 33],
      [7, 60, 22],
      [-6, 57, 11],
      [5, 54.5, -1],
      [-3, 53, -12],
    ],
    radius: 1,
    hex: '#e8483c',
  },
  {
    points: [
      [1.2, 63, 33],
      [-8, 60.5, 24],
      [6.5, 57.5, 13],
      [-5, 55, 1],
      [4, 53, -10],
    ],
    radius: 1,
    hex: '#f2c14e',
  },
  {
    points: [
      [0, 62, 34],
      [9, 59.5, 27],
      [-7, 56.5, 16],
      [7, 54, 5],
      [-1, 53, -7],
    ],
    radius: 1,
    hex: '#3c8de8',
  },
];

const NAVY = '#23406b';
const BAND = '#f2c14e';
const CAP = '#2b2f36';
const GREY = '#8a8f96';
const TOWER = '#d9dde2';
const BOAT = '#f08a24';

/** The ship's top deck in boxes: the funnel and its band and cap, the slides' tower, the mast and radar, the lifeboats. */
export function cruiseShipTopSoup(): Soup {
  const b = new SoupBuilder();
  const F = CRUISE_SHIP_TOP.funnel;
  b.box(-F.halfAcross, F.halfAcross, F.y0, F.y1 - 0.8, F.f0, F.f1, NAVY);
  b.box(-F.halfAcross - 0.06, F.halfAcross + 0.06, F.y0 + 7, F.y0 + 10, F.f0 - 0.06, F.f1 + 0.06, BAND);
  b.box(
    -F.halfAcross - 0.3,
    F.halfAcross + 0.3,
    F.y1 - 0.8,
    CRUISE_SHIP_TOP.topM,
    F.f0 - 0.3,
    F.f1 + 0.3,
    CAP,
  );
  // The slides' tower, forward of the funnel and aft of the bridge: the tubes start at its top.
  b.box(-2.6, 2.6, 52.3, 62, 32, 35.5, TOWER);
  // The mast on the bridge and its radar bar.
  b.box(-0.4, 0.4, 49, 62.5, 76, 77, GREY);
  b.box(-3.4, 3.4, 62.5, 63.1, 75.6, 77.4, GREY);
  // The lifeboats, along both deck edges.
  const B = CRUISE_SHIP_TOP.boats;
  for (const side of [-1, 1])
    for (let f = B.from; f <= B.to; f += B.pitch)
      b.box(
        side * B.x - B.halfAcross,
        side * B.x + B.halfAcross,
        B.y0,
        B.y1,
        f - B.length / 2,
        f + B.length / 2,
        BOAT,
      );
  return b.soup;
}
