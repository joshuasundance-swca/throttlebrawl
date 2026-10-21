/** Private physical triangle query; vertices are immutable for a road's lifetime. */
export interface GroundPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly s: number;
}
export type GroundTriangle = readonly [GroundPoint, GroundPoint, GroundPoint];
export interface PreparedTriangle {
  readonly cx: number;
  readonly cz: number;
  readonly uz: number;
  readonly ux: number;
  readonly vz: number;
  readonly vx: number;
  readonly det: number;
  readonly ay: number;
  readonly by: number;
  readonly cy: number;
  readonly as: number;
  readonly bs: number;
  readonly cs: number;
}
export interface TriangleHit {
  u: number;
  v: number;
  y: number;
}
export function prepareGroundTriangle([a, b, c]: GroundTriangle): PreparedTriangle {
  const uz = b.z - c.z,
    ux = c.x - b.x,
    vz = c.z - a.z,
    vx = a.x - c.x;
  return {
    cx: c.x,
    cz: c.z,
    uz,
    ux,
    vz,
    vx,
    det: uz * vx + ux * (a.z - c.z),
    ay: a.y,
    by: b.y,
    cy: c.y,
    as: a.s,
    bs: b.s,
    cs: c.s,
  };
}
export function groundTriangleHit(t: PreparedTriangle, x: number, z: number, hit: TriangleHit): boolean {
  if (Math.abs(t.det) < 1e-9) return false;
  const u = (t.uz * (x - t.cx) + t.ux * (z - t.cz)) / t.det;
  const v = (t.vz * (x - t.cx) + t.vx * (z - t.cz)) / t.det;
  if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) return false;
  hit.u = u;
  hit.v = v;
  hit.y = u * t.ay + v * t.by + (1 - u - v) * t.cy;
  return true;
}
export function groundTriangleS(t: PreparedTriangle, u: number, v: number): number {
  return u * t.as + v * t.bs + (1 - u - v) * t.cs;
}
