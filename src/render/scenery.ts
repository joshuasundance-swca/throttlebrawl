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
import {
  landmarkParams,
  scatterHash,
  themeAt,
  type LandTheme,
  type RoadNetwork,
  type SideTag,
  type SideTheme,
} from '../road';
import type { Point3 } from './geometry';

// The themes and the scatter hash live in road/themes.ts (playtest 4, "solid but forgiving": the sim
// reads the street furniture's plan, road/furniture.ts, which needs them); re-exported for render.
export { scatterHash, themeAt };
export type { LandTheme, SideTag, SideTheme } from '../road';

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
 * blocks stand two deep on it: the street fronts, then a taller second row behind them. Old Town's
 * streets (playtest 4, run B's check: "mid-street the sea shows behind both fronts") have a city floor:
 * a gap between two shopfronts shows ground and the row of houses behind, not the sea.
 */
export const WIDE_LAND_M: Readonly<Partial<Record<LandTheme, number>>> = { blocks: 60, oldtown: 72 };

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
  | 'coastTree'
  // playtest 4, P4-19 (R3): a taller building in the terrace's plots; only an upgrade of row-house plots
  | 'apartment'
  // playtest 4 (P4-19, C2): the headlands' own props, three roots of CX6's `sf-headlands` file: a low
  // concrete gun battery, a clump of coyote brush and an outcrop of red chert
  | 'battery'
  | 'brush'
  | 'outcrop';
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
  'apartment',
  'battery',
  'brush',
  'outcrop',
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
  /** How many 7 m plots of a terrace an apartment building takes (1 or 2). Absent: it is no apartment. */
  plots?: number | undefined;
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
  // apartments take the place of row houses in their plots (`upgradeTerrace`), never scattered of their own
  apartment: 0,
  // a gun battery is 30 m long, so they stand far apart; the brush is a clump every so often, the
  // chert's outcrops a little closer than a pine's cluster
  battery: 140,
  brush: 22,
  outcrop: 24,
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
  // Playtest 4 (P4-19, C2; the identity sheets' G2 and T1): coyote brush all along; a battery only on a
  // side that faces the water the network crosses (`ScatterEdge.seaward`); the chert only at the top of a
  // road that ends there (`ScatterEdge.summit`).
  headlands: { battery: 0.5, brush: 0.55, outcrop: 0.8 },
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
  apartment: [2.6, 0],
  // the battery's origin is the middle of its 11.5 m footprint: its front (`FRONT_M`) stands past the
  // ridable band, its back (`DEPTH_M`) on land, so its origin stands 8 to 14 m past the verge
  battery: [8, 6],
  brush: [3.5, 14],
  outcrop: [4, 12],
};
/**
 * How big a headland battery stands, times CX6's model (30 m by 3.7 m, a 5.5 m deep front to a 9 m back).
 * [default] (playtest 4, run C's live check: "the headland batteries read as small grey blocks or rubble on
 * Conzelman's verge"): at 1 it was a 3.7 m wall seen from 12 m off the road. At 1.5 it is 45 m long, with a
 * 5.6 m front wall and gun pits 13 m across, still inside the 24 m of land beside a road: the footprint numbers
 * below (`DEPTH_M`, `HALF_ALONG_M`, `FRONT_M`, the clear radius) follow it.
 */
export const BATTERY_SIZE = 1.5;
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
  apartment: 3.4,
  battery: 6 * BATTERY_SIZE,
  brush: 1.2,
  // the chert's four beds lean over about 3 m to a side
  outcrop: 3.6,
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
  // a rock is as solid as a trunk, and a shrub is not: it stands past the band like the rest
  outcrop: 2.6,
  brush: 0.9,
};
/**
 * How far back from its anchor (its front) each kind reaches, m (it needs land that deep). The gun
 * battery's anchor is the middle of its footprint (CX6's `gg_battery`: 5.5 m ahead of it, 6 m behind).
 */
export const DEPTH_M: Partial<Record<SceneryKind, number>> = {
  house: 11.5,
  apartment: 11.5,
  sawmill: 17,
  battery: 6.2 * BATTERY_SIZE,
};
/**
 * Half its width along the road, m (it needs land and clear ground that long). An apartment is the width of
 * its plots (6.4 m of one, 13.6 m of two): read it from the spot with `halfAlongOf`.
 */
export const HALF_ALONG_M: Partial<Record<SceneryKind, number>> = {
  house: 3.2,
  apartment: 6.8,
  sawmill: 16,
  battery: 15.2 * BATTERY_SIZE,
};

/** Half the width of a spot along the road, m: an apartment of one plot is as wide as a row house. */
export function halfAlongOf(spot: Pick<ScenerySpot, 'kind' | 'plots'>): number {
  if (spot.kind === 'apartment' && spot.plots === 1) return HALF_ALONG_M.house ?? 3.2;
  return HALF_ALONG_M[spot.kind] ?? 0;
}

/**
 * The apartment kind's variants, in the order of `models/scenery/sf-apartments`' roots (models.ts): Edwardian
 * flats and Mediterranean flats (one plot each), a bracketed apartment block and a six-storey mid-century
 * block (two plots), and the two handed corner buildings (two plots; `cornerL` is open on its -X side,
 * `cornerR` on its +X, with the windows and the door on that side). [default] (playtest 4, CX6)
 */
export const APARTMENT = { flatsA: 0, flatsB: 1, blockA: 2, blockB: 3, cornerL: 4, cornerR: 5 } as const;
/** How many 7 m plots each apartment variant takes. */
export const APARTMENT_PLOTS: readonly number[] = [1, 1, 2, 2, 2, 2];
/**
 * Of the plots of a terrace, the share that become each apartment kind. [default] A row-house terrace keeps
 * its row houses (about 8 plots in 10), with a taller building now and then: a flat in place of a house, a
 * block of two plots in place of two, and at the end of a run of houses, where the next plot is empty (a
 * cross street, a gap), a corner building turned to that gap more often than not.
 */
export const APARTMENT_RATE = { flats: 0.08, block: 0.07, corner: 0.2 } as const;
/**
 * How far its front stands ahead of its anchor, m, for a kind that reaches back from the anchor
 * (`DEPTH_M`) but whose anchor is not at its front (default 0: a house's anchor is its front wall).
 */
export const FRONT_M: Partial<Record<SceneryKind, number>> = { battery: 5.7 * BATTERY_SIZE };
/**
 * The file each headlands kind draws from, as the variant of `models/scenery/sf-headlands`: the roots in
 * order (models.ts `ROOTS`). The scatter sets them; they are no random pick.
 */
export const HEADLANDS_VARIANT: Readonly<Partial<Record<SceneryKind, number>>> = {
  battery: 0,
  brush: 1,
  outcrop: 2,
};
/**
 * How far from the end of a road that ends on a headlands hill its summit reaches, m (playtest 4, P4-19,
 * C2: Twin Peaks' last stretch, the figure-eight under the mast): the chert stands only this near the end.
 * [default]
 */
export const SUMMIT_REACH_M = 450;
/** Land a house or the sawmill keeps past each of its ends, m. [default] */
const LAND_LIP_M = 3;
/**
 * Playtest 4 run B (item 3): a house stands this far behind a pedestrian zone's or a board's far edge, m
 * [default], and one this near its ends along the road counts (the room features keep round them, road-mesh.ts).
 */
const ZONE_SETBACK_M = 0.3;
const ZONE_ROOM_M = 3;
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
  apartment: 6,
  // one root each: the scatter names the variant (`HEADLANDS_VARIANT`)
  battery: 1,
  brush: 1,
  outcrop: 1,
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

/** The middle of the water a network crosses, in the world (x, z), or null when it crosses none. */
export interface WaterCentre {
  x: number;
  z: number;
}

/**
 * The middle of the water a network crosses (playtest 4, P4-19, C2): the mean of the road's own samples
 * (every 25 m) over every stretch tagged `water-*`, in the baked road's own metres. The Golden Gate's is
 * the middle of its bridge, in the strait: the side of a Marin road that faces it is the Gate's side.
 * Null for a network with no water tag, which has no sea side at all.
 */
export function waterCentre(
  road: RoadNetwork,
  tagsOf: (edge: RoadNetwork['edges'][number]) => readonly SideTag[] | undefined,
): WaterCentre | null {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const e of road.edges) {
    for (const t of tagsOf(e) ?? []) {
      if (!t.tag.startsWith('water')) continue;
      const s1 = Math.min(t.s1, e.length);
      for (let s = Math.max(0, t.s0); s <= s1; s += WATER_STEP_M) {
        const p = road.toWorld(e.index, s, 0, 0);
        x += p.x;
        z += p.z;
        n++;
      }
    }
  }
  return n > 0 ? { x: x / n, z: z / n } : null;
}
/** Metres between the samples that locate the water's middle. */
const WATER_STEP_M = 25;
/** How squarely a side must face the water's middle to be its sea side: the cosine of the angle. [default] */
export const SEAWARD_COS = 0.4;

/**
 * Whether the given side of the road at (edge, s) faces the water's middle: its outward normal within
 * about 66 degrees of the line to it. A hairpin turns the road about, so the side that faces it changes
 * with s; a straight reach keeps it. False for a network with no water.
 */
export function facesWater(
  road: RoadNetwork,
  edge: number,
  side: -1 | 1,
  s: number,
  centre: WaterCentre | null,
): boolean {
  if (!centre) return false;
  const f = road.frameAt(edge, s);
  const qx = centre.x - f.x;
  const qz = centre.z - f.z;
  const far = Math.hypot(qx, qz);
  if (far < 1) return false;
  // The road's right (+d) is (-tz, tx) in the world; its left is the opposite.
  const nx = side > 0 ? -f.tz : f.tz;
  const nz = side > 0 ? f.tx : -f.tx;
  return (nx * qx + nz * qz) / far > SEAWARD_COS;
}

/**
 * How far past `outer` (a distance from the centre line, positive) the ridable band reaches at
 * (edge, s) on a side, m, or 0 (no band). Off-road (run W-R; interview, 2026-10-02: "Anywhere with
 * ground"): a tree, a pole, a shack or a mailbox stands at or past it, so nothing solid stands where a
 * rider rides; ferns and other understory may grow on it. Playtest 4 ("solid but forgiving"): a city
 * kerb and pavement is a ridable band too, so the same holds there; the street furniture that does
 * stand on a sidewalk is planned in road/furniture.ts, where the sim meets it (it was every loose band
 * only, and a sidewalk's props stood on it with nothing in the sim behind them).
 */
export function ridableBandPast(
  road: RoadNetwork,
  edge: number,
  side: -1 | 1,
  s: number,
  outer: number,
): number {
  const v = road.vergeAt(edge, s, side < 0 ? 'left' : 'right');
  if (v.widthM <= 0) return 0;
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
  /**
   * Whether a spot of this radius is free of roads, features and roadside zones (`zones` false: of roads
   * and the other features alone, for a building that stands behind the zones and boards, `zoneEdge`).
   */
  clear(s: number, d: number, radius: number, zones?: boolean): boolean;
  /**
   * The far edge of the pedestrian zones and boards on that side of the road between s0 and s1, m from the
   * centre line (0: none there). Playtest 4 run B: a house stands behind them. Absent: none anywhere.
   */
  zoneEdge?: ((side: -1 | 1, s0: number, s1: number) => number) | undefined;
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
  /**
   * Whether that side of the road at s faces the water the network crosses (playtest 4, P4-19, C2): the
   * side a headlands road's batteries stand on, covering the Gate. Absent: no side does, so a network
   * that crosses no water stands none.
   */
  seaward?: ((side: -1 | 1, s: number) => boolean) | undefined;
  /**
   * Whether s is within reach of the end of a road that ends here, the top of its hill
   * (`SUMMIT_REACH_M`): where the chert stands. Absent: nowhere.
   */
  summit?: ((s: number) => boolean) | undefined;
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
  'battery',
  'brush',
  'outcrop',
];
/** Kinds that face the road (their +Z turns toward the centre line). */
const FACES_ROAD = new Set<SceneryKind>(['shack', 'house', 'sawmill', 'battery']);

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
              : kind === 'brush'
                ? 0.8 + 0.6 * h(ki, k, side, 6)
                : kind === 'outcrop'
                  ? 0.8 + 0.45 * h(ki, k, side, 6)
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
  /**
   * Playtest 4, P4-19 (R3): a terrace of row houses gets taller buildings (CX6's apartment kit). It works on
   * the plots the houses took, so every check the houses passed (land under them, nothing of another road
   * or a feature near them) still holds; a building of two plots needs both plots to have a house, and is
   * checked again over its whole width. Three upgrades, in this order for each plot:
   *  - a corner building at the end of a run of houses (the plot beyond it, along the road, is empty: a cross
   *    street, a gap, the road's end): two plots, turned so its open side (the windows and the side door)
   *    faces that gap;
   *  - a block of two plots, in place of two row houses;
   *  - a flat, in place of one.
   */
  const upgradeTerrace = (side: -1 | 1, outer: number, houses: Map<number, ScenerySpot>): void => {
    const ai = SCENERY_KINDS.indexOf('apartment');
    const taken = new Set<number>();
    const gone = new Set<ScenerySpot>();
    const radius = SCENERY_RADIUS_M.apartment;
    const depth = DEPTH_M.apartment ?? 11.5;
    const along = HALF_ALONG_M.apartment ?? 6.8;
    /** A building's own place at s: its front stands where the houses' do, turned to the road. */
    const stand = (s: number, d: number, variant: number, plots: number): ScenerySpot | null => {
      const half = plots === 1 ? (HALF_ALONG_M.house ?? 3.2) : along;
      const across = Math.abs(d) - outer;
      // The land under it all the way along and back, and nothing near its ends and back.
      const reach = Math.min(
        e.landReach(side, s),
        e.landReach(side, s - half - LAND_LIP_M),
        e.landReach(side, s + half + LAND_LIP_M),
      );
      if (across + depth > reach) return null;
      const back = side * (outer + across + depth);
      // A building whose plots stand behind a pedestrian zone or a board stands behind it too (playtest 4 run B, item 3).
      const zoneFar = e.zoneEdge?.(side, s - half - ZONE_ROOM_M, s + half + ZONE_ROOM_M) ?? 0;
      const zones = !(zoneFar > 0 && Math.abs(d) + 1e-6 >= zoneFar + ZONE_SETBACK_M);
      if (
        !e.clear(s, back, radius, zones) ||
        !e.clear(s - half, d, radius, zones) ||
        !e.clear(s + half, d, radius, zones)
      )
        return null;
      const here = e.world(s, d, 0).y;
      const low = Math.min(here, e.world(s + half, d, 0).y, e.world(s - half, d, 0).y);
      return {
        kind: 'apartment',
        variant,
        p: e.world(s, d, LAND_TOP_M - (here - low + 0.15)),
        turn: turnToward(e.world(s, d, 0), e.world(s, 0, 0)),
        size: 1,
        phase: 0,
        edge: e.edge,
        s,
        d,
        plots,
      };
    };
    /** Which way along the road (+1: toward +s) the model's +X points for a building on this side. */
    const xAlong = (s: number, d: number): 1 | -1 => {
      const turn = turnToward(e.world(s, d, 0), e.world(s, 0, 0));
      const a = e.world(s, d, 0);
      const b = e.world(s + 1, d, 0);
      return Math.cos(turn) * (b.x - a.x) - Math.sin(turn) * (b.z - a.z) > 0 ? 1 : -1;
    };
    const ks = [...houses.keys()].sort((a, b) => a - b);
    const made: ScenerySpot[] = [];
    for (const k of ks) {
      if (taken.has(k)) continue;
      const here = houses.get(k) as ScenerySpot;
      const next = houses.get(k + 1);
      const pair = next !== undefined && !taken.has(k + 1) && Math.abs(next.d - here.d) < 0.3;
      const u = h(ai, k, side, 20);
      if (pair) {
        const sm = (here.s + next.s) / 2;
        // A run ends where the next plot has no house (or has been taken: that one is a building's).
        const endAfter = !houses.has(k + 2);
        const endBefore = !houses.has(k - 1);
        if ((endAfter || endBefore) && u < APARTMENT_RATE.corner) {
          // The end it opens on: toward the gap; both ends gap: the seed picks.
          const towardEnd: 1 | -1 = endAfter && (!endBefore || h(ai, k, side, 21) < 0.5) ? 1 : -1;
          const openX = towardEnd * xAlong(sm, here.d);
          const b = stand(sm, here.d, openX > 0 ? APARTMENT.cornerR : APARTMENT.cornerL, 2);
          if (b) {
            made.push(b);
            gone.add(here);
            gone.add(next);
            taken.add(k);
            taken.add(k + 1);
            continue;
          }
        } else if (h(ai, k, side, 25) < APARTMENT_RATE.block) {
          const b = stand(sm, here.d, h(ai, k, side, 22) < 0.5 ? APARTMENT.blockA : APARTMENT.blockB, 2);
          if (b) {
            made.push(b);
            gone.add(here);
            gone.add(next);
            taken.add(k);
            taken.add(k + 1);
            continue;
          }
        }
      }
      // A flat in the house's own place: same footprint, taller.
      if (h(ai, k, side, 23) < APARTMENT_RATE.flats) {
        made.push({
          ...here,
          kind: 'apartment',
          variant: h(ai, k, side, 24) < 0.5 ? APARTMENT.flatsA : APARTMENT.flatsB,
          plots: 1,
        });
        gone.add(here);
        taken.add(k);
      }
    }
    if (gone.size === 0) return;
    for (let i = out.length - 1; i >= 0; i--) if (gone.has(out[i] as ScenerySpot)) out.splice(i, 1);
    out.push(...made);
  };
  // The poles run down one side of the road, chosen by the seed.
  const poleSide: -1 | 1 = h(99, 0, 0, 1) < 0.5 ? -1 : 1;
  for (const side of [-1, 1] as const) {
    const outer = e.outer(side);
    /** This side's row houses by plot (the k of their spacing), for the terrace's taller buildings. */
    const houses = new Map<number, ScenerySpot>();
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
        // The headlands' marks (playtest 4, P4-19, C2): a battery covers the water, the chert is the top.
        if (kind === 'battery' && !e.seaward?.(side, s)) continue;
        if (kind === 'outcrop' && !e.summit?.(s)) continue;
        if (kind !== 'pole' && h(ki, k, side, 1) >= (RATE[theme][kind] ?? 0)) continue;
        const [ownNear, spread] = ACROSS_M[kind];
        // Some land keeps its trees back (a rock cut's firs stand behind it, playtest 4, P4-19, C4).
        const near = Math.max(ownNear, kind === 'pole' ? 0 : (THEME_NEAR_M[theme] ?? 0));
        const radius = SCENERY_RADIUS_M[kind];
        // Off-road (run W-R): its footprint past the ridable band (a house or the sawmill by its front).
        const solid = DEPTH_M[kind] !== undefined ? (FRONT_M[kind] ?? 0) : (TRUNK_M[kind] ?? radius);
        const clearOf = e.band ? e.band(side, s) + solid : 0;
        const depth = DEPTH_M[kind] ?? radius;
        const along = Math.max(radius, HALF_ALONG_M[kind] ?? 0);
        const own = near + spread * h(ki, k, side, 2);
        // Playtest 4 run B (item 3: "one side of California Street and part of Hyde Street as open lawn"):
        // a pedestrian zone or a board on a city street's sidewalk covers the house fronts' line, and
        // cleared the terrace for 40 to 100 m. A house there now stands behind it, the people or the board
        // in front.
        const zoneFar =
          kind === 'house' && e.zoneEdge
            ? e.zoneEdge(side, s - along - ZONE_ROOM_M, s + along + ZONE_ROOM_M)
            : 0;
        const behindZone = zoneFar > 0 && zoneFar + ZONE_SETBACK_M - outer > own;
        const wanted = behindZone ? zoneFar + ZONE_SETBACK_M - outer : own;
        /** Whether pedestrian zones and boards keep this spot clear (not when it stands behind them). */
        const zones = !behindZone;
        const across = Math.max(wanted, clearOf);
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
        if (!e.clear(s, d, radius, zones)) continue;
        // Moved out past the band, it is still the spot it was: one that was blocked where it wanted
        // to stand (a sign, a pad, a pedestrian zone) stays out, so the band only moves scenery, and
        // one the move would carry into the next instanced batch is dropped (no draw call is added).
        if (across !== wanted) {
          const was = side * (outer + wanted);
          if (!e.clear(s, was, radius, zones)) continue;
          if (e.sameBatch && !e.sameBatch(e.world(s, was, 0), e.world(s, d, 0))) continue;
        }
        if (DEPTH_M[kind] !== undefined) {
          // A house or the sawmill reaches back from its front and along the road: all of it clear.
          const back = side * (outer + across + depth);
          if (
            !e.clear(s, back, radius, zones) ||
            !e.clear(s - along, d, radius, zones) ||
            !e.clear(s + along, d, radius, zones)
          )
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
        if (kind === 'house' || kind === 'sawmill' || kind === 'battery') {
          const here = e.world(s, d, 0).y;
          const low = Math.min(here, e.world(s + along, d, 0).y, e.world(s - along, d, 0).y);
          y -= here - low + 0.15;
        }
        place(
          kind,
          s,
          d,
          y,
          turn,
          k,
          side,
          HEADLANDS_VARIANT[kind],
          kind === 'battery' ? BATTERY_SIZE : undefined,
        );
        // A battery is longer than a merged block's default room: its culling counts all of its length.
        if (kind === 'battery')
          (out[out.length - 1] as ScenerySpot).reachM = Math.ceil(HALF_ALONG_M.battery ?? 0) + 1;
        if (kind === 'house') houses.set(k, out[out.length - 1] as ScenerySpot);
      }
    }
    if (houses.size > 0) upgradeTerrace(side, outer, houses);
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
