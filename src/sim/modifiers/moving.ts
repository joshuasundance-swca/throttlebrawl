// The moving set pieces' plain maths (run W-T, the pitch deck's #9: "The road event doesn't stand
// still. It runs at you, runs away from you, or lets you pick."). setpieces.ts places and steps the
// pieces; this file holds the numbers and the small pure steps they use, so each is testable alone:
// - serial signs: one joke over four small signs, punchline last ('YOUR BOAT / IS NOT / IN THE
//   WATER / CHECK LANE TWO');
// - the boat slide: a skiff comes off its trailer, slews across the centre line and stops there;
// - the log spill: logs come off a log truck and roll to rest across both lanes; riding over one
//   is a hop;
// - the cable car runaway: it loses its grip and rolls back down its cable street at you;
// - the lane vote: a gantry splits two events, and the side a rider passes under picks one.
// - the moving ramp truck (playtest 3: "the ramp trucks could be in motion"): a car carrier driving
//   ahead whose ramp comes down as the field closes in; its deck is its own box, published for the
//   riders as a SimMovingDeck.
// [default] every number, to be tuned on the phone.
import { clamp } from '../../core';
import type { SimMovingDeck } from '../types';

export const MOVING = {
  /** Serial signs: metres between them, and how far out they start when a warning sign stays. */
  serialGapM: 45,
  serialExtraM: 45,
  // ---- placing a moving piece's vehicle (#391: the live check's duds)
  /**
   * A moving piece's vehicle goes on the road only once the leading racer is this close to its
   * spot, m: inside traffic's keep-alive range (its 400 m window plus 50 m), so traffic never
   * recycles it before the field gets there, and past traffic's 125 m fairness range.
   */
  spawnAheadM: 340,
  /** Never put one on the road nearer than this ahead of the leading racer, m. */
  spawnMinM: 160,
  /** How many times a piece puts its vehicle back after traffic took it, before its beat. */
  respawns: 2,
  // ---- the boat slide
  /** The gap between the tow truck's tail and the boat trailer's nose, m. */
  towGapM: 0.4,
  /** The trailer lets go once a racer is this close behind the boat, m. */
  unhitchM: 75,
  /** The skiff's slide: how hard it slows, m/s², and how far across it goes from its lane's centre, m. */
  slideDecel: 4.5,
  slideAcrossM: 4.2,
  /** How much of its speed turns into sideways drift, and its drift at a crawl, m/s. */
  slideCdShare: 0.32,
  slideCdMinMps: 0.6,
  /** The most it turns off the road's line, rad. */
  slideYaw: 0.85,
  // ---- the log spill
  /** The truck starts shedding once a racer is this close behind it, m. */
  shedRangeM: 230,
  /** A log every this many metres of the truck's travel, up to `logs`. */
  logEveryM: 14,
  logs: 6,
  /** A log's half length across the road and half depth along it, m (render draws it to match). */
  logHalfLenM: 1.7,
  logHalfDepthM: 0.35,
  logRadiusM: 0.33,
  /** A log leaves the truck at this share of its speed, and rolls to a stop (drag per s, friction m/s²). */
  logShare: 0.55,
  logRollDrag: 0.9,
  logRollFriction: 0.5,
  /** Riding over a log: lift per m/s of speed, its bounds, m/s, and the speed kept. */
  hopVyPerMps: 0.065,
  hopVyMin: 1.0,
  hopVyMax: 3.0,
  hopScrub: 0.95,
  /** Only a rider this low over the road hops (one already in the air sails over). */
  hopMaxH: 0.3,
  // ---- the cable car runaway
  /** The grip lets go once a racer is this close behind the car, m. */
  runawayM: 130,
  /** It rolls back at this acceleration, m/s², up to this speed, m/s, for at most this far, m. */
  rollAccel: 3,
  rollMaxMps: 12,
  rollMaxM: 650,
  // ---- the lane vote
  /** The picked event stands this far past the gantry (searched up to `voteSearchM` further), m. */
  voteAheadM: 420,
  voteSearchM: 400,
  /** The gantry stands this far into its piece, m. */
  gantryAlongM: 6,
  // ---- the animal crossing
  animals: 4,
  animalGapM: 9,
  // ---- the moving ramp truck
  /**
   * Its ramp comes down (`setPieceBeat` `rampDown`) once a racer is this close behind it, m: seconds
   * before anyone reaches the foot, even at a bike's top speed.
   */
  rampDropM: 200,
  /**
   * Its ramp's run, m, and slope: the lip meets the 2.4 m cab roof. At 12 m/s relative speed the
   * launch tangent clears the 2.56 m roof light even when the bike's front reaches it first.
   * The old 1.22 m lip's tangent lay below the cab at every speed. The carrier is
   * a 7.5 m tow truck, the longest vehicle every region's race may add: the rival AI sizes every
   * vehicle by the largest in the race, so it cannot be the parked truck's 21.1 m.
   */
  rampRunM: 5,
  rampSlope: 2.4 / 5,
  /** The least of its body past the lip, m (the cab and what it carries). */
  minBodyM: 0.5,
  /**
   * The sharpest bend its stretch may have, 1/m (a 120 m radius): a flight follows most of a bend
   * (`riders.airCarve`), so this keeps its jump on the road without leaving the Pacific Northwest's
   * winding roads with no stretch at all (at 1/250, only 22 of its 54 event and route pairings had one).
   */
  rampMaxKappa: 1 / 120,
  /** How far route-forward of its start the stretch is kept clear of walls and bends, m. */
  rampReachM: 450,
  /**
   * The last of its stretch, m, where its ramp is down and the field catches it, must lie past every
   * shortcut's rejoin; the run before it (and its signs) may overlap a shortcut. A racer who took the
   * shortcut rejoins behind the truck and catches it there, so a route whose only straight lies
   * beside a shortcut (San Francisco's own, Fogline Hill Sprint: 0 of 40 seeds in the wave C check)
   * still gets one.
   */
  rampTailM: 200,
};

/**
 * A carrier on the road, as the set piece reads it from traffic: how big it is, and where its rear
 * is on one road edge (its `foot`, s on that edge, the box running `lengthM` on from it along `dir`).
 * The same carrier is on two edges at once while it crosses where they join, one entry for each.
 */
export interface DeckVehicle {
  /** Its entity id. */
  vehicle: number;
  edge: number;
  foot: number;
  dir: 1 | -1;
  /** Where its middle is across that edge (d). */
  d: number;
  speedMps: number;
  lengthM: number;
  widthM: number;
}

/**
 * The moving deck a carrier gives the riders on one edge (SimMovingDeck): its box is the deck, the
 * ramp's foot at its rear and the body to its front, `widthM` across. `runM` is the ramp's run and
 * `lipM` its lip (the slope is kept when a short box shortens the run, and a box leaves at least
 * `minBodyM` of body). The foot may lie off the edge's ends: the deck is the same box across a join.
 */
export function movingDeckOf(v: DeckVehicle, runM: number = MOVING.rampRunM, lipM?: number): SimMovingDeck {
  const slope = lipM !== undefined && runM > 0 ? lipM / runM : MOVING.rampSlope;
  const run = Math.max(0.1, Math.min(runM, v.lengthM - MOVING.minBodyM));
  return {
    vehicle: v.vehicle,
    edge: v.edge,
    s0: v.foot,
    dir: v.dir,
    d0: v.d - v.widthM / 2,
    d1: v.d + v.widthM / 2,
    speedMps: v.speedMps,
    rampLengthM: run,
    lipHeightM: run * slope,
    bodyM: v.lengthM - run,
  };
}

/**
 * The serial signs' distances ahead of the event, first line first (furthest), punchline last.
 * With the event's own warning sign kept (at `signLead`), they stand one gap further out.
 */
export function serialLeads(n: number, signLead: number, keepsSign: boolean): number[] {
  const nearest = signLead + (keepsSign ? MOVING.serialExtraM : 0);
  return Array.from({ length: Math.max(0, n) }, (_, i) => nearest + (n - 1 - i) * MOVING.serialGapM);
}

/** The skiff's slide state: its speed along the road (m/s), its cd and its yaw off the road's line. */
export interface Slide {
  v: number;
  cd: number;
  yaw: number;
}

/**
 * One step of the skiff's slide off its trailer, starting in the lane at `laneCd` whose outward
 * side is `side`: it slows to a stop, drifts toward and across the centre line (`slideAcrossM`) as
 * it goes, and slews round as it drifts. At rest it stays put.
 */
export function slideStep(s: Slide, laneCd: number, side: number, dt: number): void {
  if (s.v <= 0) return;
  s.v = Math.max(0, s.v - MOVING.slideDecel * dt);
  const target = laneCd - side * MOVING.slideAcrossM;
  const step = (s.v * MOVING.slideCdShare + MOVING.slideCdMinMps) * dt;
  s.cd += clamp(target - s.cd, -step, step);
  const progress = clamp(Math.abs(s.cd - laneCd) / MOVING.slideAcrossM, 0, 1);
  s.yaw = -side * MOVING.slideYaw * progress;
}

/** Where log k comes to rest across the road: alternating sides of the centre line, both lanes. */
export function logTargetCd(k: number, laneCd: number, side: number): number {
  const pattern = [1, -1, 0.35, -0.55, 1.15, -0.2];
  const w = Math.max(1.5, Math.abs(laneCd));
  return side * w * (pattern[k % pattern.length] ?? 0);
}

/** The lift a hop over a log gives, m/s. */
export function hopVy(speed: number): number {
  return clamp(Math.max(0, speed) * MOVING.hopVyPerMps, MOVING.hopVyMin, MOVING.hopVyMax);
}

/** One step of the cable car losing its grip: its speed up its street falls, and goes negative. */
export function rollStep(v: number, dt: number): number {
  return Math.max(-MOVING.rollMaxMps, v - MOVING.rollAccel * dt);
}

/**
 * A lane-vote gantry over the forward lanes (centre cd and width, `side` their outward sign): over
 * a single forward lane it spans both lanes and splits at the centre line, so the oncoming lane is
 * the left-hand vote; over two or more it spans the forward carriageway, split down its middle.
 */
export function gantrySpan(
  forward: readonly { cd: number; width: number }[],
  side: number,
): { splitCd: number; spanM: number } {
  if (forward.length === 0) return { splitCd: 0, spanM: 8 };
  const outer = Math.max(...forward.map((l) => Math.abs(l.cd) + l.width / 2));
  if (forward.length === 1) return { splitCd: 0, spanM: 2 * outer };
  const inner = Math.min(...forward.map((l) => Math.abs(l.cd) - l.width / 2));
  return { splitCd: (side * (inner + outer)) / 2, spanM: outer - inner };
}

/** Which side of the gantry's split a rider at `cd` is under (`side`: the forward lanes' sign). */
export function voteSide(cd: number, splitCd: number, side: number): 'left' | 'right' {
  return (cd - splitCd) * side > 0 ? 'right' : 'left';
}
