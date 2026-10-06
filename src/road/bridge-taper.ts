// Bridge tapers (playtest 4, the maintainer on the Historic Columbia River Highway: "when it goes from
// grass to bridge or whatever the rider clips from open air onto the bridge. You can see it happen if
// you stay to the far right"). A verge band beside a land road ended square where a bridge's deck
// began, so a rider out on it rode to the band's end, then jumped sideways onto the deck (4 to 6 m on
// the Gorge, the Keys and Portland). Here the band narrows into each bridge end instead: within
// BRIDGE_TAPER_SLOPE metres across per metre along, its width is capped by its width on the bridge
// plus that slope times the distance from the bridge's end, so the band meets the deck's edge exactly
// where the deck begins, and the rider's limit (sim/ground's `rideLimits`, from `vergeAt`) slides in
// along it. Across a pass-through join the cap carries on into the next road, so a bridge that
// starts at a road's end (the Keys' long bridges, the Golden Gate) tapers its neighbour's band too.
// What is drawn follows (render's verge band and its ferns and fences read `vergeAt`).
// Pure data and + - * / only, like the rest of road/, so the sim may read it.
import type { ResolvedVerge, VergeSide } from './cross-section';
import type { BakedTag } from './types';

/** A verge band as `vergeAt` returns it: the resolved band, under its bridge tapers. */
export interface TaperedVerge extends ResolvedVerge {
  /**
   * True where the band narrows into (or widens out of) a bridge's end: its edge is the taper's,
   * which eases a rider in rather than stopping one (sim/riders' barrier rule).
   */
  taper?: boolean;
}

/** The band narrows by this much (m) per metre along the road into a bridge's end: 1 in 10. [default] */
export const BRIDGE_TAPER_SLOPE = 0.1;

/** Where a band must be no wider than `widthM`; it may widen by the slope per metre away from `s`. */
export interface TaperAnchor {
  s: number;
  widthM: number;
}

/** One side's anchors per edge: [left, right]. */
export type TaperTable = readonly (readonly [readonly TaperAnchor[], readonly TaperAnchor[]])[];

/** The edge data the tapers read (a road edge's length, tags and default ways on). */
export interface TaperEdge {
  index: number;
  length: number;
  tags: readonly BakedTag[];
  next: { edge: number; entersAt: 'from' | 'to' } | null;
  prev: { edge: number; entersAt: 'from' | 'to' } | null;
}

/** A band's untapered width at (edge, side, s): the file's band or the derived one. */
export type RawBand = (edge: number, side: VergeSide, s: number) => number;

/** Just past a bridge tag's end, to read the band on either side of it, m. */
const EDGE_EPS_M = 0.01;
/** Widths closer than this count as equal, m. */
const SAME_M = 1e-6;
/** Passes that carry tapers across joins (a taper longer than the next road crosses it, and so on). */
const JOIN_PASSES = 8;

const sideIndex = (side: VergeSide): 0 | 1 => (side === 'left' ? 0 : 1);
const otherSide = (side: VergeSide): VergeSide => (side === 'left' ? 'right' : 'left');

/** Whether a `bridge` tag covers (side, s) of a road. */
export function bridgedAt(tags: readonly BakedTag[], side: VergeSide, s: number): boolean {
  for (const t of tags) {
    if (t.tag === 'bridge' && s >= t.s0 && s <= t.s1 && (t.side === side || t.side === 'both')) return true;
  }
  return false;
}

/**
 * Past a taper's end onto the bridge, its edge still guides for this far (m): more than a tick's
 * travel at any speed (1.2 m at 70 m/s), so a rider eased in along the taper finishes the last
 * centimetres of it on the deck rather than meeting the rail as a new contact. [default]
 */
export const TAPER_LEAD_M = 2;

/** Whether s lies within TAPER_LEAD_M of an anchor (a taper's end at a bridge). */
export function taperLead(anchors: readonly TaperAnchor[], s: number): boolean {
  for (const a of anchors) if ((s > a.s ? s - a.s : a.s - s) <= TAPER_LEAD_M) return true;
  return false;
}

/** A band's width at s under its anchors' caps (the untapered width when none reaches s). */
export function taperedWidth(
  raw: number,
  anchors: readonly TaperAnchor[],
  s: number,
  slope: number = BRIDGE_TAPER_SLOPE,
): number {
  let w = raw;
  for (const a of anchors) {
    const cap = a.widthM + slope * (s > a.s ? s - a.s : a.s - s);
    if (cap < w) w = cap;
  }
  return w;
}

/**
 * Every edge's anchors: each end of a bridge stretch inside an edge whose band beside the bridge is
 * narrower than the band off it, then, pass by pass, each pass-through join where the band on one
 * side is a bridge's or a taper's and narrower than the band on the other (the anchor goes on the
 * wider side's road, at its end).
 */
export function bridgeTapers(
  edges: readonly TaperEdge[],
  raw: RawBand,
  slope: number = BRIDGE_TAPER_SLOPE,
): TaperTable {
  const table: [TaperAnchor[], TaperAnchor[]][] = edges.map(() => [[], []]);
  const add = (edge: number, side: VergeSide, s: number, widthM: number): boolean => {
    const list = table[edge]?.[sideIndex(side)];
    if (!list) return false;
    const same = list.find((a) => a.s === s);
    if (same) {
      if (same.widthM <= widthM + SAME_M) return false;
      same.widthM = widthM;
      return true;
    }
    list.push({ s, widthM });
    return true;
  };
  for (const e of edges) {
    for (const side of ['left', 'right'] as const) {
      for (const t of e.tags) {
        if (t.tag !== 'bridge' || (t.side !== side && t.side !== 'both')) continue;
        for (const [b, out] of [
          [t.s0, -1],
          [t.s1, 1],
        ] as const) {
          const sOut = b + out * EDGE_EPS_M;
          if (sOut < 0 || sOut > e.length || bridgedAt(e.tags, side, sOut)) continue;
          const sIn = b - out * EDGE_EPS_M;
          const wIn = raw(e.index, side, sIn < 0 ? 0 : sIn > e.length ? e.length : sIn);
          if (raw(e.index, side, sOut) > wIn + SAME_M) add(e.index, side, b, wIn);
        }
      }
    }
  }
  const width = (edge: number, side: VergeSide, s: number): { raw: number; tapered: number } => {
    const r = raw(edge, side, s);
    return { raw: r, tapered: taperedWidth(r, table[edge]?.[sideIndex(side)] ?? [], s, slope) };
  };
  for (let pass = 0; pass < JOIN_PASSES; pass++) {
    let changed = false;
    for (const e of edges) {
      for (const end of ['to', 'from'] as const) {
        const link = end === 'to' ? e.next : e.prev;
        const n = link ? edges[link.edge] : undefined;
        if (!link || !n) continue;
        const sE = end === 'to' ? e.length : 0;
        const sN = link.entersAt === 'from' ? 0 : n.length;
        // Joined end to end the same way round (to-from), sides carry over; to-to or from-from, swap.
        const flip = link.entersAt === end;
        for (const side of ['left', 'right'] as const) {
          const sideN = flip ? otherSide(side) : side;
          if (bridgedAt(n.tags, sideN, sN)) continue;
          const here = width(e.index, side, sE);
          const there = width(n.index, sideN, sN);
          const cause = bridgedAt(e.tags, side, sE) || here.tapered < here.raw - SAME_M;
          if (cause && here.tapered < there.tapered - SAME_M && add(n.index, sideN, sN, here.tapered)) {
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
  return table;
}
