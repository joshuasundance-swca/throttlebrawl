/** A Three-free point shape used by geometry simplification. */
export interface Point3Like {
  x: number;
  y: number;
  z: number;
}

/** Squared metres from p to the segment a-b, in 3D. */
function toSegmentSq(p: Point3Like, a: Point3Like, b: Point3Like): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const len2 = ux * ux + uy * uy + uz * uz;
  const t =
    len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ux + (p.y - a.y) * uy + (p.z - a.z) * uz) / len2)) : 0;
  const dx = p.x - (a.x + ux * t);
  const dy = p.y - (a.y + uy * t);
  const dz = p.z - (a.z + uz * t);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Samples of a strip to retain within a geometric error and maximum span. The first and last
 * samples are always retained. `same` prevents a span from crossing a caller-defined boundary.
 */
export function keptSamples(
  rows: readonly (readonly Point3Like[])[],
  tolM: number,
  maxSpanM: number,
  same: (i: number, j: number) => boolean = () => true,
): number[] {
  const n = rows.length;
  const tolSq = tolM * tolM;
  const maxSpanSq = maxSpanM * maxSpanM;
  if (n <= 2) return rows.map((_, i) => i);
  const kept = [0];
  let i = 0;
  while (i < n - 1) {
    let j = i + 1;
    while (j + 1 < n) {
      const k = j + 1;
      const ri = rows[i]!;
      const rk = rows[k]!;
      if (!same(i, k) || ri.length !== rk.length || !ri[0] || !rk[0]) break;
      const dx = rk[0].x - ri[0].x;
      const dz = rk[0].z - ri[0].z;
      if (dx * dx + dz * dz > maxSpanSq) break;
      let fits = true;
      for (let m = i + 1; m < k && fits; m++) {
        const rm = rows[m]!;
        fits = same(i, m) && rm.length === ri.length;
        for (let p = 0; p < rm.length && fits; p++) fits = toSegmentSq(rm[p]!, ri[p]!, rk[p]!) <= tolSq;
      }
      if (!fits) break;
      j = k;
    }
    kept.push(j);
    i = j;
  }
  return kept;
}
