// Road features the riding model reads (playtest 1b quick wins, [decided] 2026-09-30): speed-boost
// pads and the car-carrier tow truck whose rear deck is a jump ramp. Both are pack data on a road
// (docs/content-packs.md, "Road file"); the numbers below are [default] tuning starting points.
// - A `boostPad` is a box in road space. A grounded rider who rides into it gets a boost: for
//   `holdS` seconds its top speed is raised by `boostMps` and an extra push drives it there.
// - A `rampTruck` is a solid box with a deck. The deck rises from the road at s0 to `lipHeightM`
//   over `rampLengthM`; riders ride up it and leave the lip airborne (the ordinary take-off rule).
//   Past a short lip platform the truck is its body: the car parked on the top deck, then the cab
//   (the integration skeptic's F2: the old level deck to s1 let a slow rider roll along inside
//   that car). The body is solid: a grounded rider meets it as a wall (from the deck, a crash: thrown
//   off the truck, never stuck on it), and an airborne rider who left the lip too slowly to clear
//   the truck hits it (a crash) instead of landing inside it; a rider fast enough to clear the truck
//   never lands on it. Only riders see the truck: it is not in the road's surface, so tumble bodies,
//   traffic and render's road mesh are unchanged. Riding into its side or front higher than a kerb
//   is a barrier contact. It faces riders travelling toward +s.
// - Set pieces from the race seed (playtest 1c item 2): a pad or truck with `params.slot` is one
//   candidate for that slot, there only when the race seed picks it (road/setpieces).
import {
  chooseSetPieces,
  RAMP_TRUCK_DEFAULTS,
  rampTruckShape,
  setPieceActive,
  type BakedFeature,
} from '../../road';
import type { SimConfig } from '../types';

/** A boostPad's defaults: speed added (m/s) and how long the boost lasts (s). */
export const BOOST_DEFAULT_MPS = 8;
export const BOOST_DEFAULT_HOLD_S = 1.5;
/** The push toward the raised top speed while boosting, m/s² (before the speed multiplier). */
export const BOOST_ACCEL_MPS2 = 12;
/** A rampTruck's defaults, from the prop brief: 13.7° over an 11.5 m run to a 2.8 m lip (road/). */
export const RAMP_TRUCK_LENGTH_M = RAMP_TRUCK_DEFAULTS.rampLengthM;
export const RAMP_TRUCK_LIP_M = RAMP_TRUCK_DEFAULTS.lipHeightM;
/** A step up onto a deck higher than this, in one tick, is riding into the truck, m. */
export const KERB_M = 0.3;
/**
 * The truck body past the lip, from the truck model (tools/blender, `tow-truck`) at its 11.5 m run
 * and 2.8 m lip, and scaled with the ramp as render scales the model: the lip platform runs 0.45 m
 * to the top-deck car's rear, and that car's roof stands 1.16 m above the lip [default].
 */
export const TRUCK_PLATFORM_M = 0.45;
export const TRUCK_BODY_ABOVE_LIP_M = 1.16;

/** The candidates this race's seed picked, once per config (a race's config never changes). */
const picked = new WeakMap<SimConfig, ReadonlySet<string>>();
function pickedFor(config: SimConfig): ReadonlySet<string> {
  let chosen = picked.get(config);
  if (!chosen) {
    chosen = chooseSetPieces(config.road.edges, config.seed);
    picked.set(config, chosen);
  }
  return chosen;
}

/** Whether a set piece is there this race: no slot, or the seed picked it. */
function present(config: SimConfig, f: BakedFeature): boolean {
  return setPieceActive(f, pickedFor(config));
}

function num(f: BakedFeature, key: string, fallback: number): number {
  const v = f.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** The boostPad whose box holds (s, d) on the edge, or null. */
export function boostPadAt(config: SimConfig, edge: number, s: number, d: number): BakedFeature | null {
  const features = config.road.edges[edge]?.features ?? [];
  for (const f of features) {
    if (f.s0 > s) break; // sorted by s0
    if (f.kind === 'boostPad' && s <= f.s1 && d >= f.d0 && d <= f.d1 && present(config, f)) return f;
  }
  return null;
}

/** A pad's boost: the speed it adds and how long it lasts. */
export function boostOf(f: BakedFeature): { mps: number; holdS: number } {
  return { mps: num(f, 'boostMps', BOOST_DEFAULT_MPS), holdS: num(f, 'holdS', BOOST_DEFAULT_HOLD_S) };
}

/** Where a rampTruck's body starts (the top-deck car's rear), in s. */
function bodyStartOf(f: BakedFeature): number {
  const { run } = rampTruckShape(f);
  return f.s0 + run + (TRUCK_PLATFORM_M * run) / RAMP_TRUCK_LENGTH_M;
}

/** The top of a rampTruck's body above the road: the top-deck car's roof. */
export function truckBodyTop(f: BakedFeature): number {
  const { lip } = rampTruckShape(f);
  return lip + (TRUCK_BODY_ABOVE_LIP_M * lip) / RAMP_TRUCK_LIP_M;
}

/**
 * A rampTruck's height at a point of its box: the ramp from 0 at its foot to the lip height at the
 * lip, the lip platform, then the body's top (solid, not a deck anyone rides).
 */
function deckOf(f: BakedFeature, s: number): number {
  const { run, lip } = rampTruckShape(f);
  const into = s - f.s0;
  if (into < run) return (lip * into) / run;
  return s < bodyStartOf(f) ? lip : truckBodyTop(f);
}

/**
 * Height of a ramp truck above the road at (edge, s, d); 0 off every truck. Over a truck's body it
 * is the body's top; with `bodies: false` the body counts as 0 (what an airborne rider may land on).
 */
export function deckHeight(
  config: SimConfig,
  edge: number,
  s: number,
  d: number,
  opts: { bodies?: boolean } = {},
): number {
  const features = config.road.edges[edge]?.features ?? [];
  let h = 0;
  for (const f of features) {
    if (f.s0 > s) break;
    if (f.kind !== 'rampTruck' || s > f.s1 || d < f.d0 || d > f.d1 || !present(config, f)) continue;
    if (opts.bodies === false && s >= bodyStartOf(f)) continue;
    const deck = deckOf(f, s);
    if (deck > h) h = deck;
  }
  return h;
}

/** The rampTruck whose body holds (s, d), or null. */
export function truckBodyAt(config: SimConfig, edge: number, s: number, d: number): BakedFeature | null {
  const f = rampTruckAt(config, edge, s, d);
  return f && s >= bodyStartOf(f) ? f : null;
}

/**
 * The slowest a rider can leave a rampTruck's lip and clear its body, landing on the road past its
 * front (s1): v² = g·x² / (2·cos²θ·(lip + x·tanθ)), x from the lip to the front, θ the ramp's angle.
 */
export function truckClearMps(f: BakedFeature, gravity: number): number {
  const { run, lip } = rampTruckShape(f);
  const x = Math.max(0, f.s1 - f.s0 - run);
  const tan = lip / run;
  const cos2 = 1 / (1 + tan * tan);
  return Math.sqrt((gravity * x * x) / (2 * cos2 * (lip + x * tan)));
}

/**
 * Solid road hazards (the pitch deck's #12, run W-U: the ferry deck's parked pickups and coffee cart,
 * the clear-cut's stumps and log piles, the festival's chainsaw bears). A `hazard` feature whose
 * `params.solid` is true is a box a riding rider cannot pass through: from s0 to s1 and d0 to d1,
 * `params.heightM` tall (HAZARD_DEFAULT_HEIGHT_M when absent), grown by a bike's half width across
 * and half length along so the bike, not its centre, meets it. `params.object` names what it is (a
 * `pickup`, a `stump`...) for the events and for render, which draws it. Hazards belong off the lanes
 * (the verge bands): traffic, the rival AI and the tumble do not see them, and the road lint refuses
 * one over a lane. A hazard with no `solid` is what it was before: data nothing in the sim reads.
 */
export const HAZARD_DEFAULT_HEIGHT_M = 1.5;
/** The bike's reach round its centre that meets a hazard: half its width across, half its length along, m. */
export const HAZARD_REACH_D_M = 0.5;
export const HAZARD_REACH_S_M = 0.9;

/** Whether a feature is a solid hazard. */
export function isSolidHazard(f: BakedFeature): boolean {
  return f.kind === 'hazard' && f.params?.['solid'] === true;
}

/** A solid hazard's height above the road, m. */
export function hazardTop(f: BakedFeature): number {
  return num(f, 'heightM', HAZARD_DEFAULT_HEIGHT_M);
}

/** What a solid hazard is (its `params.object`), or `hazard`. */
export function hazardObject(f: BakedFeature): string {
  const o = f.params?.['object'];
  return typeof o === 'string' && o ? o : 'hazard';
}

/** The solid hazard a bike centred at (s, d) on the edge meets, or null. */
export function solidHazardAt(config: SimConfig, edge: number, s: number, d: number): BakedFeature | null {
  const features = config.road.edges[edge]?.features ?? [];
  for (const f of features) {
    if (f.s0 - HAZARD_REACH_S_M > s) break; // sorted by s0
    if (!isSolidHazard(f)) continue;
    const s0 = Math.min(f.s0, f.s1) - HAZARD_REACH_S_M;
    const s1 = Math.max(f.s0, f.s1) + HAZARD_REACH_S_M;
    const d0 = Math.min(f.d0, f.d1) - HAZARD_REACH_D_M;
    const d1 = Math.max(f.d0, f.d1) + HAZARD_REACH_D_M;
    if (s >= s0 && s <= s1 && d >= d0 && d <= d1) return f;
  }
  return null;
}

/** The rampTruck whose box holds (s, d), or null. */
export function rampTruckAt(config: SimConfig, edge: number, s: number, d: number): BakedFeature | null {
  const features = config.road.edges[edge]?.features ?? [];
  for (const f of features) {
    if (f.s0 > s) break;
    if (f.kind === 'rampTruck' && s <= f.s1 && d >= f.d0 && d <= f.d1 && present(config, f)) return f;
  }
  return null;
}
