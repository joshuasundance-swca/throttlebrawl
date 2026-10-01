// Traffic-4's animals and oddities as simple, distinct shapes (M3 traffic-4 head start; render
// follow-up 5 in the traffic4-hs report): the iguana, the pelican, the gator, the gator on a lawn
// chair, the runaway mobile home and the parked boat on its trailer. Before this every animal drew as
// the pedestrian figure and both oddities as the truck box. Other animals (the chicken, the PNW's
// raccoon and elk, SF's sea lion) share one plain four-legged figure tinted per kind. Each figure is
// merged boxes (one instanced draw per figure in view), built in a unit box that faces -z: x across
// [-0.5, 0.5], y up [0, 1], z along [-0.5, 0.5], then scaled per instance to the traffic type's width
// and length and the figure's height, as the car and truck shapes are. Presentation only.
import type { SimTrafficTypeDef } from '../sim/api';
import type { BoxPart } from './geometry';

/** A pedestrian-or-animal figure: `person` is the old pedestrian figure (drawn at its own size). */
export type PedFigure = 'person' | 'iguana' | 'pelican' | 'gator' | 'lawnGator' | 'critter';
/** An oddity vehicle with its own figure (the rest draw as cars or trucks). */
export type OddityFigure = 'mobileHome' | 'boatTrailer' | 'cableCar';

const name = (contentId: string) => contentId.slice(contentId.lastIndexOf(':') + 1);

/** Which figure draws a pedestrian or animal type (by its id; a missing type is a person). */
export function pedFigureFor(def: SimTrafficTypeDef | undefined, contentId: string): PedFigure {
  const id = name(contentId);
  if (/lawn-chair/.test(id)) return 'lawnGator';
  if (/gator/.test(id)) return 'gator';
  if (/iguana/.test(id)) return 'iguana';
  if (/pelican/.test(id)) return 'pelican';
  return def?.category === 'animal' ? 'critter' : 'person';
}

/** Which oddity figure draws a vehicle type, or null for a plain car or truck. */
export function oddityFigureFor(contentId: string): OddityFigure | null {
  const id = name(contentId);
  if (/mobile-home/.test(id)) return 'mobileHome';
  // W-O (2026-10-01): San Francisco's cable car, the Blender model once it loads (views.ts).
  if (/cable-car/.test(id)) return 'cableCar';
  if (/boat/.test(id)) return 'boatTrailer';
  return null;
}

/** Each scaled figure's height, metres (a critter's comes from its length). */
export const FIGURE_HEIGHT_M: Readonly<
  Record<Exclude<PedFigure, 'person' | 'critter'> | OddityFigure, number>
> = {
  iguana: 0.3,
  pelican: 1.0,
  gator: 0.45,
  lawnGator: 1.15,
  mobileHome: 3.2,
  boatTrailer: 2.3,
  cableCar: 3.2,
};

/** A plain animal's height from its length: a chicken stays small, an elk stands tall. [default] */
export function critterHeightM(lengthM: number): number {
  return Math.min(1.7, Math.max(0.3, lengthM * 0.6));
}

/** Sizes when a type is missing from the catalog, metres (width, length). */
export const FIGURE_DEFAULT_DIMS: Readonly<
  Record<Exclude<PedFigure, 'person'> | OddityFigure, { widthM: number; lengthM: number }>
> = {
  iguana: { widthM: 0.3, lengthM: 0.9 },
  pelican: { widthM: 0.6, lengthM: 0.7 },
  gator: { widthM: 0.6, lengthM: 2.4 },
  lawnGator: { widthM: 0.8, lengthM: 1.4 },
  critter: { widthM: 0.4, lengthM: 0.6 },
  mobileHome: { widthM: 2.4, lengthM: 7.5 },
  boatTrailer: { widthM: 2.4, lengthM: 7 },
  cableCar: { widthM: 2.6, lengthM: 8.5 },
};

/** A plain animal's tint by name (the figure's light parts take it). */
const CRITTER_TINT: Readonly<Record<string, string>> = {
  chicken: '#f4f1e8',
  raccoon: '#7a756d',
  elk: '#8a6440',
  'sea-lion': '#6b5a4a',
};
export function critterTint(contentId: string): string {
  const id = name(contentId);
  for (const [k, c] of Object.entries(CRITTER_TINT)) if (id.includes(k)) return c;
  return '#9a8a6a';
}

const GREEN = '#5f8f3a';
const IGUANA: BoxPart[] = [
  { size: [0.7, 0.55, 0.45], at: [0, 0.4, 0], color: GREEN },
  { size: [0.55, 0.5, 0.2], at: [0, 0.5, -0.32], color: '#6f9f45' },
  { size: [0.25, 0.25, 0.55], at: [0, 0.25, 0.48], color: GREEN },
  { size: [0.12, 0.25, 0.5], at: [0, 0.78, -0.02], color: '#c97b3a' },
  { size: [0.12, 0.3, 0.1], at: [0, 0.2, -0.3], color: '#c97b3a' },
  { size: [0.25, 0.3, 0.12], at: [-0.45, 0.15, -0.15], color: '#4f7a30' },
  { size: [0.25, 0.3, 0.12], at: [0.45, 0.15, -0.15], color: '#4f7a30' },
  { size: [0.25, 0.3, 0.12], at: [-0.45, 0.15, 0.15], color: '#4f7a30' },
  { size: [0.25, 0.3, 0.12], at: [0.45, 0.15, 0.15], color: '#4f7a30' },
];

const PELICAN: BoxPart[] = [
  { size: [0.1, 0.3, 0.1], at: [-0.15, 0.15, 0], color: '#d9a441' },
  { size: [0.1, 0.3, 0.1], at: [0.15, 0.15, 0], color: '#d9a441' },
  { size: [0.75, 0.4, 0.75], at: [0, 0.5, 0.05], color: '#8c8577' },
  { size: [0.85, 0.08, 0.6], at: [0, 0.72, 0.1], color: '#e8e2c8' },
  { size: [0.3, 0.1, 0.25], at: [0, 0.55, 0.5], color: '#8c8577' },
  { size: [0.18, 0.4, 0.18], at: [0, 0.85, -0.25], color: '#e8e2c8' },
  { size: [0.25, 0.18, 0.3], at: [0, 1.05, -0.3], color: '#e8e2c8' },
  { size: [0.12, 0.06, 0.7], at: [0, 1.0, -0.75], color: '#d9a441' },
  { size: [0.1, 0.12, 0.5], at: [0, 0.92, -0.68], color: '#c98a31' },
];

const GATOR_SKIN = '#3f4a2b';
const GATOR: BoxPart[] = [
  { size: [1, 0.6, 0.45], at: [0, 0.4, -0.02], color: GATOR_SKIN },
  { size: [0.5, 0.15, 0.4], at: [0, 0.75, 0], color: '#2e3324' },
  { size: [0.6, 0.45, 0.25], at: [0, 0.32, 0.32], color: GATOR_SKIN },
  { size: [0.35, 0.3, 0.2], at: [0, 0.25, 0.5], color: GATOR_SKIN },
  { size: [0.8, 0.5, 0.15], at: [0, 0.4, -0.3], color: GATOR_SKIN },
  { size: [0.6, 0.3, 0.15], at: [0, 0.32, -0.45], color: '#5a6338' },
  { size: [0.15, 0.15, 0.04], at: [-0.25, 0.7, -0.3], color: '#d9c441' },
  { size: [0.15, 0.15, 0.04], at: [0.25, 0.7, -0.3], color: '#d9c441' },
  { size: [0.3, 0.35, 0.08], at: [-0.6, 0.17, -0.16], color: '#2e3324' },
  { size: [0.3, 0.35, 0.08], at: [0.6, 0.17, -0.16], color: '#2e3324' },
  { size: [0.3, 0.35, 0.08], at: [-0.6, 0.17, 0.16], color: '#2e3324' },
  { size: [0.3, 0.35, 0.08], at: [0.6, 0.17, 0.16], color: '#2e3324' },
];

const FRAME = '#f4f1e8';
const WEBBING = '#e86f9a';
const LAWN_GATOR: BoxPart[] = [
  // The lawn chair: white tube frame, pink webbing, the back leaning back.
  { size: [0.06, 0.35, 0.06], at: [-0.45, 0.17, -0.3], color: FRAME },
  { size: [0.06, 0.35, 0.06], at: [0.45, 0.17, -0.3], color: FRAME },
  { size: [0.06, 0.35, 0.06], at: [-0.45, 0.17, 0.3], color: FRAME },
  { size: [0.06, 0.35, 0.06], at: [0.45, 0.17, 0.3], color: FRAME },
  { size: [0.9, 0.06, 0.55], at: [0, 0.36, 0.05], color: WEBBING },
  { size: [0.9, 0.6, 0.06], at: [0, 0.62, 0.38], color: WEBBING, rotX: 0.4 },
  { size: [0.06, 0.06, 0.5], at: [-0.47, 0.5, 0.1], color: FRAME },
  { size: [0.06, 0.06, 0.5], at: [0.47, 0.5, 0.1], color: FRAME },
  // The gator, leaning back with its snout up and its tail over the side, in sunglasses.
  { size: [0.55, 0.22, 0.5], at: [0, 0.48, 0.05], color: GATOR_SKIN },
  { size: [0.5, 0.45, 0.2], at: [0, 0.66, 0.28], color: GATOR_SKIN, rotX: 0.4 },
  { size: [0.4, 0.2, 0.4], at: [0, 0.95, 0.15], color: GATOR_SKIN },
  { size: [0.3, 0.14, 0.32], at: [0, 0.92, -0.17], color: '#5a6338' },
  { size: [0.42, 0.06, 0.04], at: [0, 1.0, -0.06], color: '#111111' },
  { size: [0.15, 0.4, 0.15], at: [0.52, 0.25, 0.3], color: GATOR_SKIN },
  { size: [0.15, 0.12, 0.3], at: [-0.25, 0.42, -0.3], color: GATOR_SKIN },
  { size: [0.15, 0.12, 0.3], at: [0.25, 0.42, -0.3], color: GATOR_SKIN },
];

/** Light parts take the instance tint; the dark ones stay dark. */
const CRITTER: BoxPart[] = [
  { size: [1, 0.45, 0.65], at: [0, 0.55, 0.05], color: '#ffffff' },
  { size: [0.6, 0.35, 0.3], at: [0, 0.75, -0.4], color: '#ffffff' },
  { size: [0.62, 0.08, 0.06], at: [0, 0.82, -0.56], color: '#222222' },
  { size: [0.2, 0.35, 0.15], at: [-0.3, 0.17, -0.25], color: '#b0b0b0' },
  { size: [0.2, 0.35, 0.15], at: [0.3, 0.17, -0.25], color: '#b0b0b0' },
  { size: [0.2, 0.35, 0.15], at: [-0.3, 0.17, 0.3], color: '#b0b0b0' },
  { size: [0.2, 0.35, 0.15], at: [0.3, 0.17, 0.3], color: '#b0b0b0' },
  { size: [0.15, 0.15, 0.2], at: [0, 0.65, 0.45], color: '#d0d0d0' },
];

const DARK = '#111111';
/** The cable car's stand-in until its model loads: maroon below, cream above, a dark roof. */
const CABLE_CAR: BoxPart[] = [
  { size: [0.8, 0.12, 0.9], at: [0, 0.12, 0], color: DARK },
  { size: [1, 0.06, 1], at: [0, 0.22, 0], color: '#7a5a3a' },
  { size: [1, 0.25, 0.48], at: [0, 0.37, 0], color: '#8c2f2f' },
  { size: [1, 0.33, 0.48], at: [0, 0.66, 0], color: '#e9dcb0' },
  { size: [0.3, 0.45, 0.5], at: [0, 0.47, 0], color: '#7a5a3a' },
  { size: [1, 0.15, 0.03], at: [0, 0.32, -0.485], color: '#8c2f2f' },
  { size: [1, 0.15, 0.03], at: [0, 0.32, 0.485], color: '#8c2f2f' },
  { size: [1.06, 0.06, 1.02], at: [0, 0.85, 0], color: '#3f3b37' },
  { size: [0.55, 0.1, 0.85], at: [0, 0.93, 0], color: '#3f3b37' },
];
const MOBILE_HOME: BoxPart[] = [
  { size: [0.98, 0.12, 0.95], at: [0, 0.1, 0], color: '#3a3a3a' },
  { size: [1.02, 0.14, 0.1], at: [0, 0.07, -0.08], color: DARK },
  { size: [1.02, 0.14, 0.1], at: [0, 0.07, 0.12], color: DARK },
  { size: [1, 0.6, 0.92], at: [0, 0.45, 0.03], color: '#e8e2c8' },
  { size: [1.01, 0.08, 0.92], at: [0, 0.5, 0.03], color: '#9fc5b8' },
  { size: [1.04, 0.06, 0.96], at: [0, 0.77, 0.03], color: '#d98c5f' },
  { size: [0.6, 0.08, 0.96], at: [0, 0.83, 0.03], color: '#d98c5f' },
  { size: [0.25, 0.06, 0.96], at: [0, 0.89, 0.03], color: '#d98c5f' },
  { size: [0.5, 0.15, 0.02], at: [0, 0.58, -0.44], color: '#2a3440' },
  { size: [1.02, 0.14, 0.12], at: [0, 0.58, -0.2], color: '#2a3440' },
  { size: [1.02, 0.14, 0.12], at: [0, 0.58, 0.25], color: '#2a3440' },
  { size: [0.02, 0.38, 0.08], at: [0.505, 0.38, 0.05], color: '#8a6a45' },
  { size: [0.08, 0.05, 0.12], at: [0, 0.12, -0.53], color: '#3a3a3a' },
  { size: [0.02, 0.12, 0.02], at: [0.2, 0.98, 0.2], color: '#9aa3ab' },
];

const BOAT_TRAILER: BoxPart[] = [
  { size: [0.6, 0.06, 1], at: [0, 0.15, 0], color: '#5a5f66' },
  { size: [0.06, 0.05, 0.15], at: [0, 0.15, -0.55], color: '#5a5f66' },
  { size: [0.95, 0.16, 0.08], at: [0, 0.08, 0.1], color: DARK },
  { size: [0.85, 0.35, 0.85], at: [0, 0.4, 0.05], color: '#f4f1e8' },
  { size: [0.6, 0.3, 0.15], at: [0, 0.42, -0.42], color: '#f4f1e8' },
  { size: [0.87, 0.06, 0.85], at: [0, 0.45, 0.05], color: '#19b5b0' },
  { size: [0.3, 0.25, 0.15], at: [0, 0.68, 0.05], color: '#e8c07d' },
  { size: [0.12, 0.35, 0.06], at: [0, 0.45, 0.5], color: '#2b2b2b' },
];

/** Each figure's boxes (the person keeps views.ts's pedestrian parts). */
export const FIGURE_PARTS: Readonly<Record<Exclude<PedFigure, 'person'> | OddityFigure, BoxPart[]>> = {
  iguana: IGUANA,
  pelican: PELICAN,
  gator: GATOR,
  lawnGator: LAWN_GATOR,
  critter: CRITTER,
  mobileHome: MOBILE_HOME,
  boatTrailer: BOAT_TRAILER,
  cableCar: CABLE_CAR,
};
