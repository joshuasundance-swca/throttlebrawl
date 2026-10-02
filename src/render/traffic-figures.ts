// W-P "fill the world" (maintainer, 2026-10-01b: "traffic and people", "UNIQUE REGIONAL FLAVOR
// EVERYWHERE"): each region's own traffic and people as their own shapes, instead of the generic
// car box, truck box and pedestrian. Golf carts, beach cruisers, rental convertibles, pickups towing
// boats and snowbird RVs in the Keys; log trucks, wagons with kayaks, cyclists in rain capes and
// motorhomes in the Pacific Northwest; driverless robotaxis with a roof sensor, delivery e-bikes,
// e-scooter riders and unmarked shuttles in San Francisco. People: joggers, hikers in rain shells,
// dog walkers, dogs, and a person shaking a fist or holding up a phone to film (the `pedReact`
// poses). Same contract as figures.ts: merged boxes, one instanced draw per figure in view, built in
// a unit box facing -z (x across [-0.5, 0.5], y up [0, 1], z along [-0.5, 0.5]); a vehicle or a
// dog is scaled per instance to its type's width and length and the figure's height, a person is
// drawn at its own size in metres. White parts take the instance tint (the paint). Flat colours,
// no textures: every look recolours them. Presentation only.
import type { SimTrafficTypeDef } from '../sim/api';
import type { BoxPart } from './geometry';

/** A road-vehicle figure (the rest draw as figures.ts's shapes, or the car and truck boxes). */
export const TRAFFIC_FIGURES = [
  'golfCart',
  'convertible',
  'boatPickup',
  'rv',
  'logTruck',
  'wagon',
  'robotaxi',
  'shuttle',
  'cruiser',
  'rainCyclist',
  'eBike',
  'scooterRider',
] as const;
export type TrafficFigure = (typeof TRAFFIC_FIGURES)[number];

/** A person or animal figure; `personFist` and `personPhone` are the reaction poses. */
export const PEOPLE_FIGURES = ['jogger', 'hiker', 'dogWalker', 'dog', 'personFist', 'personPhone'] as const;
export type PeopleFigure = (typeof PEOPLE_FIGURES)[number];

const name = (contentId: string) => contentId.slice(contentId.lastIndexOf(':') + 1);

/** Which regional figure draws a road-vehicle type, by its id; null for the older shapes. */
export function trafficFigureFor(contentId: string): TrafficFigure | null {
  const id = name(contentId);
  if (/golf-cart/.test(id)) return 'golfCart';
  if (/convertible/.test(id)) return 'convertible';
  if (/towing-boat/.test(id)) return 'boatPickup';
  if (/snowbird-rv|motorhome|camper-van/.test(id)) return 'rv';
  if (/log-truck/.test(id)) return 'logTruck';
  if (/kayak|wagon/.test(id)) return 'wagon';
  if (/robotaxi/.test(id)) return 'robotaxi';
  if (/shuttle/.test(id)) return 'shuttle';
  if (/e-bike/.test(id)) return 'eBike';
  if (/scooter-rider/.test(id)) return 'scooterRider';
  if (/cruiser/.test(id)) return 'cruiser';
  if (/cyclist/.test(id)) return 'rainCyclist';
  return null;
}

/**
 * Which regional figure draws a pedestrian or animal, by its id and the reaction it is showing
 * (`fist` or `film`): a person who reacts takes the pose; null for figures.ts's figures.
 */
export function peopleFigureFor(
  def: SimTrafficTypeDef | undefined,
  contentId: string,
  gesture: 'fist' | 'film' | null,
): PeopleFigure | null {
  const id = name(contentId);
  const animal = def ? def.category === 'animal' : /dog|doodle/.test(id);
  if (animal) return /(^|-)dog$|doodle/.test(id) ? 'dog' : null;
  if (gesture === 'fist') return 'personFist';
  if (gesture === 'film') return 'personPhone';
  if (/jogger|runner/.test(id)) return 'jogger';
  if (/hiker/.test(id)) return 'hiker';
  if (/dog-walker/.test(id)) return 'dogWalker';
  return null;
}

/** Each vehicle figure's height, metres (scaled per instance like the car and truck boxes). */
export const TRAFFIC_FIGURE_HEIGHT_M: Readonly<Record<TrafficFigure, number>> = {
  golfCart: 1.8,
  convertible: 1.25,
  boatPickup: 2.3,
  rv: 3.3,
  logTruck: 3.6,
  wagon: 2.0,
  robotaxi: 1.95,
  shuttle: 3.0,
  cruiser: 1.75,
  rainCyclist: 1.75,
  eBike: 1.8,
  scooterRider: 1.8,
};
/** A dog's height, metres (its width and length come from its type). */
export const DOG_HEIGHT_M = 0.6;

/** Sizes when a type is missing from the catalog, metres. */
export const TRAFFIC_FIGURE_DIMS: Readonly<
  Record<TrafficFigure | 'dog', { widthM: number; lengthM: number }>
> = {
  golfCart: { widthM: 1.3, lengthM: 2.4 },
  convertible: { widthM: 1.8, lengthM: 4.6 },
  boatPickup: { widthM: 2.2, lengthM: 7.5 },
  rv: { widthM: 2.4, lengthM: 7.5 },
  logTruck: { widthM: 2.6, lengthM: 16 },
  wagon: { widthM: 1.8, lengthM: 4.8 },
  robotaxi: { widthM: 1.9, lengthM: 4.8 },
  shuttle: { widthM: 2.6, lengthM: 11 },
  cruiser: { widthM: 0.6, lengthM: 1.8 },
  rainCyclist: { widthM: 0.6, lengthM: 1.8 },
  eBike: { widthM: 0.7, lengthM: 1.8 },
  scooterRider: { widthM: 0.55, lengthM: 1.1 },
  dog: { widthM: 0.35, lengthM: 0.9 },
};

/**
 * A dog's coat by kind, else by entity. The instance tint multiplies every vertex colour, so only
 * the dog (one coat, dark ears and collar) takes one; every other figure bakes its colours and
 * draws untinted, so skin, kayaks and logs keep theirs.
 */
const COATS = ['#c9a36b', '#3b2b20', '#e8d5b0', '#7a5a3c'];
const DOG_COAT: Readonly<Record<string, string>> = {
  'wet-dog': '#5a4636',
  doodle: '#e8d5b0',
  'dive-bar-dog': '#c9a36b',
};

/** The instance tint for a figure: a dog's coat, white (no tint) for everything else. */
export function trafficFigureTint(fig: TrafficFigure | PeopleFigure, contentId: string, id: number): string {
  if (fig !== 'dog') return '#ffffff';
  const n = name(contentId);
  for (const [k, c] of Object.entries(DOG_COAT)) if (n.includes(k)) return c;
  return COATS[Math.abs(id) % COATS.length] ?? '#ffffff';
}

// ---- Shapes ------------------------------------------------------------------------------

const PAINTED = '#ffffff';
const DARK = '#111111';
const GLASS = '#2a3440';
const SKIN = '#d9a27a';
const METAL = '#9aa3ab';

const GOLF_CART: BoxPart[] = [
  { size: [1, 0.18, 0.98], at: [0, 0.2, 0], color: '#f4f1e8' },
  { size: [1.04, 0.16, 0.18], at: [0, 0.08, -0.33], color: DARK },
  { size: [1.04, 0.16, 0.18], at: [0, 0.08, 0.33], color: DARK },
  { size: [0.9, 0.06, 0.32], at: [0, 0.33, 0.02], color: '#e8e2c8' },
  { size: [0.9, 0.22, 0.08], at: [0, 0.44, 0.16], color: '#e8e2c8' },
  { size: [0.05, 0.62, 0.05], at: [-0.45, 0.62, -0.4], color: '#d9d9d9' },
  { size: [0.05, 0.62, 0.05], at: [0.45, 0.62, -0.4], color: '#d9d9d9' },
  { size: [0.05, 0.62, 0.05], at: [-0.45, 0.62, 0.42], color: '#d9d9d9' },
  { size: [0.05, 0.62, 0.05], at: [0.45, 0.62, 0.42], color: '#d9d9d9' },
  { size: [1.04, 0.05, 0.98], at: [0, 0.95, 0.01], color: '#f4f1e8' },
  { size: [0.8, 0.3, 0.03], at: [0, 0.6, -0.42], color: '#b9d3df' },
  // The driver, and the golf bag on the back.
  { size: [0.32, 0.26, 0.2], at: [-0.22, 0.48, 0.02], color: '#ff8fab' },
  { size: [0.2, 0.14, 0.15], at: [-0.22, 0.68, 0.0], color: SKIN },
  { size: [0.26, 0.04, 0.2], at: [-0.22, 0.76, -0.02], color: '#f4f1e8' },
  { size: [0.24, 0.42, 0.18], at: [0.24, 0.48, 0.42], color: '#2f5d8a' },
];

const CONVERTIBLE: BoxPart[] = [
  { size: [1, 0.36, 1], at: [0, 0.3, 0], color: '#e84a5f' },
  { size: [1.04, 0.26, 0.17], at: [0, 0.13, -0.32], color: DARK },
  { size: [1.04, 0.26, 0.17], at: [0, 0.13, 0.32], color: DARK },
  { size: [0.86, 0.05, 0.5], at: [0, 0.49, 0.1], color: '#7a4b3a' },
  { size: [0.86, 0.28, 0.03], at: [0, 0.62, -0.12], color: '#b9d3df', rotX: 0.45 },
  { size: [0.9, 0.04, 0.1], at: [0, 0.5, 0.46], color: '#2b2b2b' },
  { size: [0.16, 0.18, 0.14], at: [-0.22, 0.62, 0.02], color: '#5bc0eb' },
  { size: [0.14, 0.14, 0.12], at: [-0.22, 0.78, 0.02], color: SKIN },
  { size: [0.16, 0.18, 0.14], at: [0.22, 0.62, 0.02], color: '#f2c14e' },
  { size: [0.14, 0.14, 0.12], at: [0.22, 0.78, 0.02], color: SKIN },
  { size: [0.22, 0.04, 0.2], at: [0.22, 0.86, 0.02], color: '#f4f1e8' },
  { size: [0.2, 0.08, 0.02], at: [-0.32, 0.36, -0.505], color: '#fff3c4' },
  { size: [0.2, 0.08, 0.02], at: [0.32, 0.36, -0.505], color: '#fff3c4' },
];

const BOAT_PICKUP: BoxPart[] = [
  // The pickup, front half.
  { size: [1, 0.3, 0.14], at: [0, 0.3, -0.43], color: '#c9ced3' },
  { size: [1, 0.52, 0.16], at: [0, 0.38, -0.29], color: '#c9ced3' },
  { size: [0.86, 0.18, 0.02], at: [0, 0.54, -0.375], color: GLASS },
  { size: [1, 0.24, 0.22], at: [0, 0.24, -0.1], color: '#c9ced3' },
  { size: [1.04, 0.14, 0.07], at: [0, 0.07, -0.4], color: DARK },
  { size: [1.04, 0.14, 0.07], at: [0, 0.07, -0.12], color: DARK },
  // The trailer and its boat, back half.
  { size: [0.08, 0.05, 0.12], at: [0, 0.14, 0.04], color: '#5a5f66' },
  { size: [0.6, 0.05, 0.42], at: [0, 0.13, 0.28], color: '#5a5f66' },
  { size: [0.92, 0.12, 0.07], at: [0, 0.06, 0.28], color: DARK },
  { size: [0.82, 0.24, 0.44], at: [0, 0.32, 0.28], color: '#f4f1e8' },
  { size: [0.55, 0.2, 0.08], at: [0, 0.34, 0.04], color: '#f4f1e8' },
  { size: [0.84, 0.05, 0.44], at: [0, 0.36, 0.28], color: '#19b5b0' },
  { size: [0.28, 0.2, 0.08], at: [0, 0.54, 0.26], color: '#e8c07d' },
  { size: [0.12, 0.3, 0.04], at: [0, 0.36, 0.5], color: '#2b2b2b' },
];

const RV: BoxPart[] = [
  { size: [1, 0.72, 0.9], at: [0, 0.5, 0.05], color: '#f2efe6' },
  { size: [1, 0.24, 0.14], at: [0, 0.3, -0.44], color: '#f2efe6' },
  { size: [1, 0.2, 0.18], at: [0, 0.76, -0.38], color: '#f2efe6' },
  { size: [0.9, 0.2, 0.02], at: [0, 0.5, -0.4], color: GLASS },
  { size: [1.01, 0.07, 0.9], at: [0, 0.38, 0.05], color: '#7a9e9f' },
  { size: [1.01, 0.04, 0.9], at: [0, 0.46, 0.05], color: '#7a9e9f' },
  { size: [1.01, 0.12, 0.3], at: [0, 0.66, 0.15], color: GLASS },
  { size: [0.3, 0.06, 0.15], at: [0, 0.89, 0.15], color: '#d9d9d9' },
  { size: [0.04, 0.6, 0.02], at: [0.32, 0.5, 0.51], color: METAL },
  { size: [0.5, 0.18, 0.03], at: [-0.12, 0.62, 0.52], color: '#c0392b' },
  { size: [1.02, 0.14, 0.08], at: [0, 0.07, -0.3], color: DARK },
  { size: [1.02, 0.14, 0.08], at: [0, 0.07, 0.3], color: DARK },
];

const LOG_TRUCK: BoxPart[] = [
  // The cab, painted.
  { size: [0.9, 0.3, 0.07], at: [0, 0.28, -0.465], color: '#b8452e' },
  { size: [1, 0.56, 0.12], at: [0, 0.42, -0.37], color: '#b8452e' },
  { size: [0.88, 0.16, 0.02], at: [0, 0.56, -0.43], color: GLASS },
  { size: [0.05, 0.32, 0.05], at: [0.42, 0.78, -0.33], color: METAL },
  { size: [0.6, 0.08, 0.86], at: [0, 0.16, 0.07], color: '#2b2b2b' },
  // The logs, ends showing, between the stakes.
  { size: [0.9, 0.48, 0.66], at: [0, 0.55, 0.16], color: '#8a6440' },
  { size: [0.92, 0.48, 0.02], at: [0, 0.55, 0.495], color: '#c9a36b' },
  { size: [0.92, 0.48, 0.02], at: [0, 0.55, -0.175], color: '#c9a36b' },
  { size: [0.04, 0.56, 0.04], at: [-0.47, 0.55, -0.1], color: '#3a3a3a' },
  { size: [0.04, 0.56, 0.04], at: [0.47, 0.55, -0.1], color: '#3a3a3a' },
  { size: [0.04, 0.56, 0.04], at: [-0.47, 0.55, 0.42], color: '#3a3a3a' },
  { size: [0.04, 0.56, 0.04], at: [0.47, 0.55, 0.42], color: '#3a3a3a' },
  { size: [1.02, 0.14, 0.05], at: [0, 0.07, -0.42], color: DARK },
  { size: [1.02, 0.14, 0.05], at: [0, 0.07, 0.1], color: DARK },
  { size: [1.02, 0.14, 0.05], at: [0, 0.07, 0.38], color: DARK },
];

const WAGON: BoxPart[] = [
  { size: [1, 0.3, 1], at: [0, 0.25, 0], color: '#3d5a6c' },
  { size: [0.88, 0.24, 0.66], at: [0, 0.52, 0.08], color: GLASS },
  { size: [0.9, 0.04, 0.66], at: [0, 0.66, 0.08], color: '#3d5a6c' },
  { size: [0.96, 0.03, 0.04], at: [0, 0.7, -0.12], color: '#2b2b2b' },
  { size: [0.96, 0.03, 0.04], at: [0, 0.7, 0.28], color: '#2b2b2b' },
  { size: [0.18, 0.08, 1.06], at: [-0.22, 0.76, 0.06], color: '#e2a33a' },
  { size: [0.18, 0.08, 1.02], at: [0.22, 0.76, 0.06], color: '#c0392b' },
  { size: [1.04, 0.18, 0.16], at: [0, 0.09, -0.32], color: DARK },
  { size: [1.04, 0.18, 0.16], at: [0, 0.09, 0.32], color: DARK },
  { size: [0.2, 0.06, 0.02], at: [-0.32, 0.3, -0.505], color: '#fff3c4' },
  { size: [0.2, 0.06, 0.02], at: [0.32, 0.3, -0.505], color: '#fff3c4' },
];

const ROBOTAXI: BoxPart[] = [
  { size: [1, 0.36, 1], at: [0, 0.27, 0], color: '#f4f4f4' },
  { size: [0.86, 0.28, 0.58], at: [0, 0.59, 0.05], color: GLASS },
  { size: [0.88, 0.04, 0.58], at: [0, 0.74, 0.05], color: '#f4f4f4' },
  // The roof sensor stack, spinning (as far as anyone can tell), and the brand's teal stripe.
  { size: [0.34, 0.12, 0.3], at: [0, 0.82, 0.05], color: '#2b2b2b' },
  { size: [0.22, 0.08, 0.22], at: [0, 0.92, 0.05], color: '#7fd1c7' },
  { size: [0.08, 0.08, 0.08], at: [-0.53, 0.45, -0.38], color: '#2b2b2b' },
  { size: [0.08, 0.08, 0.08], at: [0.53, 0.45, -0.38], color: '#2b2b2b' },
  { size: [1.01, 0.05, 0.62], at: [0, 0.36, 0.06], color: '#7fd1c7' },
  { size: [1.04, 0.2, 0.16], at: [0, 0.1, -0.32], color: DARK },
  { size: [1.04, 0.2, 0.16], at: [0, 0.1, 0.32], color: DARK },
];

const SHUTTLE: BoxPart[] = [
  { size: [1, 0.78, 1], at: [0, 0.47, 0], color: '#f4f4f4' },
  { size: [1.01, 0.2, 0.84], at: [0, 0.62, 0.06], color: GLASS },
  { size: [0.9, 0.3, 0.02], at: [0, 0.6, -0.505], color: GLASS },
  { size: [0.98, 0.05, 0.98], at: [0, 0.88, 0], color: '#e6e6e6' },
  { size: [1.02, 0.14, 0.06], at: [0, 0.07, -0.34], color: DARK },
  { size: [1.02, 0.14, 0.06], at: [0, 0.07, 0.34], color: DARK },
  { size: [0.25, 0.06, 0.02], at: [-0.33, 0.24, -0.505], color: '#fff3c4' },
  { size: [0.25, 0.06, 0.02], at: [0.33, 0.24, -0.505], color: '#fff3c4' },
];

/** A beach cruiser: fat tyres, a wire basket, a sun hat (the Keys). */
const CRUISER: BoxPart[] = [
  { size: [0.14, 0.38, 0.38], at: [0, 0.2, -0.32], color: DARK },
  { size: [0.14, 0.38, 0.38], at: [0, 0.2, 0.32], color: DARK },
  { size: [0.08, 0.06, 0.66], at: [0, 0.36, 0], color: '#ff8fab' },
  { size: [0.42, 0.14, 0.16], at: [0, 0.42, -0.44], color: '#c9a36b' },
  { size: [0.3, 0.26, 0.16], at: [0, 0.42, 0.1], color: '#2d2f3a' },
  { size: [0.6, 0.3, 0.26], at: [0, 0.66, 0.04], color: '#7fd1c7' },
  { size: [0.5, 0.06, 0.28], at: [0, 0.7, -0.17], color: SKIN },
  { size: [0.26, 0.13, 0.16], at: [0, 0.88, 0.0], color: SKIN },
  { size: [0.5, 0.04, 0.34], at: [0, 0.96, 0.0], color: '#f2e6c8' },
  { size: [0.24, 0.06, 0.16], at: [0, 1.0, 0.0], color: '#f2e6c8' },
];

/** A cyclist in a rain cape, with fenders and a helmet (the Pacific Northwest). */
const RAIN_CYCLIST: BoxPart[] = [
  { size: [0.1, 0.36, 0.36], at: [0, 0.2, -0.32], color: DARK },
  { size: [0.1, 0.36, 0.36], at: [0, 0.2, 0.32], color: DARK },
  { size: [0.12, 0.04, 0.4], at: [0, 0.4, -0.32], color: '#2b2b2b' },
  { size: [0.12, 0.04, 0.4], at: [0, 0.4, 0.32], color: '#2b2b2b' },
  { size: [0.08, 0.06, 0.66], at: [0, 0.36, 0], color: '#3d4a3f' },
  { size: [0.3, 0.24, 0.16], at: [0, 0.42, 0.1], color: '#2d2f3a' },
  { size: [0.7, 0.36, 0.4], at: [0, 0.64, 0.0], color: '#e8c547' },
  { size: [0.26, 0.13, 0.16], at: [0, 0.88, -0.02], color: SKIN },
  { size: [0.3, 0.08, 0.22], at: [0, 0.97, -0.02], color: '#2e5e4e' },
];

/** A delivery e-bike: the insulated box on the back is the tell. */
const E_BIKE: BoxPart[] = [
  { size: [0.12, 0.34, 0.34], at: [0, 0.19, -0.33], color: DARK },
  { size: [0.12, 0.34, 0.34], at: [0, 0.19, 0.33], color: DARK },
  { size: [0.12, 0.1, 0.66], at: [0, 0.34, 0], color: '#2b2b2b' },
  { size: [0.16, 0.12, 0.2], at: [0, 0.3, 0.05], color: '#3a3a3a' },
  { size: [0.3, 0.24, 0.16], at: [0, 0.42, 0.04], color: '#2d2f3a' },
  { size: [0.55, 0.28, 0.24], at: [0, 0.64, 0.0], color: '#2b2b2b' },
  { size: [0.24, 0.12, 0.15], at: [0, 0.84, -0.04], color: SKIN },
  { size: [0.28, 0.07, 0.19], at: [0, 0.92, -0.04], color: '#2b2b2b' },
  { size: [0.8, 0.32, 0.36], at: [0, 0.72, 0.28], color: '#e2a33a' },
];

/** An e-scooter rider, standing, one earbud in. */
const SCOOTER_RIDER: BoxPart[] = [
  { size: [0.32, 0.05, 0.8], at: [0, 0.06, 0], color: '#2b2b2b' },
  { size: [0.12, 0.08, 0.14], at: [0, 0.04, -0.42], color: DARK },
  { size: [0.12, 0.08, 0.14], at: [0, 0.04, 0.42], color: DARK },
  { size: [0.06, 0.52, 0.06], at: [0, 0.33, -0.38], color: METAL },
  { size: [0.8, 0.03, 0.05], at: [0, 0.59, -0.38], color: '#2b2b2b' },
  { size: [0.42, 0.36, 0.16], at: [0, 0.25, 0.06], color: '#2d2f3a' },
  { size: [0.7, 0.3, 0.26], at: [0, 0.6, 0.02], color: '#3b7d5a' },
  { size: [0.36, 0.12, 0.22], at: [0, 0.82, -0.02], color: SKIN },
  { size: [0.4, 0.05, 0.24], at: [0, 0.89, -0.02], color: '#2b2b2b' },
];

/** A dog in the unit box (scaled to its type): the white parts take its coat. */
const DOG: BoxPart[] = [
  { size: [0.55, 0.36, 0.7], at: [0, 0.55, 0.08], color: PAINTED },
  { size: [0.45, 0.32, 0.3], at: [0, 0.8, -0.32], color: PAINTED },
  { size: [0.28, 0.16, 0.18], at: [0, 0.72, -0.5], color: PAINTED },
  { size: [0.1, 0.08, 0.06], at: [0, 0.76, -0.6], color: DARK },
  { size: [0.12, 0.18, 0.08], at: [-0.17, 0.98, -0.32], color: '#3b2b20' },
  { size: [0.12, 0.18, 0.08], at: [0.17, 0.98, -0.32], color: '#3b2b20' },
  { size: [0.14, 0.42, 0.12], at: [-0.17, 0.2, -0.2], color: PAINTED },
  { size: [0.14, 0.42, 0.12], at: [0.17, 0.2, -0.2], color: PAINTED },
  { size: [0.14, 0.42, 0.12], at: [-0.17, 0.2, 0.32], color: PAINTED },
  { size: [0.14, 0.42, 0.12], at: [0.17, 0.2, 0.32], color: PAINTED },
  { size: [0.1, 0.1, 0.3], at: [0, 0.82, 0.5], color: PAINTED, rotX: -0.6 },
  { size: [0.47, 0.07, 0.07], at: [0, 0.66, -0.2], color: '#c0392b' },
];

/** People, in metres (drawn at their own size, facing -z). Shirts take the tint. */
const LEGS: BoxPart[] = [
  { size: [0.14, 0.8, 0.16], at: [-0.1, 0.4, 0], color: '#2d2f3a' },
  { size: [0.14, 0.8, 0.16], at: [0.1, 0.4, 0], color: '#2d2f3a' },
];
const JOGGER: BoxPart[] = [
  { size: [0.13, 0.78, 0.15], at: [-0.1, 0.42, 0.12], color: '#3a6ea5', rotX: 0.35 },
  { size: [0.13, 0.78, 0.15], at: [0.1, 0.42, -0.12], color: '#3a6ea5', rotX: -0.35 },
  { size: [0.4, 0.5, 0.24], at: [0, 1.06, 0], color: '#ff6b6b' },
  { size: [0.1, 0.42, 0.1], at: [-0.26, 1.06, -0.1], color: SKIN, rotX: 0.5 },
  { size: [0.1, 0.42, 0.1], at: [0.26, 1.06, 0.1], color: SKIN, rotX: -0.5 },
  { size: [0.22, 0.24, 0.22], at: [0, 1.46, 0], color: SKIN },
  { size: [0.24, 0.05, 0.24], at: [0, 1.53, 0], color: '#f4f1e8' },
  { size: [0.16, 0.06, 0.24], at: [-0.1, 0.03, 0.12], color: '#f4f1e8' },
];
const HIKER: BoxPart[] = [
  ...LEGS,
  { size: [0.46, 0.62, 0.3], at: [0, 1.11, 0], color: '#c0392b' },
  { size: [0.3, 0.3, 0.3], at: [0, 1.58, 0.02], color: '#c0392b' },
  { size: [0.18, 0.16, 0.02], at: [0, 1.56, -0.14], color: SKIN },
  { size: [0.36, 0.5, 0.22], at: [0, 1.15, 0.26], color: '#5d6b4f' },
  { size: [0.04, 1.1, 0.04], at: [0.32, 0.6, -0.12], color: METAL },
  { size: [0.12, 0.6, 0.12], at: [0.3, 1.0, -0.05], color: '#c0392b' },
];
const DOG_WALKER: BoxPart[] = [
  ...LEGS,
  { size: [0.44, 0.6, 0.26], at: [0, 1.1, 0], color: '#8fd3f0' },
  { size: [0.24, 0.26, 0.24], at: [0, 1.55, 0], color: SKIN },
  { size: [0.26, 0.08, 0.26], at: [0, 1.7, 0], color: '#2b2b2b' },
  { size: [0.1, 0.52, 0.1], at: [0.28, 1.05, -0.08], color: SKIN },
  { size: [0.09, 0.14, 0.09], at: [0.28, 0.8, -0.12], color: '#f4f1e8' },
  { size: [0.1, 0.5, 0.1], at: [-0.28, 1.05, -0.12], color: SKIN, rotX: 0.5 },
  { size: [0.03, 0.03, 0.8], at: [-0.3, 0.72, -0.6], color: '#c0392b', rotX: 0.5 },
];
/** A fist shaken at the road (the right arm up). */
const PERSON_FIST: BoxPart[] = [
  ...LEGS,
  { size: [0.44, 0.6, 0.26], at: [0, 1.1, 0], color: '#ff8c42' },
  { size: [0.24, 0.26, 0.24], at: [0, 1.55, 0], color: SKIN },
  { size: [0.1, 0.52, 0.1], at: [-0.28, 1.05, 0], color: SKIN },
  { size: [0.1, 0.5, 0.1], at: [0.3, 1.62, -0.04], color: SKIN },
  { size: [0.15, 0.15, 0.15], at: [0.3, 1.92, -0.04], color: SKIN },
];
/** A phone held up to film (both arms forward, the screen lit). */
const PERSON_PHONE: BoxPart[] = [
  ...LEGS,
  { size: [0.44, 0.6, 0.26], at: [0, 1.1, 0], color: '#ff8c42' },
  { size: [0.24, 0.26, 0.24], at: [0, 1.55, 0], color: SKIN },
  { size: [0.09, 0.09, 0.42], at: [-0.12, 1.38, -0.28], color: SKIN },
  { size: [0.09, 0.09, 0.42], at: [0.12, 1.38, -0.28], color: SKIN },
  { size: [0.16, 0.24, 0.03], at: [0, 1.46, -0.5], color: '#111111' },
  { size: [0.13, 0.2, 0.01], at: [0, 1.46, -0.52], color: '#8fd3f0' },
];

/** Each regional figure's boxes. */
export const TRAFFIC_FIGURE_PARTS: Readonly<Record<TrafficFigure | PeopleFigure, BoxPart[]>> = {
  golfCart: GOLF_CART,
  convertible: CONVERTIBLE,
  boatPickup: BOAT_PICKUP,
  rv: RV,
  logTruck: LOG_TRUCK,
  wagon: WAGON,
  robotaxi: ROBOTAXI,
  shuttle: SHUTTLE,
  cruiser: CRUISER,
  rainCyclist: RAIN_CYCLIST,
  eBike: E_BIKE,
  scooterRider: SCOOTER_RIDER,
  jogger: JOGGER,
  hiker: HIKER,
  dogWalker: DOG_WALKER,
  dog: DOG,
  personFist: PERSON_FIST,
  personPhone: PERSON_PHONE,
};

/** Whether a figure is a road vehicle (its mesh uses the vehicle material). */
export function isTrafficFigure(key: string): key is TrafficFigure {
  return (TRAFFIC_FIGURES as readonly string[]).includes(key);
}
/** Whether a figure is a person or animal drawn here. */
export function isPeopleFigure(key: string): key is PeopleFigure {
  return (PEOPLE_FIGURES as readonly string[]).includes(key);
}
