// The landmarks' solid parts, measured from their drawings (road/structures/landmark-parts.ts is this file's
// output, committed; scripts/structure-parts.test.ts runs it again and holds the table to it). A drawing is
// cut into square columns over its footprint; each column is solid from its lowest drawn point to its highest
// (`column`), or from the landmark's ground up (`ground`: a building, solid below its roofs), or in separate
// layers where the drawing leaves a gap of open air up the column (`stack`: a bridge tower, its struts under
// the deck apart from its portals over it). Neighbouring columns of about the same base and top merge into one
// box, shrunk to the drawn points it holds. A landmark too big or open to stand on (a tower, a truss) is so
// still solid below its parts' tops (the brief, 2026-10-06).
import type { DrawnPoint } from './structures.test-util';

export interface ColumnOptions {
  /** The column's side, m. */
  cell: number;
  mode: 'ground' | 'column' | 'stack';
  /** With `stack`: a gap of open air this tall or taller splits a column into layers, m. */
  gap?: number;
  /** Points at or under this height are left out (a bridge's parts under its deck: under the course), m. */
  clip?: number;
  /** Neighbouring columns merge when their bases and their tops each differ by no more than this, m. */
  merge?: number;
  /** A merged box is no longer than this along z, m (a sheared lot follows its slope in short boxes). */
  maxZ?: number;
  /** The thinnest a part is, m. */
  minThick?: number;
  /**
   * A band of heights [from, to, step] where a column's layers are cut every `step` m: where a deck may pass
   * through the drawing (the Golden Gate's towers), so the plan, cutting the parts at the deck where the bridge
   * stands, keeps each part's footprint to what is drawn over the deck.
   */
  cuts?: readonly [number, number, number];
}

/** One part: [x0, x1, z0, z1, y0, y1] in the drawing's frame, m, to the centimetre (outward). */
export type ColumnPart = readonly [number, number, number, number, number, number];

interface Layer {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  used: boolean;
}

const down = (v: number) => Math.floor(v * 100 - 1e-6) / 100;
const up = (v: number) => Math.ceil(v * 100 + 1e-6) / 100;

/** The parts of a drawing (its surface points, in its own frame, scale 1). */
export function columnParts(points: readonly DrawnPoint[], o: ColumnOptions): ColumnPart[] {
  const clip = o.clip ?? -Infinity;
  const kept = points.filter((q) => q.y > clip);
  if (kept.length === 0) return [];
  let minX = Infinity;
  let minZ = Infinity;
  let groundY = Infinity;
  for (const q of kept) {
    minX = Math.min(minX, q.x);
    minZ = Math.min(minZ, q.z);
    groundY = Math.min(groundY, q.y);
  }
  // Each column's points, by height.
  const cells = new Map<string, DrawnPoint[]>();
  for (const q of kept) {
    const k = `${Math.floor((q.x - minX) / o.cell)},${Math.floor((q.z - minZ) / o.cell)}`;
    const list = cells.get(k);
    if (list) list.push(q);
    else cells.set(k, [q]);
  }
  // Each column's layers.
  const layers = new Map<string, Layer[]>();
  for (const [k, list] of cells) {
    list.sort((a, b) => a.y - b.y);
    const out: Layer[] = [];
    let cur: Layer | null = null;
    /** Which slab of the cut band a height is in (one slab under it, one over it). */
    const slab = (y: number): number => {
      const c = o.cuts;
      if (!c) return 0;
      if (y < c[0]) return -1;
      if (y >= c[1]) return 1e9;
      return Math.floor((y - c[0]) / c[2]);
    };
    for (const q of list) {
      if (!cur || (o.mode === 'stack' && q.y - cur.y1 >= (o.gap ?? Infinity)) || slab(q.y) !== slab(cur.y1)) {
        cur = { y0: q.y, y1: q.y, x0: q.x, x1: q.x, z0: q.z, z1: q.z, used: false };
        out.push(cur);
        continue;
      }
      cur.y1 = Math.max(cur.y1, q.y);
      cur.x0 = Math.min(cur.x0, q.x);
      cur.x1 = Math.max(cur.x1, q.x);
      cur.z0 = Math.min(cur.z0, q.z);
      cur.z1 = Math.max(cur.z1, q.z);
    }
    if (o.mode === 'ground') for (const l of out) l.y0 = groundY;
    layers.set(k, out);
  }
  const merge = o.merge ?? 0.5;
  const keys = [...layers.keys()]
    .map((k) => k.split(',').map(Number) as [number, number])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const parts: ColumnPart[] = [];
  const maxCells = o.maxZ ? Math.max(1, Math.floor(o.maxZ / o.cell)) : Infinity;
  for (const [i0, j0] of keys)
    for (const seed of layers.get(`${i0},${j0}`) ?? []) {
      if (seed.used) continue;
      seed.used = true;
      let lo0 = seed.y0;
      let lo1 = seed.y0;
      let hi0 = seed.y1;
      let hi1 = seed.y1;
      const box = { x0: seed.x0, x1: seed.x1, z0: seed.z0, z1: seed.z1 };
      const take = (l: Layer) => {
        lo0 = Math.min(lo0, l.y0);
        lo1 = Math.max(lo1, l.y0);
        hi0 = Math.min(hi0, l.y1);
        hi1 = Math.max(hi1, l.y1);
        box.x0 = Math.min(box.x0, l.x0);
        box.x1 = Math.max(box.x1, l.x1);
        box.z0 = Math.min(box.z0, l.z0);
        box.z1 = Math.max(box.z1, l.z1);
        l.used = true;
      };
      /** The layer of a column that would join the box, if one does. */
      const fits = (i: number, j: number): Layer | null => {
        for (const l of layers.get(`${i},${j}`) ?? []) {
          if (l.used) continue;
          if (
            Math.max(lo1, l.y0) - Math.min(lo0, l.y0) <= merge &&
            Math.max(hi1, l.y1) - Math.min(hi0, l.y1) <= merge
          )
            return l;
        }
        return null;
      };
      // Along x first, then whole rows along z.
      let i1 = i0;
      for (;;) {
        const l = fits(i1 + 1, j0);
        if (!l) break;
        take(l);
        i1++;
      }
      let j1 = j0;
      while (j1 - j0 + 1 < maxCells) {
        const row: Layer[] = [];
        for (let i = i0; i <= i1; i++) {
          const l = fits(i, j1 + 1);
          if (!l) break;
          row.push(l);
        }
        if (row.length !== i1 - i0 + 1) break;
        // A row joins only if all of it fits together with the box.
        const was = { lo0, lo1, hi0, hi1 };
        const spread =
          Math.max(was.lo1, ...row.map((l) => l.y0)) - Math.min(was.lo0, ...row.map((l) => l.y0)) <= merge &&
          Math.max(was.hi1, ...row.map((l) => l.y1)) - Math.min(was.hi0, ...row.map((l) => l.y1)) <= merge;
        if (!spread) break;
        for (const l of row) take(l);
        j1++;
      }
      const y1 = Math.max(hi1, lo0 + (o.minThick ?? 0.1));
      parts.push([down(box.x0), up(box.x1), down(box.z0), up(box.z1), down(lo0), up(y1)]);
    }
  return parts;
}
