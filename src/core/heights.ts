// How tall things are, and how big a rider's box is (playtest 4, the hitbox audit, 2026-10-06:
// "heights do not follow the drawing"). The sim measured every contact at one height; a rider in the
// air passed through a 3.3 m truck, and a tumble box was 1.5 or 3.2 m by hazard class. This file is
// the contract the sim reads next: each collidable thing has a height in metres, written in its pack
// file where it has one, else the default below, and scripts/hitboxes.test.ts holds every height
// within `HEIGHT_TOLERANCE_M` of what is drawn. Nothing in the sim reads them yet (docs/content-packs.md,
// "Heights and hitboxes"). A contract: changes land in a small contract PR (docs/architecture.md).
import type { SmashableKind } from './smashables';

/** How far a height may sit from the drawn one, m (the hitbox audit's rule for each end and side). */
export const HEIGHT_TOLERANCE_M = 0.15;
/** The tallest height a pack may give, m: a sanity bound for a typo (a tram is 3.5 m, a stair tower 6.4 m). */
export const MAX_HEIGHT_M = 12;

/** The traffic categories (the `traffic-type` file's `category`). */
export type TrafficCategory = 'car' | 'truck' | 'rv' | 'oddity' | 'pedestrian' | 'animal';

/**
 * The height of a traffic type whose file gives none, m, by category [default]: the median of the
 * drawn heights of the shipped types of that category, to the decimetre (the test derives it again,
 * so the table cannot drift from the drawings).
 */
export const TRAFFIC_HEIGHT_DEFAULT_M: Readonly<Record<TrafficCategory, number>> = {
  car: 1.8,
  truck: 3.1,
  rv: 3.2,
  oddity: 3.1,
  pedestrian: 1.7,
  animal: 0.6,
};

/** A traffic type's height, m: its `heightM`, else its category's default. */
export function trafficHeightM(t: { category: TrafficCategory; heightM?: number | undefined }): number {
  return t.heightM ?? TRAFFIC_HEIGHT_DEFAULT_M[t.category];
}

/** A rider's contact box on its bike, m: length along the heading, width across. */
export interface Hitbox {
  lengthM: number;
  widthM: number;
}

/**
 * The box every rider has unless its file says otherwise, m (sim/traffic `TRAFFIC.riderLengthM` and
 * `riderWidthM`, the same in peds, smash, set pieces and the tumble; the test holds them equal). The
 * drawn bikes are scaled to fit it (render/riders/bake.ts), all but the few a file gives a box of
 * their own: the lawnmower, the mobility scooter and the parking trike.
 */
export const DEFAULT_HITBOX: Readonly<Hitbox> = { lengthM: 2.0, widthM: 0.8 };

/**
 * A rider's contact box: its own file's `hitbox`, else the bike's, else the default box. A rider is
 * drawn on a bike model of its own (`look.bikeModel`), and the player on the model of the bike it
 * owns, so the box follows whichever the file that names the drawing says.
 */
export function hitboxOf(riderBox?: Hitbox, bikeBox?: Hitbox): Hitbox {
  return riderBox ?? bikeBox ?? DEFAULT_HITBOX;
}

/** A roadside smashable's height by kind, m: the drawn shape, an overhead canopy left out. */
export const SMASHABLE_HEIGHT_M: Readonly<Record<SmashableKind, number>> = {
  'lobster-traps': 1.7,
  mailbox: 1.55,
  'parking-meter': 1.65,
  'pop-up-desk': 1.2,
  'cafe-table': 0.9,
  'firewood-stand': 1.45,
};

/** The set-piece props a rider can touch (sim/modifiers `extent`), and how tall each is drawn, m. */
export const SET_PIECE_PROP_HEIGHT_M = {
  cone: 1.35,
  flare: 1.2,
  barricade: 1.3,
  hayBale: 0.7,
  log: 0.65,
} as const;
export type SetPieceHeightKind = keyof typeof SET_PIECE_PROP_HEIGHT_M;

/** The height of a solid road hazard that names no `heightM`, by its `params.object`, m. */
export const HAZARD_OBJECT_HEIGHT_M: Readonly<Record<string, number>> = {
  bear: 2.05,
  barricade: 1.2,
  'stair-tower': 6.4,
  pickup: 1.9,
  'coffee-cart': 2.4,
  stump: 0.8,
  'log-pile': 2.05,
  'gate-post': 7.6,
};
/** The height of a solid hazard of an object the table does not list (sim/riders `HAZARD_DEFAULT_HEIGHT_M`), m. */
export const HAZARD_FALLBACK_HEIGHT_M = 1.5;

/** A solid hazard's height, m: the feature's `params.heightM`, else its object's, else the fallback. */
export function hazardHeightM(object: string | undefined, heightM: number | undefined): number {
  return (
    heightM ?? (object !== undefined ? HAZARD_OBJECT_HEIGHT_M[object] : undefined) ?? HAZARD_FALLBACK_HEIGHT_M
  );
}
