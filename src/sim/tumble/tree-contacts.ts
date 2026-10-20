// Static trunk contacts belong to the lazy crash rig, never the moving-entity boxes.
import { trunkRadiusAt, type TerrainTree, type TerrainTreePlan } from '../../road/structures/terrain-trees';
import type { Particle } from './rig';

interface Point {
  x: number;
  y: number;
  z: number;
}
interface Normal {
  x: number;
  y: number;
  z: number;
}
export interface TreeContact {
  particle: Particle;
  normal: Normal;
}

const square = (value: number): number => value * value;

function inside(tree: TerrainTree, p: Point): boolean {
  return (
    p.y >= tree.baseY &&
    p.y <= tree.topY &&
    square(p.x - tree.x) + square(p.z - tree.z) < square(trunkRadiusAt(tree, p.y))
  );
}

/** First entry into the finite tapered trunk, including its two end planes. */
function entry(tree: TerrainTree, from: Point, to: Point): { t: number; normal: Normal } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const ox = from.x - tree.x;
  const oz = from.z - tree.z;
  const slope = (trunkRadiusAt(tree, tree.topY) - trunkRadiusAt(tree, tree.baseY)) / (tree.topY - tree.baseY);
  const r = trunkRadiusAt(tree, tree.baseY) + slope * (from.y - tree.baseY);
  const dr = slope * dy;
  const a = dx * dx + dz * dz - dr * dr;
  const b = 2 * (ox * dx + oz * dz - r * dr);
  const cc = ox * ox + oz * oz - r * r;
  const times: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) times.push(-cc / b);
  } else {
    const discriminant = b * b - 4 * a * cc;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      times.push((-b - root) / (2 * a), (-b + root) / (2 * a));
    }
  }
  let best: { t: number; normal: Normal } | null = null;
  for (const t of times) {
    if (t < -1e-9 || t > 1 || (best && t >= best.t)) continue;
    const y = from.y + dy * t;
    if (y < tree.baseY || y > tree.topY) continue;
    const x = ox + dx * t;
    const z = oz + dz * t;
    const radius = trunkRadiusAt(tree, y);
    const length = Math.sqrt(1 + slope * slope);
    const normal = { x: x / radius / length, y: -slope / length, z: z / radius / length };
    if (dx * normal.x + dy * normal.y + dz * normal.z >= -1e-9) continue;
    best = { t: Math.max(0, t), normal };
  }
  if (dy !== 0) {
    for (const y of [tree.baseY, tree.topY]) {
      const t = (y - from.y) / dy;
      const ny = y === tree.topY ? 1 : -1;
      if (t < 0 || t > 1 || dy * ny >= 0 || (best && t >= best.t)) continue;
      if (square(ox + dx * t) + square(oz + dz * t) > square(trunkRadiusAt(tree, y))) continue;
      best = { t, normal: { x: 0, y: ny, z: 0 } };
    }
  }
  return best;
}

/** Project particles and their incoming velocity against actual world trunks. */
export function constrainTrees(
  particles: readonly Particle[],
  plan: TerrainTreePlan,
  previous: readonly Point[],
  contacts: TreeContact[],
): void {
  const nearby: TerrainTree[] = [];
  particles.forEach((q, i) => {
    const from = previous[i] ?? q;
    const distance = Math.sqrt(square(q.x - from.x) + square(q.z - from.z));
    plan.near((q.x + from.x) / 2, (q.z + from.z) / 2, distance / 2, nearby);
    let first: { t: number; normal: Normal } | null = null;
    let containing: TerrainTree | undefined;
    for (const tree of nearby) {
      if (inside(tree, from)) {
        if (inside(tree, q)) containing = tree;
        continue;
      }
      const hit = entry(tree, from, q);
      if (hit && (!first || hit.t < first.t)) first = hit;
    }
    let normal: Normal;
    if (first) {
      normal = first.normal;
      q.x = from.x + (q.x - from.x) * first.t;
      q.y = from.y + (q.y - from.y) * first.t;
      q.z = from.z + (q.z - from.z) * first.t;
    } else if (containing) {
      const dx = q.x - containing.x;
      const dz = q.z - containing.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      // A point exactly on the axis exits opposite its incoming horizontal motion.
      const speed = Math.sqrt(q.vx * q.vx + q.vz * q.vz);
      normal =
        distance > 1e-9
          ? { x: dx / distance, y: 0, z: dz / distance }
          : speed > 1e-9
            ? { x: -q.vx / speed, y: 0, z: -q.vz / speed }
            : { x: 1, y: 0, z: 0 };
      const radius = trunkRadiusAt(containing, q.y);
      q.x = containing.x + normal.x * radius;
      q.z = containing.z + normal.z * radius;
    } else return;
    const contact = { particle: q, normal };
    contacts.push(contact);
    treeVelocity(contact, 0.3);
  });
}

/** Link velocity projection must not reintroduce motion into a static trunk. */
export function treeVelocity({ particle: q, normal: n }: TreeContact, restitution = 0): void {
  const vn = q.vx * n.x + q.vy * n.y + q.vz * n.z;
  if (vn >= 0) return;
  q.vx -= (1 + restitution) * vn * n.x;
  q.vy -= (1 + restitution) * vn * n.y;
  q.vz -= (1 + restitution) * vn * n.z;
}
