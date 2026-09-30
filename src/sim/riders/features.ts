// Road features the riding model reads (playtest 1b quick wins, [decided] 2026-09-30): speed-boost
// pads and the car-carrier tow truck whose rear deck is a jump ramp. Both are pack data on a road
// (docs/content-packs.md, "Road file"); the numbers below are [default] tuning starting points.
// - A `boostPad` is a box in road space. A grounded rider who rides into it gets a boost: for
//   `holdS` seconds its top speed is raised by `boostMps` and an extra push drives it there.
// - A `rampTruck` is a solid box with a deck. The deck rises from the road at s0 to `lipHeightM`
//   over `rampLengthM`, then stays level to s1; riders ride up it, leave the lip airborne (the
//   ordinary take-off rule) and may land on it. Only riders see the deck: it is not in the road's
//   surface, so tumble bodies, traffic and render's road mesh are unchanged. Riding into its side
//   or front higher than a kerb is a barrier contact. It faces riders travelling toward +s.
import { RAMP_TRUCK_DEFAULTS, rampTruckShape, type BakedFeature } from '../../road';
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

function num(f: BakedFeature, key: string, fallback: number): number {
  const v = f.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** The boostPad whose box holds (s, d) on the edge, or null. */
export function boostPadAt(config: SimConfig, edge: number, s: number, d: number): BakedFeature | null {
  const features = config.road.edges[edge]?.features ?? [];
  for (const f of features) {
    if (f.s0 > s) break; // sorted by s0
    if (f.kind === 'boostPad' && s <= f.s1 && d >= f.d0 && d <= f.d1) return f;
  }
  return null;
}

/** A pad's boost: the speed it adds and how long it lasts. */
export function boostOf(f: BakedFeature): { mps: number; holdS: number } {
  return { mps: num(f, 'boostMps', BOOST_DEFAULT_MPS), holdS: num(f, 'holdS', BOOST_DEFAULT_HOLD_S) };
}

/** The deck of a rampTruck at a point of its box: 0 at the ramp's foot, the lip height from the lip on. */
function deckOf(f: BakedFeature, s: number): number {
  const { run, lip } = rampTruckShape(f);
  const into = s - f.s0;
  return into >= run ? lip : (lip * into) / run;
}

/** Height of a ramp truck's deck above the road at (edge, s, d); 0 off every truck. */
export function deckHeight(config: SimConfig, edge: number, s: number, d: number): number {
  const features = config.road.edges[edge]?.features ?? [];
  let h = 0;
  for (const f of features) {
    if (f.s0 > s) break;
    if (f.kind !== 'rampTruck' || s > f.s1 || d < f.d0 || d > f.d1) continue;
    const deck = deckOf(f, s);
    if (deck > h) h = deck;
  }
  return h;
}

/** The rampTruck whose box holds (s, d), or null. */
export function rampTruckAt(config: SimConfig, edge: number, s: number, d: number): BakedFeature | null {
  const features = config.road.edges[edge]?.features ?? [];
  for (const f of features) {
    if (f.s0 > s) break;
    if (f.kind === 'rampTruck' && s <= f.s1 && d >= f.d0 && d <= f.d1) return f;
  }
  return null;
}
