// Tumble contacts (docs/architecture.md, "Crash tumble"): oriented boxes built each tick from the
// traffic and the riders near a crash, and the particles of the crash rig pushed out of them. The
// caller turns a first contact into events, so a car brakes and a rival wobbles or crashes.
import { cos, sin, type EntityId } from '../../core';
import { vehicleInfo } from '../traffic';
import type { SimConfig } from '../types';
import type { World } from '../world';
import type { Cluster } from './rig';

/** An upright box: centre, heading (unit forward in x/z), half extents, and its velocity. */
export interface Box {
  id: EntityId;
  kind: 'vehicle' | 'rider';
  cx: number;
  cy: number;
  cz: number;
  fx: number;
  fz: number;
  /** Half length (along f), half width, half height. */
  hl: number;
  hw: number;
  hh: number;
  vx: number;
  vz: number;
  /** For a vehicle: its content id and hazard. */
  contentId: string;
}

/** Box heights, m: a car, and anything big (trucks, RVs). Riders: a rider on a bike. */
const CAR_HEIGHT_M = 1.5;
const BIG_HEIGHT_M = 3.2;
const RIDER_BOX = { lengthM: 2.0, widthM: 0.8, heightM: 1.6 };
/** Boxes further than this from a crash's centre are not built (m). */
const NEAR_M = 25;
const RESTITUTION = 0.3;

/**
 * The boxes near a world point (at road position `near`), in entity order: vehicles, and riders
 * on their bikes. Movers on the same edge far along it are skipped before any world maths.
 */
export function nearbyBoxes(
  world: World,
  config: SimConfig,
  near: { edge: number; s: number },
  x: number,
  z: number,
  exclude: EntityId,
): Box[] {
  const road = config.road;
  const out: Box[] = [];
  for (const m of world.movers) {
    if (m.id === exclude) continue;
    const riding = m.kind === 'rider' && (m.mode === 'Road' || m.mode === 'Airborne');
    if (m.kind !== 'vehicle' && !riding) continue;
    // s runs at most a little faster than ground distance (curvature), so 2× is a safe margin.
    if (m.pos.edge === near.edge && Math.abs(m.pos.s - near.s) > 2 * NEAR_M) continue;
    const w = road.toWorld(m.pos.edge, m.pos.s, m.pos.d, m.h);
    const dx = w.x - x;
    const dz = w.z - z;
    if (dx * dx + dz * dz > NEAR_M * NEAR_M) continue;
    let size = RIDER_BOX;
    let contentId = '';
    if (m.kind === 'vehicle') {
      const info = vehicleInfo(world, config, m.id);
      if (!info) continue;
      size = {
        lengthM: info.lengthM,
        widthM: info.widthM,
        heightM: info.hazard === 'big' ? BIG_HEIGHT_M : CAR_HEIGHT_M,
      };
      contentId = info.contentId;
    }
    // Heading: the road tangent in the travel direction, turned by yaw toward the right.
    const f = road.frameAt(m.pos.edge, m.pos.s);
    const tx = f.tx * m.pos.dir;
    const tz = f.tz * m.pos.dir;
    const c = cos(m.yaw);
    const s = sin(m.yaw);
    const fx = c * tx - s * tz;
    const fz = c * tz + s * tx;
    out.push({
      id: m.id,
      kind: m.kind === 'vehicle' ? 'vehicle' : 'rider',
      cx: w.x,
      cy: w.y + size.heightM / 2,
      cz: w.z,
      fx,
      fz,
      hl: size.lengthM / 2,
      hw: size.widthM / 2,
      hh: size.heightM / 2,
      vx: fx * m.speed,
      vz: fz * m.speed,
      contentId,
    });
  }
  return out;
}

/**
 * Pushes the cluster's particles out of one box, through its nearest face, and bounces their
 * velocity off it relative to the box's own. Returns the largest closing speed of a particle that
 * was inside (m/s), or -1 when none was.
 */
export function collideBox(c: Cluster, b: Box): number {
  // The box's right, in the world: the right of a horizontal direction (x, z) is (−z, x).
  const rx = -b.fz;
  const rz = b.fx;
  let impact = -1;
  for (const q of c.p) {
    const ox = q.x - b.cx;
    const oy = q.y - b.cy;
    const oz = q.z - b.cz;
    const lf = ox * b.fx + oz * b.fz;
    const lr = ox * rx + oz * rz;
    const pf = b.hl - Math.abs(lf);
    const pr = b.hw - Math.abs(lr);
    const pu = b.hh - Math.abs(oy);
    if (pf <= 0 || pr <= 0 || pu <= 0) continue;
    // Out through the face of least penetration (never down through the floor: the road is there).
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let depth: number;
    if (pu <= pf && pu <= pr && oy > 0) {
      ny = 1;
      depth = pu;
    } else if (pf <= pr) {
      const sgn = lf >= 0 ? 1 : -1;
      nx = b.fx * sgn;
      nz = b.fz * sgn;
      depth = pf;
    } else {
      const sgn = lr >= 0 ? 1 : -1;
      nx = rx * sgn;
      nz = rz * sgn;
      depth = pr;
    }
    q.x += nx * depth;
    q.y += ny * depth;
    q.z += nz * depth;
    const vn = (q.vx - b.vx) * nx + q.vy * ny + (q.vz - b.vz) * nz;
    if (vn < 0) {
      q.vx -= (1 + RESTITUTION) * vn * nx;
      q.vy -= (1 + RESTITUTION) * vn * ny;
      q.vz -= (1 + RESTITUTION) * vn * nz;
      impact = Math.max(impact, -vn);
    } else {
      impact = Math.max(impact, 0);
    }
  }
  return impact;
}
