// Tumble bodies and the road's bands (docs/architecture.md, "Crash tumble"). A TumbleBody is a
// crash cluster's centre and mean velocity (see ./rig.ts for the particles), which the snapshot
// shows and the hand-back projects. The bands say where bodies, parked bikes and runners may be.
import type { LaneInfo } from '../../core';
import type { RoadNetwork } from '../../road';

export interface TumbleBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Projection hint: the edge the body was last over. */
  edge: number;
}

/** A cluster's centre stays this far inside the barrier line (a crude body radius, metres). */
export const BODY_RADIUS_M = 0.35;

/** The walls of an edge: its widest drivable offsets (lanes and shoulders), less the body radius. */
export function wallBand(road: RoadNetwork, edge: number): { lo: number; hi: number } {
  const e = road.edges[edge];
  if (!e) return { lo: 0, hi: 0 };
  return { lo: e.dMin + BODY_RADIUS_M, hi: e.dMax - BODY_RADIUS_M };
}

function drivable(lane: LaneInfo): boolean {
  return lane.kind === 'drive' || lane.kind === 'shoulder';
}

/** The drivable width at (edge, s): the outer edges of its drive and shoulder lanes. */
export function drivableBand(road: RoadNetwork, edge: number, s: number): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const lane of road.lanesAt(edge, s)) {
    if (!drivable(lane)) continue;
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  if (lo > hi) {
    const e = road.edges[edge];
    return { lo: e?.dMin ?? 0, hi: e?.dMax ?? 0 };
  }
  return { lo, hi };
}

/**
 * Where a parked bike or a runner may stand at (edge, s): inside the drivable width with a small
 * margin, and inside the band the riding model keeps bikes in (0.5 m from the outer edges).
 */
export function standingBand(road: RoadNetwork, edge: number, s: number): { lo: number; hi: number } {
  const lanes = drivableBand(road, edge, s);
  const e = road.edges[edge];
  const lo = Math.max(lanes.lo + 0.3, (e?.dMin ?? lanes.lo) + 0.5);
  const hi = Math.min(lanes.hi - 0.3, (e?.dMax ?? lanes.hi) - 0.5);
  if (lo <= hi) return { lo, hi };
  const mid = (lanes.lo + lanes.hi) / 2;
  return { lo: mid, hi: mid };
}

/**
 * Where a crashed rider's bike is parked, or a splashed rider respawns, at (edge, s) for a rider
 * travelling `dir`: the standing band, kept to the side whose lanes run the rider's way, half a
 * metre in from the centre line. A rider who remounts at rest in an oncoming lane faces a car that
 * stops for it, and the two can wait on each other. Roads with no lane the rider's way (or no room
 * on it) keep the whole standing band.
 */
export function ownSideBand(
  road: RoadNetwork,
  edge: number,
  s: number,
  dir: 1 | -1,
): { lo: number; hi: number } {
  const band = standingBand(road, edge, s);
  let lo = Infinity;
  let hi = -Infinity;
  for (const lane of road.lanesAt(edge, s)) {
    if (!drivable(lane) || lane.direction !== dir) continue;
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  const own = { lo: Math.max(band.lo, lo + 0.5), hi: Math.min(band.hi, hi - 0.5) };
  return own.lo <= own.hi ? own : band;
}
