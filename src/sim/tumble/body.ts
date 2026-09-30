// The crude M1 tumble body (docs/architecture.md, "Crash tumble"): one world-space point body
// each for the rider and the bike, with an explicit velocity integrated at dt = timeScale / 60,
// colliding with the road surface (surfaceHeight after project) and with barrier walls at the
// edge's outer drivable offsets. Traffic and rider contacts arrive with M2's fuller rig.
import { clamp, type LaneInfo } from '../../core';
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

export const GRAVITY = 9.81;
/** Bodies stay this far inside the barrier walls (a crude body radius, metres). */
export const BODY_RADIUS_M = 0.35;
const GROUND_RESTITUTION = 0.35;
const WALL_RESTITUTION = 0.3;
/** A bounce slower than this settles instead (m/s). */
const SETTLE_MPS = 1;
/** Within this height of the surface a body counts as touching it, and slides with friction. */
const CONTACT_M = 0.05;

/** Where a body lies over the road after a step: its projection with d kept inside the walls. */
export interface BodyContact {
  edge: number;
  s: number;
  d: number;
  /** Surface height under the body. */
  ground: number;
}

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
 * Advances one body by dt: gravity, motion, barrier walls, then the ground with a bounce and
 * sliding friction (`mu`, as a multiple of g). Mutates the body; returns where it lies.
 */
export function stepBody(road: RoadNetwork, b: TumbleBody, dt: number, mu: number): BodyContact {
  b.vy -= GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;

  const p = road.project(b.x, b.z, b.edge);
  b.edge = p.edge;
  const band = wallBand(road, p.edge);
  const d = clamp(p.d, band.lo, band.hi);
  const w = road.toWorld(p.edge, p.s, d, 0);
  const ox = b.x - w.x;
  const oz = b.z - w.z;
  const off = Math.sqrt(ox * ox + oz * oz);
  // Outside the walls, or past a dead end's last sample: put the body back and reflect the
  // velocity's outward part. Inside, the projection residual is far below this threshold.
  if (d !== p.d || off > 0.05) {
    if (off > 1e-9) {
      const nx = ox / off;
      const nz = oz / off;
      const vn = b.vx * nx + b.vz * nz;
      if (vn > 0) {
        b.vx -= (1 + WALL_RESTITUTION) * vn * nx;
        b.vz -= (1 + WALL_RESTITUTION) * vn * nz;
      }
    }
    b.x = w.x;
    b.z = w.z;
  }

  const ground = road.surfaceHeight(p.edge, p.s, d);
  if (b.y < ground) {
    b.y = ground;
    if (b.vy < 0) b.vy = -b.vy * GROUND_RESTITUTION;
    if (b.vy < SETTLE_MPS) b.vy = 0;
  }
  if (b.y <= ground + CONTACT_M) {
    const vh = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
    const dv = mu * GRAVITY * dt;
    if (vh <= dv) {
      b.vx = 0;
      b.vz = 0;
    } else {
      const k = (vh - dv) / vh;
      b.vx *= k;
      b.vz *= k;
    }
  }
  return { edge: p.edge, s: p.s, d, ground };
}

export function bodySpeed(b: TumbleBody): number {
  return Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
}
