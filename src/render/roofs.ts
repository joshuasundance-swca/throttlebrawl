// The roofs the scene stands over the road (playtest 3, wave B's live check: "in all 4 looks, PNW
// rain falls inside the covered ferry terminal at the start, under its roof"). Today the one roof a
// rider rides under is the car ferry's passenger deck (pnw-places.ts). The drizzle (rain.ts) is a
// screen overlay that knows nothing of the world, so this module says where a roof is and whether a
// camera stands under one; the renderer then stops the rain there. Presentation only, and small
// enough to sit in the main chunk: the ferry's builder (a lazy chunk) takes its roof numbers from here,
// so what is drawn and where the rain stops are one fact.
import type { RoadNetwork } from '../road';

/** The car ferry's roof, m [default]: how far its passenger deck stands over the car deck, and how wide. */
export const FERRY_ROOF = {
  /** The underside of the passenger deck above the car deck. */
  heightM: 6.6,
  /** Half the hull's width: the roof covers the road out to here each side. */
  halfWidthM: 12,
  /** The passenger deck stops this far short of each end of the hull. */
  insetM: 20,
  /** About how long one hull section is (the ferry is built in sections of about this length). */
  sectionM: 18,
} as const;

/** One stretch of road with a roof over it. */
export interface RoofSpan {
  edge: number;
  s0: number;
  s1: number;
  /** The roof covers d in [-halfWidthM, halfWidthM]. */
  halfWidthM: number;
  /** The roof's underside, m above the road's surface. */
  heightM: number;
}

/** The sections a ferry stretch s0..s1 is built in, and which of them carry the passenger deck. */
export function ferrySections(
  s0: number,
  s1: number,
): { n: number; len: number; cabin: (i: number) => boolean } {
  const n = Math.max(1, Math.round((s1 - s0) / FERRY_ROOF.sectionM));
  const len = (s1 - s0) / n;
  const cabin = (i: number) => {
    const s = s0 + (i + 0.5) * len;
    return s > s0 + FERRY_ROOF.insetM && s < s1 - FERRY_ROOF.insetM;
  };
  return { n, len, cabin };
}

/** Every roof over a network's roads: the ferries' passenger decks, by their `ferry` tag. */
export function roofSpans(road: RoadNetwork): RoofSpan[] {
  const spans: RoofSpan[] = [];
  for (const e of road.edges) {
    for (const t of e.tags) {
      if (t.tag !== 'ferry') continue;
      const { n, len, cabin } = ferrySections(t.s0, t.s1);
      let from = -1;
      for (let i = 0; i <= n; i++) {
        const on = i < n && cabin(i);
        if (on && from < 0) from = i;
        if (!on && from >= 0) {
          spans.push({
            edge: e.index,
            s0: t.s0 + from * len,
            s1: t.s0 + i * len,
            halfWidthM: FERRY_ROOF.halfWidthM,
            heightM: FERRY_ROOF.heightM,
          });
          from = -1;
        }
      }
    }
  }
  return spans;
}

/** How far in from a roof's end or side the camera is fully under it, m: the drizzle thins out over this. */
export const ROOF_COVER_FADE_M = 4;

/**
 * How far under a roof a point (a camera) stands, m: the way in from the nearest of the roof's ends
 * and sides, or -1 where it is not under one: not on a road with a roof, past its span or width, or
 * above its underside. `hintEdge` is the road the player is on.
 */
function roofDepth(
  road: RoadNetwork,
  spans: readonly RoofSpan[],
  x: number,
  y: number,
  z: number,
  hintEdge?: number,
): number {
  if (spans.length === 0) return -1;
  const at = road.project(x, z, hintEdge);
  let best = -1;
  for (const r of spans) {
    if (r.edge !== at.edge || at.s < r.s0 || at.s > r.s1 || Math.abs(at.d) > r.halfWidthM) continue;
    if (y >= road.surfaceHeight(at.edge, at.s, at.d) + r.heightM) continue;
    best = Math.max(best, Math.min(at.s - r.s0, r.s1 - at.s, r.halfWidthM - Math.abs(at.d)));
  }
  return best;
}

/** Whether a point (a camera) stands under one of the roofs: over its span, inside its width, below its underside. */
export function underRoof(
  road: RoadNetwork,
  spans: readonly RoofSpan[],
  x: number,
  y: number,
  z: number,
  hintEdge?: number,
): boolean {
  return roofDepth(road, spans, x, y, z, hintEdge) >= 0;
}

/**
 * How much of the sky a camera has a roof over, 0 (in the open) to 1 (`ROOF_COVER_FADE_M` or more
 * in from the roof's ends and sides). It is read from where the camera is, so the drizzle under a
 * roof does not depend on how long the camera has been there or how long the frames are (rain.ts).
 */
export function roofCover(
  road: RoadNetwork,
  spans: readonly RoofSpan[],
  x: number,
  y: number,
  z: number,
  hintEdge?: number,
): number {
  const depth = roofDepth(road, spans, x, y, z, hintEdge);
  return depth <= 0 ? 0 : Math.min(1, depth / ROOF_COVER_FADE_M);
}
