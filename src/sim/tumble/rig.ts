// The fuller crash rig (docs/architecture.md, "Crash tumble"; docs/milestones/M2.md, tumble-2): a
// small point-mass cluster for the rider (a floppy three-point ragdoll: head, hips, feet) and one
// for the bike (a rigid four-point frame: both axles and both grips), with distance constraints.
//
// Each particle keeps an explicit velocity: velocity += acceleration × dt, position += velocity ×
// dt, then the constraints are projected on positions and on velocities. With dt = timeScale / 60
// and no step at all while timeScale is 0, a tumble keeps its energy when the time scale changes
// (position-Verlet's implied velocity would not). Everything here is plain data and core math, so
// it hashes and replays like the rest of the sim.
//
// Collisions, per step:
// - the road surface, per particle (surfaceHeight at its offset from the centre's projection),
//   with a bounce and friction;
// - the barrier line, per cluster: when the cluster's centre leaves the band between the edge's
//   outer drivable offsets, it bounces back off a wall, unless that side has a `rail` and the
//   centre is higher above the deck than the rail, in which case the cluster goes overboard and
//   falls free until it reaches the water plane (world y = 0).
import { clamp } from '../../core';
import type { RoadNetwork, RoadPos } from '../../road';
import { wallBand, type TumbleBody } from './body';

const GRAVITY = 9.81;

/** One particle: world position (x east, y up, z south), velocity, and its projection hint. */
export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  edge: number;
}

export type ClusterKind = 'rider' | 'bike';

/** A particle cluster and what has happened to it. Plain data. */
export interface Cluster {
  kind: ClusterKind;
  p: Particle[];
  /** It crossed a rail (`railOver` fired) and now falls free of the road. */
  overboard: boolean;
  /** It reached the water plane (`splash` fired); it floats there, still, until the respawn. */
  splashed: boolean;
}

/** A distance constraint: `eq` holds the length, `min` only stops the points coming closer. */
interface Link {
  i: number;
  j: number;
  len: number;
  kind: 'eq' | 'min';
}

/**
 * Local layouts, in the crash frame: `f` forward, `u` up (from the contact point under the seat),
 * `r` to the rider's right. The rider is a chain (head, hips, feet) that may fold, but not fold
 * flat; the bike is a tetrahedron (front axle, rear axle, left grip, right grip), so it is rigid.
 */
export const RIDER_POINTS: readonly { f: number; u: number; r: number }[] = [
  { f: 0.15, u: 1.45, r: 0 }, // head
  { f: 0, u: 0.8, r: 0 }, // hips
  { f: 0.1, u: 0.1, r: 0 }, // feet
];
export const BIKE_POINTS: readonly { f: number; u: number; r: number }[] = [
  { f: 0.72, u: 0.33, r: 0 }, // front axle
  { f: -0.72, u: 0.33, r: 0 }, // rear axle
  { f: 0.42, u: 1.0, r: -0.35 }, // left grip
  { f: 0.42, u: 1.0, r: 0.35 }, // right grip
];

function dist3(a: { f: number; u: number; r: number }, b: { f: number; u: number; r: number }): number {
  const df = a.f - b.f;
  const du = a.u - b.u;
  const dr = a.r - b.r;
  return Math.sqrt(df * df + du * du + dr * dr);
}

function links(points: readonly { f: number; u: number; r: number }[], kind: ClusterKind): readonly Link[] {
  const at = (i: number) => points[i] ?? { f: 0, u: 0, r: 0 };
  if (kind === 'rider') {
    return [
      { i: 0, j: 1, len: dist3(at(0), at(1)), kind: 'eq' },
      { i: 1, j: 2, len: dist3(at(1), at(2)), kind: 'eq' },
      // Head and feet never come closer than 0.6 m: a ragdoll folds, but not into a ball.
      { i: 0, j: 2, len: 0.6, kind: 'min' },
    ];
  }
  const out: Link[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) out.push({ i, j, len: dist3(at(i), at(j)), kind: 'eq' });
  }
  return out;
}

const RIDER_LINKS = links(RIDER_POINTS, 'rider');
const BIKE_LINKS = links(BIKE_POINTS, 'bike');
const linksOf = (c: Cluster): readonly Link[] => (c.kind === 'rider' ? RIDER_LINKS : BIKE_LINKS);

/** Constraint projection passes per step. */
const ITERATIONS = 4;
const GROUND_RESTITUTION = 0.3;
const WALL_RESTITUTION = 0.3;
/** A bounce slower than this settles instead (m/s). */
const SETTLE_MPS = 1;
/** Within this height of the surface a particle counts as touching it, and slides with friction. */
const CONTACT_M = 0.05;

/** A world-space frame for building a cluster: forward, up and right unit vectors. */
export interface CrashFrame {
  fx: number;
  fz: number;
  rx: number;
  rz: number;
}

/**
 * Builds a cluster at `base` (the contact point under the seat), moving with velocity `v` and
 * spinning with angular velocity `w` (rad/s, world axes) about its centre.
 */
export function makeCluster(
  kind: ClusterKind,
  base: { x: number; y: number; z: number },
  frame: CrashFrame,
  v: { x: number; y: number; z: number },
  w: { x: number; y: number; z: number },
  edge: number,
): Cluster {
  const layout = kind === 'rider' ? RIDER_POINTS : BIKE_POINTS;
  const p: Particle[] = layout.map((l) => ({
    x: base.x + frame.fx * l.f + frame.rx * l.r,
    y: base.y + l.u,
    z: base.z + frame.fz * l.f + frame.rz * l.r,
    vx: v.x,
    vy: v.y,
    vz: v.z,
    edge,
  }));
  const c = centre(p);
  for (const q of p) {
    // v += w × (q − c)
    const ox = q.x - c.x;
    const oy = q.y - c.y;
    const oz = q.z - c.z;
    q.vx += w.y * oz - w.z * oy;
    q.vy += w.z * ox - w.x * oz;
    q.vz += w.x * oy - w.y * ox;
  }
  return { kind, p, overboard: false, splashed: false };
}

/** The cluster's centre and mean velocity (particles have equal mass). */
export function centre(p: readonly Particle[]): TumbleBody {
  let x = 0;
  let y = 0;
  let z = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (const q of p) {
    x += q.x;
    y += q.y;
    z += q.z;
    vx += q.vx;
    vy += q.vy;
    vz += q.vz;
  }
  const n = p.length || 1;
  return { x: x / n, y: y / n, z: z / n, vx: vx / n, vy: vy / n, vz: vz / n, edge: p[0]?.edge ?? 0 };
}

/** The fastest particle's speed, m/s: a cluster is at rest only when every point is. */
export function maxParticleSpeed(c: Cluster): number {
  let best = 0;
  for (const q of c.p) best = Math.max(best, Math.sqrt(q.vx * q.vx + q.vy * q.vy + q.vz * q.vz));
  return best;
}

/** One pass of the links over positions: each pair moved halfway toward its length. */
function linkPositions(c: Cluster): void {
  for (const l of linksOf(c)) {
    const a = c.p[l.i];
    const b = c.p[l.j];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9) continue;
    if (l.kind === 'min' && d >= l.len) continue;
    const k = (0.5 * (d - l.len)) / d;
    a.x += dx * k;
    a.y += dy * k;
    a.z += dz * k;
    b.x -= dx * k;
    b.y -= dy * k;
    b.z -= dz * k;
  }
}

/** One pass of the links over velocities: each link's stretching rate removed, equal and opposite. */
function linkVelocities(c: Cluster): void {
  for (const l of linksOf(c)) {
    const a = c.p[l.i];
    const b = c.p[l.j];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9) continue;
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
    if (l.kind === 'min' && (d > l.len + 1e-6 || vn >= 0)) continue;
    const h = 0.5 * vn;
    a.vx += nx * h;
    a.vy += ny * h;
    a.vz += nz * h;
    b.vx -= nx * h;
    b.vy -= ny * h;
    b.vz -= nz * h;
  }
}

/**
 * Pulls a cluster back to its shape after something pushed single particles (a box contact):
 * the links over positions, then over velocities.
 */
export function relax(c: Cluster): void {
  for (let it = 0; it < ITERATIONS; it++) linkPositions(c);
  for (let it = 0; it < ITERATIONS; it++) linkVelocities(c);
}

/** Where a cluster's centre lies after a step, for the mover and the barrier line. */
export interface ClusterContact {
  edge: number;
  s: number;
  /** The centre's offset, clamped inside the barrier band. */
  d: number;
  /** Surface height under the centre. */
  ground: number;
  /** This step the cluster crossed a rail (it just went overboard). */
  railOver: boolean;
  /** This step the cluster reached the water plane. */
  splash: boolean;
}

/**
 * Advances one cluster by dt (already scaled; the caller never passes 0): gravity, motion, the
 * constraints, then the road (per particle) and the barrier line (per cluster), or free fall to
 * the water once overboard. `mu` is the sliding friction, as a multiple of g.
 */
export function stepCluster(road: RoadNetwork, c: Cluster, dt: number, mu: number): ClusterContact {
  if (c.splashed) return overboardContact(road, c, false, false);
  for (const q of c.p) {
    q.vy -= GRAVITY * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.z += q.vz * dt;
  }
  if (c.overboard) {
    relax(c);
    return fallToWater(road, c, false);
  }
  // One projection per cluster per step (road.project scans the edge's samples): the centre's.
  // The link corrections are equal and opposite and the ground only lifts, so the centre's x and
  // z stay put through the solve below, and each particle's (s, d) is the centre's plus its offset
  // along the road's frame there.
  const at = centre(c.p);
  const pc = road.project(at.x, at.z, at.edge);
  const f = road.frameAt(pc.edge, pc.s);
  const band = wallBand(road, pc.edge);
  const len = road.edges[pc.edge]?.length ?? 0;
  const floor = c.p.map((q) => {
    q.edge = pc.edge;
    const ox = q.x - at.x;
    const oz = q.z - at.z;
    const s = clamp(pc.s + ox * f.tx + oz * f.tz, 0, len);
    const d = clamp(pc.d - ox * f.tz + oz * f.tx, band.lo, band.hi);
    return road.surfaceHeight(pc.edge, s, d);
  });
  const hit = c.p.map((q, i) => q.y < (floor[i] ?? -Infinity));
  // The links and the ground solved together, so a wheel on the road keeps the frame rigid.
  for (let it = 0; it < ITERATIONS; it++) {
    linkPositions(c);
    c.p.forEach((q, i) => (q.y = Math.max(q.y, floor[i] ?? -Infinity)));
  }
  c.p.forEach((q, i) => groundVelocity(q, floor[i] ?? -Infinity, hit[i] ?? false, dt, mu));
  for (let it = 0; it < ITERATIONS; it++) linkVelocities(c);
  if (barrierLine(road, c, pc)) return fallToWater(road, c, true);
  // Inside the band, or put back on the barrier line: the centre's road position is known.
  const d = clamp(pc.d, band.lo, band.hi);
  return {
    edge: pc.edge,
    s: pc.s,
    d,
    ground: road.surfaceHeight(pc.edge, pc.s, d),
    railOver: false,
    splash: false,
  };
}

/** Where an overboard cluster's centre lies over the road (for the mover). */
function overboardContact(road: RoadNetwork, c: Cluster, railOver: boolean, splash: boolean): ClusterContact {
  const at = centre(c.p);
  const p = road.project(at.x, at.z, at.edge);
  const band = wallBand(road, p.edge);
  const d = clamp(p.d, band.lo, band.hi);
  return { edge: p.edge, s: p.s, d, ground: road.surfaceHeight(p.edge, p.s, d), railOver, splash };
}

/** An overboard cluster falls free; at the water plane it floats, centre at the surface, still. */
function fallToWater(road: RoadNetwork, c: Cluster, railOver: boolean): ClusterContact {
  const at = centre(c.p);
  let splash = false;
  if (at.y <= 0) {
    // In the water: no swimming.
    c.splashed = true;
    splash = true;
    for (const q of c.p) {
      q.y -= at.y;
      q.vx = 0;
      q.vy = 0;
      q.vz = 0;
    }
  }
  return overboardContact(road, c, railOver, splash);
}

/** A particle that reached the ground this step bounces; one touching it slides with friction. */
function groundVelocity(q: Particle, ground: number, hit: boolean, dt: number, mu: number): void {
  if (hit) {
    if (q.vy < 0) q.vy = -q.vy * GROUND_RESTITUTION;
    if (q.vy < SETTLE_MPS) q.vy = 0;
  }
  if (q.y <= ground + CONTACT_M) {
    const vh = Math.sqrt(q.vx * q.vx + q.vz * q.vz);
    const dv = mu * GRAVITY * dt;
    if (vh <= dv) {
      q.vx = 0;
      q.vz = 0;
    } else {
      const k = (vh - dv) / vh;
      q.vx *= k;
      q.vz *= k;
    }
  }
}

/**
 * The barrier line, for the whole cluster (`p` is its centre's projection): past the band, a
 * rail lets it over when its centre is higher above the deck than the rail; anything else (a
 * wall, a low crossing, no barrier listed, a dead end) puts it back on the line and reflects the
 * outward velocity. Returns true when it went over.
 */
function barrierLine(road: RoadNetwork, c: Cluster, p: RoadPos): boolean {
  const at = centre(c.p);
  const band = wallBand(road, p.edge);
  const d = clamp(p.d, band.lo, band.hi);
  const w = road.toWorld(p.edge, p.s, d, 0);
  const ox = at.x - w.x;
  const oz = at.z - w.z;
  const off = Math.sqrt(ox * ox + oz * oz);
  // Inside the band, the projection residual is far below this threshold.
  if (d === p.d && off <= 0.05) return false;
  if (d !== p.d) {
    const side = p.d > d ? 'right' : 'left';
    const barrier = road.barrierAt(p.edge, p.s, side);
    const deck = road.surfaceHeight(p.edge, p.s, d);
    if (barrier?.kind === 'rail' && at.y - deck > barrier.heightM) {
      c.overboard = true;
      return true;
    }
  }
  if (off > 1e-9) {
    const nx = ox / off;
    const nz = oz / off;
    for (const q of c.p) {
      q.x -= ox;
      q.z -= oz;
      const vn = q.vx * nx + q.vz * nz;
      if (vn > 0) {
        q.vx -= (1 + WALL_RESTITUTION) * vn * nx;
        q.vz -= (1 + WALL_RESTITUTION) * vn * nz;
      }
    }
  }
  return false;
}
