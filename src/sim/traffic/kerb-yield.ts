// sim/traffic/kerb-yield.ts: kerb riders get out of the way, and contact with them is soft (playtest 3,
// the maintainer: "Things like bike riders cause collisions when they should arguably get out of the
// way off the sidewalk etc."; his answer for the cyclist you still hit: you wobble, he topples onto
// the sidewalk, never a crash).
//
// The pure half: who threatens a kerb rider, where it dodges to, and the numbers. sim/traffic/index.ts
// owns the state (`yieldUntilS`, `yieldCd`, `toppleS` by vehicle slot) and the wiring, behind two
// tuning keys read as `world.params[key] ?? 0` (so a race whose tuning leaves them out rides as it did
// before): `traffic.kerbYield` scales the look-ahead (0 turns the dodge off) and `traffic.kerbSoft`
// (0 or 1) turns the soft contact on. Neither draws from an RNG: the iteration order is fixed (kerb
// slots ascending, riders by entity id) and only plain arithmetic runs.
//
// Only types are imported, so index.ts can import this file without a cycle.
import type { TuningParamDecl } from '../../core';
import type { SimTrafficTypeDef } from '../types';

/** [default] starting values (docs/architecture.md, "Traffic"). */
export const KERB_YIELD = {
  /** A rider threatens only when it closes on the kerb rider this fast, m/s. */
  minClosingMps: 4,
  /** The look-ahead at `traffic.kerbYield` 1: the time to contact that starts a dodge, s. */
  lookS: 2.0,
  /** A rider threatens only when its box would pass this close sideways to the kerb rider's, m. */
  lateralM: 1.2,
  /** The dodge holds this long after the last threat has passed, s. */
  holdS: 0.8,
  /** A rider's box counts as a threat until it is this far past the kerb rider's, m. */
  passM: 3,
  /** How fast it moves sideways dodging, m/s (a bicycle reaches the sidewalk in about 0.4 s). */
  mps: 3.0,
  /** Its cruise speed is scaled by this while it dodges, and it brakes down to it at this rate, m/s^2. */
  speedScale: 0.6,
  brakeMps2: 6,
  /** How fast it moves back to its kerb line, m/s. */
  returnMps: 1.2,
  /** It waits to go back while a rider is within this far behind it, in its lateral band, m. */
  returnBehindM: 30,
  /**
   * Only a type at most this wide (bicycles, scooters, e-bikes, the cooler) gets the soft contact and
   * topples (`softContact`). Taking the verge is for every kerb type (`takesVerge`, P4-3).
   */
  softMaxWidthM: 0.8,
  /** The verge must be at least this much wider than the kerb rider for it to step onto it, m. */
  vergeSpareM: 0.4,
  /** On the verge it rides this far past the road edge, kerb rider's edge to the road's, m. */
  vergeOffsetM: 0.2,
  /**
   * The smashables' inner line past the road's edge, m (`SMASH.gapM`, asserted equal in the tests): a
   * kerb rider on the verge keeps its outer side inside it, so it never drives through a prop. A type
   * wider than 0.7 m (the golf cart) therefore rides partly over the road's edge, not 0.2 m past it.
   */
  propLineM: 0.9,
  /** Hugging the edge: its outer side keeps this far off the road's edge, m. */
  hugM: 0.05,
  /** Soft contact: the rider keeps this share of its speed, and is kicked away this far, rad. */
  bumpScrub: 0.85,
  bumpKickRad: 0.15,
  /** A toppled kerb rider lies still this long, s. */
  toppleS: 2.0,
  /** A clip topples the cyclist only at this closing speed or more, m/s; a slower brush is a nudge. */
  toppleMinMps: 2.0,
  /** A toppled one is pushed outward by the overlap plus this much, m. */
  topplePushM: 0.6,
  /** A toppled rider stays this far inside the edge of the ground it lies on, m. */
  toppleInsetM: 0.02,
} as const;

/** `traffic.kerbYield` and `traffic.kerbSoft`, declared with the traffic tuning (index.ts). */
export const KERB_YIELD_TUNING: readonly TuningParamDecl[] = [
  {
    // Playtest 3: bicycles and scooters step out of the way of a rider closing on them. [default]
    id: 'traffic.kerbYield',
    group: 'traffic',
    label: 'Cyclists dodge you (look-ahead)',
    default: 1,
    min: 0,
    max: 1.5,
    step: 0.1,
    unit: '×',
    affectsSim: true,
  },
  {
    // Playtest 3: you wobble and the cyclist topples, never a crash. [default]
    id: 'traffic.kerbSoft',
    group: 'traffic',
    label: 'Cyclists: soft contact',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
  },
];

/**
 * Whether a kerb rider may step onto a verge band `vergeW` wide: every kerb type may (playtest 4,
 * P4-3: "golf carts and similar things should swerve out of the way"), wherever the band is at least
 * `vergeSpareM` wider than it. Where it is not, the rider hugs the road's edge as before.
 */
export function takesVerge(t: Pick<SimTrafficTypeDef, 'widthM'>, vergeW: number): boolean {
  return vergeW >= t.widthM + KERB_YIELD.vergeSpareM;
}

/**
 * How far past the road's edge the centre of a kerb rider `widthM` wide rides on the verge, m
 * (negative: part of it still over the edge): `vergeOffsetM` clear of the edge, but never with its
 * outer side beyond `propLineM`. A light type (0.7 m or less) rides 0.2 m past the edge as it did in
 * playtest 3; the 1.3 m golf cart rides with its outer edge on the prop line and its inner edge
 * 0.4 m inside the road's edge, which is as far out of the way as a cart can go. Never further in
 * than the hug (the outer side 0.05 m inside the edge).
 */
export function vergeOffsetFor(widthM: number): number {
  const half = widthM / 2;
  return Math.max(
    -(half + KERB_YIELD.hugM),
    Math.min(half + KERB_YIELD.vergeOffsetM, KERB_YIELD.propLineM - half),
  );
}

/**
 * Whether a kerb type gets the soft contact (a wobble, never a crash) and topples when clipped: the
 * light ones, 0.8 m wide or less. The golf cart is a car: a solid rear-end is still a crash (the
 * maintainer, playtest 4: "Keep it a crash").
 */
export function softContact(t: Pick<SimTrafficTypeDef, 'widthM'>): boolean {
  return t.widthM <= KERB_YIELD.softMaxWidthM;
}

/** What a threat test reads of a rider (index.ts's RiderView). */
export interface KerbRiderView {
  u: number;
  cd: number;
  dir: number;
  speed: number;
  touchable: boolean;
  down: boolean;
}

/** What it reads of the kerb rider. `homeCd` is the kerb line it rides when not dodging. */
export interface KerbBody {
  u: number;
  cd: number;
  homeCd: number;
  dir: number;
  speed: number;
  lengthM: number;
  widthM: number;
}

/**
 * Whether the rider is coming at the kerb rider and would meet it: from behind in the same direction
 * or from ahead in the other, closing at `minClosingMps` or more, within `lookS` x `look` of contact
 * (or its box less than `passM` past the kerb rider's), and across the road within `lateralM` of its
 * box at the kerb line or where it is now. The lateral test uses both so a dodge that has already
 * moved the kerb rider clear does not end while the rider is still coming.
 */
export function threatens(
  b: KerbBody,
  r: KerbRiderView,
  riderLengthM: number,
  riderWidthM: number,
  look: number,
): boolean {
  if (!r.touchable || r.down) return false;
  const half = (b.lengthM + riderLengthM) / 2;
  // How far the kerb rider is ahead of the rider along the rider's own travel.
  const sep = r.dir * (b.u - r.u);
  if (sep < -(half + KERB_YIELD.passM)) return false;
  const vk = r.dir === b.dir ? b.speed : -b.speed;
  const closing = r.speed - vk;
  if (closing < KERB_YIELD.minClosingMps) return false;
  if ((sep - half) / closing > KERB_YIELD.lookS * look) return false;
  const reach = (b.widthM + riderWidthM) / 2;
  const across = Math.min(Math.abs(r.cd - b.cd), Math.abs(r.cd - b.homeCd)) - reach;
  return across < KERB_YIELD.lateralM;
}

/** Whether a rider within `returnBehindM` behind the kerb rider is still in its lateral band. */
export function holdsReturn(b: KerbBody, r: KerbRiderView, riderWidthM: number): boolean {
  if (!r.touchable || r.down || r.dir !== b.dir) return false;
  const behind = b.dir * (b.u - r.u);
  if (behind <= 0 || behind > KERB_YIELD.returnBehindM) return false;
  return Math.abs(r.cd - b.homeCd) - (b.widthM + riderWidthM) / 2 < KERB_YIELD.lateralM;
}

/** The spots a dodging kerb rider can take. `verge` is null where it may not take the verge. */
export interface DodgeSpots {
  verge: number | null;
  hug: number;
  stay: number;
}

/**
 * The best of the spots: the one that leaves the most clearance to the nearest threat
 * (`min over threats (|r.cd - c| - (w + riderWidth) / 2)`). Ties go to the verge, then the hug, then
 * staying.
 */
export function bestSpot(
  spots: DodgeSpots,
  threatCds: readonly number[],
  widthM: number,
  riderWidthM: number,
): number {
  const clearance = (c: number) => {
    let m = Infinity;
    for (const t of threatCds) m = Math.min(m, Math.abs(t - c) - (widthM + riderWidthM) / 2);
    return m;
  };
  let best = spots.stay;
  let score = clearance(best);
  const hug = clearance(spots.hug);
  if (hug >= score) {
    best = spots.hug;
    score = hug;
  }
  if (spots.verge !== null) {
    const v = clearance(spots.verge);
    if (v >= score) best = spots.verge;
  }
  return best;
}
