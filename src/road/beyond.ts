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
//   Infinity at a building front, a wall at any height to anything that does not know its buildings (a
//   crashed body; the sim takes it as 0 where the structures plan has the buildings, which then stop a
//   rider themselves: sim/riders/structures.ts, `frontTagAt`). Null at a ground edge (soft, brush,
//   fence): the ground runs on past it and the band's own edge rules hold, in the air too.
// - `pastAt`: what lies past that edge: `water` (a `water-*` tag on the side, or a water edge),
//   `drop` (the bluff, a bridge or a trestle with no water tagged under it, or any `rail`: rails stand
//   only on bridges and drops, docs/product-spec.md), else `ground`.
// - `waterLevelOf`: the network's water level, world y, which is also a drop's floor. Sea level (0)
//   everywhere but Lake Samish (82.85 m, its backdrop's water floor).
// Another road below (the old Seven Mile Bridge beside the new one) is the sim's to find, with
// RoadNetwork.surfaceUnder. Pure data and + - * / only, like the rest of road/, so the sim may read it.
import { vergeTagAt, type VergeSide } from './cross-section';
import { lanesNear } from './course';
import { groundUnderOf, sectionGroundOf } from './drawn-ground';
import type { RoadNetwork } from './network';
import { lakeWaterAt } from './water';

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
 * wall at any height where no building is in the sim [default]. Where the structures plan has a front's
 * buildings, the sim meets them instead (a building a wall up to its roofline with a roof to land on,
 * [decided] 2026-10-06; sim/riders/structures.ts). The cafes' patio rail stands right in front of the
 * cafes, so it is one too.
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

/**
 * The building-front tag (BUILDING_FRONT_TAGS) whose `hard` edge one side's band ends at at (edge, s), or null
 * where the edge is anything else (a barrier, a given edge, another tag's). Where the buildings along that tag
 * are in the structures plan, the sim meets them instead of this wall (sim/riders/structures.ts).
 */
export function frontTagAt(road: RoadNetwork, edge: number, s: number, side: VergeSide): string | null {
  if (road.barrierAt(edge, s, side)) return null;
  const v = road.vergeAt(edge, s, side);
  if (v.edge !== 'hard' || !v.derived) return null;
  const e = road.edges[edge];
  const tag = e ? vergeTagAt(e, side, s) : null;
  return tag !== null && BUILDING_FRONT_TAGS.has(tag) ? tag : null;
}

/**
 * The drawn top of what ends a ground band, m over the road beside it (render/verge.ts draws them along the band's
 * outer edge): nothing at a `soft` edge (the ground just runs on); ferns and bushes (the largest clump, 1.09 m) or a
 * clipped hedge (0.77 m) at a `brush` edge, and a fence at a `fence` edge (the garden fence's posts, 1.11 m, the
 * tallest of its three styles). One number per kind, the tallest drawn (rounded up to the centimetre), so a rider in
 * the air clears every one he is seen to clear; tests/sim/no-invisible-walls.test.ts holds them to the kit render
 * builds on every route network.
 */
export const GROUND_EDGE_TOP_M: Readonly<Record<'soft' | 'brush' | 'fence', number>> = {
  soft: 0,
  brush: 1.09,
  fence: 1.11,
};

/**
 * What is drawn at one side's band edge at (edge, s), the honest edges' witness (the maintainer, 2026-10-06,
 * [decided]: "never an invisible wall"): only where one of these stands may the edge hold a rider on the ground.
 * - `barrier`: a rail or a wall the road file lists (the road draws it);
 * - `rail`: a rail edge a road file gives with no barrier listed;
 * - `water`: the water's edge;
 * - `wall`: a derived hard edge's drawn top (EDGE_TOP_BY_TAG: the bluff's parapet, the interstate's guard rail,
 *   the ferry's bulwark), or a hard edge a road file gives (its author says a wall stands there; no road in the
 *   packs gives one, 2026-10-06);
 * - `front`: a building front (BUILDING_FRONT_TAGS): its buildings, in the structures plan or drawn by render's
 *   scatter (the sim tells the two apart, sim/riders/structures.ts);
 * - `brush`, `fence`: the ferns, the hedge or the fence render draws along the band's edge;
 * - `drop`: a hard edge where nothing stands and a drop lies past (a bridge's deck edge with no rail);
 * - null: nothing: a `soft` edge (the ground just runs on), or a hard edge with no tag over it and ground past it
 *   (a connector's side): past it is out of bounds, never a wall.
 */
export type DrawnEdge = 'barrier' | 'rail' | 'water' | 'wall' | 'front' | 'brush' | 'fence' | 'drop';

/**
 * Solid bands use one-metre clearance probes; barrier looks use two-metre panels with
 * five chord probes, at the look's own offset. An isolated clear probe draws no band.
 * Keep this private: the existing drawn-edge/top queries are the contact seam.
 */
function listedPanelAt(road: RoadNetwork, edge: number, s: number, side: VergeSide): boolean {
  const e = road.edges[edge];
  const b = e?.barriers.find((b) => s >= b.s0 && s <= b.s1 && (b.side === side || b.side === 'both'));
  if (!e || !b) return false;
  let from = Math.max(0, b.s0);
  let end = Math.min(e.length, b.s1);
  const sign = side === 'right' ? 1 : -1;
  // The renderer's barrier-look styles: all three have 2 m panels. Keep contact at
  // their actual placement, rather than the solid band's 5 cm offset.
  const interstate = e.tags.some(
    (t) => t.tag === 'interstate' && s >= t.s0 && s <= t.s1 && (t.side === 'both' || t.side === side),
  );
  const look = b.look ?? (interstate ? (b.kind === 'wall' ? 'concrete' : 'guardrail') : undefined);
  if (look) {
    const offset = look === 'railing' ? 0.2 : look === 'concrete' ? 0.3 : 0.07;
    const d = (sign > 0 ? e.dMax : e.dMin) + sign * offset;
    const panel = (lo: number, hi: number) => {
      if (hi <= lo) return false;
      const a = road.toWorld(edge, lo, d, 0);
      const c = road.toWorld(edge, hi, d, 0);
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        if (lanesNear(road, a.x + (c.x - a.x) * t, a.z + (c.z - a.z) * t, edge, 0.3)) return false;
      }
      return true;
    };
    const lo = from + Math.floor((s - from) / 2) * 2;
    return panel(lo, Math.min(end, lo + 2)) || (Math.abs(s - lo) < 1e-9 && lo > from && panel(lo - 2, lo));
  }
  // A gap restarts the renderer's probe grid at its far end.
  for (const f of e.features) {
    if (f.kind !== 'gap' || f.s1 <= from || f.s0 >= end) continue;
    if (f.s1 <= s) from = Math.max(from, f.s1);
    else if (f.s0 >= s) end = Math.min(end, f.s0);
    else return false;
  }
  const d = (sign > 0 ? e.dMax : e.dMin) + sign * 0.05;
  const clear = (u: number) => {
    const p = road.toWorld(edge, u, d, 0);
    return !lanesNear(road, p.x, p.z, edge, 0.3);
  };
  const lo = from + Math.floor(s - from);
  const hi = Math.min(end, lo + 1);
  if (!clear(lo)) return false;
  if (s > lo + 1e-9) return hi > lo && clear(hi);
  return (hi > lo && clear(hi)) || (lo > from && clear(Math.max(from, lo - 1)));
}

/**
 * Whether a `gap` takes the whole road away at (edge, s): its box covers the drive lanes (within half a metre of
 * their edges), as render/road-mesh.ts cuts a barrier there (a rail ends at a broken end; it does not span the
 * hole). Nothing stands at the edge over the hole.
 */
export function holeAt(road: RoadNetwork, edge: number, s: number): boolean {
  const e = road.edges[edge];
  if (!e) return false;
  for (const f of e.features) {
    if (f.s0 > s) break;
    if (f.kind !== 'gap' || s > f.s1) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const lane of road.lanesAt(edge, s)) {
      if (lane.kind !== 'drive') continue;
      lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
      hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    }
    const d0 = f.d0 < f.d1 ? f.d0 : f.d1;
    const d1 = f.d0 < f.d1 ? f.d1 : f.d0;
    if (lo < hi && d0 <= lo + 0.5 && d1 >= hi - 0.5) return true;
  }
  return false;
}

/** What is drawn at one side's band edge at (edge, s) (`DrawnEdge`), or null for nothing. */
export function drawnEdgeAt(road: RoadNetwork, edge: number, s: number, side: VergeSide): DrawnEdge | null {
  // Over a hole in the road nothing stands at its edge: what lies past it (the water under a missing span).
  if (holeAt(road, edge, s)) {
    const past = pastAt(road, edge, s, side);
    return past === 'ground' ? null : past;
  }
  if (road.barrierAt(edge, s, side)) return listedPanelAt(road, edge, s, side) ? 'barrier' : null;
  const v = road.vergeAt(edge, s, side);
  if (v.edge === 'water')
    return v.derived && beyondAt(road, edge, s, side, 1).past === 'ground' ? null : 'water';
  if (v.edge === 'rail' || v.edge === 'brush' || v.edge === 'fence') return v.edge;
  if (v.edge !== 'hard') return null;
  // A hard edge a road file gives (not derived): its author says a wall stands there.
  if (!v.derived) return 'wall';
  const e = road.edges[edge];
  const tag = e ? vergeTagAt(e, side, s) : null;
  if (tag !== null && BUILDING_FRONT_TAGS.has(tag)) return 'front';
  if (tag !== null && Object.hasOwn(EDGE_TOP_BY_TAG, tag)) return 'wall';
  return pastAt(road, edge, s, side) === 'ground' ? null : 'drop';
}

/**
 * How high a rider in the air must be over the deck at one side's band edge to clear what is drawn there, m, under
 * the honest edges (sim/riders/gap.ts `overStep`, with the course's edges on): `edgeTopAt` where something stands
 * (a barrier, a drawn top, a building front at any height); where it leaves the band's own rules to hold (a ground
 * edge), the drawn top of what ends the band (GROUND_EDGE_TOP_M); and 0 at a hard edge where nothing stands (a
 * deck's edge, a connector's side), so nothing undrawn holds a rider in the air.
 */
export function courseEdgeTopAt(road: RoadNetwork, edge: number, s: number, side: VergeSide): number {
  if (holeAt(road, edge, s)) return 0;
  if (road.barrierAt(edge, s, side) && !listedPanelAt(road, edge, s, side)) return 0;
  const top = edgeTopAt(road, edge, s, side);
  if (top === null) {
    const kind = road.vergeAt(edge, s, side).edge;
    return kind === 'brush' || kind === 'fence' ? GROUND_EDGE_TOP_M[kind] : GROUND_EDGE_TOP_M.soft;
  }
  if (top === Infinity) {
    const drawn = drawnEdgeAt(road, edge, s, side);
    return drawn === null || drawn === 'drop' ? 0 : top;
  }
  return top;
}

/** Another road's ground at most this far over the deck is met out past the edge (a bank rising past it), m. */
const OTHER_GROUND_OVER_M = 3;
/**
 * Drawn ground past an edge narrower than this holds no bike, m (the maintainer, 2026-10-06, [decided]: "land on
 * and ride any solid top big enough to hold a bike"): a bike's width, twice sim/riders' BIKE_HALF_WIDTH_M. A
 * deck's lip outside its rail (0.55 m) is passed over, and he falls past it.
 */
const HOLDS_BIKE_M = 1;

/** What lies under a rider (or a body) out past a road's edge: ground, water or a drop, and its floor, world y. */
export interface Beyond {
  past: Past;
  /** The ground's height, or the water's level (a drop's floor too). */
  floorY: number;
}

/** The network's lake level, where it has a lake above the sea (Lake Samish), else null. */
const lakeOf = (road: RoadNetwork): number | null =>
  Object.hasOwn(WATER_LEVEL_M, road.id) ? (WATER_LEVEL_M[road.id] ?? null) : null;

/**
 * What a rider (or a body) out past one side's band edge at (edge, s) meets, `acrossM` metres past that edge: what
 * the road scene draws there (the maintainer, 2026-10-06, [decided]: what is drawn is what is met, nothing is a
 * ghost; the one live check of 2026-10-07 had a high fall sink 70 m through Chuckanut's grassy shelf, drawn at the
 * road's height past its parapet). tests/sim/beyond-drawn.test.ts holds it to the drawn scene on every route
 * network.
 * - `ground` at the highest ground drawn there: its own cross-section's (road/drawn-ground.ts `sectionGroundOf`: its
 *   shoulder out to the drawn verge, its land strip, the bluff's 10 m shelf, a mangrove key, a roadside zone's
 *   catwalk, a lake's shore, the terrain skirt's gentle slope down the hill) where that runs a bike's width
 *   (HOLDS_BIKE_M) out from the edge, so a deck's lip outside its rail is passed over; or another road's (road/drawn-ground.ts
 *   `groundUnderOf`: a junction's corner, the land between a road and its slip road, a bank rising beside it);
 * - where none is drawn at all: what the road's tags say lies there (`pastAt`: the water off a bridge, the drop off
 *   the bluff's cliff), and a drop where they say ground (the sea or the valley far below a deck's side or a steep
 *   shelf), with the network's water level as its floor (`waterLevelOf`).
 * Another road the race allows, under the rider inside its edges, is the sim's to hand him onto first
 * (sim/riders/gap.ts `roadUnder`).
 */
export function beyondAt(
  road: RoadNetwork,
  edge: number,
  s: number,
  side: VergeSide,
  acrossM: number,
): Beyond {
  if (!road.edges[edge]) return { past: 'drop', floorY: 0 };
  const sign = side === 'right' ? 1 : -1;
  const from = sign * road.vergeAt(edge, s, side).dOuter;
  const at = from + Math.max(0, acrossM);
  const point = road.toWorld(edge, s, sign * at, 0);
  const water = lakeWaterAt(road.id, point.x, point.z) ?? 0;
  const tagged = pastAt(road, edge, s, side);
  const none: Beyond = { past: tagged === 'ground' ? 'drop' : tagged, floorY: water };
  if (holeAt(road, edge, s)) return none;
  const lake = lakeOf(road);
  const section = sectionGroundOf(road, lake);
  const others = groundUnderOf(road, lake);
  // Out from the centre line, m: the band's outer edge and the point.
  const deck = road.surfaceHeight(edge, s, sign * from);
  const otherAt = (out: number): number | null => {
    const q = road.toWorld(edge, s, sign * out, 0);
    return others(q.x, q.z, Math.max(q.y, deck) + OTHER_GROUND_OVER_M, { edge, s });
  };
  let own = section(edge, s, sign * at);
  // Its own ground holds a bike only where it runs a bike's width out from the edge (or on into another road's).
  if (own !== null && at < from + HOLDS_BIKE_M) {
    const out = from + HOLDS_BIKE_M;
    if (section(edge, s, sign * out) === null && otherAt(out) === null) own = null;
  }
  const other = otherAt(at);
  const floor = own === null ? other : other === null ? own : Math.max(own, other);
  return floor === null ? none : { past: 'ground', floorY: floor };
}

/** What the road's tags say lies past one side's band edge at (edge, s) (what is drawn there: `beyondAt`). */
export function pastAt(road: RoadNetwork, edge: number, s: number, side: VergeSide): Past {
  const tags = tagsOn(road, edge, side, s);
  if (tags.some((t) => t.startsWith('water'))) return 'water';
  if (road.vergeAt(edge, s, side).edge === 'water') return 'water';
  if (tags.some((t) => t === 'bluff' || t === 'bridge' || t === 'trestle')) return 'drop';
  if (road.barrierAt(edge, s, side)?.kind === 'rail') return 'drop';
  return 'ground';
}
