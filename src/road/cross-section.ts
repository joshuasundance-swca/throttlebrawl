// The road's cross-section (W-Q contracts; interview, 2026-10-02: "Anywhere with ground", 4-6 lane
// highways, rails only on bridges and drops). Per lane section: drive lanes per direction (1 to 3),
// an optional median, and a verge band per side past the outermost lane, with a surface and an edge
// that says what stops a rider there. A section that leaves a side out gets a verge DERIVED from the
// road's tags and barriers at each s, mirroring what render draws there (src/render/scenery.ts,
// `themeAt`): ground beside land roads, water edges on bridges and causeways over the sea, a rail
// where a rail barrier stands, a wall where a wall does. Pure data and +-*/ only, like the rest of
// road/, so the sim may read it.
import { LANES_PER_DIRECTION_MAX, type LaneInfo, type RoadSurface } from '../core';
import type { BakedBarrier, BakedLaneSection, BakedMedian, BakedTag, BakedVerge } from './types';

export type VergeSide = 'left' | 'right';

/** A verge band as the queries return it: the band, where it lies across the road, and its origin. */
export interface ResolvedVerge extends BakedVerge {
  side: VergeSide;
  /** d of the band's inner edge: the outer edge of the outermost lane on that side (shoulder included). */
  dInner: number;
  /** d of the band's outer edge (dInner − width on the left, dInner + width on the right). */
  dOuter: number;
  /** True when the band was derived from tags and barriers, false when the road file gives it. */
  derived: boolean;
}

/** One cross-section at an s, as the queries return it. */
export interface CrossSection {
  /** Drive lanes running with increasing s, and against it (shortcut and shoulder lanes not counted). */
  lanesForward: number;
  lanesOncoming: number;
  median: BakedMedian | null;
  left: ResolvedVerge;
  right: ResolvedVerge;
  /** What the lanes are made of. */
  surface: RoadSurface;
}

/** The road data the derivation reads. */
export interface VergeSource {
  tags?: readonly BakedTag[] | undefined;
  barriers?: readonly BakedBarrier[] | undefined;
}

const band = (widthM: number, surface: BakedVerge['surface'], edge: BakedVerge['edge']): BakedVerge => ({
  widthM,
  surface,
  edge,
});

/**
 * The derived verge per land tag [default]. The order is render's theme order (crossing, plaza,
 * downtown, palms, mangrove, commercial, beach, sawmill, urban, industrial, forest): when one side
 * carries several land tags, the first listed here wins, as the scenery does. Widths stay well
 * inside render's 24 m land strip. The downtown's verges are city kerb and asphalt, not loose ground,
 * so its street furniture stands on them as a city pavement's does (`ridableBandPast` is 0 there).
 * Run W-R (off-road) narrowed the palm land (8 to 4 m), the beach (10 to 6 m) and the sawmill yard
 * (10 to 6 m): solid scenery now stands clear of the ridable band, and playtest 1's parallax wants
 * the palms within 8 m of the road's edge, and the sawmill fits its land behind the yard. It also
 * gave the town, strip-mall, warehouse and pier pavements a `soft` edge: nothing solid is drawn at
 * their edge (the shacks stand further back, the warehouses and piers are land with poles), so a
 * `hard` one was an invisible wall; the row and painted houses' fronts are drawn at theirs.
 */
export const VERGE_BY_TAG: readonly (readonly [tag: string, verge: BakedVerge])[] = [
  // San Francisco's downtown (run W-R; interview, 2026-10-02: "SF first = downtown towers"): a cross
  // street's mouth is open asphalt you roll into and slow on (presentation only, nobody turns down
  // it); a plaza is wide open paving; the towers stand behind a sidewalk.
  ['cross-street', band(20, 'shoulder', 'soft')],
  ['cable-crossing', band(20, 'shoulder', 'soft')],
  ['plaza', band(18, 'kerb', 'soft')],
  ['towers', band(4, 'kerb', 'hard')],
  ['palms', band(4, 'sand', 'soft')],
  ['mangrove', band(3, 'grass', 'water')],
  ['swamp', band(3, 'grass', 'water')],
  ['marina', band(6, 'gravel', 'fence')],
  ['trailer-park', band(6, 'gravel', 'fence')],
  ['strip-mall', band(5, 'kerb', 'soft')],
  ['town', band(4, 'kerb', 'soft')],
  ['landmark', band(5, 'grass', 'soft')],
  ['beach', band(6, 'sand', 'soft')],
  ['sawmill', band(6, 'gravel', 'soft')],
  ['row-houses', band(2.5, 'kerb', 'hard')],
  ['painted-houses', band(2.5, 'kerb', 'hard')],
  ['gardens', band(3, 'grass', 'fence')],
  ['warehouses', band(4, 'kerb', 'soft')],
  ['piers', band(4, 'kerb', 'soft')],
  ['forest', band(6, 'dirt', 'brush')],
];

/** Each tag's rank in VERGE_BY_TAG (lower wins), looked up once per tag rather than searched. */
const TAG_RANK: Readonly<Record<string, number>> = Object.fromEntries(
  VERGE_BY_TAG.map(([tag], i) => [tag, i]),
);

/** The road with no tags at all: palm land, as render draws it. */
const UNTAGGED = band(4, 'sand', 'soft');
/** The sea beside the road (a `water-*` tag), and a causeway over it: the road's edge is the water's. */
const WATER = band(0, 'shoulder', 'water');
/** A rail barrier: the rail's own over-the-rail rule. */
const RAIL = band(0, 'shoulder', 'rail');
/** A wall barrier, a bridge with no water under it, or no ground drawn: the M1 barrier, a wall. */
const HARD = band(0, 'kerb', 'hard');

const covers = (r: { s0: number; s1: number; side: string }, side: VergeSide, s: number) =>
  s >= r.s0 && s <= r.s1 && (r.side === side || r.side === 'both');

/**
 * The verge a road with no explicit band has on one side at s [default]: a barrier there wins (a
 * `rail` is a rail edge, a `wall` a hard one); then the sea (any `water-*` tag) is a water edge; then
 * the best land tag's band (VERGE_BY_TAG); a `causeway` with no land is water, a `bridge` with no
 * land and no water a hard edge; a road with no tags at all is palm land; and a side whose tags say
 * nothing about the ground there gets no band (a hard edge, as before).
 */
export function deriveVerge(road: VergeSource, side: VergeSide, s: number): BakedVerge {
  for (const b of road.barriers ?? []) {
    if (covers(b, side, s)) return b.kind === 'rail' ? RAIL : HARD;
  }
  const tags = road.tags ?? [];
  if (tags.length === 0) return UNTAGGED;
  let best = -1;
  let causeway = false;
  for (const t of tags) {
    if (!covers(t, side, s)) continue;
    if (t.tag.startsWith('water')) return WATER;
    if (t.tag === 'causeway') causeway = true;
    const i = Object.hasOwn(TAG_RANK, t.tag) ? TAG_RANK[t.tag] : undefined;
    if (i !== undefined && (best < 0 || i < best)) best = i;
  }
  const hit = VERGE_BY_TAG[best];
  if (hit) return hit[1];
  return causeway ? WATER : HARD;
}

/** Drive lanes per direction in one section's lane list. */
export function lanesPerDirection(lanes: readonly LaneInfo[]): { forward: number; oncoming: number } {
  let forward = 0;
  let oncoming = 0;
  for (const lane of lanes) {
    if (lane.kind !== 'drive') continue;
    if (lane.direction === 1) forward++;
    else oncoming++;
  }
  return { forward, oncoming };
}

/** The outer edges of a lane list (every lane kind), as [left d, right d]; [0, 0] for none. */
export function laneEdges(lanes: readonly LaneInfo[]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const lane of lanes) {
    const a = lane.dCenterM - lane.widthM / 2;
    const b = lane.dCenterM + lane.widthM / 2;
    if (a < lo) lo = a;
    if (b > hi) hi = b;
  }
  return [lo, hi];
}

/** One side's verge at s for a section: the file's band when it gives one, else the derived one. */
export function resolveVerge(
  road: VergeSource,
  section: BakedLaneSection,
  side: VergeSide,
  s: number,
): ResolvedVerge {
  const given = section.verges?.[side];
  const v = given ?? deriveVerge(road, side, s);
  const [lo, hi] = laneEdges(section.lanes);
  const dInner = side === 'left' ? lo : hi;
  const width = v.widthM > 0 ? v.widthM : 0;
  return {
    widthM: width,
    surface: v.surface,
    edge: v.edge,
    side,
    dInner,
    dOuter: side === 'left' ? dInner - width : dInner + width,
    derived: given === undefined,
  };
}

/** The whole cross-section of a section at s. */
export function resolveCrossSection(
  road: VergeSource & { surface?: RoadSurface | undefined },
  section: BakedLaneSection,
  s: number,
): CrossSection {
  const { forward, oncoming } = lanesPerDirection(section.lanes);
  return {
    lanesForward: forward,
    lanesOncoming: oncoming,
    median: section.median ?? null,
    left: resolveVerge(road, section, 'left', s),
    right: resolveVerge(road, section, 'right', s),
    surface: road.surface ?? 'asphalt',
  };
}

/** The most drive lanes a direction may carry (re-exported for the lint and the tools). */
export const MAX_LANES_PER_DIRECTION = LANES_PER_DIRECTION_MAX;
