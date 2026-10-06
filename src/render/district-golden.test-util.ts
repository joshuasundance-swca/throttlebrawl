// What a district's drawn soups are, in numbers a test can hold to what main drew before the placement moved
// into road/structures/ (src/render/sf-districts-drawn.test.ts): a digest of each soup (triangles, area, mean
// point, bounds) and, for the roofs, one row per roof quad. Test-only.

/** A coloured triangle soup (three vertices per triangle). */
export interface GoldenSoup {
  pos: number[];
  col: number[];
}

/** A soup's digest: its triangles, their area and mean vertex, and its bounds (min x, max x, y, z). */
export interface SoupDigest {
  tris: number;
  area: number;
  mean: [number, number, number];
  bounds: [number, number, number, number, number, number];
  /** Its roof quads, if the golden holds them: [min x, max x, min y, max y, min z, max z] in cm. */
  roofs?: number[][];
}

const cm = (v: number) => Math.round(v * 100);
const r2 = (v: number) => Math.round(v * 100) / 100;
const hexOf = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** A soup's digest. */
export function digestOf(soup: GoldenSoup): SoupDigest {
  const n = soup.pos.length / 9;
  let area = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const bb = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    const p = soup.pos.slice(t * 9, t * 9 + 9);
    const ux = p[3]! - p[0]!;
    const uy = p[4]! - p[1]!;
    const uz = p[5]! - p[2]!;
    const vx = p[6]! - p[0]!;
    const vy = p[7]! - p[1]!;
    const vz = p[8]! - p[2]!;
    area += 0.5 * Math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2);
    for (let k = 0; k < 3; k++) {
      const x = p[k * 3]!;
      const y = p[k * 3 + 1]!;
      const z = p[k * 3 + 2]!;
      sx += x;
      sy += y;
      sz += z;
      bb[0] = Math.min(bb[0]!, x);
      bb[1] = Math.max(bb[1]!, x);
      bb[2] = Math.min(bb[2]!, y);
      bb[3] = Math.max(bb[3]!, y);
      bb[4] = Math.min(bb[4]!, z);
      bb[5] = Math.max(bb[5]!, z);
    }
  }
  const v = Math.max(1, n * 3);
  return {
    tris: n,
    area: r2(area),
    mean: [r2(sx / v), r2(sy / v), r2(sz / v)],
    bounds: bb.map(r2) as SoupDigest['bounds'],
  };
}

/**
 * The roof quads of a soup: each pair of consecutive triangles that are both in the roof colour and face up, as
 * the bounds of the pair in cm, in a fixed order.
 */
export function roofRows(soup: GoldenSoup, roof: string): number[][] {
  const [rr, gg, bb] = hexOf(roof);
  const rows: number[][] = [];
  const ok = (t: number) => {
    if (t * 9 + 8 >= soup.pos.length) return false;
    const c = soup.col.slice(t * 9, t * 9 + 3);
    if (Math.abs(c[0]! - rr) > 1e-6 || Math.abs(c[1]! - gg) > 1e-6 || Math.abs(c[2]! - bb) > 1e-6)
      return false;
    const p = soup.pos.slice(t * 9, t * 9 + 9);
    const ux = p[3]! - p[0]!;
    const uy = p[4]! - p[1]!;
    const uz = p[5]! - p[2]!;
    const vx = p[6]! - p[0]!;
    const vy = p[7]! - p[1]!;
    const vz = p[8]! - p[2]!;
    const len = Math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2);
    return len > 1e-9 && Math.abs((uz * vx - ux * vz) / len) > 0.9;
  };
  for (let t = 0; t + 1 < soup.pos.length / 9; t += 2) {
    if (!ok(t) || !ok(t + 1)) continue;
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let k = 0; k < 6; k++) {
      xs.push(soup.pos[t * 9 + k * 3]!);
      ys.push(soup.pos[t * 9 + k * 3 + 1]!);
      zs.push(soup.pos[t * 9 + k * 3 + 2]!);
    }
    rows.push([
      cm(Math.min(...xs)),
      cm(Math.max(...xs)),
      cm(Math.min(...ys)),
      cm(Math.max(...ys)),
      cm(Math.min(...zs)),
      cm(Math.max(...zs)),
    ]);
  }
  return rows.sort(
    (a, b) => a[0]! - b[0]! || a[4]! - b[4]! || a[2]! - b[2]! || a[1]! - b[1]! || a[5]! - b[5]!,
  );
}

/** What differs between a golden digest and a new one, beyond the tolerances (m, and a share of the area). */
export function digestDiffs(want: SoupDigest, got: SoupDigest, tolM: number): string[] {
  const out: string[] = [];
  if (want.tris !== got.tris) out.push(`triangles ${want.tris} -> ${got.tris}`);
  if (Math.abs(want.area - got.area) > 0.001 * want.area + 0.05) out.push(`area ${want.area} -> ${got.area}`);
  want.mean.forEach((m, i) => {
    if (Math.abs(m - got.mean[i]!) > tolM) out.push(`mean ${i} ${m} -> ${got.mean[i]}`);
  });
  want.bounds.forEach((b, i) => {
    if (Math.abs(b - got.bounds[i]!) > tolM) out.push(`bounds ${i} ${b} -> ${got.bounds[i]}`);
  });
  return out;
}

/** The roof rows that have no row within `tolCm` of them on the other side (each row used once): how many. */
export function roofDiffs(want: readonly number[][], got: readonly number[][], tolCm: number): number {
  if (want.length !== got.length) return Math.abs(want.length - got.length) + 1000000;
  let bad = 0;
  for (let i = 0; i < want.length; i++) {
    const a = want[i]!;
    const b = got[i]!;
    if (a.some((v, k) => Math.abs(v - b[k]!) > tolCm)) bad++;
  }
  return bad;
}
