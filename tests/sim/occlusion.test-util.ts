// Whether a prop stands in the way of the camera's view of something (playtest 4, run B's fix check, punch item
// 6: "the Key deer are small brown shapes half hidden behind roadside bushes"). A segment from the camera to a
// point of the thing is tested against the triangles of every prop near it, each in its own frame (turned about
// the vertical, scaled, set down), as the roadside layer places it. Test-only: nothing here ships.
import { Vector3, type BufferGeometry } from 'three';

/** A placed model: its geometry, where it stands, its turn about the vertical (the model's +Z goes to (sin, cos)) and its scale. */
export interface Occluder {
  geometry: BufferGeometry;
  x: number;
  y: number;
  z: number;
  turn: number;
  size: number;
  /** What it is, for a failure message. */
  label?: string;
}

/** A world point in an occluder's own frame (the inverse of: scale, turn about the vertical, move). */
function toLocal(o: Occluder, v: Vector3, out: Vector3): Vector3 {
  const c = Math.cos(o.turn);
  const s = Math.sin(o.turn);
  const dx = v.x - o.x;
  const dz = v.z - o.z;
  return out.set((dx * c - dz * s) / o.size, (v.y - o.y) / o.size, (dx * s + dz * c) / o.size);
}

/** Whether the open segment a to b crosses a triangle of the occluder (Moller-Trumbore, two-sided). */
export function blocks(o: Occluder, a: Vector3, b: Vector3): boolean {
  const g = o.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  const sphere = g.boundingSphere;
  if (!sphere) return false;
  const la = toLocal(o, a, new Vector3());
  const lb = toLocal(o, b, new Vector3());
  // Cheap out: the segment must come within the model's bounding sphere.
  const d = lb.clone().sub(la);
  const len2 = d.lengthSq();
  const t0 = len2 > 0 ? Math.max(0, Math.min(1, sphere.center.clone().sub(la).dot(d) / len2)) : 0;
  if (la.clone().addScaledVector(d, t0).distanceTo(sphere.center) > sphere.radius) return false;
  const pos = g.getAttribute('position');
  const index = g.getIndex();
  const count = index ? index.count : pos.count;
  const p0 = new Vector3();
  const p1 = new Vector3();
  const p2 = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const h = new Vector3();
  const sv = new Vector3();
  const q = new Vector3();
  for (let i = 0; i + 2 < count; i += 3) {
    const k = (n: number) => (index ? index.getX(i + n) : i + n);
    p0.fromBufferAttribute(pos, k(0));
    p1.fromBufferAttribute(pos, k(1));
    p2.fromBufferAttribute(pos, k(2));
    e1.subVectors(p1, p0);
    e2.subVectors(p2, p0);
    h.crossVectors(d, e2);
    const det = e1.dot(h);
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det;
    sv.subVectors(la, p0);
    const u = f * sv.dot(h);
    if (u < 0 || u > 1) continue;
    q.crossVectors(sv, e1);
    const v = f * d.dot(q);
    if (v < 0 || u + v > 1) continue;
    const t = f * e2.dot(q);
    // The segment, not the ray: short of the far end by a hair, past the near end by a hair.
    if (t > 1e-4 && t < 1 - 1e-4) return true;
  }
  return false;
}

/** How many of `points` the camera sees: no occluder crosses the segment from the camera to the point. */
export function seen(camera: Vector3, points: readonly Vector3[], occluders: readonly Occluder[]): number {
  let n = 0;
  for (const p of points) if (!occluders.some((o) => blocks(o, camera, p))) n++;
  return n;
}

/** The labels of the occluders that cross the line from the camera to any of the points (a failure message's help). */
export function blockers(
  camera: Vector3,
  points: readonly Vector3[],
  occluders: readonly Occluder[],
): string[] {
  const out = new Set<string>();
  for (const p of points) for (const o of occluders) if (blocks(o, camera, p)) out.add(o.label ?? '?');
  return [...out];
}
