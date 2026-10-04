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
// Playtest 3 (T4.3) adds the real-world local life (a pedicab, a road train, a streetcar, a rooster
// and a parrot flock), the big animals that used to share the chicken's shape (elk, raccoon, sea
// lion), and the moving ramp truck: a car carrier drawn twice, ramp stowed and ramp lowered, which
// views.ts swaps at the `rampDown` beat.
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
  'pedicab',
  'roadTrain',
  'streetcar',
  'carCarrier',
  'carCarrierRamp',
] as const;
export type TrafficFigure = (typeof TRAFFIC_FIGURES)[number];

/** A person or animal figure; `personFist` and `personPhone` are the reaction poses. */
export const PEOPLE_FIGURES = [
  'jogger',
  'hiker',
  'dogWalker',
  'dog',
  'personFist',
  'personPhone',
  'elk',
  'raccoon',
  'seaLion',
  'rooster',
  'parrotFlock',
] as const;
export type PeopleFigure = (typeof PEOPLE_FIGURES)[number];

/** The people figures that are animals: scaled to their type's width and length, like the dog. */
const ANIMAL_FIGURES = ['dog', 'elk', 'raccoon', 'seaLion', 'rooster', 'parrotFlock'] as const;
export type AnimalFigure = (typeof ANIMAL_FIGURES)[number];
export function isAnimalFigure(key: string): key is AnimalFigure {
  return (ANIMAL_FIGURES as readonly string[]).includes(key);
}

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
  // Playtest 3: the local life, and the moving ramp truck (views.ts swaps it for its lowered-ramp twin).
  if (/pedicab/.test(id)) return 'pedicab';
  if (/island-tram|road-train/.test(id)) return 'roadTrain';
  if (/streetcar/.test(id)) return 'streetcar';
  if (/cargo-bike/.test(id)) return 'cruiser';
  if (/car-carrier/.test(id)) return 'carCarrier';
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
  const animal = def
    ? def.category === 'animal'
    : /dog|doodle|(^|-)elk$|raccoon|sea-lion|rooster|parrot/.test(id);
  if (animal) {
    if (/(^|-)dog$|doodle/.test(id)) return 'dog';
    if (/(^|-)elk$/.test(id)) return 'elk';
    if (/raccoon/.test(id)) return 'raccoon';
    if (/sea-lion/.test(id)) return 'seaLion';
    if (/rooster/.test(id)) return 'rooster';
    if (/parrot/.test(id)) return 'parrotFlock';
    return null;
  }
  if (gesture === 'fist') return 'personFist';
  if (gesture === 'film') return 'personPhone';
  if (/jogger|runner/.test(id)) return 'jogger';
  if (/hiker|pod-diner/.test(id)) return 'hiker';
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
  pedicab: 2.1,
  roadTrain: 2.6,
  streetcar: 3.4,
  carCarrier: 2.6,
  carCarrierRamp: 2.6,
};
/** Each animal figure's height, metres (its width and length come from its type). */
export const ANIMAL_HEIGHT_M: Readonly<Record<AnimalFigure, number>> = {
  dog: 0.6,
  elk: 2.4,
  raccoon: 0.4,
  seaLion: 0.7,
  rooster: 0.55,
  parrotFlock: 1.0,
};
/** How high a parrot flock circles above the road, metres (it dives up and away from there). */
export const FLOCK_LIFT_M = 1.8;

/** Sizes when a type is missing from the catalog, metres. */
export const TRAFFIC_FIGURE_DIMS: Readonly<
  Record<TrafficFigure | AnimalFigure, { widthM: number; lengthM: number }>
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
  pedicab: { widthM: 1.2, lengthM: 2.6 },
  roadTrain: { widthM: 2.2, lengthM: 14 },
  streetcar: { widthM: 2.5, lengthM: 20 },
  // The car carrier is a tow truck's size: the rival AI sizes every vehicle by the largest in a race.
  carCarrier: { widthM: 2.4, lengthM: 7.5 },
  carCarrierRamp: { widthM: 2.4, lengthM: 7.5 },
  dog: { widthM: 0.35, lengthM: 0.9 },
  elk: { widthM: 0.9, lengthM: 2.4 },
  raccoon: { widthM: 0.3, lengthM: 0.6 },
  seaLion: { widthM: 0.8, lengthM: 2.0 },
  rooster: { widthM: 0.3, lengthM: 0.45 },
  parrotFlock: { widthM: 2, lengthM: 2 },
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

/** The coats of the big animals (the packs' `paintOptions`): the figure's light parts take one by id. */
const ANIMAL_COATS: Readonly<Record<'elk' | 'raccoon' | 'seaLion', readonly string[]>> = {
  elk: ['#7a5a3c', '#a07a52', '#3b2b20'],
  raccoon: ['#6f6a63', '#7d776e', '#5f5a53'],
  seaLion: ['#6b5a4a', '#4a3f35'],
};

/**
 * The instance tint for a figure: a dog's coat, an elk's, a raccoon's or a sea lion's, and white (no
 * tint) for everything else.
 */
export function trafficFigureTint(fig: TrafficFigure | PeopleFigure, contentId: string, id: number): string {
  if (fig === 'elk' || fig === 'raccoon' || fig === 'seaLion') {
    const coats = ANIMAL_COATS[fig];
    return coats[Math.abs(id) % coats.length] ?? '#ffffff';
  }
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

// ---- Playtest 3 (T4.3) shapes ------------------------------------------------------------
// Designed in metres on the type's own width, height and length (the origin on the ground, centred,
// facing -z), then divided into the unit box the instance scale stretches back out.

/** A box in metres, fitted to a figure of this width, height and length (no rotation about x). */
function fit(parts: readonly BoxPart[], w: number, h: number, l: number): BoxPart[] {
  return parts.map((p) => ({
    ...p,
    size: [p.size[0] / w, p.size[1] / h, p.size[2] / l],
    at: [p.at[0] / w, p.at[1] / h, p.at[2] / l],
  }));
}

/**
 * A thin slab whose TOP surface runs from (z0, y0) to (z1, y1), in metres, on a figure of this
 * width, height and length. A box turns in the unit box before the instance scale stretches it, so
 * its angle is the unit box's, not the metres': the line through its top face is the same line both
 * ways, since the stretch is linear. `lift` raises it off that line, metres.
 */
function slab(
  fig: { w: number; h: number; l: number },
  z0: number,
  y0: number,
  z1: number,
  y1: number,
  widthM: number,
  thickM: number,
  color: string,
  lift = 0,
): BoxPart {
  const dy = (y1 - y0) / fig.h;
  const dz = (z1 - z0) / fig.l;
  const len = Math.hypot(dy, dz);
  // A turn about x takes the box's long z axis to (y, z) = (-sin a, cos a).
  const a = Math.atan2(dz < 0 ? dy : -dy, Math.abs(dz));
  const t = thickM / fig.h;
  // The top face is half a thickness out along the box's up axis, (cos a, sin a) in (y, z).
  return {
    size: [widthM / fig.w, t, len],
    at: [
      0,
      (y0 + y1) / 2 / fig.h + lift / fig.h - (Math.cos(a) * t) / 2,
      (z0 + z1) / 2 / fig.l - (Math.sin(a) * t) / 2,
    ],
    color,
    rotX: a,
  };
}

/** The car carrier: a 7.5 m by 2.4 m tow truck whose whole bed is the ramp (sim/modifiers moving-ramp). */
const CARRIER = { w: 2.4, h: 2.6, l: 7.5 };
/** The sim's ramp: it runs 5 m from the rear and rises 1.22 m (MOVING.rampRunM and rampSlope). */
const CARRIER_RUN_M = 5;
const CARRIER_LIP_M = 1.22;
const CARRIER_REAR_M = CARRIER.l / 2;
const CARRIER_YELLOW = '#f2c14e';
const CARRIER_SLATE = '#4a4f55';

/** Everything the carrier has with its ramp up or down: the cab, the rack, the lip, the wheels. */
function carrierShared(): BoxPart[] {
  return fit(
    [
      // The cab, a windscreen and a side window band, the bumper and the amber roof light.
      { size: [2.3, 1.6, 1.7], at: [0, 1.6, -2.9], color: CARRIER_YELLOW },
      { size: [2.0, 0.6, 0.04], at: [0, 2.0, -3.73], color: GLASS },
      { size: [2.32, 0.5, 0.9], at: [0, 2.0, -2.85], color: GLASS },
      { size: [2.3, 0.3, 0.12], at: [0, 0.55, -3.69], color: '#2b2b2b' },
      { size: [0.8, 0.12, 0.25], at: [0, 2.5, -2.9], color: '#ffb000' },
      // The frame under the cab, the headache rack behind it, and the level lip past the ramp.
      { size: [1.9, 0.3, 3.1], at: [0, 0.7, -2.15], color: '#2b2b2b' },
      { size: [2.2, 0.8, 0.1], at: [0, 1.6, -1.95], color: CARRIER_SLATE },
      { size: [2.0, 0.2, 0.8], at: [0, 1.1, -1.65], color: CARRIER_SLATE },
      // Three axles, the wheels outside the ramp's width.
      ...[-2.9, -0.4, 0.9].flatMap((z): BoxPart[] => [
        { size: [0.3, 0.9, 0.9], at: [-1.05, 0.45, z], color: DARK },
        { size: [0.3, 0.9, 0.9], at: [1.05, 0.45, z], color: DARK },
      ]),
    ],
    CARRIER.w,
    CARRIER.h,
    CARRIER.l,
  );
}

/** Ramp up: the bed level at the lip, its side rails, and the ramp folded up at the rear. */
const CAR_CARRIER: BoxPart[] = [
  ...carrierShared(),
  ...fit(
    [
      { size: [2.2, 0.2, 5.0], at: [0, 1.1, 1.25], color: CARRIER_SLATE },
      { size: [0.1, 0.25, 5.0], at: [-1.1, 1.3, 1.25], color: CARRIER_YELLOW },
      { size: [0.1, 0.25, 5.0], at: [1.1, 1.3, 1.25], color: CARRIER_YELLOW },
      { size: [0.2, 0.5, 4.4], at: [-0.95, 0.85, 1.5], color: '#2b2b2b' },
      { size: [0.2, 0.5, 4.4], at: [0.95, 0.85, 1.5], color: '#2b2b2b' },
      // The folded ramp stands at the rear, its warning stripes facing the road behind.
      { size: [1.8, 1.0, 0.1], at: [0, 1.7, 3.65], color: CARRIER_SLATE },
      { size: [1.6, 0.12, 0.02], at: [0, 1.4, 3.71], color: CARRIER_YELLOW },
      { size: [1.6, 0.12, 0.02], at: [0, 1.8, 3.71], color: CARRIER_YELLOW },
    ],
    CARRIER.w,
    CARRIER.h,
    CARRIER.l,
  ),
];

/** Ramp down: the bed tilted to the road, hazard-striped, running up to the sim's lip. */
const CAR_CARRIER_RAMP: BoxPart[] = [
  ...carrierShared(),
  slab(
    CARRIER,
    CARRIER_REAR_M,
    0.02,
    CARRIER_REAR_M - CARRIER_RUN_M,
    CARRIER_LIP_M,
    1.8,
    0.14,
    CARRIER_SLATE,
  ),
  // Warning stripes across the ramp, each a thin slab on the same slope.
  ...[0.6, 1.5, 2.4, 3.3, 4.2].map((d) => {
    const rise = (m: number) => 0.02 + ((CARRIER_LIP_M - 0.02) * m) / CARRIER_RUN_M;
    return slab(
      CARRIER,
      CARRIER_REAR_M - (d - 0.1),
      rise(d - 0.1),
      CARRIER_REAR_M - (d + 0.1),
      rise(d + 0.1),
      1.7,
      0.03,
      CARRIER_YELLOW,
      0.02,
    );
  }),
];

/** A pedicab: a bike front, a two-seat bench and a canopy (the Keys' Duval Street). */
const PEDICAB: BoxPart[] = fit(
  [
    { size: [0.08, 0.7, 0.7], at: [0, 0.35, -1.0], color: DARK },
    { size: [0.1, 0.6, 0.6], at: [-0.55, 0.3, 0.75], color: DARK },
    { size: [0.1, 0.6, 0.6], at: [0.55, 0.3, 0.75], color: DARK },
    { size: [1.1, 0.08, 0.08], at: [0, 0.3, 0.75], color: METAL },
    { size: [0.08, 0.08, 1.4], at: [0, 0.5, -0.25], color: '#2b2b2b' },
    { size: [0.6, 0.04, 0.04], at: [0, 1.05, -0.95], color: '#2b2b2b' },
    { size: [0.9, 0.25, 0.7], at: [0, 0.55, 0.6], color: '#c0392b' },
    { size: [0.9, 0.5, 0.1], at: [0, 0.95, 1.0], color: '#c0392b' },
    // The rider, up front, and two passengers on the bench.
    { size: [0.4, 0.5, 0.25], at: [0, 1.0, -0.45], color: '#3b7d5a' },
    { size: [0.22, 0.22, 0.22], at: [0, 1.38, -0.45], color: SKIN },
    { size: [0.3, 0.4, 0.2], at: [-0.22, 0.95, 0.65], color: '#ff8fab' },
    { size: [0.18, 0.18, 0.18], at: [-0.22, 1.28, 0.65], color: SKIN },
    { size: [0.3, 0.4, 0.2], at: [0.22, 0.95, 0.65], color: '#5bc0eb' },
    { size: [0.18, 0.18, 0.18], at: [0.22, 1.28, 0.65], color: SKIN },
    // The canopy and its four posts, a fringe along the back edge.
    { size: [0.04, 1.0, 0.04], at: [-0.52, 1.3, 0.2], color: METAL },
    { size: [0.04, 1.0, 0.04], at: [0.52, 1.3, 0.2], color: METAL },
    { size: [0.04, 1.0, 0.04], at: [-0.52, 1.3, 1.0], color: METAL },
    { size: [0.04, 1.0, 0.04], at: [0.52, 1.3, 1.0], color: METAL },
    { size: [1.2, 0.08, 1.2], at: [0, 1.85, 0.6], color: '#f2c14e' },
    { size: [1.2, 0.1, 0.06], at: [0, 1.76, 1.2], color: '#e84a5f' },
  ],
  1.2,
  2.1,
  2.6,
);

/** An island tram (a generic tourist road train): a tractor and two open carts of sightseers. */
const ROAD_TRAIN: BoxPart[] = fit(
  [
    // The tractor.
    { size: [1.4, 0.8, 1.3], at: [0, 0.95, -6.45], color: '#2f7d4f' },
    { size: [1.6, 1.0, 1.3], at: [0, 1.5, -5.25], color: '#2f7d4f' },
    { size: [1.8, 0.08, 1.5], at: [0, 2.1, -5.25], color: '#f4f1e8' },
    { size: [0.06, 0.4, 0.06], at: [0.5, 1.3, -6.9], color: METAL },
    ...[-6.3, -4.8].flatMap((z): BoxPart[] => [
      { size: [0.3, 0.8, 0.8], at: [-1.0, 0.4, z], color: DARK },
      { size: [0.3, 0.8, 0.8], at: [1.0, 0.4, z], color: DARK },
    ]),
    // Two open carts, each on its own pair of wheels, with benches of passengers.
    ...[-1.6, 3.6].flatMap((zc): BoxPart[] => [
      { size: [2.0, 0.2, 4.6], at: [0, 0.6, zc], color: '#f4f1e8' },
      { size: [0.08, 0.5, 4.6], at: [-1.0, 0.95, zc], color: '#2f7d4f' },
      { size: [0.08, 0.5, 4.6], at: [1.0, 0.95, zc], color: '#2f7d4f' },
      { size: [0.3, 0.7, 0.7], at: [-1.0, 0.35, zc + 1.4], color: DARK },
      { size: [0.3, 0.7, 0.7], at: [1.0, 0.35, zc + 1.4], color: DARK },
      { size: [1.6, 0.3, 0.3], at: [0, 0.85, zc - 0.6], color: '#7a4b3a' },
      { size: [1.6, 0.3, 0.3], at: [0, 0.85, zc + 0.8], color: '#7a4b3a' },
      { size: [0.4, 0.6, 0.25], at: [-0.4, 1.2, zc - 0.6], color: '#5bc0eb' },
      { size: [0.2, 0.2, 0.2], at: [-0.4, 1.6, zc - 0.6], color: SKIN },
      { size: [0.4, 0.6, 0.25], at: [0.4, 1.2, zc - 0.6], color: '#ff8fab' },
      { size: [0.2, 0.2, 0.2], at: [0.4, 1.6, zc - 0.6], color: SKIN },
      { size: [0.4, 0.6, 0.25], at: [-0.4, 1.2, zc + 0.8], color: '#f2c14e' },
      { size: [0.2, 0.2, 0.2], at: [-0.4, 1.6, zc + 0.8], color: SKIN },
    ]),
    // The hitches between them.
    { size: [0.2, 0.15, 0.7], at: [0, 0.5, -3.9], color: METAL },
    { size: [0.2, 0.15, 0.7], at: [0, 0.5, 1.0], color: METAL },
  ],
  2.2,
  2.6,
  14,
);

/** A streetcar: a 20 m low-floor car in two sections, a pantograph on the roof (Portland). */
const STREETCAR: BoxPart[] = fit(
  [
    ...[-5.1, 5.1].flatMap((zc): BoxPart[] => [
      { size: [2.4, 2.4, 9.6], at: [0, 1.7, zc], color: '#e8e2c8' },
      { size: [2.42, 0.3, 9.6], at: [0, 0.85, zc], color: '#2f7d4f' },
      { size: [2.44, 0.8, 9.0], at: [0, 2.15, zc], color: GLASS },
      { size: [2.0, 0.15, 9.2], at: [0, 3.0, zc], color: '#d6d0b4' },
      { size: [2.46, 0.5, 2.2], at: [0, 0.3, zc - 2.6], color: '#2b2b2b' },
      { size: [2.46, 0.5, 2.2], at: [0, 0.3, zc + 2.6], color: '#2b2b2b' },
      { size: [2.46, 1.8, 1.0], at: [0, 1.5, zc], color: '#cfc9ac' },
    ]),
    // The articulation between the sections.
    { size: [2.1, 2.3, 0.6], at: [0, 1.7, 0], color: '#2b2b2b' },
    // The pantograph, the destination board and the lamps.
    { size: [0.04, 0.4, 0.04], at: [-0.3, 3.35, -3.0], color: METAL },
    { size: [0.04, 0.4, 0.04], at: [0.3, 3.35, -3.0], color: METAL },
    { size: [0.8, 0.04, 0.04], at: [0, 3.58, -3.0], color: METAL },
    { size: [1.4, 0.3, 0.02], at: [0, 2.75, -9.91], color: '#ffb000' },
    { size: [0.3, 0.15, 0.02], at: [-0.8, 0.9, -9.91], color: '#fff3c4' },
    { size: [0.3, 0.15, 0.02], at: [0.8, 0.9, -9.91], color: '#fff3c4' },
  ],
  2.5,
  3.4,
  20,
);

/** A rooster: the chicken with a red comb and a tail plume (the Keys). */
const ROOSTER: BoxPart[] = fit(
  [
    { size: [0.2, 0.2, 0.3], at: [0, 0.27, 0.04], color: '#b5552b' },
    { size: [0.18, 0.18, 0.1], at: [0, 0.32, -0.1], color: '#d98c3a' },
    { size: [0.1, 0.12, 0.12], at: [0, 0.45, -0.15], color: '#b5552b' },
    { size: [0.04, 0.07, 0.1], at: [0, 0.53, -0.15], color: '#c0392b' },
    { size: [0.03, 0.06, 0.03], at: [0, 0.38, -0.22], color: '#c0392b' },
    { size: [0.04, 0.03, 0.06], at: [0, 0.45, -0.24], color: '#e2a33a' },
    { size: [0.03, 0.17, 0.03], at: [-0.05, 0.09, 0.02], color: '#e2a33a' },
    { size: [0.03, 0.17, 0.03], at: [0.05, 0.09, 0.02], color: '#e2a33a' },
    { size: [0.05, 0.22, 0.07], at: [0, 0.38, 0.19], color: '#1f3d2e' },
    { size: [0.05, 0.18, 0.06], at: [0, 0.46, 0.22], color: '#2e7d5b' },
    { size: [0.04, 0.12, 0.05], at: [0, 0.52, 0.25], color: '#c0392b' },
  ],
  0.3,
  0.55,
  0.45,
);

/** A flock of six parrots circling (SF's Telegraph Hill): views.ts lifts it and turns it. */
const PARROT_FLOCK: BoxPart[] = fit(
  Array.from({ length: 6 }, (_, k): BoxPart[] => {
    const a = (k / 6) * Math.PI * 2;
    const x = 0.7 * Math.cos(a);
    const z = 0.7 * Math.sin(a);
    const y = 0.45 + 0.1 * (k % 3);
    // Beaks lead the way the flock turns (views.ts turns it by +y, which carries a bird at angle a
    // round to a smaller angle).
    const turn = -a;
    const [fx, fz] = [-Math.sin(turn), -Math.cos(turn)];
    return [
      { size: [0.12, 0.1, 0.3], at: [x, y, z], color: '#3fae49', rotY: turn },
      { size: [0.5, 0.03, 0.14], at: [x, y + 0.02, z], color: '#2e8b57', rotY: turn },
      { size: [0.1, 0.1, 0.1], at: [x + 0.14 * fx, y + 0.03, z + 0.14 * fz], color: '#d9382b' },
      { size: [0.05, 0.04, 0.2], at: [x - 0.2 * fx, y - 0.02, z - 0.2 * fz], color: '#1f6f43', rotY: turn },
    ];
  }).flat(),
  2,
  1.0,
  2,
);

/** An elk, antlers and all (the Pacific Northwest): its light parts take the coat. */
const ELK: BoxPart[] = fit(
  [
    { size: [0.55, 0.6, 1.3], at: [0, 1.15, 0.2], color: PAINTED },
    { size: [0.26, 0.35, 0.4], at: [0, 1.5, -0.6], color: PAINTED },
    { size: [0.24, 0.5, 0.28], at: [0, 1.8, -0.8], color: PAINTED },
    { size: [0.22, 0.26, 0.5], at: [0, 1.95, -1.05], color: PAINTED },
    { size: [0.16, 0.14, 0.18], at: [0, 1.88, -1.35], color: '#2b2b2b' },
    { size: [0.05, 0.4, 0.05], at: [-0.15, 2.2, -0.95], color: '#d8c9a3' },
    { size: [0.05, 0.4, 0.05], at: [0.15, 2.2, -0.95], color: '#d8c9a3' },
    { size: [0.3, 0.05, 0.05], at: [-0.3, 2.3, -0.95], color: '#d8c9a3' },
    { size: [0.3, 0.05, 0.05], at: [0.3, 2.3, -0.95], color: '#d8c9a3' },
    { size: [0.12, 1.0, 0.14], at: [-0.2, 0.5, -0.25], color: '#4a3a28' },
    { size: [0.12, 1.0, 0.14], at: [0.2, 0.5, -0.25], color: '#4a3a28' },
    { size: [0.12, 1.0, 0.14], at: [-0.2, 0.5, 0.7], color: '#4a3a28' },
    { size: [0.12, 1.0, 0.14], at: [0.2, 0.5, 0.7], color: '#4a3a28' },
    { size: [0.4, 0.3, 0.05], at: [0, 1.2, 0.87], color: '#e8d9b8' },
    { size: [0.08, 0.14, 0.06], at: [0, 1.4, 0.9], color: '#e8d9b8' },
  ],
  0.9,
  2.4,
  2.4,
);

/** A raccoon: a masked face and a ringed tail (the Pacific Northwest). */
const RACCOON: BoxPart[] = fit(
  [
    { size: [0.22, 0.18, 0.3], at: [0, 0.2, -0.02], color: PAINTED },
    { size: [0.2, 0.17, 0.17], at: [0, 0.24, -0.2], color: '#d9d4c8' },
    { size: [0.22, 0.06, 0.04], at: [0, 0.26, -0.285], color: '#222222' },
    { size: [0.08, 0.07, 0.06], at: [0, 0.21, -0.3], color: '#222222' },
    { size: [0.05, 0.06, 0.04], at: [-0.07, 0.35, -0.2], color: '#222222' },
    { size: [0.05, 0.06, 0.04], at: [0.07, 0.35, -0.2], color: '#222222' },
    { size: [0.06, 0.12, 0.06], at: [-0.08, 0.06, -0.1], color: '#2b2b2b' },
    { size: [0.06, 0.12, 0.06], at: [0.08, 0.06, -0.1], color: '#2b2b2b' },
    { size: [0.06, 0.12, 0.06], at: [-0.08, 0.06, 0.08], color: '#2b2b2b' },
    { size: [0.06, 0.12, 0.06], at: [0.08, 0.06, 0.08], color: '#2b2b2b' },
    { size: [0.1, 0.1, 0.05], at: [0, 0.22, 0.17], color: PAINTED },
    { size: [0.1, 0.1, 0.05], at: [0, 0.23, 0.22], color: '#2b2b2b' },
    { size: [0.1, 0.1, 0.05], at: [0, 0.24, 0.27], color: PAINTED },
  ],
  0.3,
  0.4,
  0.6,
);

/** A sea lion hauled out on the road: chest up, flippers out (San Francisco's pier). */
const SEA_LION: BoxPart[] = fit(
  [
    { size: [0.6, 0.45, 1.1], at: [0, 0.25, 0.15], color: PAINTED },
    { size: [0.4, 0.4, 0.4], at: [0, 0.4, -0.35], color: PAINTED },
    { size: [0.22, 0.28, 0.35], at: [0, 0.55, -0.7], color: PAINTED },
    { size: [0.14, 0.12, 0.25], at: [0, 0.5, -0.9], color: '#3a2f27' },
    { size: [0.08, 0.06, 0.06], at: [0, 0.52, -1.0], color: '#111111' },
    { size: [0.3, 0.06, 0.18], at: [-0.25, 0.1, -0.3], color: '#3a2f27' },
    { size: [0.3, 0.06, 0.18], at: [0.25, 0.1, -0.3], color: '#3a2f27' },
    { size: [0.35, 0.05, 0.2], at: [-0.2, 0.08, 0.8], color: '#3a2f27' },
    { size: [0.35, 0.05, 0.2], at: [0.2, 0.08, 0.8], color: '#3a2f27' },
    { size: [0.3, 0.18, 0.3], at: [0, 0.15, 0.65], color: PAINTED },
  ],
  0.8,
  0.7,
  2.0,
);

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
  pedicab: PEDICAB,
  roadTrain: ROAD_TRAIN,
  streetcar: STREETCAR,
  carCarrier: CAR_CARRIER,
  carCarrierRamp: CAR_CARRIER_RAMP,
  jogger: JOGGER,
  hiker: HIKER,
  dogWalker: DOG_WALKER,
  dog: DOG,
  personFist: PERSON_FIST,
  personPhone: PERSON_PHONE,
  elk: ELK,
  raccoon: RACCOON,
  seaLion: SEA_LION,
  rooster: ROOSTER,
  parrotFlock: PARROT_FLOCK,
};

/** Whether a figure is a road vehicle (its mesh uses the vehicle material). */
export function isTrafficFigure(key: string): key is TrafficFigure {
  return (TRAFFIC_FIGURES as readonly string[]).includes(key);
}
/** Whether a figure is a person or animal drawn here. */
export function isPeopleFigure(key: string): key is PeopleFigure {
  return (PEOPLE_FIGURES as readonly string[]).includes(key);
}
