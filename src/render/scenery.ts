// Roadside scenery (playtest 1c, 2026-09-30). Item 3: "they are also mostly inappropriately placed,
// in concrete floating in the river lol", so scenery stands on land or the verge only, never on a
// bridge, the road or the water. Item 2: the scatter derives from the race's seed, so each race
// looks a little different and a fixed seed always gives the same scene. Item 4: the Blender
// scenery pack (palms, mangrove clumps, bait shacks, power poles, boats offshore).
//
// Land comes from the road's scenery tags, per side (docs/content-packs.md, "Scenery tags"): a
// water tag means sea (boats bob there), `bridge` or `causeway` alone means no land, and every other
// tag is land with a theme that picks what grows or stands on it. An edge with no tags at all (a
// test fixture, an untagged bake) counts as palm land. This module only decides; road-mesh.ts
// draws the land and instances the models. Presentation only: nothing here reaches the sim.
//
// The region build-out (W-O, the maintainer, 2026-10-01: "better visuals and experience") adds the
// Pacific Northwest's clustered conifers and sawmill and San Francisco's terraces of painted row
// houses on their own themes, conifers on the far ground of a forest, and fog banks offshore.
import { landmarkParams, type RoadNetwork } from '../road';
import type { Point3 } from './geometry';

/** What one side of a road is at some s. */
export type SideTheme =
  | 'none'
  | 'water'
  | 'palms'
  | 'beach'
  | 'mangrove'
  | 'commercial'
  | 'urban'
  | 'industrial'
  | 'sawmill'
  | 'forest'
  // run W-R, San Francisco's downtown (render/downtown.ts draws what stands there)
  | 'crossing'
  | 'plaza'
  | 'downtown'
  // run W-U, San Francisco's Chinatown and North Beach (render/chinatown-northbeach.ts draws them)
  | 'lanterns'
  | 'cafes'
  | 'park'
  // run W-U, San Francisco's mural alleys (render/mission.ts draws what stands there)
  | 'mission'
  // run W-U, San Francisco's waterfront (render/waterfront.ts draws what stands there)
  | 'promenade'
  | 'wharf'
  // run W-U, the Pacific Northwest's places (render/pnw-places.ts draws what stands there)
  | 'festival'
  | 'clearcut'
  // playtest 3 (T10.6), the Marin Headlands: open grass hills, no trees, no poles
  | 'headlands'
  // playtest 3 (T12.6), downtown Portland's blocks (render/downtown.ts draws what stands there)
  | 'blocks'
  // playtest 4 (P4-19), the Presidio: San Francisco's cypress and eucalyptus, no pines, no poles
  | 'presidio'
  // playtest 4 (P4-19), Key West's Old Town: a street, not a palm road (render/roadside.ts stands its fronts)
  | 'oldtown'
  // playtest 4 (P4-19, C4), Chuckanut Drive: the bay side's shelf and drop, and the uphill side's sandstone
  // cuts (render/roadside.ts stands the parapet, the bluff, the cuts and the boulders)
  | 'bluff'
  | 'cut'
  // playtest 4 (P4-19, C4), Lake Samish: the shore drive's lake side, a bank down to the water (the cabins
  // and docks, render/roadside.ts)
  | 'lake';
export type LandTheme = Exclude<SideTheme, 'none' | 'water'>;

/** Each land tag's theme. Tags not listed here (fog, cable-line) say nothing about the ground. */
const LAND_TAGS: Readonly<Record<string, LandTheme>> = {
  palms: 'palms',
  beach: 'beach',
  mangrove: 'mangrove',
  swamp: 'mangrove',
  marina: 'commercial',
  'strip-mall': 'commercial',
  'trailer-park': 'commercial',
  town: 'commercial',
  landmark: 'commercial',
  'row-houses': 'urban',
  'painted-houses': 'urban',
  warehouses: 'industrial',
  piers: 'industrial',
  gardens: 'urban',
  sawmill: 'sawmill',
  forest: 'forest',
  // Run W-R (interview, 2026-10-02: "SF first = downtown towers"): a cross street's mouth, a plaza
  // and the towers' sidewalk. Nothing of the scatter's stands there (no houses, no poles); the
  // downtown layer (downtown.ts) draws the towers, the cross streets and the plaza furniture.
  'cross-street': 'crossing',
  'cable-crossing': 'crossing',
  plaza: 'plaza',
  towers: 'downtown',
  // Run W-U (pitch deck #8): Chinatown's shopfronts, North Beach's cafes, a block's side street and
  // the hill's park. Nothing of the scatter's stands there; render/chinatown-northbeach.ts draws it.
  lanterns: 'lanterns',
  cafes: 'cafes',
  'side-street': 'crossing',
  'hill-park': 'park',
  // Run W-U (the pitch deck after playtest 2, #8: "the Mission's mural alleys"): shopfronts, an
  // alley's painted walls and the mascot's corner wall. Nothing of the scatter's stands there; the
  // mission layer (mission.ts) draws the buildings, the murals and the crew.
  shopfronts: 'mission',
  murals: 'mission',
  'mascot-mural': 'mission',
  // Run W-U (the pitch deck's #8): the waterfront. The bay side is the promenade to the seawall (the
  // pier sheds and the ferry hall stand on its edge); the city side is the waterfront blocks, their
  // side streets (`wharf-street`), the ferry plaza and the lot by the bridge. Nothing of the scatter's stands on
  // either; the waterfront layer (waterfront.ts) draws them.
  promenade: 'promenade',
  'pier-shed': 'promenade',
  'ferry-hall': 'promenade',
  wharf: 'wharf',
  'wharf-street': 'wharf',
  'ferry-plaza': 'wharf',
  'wharf-lot': 'wharf',
  // Run W-U (the pitch deck's #12): a closed main street on the day of the Stump Social (Fir County's
  // logging festival), and a fresh clear-cut. The
  // scatter puts nothing there but the forest's far edge past a clear-cut; pnw-places.ts draws the
  // shops, the bears, the stumps and the slash. (A `ferry` stretch is no land: the sea, and the ferry.)
  festival: 'festival',
  clearcut: 'clearcut',
  // Playtest 3 (T10.6; wave B's punch list, "Conzelman Road is lined with dense pines and log
  // fences, which reads as the PNW, not the Marin Headlands' grass hills"): coastal scrub and
  // grass. Land with nothing of the scatter on it, no conifers (the PNW's far trees) and no poles.
  headlands: 'headlands',
  // Playtest 3 (T12.6; wave B's punch list, item 3: Broadway should read as downtown, not as open
  // fields with farmhouses): Portland's brick and cast-iron blocks. Nothing of the scatter's stands there (no
  // palms, no bait shacks, no poles, which the `town` tag beside it would give); the downtown layer
  // (downtown.ts) stands the street fronts, the towers and the cart pod.
  'pdx-blocks': 'blocks',
  // Playtest 4 (P4-19; the identity sheets' G4): the Golden Gate's south approach runs through the
  // Presidio's groves of Monterey cypress and blue gum eucalyptus (Codex CX5's `sf-identity` trees), not
  // the headlands' bare grass and never the Pacific Northwest's conifers. No poles.
  presidio: 'presidio',
  // Playtest 4 (P4-19; the maintainer: "The real roads do not have the characteristics of the roads in
  // question in terms of scenery and feel"): Duval and Whitehead Streets are a street with a sidewalk and
  // a front of shops on it, not a beach road with palms, shacks and a pole line. Nothing of the scatter
  // stands there (no palms, no bait shacks, no poles); the roadside kit's Old Town rules (roadside.ts)
  // stand the fronts, the trees and the sidewalk's planters.
  'key-oldtown': 'oldtown',
  // Playtest 4 (P4-19, C4; the identity sheets' H1, H2 and I3, and their shared seam "a bluff/lake land
  // theme with a drop and no skirt"). Each is a span tag over part of one side (tools/gis `spanTags`),
  // over the road's `forest`: Chuckanut's bay side where the ground really drops to the water (`bluff`),
  // its uphill side where the slope rises from the road (`rock-cut`), and Lake Samish's shore drive where
  // the lake is beside it (`lake`).
  bluff: 'bluff',
  'rock-cut': 'cut',
  lake: 'lake',
};
/** A bluff's shelf past the verge, m: its 4 m dirt band to the parapet (road/cross-section.ts), then room
 * for the bay side's madrones (B9's, roadside.ts) behind the parapet, then the lip of the drop. [default] */
export const BLUFF_LAND_M = 10;
/** A lake side's land past the verge, m: room for a cabin and its deck behind the soft grass band, then
 * the bank to the water, where a dock's root stands. [default] */
export const LAKE_LAND_M = 20;
/**
 * Land that ends at a drop: its strip reaches only this far past the verge, m, and drops straight down
 * there (into the sea, or under the lake's water), with no terrain skirt (road-mesh.ts). The promenade's
 * seawall (run W-U): its 12 m verge band (road/cross-section.ts) less the drawn 0.6 m verge, so the drawn
 * edge is the sim's water edge. Chuckanut's bluff and Lake Samish's bank (playtest 4, P4-19, C4).
 */
export const SEAWALL_LAND_M: Readonly<Partial<Record<LandTheme, number>>> = {
  promenade: 11.4,
  bluff: BLUFF_LAND_M,
  lake: LAKE_LAND_M,
};
/**
 * How far past the verge the scatter's land kinds stand at the nearest, by theme, m (they keep their own
 * nearest otherwise): on a rock-cut side the trees stand behind the cut (roadside.ts lays it at the verge
 * band's edge, 3 m deep), never in front of it or through it. [default]
 */
export const THEME_NEAR_M: Readonly<Partial<Record<LandTheme, number>>> = { cut: 9.5 };
/**
 * Land that is wider than the usual strip (playtest 4, P4-20: Bridge City "as content-rich as the
 * others"): a theme listed here has a strip this wide past the verge, m, tried first (road-mesh.ts
 * falls back to the usual strip, then narrower, where another road is in the way). Downtown Portland's
 * blocks stand two deep on it: the street fronts, then a taller second row behind them.
 */
export const WIDE_LAND_M: Readonly<Partial<Record<LandTheme, number>>> = { blocks: 60 };
/** When one side carries several land tags, the first theme in this list wins. */
const THEME_ORDER: readonly LandTheme[] = [
  'festival',
  'clearcut',
  'crossing',
  'plaza',
  'downtown',
  // Ahead of `commercial`: a Portland block is also tagged `town`.
  'blocks',
  // Ahead of `commercial` and `palms`: Old Town's streets are tagged `town` and `palms` as well.
  'oldtown',
  'park',
  'lanterns',
  'cafes',
  'mission',
  'promenade',
  'wharf',
  // Ahead of `palms` (playtest 4, P4-19): a town street (Key West's Truman, White, Atlantic and the
  // rest, tagged `town` and `palms`) is a street with a kerb, not a beach road. No road that has
  // `commercial` and `mangrove` on one side exists; the road/cross-section.ts verge order agrees.
  'commercial',
  'palms',
  'mangrove',
  'beach',
  'sawmill',
  'urban',
  'industrial',
  // Ahead of the forest (playtest 4, P4-19, C4): each is a span over a road tagged `forest` on both sides.
  'bluff',
  'cut',
  'lake',
  'presidio',
  // Ahead of the forest: a side tagged both is the open hill (the bakes' old stand-in tag).
  'headlands',
  'forest',
];

export interface SideTag {
  s0: number;
  s1: number;
  side?: string;
  tag: string;
}

function onSide(t: SideTag, side: 'left' | 'right'): boolean {
  return t.side === undefined || t.side === 'both' || t.side === side;
}

/** The side's theme at s. Water tags win over land tags; bridge and causeway alone mean no land. */
export function themeAt(tags: readonly SideTag[] | undefined, side: 'left' | 'right', s: number): SideTheme {
  if (!tags || tags.length === 0) return 'palms';
  let best: LandTheme | null = null;
  let bridge = false;
  for (const t of tags) {
    if (s < t.s0 || s > t.s1 || !onSide(t, side)) continue;
    if (t.tag.startsWith('water')) return 'water';
    if (t.tag === 'bridge' || t.tag === 'causeway') bridge = true;
    const theme = LAND_TAGS[t.tag];
    if (theme && (best === null || THEME_ORDER.indexOf(theme) < THEME_ORDER.indexOf(best))) best = theme;
  }
  if (bridge && best === null) return 'none';
  return best ?? 'none';
}

export type SceneryKind =
  | 'palm'
  | 'mangrove'
  | 'shack'
  | 'pole'
  | 'skiff'
  | 'boat'
  | 'conifer'
  | 'house'
  | 'sawmill'
  | 'fogBank'
  | 'islet'
  // playtest 3, T12.3: a bridge bay (bridge-bays.ts places them; the scatter never does)
  | 'bay'
  // playtest 4 (P4-19): a concrete deck arch under an `arch-bridge` deck (bridge-bays.ts `planArches`)
  | 'arch'
  // playtest 4 (P4-19): San Francisco's coastal trees, a Monterey cypress or a blue gum eucalyptus
  | 'coastTree';
export const SCENERY_KINDS: readonly SceneryKind[] = [
  'palm',
  'mangrove',
  'shack',
  'pole',
  'skiff',
  'boat',
  'conifer',
  'house',
  'sawmill',
  'fogBank',
  'islet',
  'bay',
  'arch',
  'coastTree',
];

export interface ScenerySpot {
  kind: SceneryKind;
  /** Which of the model's variants (palms have 3, mangroves 2). */
  variant: number;
  p: Point3;
  /** Turn about the vertical axis, radians (the model's +Z turns to (sin, cos) in x, z). */
  turn: number;
  size: number;
  /** A boat's bobbing phase, radians (0 for land scenery). */
  phase: number;
  /** The edge and s it was placed from (tests and the debug overlay). */
  edge: number;
  s: number;
  /** Signed lateral offset on that edge, m. */
  d: number;
  /**
   * A bridge bay's grade (playtest 3, T12.3): the model is sheared up by this much per metre along
   * its +Z, so its deck follows the road's and its piers stay upright. Absent: 0.
   */
  slope?: number | undefined;
  /**
   * How far the model reaches from its origin, m, when a prop is longer than the merged blocks'
   * default room (a 41 m bay): the block's culling counts it. Absent: the default.
   */
  reachM?: number | undefined;
}

/** Metres between candidate spots of each kind on one side, at density 1. [default] */
export const SCATTER_SPACING_M: Readonly<Record<SceneryKind, number>> = {
  palm: 18,
  mangrove: 15,
  shack: 90,
  pole: 45,
  skiff: 110,
  boat: 110,
  // a conifer spot is a cluster of one to four trees; a house is one plot of a terrace
  conifer: 16,
  house: 7,
  sawmill: 380,
  fogBank: 170,
  // run W-Q: a candidate islet every so often on each open-water side of a tropical road
  islet: 200,
  // bays and arches are placed along a bridge by bridge-bays.ts, never scattered
  bay: 0,
  arch: 0,
  // one tree a spot, in groves: the Presidio's are planted close
  coastTree: 13,
};
/** Share of a theme's candidate spots that get each kind. [default] */
const RATE: Readonly<Record<LandTheme, Partial<Record<SceneryKind, number>>>> = {
  palms: { palm: 1, shack: 0.3 },
  beach: { palm: 0.3 },
  mangrove: { mangrove: 1, palm: 0.12 },
  commercial: { palm: 0.45, shack: 1 },
  urban: { house: 0.8 },
  industrial: {},
  sawmill: { sawmill: 1, conifer: 0.35 },
  forest: { conifer: 1 },
  crossing: {},
  plaza: {},
  downtown: {},
  lanterns: {},
  cafes: {},
  park: {},
  mission: {},
  promenade: {},
  wharf: {},
  festival: {},
  clearcut: {},
  headlands: {},
  blocks: {},
  presidio: { coastTree: 0.85 },
  oldtown: {},
  // Playtest 4 (P4-19, C4): no fir on the bluff's shelf (the madrones stand there, roadside.ts); the firs stand behind the rock cut
  // (THEME_NEAR_M); a few stand among the lake's cabins.
  bluff: {},
  cut: { conifer: 0.8 },
  lake: { conifer: 0.3 },
};
/**
 * Themes with no power poles: a downtown's (and the waterfront's) wires are underground, the mural
 * district's walls stand at the kerb, the festival street's shops stand at the sidewalk, and a
 * clear-cut has none.
 */
const NO_POLES: ReadonlySet<LandTheme> = new Set([
  'crossing',
  'plaza',
  'downtown',
  'lanterns',
  'cafes',
  'park',
  'mission',
  'promenade',
  'wharf',
  'festival',
  'clearcut',
  'headlands',
  'blocks',
  'presidio',
  'oldtown',
  // Playtest 4 (P4-19, C4): the bluff's shelf holds the parapet and the madrones; the lake's bank, cabins and docks.
  'bluff',
  'lake',
]);
/** Where each kind stands past the verge: the nearest offset and the random spread beyond it, m. */
const ACROSS_M: Readonly<Record<SceneryKind, readonly [number, number]>> = {
  palm: [2.2, 5.5],
  mangrove: [2.8, 9],
  shack: [8.5, 6],
  pole: [1.6, 0],
  skiff: [30, 45],
  boat: [34, 45],
  conifer: [4.5, 15],
  // the house's front wall stands back from the verge by a sidewalk and its stoop
  house: [2.6, 0],
  sawmill: [6, 0],
  fogBank: [150, 150],
  // out past the boats, near enough to see from the road
  islet: [32, 50],
  bay: [0, 0],
  arch: [0, 0],
  // the cypress's windswept crown leans up to 8 m to one side, so it starts back from the verge
  coastTree: [5.5, 13],
};
/** Clear ground each kind needs around its anchor (other roads, features), m. */
export const SCENERY_RADIUS_M: Readonly<Record<SceneryKind, number>> = {
  palm: 1.6,
  mangrove: 3,
  shack: 3.6,
  pole: 1.4,
  skiff: 4,
  boat: 5,
  conifer: 2,
  house: 3.4,
  sawmill: 4,
  fogBank: 40,
  // ISLET_CLEAR_M (declared below, so the literal here)
  islet: 16,
  bay: 0,
  arch: 0,
  coastTree: 2.4,
};
/**
 * What of each kind a rider would hit, as a radius round its anchor, m (off-road, run W-R): a palm's
 * or a pole's trunk, not its crown, which may overhang the ridable band. [default]
 */
export const TRUNK_M: Partial<Record<SceneryKind, number>> = {
  palm: 0.4,
  pole: 0.3,
  conifer: 0.8,
  coastTree: 0.8,
};
/** How far back from its anchor (its front) each kind reaches, m (it needs land that deep). */
export const DEPTH_M: Partial<Record<SceneryKind, number>> = { house: 11.5, sawmill: 17 };
/** Half its width along the road, m (it needs land and clear ground that long). */
export const HALF_ALONG_M: Partial<Record<SceneryKind, number>> = { house: 3.2, sawmill: 16 };
/** Land a house or the sawmill keeps past each of its ends, m. [default] */
const LAND_LIP_M = 3;
const VARIANTS: Readonly<Record<SceneryKind, number>> = {
  palm: 3,
  mangrove: 2,
  shack: 1,
  pole: 1,
  skiff: 1,
  boat: 1,
  conifer: 4,
  house: 4,
  sawmill: 1,
  fogBank: 2,
  islet: 4,
  bay: 6,
  // the Gorge kit's 24 m arch bay and its 46 m span (bridge-bays.ts ARCH_KINDS)
  arch: 2,
  // the cypress and the eucalyptus (models.ts, `sfIdentity`)
  coastTree: 2,
};
/** Each conifer variant's share of a forest: the two firs, the young fir, the cedar. [default] */
const CONIFER_MIX = [0.3, 0.32, 0.23, 0.15];

/** Tags that mark a network as tropical (the Keys): only there do palms and mangroves grow. */
const TROPICAL_TAGS = new Set(['palms', 'beach', 'mangrove', 'swamp']);

/** Whether a network's tags say tropical. A network with no tags at all counts as tropical (base). */
export function isTropical(tagLists: readonly (readonly SideTag[] | undefined)[]): boolean {
  let any = false;
  for (const tags of tagLists) {
    for (const t of tags ?? []) {
      any = true;
      if (TROPICAL_TAGS.has(t.tag)) return true;
    }
  }
  return !any;
}

/** A small seeded hash to 0..1 (placement only; never the sim's RNG). */
export function scatterHash(seed: number, a: number, b: number, c: number): number {
  let h = Math.imul((seed | 0) ^ 0x5bd1e995, 0x85ebca6b);
  h = Math.imul(h ^ (a + 0x9e3779b9), 0xc2b2ae35);
  h = Math.imul(h ^ (Math.round(b * 16) + 0x27d4eb2f), 0x85ebca6b);
  h ^= Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The loose ground a rider rides on beside the road (off-road, run W-R): solid scenery keeps off it. */
const LOOSE_BAND: ReadonlySet<string> = new Set(['dirt', 'gravel', 'sand', 'grass']);

/** Water kept clear round an island's box, m: a boat's length and a swell. [default] */
export const ISLAND_CLEAR_M = 10;

/** The box of a landmark that stands on an island of its own, in the world. */
export interface IslandBox {
  /** The box's middle, and the road's unit heading there (its along axis); across is the road's normal. */
  x: number;
  z: number;
  tx: number;
  tz: number;
  halfAlongM: number;
  halfAcrossM: number;
}

/**
 * Every `landmark` feature that says `island` (playtest 4, Pigeon Key), as a box in the world. The sea
 * round it is not open water: boats and islets keep off (`onIsland`), whichever road the scatter walks.
 */
export function islandBoxes(road: RoadNetwork): IslandBox[] {
  const out: IslandBox[] = [];
  for (const e of road.edges) {
    for (const f of road.featuresOf(e.index, 'landmark')) {
      if (!landmarkParams(f).island) continue;
      const s = (f.s0 + f.s1) / 2;
      const d = (f.d0 + f.d1) / 2;
      const c = road.toWorld(e.index, s, d, 0);
      const t = road.frameAt(e.index, s);
      out.push({
        x: c.x,
        z: c.z,
        tx: t.tx,
        tz: t.tz,
        halfAlongM: Math.abs(f.s1 - f.s0) / 2,
        halfAcrossM: Math.abs(f.d1 - f.d0) / 2,
      });
    }
  }
  return out;
}

/** Whether a point is on an island's box or within `clearM` of it. */
export function onIsland(
  boxes: readonly IslandBox[],
  x: number,
  z: number,
  clearM = ISLAND_CLEAR_M,
): boolean {
  for (const b of boxes) {
    const dx = x - b.x;
    const dz = z - b.z;
    const along = dx * b.tx + dz * b.tz;
    // The box's across axis is the road's normal at its middle.
    const across = -dx * b.tz + dz * b.tx;
    if (Math.abs(along) <= b.halfAlongM + clearM && Math.abs(across) <= b.halfAcrossM + clearM) return true;
  }
  return false;
}

/**
 * How far past `outer` (a distance from the centre line, positive) the ridable band of loose ground
 * reaches at (edge, s) on a side, m, or 0 (no band, or a city kerb and pavement, whose street
 * furniture stands at the kerb). Off-road (run W-R; interview, 2026-10-02: "Anywhere with ground"):
 * a tree, a pole, a shack or a mailbox stands at or past it, so nothing solid stands where a rider
 * rides; ferns and other understory may grow on it.
 */
export function ridableBandPast(
  road: RoadNetwork,
  edge: number,
  side: -1 | 1,
  s: number,
  outer: number,
): number {
  const v = road.vergeAt(edge, s, side < 0 ? 'left' : 'right');
  if (v.widthM <= 0 || !LOOSE_BAND.has(v.surface)) return 0;
  return Math.max(0, side * v.dOuter - outer);
}

/** What the scatter needs from the road builder, for one edge. */
export interface ScatterEdge {
  seed: number;
  edge: number;
  length: number;
  /** Candidate spots per stretch, 1 = the spacing above, 0 = no scenery (`render.roadsideDensity`). */
  density: number;
  /** Tropical networks grow palms and mangroves; elsewhere only the buildings and poles stand. */
  tropical: boolean;
  /** The verge's outer edge, as a distance from the centre line on that side (positive), m. */
  outer(side: -1 | 1): number;
  theme(side: -1 | 1, s: number): SideTheme;
  /**
   * How far past the verge the ridable band of loose ground reaches at s on that side, m (run W-R,
   * `ridableBandPast`): land scenery stands its footprint clear of it. Absent: 0.
   */
  band?: ((side: -1 | 1, s: number) => number) | undefined;
  /**
   * Whether two spots fall in the same instanced batch (road-mesh's scenery chunks): scenery moved
   * out past the band stays in its batch, so the move never adds a draw call. Absent: always.
   */
  sameBatch?: ((a: Point3, b: Point3) => boolean) | undefined;
  /** Metres of drawn land past the verge at s on that side (0 = none: a bridge, a rail, the sea). */
  landReach(side: -1 | 1, s: number): number;
  /** Whether a spot of this radius is free of roads, features and roadside zones. */
  clear(s: number, d: number, radius: number): boolean;
  /** Whether a boat may float here: open water, clear of every road and its land. */
  openWater(s: number, d: number): boolean;
  world(s: number, d: number, h: number): Point3;
  /**
   * The far ground of the terrain skirt at s on that side (non-tropical networks only): the flat
   * ground's span, as distances past the verge, and its world height. Null where there is none.
   */
  skirt?: ((side: -1 | 1, s: number) => { from: number; to: number; y: number } | null) | undefined;
  /**
   * Whether a far conifer may stand at (s, d) on that side: on the skirt's flat ground exactly as
   * drawn, round its trunk, and clear of every road, this one's other stretches included.
   */
  onFarGround?: ((side: -1 | 1, s: number, d: number) => boolean) | undefined;
  /** Whether fog banks lie offshore (the region's palette names a `fogBank` colour). */
  fogBanks?: boolean | undefined;
}

/** The turn that points a model's +Z from a toward b. */
function turnToward(a: Point3, b: Point3): number {
  return Math.atan2(b.x - a.x, b.z - a.z);
}

const LAND_KINDS: readonly SceneryKind[] = [
  'palm',
  'mangrove',
  'shack',
  'conifer',
  'house',
  'sawmill',
  'coastTree',
];
/** Kinds that face the road (their +Z turns toward the centre line). */
const FACES_ROAD = new Set<SceneryKind>(['shack', 'house', 'sawmill']);

/** Places one edge's scenery: land kinds on land by theme, poles along one side, boats on water. */
export function scatterEdge(e: ScatterEdge): ScenerySpot[] {
  const out: ScenerySpot[] = [];
  if (e.density <= 0) return out;
  const h = (kind: number, k: number, side: number, salt: number) =>
    scatterHash(e.seed, e.edge * 977 + kind * 31 + salt, k, side + 3);
  const place = (
    kind: SceneryKind,
    s: number,
    d: number,
    y: number,
    turn: number,
    k: number,
    side: number,
    variant?: number,
    size?: number,
  ) => {
    const ki = SCENERY_KINDS.indexOf(kind);
    out.push({
      kind,
      variant: variant ?? Math.floor(h(ki, k, side, 5) * VARIANTS[kind]) % VARIANTS[kind],
      p: e.world(s, d, y),
      turn,
      size:
        size ??
        (kind === 'palm'
          ? 0.85 + 0.3 * h(ki, k, side, 6)
          : kind === 'mangrove'
            ? 0.8 + 0.45 * h(ki, k, side, 6)
            : kind === 'coastTree'
              ? 0.8 + 0.4 * h(ki, k, side, 6)
              : 1),
      phase: kind === 'skiff' || kind === 'boat' ? h(ki, k, side, 7) * Math.PI * 2 : 0,
      edge: e.edge,
      s,
      d,
    });
  };
  /** A conifer's variant by the forest mix, and its size. */
  const conifer = (u: number, v: number) => {
    let acc = 0;
    let variant = CONIFER_MIX.length - 1;
    for (let i = 0; i < CONIFER_MIX.length; i++) {
      acc += CONIFER_MIX[i] ?? 0;
      if (u < acc) {
        variant = i;
        break;
      }
    }
    return { variant, size: 0.8 + 0.4 * v };
  };
  // The poles run down one side of the road, chosen by the seed.
  const poleSide: -1 | 1 = h(99, 0, 0, 1) < 0.5 ? -1 : 1;
  for (const side of [-1, 1] as const) {
    const outer = e.outer(side);
    for (const kind of [...LAND_KINDS, 'pole' as const]) {
      if (kind === 'pole' && side !== poleSide) continue;
      const ki = SCENERY_KINDS.indexOf(kind);
      const spacing = SCATTER_SPACING_M[kind] / e.density;
      // Row houses stand shoulder to shoulder in terraces, so their plots keep the spacing exactly.
      const jitter = kind === 'house' ? 0 : 0.7;
      for (let k = 0; ; k++) {
        const s = (k + 0.15 + jitter * h(ki, k, side, 0)) * spacing;
        if (s > e.length) break;
        const theme = e.theme(side, s);
        if (theme === 'none' || theme === 'water') continue;
        if (kind === 'pole' && NO_POLES.has(theme)) continue;
        if (!e.tropical && (kind === 'palm' || kind === 'mangrove')) continue;
        if (kind !== 'pole' && h(ki, k, side, 1) >= (RATE[theme][kind] ?? 0)) continue;
        const [ownNear, spread] = ACROSS_M[kind];
        // Some land keeps its trees back (a rock cut's firs stand behind it, playtest 4, P4-19, C4).
        const near = Math.max(ownNear, kind === 'pole' ? 0 : (THEME_NEAR_M[theme] ?? 0));
        const radius = SCENERY_RADIUS_M[kind];
        // Off-road (run W-R): its footprint past the ridable band (a house or the sawmill by its front).
        const solid = DEPTH_M[kind] !== undefined ? 0 : (TRUNK_M[kind] ?? radius);
        const clearOf = e.band ? e.band(side, s) + solid : 0;
        const wanted = near + spread * h(ki, k, side, 2);
        const across = Math.max(wanted, clearOf);
        const depth = DEPTH_M[kind] ?? radius;
        const along = Math.max(radius, HALF_ALONG_M[kind] ?? 0);
        // On the drawn land, with room for the model across and along (the land ends where a tag
        // or a rail does, and at the road's ends, where the next road's land may not meet it), and
        // clear of everything else.
        if (s - along < 0 || s + along > e.length) continue;
        // A house or the sawmill keeps a few metres of land past each end of it, so it never stands
        // on the lip where its land stops (run W-O's skeptic: the houses at SF's bridge ends).
        const lip = DEPTH_M[kind] !== undefined ? LAND_LIP_M : 0;
        const reach = Math.min(
          e.landReach(side, s),
          e.landReach(side, s - along - lip),
          e.landReach(side, s + along + lip),
        );
        if (across + depth > reach) continue;
        const d = side * (outer + across);
        if (!e.clear(s, d, radius)) continue;
        // Moved out past the band, it is still the spot it was: one that was blocked where it wanted
        // to stand (a sign, a pad, a pedestrian zone) stays out, so the band only moves scenery, and
        // one the move would carry into the next instanced batch is dropped (no draw call is added).
        if (across !== wanted) {
          const was = side * (outer + wanted);
          if (!e.clear(s, was, radius)) continue;
          if (e.sameBatch && !e.sameBatch(e.world(s, was, 0), e.world(s, d, 0))) continue;
        }
        if (DEPTH_M[kind] !== undefined) {
          // A house or the sawmill reaches back from its front and along the road: all of it clear.
          const back = side * (outer + across + depth);
          if (!e.clear(s, back, radius) || !e.clear(s - along, d, radius) || !e.clear(s + along, d, radius))
            continue;
        }
        if (kind === 'conifer') {
          // A cluster of one to three trees around the spot, each on land and clear on its own.
          const n = 1 + Math.floor(h(ki, k, side, 3) * 3);
          for (let t = 0; t < n; t++) {
            const ts = s + (t === 0 ? 0 : (h(ki, k * 8 + t, side, 9) - 0.5) * 9);
            const ta = across + (t === 0 ? 0 : (h(ki, k * 8 + t, side, 10) - 0.5) * 8);
            if (ts - radius < 0 || ts + radius > e.length || ta < Math.max(near, clearOf)) continue;
            if (ta + radius > Math.min(e.landReach(side, ts - radius), e.landReach(side, ts + radius)))
              continue;
            const td = side * (outer + ta);
            if (t > 0 && !e.clear(ts, td, radius)) continue;
            const c = conifer(h(ki, k * 8 + t, side, 11), h(ki, k * 8 + t, side, 12));
            const turn = h(ki, k * 8 + t, side, 13) * Math.PI * 2;
            place('conifer', ts, td, LAND_TOP_M, turn, k, side, c.variant, c.size);
          }
          continue;
        }
        // Shacks, houses and the sawmill face the road; poles carry their wires along it; the
        // rest turn at random.
        const turn = FACES_ROAD.has(kind)
          ? turnToward(e.world(s, d, 0), e.world(s, 0, 0))
          : kind === 'pole'
            ? turnToward(e.world(s, d, 0), e.world(Math.min(e.length, s + 1), d, 0))
            : h(ki, k, side, 3) * Math.PI * 2;
        // A house on a hill sinks to the lowest of its front corners, so neither corner floats: the
        // terraces step down the hills.
        let y = LAND_TOP_M;
        if (kind === 'house' || kind === 'sawmill') {
          const here = e.world(s, d, 0).y;
          const low = Math.min(here, e.world(s + along, d, 0).y, e.world(s - along, d, 0).y);
          y -= here - low + 0.15;
        }
        place(kind, s, d, y, turn, k, side);
      }
    }
    // A forest goes on past the verge's strip: conifers on the far ground of the terrain skirt.
    const ci = SCENERY_KINDS.indexOf('conifer');
    const farSpacing = FAR_CONIFER_SPACING_M / e.density;
    for (let k = 0; e.skirt; k++) {
      const s = (k + h(ci, k, side, 20)) * farSpacing;
      if (s > e.length) break;
      const theme = e.theme(side, s);
      // The forest goes on above a rock cut too (playtest 4, P4-19, C4).
      if (theme !== 'forest' && theme !== 'sawmill' && theme !== 'clearcut' && theme !== 'cut') continue;
      const far = e.skirt(side, s);
      if (!far || far.to - far.from < 4) continue;
      const across = far.from + 2 + (far.to - far.from - 4) * h(ci, k, side, 21);
      const d = side * (outer + across);
      if (!e.clear(s, d, SCENERY_RADIUS_M.conifer)) continue;
      // On the flat ground as drawn and clear of every road (run W-O's skeptic: 71, 124 and 46
      // trees over the water on three real roads).
      if (e.onFarGround && !e.onFarGround(side, s, d)) continue;
      const c = conifer(h(ci, k, side, 22), h(ci, k, side, 23));
      const p = e.world(s, d, 0);
      out.push({
        kind: 'conifer',
        variant: c.variant,
        p: { x: p.x, y: far.y, z: p.z },
        turn: h(ci, k, side, 24) * Math.PI * 2,
        size: c.size * 1.15,
        phase: 0,
        edge: e.edge,
        s,
        d,
      });
    }
    // Boats offshore: skiffs mostly, now and then the bigger centre-console boat.
    const spacing = SCATTER_SPACING_M.skiff / e.density;
    const ki = SCENERY_KINDS.indexOf('skiff');
    for (let k = 0; ; k++) {
      const s = (k + 0.15 + 0.7 * h(ki, k, side, 0)) * spacing;
      if (s > e.length) break;
      if (e.theme(side, s) !== 'water') continue;
      const kind: SceneryKind = h(ki, k, side, 4) < 0.75 ? 'skiff' : 'boat';
      const [near, spread] = ACROSS_M[kind];
      const d = side * (outer + near + spread * h(ki, k, side, 2));
      if (!e.openWater(s, d)) continue;
      const p = e.world(s, d, 0);
      const along = turnToward(p, e.world(Math.min(e.length, s + 1), d, 0));
      const turn = along + (h(ki, k, side, 3) - 0.5) * 1.4 + (h(ki, k, side, 8) < 0.5 ? Math.PI : 0);
      out.push({
        kind,
        variant: 0,
        p: { x: p.x, y: 0, z: p.z },
        turn,
        size: 1,
        phase: h(ki, k, side, 7) * Math.PI * 2,
        edge: e.edge,
        s,
        d,
      });
    }
    // Islets (run W-Q, distinct keys; playtest 2: "Maybe islands in the Keys"): little islands among
    // the boats on a tropical road's open water, so the water off every bridge is never empty. Each
    // needs open water all round it (no other road near) and water on its own road's side along
    // its length; a boat already floating where it stands moves off (is dropped).
    if (e.tropical) {
      const ii = SCENERY_KINDS.indexOf('islet');
      const isletSpacing = SCATTER_SPACING_M.islet / e.density;
      const r = ISLET_CLEAR_M;
      for (let k = 0; ; k++) {
        const s = (k + 0.15 + 0.7 * h(ii, k, side, 0)) * isletSpacing;
        if (s > e.length) break;
        if (h(ii, k, side, 1) >= ISLET_RATE) continue;
        if (![s - r, s, s + r].every((u) => e.theme(side, Math.max(0, Math.min(e.length, u))) === 'water'))
          continue;
        const [near, spread] = ACROSS_M.islet;
        const across = near + spread * h(ii, k, side, 2);
        const d = side * (outer + across);
        const ring: readonly (readonly [number, number])[] = [
          [0, 0],
          [-r, 0],
          [r, 0],
          [0, -r],
          [0, r],
        ];
        if (!ring.every(([ds, dd]) => e.openWater(Math.max(0, Math.min(e.length, s + ds)), d + dd))) continue;
        const p = e.world(s, d, 0);
        for (let j = out.length - 1; j >= 0; j--) {
          const o = out[j];
          if (o && (o.kind === 'skiff' || o.kind === 'boat') && Math.hypot(o.p.x - p.x, o.p.z - p.z) < r + 6)
            out.splice(j, 1);
        }
        // One kind of islet per square of the scenery's batching grid (road-mesh.ts
        // SCENERY_CHUNK_M), so the islets in sight cost a draw per square, not per kind and square.
        const gx = Math.floor(p.x / ISLET_GROUP_M);
        const gz = Math.floor(p.z / ISLET_GROUP_M);
        out.push({
          kind: 'islet',
          variant: Math.floor(scatterHash(e.seed, ii * 7919 + gx, gz, 11) * VARIANTS.islet) % VARIANTS.islet,
          p: { x: p.x, y: -ISLET_SINK_M, z: p.z },
          turn: h(ii, k, side, 3) * Math.PI * 2,
          size: 1 + 0.4 * h(ii, k, side, 6),
          phase: 0,
          edge: e.edge,
          s,
          d,
        });
      }
    }
    // Fog banks far offshore, lying along the shore (a region whose palette names a fog bank).
    if (!e.fogBanks) continue;
    const fi = SCENERY_KINDS.indexOf('fogBank');
    for (let k = 0; ; k++) {
      const s = (k + 0.15 + 0.7 * h(fi, k, side, 0)) * SCATTER_SPACING_M.fogBank;
      if (s > e.length) break;
      if (e.theme(side, s) !== 'water') continue;
      const [near, spread] = ACROSS_M.fogBank;
      const d = side * (outer + near + spread * h(fi, k, side, 2));
      const open = [s - 75, s - 40, s, s + 40, s + 75].every((u) =>
        e.openWater(Math.max(0, Math.min(e.length, u)), d),
      );
      if (!open) continue;
      const p = e.world(s, d, 0);
      out.push({
        kind: 'fogBank',
        variant: Math.floor(h(fi, k, side, 5) * 2) % 2,
        p: { x: p.x, y: 0, z: p.z },
        // the bank's length (its x) lies along the shore
        turn: turnToward(p, e.world(Math.min(e.length, s + 1), d, 0)) + Math.PI / 2,
        size: 1.6 + 0.8 * h(fi, k, side, 6),
        phase: 0,
        edge: e.edge,
        s,
        d,
      });
    }
  }
  return out;
}

/** An islet's open water all round its centre, m (the biggest islet's sand reaches about 15 m). [default] */
export const ISLET_CLEAR_M = 16;
/** Share of an open-water side's islet candidates that get one. [default] */
const ISLET_RATE = 0.85;
/** The scenery's batching square (road-mesh.ts SCENERY_CHUNK_M): one islet kind per square. */
const ISLET_GROUP_M = 256;
/** Each islet's lowest point is this far under the waterline (tools/blender/props/keys_islets.py SINK_M). */
export const ISLET_SINK_M = 0.8;

/** Metres between conifers on a forest's far ground, at density 1. [default] */
export const FAR_CONIFER_SPACING_M = 10;

/** Land scenery stands on the land strip, which sits this far under the road (road-mesh.ts). */
export const LAND_TOP_M = -0.09;

/** A boat's bob at time t: rise (m), roll and pitch (radians). [default] gentle swell. */
export function boatBob(t: number, phase: number): { rise: number; roll: number; pitch: number } {
  return {
    rise: 0.12 * Math.sin(t * 1.3 + phase),
    roll: 0.06 * Math.sin(t * 1.1 + phase * 1.7),
    pitch: 0.035 * Math.sin(t * 0.9 + phase * 0.6 + 1),
  };
}
