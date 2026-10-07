// San Francisco's downtown (run W-R; interview, 2026-10-02: "SF first = downtown towers": a four-lane
// avenue between invented AI-startup towers, intersections with cross traffic, cable cars ONLY on the
// steep cable-line cross streets; playtest 2, 2026-10-02: "I expected some city feeling not just all
// row houses", and the cable cars that drove "including in forests"). This layer draws what stands
// on the downtown network's tagged land (src/render/scenery.ts's `downtown`, `plaza` and `crossing`
// themes; the road scene draws the land itself):
//
// - the towers (playtest 3, T12.4: CX3's stackable modules, a base, four-storey mids and a crown
//   stacked to the height wanted, never stretched, so a window keeps its shape), shoulder to shoulder
//   behind a 3.4 m sidewalk (the sim's hard edge, road/cross-section.ts: 4 m past the shoulder), a taller
//   second row behind them, towers behind each plaza, and the deadpan headquarters behind the last plaza;
// - the sidewalks and the plaza paving, the lamps, the planters, benches and the orb, and the
//   San Francisco kit's scooters, hydrants and A-frame AI boards on the sidewalks;
// - each block's cross street: its roadway running off both sides, a signal on its far corner each
//   way, zebra crossings and stop lines on the avenue, buildings lining it, and its traffic;
// - the steep cable-car streets (`cable-crossing`): the street climbs the hill on the avenue's left,
//   its slot rails run across the avenue, and a cable car rides it. Nowhere else does one run.
// - a city floor under it all, out to CITY_FLOOR_M, so no sea shows between the blocks.
//
// Playtest 3 (T12.6) adds downtown Portland's blocks to this layer: a `pdx-blocks` side gets a front
// row of Codex CX4's cast-iron fronts, brick lofts, office blocks and pink towers (`planPortland`), a
// cross street every block, bike racks, and a pod of food carts where a pedestrian zone says so. They
// stand on the land the road scene drew and keep clear of every road, feature and building; the
// stretches draw exactly as San Francisco's do (one mesh each, the Pacific Northwest atlas as its map),
// and the carts' name boards are text surfaces whose words are pack signs (text-surfaces.ts).
//
// Where every building, cart and rack stands is the road's (the physical world, the maintainer,
// 2026-10-06: "consistent physics and gameplay is important here so players know what to expect and how
// to interact with the world"): road/structures/downtown.ts plans them from the network and the seed, the
// structure plan holds each as a solid at its drawn shape, and this layer draws them from that plan
// (scripts/hitboxes.test.ts holds drawn to planned; downtown-main.test.ts holds the picture to what it was
// before the move). The sidewalks, the paving, the cross streets and their traffic stay this layer's.
//
// The cross traffic and the cable cars are presentation only, like everything in render: the sim
// never sees them. So they never cross the avenue while a racer or a traffic vehicle is within
// their clearance of the crossing (`crossingNeed`: what a racer at top speed covers while they cross,
// and a margin): they wait at the stop line (a red light for them, a green one for you) and go once
// the avenue is clear. Nothing ever passes through a rider.
//
// Drawing (the phone's budget): the static parts of one STRETCH_M stretch of road, both sides,
// are merged into one vertex-coloured mesh, built when the camera comes near and freed when it has
// gone (one draw per stretch in sight). With the modules, that mesh's material has the San Francisco
// atlas as its map (the stretch's other parts sit on the atlas's white tile): still one draw. The moving vehicles are one instanced mesh per model. This
// is a lazy chunk: it loads with the downtown's models, never in the first load.
import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { planStreetFurniture, type RoadNetwork, type StructureSpec } from '../road';
import {
  CITY_FLOOR_Y,
  CROSS_REACH_M,
  crossProfile,
  MODULE_M,
  MODULE_STYLE,
  PDX,
  PLAZA_M,
  planPdxDowntown,
  planSfDowntown,
  SIDEWALK_M,
  towerFootprint,
  type Crossing,
} from '../road/structures/downtown';
import type { Point3 } from './geometry';
import type { LookStyle } from './look';
import type { SceneryModel } from './models';
import type { RoadDressing } from './road-mesh';
import { LAND_TOP_M, scatterHash, themeAt, type SideTag, type SideTheme } from './scenery';
import { ATLAS_WHITE_UV, formsOf, hasAtlasUv } from './scenery-merge';
import { placeSurface, type PlacedSurface } from './text-surfaces';

// The placement's own names, from the road (road/structures/downtown.ts), for this layer's tests and callers.
export {
  CABLE_GRADE,
  CITY_FLOOR_Y,
  CROSS_REACH_M,
  crossProfile,
  DT,
  LOT_LAND_TOP_M,
  MODULE_M,
  PDX,
  PDX_BACK_ROW_M,
  PDX_BLOCK_M,
  PDX_CART_BACK_M,
  PDX_CART_PITCH_M,
  PDX_OVERHANG_M,
  PDX_PODS,
  PDX_ROAD_CLEAR_M,
  PDX_SINK_M,
  PDX_STREET_M,
  PLAZA_M,
  rectOf,
  rectsOverlap,
  roadCuts,
  SIDEWALK_M,
  towerFootprint,
} from '../road/structures/downtown';
export type { Crossing, DowntownLot, Rect } from '../road/structures/downtown';

/** The San Francisco roadside kit's variants this layer borrows (roadside.ts SF_KIT's list). */
export const SF_PROPS = {
  sedan: 0,
  hatch: 1,
  robotaxi: 2,
  hydrant: 4,
  scooter: 5,
  boards: [6, 7, 8],
} as const;

/** The verge past the drawn shoulder (road-mesh.ts VERGE_M). */
const VERGE_M = 0.6;
// The lamps and planters along a sidewalk are road/furniture.ts's now (DT_LAMP_EVERY_M).
/** Cross streets: their roadway's half width, a lane's offset, m. */
const CROSS_ROAD_HALF_M = 5.5;
const CROSS_LANE_M = 2.75;
/** The road scene's land strip past the verge (road-mesh.ts SCENERY_LAND_M). */
const LAND_STRIP_M = 24;
/**
 * Cross traffic waits while anything on the avenue is nearer the crossing than the vehicle's own
 * clearance: CROSS_CLEAR_M plus the distance a racer at RACER_TOP_MPS covers while the vehicle
 * crosses the avenue (about 230 m for a car, 400 m for the slower cable car). [default]
 */
export const CROSS_CLEAR_M = 60;
/** The fastest a racer goes: the starter bike's 44.7 m/s top speed and a boost pad's 8 m/s. */
export const RACER_TOP_MPS = 53;
const CROSS_CAR_MPS = 9;
const CABLE_CAR_MPS = 4.5;
/** A waiting car's centre stands this far past the verge's outer edge, m (its stop line just ahead). */
export const STOP_BACK_M = 2.8;
/** A queued car keeps this far behind the one ahead, m. */
const QUEUE_GAP_M = 7;
/** The city floor's reach past the land strip, m (its height is the road's CITY_FLOOR_Y). */
export const CITY_FLOOR_M = 300;
/** Static geometry is merged per stretch of road this long, m. [default] */
export const STRETCH_M = 160;
/** Drawn out to this far (the foggy region's haze is full at 480 m), m. [default] */
export const DOWNTOWN_DRAW_M = 500;
const PREFETCH_M = 120;
const KEEP_M = DOWNTOWN_DRAW_M + 200;

/** Flat colours of the layer's own surfaces. [default] */
export const DOWNTOWN_COLOURS = {
  sidewalk: '#aaa7a0',
  plaza: '#bcb5a6',
  kerb: '#d6d2c8',
  street: '#4a4b50',
  zebra: '#ece9e1',
  yellow: '#e7c14a',
  slot: '#5b5e63',
  floor: '#8f918c',
  wall: '#9f9686',
} as const;

/**
 * One placed model: a variant of the kit (or of the borrowed SF props) at a world point, or a stacked
 * tower (`model: 'tower'`: `variant` is the kit variant it stands in for, which picks its module
 * style; `mids` is how many mids it stacks). A building, cart or rack carries the structure it is
 * (`solid`, from the road's plan); the street furniture's pieces are road/furniture.ts's.
 */
export interface DowntownItem {
  model: 'kit' | 'props' | 'tower';
  variant: number;
  rule: string;
  p: Point3;
  /** Turn about the vertical (the model's +Z goes to (sin, cos) in x, z). */
  turn: number;
  /** Height scale, 1 for everything the layer places today (a stacked tower is never stretched). */
  sy: number;
  /** A stacked tower: how many four-storey mids, and the height it was asked to be, m. */
  mids?: number;
  targetM?: number;
  /** World y its base is pushed down to (a tower's foot under the slope), or null. */
  foot: number | null;
  edge: number;
  s: number;
  d: number;
  /** The structure it is (road/structures/downtown.ts), for a building, a cart or a rack. */
  solid?: StructureSpec;
}

/** A coloured triangle soup (three vertices per triangle), for the merged stretches. */
interface Soup {
  pos: number[];
  col: number[];
}

/** The plan: everything static, by stretch, and the crossings. Pure placement (tests read it). */
export interface DowntownPlan {
  items: DowntownItem[];
  crossings: Crossing[];
  /** Static surfaces per stretch key (`edge:index`). */
  soups: Map<string, Soup>;
  /** Stretch keys in build order, with their centre and radius on the ground. */
  stretches: { key: string; cx: number; cz: number; radius: number }[];
}

export interface DowntownInput {
  road: RoadNetwork;
  dressing: RoadDressing | undefined;
  seed: number;
  /**
   * Downtown Portland (playtest 3, T12.6): draw the blocks of the `pdx-blocks` sides from CX4's kit (the
   * layer's `kit`), on the land the road scene draws (road/land.ts, its strip rule).
   */
  portland?: boolean;
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Whether the network has a downtown at all (any downtown tag). */
export function hasDowntown(tags: ReadonlySet<string>): boolean {
  return ['towers', 'plaza', 'cross-street', 'cable-crossing'].some((t) => tags.has(t));
}

/** Whether the network has Portland's blocks (the `pdx-blocks` tag): the Pacific Northwest's own downtown. */
export function hasPortland(tags: ReadonlySet<string>): boolean {
  return tags.has('pdx-blocks');
}

/** Plans the downtown of a network: the road's towers and crossings, furniture, cross streets and the floor. */
export function planDowntown(input: DowntownInput): DowntownPlan {
  const { road, dressing, seed } = input;
  const { lots, crossings } = planSfDowntown(road, seed);
  const { soupAt, quad, place, note, finish } = planner();

  for (const e of road.edges) {
    const dress = dressing?.[e.id];
    const tags = (dress?.tags ?? e.tags) as readonly SideTag[] | undefined;
    if (!tags?.some((t) => ['towers', 'plaza', 'cross-street', 'cable-crossing'].includes(t.tag))) continue;
    const outerOf = (side: -1 | 1) => (side < 0 ? -e.dMin : e.dMax) + VERGE_M;
    const theme = (side: -1 | 1, s: number): SideTheme => themeAt(tags, side < 0 ? 'left' : 'right', s);
    const w = (s: number, d: number, hgt: number) => road.toWorld(e.index, s, d, hgt);
    /** The runs of s where a side's theme is `want`, at 2 m steps: [start, end] pairs. */
    const runs = (side: -1 | 1, want: SideTheme): [number, number][] => {
      const out: [number, number][] = [];
      let start = -1;
      for (let s = 0; s <= e.length + 1e-6; s += 2) {
        const here = theme(side, Math.min(s, e.length)) === want;
        if (here && start < 0) start = s;
        if ((!here || s + 2 > e.length + 1e-6) && start >= 0) {
          out.push([start, here ? e.length : s - 2]);
          start = -1;
        }
      }
      return out;
    };

    for (const side of [-1, 1] as const) {
      const outer = outerOf(side);
      // Sidewalks and plaza paving.
      for (const [want, reach, colour] of [
        ['downtown', SIDEWALK_M, DOWNTOWN_COLOURS.sidewalk],
        ['plaza', PLAZA_M, DOWNTOWN_COLOURS.plaza],
      ] as const) {
        for (const [a, b] of runs(side, want)) {
          for (let s = a; s < b; s += 4) {
            const s1 = Math.min(b, s + 4);
            const soup = soupAt(e.index, s);
            const n0 = w(s, side * outer, 0.03);
            const n1 = w(s1, side * outer, 0.03);
            const f0 = w(s, side * (outer + reach), 0.03);
            const f1 = w(s1, side * (outer + reach), 0.03);
            if (side > 0) quad(soup, n0, f0, n1, f1, colour);
            else quad(soup, f0, n0, f1, n1, colour);
          }
        }
      }
      // The towers, the second row and the headquarters stand where the road's plan puts them (below).
      // The street furniture (lamps, a planter, hydrant, scooter or board between each two, the plaza's
      // benches, planters and orb) stands where road/furniture.ts plans it, after this edge's sides
      // (playtest 4, "solid but forgiving": the sim meets what is drawn).
      // The city floor: from the land strip's edge out to CITY_FLOOR_M, every 20 m.
      for (let s = 0; s < e.length; s += 20) {
        const s1 = Math.min(e.length, s + 20);
        const soup = soupAt(e.index, s);
        const at = (u: number, d: number) => ({ ...w(u, side * d, 0), y: CITY_FLOOR_Y });
        const n0 = at(s, outer + LAND_STRIP_M);
        const n1 = at(s1, outer + LAND_STRIP_M);
        const f0 = at(s, outer + LAND_STRIP_M + CITY_FLOOR_M);
        const f1 = at(s1, outer + LAND_STRIP_M + CITY_FLOOR_M);
        if (side > 0) quad(soup, n0, f0, n1, f1, DOWNTOWN_COLOURS.floor);
        else quad(soup, f0, n0, f1, n1, DOWNTOWN_COLOURS.floor);
      }
    }
  }
  // Each crossing: its roadway both ways, the zebras and stop lines on the avenue, the signals and the
  // cable slots (the buildings lining it are the road's, below).
  for (const c of crossings) {
    const e = road.edges[c.edge];
    if (!e) continue;
    const soup = soupAt(c.edge, c.s);
    const roadY = c.roadY;
    const at = (u: number, v: number, lift = 0): Point3 => ({
      x: c.centre.x + c.across.x * u + c.along.x * v,
      y: crossProfile(c, roadY, u) + lift,
      z: c.centre.z + c.across.z * u + c.along.z * v,
    });
    const STEP = 8;
    for (const sign of [-1, 1] as const) {
      // The roadway, its sidewalks and its centre line, from the verge out.
      for (let u = c.outer; u < c.outer + CROSS_REACH_M; u += STEP) {
        const u0 = sign * u;
        const u1 = sign * Math.min(c.outer + CROSS_REACH_M, u + STEP);
        const strip = (v0: number, v1: number, lift: number, colour: string) => {
          const a = at(u0, v0, lift);
          const b = at(u0, v1, lift);
          const cc = at(u1, v0, lift);
          const dd = at(u1, v1, lift);
          // Faces up whichever way u runs.
          if (sign > 0) quad(soup, a, cc, b, dd, colour);
          else quad(soup, cc, a, dd, b, colour);
        };
        strip(-CROSS_ROAD_HALF_M, CROSS_ROAD_HALF_M, 0.04, DOWNTOWN_COLOURS.street);
        strip(-c.half, -CROSS_ROAD_HALF_M, 0.08, DOWNTOWN_COLOURS.sidewalk);
        strip(CROSS_ROAD_HALF_M, c.half, 0.08, DOWNTOWN_COLOURS.sidewalk);
        strip(-0.25, -0.1, 0.06, DOWNTOWN_COLOURS.yellow);
        strip(0.1, 0.25, 0.06, DOWNTOWN_COLOURS.yellow);
        if (c.cable) {
          for (const lane of [-CROSS_LANE_M, CROSS_LANE_M])
            for (const r of [-0.55, 0.55])
              strip(lane + r - 0.05, lane + r + 0.05, 0.065, DOWNTOWN_COLOURS.slot);
        }
        // Up the hill, the street stands on walls down to the floor.
        if (c.cable && sign < 0) {
          for (const v of [-c.half, c.half]) {
            const top0 = at(u0, v, 0.08);
            const top1 = at(u1, v, 0.08);
            const bot0 = { ...top0, y: CITY_FLOOR_Y - 0.5 };
            const bot1 = { ...top1, y: CITY_FLOOR_Y - 0.5 };
            quad(soup, top0, bot0, top1, bot1, DOWNTOWN_COLOURS.wall, false);
            quad(soup, top1, bot1, top0, bot0, DOWNTOWN_COLOURS.wall, false);
          }
        }
      }
      // Its stop line, across its approach half, a car's length short of the avenue.
      {
        const u = sign * (c.outer + 1.2);
        const v0 = sign > 0 ? 0 : -CROSS_ROAD_HALF_M;
        const v1 = sign > 0 ? CROSS_ROAD_HALF_M : 0;
        const a = at(u, v0, 0.07);
        const b = at(u, v1, 0.07);
        const cc = at(u + sign * 0.5, v0, 0.07);
        const dd = at(u + sign * 0.5, v1, 0.07);
        if (sign > 0) quad(soup, a, cc, b, dd, DOWNTOWN_COLOURS.zebra);
        else quad(soup, cc, a, dd, b, DOWNTOWN_COLOURS.zebra);
      }
    }
    // On the avenue: a zebra on each side of the cross street, the stop lines before it, and the
    // cable slots across.
    const ws = (s: number, d: number) => road.toWorld(c.edge, s, d, 0.035);
    for (const s0 of [c.s - c.half + 1, c.s + c.half - 4]) {
      for (let d = -c.outer + 1; d + 0.6 <= c.outer - 1; d += 1.3) {
        quad(soup, ws(s0, d), ws(s0, d + 0.6), ws(s0 + 3, d), ws(s0 + 3, d + 0.6), DOWNTOWN_COLOURS.zebra);
      }
    }
    const dEdge = c.outer - VERGE_M;
    // Riders travelling +s stop on the right half before it, the other way on the left half after it.
    quad(
      soup,
      ws(c.s - c.half - 1.5, 0),
      ws(c.s - c.half - 1.5, dEdge),
      ws(c.s - c.half - 1, 0),
      ws(c.s - c.half - 1, dEdge),
      DOWNTOWN_COLOURS.zebra,
    );
    quad(
      soup,
      ws(c.s + c.half + 1, -dEdge),
      ws(c.s + c.half + 1, 0),
      ws(c.s + c.half + 1.5, -dEdge),
      ws(c.s + c.half + 1.5, 0),
      DOWNTOWN_COLOURS.zebra,
    );
    if (c.cable) {
      for (const lane of [-CROSS_LANE_M, CROSS_LANE_M])
        for (const r of [-0.55, 0.55]) {
          const v = lane + r;
          const a = at(-c.outer, v - 0.05, 0.036);
          const b = at(-c.outer, v + 0.05, 0.036);
          const cc = at(c.outer, v - 0.05, 0.036);
          const dd = at(c.outer, v + 0.05, 0.036);
          quad(soup, a, cc, b, dd, DOWNTOWN_COLOURS.slot);
        }
    }
    // The signals (one on the far right corner for each way along the avenue) are in the plan below.
    note(c.edge, c.s, at(-c.outer - CROSS_REACH_M, 0));
    note(c.edge, c.s, at(c.outer + CROSS_REACH_M, 0));
  }

  // The buildings: the front row, the plaza towers, the headquarters, the second row and the buildings
  // lining the cross streets, where the road's plan stands them (road/structures/downtown.ts).
  for (const lot of lots) place(lot);

  // The street furniture, from the plan the sim meets (road/furniture.ts, playtest 4: "solid but
  // forgiving"): the same rules this layer had, moved there unchanged.
  for (const it of planStreetFurniture(road, seed).items) {
    if (it.layer !== 'downtown') continue;
    const e = road.edges[it.edge];
    if (!e) continue;
    const p = road.toWorld(it.edge, Math.max(0, Math.min(e.length, it.s)), it.d, LAND_TOP_M);
    let turn: number;
    if ('yaw' in it.turn) turn = it.turn.yaw;
    else if ('face' in it.turn) {
      const c = road.toWorld(it.edge, it.s, 0, 0);
      turn = Math.atan2(c.x - p.x, c.z - p.z) + it.turn.face;
    } else {
      // A signal faces the riders coming (along -way), its arm (the model's -X) over the road.
      const f = road.toWorld(it.edge, Math.min(e.length, it.s + 1), 0, 0);
      const b = road.toWorld(it.edge, Math.max(0, it.s - 1), 0, 0);
      const fl = Math.hypot(f.x - b.x, f.z - b.z) || 1;
      turn = Math.atan2((-it.turn.along * (f.x - b.x)) / fl, (-it.turn.along * (f.z - b.z)) / fl);
    }
    const props = it.kind === 'hydrant' || it.kind === 'scooter' || it.kind === 'board';
    place({
      model: props ? 'props' : 'kit',
      variant: it.variant,
      rule: it.rule,
      p,
      turn,
      sy: 1,
      foot: null,
      edge: it.edge,
      s: it.s,
      d: it.d,
    });
  }

  return finish(crossings, CITY_FLOOR_M + 80);
}

/** The width and depth of one of the loaded kit's buildings, m: its bounding box (the front is at z = 0). */
export function pdxFootprint(kit: SceneryModel, variant: number): readonly [number, number] {
  const g = kit.variants[variant];
  if (!g) return [0, 0];
  if (!g.boundingBox) g.computeBoundingBox();
  const b = g.boundingBox;
  return b ? [b.max.x - b.min.x, Math.max(0, -b.min.z)] : [0, 0];
}

/**
 * Downtown Portland's blocks (playtest 3, T12.6; wave B's punch list, item 3): on every `pdx-blocks` side
 * of the road, the road's plan (road/structures/downtown.ts `planPdxDowntown`) of CX4's cast-iron fronts,
 * brick lofts, office blocks and pink towers, the second row, the fronts closing each cross street, the
 * bike racks and the food carts; this layer paves the sidewalk and the lot behind it and lays each cross
 * street's asphalt, where the plan says. Pure placement (tests read it).
 */
export function planPortland(input: DowntownInput): DowntownPlan {
  const { road, seed } = input;
  const { lots, paving, streets } = planPdxDowntown(road, seed);
  const { soupAt, quad, place, finish } = planner();
  const outerOf = (edge: number, side: -1 | 1) => {
    const e = road.edges[edge];
    return e ? (side < 0 ? -e.dMin : e.dMax) + VERGE_M : 0;
  };
  // The paving: a sidewalk past the verge, and the lot behind it out to the land's edge.
  for (const g of paving) {
    const outer = outerOf(g.edge, g.side);
    const w = (s: number, d: number) => road.toWorld(g.edge, s, g.side * d, 0.03);
    const soup = soupAt(g.edge, g.s0);
    const walk = Math.min(g.reach, SIDEWALK_M);
    const n0 = w(g.s0, outer);
    const n1 = w(g.s1, outer);
    const m0 = w(g.s0, outer + walk);
    const m1 = w(g.s1, outer + walk);
    const f0 = w(g.s0, outer + g.reach);
    const f1 = w(g.s1, outer + g.reach);
    const face = (p: Point3, q: Point3, p1: Point3, q1: Point3, colour: string) =>
      g.side > 0 ? quad(soup, p, q, p1, q1, colour) : quad(soup, q, p, q1, p1, colour);
    face(n0, m0, n1, m1, DOWNTOWN_COLOURS.sidewalk);
    if (g.reach > walk) face(m0, f0, m1, f1, DOWNTOWN_COLOURS.floor);
  }
  // Each cross street: its asphalt from the verge out across the land.
  for (const g of streets) {
    const outer = outerOf(g.edge, g.side);
    const w = (s: number, d: number) => road.toWorld(g.edge, s, g.side * d, 0.05);
    const soup = soupAt(g.edge, g.s0);
    const n0 = w(g.s0, outer);
    const n1 = w(g.s1, outer);
    const f0 = w(g.s0, outer + g.reach);
    const f1 = w(g.s1, outer + g.reach);
    if (g.side > 0) quad(soup, n0, f0, n1, f1, DOWNTOWN_COLOURS.street);
    else quad(soup, f0, n0, f1, n1, DOWNTOWN_COLOURS.street);
  }
  for (const lot of lots) place(lot);
  return finish([], STRETCH_M + 40);
}

/**
 * What both cities' plans build with: the placed items, the merged surfaces by stretch of road, and
 * each stretch's extent (`finish`, which gives a stretch that has only surfaces `reachM` of room).
 */
function planner() {
  const items: DowntownItem[] = [];
  const soups = new Map<string, Soup>();
  const centres = new Map<string, { xs: number; zs: number; n: number; pts: Point3[] }>();
  const keyOf = (edge: number, s: number) => `${edge}:${Math.floor(Math.max(0, s) / STRETCH_M)}`;
  const soupAt = (edge: number, s: number): Soup => {
    const key = keyOf(edge, s);
    let soup = soups.get(key);
    if (!soup) {
      soup = { pos: [], col: [] };
      soups.set(key, soup);
    }
    return soup;
  };
  const note = (edge: number, s: number, p: Point3) => {
    const key = keyOf(edge, s);
    const c = centres.get(key) ?? { xs: 0, zs: 0, n: 0, pts: [] };
    c.xs += p.x;
    c.zs += p.z;
    c.n++;
    c.pts.push(p);
    centres.set(key, c);
  };
  /** A triangle; a flat one is turned to face up (the surfaces are seen from above). */
  const tri = (soup: Soup, a: Point3, b: Point3, c: Point3, colour: string, up = true) => {
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (up && ny < 0) [b, c] = [c, b];
    soup.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const [r, g, bl] = hex(colour);
    for (let i = 0; i < 3; i++) soup.col.push(r, g, bl);
  };
  /** A quad: a, b one edge and c, d the opposite one (a beside c), faced up unless `up` is false. */
  const quad = (soup: Soup, a: Point3, b: Point3, c: Point3, d: Point3, colour: string, up = true) => {
    tri(soup, a, c, b, colour, up);
    tri(soup, b, c, d, colour, up);
  };
  const place = (it: DowntownItem) => {
    items.push(it);
    note(it.edge, it.s, it.p);
  };
  const finish = (crossings: Crossing[], reachM: number): DowntownPlan => {
    const stretches = [...centres.entries()].map(([key, c]) => {
      const cx = c.xs / c.n;
      const cz = c.zs / c.n;
      const radius = Math.max(...c.pts.map((p) => Math.hypot(p.x - cx, p.z - cz))) + 40;
      return { key, cx, cz, radius };
    });
    for (const key of soups.keys()) {
      if (centres.has(key)) continue;
      const s = soups.get(key);
      if (!s || s.pos.length < 3) continue;
      let xs = 0;
      let zs = 0;
      const n = s.pos.length / 3;
      for (let i = 0; i < n; i++) {
        xs += s.pos[i * 3] ?? 0;
        zs += s.pos[i * 3 + 2] ?? 0;
      }
      stretches.push({ key, cx: xs / n, cz: zs / n, radius: reachM });
    }
    return { items, crossings, soups, stretches };
  };
  return { items, soups, soupAt, tri, quad, place, note, finish };
}

/**
 * One drawn part of an item: a geometry, the height it stands at over the item's base, its vertical
 * scale, whether its bottom is pushed down to the item's foot, and (only for a tower stretched from the
 * old kit when the modules have not loaded) a scale and offset across it in its own frame.
 */
interface Part {
  g: BufferGeometry;
  lift: number;
  sy: number;
  sink: boolean;
  sx?: number;
  sz?: number;
  ox?: number;
  oz?: number;
}

/** Places vertex i of a part's positions `gp` in the world, into `out` at vertex `o`. */
function placeVertex(
  it: DowntownItem,
  part: Part,
  gp: ArrayLike<number>,
  i: number,
  out: Float32Array,
  o: number,
) {
  const cos = Math.cos(it.turn);
  const sin = Math.sin(it.turn);
  const x = (part.ox ?? 0) + (gp[i * 3] ?? 0) * (part.sx ?? 1);
  const y = gp[i * 3 + 1] ?? 0;
  const z = (part.oz ?? 0) + (gp[i * 3 + 2] ?? 0) * (part.sz ?? 1);
  out[o * 3] = it.p.x + x * cos + z * sin;
  // A tower's foot reaches down under the slope; the rest scales with its height (a stacked tower's
  // modules stand at their heights, unscaled).
  out[o * 3 + 1] = part.sink && it.foot !== null && y < 0.01 ? it.foot : it.p.y + part.lift + y * part.sy;
  out[o * 3 + 2] = it.p.z + z * cos - x * sin;
}

/** One moving vehicle on a cross street. */
export interface CrossVehicle {
  crossing: number;
  kind: 'car' | 'cable';
  variant: number;
  /** Its lane across the cross street (v), and which way it runs along u (+1 toward +d). */
  v: number;
  dir: 1 | -1;
  /** Where it is along the cross street, signed (toward +d), m. */
  u: number;
  speed: number;
}

/** A mover the gate keeps clear of: a racer or a traffic vehicle on the avenue. */
export interface GateMover {
  x: number;
  z: number;
}

/** How far the nearest mover is from a crossing, m (Infinity with none). */
export function crossingClear(c: Pick<Crossing, 'centre'>, movers: readonly GateMover[]): number {
  let best = Infinity;
  for (const m of movers) best = Math.min(best, Math.hypot(m.x - c.centre.x, m.z - c.centre.z));
  return best;
}

/** The clearance a vehicle needs before it starts across the avenue, m. */
export function crossingNeed(c: Pick<Crossing, 'outer'>, speed: number): number {
  const across = 2 * (c.outer + STOP_BACK_M) + 1;
  return CROSS_CLEAR_M + (RACER_TOP_MPS * across) / Math.max(0.5, speed);
}

/** The cross traffic: each crossing's cars both ways, and a cable car on each cable street. */
export function seedCrossTraffic(crossings: readonly Crossing[], seed: number): CrossVehicle[] {
  const out: CrossVehicle[] = [];
  crossings.forEach((c, i) => {
    const h = (k: number) => scatterHash(seed, 8803 + i * 17, k, 3);
    const reach = c.outer + CROSS_REACH_M;
    for (const dir of [1, -1] as const) {
      const v = dir * -CROSS_LANE_M;
      const cars = c.cable ? 1 : 2;
      for (let k = 0; k < cars; k++) {
        const pick = h(k * 2 + (dir > 0 ? 0 : 1));
        out.push({
          crossing: i,
          kind: 'car',
          variant: pick < 0.45 ? SF_PROPS.sedan : pick < 0.75 ? SF_PROPS.hatch : SF_PROPS.robotaxi,
          v,
          dir,
          u: -dir * reach * (0.15 + 0.7 * ((k + h(k + 9)) / cars)),
          speed: CROSS_CAR_MPS * (0.85 + 0.3 * h(k + 20)),
        });
      }
    }
    if (c.cable) {
      const dir: 1 | -1 = h(40) < 0.5 ? 1 : -1;
      out.push({
        crossing: i,
        kind: 'cable',
        variant: 0,
        v: dir * -CROSS_LANE_M,
        dir,
        u: -dir * reach * 0.5,
        speed: CABLE_CAR_MPS,
      });
    }
  });
  return out;
}

/**
 * Moves the cross traffic by dt seconds. Each vehicle runs along its cross street; one that has
 * not yet reached the avenue stops at its stop line (or behind the one queued ahead of it) while
 * the crossing is closed, and one already on the avenue goes on. Past the far end it comes round
 * again from the near end. Returns how many are waiting.
 */
export function stepCrossTraffic(
  vehicles: CrossVehicle[],
  crossings: readonly Crossing[],
  clearM: readonly number[],
  dt: number,
): number {
  let waiting = 0;
  // Leaders first: per crossing and lane, the one furthest along its way.
  const order = vehicles
    .map((v, i) => i)
    .sort((a, b) => {
      const va = vehicles[a];
      const vb = vehicles[b];
      if (!va || !vb) return 0;
      if (va.crossing !== vb.crossing) return va.crossing - vb.crossing;
      if (va.dir !== vb.dir) return va.dir - vb.dir;
      return vb.u * vb.dir - va.u * va.dir;
    });
  const aheadOf = new Map<string, number>();
  for (const i of order) {
    const veh = vehicles[i];
    const c = veh && crossings[veh.crossing];
    if (!veh || !c) continue;
    const lane = `${veh.crossing}:${veh.dir}`;
    const reach = c.outer + CROSS_REACH_M;
    const along = veh.u * veh.dir; // how far along its own way (negative: before the avenue)
    // A waiting car's centre: its nose (half of about 4.3 m) stays off the avenue's verge.
    const stopAt = -(c.outer + STOP_BACK_M);
    let limit = Infinity;
    const open = (clearM[veh.crossing] ?? 0) > crossingNeed(c, veh.speed);
    if (!open && along <= stopAt + 0.01) limit = stopAt;
    const leader = aheadOf.get(lane);
    if (leader !== undefined && leader > along) limit = Math.min(limit, leader - QUEUE_GAP_M);
    let next = along + veh.speed * dt;
    if (next > limit) {
      next = Math.max(along, limit);
      waiting++;
    }
    if (next > reach) {
      next = -reach;
      aheadOf.delete(lane);
    } else aheadOf.set(lane, next);
    veh.u = next * veh.dir;
  }
  return waiting;
}

export interface DowntownCounts {
  items: Readonly<Record<string, number>>;
  crossings: number;
  cableStreets: number;
  vehicles: number;
  waiting: number;
  stretches: number;
  built: number;
  meshes: number;
  triangles: number;
}

interface Built {
  key: string;
  cx: number;
  cz: number;
  radius: number;
  mesh: Mesh | null;
  /**
   * The built buffer's two runs (`build`): [the placed models | the stretch's surfaces | the models'
   * far stand-ins]. Near draws [0, nearN); far draws [farStart, end). Zero until built.
   */
  nearN: number;
  farStart: number;
  farN: number;
}

/** The downtown of one road scene: its static stretches near the camera, and its cross traffic. */
export class DowntownLayer {
  readonly group = new Group();
  readonly plan: DowntownPlan;
  private readonly stretches: Built[];
  private readonly vehicles: CrossVehicle[];
  private readonly meshes: { kind: 'car' | 'cable'; variant: number; mesh: InstancedMesh; ids: number[] }[] =
    [];
  private waiting = 0;
  private shownMeshes = 0;
  private shownTris = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly v = new Vector3();
  private readonly one = new Vector3(1, 1, 1);

  constructor(
    private readonly kit: SceneryModel,
    private readonly props: SceneryModel | undefined,
    cableCar: SceneryModel | undefined,
    private readonly look: LookStyle,
    private readonly input: DowntownInput,
    /**
     * CX3's tower modules with their atlas (models.ts `sfTowerModules`); without them each tower draws the
     * old kit's model stretched to the same box, so what stands is what is drawn either way.
     */
    private readonly modules?: SceneryModel,
  ) {
    this.group.name = 'road-downtown';
    // Portland's blocks (T12.6) are drawn from the one kit; San Francisco's from its kit and the modules.
    this.plan = input.portland ? planPortland(input) : planDowntown(input);
    this.stretches = this.plan.stretches.map((s) => ({ ...s, mesh: null, nearN: 0, farStart: 0, farN: 0 }));
    this.vehicles = seedCrossTraffic(this.plan.crossings, input.seed);
    const material = look.material('vehicle', { vertexColors: true });
    const groups = new Map<string, number[]>();
    this.vehicles.forEach((veh, i) => {
      const key = `${veh.kind}:${veh.variant}`;
      const list = groups.get(key) ?? [];
      list.push(i);
      groups.set(key, list);
    });
    for (const [key, ids] of groups) {
      const [kind, variant] = key.split(':') as ['car' | 'cable', string];
      const geo = kind === 'cable' ? cableCar?.variants[0] : props?.variants[Number(variant)];
      if (!geo) continue;
      const mesh = new InstancedMesh(geo, material, ids.length);
      mesh.name = kind === 'cable' ? 'road-downtown-cable-cars' : 'road-downtown-cross-traffic';
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes.push({ kind, variant: Number(variant), mesh, ids });
    }
  }

  /**
   * Per frame: builds, shows and frees the stretches by distance from the camera, and moves the
   * cross traffic by dt seconds (0 while the race is paused), keeping it off the avenue while any
   * mover is near. `nearM` (a quality tier's, quality.ts `cityDetail`): a stretch wholly farther than this
   * draws its models as their far stand-ins (scenery-merge.ts `formsOf`); the default, everywhere in
   * full, is the game as it drew before tiers. Returns the static items in view.
   */
  update(
    cameraX: number,
    cameraZ: number,
    dt: number,
    movers: readonly GateMover[],
    nearM = Infinity,
  ): number {
    let next: Built | null = null;
    let nextDist = Infinity;
    for (const st of this.stretches) {
      const dist = Math.hypot(st.cx - cameraX, st.cz - cameraZ) - st.radius;
      if (!st.mesh && dist < DOWNTOWN_DRAW_M + PREFETCH_M && dist < nextDist) {
        next = st;
        nextDist = dist;
      }
    }
    if (next) this.build(next);
    let meshes = 0;
    let tris = 0;
    let shown = 0;
    for (const st of this.stretches) {
      if (!st.mesh) continue;
      const dist = Math.hypot(st.cx - cameraX, st.cz - cameraZ) - st.radius;
      st.mesh.visible = dist < DOWNTOWN_DRAW_M;
      if (st.mesh.visible) {
        const far = dist > nearM;
        const start = far ? st.farStart : 0;
        const count = far ? st.farN : st.nearN;
        st.mesh.geometry.setDrawRange(start, count);
        meshes++;
        tris += count / 3;
        shown++;
      } else if (dist > KEEP_M) this.free(st);
    }
    // The cross traffic.
    const clear = this.plan.crossings.map((c) => crossingClear(c, movers));
    this.waiting = stepCrossTraffic(
      this.vehicles,
      this.plan.crossings,
      clear,
      Math.max(0, Math.min(0.1, dt)),
    );
    for (const g of this.meshes) {
      g.ids.forEach((id, i) => {
        const veh = this.vehicles[id];
        const c = veh && this.plan.crossings[veh.crossing];
        if (!veh || !c) return;
        const roadY = c.roadY;
        const y = crossProfile(c, roadY, veh.u) + 0.04;
        const x = c.centre.x + c.across.x * veh.u + c.along.x * veh.v;
        const z = c.centre.z + c.across.z * veh.u + c.along.z * veh.v;
        const yaw = Math.atan2(c.across.x * veh.dir, c.across.z * veh.dir);
        const ahead = crossProfile(c, roadY, veh.u + veh.dir) - crossProfile(c, roadY, veh.u);
        this.e.set(-Math.atan(ahead), yaw, 0, 'YXZ');
        this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e), this.one);
        g.mesh.setMatrixAt(i, this.m);
      });
      g.mesh.instanceMatrix.needsUpdate = true;
      meshes++;
      tris += ((g.mesh.geometry.getAttribute('position')?.count ?? 0) / 3) * g.ids.length;
    }
    this.shownMeshes = meshes;
    this.shownTris = tris;
    return shown;
  }

  counts(): DowntownCounts {
    const items: Record<string, number> = {};
    for (const it of this.plan.items) items[it.rule] = (items[it.rule] ?? 0) + 1;
    return {
      items,
      crossings: this.plan.crossings.length,
      cableStreets: this.plan.crossings.filter((c) => c.cable).length,
      vehicles: this.vehicles.length,
      waiting: this.waiting,
      stretches: this.stretches.length,
      built: this.stretches.filter((s) => s.mesh).length,
      meshes: this.shownMeshes,
      triangles: Math.round(this.shownTris),
    };
  }

  /** The cross traffic as it stands (tests and the debug overlay). */
  traffic(): readonly CrossVehicle[] {
    return this.vehicles;
  }

  /**
   * The text surfaces of the placed models (a food cart's name board), in the world, for the words of
   * their pack signs to be painted over (text-surfaces.ts). The blank panel stays in the stretch's mesh.
   */
  surfaces(): PlacedSurface[] {
    const out: PlacedSurface[] = [];
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (const it of this.plan.items) {
      if (it.model !== 'kit') continue;
      const panels = this.kit.surfaces?.[it.variant];
      if (!panels?.length) continue;
      const m = new Matrix4().compose(
        this.v.set(it.p.x, it.p.y, it.p.z).clone(),
        q.setFromAxisAngle(up, it.turn),
        this.one,
      );
      for (const panel of panels) out.push(placeSurface(panel, m));
    }
    return out;
  }

  dispose(): void {
    for (const st of this.stretches) this.free(st);
    for (const g of this.meshes) g.mesh.dispose();
    this.group.removeFromParent();
  }

  private free(st: Built) {
    if (!st.mesh) return;
    st.mesh.geometry.dispose();
    st.mesh.removeFromParent();
    st.mesh = null;
  }

  /**
   * The geometries an item draws, each with the height it stands at above the item's base, its
   * vertical scale and whether its bottom is pushed down to the item's foot: one part for a kit or
   * props item, a base, its mids and a crown for a stacked tower (never scaled in y).
   */
  private partsOf(it: DowntownItem): Part[] {
    if (it.model === 'tower') {
      // Portland's pink tower: its three modules are the kit's own; San Francisco's are CX3's.
      const style = this.input.portland ? 0 : MODULE_STYLE[it.variant];
      const vs = this.input.portland
        ? [
            this.kit.variants[PDX.towerBase],
            this.kit.variants[PDX.towerMid],
            this.kit.variants[PDX.towerCrown],
          ]
        : this.modules?.variants;
      const base = style === undefined ? undefined : vs?.[style * 3];
      const mid = style === undefined ? undefined : vs?.[style * 3 + 1];
      const crown = style === undefined ? undefined : vs?.[style * 3 + 2];
      if (!base || !mid || !crown) return this.stretchedKit(it);
      const mids = it.mids ?? 1;
      const parts: Part[] = [{ g: base, lift: 0, sy: 1, sink: true }];
      for (let k = 0; k < mids; k++)
        parts.push({ g: mid, lift: MODULE_M.base + k * MODULE_M.mid, sy: 1, sink: false });
      parts.push({ g: crown, lift: MODULE_M.base + mids * MODULE_M.mid, sy: 1, sink: false });
      return parts;
    }
    const g = (it.model === 'kit' ? this.kit : this.props)?.variants[it.variant];
    return g ? [{ g, lift: 0, sy: it.sy, sink: true }] : [];
  }

  /**
   * A San Francisco tower when CX3's modules have not loaded: the old kit's model of its variant, stretched
   * to the box the road's plan stands (the modules' lot, the stacked height), so the solid is still what is
   * drawn. Before the physical world the lot itself shrank to the old kit's; now the plan never moves.
   */
  private stretchedKit(it: DowntownItem): Part[] {
    const g = this.input.portland ? undefined : this.kit.variants[it.variant];
    if (!g) return [];
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    if (!b) return [];
    const [width, depth] = towerFootprint(it.variant);
    const height = MODULE_M.base + (it.mids ?? 1) * MODULE_M.mid + MODULE_M.crown;
    const sx = width / Math.max(1e-6, b.max.x - b.min.x);
    const sz = depth / Math.max(1e-6, b.max.z - b.min.z);
    return [
      {
        g,
        lift: 0,
        sy: height / Math.max(1e-6, b.max.y - b.min.y),
        sink: true,
        sx,
        sz,
        ox: (-(b.min.x + b.max.x) / 2) * sx,
        oz: -b.max.z * sz,
      },
    ];
  }

  /**
   * The world points an item's drawn model has (its near geometry, placed exactly as a stretch places it):
   * the hitbox tests hold each building's structure to them.
   */
  drawnPoints(it: DowntownItem): Float32Array {
    const parts = this.partsOf(it);
    let n = 0;
    for (const part of parts) n += part.g.getAttribute('position').count;
    const out = new Float32Array(n * 3);
    let o = 0;
    for (const part of parts) {
      const gp = part.g.getAttribute('position').array;
      for (let i = 0; i < gp.length / 3; i++, o++) placeVertex(it, part, gp, i, out, o);
    }
    return out;
  }

  private build(st: Built) {
    const soup = this.plan.soups.get(st.key);
    const items = this.plan.items.filter(
      (it) => `${it.edge}:${Math.floor(Math.max(0, it.s) / STRETCH_M)}` === st.key,
    );
    const placed = items.map((it) => ({ it, parts: this.partsOf(it) }));
    // The stretch draws with the region atlas as its map when the modules brought one (every part
    // that is not an atlas surface samples its white tile: still one mesh, one draw).
    const map = this.input.portland ? this.kit.map : this.modules?.map;
    // The buffer, so near and far are each one run: [the models | the surfaces | the models' far
    // stand-ins]. Near draws the first two, far the last two (`update`).
    const soupN = soup ? soup.pos.length / 3 : 0;
    let modelsN = 0;
    let farModelsN = 0;
    for (const { parts } of placed)
      for (const p of parts) {
        modelsN += p.g.getAttribute('position').count;
        farModelsN += formsOf(p.g).far.n;
      }
    const total = modelsN + soupN + farModelsN;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uv = map ? new Float32Array(total * 2) : null;
    let o = 0;
    const emitModels = (pass: 'near' | 'far') => {
      for (const { it, parts } of placed) {
        const cos = Math.cos(it.turn);
        const sin = Math.sin(it.turn);
        for (const part of parts) {
          const g = part.g;
          // Near: the model as it is; far: its stand-in, in its picture's mean colours on the white tile.
          const far = pass === 'far' ? formsOf(g).far : null;
          const gp = far ? far.pos : g.getAttribute('position').array;
          const gn = far ? far.nrm : g.getAttribute('normal').array;
          const gc = far ? far.col : g.getAttribute('color').array;
          const guv = !far && uv && hasAtlasUv(g) ? g.getAttribute('uv').array : null;
          const n = gp.length / 3;
          col.set(gc, o * 3);
          if (uv) {
            if (guv) uv.set(guv, o * 2);
            else for (let v = 0; v < n; v++) uv.set(ATLAS_WHITE_UV, (o + v) * 2);
          }
          for (let i = 0; i < n; i++, o++) {
            placeVertex(it, part, gp, i, pos, o);
            const nx = gn[i * 3] ?? 0;
            const nz = gn[i * 3 + 2] ?? 0;
            nrm[o * 3] = nx * cos + nz * sin;
            nrm[o * 3 + 1] = gn[i * 3 + 1] ?? 0;
            nrm[o * 3 + 2] = nz * cos - nx * sin;
          }
        }
      }
    };
    emitModels('near');
    if (soup) {
      const s0 = o;
      pos.set(soup.pos, s0 * 3);
      col.set(soup.col, s0 * 3);
      o = s0 + soupN;
      // Face normals for the surfaces.
      const a = new Vector3();
      const b = new Vector3();
      const c = new Vector3();
      for (let i = 0; i + 2 < soupN; i += 3) {
        a.fromArray(soup.pos, i * 3);
        b.fromArray(soup.pos, i * 3 + 3).sub(a);
        c.fromArray(soup.pos, i * 3 + 6).sub(a);
        b.cross(c).normalize();
        for (let k = 0; k < 3; k++) b.toArray(nrm, (s0 + i + k) * 3);
      }
      if (uv) for (let v = s0; v < o; v++) uv.set(ATLAS_WHITE_UV, v * 2);
    }
    st.nearN = o;
    st.farStart = modelsN;
    emitModels('far');
    st.farN = o - modelsN;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos.subarray(0, o * 3), 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nrm.subarray(0, o * 3), 3));
    geo.setAttribute('color', new Float32BufferAttribute(col.subarray(0, o * 3), 3));
    if (uv) geo.setAttribute('uv', new Float32BufferAttribute(uv.subarray(0, o * 2), 2));
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, this.look.material('prop', { vertexColors: true, ...(map ? { map } : {}) }));
    mesh.name = 'road-downtown';
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    st.mesh = mesh;
  }
}
