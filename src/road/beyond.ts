// What stands at the edge of the road's ground, and what lies past it (the maintainer, 2026-10-06:
// "it would also be cool if when airborne it was possible to go over and across barriers, possibly
// resulting in a crash like falling in the water or whatever"; "consistent physics and gameplay is
// important here so players know what to expect and how to interact with the world").
//
// The one rule players learn: a barrier holds you only below its top, and what lies beyond decides
// what happens. This file is the road's half of it, read from the road's own data (its barriers, its
// tags and its verge edges) and the network's water level, with no new file format:
// - `edgeTopAt`: how high the thing at one side's band edge stands above the deck there. A barrier's
//   own `heightM`; a derived `hard` edge's from what is drawn there (the bluff's parapet, the
//   interstate's guard rail, the ferry's bulwark); 0 at a `water` edge (nothing stands there); and
//   Infinity at a building front, which stays a wall at any height (buildings are not in the sim yet:
//   the one known gap, until the sim meets src/road/structures.ts's plan, docs/architecture.md
//   "Physical world"). Null at a ground edge (soft, brush, fence): the
//   ground runs on past it and the band's own edge rules hold, in the air too.
// - `pastAt`: what lies past that edge: `water` (a `water-*` tag on the side, or a water edge),
//   `drop` (the bluff, a bridge or a trestle with no water tagged under it, or any `rail`: rails stand
//   only on bridges and drops, docs/product-spec.md), else `ground`.
// - `waterLevelOf`: the network's water level, world y, which is also a drop's floor. Sea level (0)
//   everywhere but Lake Samish (82.85 m, its backdrop's water floor).
// Another road below (the old Seven Mile Bridge beside the new one) is the sim's to find, with
// RoadNetwork.surfaceUnder. Pure data and + - * / only, like the rest of road/, so the sim may read it.
import { vergeTagAt, type VergeSide } from './cross-section';
import type { RoadNetwork } from './network';

/**
 * Each network's water level, world y, m: the sea, a lake, a river [default]. A network left out is at
 * sea level, 0. Lake Samish's is its backdrop's water floor (packs/region-pnw's
 * `assets/backdrop/pacific-northwest/networks/osm-pnw-samish.json`, the `floor` piece's `y`); every
 * other backdrop's water is the sea's (tests/sim/over-barrier-roads.test.ts holds the two together).
 * Where nothing is drawn under a drop (Portland's and the Gorge's bridges, the city bridges of San
 * Francisco), 0 stands in, so the drop is measured to sea level.
 */
export const WATER_LEVEL_M: Readonly<Record<string, number>> = {
  'osm-pnw-samish': 82.85,
};

/** The network's water level (and a drop's floor), world y, m. */
export function waterLevelOf(road: RoadNetwork): number {
  return Object.hasOwn(WATER_LEVEL_M, road.id) ? (WATER_LEVEL_M[road.id] ?? 0) : 0;
}

/**
 * The land tags whose `hard` edge is a building front (the towers, the shopfronts, the mural walls, the
 * row and painted houses, Duval's and the waterfront's buildings, the ferry hall, the pier sheds): a
 * wall at any height while no building is in the sim [default] (a building is to be a wall up to its
 * roofline with a roof to land on, [decided] 2026-10-06, once the sim meets the structures plan). The
 * cafes' patio rail stands right in front of the cafes, so it is one too.
 */
export const BUILDING_FRONT_TAGS: ReadonlySet<string> = new Set([
  'towers',
  'shopfronts',
  'murals',
  'mascot-mural',
  'lanterns',
  'cafes',
  'festival',
  'row-houses',
  'painted-houses',
  'key-oldtown',
  'ferry-hall',
  'pier-shed',
  'wharf',
]);

/**
 * The top of a derived `hard` edge that is not a building, by the land tag that gives it, m, as drawn:
 * Chuckanut's sandstone parapet (`chuckanut_parapet`, 0.9 m to its coping, drawn 1.4 times taller by
 * render/shore-fixes.ts `parapetWall`: 1.26 m), the interstate's guard rail (render/barrier-looks.ts
 * `guardrail`, 0.76 m) and the car ferry's bulwark (render/pnw-places.ts `FERRY_DIM.bulwarkH`, 2.6 m).
 */
export const EDGE_TOP_BY_TAG: Readonly<Record<string, number>> = {
  bluff: 1.26,
  interstate: 0.76,
  ferry: 2.6,
};

/** A `rail` edge a road file gives with no rail barrier listed: the rails' usual 1 m. */
const RAIL_TOP_M = 1;

/** What lies past a band's edge. */
export type Past = 'water' | 'drop' | 'ground';

const tagsOn = (road: RoadNetwork, edge: number, side: VergeSide, s: number): string[] => {
  const out: string[] = [];
  for (const t of road.edges[edge]?.tags ?? []) {
    if (s < t.s0 || s > t.s1 || (t.side !== 'both' && t.side !== side)) continue;
    out.push(t.tag);
  }
  return out;
};

/**
 * How high the thing at one side's band edge stands above the deck at (edge, s), m: a barrier's
 * `heightM`, a derived hard edge's drawn top (EDGE_TOP_BY_TAG), 0 at a water edge, Infinity at a
 * building front or a hard edge nothing says the height of. Null at a ground edge (soft, brush, fence).
 */
export function edgeTopAt(road: RoadNetwork, edge: number, s: number, side: VergeSide): number | null {
  const barrier = road.barrierAt(edge, s, side);
  if (barrier) return barrier.heightM;
  const v = road.vergeAt(edge, s, side);
  if (v.edge === 'water') return 0;
  if (v.edge === 'rail') return RAIL_TOP_M;
  if (v.edge !== 'hard') return null;
  const e = road.edges[edge];
  const tag = e && v.derived ? vergeTagAt(e, side, s) : null;
  if (tag === null || BUILDING_FRONT_TAGS.has(tag)) return Infinity;
  return Object.hasOwn(EDGE_TOP_BY_TAG, tag) ? (EDGE_TOP_BY_TAG[tag] ?? Infinity) : Infinity;
}

/** What lies past one side's band edge at (edge, s). */
export function pastAt(road: RoadNetwork, edge: number, s: number, side: VergeSide): Past {
  const tags = tagsOn(road, edge, side, s);
  if (tags.some((t) => t.startsWith('water'))) return 'water';
  if (road.vergeAt(edge, s, side).edge === 'water') return 'water';
  if (tags.some((t) => t === 'bluff' || t === 'bridge' || t === 'trestle')) return 'drop';
  if (road.barrierAt(edge, s, side)?.kind === 'rail') return 'drop';
  return 'ground';
}
