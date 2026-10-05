// San Francisco's downtown (run W-R; interview, 2026-10-02: "SF first = downtown towers": a four-lane
// avenue between invented AI-startup towers, intersections with cross traffic, cable cars ONLY on the
// steep cable-line cross streets; playtest 2, 2026-10-02: "I expected some city feeling not just all
// row houses", and the cable cars that drove "including in forests"). This layer draws what stands
// on the downtown network's tagged land (src/render/scenery.ts's `downtown`, `plaza` and `crossing`
// themes; the road scene draws the land itself):
//
// - the towers (playtest 3, T12.4: CX3's stackable modules, a base, four-storey mids and a crown
//   stacked to the height wanted, never stretched, so a window keeps its shape; the old stretched kit
//   draws them only when the modules have not loaded), shoulder to shoulder behind a 3.4 m sidewalk (the sim's hard edge, road/
//   cross-section.ts: 4 m past the shoulder), a taller second row behind them, towers behind each
//   plaza, and the deadpan headquarters behind the last plaza;
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
import type { RoadNetwork } from '../road';
import type { Point3 } from './geometry';
import type { LookStyle } from './look';
import type { SceneryModel } from './models';
import type { RoadDressing } from './road-mesh';
import { LAND_TOP_M, scatterHash, themeAt, type SideTag, type SideTheme } from './scenery';
import { ATLAS_WHITE_UV, hasAtlasUv } from './scenery-merge';
import { placeSurface, type PlacedSurface } from './text-surfaces';

/** The kit's variants (tools/blender/props/sf_downtown.py), by name. */
export const DT = {
  towerGlass: 0,
  towerStone: 1,
  screenAgi: 2,
  screenSeries: 3,
  towerCrown: 4,
  hq: 5,
  midrise: 6,
  lamp: 7,
  signal: 8,
  planter: 9,
  bench: 10,
  orb: 11,
} as const;
/** The San Francisco roadside kit's variants this layer borrows (roadside.ts SF_KIT's list). */
export const SF_PROPS = {
  sedan: 0,
  hatch: 1,
  robotaxi: 2,
  hydrant: 4,
  scooter: 5,
  boards: [6, 7, 8],
} as const;

/**
 * CX3's stackable tower modules (`models/scenery/sf-tower-modules`, models.ts `sfTowerModules`): per
 * style a base, a mid and a crown, with these heights, m. A mid is four storeys and stacks onto itself
 * and onto the base and the crown at the same outline, so any whole number of mids makes a tower.
 */
export const MODULE_M = { base: 7, mid: 14, crown: 8 } as const;
/** The module styles, in the model's variant order (variant = style * 3 + 0 base, 1 mid, 2 crown). */
const MODULE_STYLE: Readonly<Record<number, number>> = {
  [DT.towerGlass]: 0,
  [DT.towerStone]: 1,
  [DT.screenAgi]: 2,
  [DT.screenSeries]: 2,
  [DT.towerCrown]: 3,
  [DT.midrise]: 4,
};
/** Each module style's front width and depth, m (the modules' footprints). */
const MODULE_FOOTPRINT: readonly (readonly [number, number])[] = [
  [28, 24],
  [30, 26],
  [32, 26],
  [34, 28],
  [24, 20],
];
/** The old kit's tower heights, m: the stacked towers' heights are these times the same seeded scale. */
const OLD_HEIGHT_M: Readonly<Record<number, number>> = {
  [DT.towerGlass]: 63,
  [DT.towerStone]: 63,
  [DT.screenAgi]: 54.5,
  [DT.screenSeries]: 54.5,
  [DT.towerCrown]: 86,
  [DT.midrise]: 26.8,
};
/** What fills the end of a run, widest first (the styles' footprints, wide to narrow). */
const STACKED_FILL: readonly number[] = [
  DT.towerCrown,
  DT.screenAgi,
  DT.towerStone,
  DT.towerGlass,
  DT.midrise,
];
/** The shortest stacked tower: a base, one mid and a crown. */
const MIN_STACK_M = MODULE_M.base + MODULE_M.mid + MODULE_M.crown;
/** The tallest stack, in mids (a back-row tower at its tallest is about 190 m). */
const MAX_MIDS = 14;

/** Each tower variant's front width and depth, m (the kit's footprints). */
const FOOTPRINT: Readonly<Record<number, readonly [number, number]>> = {
  [DT.towerGlass]: [22, 20],
  [DT.towerStone]: [24, 22],
  [DT.screenAgi]: [22, 20],
  [DT.screenSeries]: [22, 20],
  [DT.towerCrown]: [18, 18],
  [DT.hq]: [46, 30],
  [DT.midrise]: [20, 18],
};
/**
 * A tower variant's front width and depth, m: the module style's when it is stacked (`stacked`), else
 * the old kit's. The headquarters and the plain props only have the kit's.
 */
export function towerFootprint(variant: number, stacked: boolean): readonly [number, number] {
  const style = MODULE_STYLE[variant];
  if (stacked && style !== undefined) return MODULE_FOOTPRINT[style] ?? [22, 20];
  return FOOTPRINT[variant] ?? [22, 20];
}

/** The mids that make a tower of `targetM` (a base, the mids and a crown): the nearest whole number. */
function midsFor(targetM: number): number {
  const mids = Math.round((targetM - MODULE_M.base - MODULE_M.crown) / MODULE_M.mid);
  return Math.max(1, Math.min(MAX_MIDS, mids));
}

/** The front row's mix: plain towers mostly, a screen tower now and then, older midrises between. */
const FRONT_MIX: readonly number[] = [
  DT.towerGlass,
  DT.towerGlass,
  DT.towerStone,
  DT.towerStone,
  DT.midrise,
  DT.midrise,
  DT.screenAgi,
  DT.screenSeries,
  DT.towerCrown,
];
const BACK_MIX: readonly number[] = [
  DT.towerGlass,
  DT.towerStone,
  DT.towerCrown,
  DT.towerGlass,
  DT.screenAgi,
];

/** The verge past the drawn shoulder (road-mesh.ts VERGE_M). */
const VERGE_M = 0.6;
/** The sidewalk in front of the towers, past the verge, m: the towers' fronts are the sim's hard edge. */
export const SIDEWALK_M = 3.4;
/** A plaza's paving reaches this far past the verge; the towers behind it stand further back, m. */
export const PLAZA_M = 17.4;
const PLAZA_TOWERS_M = 26;
/** The second row of towers: this far past the verge, every so often, taller. [default] */
const BACK_ROW_M = 46;
const BACK_ROW_EVERY_M = 34;
/** The headquarters stands this far past the verge, behind the last plaza. */
const HQ_BACK_M = 24;
/** Lamps and planters along a sidewalk, m. [default] */
const LAMP_EVERY_M = 30;
/** Cross streets: their reach from the avenue, their roadway's half width, a lane's offset, m. */
export const CROSS_REACH_M = 200;
const CROSS_ROAD_HALF_M = 5.5;
/** Buildings line a cross street this far out (past it, the fog and the backdrop's skyline). */
const CROSS_BUILT_M = 120;
const CROSS_LANE_M = 2.75;
/** A cable-car street's grade up the hill on the avenue's left. [default] steep, as the city's are. */
export const CABLE_GRADE = 0.16;
/** A plain cross street drops this much per metre past the land strip, down to CROSS_FLOOR_Y. */
const CROSS_DROP = 0.05;
const CROSS_FLOOR_Y = 0.6;
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
/** The city floor under the blocks: its height and its reach past the land strip, m. */
const CITY_FLOOR_Y = 0.45;
export const CITY_FLOOR_M = 300;
/** Static geometry is merged per stretch of road this long, m. [default] */
export const STRETCH_M = 160;
/** Drawn out to this far (the foggy region's haze is full at 480 m), m. [default] */
export const DOWNTOWN_DRAW_M = 500;
const PREFETCH_M = 120;
const KEEP_M = DOWNTOWN_DRAW_M + 200;
/** Features nothing of this layer stands in, with room round them (road-mesh.ts KEEP_CLEAR). */
const KEEP_CLEAR = new Set(['billboard', 'boostPad', 'rampTruck', 'roadsideZone', 'copSpawn']);
const FEATURE_CLEAR_M = 2.5;
/** A tower's base reaches this far under the ground, so it never shows a gap on the slope behind. */
const TOWER_SINK_M = 6;

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
 * style; `mids` is how many mids it stacks).
 */
export interface DowntownItem {
  model: 'kit' | 'props' | 'tower';
  variant: number;
  rule: string;
  p: Point3;
  /** Turn about the vertical (the model's +Z goes to (sin, cos) in x, z). */
  turn: number;
  /** Height scale (the kit's towers vary in height), uniform 1 otherwise, and always 1 for a stacked tower. */
  sy: number;
  /** A stacked tower: how many four-storey mids, and the height it was asked to be, m. */
  mids?: number;
  targetM?: number;
  /** World y its base is pushed down to (a tower's foot under the slope), or null. */
  foot: number | null;
  edge: number;
  s: number;
  d: number;
}

/** One block's cross street. */
export interface Crossing {
  edge: number;
  s: number;
  /** Half its width along the avenue (the tag's span), m. */
  half: number;
  cable: boolean;
  /** The avenue's centre at the crossing, the unit vector across it (toward +d) and along it. */
  centre: Point3;
  across: { x: number; z: number };
  along: { x: number; z: number };
  /** Half the avenue's drawn width: the verge's outer edge, m. */
  outer: number;
  /** The avenue's height at the crossing (the cross street's starts there), m. */
  roadY: number;
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
   * Stack CX3's tower modules instead of stretching the old kit (playtest 3, T12.4): the layer sets it
   * when the modules have loaded. The lots are the modules' footprints, which are wider.
   */
  stacked?: boolean;
  /**
   * Downtown Portland (playtest 3, T12.6): the blocks of a `pdx-blocks` side, drawn from CX4's kit (the
   * layer's `kit`). `landReach` is the road scene's: how far past the verge the drawn land runs there
   * (RoadScene.landReach), so a building stands on ground.
   */
  portland?: { landReach(edge: number, side: -1 | 1, s: number): number };
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

/** A cross street's height at u across the avenue (signed, toward +d), for a crossing at road height y. */
export function crossProfile(c: Pick<Crossing, 'cable' | 'outer'>, roadY: number, u: number): number {
  const out = Math.abs(u) - c.outer;
  if (out <= 0) return roadY;
  // The cable street climbs the hill on the avenue's left from a short flat at the corner.
  if (c.cable && u < 0) return roadY + CABLE_GRADE * Math.max(0, out - 6);
  return Math.max(CROSS_FLOOR_Y, roadY - 0.05 - CROSS_DROP * Math.max(0, out - LAND_STRIP_M));
}

/** Plans the downtown of a network: towers, furniture, cross streets and the floor. */
export function planDowntown(input: DowntownInput): DowntownPlan {
  const { road, dressing, seed } = input;
  const stacked = input.stacked === true;
  const footprint = (variant: number) => towerFootprint(variant, stacked);
  /** A tower of the kit's variant, `scale` times its old height: stacked modules, or the stretched kit. */
  const towerOf = (
    variant: number,
    scale: number,
  ): Pick<DowntownItem, 'model' | 'sy' | 'mids' | 'targetM'> => {
    if (!stacked || MODULE_STYLE[variant] === undefined) return { model: 'kit', sy: scale };
    const targetM = Math.max(MIN_STACK_M, (OLD_HEIGHT_M[variant] ?? 40) * scale);
    return { model: 'tower', sy: 1, mids: midsFor(targetM), targetM };
  };
  const crossings: Crossing[] = [];
  const { soupAt, quad, place, note, finish } = planner();

  const hqEdge = lastDowntownEdge(road, dressing);
  for (const e of road.edges) {
    const dress = dressing?.[e.id];
    const tags = (dress?.tags ?? e.tags) as readonly SideTag[] | undefined;
    if (!tags?.some((t) => ['towers', 'plaza', 'cross-street', 'cable-crossing'].includes(t.tag))) continue;
    const features = (dress?.features ?? e.features).filter((f) => KEEP_CLEAR.has(f.kind));
    const h = (k: number, side: number, salt: number) =>
      scatterHash(seed, 4111 + e.index * 977, k, side * 37 + salt);
    const outerOf = (side: -1 | 1) => (side < 0 ? -e.dMin : e.dMax) + VERGE_M;
    const theme = (side: -1 | 1, s: number): SideTheme => themeAt(tags, side < 0 ? 'left' : 'right', s);
    /**
     * Whether nothing kept clear lies over s0..s1 and a0..a1 on a side (a: distance out from the
     * centre line), with `margin` round it.
     */
    const clear = (side: -1 | 1, s0: number, s1: number, a0: number, a1: number, margin = FEATURE_CLEAR_M) =>
      !features.some((f) => {
        const lo = Math.min(f.d0, f.d1) * side;
        const hi = Math.max(f.d0, f.d1) * side;
        const fa = Math.min(lo, hi);
        const fb = Math.max(lo, hi);
        return (
          Math.min(f.s0, f.s1) - margin < s1 &&
          Math.max(f.s0, f.s1) + margin > s0 &&
          fa - margin < a1 &&
          fb + margin > a0
        );
      });
    const w = (s: number, d: number, hgt: number) => road.toWorld(e.index, s, d, hgt);
    const faceRoad = (p: Point3, s: number) => {
      const c = w(s, 0, 0);
      return Math.atan2(c.x - p.x, c.z - p.z);
    };
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

    // Crossings: one per cross-street tag span (both sides share it).
    const seen = new Set<string>();
    for (const t of tags) {
      if (t.tag !== 'cross-street' && t.tag !== 'cable-crossing') continue;
      const s = (t.s0 + t.s1) / 2;
      const id = `${t.tag}:${s}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const centre = w(s, 0, 0);
      const r = w(s, 1, 0);
      const f = w(Math.min(e.length, s + 1), 0, 0);
      const b = w(Math.max(0, s - 1), 0, 0);
      const ax = r.x - centre.x;
      const az = r.z - centre.z;
      const al = Math.hypot(ax, az) || 1;
      const fx = f.x - b.x;
      const fz = f.z - b.z;
      const fl = Math.hypot(fx, fz) || 1;
      crossings.push({
        edge: e.index,
        s,
        half: (t.s1 - t.s0) / 2,
        cable: t.tag === 'cable-crossing',
        centre,
        across: { x: ax / al, z: az / al },
        along: { x: fx / fl, z: fz / fl },
        outer: Math.max(outerOf(-1), outerOf(1)),
        roadY: centre.y,
      });
    }

    // The headquarters: behind the last plaza on the network's last plaza edge, near its end (the
    // finish), facing the avenue.
    let hqAt: { side: -1 | 1; s: number } | null = null;
    if (e.index === hqEdge) {
      for (const side of [1, -1] as const) {
        const run = runs(side, 'plaza').at(-1);
        if (!run) continue;
        const s = Math.max((run[0] + run[1]) / 2, run[1] - 60);
        const d = side * (outerOf(side) + PLAZA_M + HQ_BACK_M);
        const p = w(s, d, 0);
        place({
          model: 'kit',
          variant: DT.hq,
          rule: 'hq',
          p: { x: p.x, y: w(s, 0, 0).y + LAND_TOP_M, z: p.z },
          turn: faceRoad(p, s),
          sy: 1,
          foot: CITY_FLOOR_Y - 1,
          edge: e.index,
          s,
          d,
        });
        hqAt = { side, s };
        break;
      }
    }

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

      // The front row of towers along each downtown run, shoulder to shoulder, a narrow alley now
      // and then; towers behind each plaza.
      for (const [want, back] of [
        ['downtown', SIDEWALK_M],
        ['plaza', PLAZA_TOWERS_M],
      ] as const) {
        for (const [a, b] of runs(side, want)) {
          let cursor = a + 1;
          for (let k = 0; ; k++) {
            const variant = (want === 'plaza' ? BACK_MIX : FRONT_MIX)[
              Math.floor(h(k * 7 + Math.round(a), side, 1) * (want === 'plaza' ? BACK_MIX : FRONT_MIX).length)
            ];
            if (variant === undefined) break;
            let [width, depth] = footprint(variant);
            let pick = variant;
            // Near the run's end a narrower building fills what is left (stacked, the widest style that
            // still fits, so the frontage stays near-continuous with the modules' wider lots).
            if (cursor + width > b - 0.5) {
              const narrow = (stacked ? STACKED_FILL : [DT.midrise, DT.towerCrown]).find(
                (v) => cursor + footprint(v)[0] <= b - 0.5,
              );
              if (narrow === undefined) break;
              pick = narrow;
              [width, depth] = footprint(narrow);
            }
            const s = cursor + width / 2;
            cursor += width + (h(k + Math.round(a), side, 2) < 0.3 ? 2 : 0.4);
            // (A sign on the sidewalk stands in front of a tower, not in it: only its own ground counts.)
            if (!clear(side, s - width / 2, s + width / 2, outer + back, outer + back + depth, 0.3)) continue;
            // The headquarters' own plaza keeps clear in front of and round it.
            if (hqAt && hqAt.side === side && want === 'plaza' && Math.abs(s - hqAt.s) < 23 + width / 2 + 4)
              continue;
            const p = w(s, side * (outer + back), 0);
            place({
              ...towerOf(pick, 0.75 + 0.6 * h(k + Math.round(a), side, 3)),
              variant: pick,
              rule: want === 'plaza' ? 'plaza-tower' : 'tower',
              p: { x: p.x, y: p.y + LAND_TOP_M, z: p.z },
              turn: faceRoad(p, s),
              foot: p.y - TOWER_SINK_M,
              edge: e.index,
              s,
              d: side * (outer + back),
            });
          }
        }
      }

      // The second row, taller, behind the first: away from the cross streets (their own buildings
      // line them there).
      for (const [a, b] of runs(side, 'downtown')) {
        for (let k = 0; ; k++) {
          const s = a + (k + 0.5) * BACK_ROW_EVERY_M;
          if (s + (stacked ? 17 : 12) > b) break;
          if (h(k + Math.round(a), side, 4) < 0.25) continue;
          const variant =
            BACK_MIX[Math.floor(h(k + Math.round(a), side, 5) * BACK_MIX.length)] ?? DT.towerGlass;
          const near = crossingsNear(crossings, e.index, s, 30);
          if (near) continue;
          const d = side * (outer + BACK_ROW_M + 10 * h(k, side, 6));
          const p = w(s, d, 0);
          place({
            ...towerOf(variant, 1.2 + 1.0 * h(k + Math.round(a), side, 7)),
            variant,
            rule: 'back-tower',
            p: { x: p.x, y: w(s, 0, 0).y + LAND_TOP_M, z: p.z },
            turn: faceRoad(p, s),
            foot: CITY_FLOOR_Y - 1,
            edge: e.index,
            s,
            d,
          });
        }
      }

      // Lamps on the sidewalks and the plazas, a planter between each two, and the kit's clutter.
      for (const want of ['downtown', 'plaza'] as const) {
        for (const [a, b] of runs(side, want)) {
          for (let k = 0; ; k++) {
            const s = a + 6 + k * LAMP_EVERY_M + (side > 0 ? LAMP_EVERY_M / 2 : 0);
            if (s > b - 4) break;
            if (clear(side, s - 1, s + 1, outer, outer + 1.6)) {
              const p = w(s, side * (outer + 0.6), LAND_TOP_M);
              place({
                model: 'kit',
                variant: DT.lamp,
                rule: 'lamp',
                p,
                turn: faceRoad(p, s),
                sy: 1,
                foot: null,
                edge: e.index,
                s,
                d: side * (outer + 0.6),
              });
            }
            const sp = s + LAMP_EVERY_M / 2;
            if (sp < b - 4 && clear(side, sp - 1.5, sp + 1.5, outer + 0.8, outer + 3.4)) {
              const pick = h(k + Math.round(a), side, 8);
              const p = w(sp, side * (outer + 2.3), LAND_TOP_M);
              if (pick < 0.45)
                place({
                  model: 'kit',
                  variant: DT.planter,
                  rule: 'planter',
                  p,
                  turn: 0,
                  sy: 1,
                  foot: null,
                  edge: e.index,
                  s: sp,
                  d: side * (outer + 2.3),
                });
              else if (pick < 0.6)
                place({
                  model: 'props',
                  variant: SF_PROPS.hydrant,
                  rule: 'hydrant',
                  p,
                  turn: faceRoad(p, sp),
                  sy: 1,
                  foot: null,
                  edge: e.index,
                  s: sp,
                  d: side * (outer + 2.3),
                });
              else if (pick < 0.8)
                place({
                  model: 'props',
                  variant: SF_PROPS.scooter,
                  rule: 'scooter',
                  p,
                  turn: pick * 40,
                  sy: 1,
                  foot: null,
                  edge: e.index,
                  s: sp,
                  d: side * (outer + 2.3),
                });
              else {
                const v = SF_PROPS.boards[Math.floor(h(k, side, 9) * 3) % 3] ?? 6;
                place({
                  model: 'props',
                  variant: v,
                  rule: 'board',
                  p,
                  turn: faceRoad(p, sp),
                  sy: 1,
                  foot: null,
                  edge: e.index,
                  s: sp,
                  d: side * (outer + 2.3),
                });
              }
            }
          }
        }
      }

      // Plazas: benches and planters in rows, the orb in the middle of each.
      for (const [a, b] of runs(side, 'plaza')) {
        const mid = (a + b) / 2;
        for (let s = a + 10; s < b - 8; s += 16) {
          for (const across of [7, 13]) {
            if (!clear(side, s - 2, s + 2, outer + across - 2, outer + across + 2)) continue;
            const p = w(s, side * (outer + across), LAND_TOP_M);
            const bench = across === 7;
            place({
              model: 'kit',
              variant: bench ? DT.bench : DT.planter,
              rule: bench ? 'bench' : 'plaza-planter',
              p,
              turn: faceRoad(p, s),
              sy: 1,
              foot: null,
              edge: e.index,
              s,
              d: side * (outer + across),
            });
          }
        }
        // The orb: in the middle if it is free, else the nearest free spot along the plaza.
        for (const off of [0, -40, 40, -80, 80, -120, 120]) {
          const at = mid + off;
          if (at < a + 8 || at > b - 8 || !clear(side, at - 4, at + 4, outer + 6, outer + 14, 1)) continue;
          const p = w(at, side * (outer + 10), LAND_TOP_M);
          place({
            model: 'kit',
            variant: DT.orb,
            rule: 'orb',
            p,
            turn: 0,
            sy: 1,
            foot: null,
            edge: e.index,
            s: at,
            d: side * (outer + 10),
          });
          break;
        }
      }

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
  // Each crossing: its roadway both ways, the zebras and stop lines on the avenue, the signals,
  // the buildings lining it, and the cable slots.
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
      // Buildings lining it, both sides, from behind the avenue's corner towers out (stepping up the
      // hill on a cable street).
      for (const vs of [-1, 1] as const) {
        let cursor = c.outer + SIDEWALK_M + 24;
        for (let k = 0; cursor < c.outer + CROSS_BUILT_M; k++) {
          const variant =
            scatterHash(seed, 6007 + c.edge * 131 + Math.round(c.s), k, sign * 3 + vs) < 0.7
              ? DT.midrise
              : DT.towerStone;
          const [width] = footprint(variant);
          const u = cursor + width / 2;
          cursor += width + 1;
          const base = at(sign * u, vs * c.half);
          const toStreet = at(sign * u, 0);
          place({
            ...towerOf(variant, 0.8 + 0.6 * scatterHash(seed, 6011 + c.edge, k, sign * 5 + vs)),
            variant,
            rule: 'cross-building',
            p: { x: base.x, y: base.y + 0.05, z: base.z },
            turn: Math.atan2(toStreet.x - base.x, toStreet.z - base.z),
            foot: CITY_FLOOR_Y - 1,
            edge: c.edge,
            s: c.s,
            d: sign * u,
          });
        }
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
    // The signals: on the far right corner for each way along the avenue, the arm over its lanes.
    for (const way of [1, -1] as const) {
      const s = c.s + way * (c.half + 1.5);
      const d = way * (c.outer + 0.5);
      const p = road.toWorld(c.edge, Math.max(0, Math.min(e.length, s)), d, LAND_TOP_M);
      // It faces the riders coming (along -way), and its arm (the model's -X) reaches over the road.
      const turn = Math.atan2(-way * c.along.x, -way * c.along.z);
      place({
        model: 'kit',
        variant: DT.signal,
        rule: 'signal',
        p,
        turn,
        sy: 1,
        foot: null,
        edge: c.edge,
        s,
        d,
      });
    }
    note(c.edge, c.s, at(-c.outer - CROSS_REACH_M, 0));
    note(c.edge, c.s, at(c.outer + CROSS_REACH_M, 0));
  }

  return finish(crossings, CITY_FLOOR_M + 80);
}

/** CX4's kit (`models/scenery/pdx-downtown`, models.ts ROOTS.pdxDowntown), by variant. */
export const PDX = {
  castIron: 0,
  brickLoft: 1,
  officeBlock: 2,
  towerBase: 3,
  towerMid: 4,
  towerCrown: 5,
  cartA: 6,
  cartB: 7,
  cartC: 8,
  bikeRack: 9,
} as const;
const PDX_CARTS: readonly number[] = [PDX.cartA, PDX.cartB, PDX.cartC];
/** The front row's mix: a third cast iron, a third brick lofts, offices, and now and then a pink tower. [default] */
const PDX_FRONT_MIX: readonly number[] = [
  PDX.castIron,
  PDX.brickLoft,
  PDX.officeBlock,
  PDX.castIron,
  PDX.brickLoft,
  PDX.officeBlock,
  PDX.towerBase,
];
/** A block is 200 feet, so a cross street opens in the front row after this much frontage, m. */
export const PDX_BLOCK_M = 61;
/** Portland's cross streets are 60 feet wide, m. */
export const PDX_STREET_M = 18;
/**
 * A building may reach this far past the land the road scene drew, m: the road scene's terrain skirt falls
 * away at about 1 in 2.2 beyond it, so its back corners hang that much over a drop of about 2 m. Seen from
 * the road, the front of the building hides it.
 */
export const PDX_OVERHANG_M = 5;
/**
 * A building's base reaches this far under the lowest ground along its front, m. It is small: the base
 * moves a facade's bottom edge, so it stretches the facade's picture by the same share, and a front row
 * on the road's grade (3 % up Broadway) needs only the slope across one lot.
 */
export const PDX_SINK_M = 0.3;
/**
 * The second row (playtest 4, P4-20): its fronts stand at least this far past the verge, m: a sidewalk,
 * the deepest street front (the kit's 24 m towers) and an alley. [default]
 */
export const PDX_BACK_ROW_M = SIDEWALK_M + 24 + 3.6;
/** The second row's mix: offices and brick lofts, with a pink tower now and then, taller than the fronts. [default] */
const PDX_BACK_MIX: readonly number[] = [
  PDX.officeBlock,
  PDX.brickLoft,
  PDX.towerBase,
  PDX.brickLoft,
  PDX.officeBlock,
  PDX.towerBase,
];
/** A second-row pink tower's height range, m (Portland's tallest stand about 160 m). [default] */
const PDX_BACK_TOWER_M = [60, 150] as const;
/** A bike rack stands on the sidewalk every so often, m. [default] */
const PDX_RACK_EVERY_M = 38;
/** Carts in a pod stand this far apart along the road, and this far behind the pedestrian zone, m. [default] */
export const PDX_CART_PITCH_M = 12;
export const PDX_CART_BACK_M = 1;
/** A cart's footprint: its body and the picnic table beside it, m (the model's box is x -2.5 to 5.6, z -2.4 to 0.8). */
const PDX_CART_WIDTH_M = 8.1;
const PDX_CART_DEPTH_M = 2.4;
const PDX_CART_MID_X_M = 1.55;
/** What a feature of these kinds keeps clear of buildings (the road scene's own list, and landmarks). */
const PDX_CLEAR = new Set([...KEEP_CLEAR, 'landmark']);
/** A pedestrian zone with this `params.dressing` is a food-cart pod: a lot, with carts standing in it. */
export const PDX_PODS = 'food-carts';

/** A building's footprint on the ground: its middle, its two axes (u along the front, v out of it) and half sizes. */
export interface Rect {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  hw: number;
  hd: number;
}

/**
 * The footprint of a model of `width` by `depth` whose front middle stands at `p` turned by `turn` (the
 * model's +Z, its front's normal, is (sin turn, cos turn); its +X is (cos turn, -sin turn); the building
 * runs back along -Z).
 */
export function rectOf(p: Point3, turn: number, width: number, depth: number): Rect {
  const vx = Math.sin(turn);
  const vz = Math.cos(turn);
  return {
    cx: p.x - (vx * depth) / 2,
    cz: p.z - (vz * depth) / 2,
    ux: Math.cos(turn),
    uz: -Math.sin(turn),
    vx,
    vz,
    hw: width / 2,
    hd: depth / 2,
  };
}

/** Whether two footprints overlap by more than a seam (separating-axis test, with 0.2 m of give). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  const give = 0.2;
  const radius = (r: Rect, ax: number, az: number) =>
    r.hw * Math.abs(r.ux * ax + r.uz * az) + r.hd * Math.abs(r.vx * ax + r.vz * az);
  for (const [ax, az] of [
    [a.ux, a.uz],
    [a.vx, a.vz],
    [b.ux, b.uz],
    [b.vx, b.vz],
  ] as const) {
    const apart = Math.abs((b.cx - a.cx) * ax + (b.cz - a.cz) * az);
    if (apart >= radius(a, ax, az) + radius(b, ax, az) - give) return false;
  }
  return true;
}

/** A building keeps this far from any road's verge, m: the sidewalk less what a front's corner may give. */
export const PDX_ROAD_CLEAR_M = SIDEWALK_M - 0.6;

/** The width and depth of one of the kit's buildings, m: its bounding box (the front is at z = 0). */
export function pdxFootprint(kit: SceneryModel, variant: number): readonly [number, number] {
  const g = kit.variants[variant];
  if (!g) return [0, 0];
  if (!g.boundingBox) g.computeBoundingBox();
  const b = g.boundingBox;
  return b ? [b.max.x - b.min.x, Math.max(0, -b.min.z)] : [0, 0];
}

/**
 * Downtown Portland's blocks (playtest 3, T12.6; wave B's punch list, item 3): on every `pdx-blocks` side
 * of the road, a front row of CX4's cast-iron fronts, brick lofts, office blocks and now and then a
 * pink tower (stacked from its modules, as San Francisco's are), a cross street every block, bike racks on
 * the sidewalk, and a pod of food carts where a pedestrian zone says `dressing: food-carts`. Everything
 * stands on land the road scene drew (`input.portland.landReach`): a building keeps clear of every
 * feature the road keeps clear (a zone, a sign, a landmark), moves back behind one that only crosses its
 * front, and gives up its lot where it cannot stand on ground. Pure placement (tests read it).
 */
export function planPortland(input: DowntownInput, kit: SceneryModel): DowntownPlan {
  const { road, dressing, seed } = input;
  const landReach = (edge: number, side: -1 | 1, s: number) => input.portland?.landReach(edge, side, s) ?? 0;
  const { soupAt, quad, place, finish } = planner();
  const sizes = new Map<number, readonly [number, number]>();
  const size = (variant: number) => {
    let s = sizes.get(variant);
    if (!s) {
      s = pdxFootprint(kit, variant);
      sizes.set(variant, s);
    }
    return s;
  };
  /** Every building placed so far, on any road: two roads' fronts meet at a corner and must not overlap. */
  const footprints: Rect[] = [];
  /** Work that waits until every road's street fronts stand: the second row never takes a front's lot. */
  const later: (() => void)[] = [];
  /**
   * Whether none of a footprint's corners, edge middles and centre lies on another road's land at a
   * different height: its strip is drawn there at its own level, which would bury or float the building.
   */
  const offOtherLand = (r: Rect, own: number, y: number): boolean => {
    const at = (a: number, b: number) => ({
      x: r.cx + r.ux * a + r.vx * b,
      z: r.cz + r.uz * a + r.vz * b,
    });
    return [-1, 0, 1]
      .flatMap((i) => [-1, 0, 1].map((j) => at(i * r.hw, j * r.hd)))
      .every((q) => {
        const pos = road.project(q.x, q.z, own);
        const e2 = road.edges[pos.edge];
        if (pos.edge === own || !e2) return true;
        const side: -1 | 1 = pos.d < 0 ? -1 : 1;
        const out = (side < 0 ? -e2.dMin : e2.dMax) + VERGE_M;
        if (Math.abs(pos.d) > out + landReach(pos.edge, side, pos.s) + 1) return true;
        return Math.abs(road.toWorld(pos.edge, pos.s, 0, 0).y - y) <= 1;
      });
  };
  /**
   * Whether none of a footprint's corners, edge middles and centre lies on a road, or within a sidewalk of
   * one (the inside of a bend and a junction's other road, which the land strip does not see): each point
   * is projected onto the nearest road of the edge's neighbourhood.
   */
  const clearOfRoads = (r: Rect, hint: number): boolean => {
    const at = (a: number, b: number) => ({
      x: r.cx + r.ux * a + r.vx * b,
      z: r.cz + r.uz * a + r.vz * b,
    });
    const points = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => at(i * r.hw, j * r.hd)));
    return points.every((q) => {
      const pos = road.project(q.x, q.z, hint);
      const e2 = road.edges[pos.edge];
      if (!e2) return true;
      const edge = pos.d < 0 ? -e2.dMin : e2.dMax;
      return Math.abs(pos.d) >= edge + PDX_ROAD_CLEAR_M;
    });
  };
  for (const e of road.edges) {
    const dress = dressing?.[e.id];
    const tags = (dress?.tags ?? e.tags) as readonly SideTag[] | undefined;
    if (!tags?.some((t) => t.tag === 'pdx-blocks')) continue;
    const all = dress?.features ?? e.features;
    const features = all.filter((f) => PDX_CLEAR.has(f.kind));
    const pods = all.filter((f) => f.kind === 'roadsideZone' && f.params?.['dressing'] === PDX_PODS);
    const h = (k: number, side: number, salt: number) =>
      scatterHash(seed, 5113 + e.index * 977, k, side * 37 + salt);
    const outerOf = (side: -1 | 1) => (side < 0 ? -e.dMin : e.dMax) + VERGE_M;
    const w = (s: number, d: number, hgt: number) => road.toWorld(e.index, s, d, hgt);
    const faceRoad = (p: Point3, s: number) => {
      const c = w(s, 0, 0);
      return Math.atan2(c.x - p.x, c.z - p.z);
    };
    const reach = (side: -1 | 1, s: number) =>
      Math.min(landReach(e.index, side, s), landReach(e.index, side, Math.min(e.length, s + 2)));
    /** The runs of s where a side is Portland's blocks, at 2 m steps: [start, end] pairs. */
    const runs = (side: -1 | 1): [number, number][] => {
      const out: [number, number][] = [];
      let start = -1;
      for (let s = 0; s <= e.length + 1e-6; s += 2) {
        const here = themeAt(tags, side < 0 ? 'left' : 'right', Math.min(s, e.length)) === 'blocks';
        if (here && start < 0) start = s;
        if ((!here || s + 2 > e.length + 1e-6) && start >= 0) {
          out.push([start, here ? e.length : s - 2]);
          start = -1;
        }
      }
      return out;
    };
    /** The features over s0..s1 on a side, as how far out from the road's middle they reach: [near, far]. */
    const across = (side: -1 | 1, s0: number, s1: number, margin: number) =>
      features
        .filter((f) => Math.min(f.s0, f.s1) - margin < s1 && Math.max(f.s0, f.s1) + margin > s0)
        .map((f) => {
          const lo = Math.min(f.d0, f.d1) * side;
          const hi = Math.max(f.d0, f.d1) * side;
          return [Math.min(lo, hi), Math.max(lo, hi)] as const;
        });
    /** How far past the verge a building's front must stand over s0..s1: a sidewalk, or behind a feature. */
    const backFor = (side: -1 | 1, s0: number, s1: number) => {
      const outer = outerOf(side);
      let back = SIDEWALK_M;
      for (const [, far] of across(side, s0, s1, 1.5)) if (far > outer + back - 0.5) back = far - outer + 0.5;
      return back;
    };
    /** The ground a building over s0..s1 at d stands on: its highest and lowest road height there, m. */
    const groundOver = (s0: number, s1: number, d: number) => {
      let hi = -Infinity;
      let lo = Infinity;
      for (let i = 0; i <= 3; i++) {
        const y = w(Math.max(0, Math.min(e.length, s0 + ((s1 - s0) * i) / 3)), d, 0).y;
        hi = Math.max(hi, y);
        lo = Math.min(lo, y);
      }
      return { hi, lo };
    };

    for (const side of [-1, 1] as const) {
      const outer = outerOf(side);
      const streets: [number, number][] = [];
      for (const [a, b] of runs(side)) {
        // The paving: a sidewalk past the verge, and the lot behind it out to the land's edge.
        for (let s = a; s < b; s += 6) {
          const s1 = Math.min(b, s + 6);
          const r = Math.min(reach(side, s), reach(side, s1));
          if (r < 1) continue;
          const soup = soupAt(e.index, s);
          const walk = Math.min(r, SIDEWALK_M);
          const n0 = w(s, side * outer, 0.03);
          const n1 = w(s1, side * outer, 0.03);
          const m0 = w(s, side * (outer + walk), 0.03);
          const m1 = w(s1, side * (outer + walk), 0.03);
          const f0 = w(s, side * (outer + r), 0.03);
          const f1 = w(s1, side * (outer + r), 0.03);
          const face = (p: Point3, q: Point3, p1: Point3, q1: Point3, colour: string) =>
            side > 0 ? quad(soup, p, q, p1, q1, colour) : quad(soup, q, p, q1, p1, colour);
          face(n0, m0, n1, m1, DOWNTOWN_COLOURS.sidewalk);
          if (r > walk) face(m0, f0, m1, f1, DOWNTOWN_COLOURS.floor);
        }
        // A food-cart pod is a lot: the carts stand in it (below), and no building does.
        const inPod = (s0: number, s1: number) =>
          pods.find(
            (p) =>
              (p.d0 + p.d1 < 0 ? -1 : 1) === side &&
              s0 < Math.max(p.s0, p.s1) + 2 &&
              s1 > Math.min(p.s0, p.s1) - 2,
          );
        /**
         * The lot a building of `variant` would take at `at` along the road (its front standing at least
         * `minBack` past the verge), and whether it stands on ground: null where it does not fit.
         */
        const lotFor = (variant: number, at: number, minBack: number) => {
          const [width, depth] = size(variant);
          if (!(width > 0) || at + width > b || inPod(at, at + width)) return null;
          const s0 = at;
          const s1 = at + width;
          const s = (s0 + s1) / 2;
          const back = Math.max(backFor(side, s0 - 0.3, s1 + 0.3), minBack);
          // The land under its front and its depth, looked at every few metres along it.
          let r = reach(side, s1);
          for (let u = s0; u < s1; u += 5) r = Math.min(r, reach(side, u));
          if (r < back + 4 || r < back + depth - PDX_OVERHANG_M) return null;
          const d = side * (outer + back);
          const p = w(s, d, 0);
          const turn = faceRoad(p, s);
          const rect = rectOf(p, turn, width, depth);
          // Not over a road (the inside of a bend, a junction) and not over another building.
          if (!clearOfRoads(rect, e.index) || footprints.some((o) => rectsOverlap(rect, o))) return null;
          return { width, depth, back, s0, s1, s, d, p, turn, rect };
        };
        // The front row.
        let cursor = a + 1;
        let block = 0;
        for (let k = 0; cursor < b - 6; k++) {
          const pod = inPod(cursor, cursor + 1);
          if (pod) {
            cursor = Math.max(cursor + 1, Math.max(pod.s0, pod.s1) + 3);
            continue;
          }
          if (block >= PDX_BLOCK_M) {
            // A cross street: its asphalt from the verge out across the land.
            const s0 = cursor;
            const s1 = Math.min(b, cursor + PDX_STREET_M);
            const r = Math.min(reach(side, s0), reach(side, s1));
            if (r >= 1) {
              const soup = soupAt(e.index, s0);
              const n0 = w(s0, side * outer, 0.05);
              const n1 = w(s1, side * outer, 0.05);
              const f0 = w(s0, side * (outer + r), 0.05);
              const f1 = w(s1, side * (outer + r), 0.05);
              if (side > 0) quad(soup, n0, f0, n1, f1, DOWNTOWN_COLOURS.street);
              else quad(soup, f0, n0, f1, n1, DOWNTOWN_COLOURS.street);
            }
            streets.push([s0, s1]);
            cursor = s1;
            block = 0;
            continue;
          }
          const pick =
            PDX_FRONT_MIX[Math.floor(h(k * 7 + Math.round(a), side, 1) * PDX_FRONT_MIX.length)] ??
            PDX.castIron;
          // The lot this building would take: tries the pick, then the shallowest front, and gives the lot
          // up (a gap) when neither stands.
          let variant: number = pick;
          let chosen = lotFor(pick, cursor, 0);
          if (!chosen && pick !== PDX.castIron) {
            variant = PDX.castIron;
            chosen = lotFor(PDX.castIron, cursor, 0);
          }
          if (!chosen) {
            cursor += 6;
            block += 6;
            continue;
          }
          const { width, s0, s1, s, d, p, turn, rect } = chosen;
          footprints.push(rect);
          const ground = groundOver(s0, s1, d);
          const base = {
            p: { x: p.x, y: ground.hi + LAND_TOP_M, z: p.z },
            turn,
            foot: ground.lo + LAND_TOP_M - PDX_SINK_M,
            edge: e.index,
            s,
            d,
          };
          if (variant === PDX.towerBase) {
            const targetM = 40 + 70 * h(k + Math.round(a), side, 3);
            place({
              ...base,
              model: 'tower',
              variant,
              rule: 'pdx-tower',
              sy: 1,
              mids: midsFor(targetM),
              targetM,
            });
          } else place({ ...base, model: 'kit', variant, rule: 'pdx-front', sy: 1 });
          cursor += width + (h(k + Math.round(a), side, 2) < 0.15 ? 5 : 0.4);
          block += width;
        }
        // The second row (playtest 4, P4-20), once every road's street fronts stand: taller buildings behind
        // the fronts, an alley back, with the cross streets running on between them. San Francisco's downtown
        // stands three deep; this is the Portland blocks' second. Each stands on the strip's wide land.
        later.push(() => {
          let at = a + 1;
          for (let k = 0; at < b - 6; k++) {
            const street = streets.find(([s0, s1]) => at < s1 + 1 && at + 4 > s0 - 1);
            if (street) {
              at = Math.max(at + 1, street[1] + 1);
              continue;
            }
            const pod = inPod(at, at + 1);
            if (pod) {
              at = Math.max(at + 1, Math.max(pod.s0, pod.s1) + 3);
              continue;
            }
            const first =
              PDX_BACK_MIX[Math.floor(h(k * 11 + Math.round(a), side, 21) * PDX_BACK_MIX.length)] ??
              PDX.officeBlock;
            // The pick, then the others (a narrower lot may fit where the pick does not): the first that
            // stands clear of a cross street, on this road's land and on ground.
            let pick: number = first;
            let chosen: ReturnType<typeof lotFor> = null;
            for (const variant of [first, PDX.officeBlock, PDX.brickLoft, PDX.castIron]) {
              const [wide] = size(variant);
              if (streets.some(([s0, s1]) => at < s1 + 1 && at + wide > s0 - 1)) continue;
              const lot = lotFor(variant, at, PDX_BACK_ROW_M);
              if (!lot || !offOtherLand(lot.rect, e.index, lot.p.y)) continue;
              pick = variant;
              chosen = lot;
              break;
            }
            if (!chosen) {
              // Past a cross street the lot after it starts at its far kerb.
              const into = streets.find(([s0, s1]) => at < s1 + 1 && at + size(first)[0] > s0 - 1);
              at = into ? Math.max(at + 1, into[1] + 1) : at + 6;
              continue;
            }
            const { width, s0, s1, s, d, p, turn, rect } = chosen;
            footprints.push(rect);
            const ground = groundOver(s0, s1, d);
            const base = {
              p: { x: p.x, y: ground.hi + LAND_TOP_M, z: p.z },
              turn,
              foot: ground.lo + LAND_TOP_M - PDX_SINK_M,
              edge: e.index,
              s,
              d,
            };
            if (pick === PDX.towerBase) {
              const targetM =
                PDX_BACK_TOWER_M[0] + (PDX_BACK_TOWER_M[1] - PDX_BACK_TOWER_M[0]) * h(k, side, 22);
              place({
                ...base,
                model: 'tower',
                variant: pick,
                rule: 'pdx-back-tower',
                sy: 1,
                mids: midsFor(targetM),
                targetM,
              });
            } else place({ ...base, model: 'kit', variant: pick, rule: 'pdx-back', sy: 1 });
            at += width + (h(k, side, 23) < 0.2 ? 4 : 0.6);
          }
          // A cross street runs on between the two rows to the land's edge, where a small cast-iron
          // front closes it, its face down the street (the street never ends in a drop).
          for (const [s0, s1] of streets) {
            if (s0 < a || s1 > b) continue;
            const r = Math.min(reach(side, s0), reach(side, s1));
            const [wide, deep] = size(PDX.castIron);
            if (r < PDX_BACK_ROW_M + deep) continue;
            const lot = lotFor(
              PDX.castIron,
              (s0 + s1) / 2 - wide / 2,
              Math.floor(r) - deep + PDX_OVERHANG_M - 2,
            );
            if (!lot || !offOtherLand(lot.rect, e.index, lot.p.y)) continue;
            footprints.push(lot.rect);
            const ground = groundOver(lot.s0, lot.s1, lot.d);
            place({
              p: { x: lot.p.x, y: ground.hi + LAND_TOP_M, z: lot.p.z },
              turn: lot.turn,
              foot: ground.lo + LAND_TOP_M - PDX_SINK_M,
              edge: e.index,
              s: lot.s,
              d: lot.d,
              model: 'kit',
              variant: PDX.castIron,
              rule: 'pdx-end',
              sy: 1,
            });
          }
        });
        // Bike racks on the sidewalk, away from the cross streets and from anything kept clear.
        for (let k = 0; ; k++) {
          const s = a + 9 + k * PDX_RACK_EVERY_M + (side > 0 ? PDX_RACK_EVERY_M / 2 : 0);
          if (s > b - 4) break;
          if (h(k + Math.round(a), side, 5) > 0.55) continue;
          if (streets.some(([s0, s1]) => s > s0 - 2 && s < s1 + 2)) continue;
          if (across(side, s - 2, s + 2, 0.5).some(([near, far]) => far > outer && near < outer + SIDEWALK_M))
            continue;
          if (reach(side, s) < SIDEWALK_M) continue;
          const d = side * (outer + 1.5);
          const p = w(s, d, 0.03);
          place({
            model: 'kit',
            variant: PDX.bikeRack,
            rule: 'pdx-rack',
            p,
            turn: faceRoad(p, s),
            sy: 1,
            foot: null,
            edge: e.index,
            s,
            d,
          });
        }
      }
    }

    // The cart pods: each carts stands in the lot behind its pedestrian zone, serving side to the road.
    for (const pod of pods) {
      const side: -1 | 1 = (pod.d0 + pod.d1) / 2 < 0 ? -1 : 1;
      const far = Math.max(Math.abs(pod.d0), Math.abs(pod.d1));
      const d = side * (far + PDX_CART_BACK_M);
      const lo = Math.min(pod.s0, pod.s1);
      const hi = Math.max(pod.s0, pod.s1);
      const first = Math.floor(h(0, side, 9) * 3);
      for (let k = 0, s = lo + 5; s <= hi - 5; k++, s += PDX_CART_PITCH_M) {
        // The cart's body runs 2.4 m back from its serving side; it must stand on drawn land.
        if (outerOf(side) + reach(side, s) < far + PDX_CART_BACK_M + 2.4) continue;
        const variant = PDX_CARTS[(first + k) % PDX_CARTS.length] ?? PDX.cartA;
        const p = w(s, d, 0.03);
        const turn = faceRoad(p, s);
        // A cart stands clear of every building (its body, and the table beside it).
        const rect = rectOf({ x: p.x, y: p.y, z: p.z }, turn, PDX_CART_WIDTH_M, PDX_CART_DEPTH_M);
        const shifted = {
          ...rect,
          cx: rect.cx + rect.ux * PDX_CART_MID_X_M,
          cz: rect.cz + rect.uz * PDX_CART_MID_X_M,
        };
        if (footprints.some((o) => rectsOverlap(shifted, o))) continue;
        footprints.push(shifted);
        place({
          model: 'kit',
          variant,
          rule: 'pdx-cart',
          p,
          turn,
          sy: 1,
          foot: null,
          edge: e.index,
          s,
          d,
        });
      }
    }
  }
  for (const job of later) job();
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

/** Whether a crossing on this edge lies within m of s. */
function crossingsNear(cs: readonly Crossing[], edge: number, s: number, m: number): boolean {
  return cs.some((c) => c.edge === edge && Math.abs(c.s - s) < c.half + m);
}

/** The last edge (in network order) with a plaza tag: the headquarters stands there. */
function lastDowntownEdge(road: RoadNetwork, dressing: RoadDressing | undefined): number {
  let last = -1;
  for (const e of road.edges) {
    const tags = dressing?.[e.id]?.tags ?? e.tags;
    if (tags.some((t) => t.tag === 'plaza')) last = e.index;
  }
  return last;
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
    /** CX3's tower modules with their atlas (models.ts `sfTowerModules`); without them the kit's towers stretch. */
    private readonly modules?: SceneryModel,
  ) {
    this.group.name = 'road-downtown';
    // Portland's blocks (T12.6) are drawn from the one kit; San Francisco's from its kit and the modules.
    this.plan = input.portland
      ? planPortland(input, kit)
      : planDowntown({ ...input, stacked: modules !== undefined });
    this.stretches = this.plan.stretches.map((s) => ({ ...s, mesh: null }));
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
   * mover is near. Returns the static items in view.
   */
  update(cameraX: number, cameraZ: number, dt: number, movers: readonly GateMover[]): number {
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
        meshes++;
        tris += (st.mesh.geometry.getAttribute('position')?.count ?? 0) / 3;
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
  private partsOf(it: DowntownItem): { g: BufferGeometry; lift: number; sy: number; sink: boolean }[] {
    if (it.model === 'tower' && this.input.portland) {
      // The pink tower: its three modules are the kit's own.
      const vs = this.kit.variants;
      const [base, mid, crown] = [vs[PDX.towerBase], vs[PDX.towerMid], vs[PDX.towerCrown]];
      if (!base || !mid || !crown) return [];
      const mids = it.mids ?? 1;
      const parts = [{ g: base, lift: 0, sy: 1, sink: true }];
      for (let k = 0; k < mids; k++)
        parts.push({ g: mid, lift: MODULE_M.base + k * MODULE_M.mid, sy: 1, sink: false });
      parts.push({ g: crown, lift: MODULE_M.base + mids * MODULE_M.mid, sy: 1, sink: false });
      return parts;
    }
    if (it.model === 'tower') {
      const style = MODULE_STYLE[it.variant];
      const vs = this.modules?.variants;
      const base = style === undefined ? undefined : vs?.[style * 3];
      const mid = style === undefined ? undefined : vs?.[style * 3 + 1];
      const crown = style === undefined ? undefined : vs?.[style * 3 + 2];
      if (!base || !mid || !crown) return [];
      const mids = it.mids ?? 1;
      const parts = [{ g: base, lift: 0, sy: 1, sink: true }];
      for (let k = 0; k < mids; k++)
        parts.push({ g: mid, lift: MODULE_M.base + k * MODULE_M.mid, sy: 1, sink: false });
      parts.push({ g: crown, lift: MODULE_M.base + mids * MODULE_M.mid, sy: 1, sink: false });
      return parts;
    }
    const g = (it.model === 'kit' ? this.kit : this.props)?.variants[it.variant];
    return g ? [{ g, lift: 0, sy: it.sy, sink: true }] : [];
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
    let total = soup ? soup.pos.length / 3 : 0;
    for (const { parts } of placed) for (const p of parts) total += p.g.getAttribute('position').count;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uv = map ? new Float32Array(total * 2) : null;
    let o = 0;
    if (soup) {
      pos.set(soup.pos, 0);
      col.set(soup.col, 0);
      o = soup.pos.length / 3;
      // Face normals for the surfaces.
      const a = new Vector3();
      const b = new Vector3();
      const c = new Vector3();
      for (let i = 0; i + 2 < o; i += 3) {
        a.fromArray(soup.pos, i * 3);
        b.fromArray(soup.pos, i * 3 + 3).sub(a);
        c.fromArray(soup.pos, i * 3 + 6).sub(a);
        b.cross(c).normalize();
        for (let k = 0; k < 3; k++) b.toArray(nrm, (i + k) * 3);
      }
      if (uv) for (let v = 0; v < o; v++) uv.set(ATLAS_WHITE_UV, v * 2);
    }
    for (const { it, parts } of placed) {
      const cos = Math.cos(it.turn);
      const sin = Math.sin(it.turn);
      for (const part of parts) {
        const g = part.g;
        const gp = g.getAttribute('position').array;
        const gn = g.getAttribute('normal').array;
        const gc = g.getAttribute('color').array;
        const guv = uv && hasAtlasUv(g) ? g.getAttribute('uv').array : null;
        const n = gp.length / 3;
        col.set(gc, o * 3);
        if (uv) {
          if (guv) uv.set(guv, o * 2);
          else for (let v = 0; v < n; v++) uv.set(ATLAS_WHITE_UV, (o + v) * 2);
        }
        for (let i = 0; i < n; i++, o++) {
          const x = gp[i * 3] ?? 0;
          const y = gp[i * 3 + 1] ?? 0;
          const z = gp[i * 3 + 2] ?? 0;
          pos[o * 3] = it.p.x + x * cos + z * sin;
          // A tower's foot reaches down under the slope; the rest scales with its height (a stacked
          // tower's modules stand at their heights, unscaled).
          pos[o * 3 + 1] =
            part.sink && it.foot !== null && y < 0.01 ? it.foot : it.p.y + part.lift + y * part.sy;
          pos[o * 3 + 2] = it.p.z + z * cos - x * sin;
          const nx = gn[i * 3] ?? 0;
          const nz = gn[i * 3 + 2] ?? 0;
          nrm[o * 3] = nx * cos + nz * sin;
          nrm[o * 3 + 1] = gn[i * 3 + 1] ?? 0;
          nrm[o * 3 + 2] = nz * cos - nx * sin;
        }
      }
    }
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
