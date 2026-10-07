// The downtowns' buildings as structures (the physical world, the maintainer, 2026-10-06: "consistent
// physics and gameplay is important here so players know what to expect and how to interact with the
// world"; a road race in a physical world with honest edges, "Yeah that sounds good :)"): San Francisco's
// towers (the front row on the sidewalk, the towers behind each plaza, the deadpan headquarters, the taller
// second row and the buildings lining each cross street) and downtown Portland's blocks (the street fronts,
// the second row, the fronts that close each cross street, the food carts and the bike racks).
//
// These are render/downtown.ts's own placement rules, moved here unchanged (road/furniture.ts is the
// precedent): the same seeded hash, the same mixes, lots, spacing, setbacks and keep-clear rules, so the
// streets look as they did. Render draws the lots from here; the structure plan (road/structures.ts) holds
// each one as a solid at its drawn shape (scripts/hitboxes.test.ts holds the two together). Three inputs
// render read and a plan may not, replaced:
// - San Francisco's `stacked` (whether CX3's tower modules had loaded) is always on: the lots are the
//   modules' footprints and every tower is stacked from them, as the shipping game drew them once its
//   models had loaded (render draws the old kit stretched to the same box if the modules ever fail to load).
// - Portland's lot sizes were the loaded kit's bounding boxes (`pdxFootprint`): they are the kit's fixed
//   boxes now (`STRUCTURE_MODELS`, held to the file within a centimetre).
// - Portland's drawn land (`RoadScene.landReach`) is the road scene's own strip rule, from the network
//   (road/land.ts `landReachOf`), held equal to the drawn scene's.
// The edges' own tags and features stand in for the road files render was handed (the same data).
//
// Pure + - * / and core math, like the rest of road/: the same network and seed give the same lots.
// A lazy chunk: it loads with the region's road data (STRUCTURE_LAYERS), never in the first load.
import { atan2, cos, sin } from '../../core';
import { landReachOf, LAND_STRIP_M, type LandReach } from '../land';

// The land rule the Portland lots stand on, for the render layer's tests (render may import this planner).
export { landReachOf, type LandReach };
import type { RoadNetwork } from '../network';
import {
  modelFoot,
  structureModel,
  type StructureClass,
  type StructureModel,
  type StructurePlanner,
  type StructureSpec,
} from '../structures';
import { scatterHash, themeAt, type SideTag, type SideTheme } from '../themes';
import type { BakedFeature } from '../types';

/** A point in the world, m. */
export interface LotPoint {
  x: number;
  y: number;
  z: number;
}

/** San Francisco's downtown kit (tools/blender/props/sf_downtown.py), by variant. */
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
/** Downtown Portland's kit (CX4, `models/scenery/pdx-downtown`), by variant. */
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

/** The models' asset ids (render/models.ts MODEL_ASSETS), for their fixed boxes. */
const SF_KIT_ID = 'models/scenery/sf-downtown';
const SF_MODULES_ID = 'models/scenery/sf-tower-modules';
const PDX_KIT_ID = 'models/scenery/pdx-downtown';

/**
 * CX3's stackable tower modules (`models/scenery/sf-tower-modules`): per style a base, a mid and a crown,
 * with these heights, m. A mid is four storeys and stacks onto itself and onto the base and the crown at
 * the same outline, so any whole number of mids makes a tower. Portland's pink tower stacks the same way.
 */
export const MODULE_M = { base: 7, mid: 14, crown: 8 } as const;
/** The module styles, in the model's variant order (variant = style * 3 + 0 base, 1 mid, 2 crown). */
export const MODULE_STYLE: Readonly<Record<number, number>> = {
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
export const OLD_HEIGHT_M: Readonly<Record<number, number>> = {
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
/** The old kit's footprints, m: what a tower's lot was before the modules (`towerFootprint(v, false)`). */
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
 * A tower variant's front width and depth, m: its module style's (the lots the game stands, `stacked`), or
 * the old kit's. The headquarters only has the kit's.
 */
export function towerFootprint(variant: number, stacked = true): readonly [number, number] {
  const style = MODULE_STYLE[variant];
  if (stacked && style !== undefined) return MODULE_FOOTPRINT[style] ?? [22, 20];
  return FOOTPRINT[variant] ?? [22, 20];
}

/** The mids that make a tower of `targetM` (a base, the mids and a crown): the nearest whole number. */
export function midsFor(targetM: number): number {
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

/** The verge past the drawn shoulder (render/road-mesh.ts VERGE_M). */
const VERGE_M = 0.6;
/** The drawn land's top over the road's height, m (render/scenery.ts LAND_TOP_M). */
export const LOT_LAND_TOP_M = -0.09;
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
/** Cross streets: their reach from the avenue, m. */
export const CROSS_REACH_M = 200;
/** Buildings line a cross street this far out (past it, the fog and the backdrop's skyline). */
const CROSS_BUILT_M = 120;
/** A cable-car street's grade up the hill on the avenue's left. [default] steep, as the city's are. */
export const CABLE_GRADE = 0.16;
/** A plain cross street drops this much per metre past the land strip, down to CROSS_FLOOR_Y. */
const CROSS_DROP = 0.05;
const CROSS_FLOOR_Y = 0.6;
/** The city floor under the blocks, m: a back tower's foot reaches a metre under it. */
export const CITY_FLOOR_Y = 0.45;
/** Features nothing of this layer stands in, with room round them (road-mesh.ts KEEP_CLEAR). */
const KEEP_CLEAR = new Set(['billboard', 'boostPad', 'rampTruck', 'roadsideZone', 'copSpawn']);
const FEATURE_CLEAR_M = 2.5;
/** A tower's base reaches this far under the ground, so it never shows a gap on the slope behind. */
const TOWER_SINK_M = 6;

/** The downtown tags (any of them makes a network a downtown). */
export const DOWNTOWN_TAGS: readonly string[] = ['towers', 'plaza', 'cross-street', 'cable-crossing'];

/**
 * One placed building: a variant of a kit, or a stacked tower (`model: 'tower'`: `variant` is the kit
 * variant it stands in for, which picks its module style; `mids` is how many mids it stacks). Render draws
 * it; `solid` is the structure it is.
 */
export interface DowntownLot {
  model: 'kit' | 'tower';
  variant: number;
  rule: string;
  /** Its front's middle at its base, world m. */
  p: LotPoint;
  /** Turn about the vertical (the model's +Z goes to (sin, cos) in x, z). */
  turn: number;
  /** Height scale: always 1 (a stacked tower is never stretched). */
  sy: number;
  /** A stacked tower: how many four-storey mids, and the height it was asked to be, m. */
  mids?: number;
  targetM?: number;
  /** World y its base is pushed down to (a building's foot under the slope), or null. */
  foot: number | null;
  edge: number;
  s: number;
  d: number;
  /** The solid it is, at its drawn shape. */
  solid: StructureSpec;
}

/** One block's cross street on San Francisco's avenue. */
export interface Crossing {
  edge: number;
  s: number;
  /** Half its width along the avenue (the tag's span), m. */
  half: number;
  cable: boolean;
  /** The avenue's centre at the crossing, the unit vector across it (toward +d) and along it. */
  centre: LotPoint;
  across: { x: number; z: number };
  along: { x: number; z: number };
  /** Half the avenue's drawn width: the verge's outer edge, m. */
  outer: number;
  /** The avenue's height at the crossing (the cross street's starts there), m. */
  roadY: number;
}

/** A cross street's height at u across the avenue (signed, toward +d), for a crossing at road height y. */
export function crossProfile(c: Pick<Crossing, 'cable' | 'outer'>, roadY: number, u: number): number {
  const out = Math.abs(u) - c.outer;
  if (out <= 0) return roadY;
  // The cable street climbs the hill on the avenue's left from a short flat at the corner.
  if (c.cable && u < 0) return roadY + CABLE_GRADE * Math.max(0, out - 6);
  return Math.max(CROSS_FLOOR_Y, roadY - 0.05 - CROSS_DROP * Math.max(0, out - LAND_STRIP_M));
}

/** San Francisco's downtown: its buildings and its crossings. */
export interface SfDowntownLots {
  lots: DowntownLot[];
  crossings: Crossing[];
}

/** A model's box as a structure's: its fixed box, and the world box a placed lot of it fills. */
function lotSolid(
  rule: string,
  cls: StructureClass,
  id: string,
  box: StructureModel,
  lot: Omit<DowntownLot, 'solid'>,
  topOverBase: number,
): StructureSpec {
  // The drawn bottom: the model's foot pushed down to `foot`, or its own underside.
  const own = lot.p.y + box.y0 * lot.sy;
  const baseY = lot.foot === null ? own : Math.min(lot.foot, own);
  return {
    rule,
    cls,
    model: id,
    edge: lot.edge,
    s: lot.s,
    d: lot.d,
    foot: modelFoot(box, { x: lot.p.x, z: lot.p.z, yaw: lot.turn, scale: 1 }),
    baseY,
    roof: { kind: 'flat', topM: lot.p.y + topOverBase - baseY },
  };
}

/** The box a stack of a base, mids and a crown fills (the three modules' outlines together), m. */
function stackBox(baseId: string, midId: string, crownId: string, mids: number): StructureModel {
  const b = structureModel(baseId);
  const m = structureModel(midId);
  const c = structureModel(crownId);
  return {
    x0: Math.min(b.x0, m.x0, c.x0),
    x1: Math.max(b.x1, m.x1, c.x1),
    y0: b.y0,
    y1: MODULE_M.base + mids * MODULE_M.mid + c.y1,
    z0: Math.min(b.z0, m.z0, c.z0),
    z1: Math.max(b.z1, m.z1, c.z1),
    what: `${b.what}, ${mids} mids and a crown`,
  };
}

/** A lot with its solid: a kit model's fixed box, or a stack of a kit's or the modules' three parts. */
function withSolid(lot: Omit<DowntownLot, 'solid'>, kit: string, cls: StructureClass): DowntownLot {
  if (lot.model === 'tower') {
    const mids = lot.mids ?? 1;
    const ids =
      kit === PDX_KIT_ID
        ? [PDX.towerBase, PDX.towerMid, PDX.towerCrown].map((v) => `${PDX_KIT_ID}#${v}`)
        : [0, 1, 2].map((k) => `${SF_MODULES_ID}#${(MODULE_STYLE[lot.variant] ?? 0) * 3 + k}`);
    const box = stackBox(ids[0] ?? '', ids[1] ?? '', ids[2] ?? '', mids);
    return { ...lot, solid: lotSolid(lot.rule, cls, ids[0] ?? '', box, lot, box.y1) };
  }
  const id = `${kit}#${lot.variant}`;
  const box = structureModel(id);
  return { ...lot, solid: lotSolid(lot.rule, cls, id, box, lot, box.y1 * lot.sy) };
}

/** The last edge (in network order) with a plaza tag: the headquarters stands there. */
function lastPlazaEdge(road: RoadNetwork): number {
  let last = -1;
  for (const e of road.edges) if (e.tags.some((t) => t.tag === 'plaza')) last = e.index;
  return last;
}

/** Whether a crossing on this edge lies within m of s. */
function crossingsNear(cs: readonly Crossing[], edge: number, s: number, m: number): boolean {
  return cs.some((c) => c.edge === edge && Math.abs(c.s - s) < c.half + m);
}

/** The runs of s where a side's theme is `want`, at 2 m steps: [start, end] pairs. */
function themeRuns(
  tags: readonly SideTag[],
  length: number,
  side: -1 | 1,
  want: SideTheme,
): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let s = 0; s <= length + 1e-6; s += 2) {
    const here = themeAt(tags, side < 0 ? 'left' : 'right', Math.min(s, length)) === want;
    if (here && start < 0) start = s;
    if ((!here || s + 2 > length + 1e-6) && start >= 0) {
      out.push([start, here ? length : s - 2]);
      start = -1;
    }
  }
  return out;
}

/** The heading from p to the road's centre line at s, as a turn. */
function facing(road: RoadNetwork, edge: number, p: LotPoint, s: number): number {
  const c = road.toWorld(edge, s, 0, 0);
  return atan2(c.x - p.x, c.z - p.z);
}

const keptSf = new WeakMap<RoadNetwork, Map<number, SfDowntownLots>>();

/**
 * San Francisco's downtown for a network and seed (render/downtown.ts's rules): the towers shoulder to
 * shoulder behind a 3.4 m sidewalk (the sim's hard edge), the towers behind each plaza, the headquarters
 * behind the last plaza, a taller second row, the buildings lining each cross street, and the crossings
 * themselves. Kept per network and seed.
 */
export function planSfDowntown(road: RoadNetwork, seed: number): SfDowntownLots {
  const known = keptSf.get(road)?.get(seed);
  if (known) return known;
  const lots: DowntownLot[] = [];
  const crossings: Crossing[] = [];
  const place = (lot: Omit<DowntownLot, 'solid'>) =>
    lots.push(withSolid(lot, lot.model === 'kit' ? SF_KIT_ID : SF_MODULES_ID, 'building'));
  /** A tower of the kit's variant, `scale` times its old height, stacked from the modules. */
  const towerOf = (
    variant: number,
    scale: number,
  ): Pick<DowntownLot, 'model' | 'sy' | 'mids' | 'targetM'> => {
    if (MODULE_STYLE[variant] === undefined) return { model: 'kit', sy: scale };
    const targetM = Math.max(MIN_STACK_M, (OLD_HEIGHT_M[variant] ?? 40) * scale);
    return { model: 'tower', sy: 1, mids: midsFor(targetM), targetM };
  };
  const footprint = (variant: number) => towerFootprint(variant);
  const hqEdge = lastPlazaEdge(road);
  for (const e of road.edges) {
    const tags = e.tags as readonly SideTag[];
    if (!tags.some((t) => DOWNTOWN_TAGS.includes(t.tag))) continue;
    const features = e.features.filter((f) => KEEP_CLEAR.has(f.kind));
    const h = (k: number, side: number, salt: number) =>
      scatterHash(seed, 4111 + e.index * 977, k, side * 37 + salt);
    const outerOf = (side: -1 | 1) => (side < 0 ? -e.dMin : e.dMax) + VERGE_M;
    const runs = (side: -1 | 1, want: SideTheme) => themeRuns(tags, e.length, side, want);
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
      const al = Math.sqrt(ax * ax + az * az) || 1;
      const fx = f.x - b.x;
      const fz = f.z - b.z;
      const fl = Math.sqrt(fx * fx + fz * fz) || 1;
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
          p: { x: p.x, y: w(s, 0, 0).y + LOT_LAND_TOP_M, z: p.z },
          turn: facing(road, e.index, p, s),
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
      // The front row of towers along each downtown run, shoulder to shoulder, a narrow alley now
      // and then; towers behind each plaza.
      for (const [want, back] of [
        ['downtown', SIDEWALK_M],
        ['plaza', PLAZA_TOWERS_M],
      ] as const) {
        const mix = want === 'plaza' ? BACK_MIX : FRONT_MIX;
        for (const [a, b] of runs(side, want)) {
          let cursor = a + 1;
          for (let k = 0; ; k++) {
            const variant = mix[Math.floor(h(k * 7 + Math.round(a), side, 1) * mix.length)];
            if (variant === undefined) break;
            let [width, depth] = footprint(variant);
            let pick = variant;
            // Near the run's end a narrower building fills what is left (the widest style that still
            // fits, so the frontage stays near-continuous).
            if (cursor + width > b - 0.5) {
              const narrow = STACKED_FILL.find((v) => cursor + footprint(v)[0] <= b - 0.5);
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
              p: { x: p.x, y: p.y + LOT_LAND_TOP_M, z: p.z },
              turn: facing(road, e.index, p, s),
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
          if (s + 17 > b) break;
          if (h(k + Math.round(a), side, 4) < 0.25) continue;
          const variant =
            BACK_MIX[Math.floor(h(k + Math.round(a), side, 5) * BACK_MIX.length)] ?? DT.towerGlass;
          if (crossingsNear(crossings, e.index, s, 30)) continue;
          const d = side * (outer + BACK_ROW_M + 10 * h(k, side, 6));
          const p = w(s, d, 0);
          place({
            ...towerOf(variant, 1.2 + 1.0 * h(k + Math.round(a), side, 7)),
            variant,
            rule: 'back-tower',
            p: { x: p.x, y: w(s, 0, 0).y + LOT_LAND_TOP_M, z: p.z },
            turn: facing(road, e.index, p, s),
            foot: CITY_FLOOR_Y - 1,
            edge: e.index,
            s,
            d,
          });
        }
      }
    }
  }
  // The buildings lining each cross street, both sides, from behind the avenue's corner towers out
  // (stepping up the hill on a cable street).
  for (const c of crossings) {
    const at = (u: number, v: number): LotPoint => ({
      x: c.centre.x + c.across.x * u + c.along.x * v,
      y: crossProfile(c, c.roadY, u),
      z: c.centre.z + c.across.z * u + c.along.z * v,
    });
    for (const sign of [-1, 1] as const) {
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
            turn: atan2(toStreet.x - base.x, toStreet.z - base.z),
            foot: CITY_FLOOR_Y - 1,
            edge: c.edge,
            s: c.s,
            d: sign * u,
          });
        }
      }
    }
  }
  const out: SfDowntownLots = { lots, crossings };
  let bySeed = keptSf.get(road);
  if (!bySeed) keptSf.set(road, (bySeed = new Map<number, SfDowntownLots>()));
  bySeed.set(seed, out);
  return out;
}

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
/** A building keeps this far from any road's verge, m: the sidewalk less what a front's corner may give. */
export const PDX_ROAD_CLEAR_M = SIDEWALK_M - 0.6;

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
export function rectOf(p: LotPoint, turn: number, width: number, depth: number): Rect {
  const vx = sin(turn);
  const vz = cos(turn);
  return {
    cx: p.x - (vx * depth) / 2,
    cz: p.z - (vz * depth) / 2,
    ux: vz,
    uz: -vx,
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

/** The grid square the road's cuts are filed by, m. */
const CUT_CELL_M = 16;

/**
 * Every road of a network as cuts across its lanes: one each metre along every edge (a branch, a
 * shortcut's connector, a junction's other road), from one side's lane edge to the other's, `clear` past
 * each, filed by grid square. `crosses(r, except)` says whether a footprint crosses any of them (but
 * those of the edge `except`). Playtest 4's phone play (2026-10-06: "in bridge city near shortcut(?)
 * junctions in two places it seems like there's a building in the road"): the Morrison shortcut's
 * connectors stood their fronts on the main road's connector and on the Hawthorne Bridge's end, which a
 * projection of nine points onto the building's own road and its neighbours never saw.
 */
export function roadCuts(road: RoadNetwork, clear: number): { crosses(r: Rect, except?: number): boolean } {
  const cuts: number[] = [];
  const cells = new Map<number, number[]>();
  const cell = (v: number) => Math.floor(v / CUT_CELL_M);
  const key = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
  for (const e of road.edges) {
    const n = Math.max(1, Math.ceil(e.length));
    for (let k = 0; k <= n; k++) {
      const s = (e.length * k) / n;
      let lo = 0;
      let hi = 0;
      for (const lane of road.lanesAt(e.index, s)) {
        lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
        hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
      }
      const a = road.toWorld(e.index, s, lo - clear, 0);
      const b = road.toWorld(e.index, s, hi + clear, 0);
      const id = cuts.length / 5;
      cuts.push(a.x, a.z, b.x, b.z, e.index);
      for (let i = cell(Math.min(a.x, b.x)); i <= cell(Math.max(a.x, b.x)); i++)
        for (let j = cell(Math.min(a.z, b.z)); j <= cell(Math.max(a.z, b.z)); j++) {
          const list = cells.get(key(i, j));
          if (list) list.push(id);
          else cells.set(key(i, j), [id]);
        }
    }
  }
  /** Whether the segment (x0, z0)-(x1, z1) passes through the footprint (Liang-Barsky in its axes). */
  const through = (r: Rect, x0: number, z0: number, x1: number, z1: number): boolean => {
    const u0 = (x0 - r.cx) * r.ux + (z0 - r.cz) * r.uz;
    const v0 = (x0 - r.cx) * r.vx + (z0 - r.cz) * r.vz;
    const du = (x1 - r.cx) * r.ux + (z1 - r.cz) * r.uz - u0;
    const dv = (x1 - r.cx) * r.vx + (z1 - r.cz) * r.vz - v0;
    let t0 = 0;
    let t1 = 1;
    // Each pair keeps p * t <= q.
    for (const [p, q] of [
      [-du, u0 + r.hw],
      [du, r.hw - u0],
      [-dv, v0 + r.hd],
      [dv, r.hd - v0],
    ] as const) {
      if (Math.abs(p) < 1e-12) {
        if (q < 0) return false;
      } else if (p < 0) t0 = Math.max(t0, q / p);
      else t1 = Math.min(t1, q / p);
      if (t0 > t1) return false;
    }
    return true;
  };
  const seen = new Set<number>();
  return {
    crosses(r: Rect, except = -1): boolean {
      const ex = r.hw * Math.abs(r.ux) + r.hd * Math.abs(r.vx);
      const ez = r.hw * Math.abs(r.uz) + r.hd * Math.abs(r.vz);
      seen.clear();
      for (let i = cell(r.cx - ex); i <= cell(r.cx + ex); i++)
        for (let j = cell(r.cz - ez); j <= cell(r.cz + ez); j++)
          for (const id of cells.get(key(i, j)) ?? []) {
            if (seen.has(id)) continue;
            seen.add(id);
            const o = id * 5;
            if (cuts[o + 4] === except) continue;
            if (through(r, cuts[o] ?? 0, cuts[o + 1] ?? 0, cuts[o + 2] ?? 0, cuts[o + 3] ?? 0)) return true;
          }
      return false;
    },
  };
}

/** The width and depth of one of Portland's kit models, m: its fixed box (the front is at z = 0). */
export function pdxLot(variant: number): readonly [number, number] {
  const m = structureModel(`${PDX_KIT_ID}#${variant}`);
  return [m.x1 - m.x0, Math.max(0, -m.z0)];
}

/** A stretch of a Portland side drawn at the road's height: a sidewalk and lot, or a cross street's asphalt. */
export interface PdxGround {
  edge: number;
  side: -1 | 1;
  s0: number;
  s1: number;
  /** How far past the verge it is drawn, m. */
  reach: number;
}

/** Downtown Portland: its buildings, carts and racks, and the ground they stand on. */
export interface PdxDowntownLots {
  lots: DowntownLot[];
  /** The paving: a sidewalk past the verge and the lot behind it, out to the land's edge, per 6 m. */
  paving: PdxGround[];
  /** The cross streets' asphalt, from the verge out across the land. */
  streets: PdxGround[];
}

const keptPdx = new WeakMap<RoadNetwork, Map<number, PdxDowntownLots>>();

/**
 * Downtown Portland's blocks for a network and seed (playtest 3, T12.6; wave B's punch list, item 3;
 * render/downtown.ts's rules): on every `pdx-blocks` side of the road, a front row of CX4's cast-iron
 * fronts, brick lofts, office blocks and now and then a pink tower (stacked from its modules), a cross
 * street every block, a taller second row behind, a small front closing each cross street, bike racks on
 * the sidewalk, and a pod of food carts where a pedestrian zone says `dressing: food-carts`. Everything
 * stands on the land the road scene draws (road/land.ts): a building keeps clear of every feature the road
 * keeps clear (a zone, a sign, a landmark), moves back behind one that only crosses its front, and gives
 * up its lot where it cannot stand on ground. Kept per network and seed. `landOverride` replaces the land
 * (tests' controls only; such a plan is not kept).
 */
export function planPdxDowntown(road: RoadNetwork, seed: number, landOverride?: LandReach): PdxDowntownLots {
  const known = landOverride ? undefined : keptPdx.get(road)?.get(seed);
  if (known) return known;
  const land = landOverride ?? landReachOf(road);
  const lots: DowntownLot[] = [];
  const paving: PdxGround[] = [];
  const streetsOut: PdxGround[] = [];
  const place = (lot: Omit<DowntownLot, 'solid'>) => {
    const cls: StructureClass =
      lot.rule === 'pdx-cart' ? 'shed' : lot.rule === 'pdx-rack' ? 'wall' : 'building';
    lots.push(withSolid(lot, PDX_KIT_ID, cls));
  };
  const size = (variant: number) => pdxLot(variant);
  /** Every building placed so far, on any road: two roads' fronts meet at a corner and must not overlap. */
  const footprints: Rect[] = [];
  /** Every road's lanes and a sidewalk's clearance past them, branches and connectors included. */
  const cuts = roadCuts(road, PDX_ROAD_CLEAR_M);
  /** A rack or a cart only keeps off the lanes themselves (it stands on a sidewalk, by design). */
  const laneCuts = roadCuts(road, 0.3);
  /** Work that waits until every road's street fronts stand: the second row never takes a front's lot. */
  const later: (() => void)[] = [];
  const corners = (r: Rect) => {
    const at = (a: number, b: number) => ({ x: r.cx + r.ux * a + r.vx * b, z: r.cz + r.uz * a + r.vz * b });
    return [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => at(i * r.hw, j * r.hd)));
  };
  /**
   * Whether none of a footprint's corners, edge middles and centre lies on another road's land at a
   * different height: its strip is drawn there at its own level, which would bury or float the building.
   */
  const offOtherLand = (r: Rect, own: number, y: number): boolean =>
    corners(r).every((q) => {
      const pos = road.project(q.x, q.z, own);
      const e2 = road.edges[pos.edge];
      if (pos.edge === own || !e2) return true;
      const side: -1 | 1 = pos.d < 0 ? -1 : 1;
      const out = (side < 0 ? -e2.dMin : e2.dMax) + VERGE_M;
      if (Math.abs(pos.d) > out + land(pos.edge, side, pos.s) + 1) return true;
      return Math.abs(road.toWorld(pos.edge, pos.s, 0, 0).y - y) <= 1;
    });
  /**
   * Whether none of a footprint's corners, edge middles and centre lies on a road, or within a sidewalk of
   * one (the inside of a bend and a junction's other road, which the land strip does not see): each point
   * is projected onto the nearest road of the edge's neighbourhood.
   */
  const clearOfRoads = (r: Rect, hint: number): boolean =>
    corners(r).every((q) => {
      const pos = road.project(q.x, q.z, hint);
      const e2 = road.edges[pos.edge];
      if (!e2) return true;
      const edge = pos.d < 0 ? -e2.dMin : e2.dMax;
      return Math.abs(pos.d) >= edge + PDX_ROAD_CLEAR_M;
    });
  for (const e of road.edges) {
    const tags = e.tags as readonly SideTag[];
    if (!tags.some((t) => t.tag === 'pdx-blocks')) continue;
    const all: readonly BakedFeature[] = e.features;
    // A landmark that says `params.sightM` also keeps that much of its own side clear of buildings before
    // its start (the side a rider comes from), so a roof sign shows whole from down the road, not over a
    // front row that hides it (playtest 4, P1: the roof sign showed only "S" or "STI...").
    const features = all
      .filter((f) => PDX_CLEAR.has(f.kind))
      .flatMap((f) => {
        const view = f.kind === 'landmark' ? Number(f.params?.['sightM']) : 0;
        if (!(view > 0)) return [f];
        const start = Math.min(f.s0, f.s1);
        return [f, { ...f, s0: start - view, s1: start }];
      });
    const pods = all.filter((f) => f.kind === 'roadsideZone' && f.params?.['dressing'] === PDX_PODS);
    const h = (k: number, side: number, salt: number) =>
      scatterHash(seed, 5113 + e.index * 977, k, side * 37 + salt);
    const outerOf = (side: -1 | 1) => (side < 0 ? -e.dMin : e.dMax) + VERGE_M;
    const w = (s: number, d: number, hgt: number) => road.toWorld(e.index, s, d, hgt);
    const reach = (side: -1 | 1, s: number) =>
      Math.min(land(e.index, side, s), land(e.index, side, Math.min(e.length, s + 2)));
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
    /**
     * How far past the verge a side's paving may run at each of `at` before it meets another road's lanes,
     * m (`upTo` when it meets none before it). A connector's or a bridge's side reaches over the road beside
     * it at a split or a join, at its own height: the Hawthorne Bridge's lot floor stood a metre over the
     * Morrison shortcut's way back (playtest 4's phone play, 2026-10-06).
     */
    const offLanes = (side: -1 | 1, outer: number, at: readonly number[], upTo: number) => {
      let out = upTo;
      for (const s of at)
        for (let t = 0; t < out; t += 1) {
          const p = w(Math.min(e.length, s), side * (outer + t), 0);
          if (laneCuts.crosses({ cx: p.x, cz: p.z, ux: 1, uz: 0, vx: 0, vz: 1, hw: 0.5, hd: 0.5 }, e.index)) {
            out = Math.max(0, t - 0.5);
            break;
          }
        }
      return out;
    };
    /** The ground a building over s0..s1 at d stands on: its highest and lowest road height there, m. */
    const groundOver = (s0: number, s1: number, d: number) => {
      let hi = -Infinity;
      let lo = Infinity;
      // Every 2 m or closer (four looks missed a crest under a short connector's front by a centimetre).
      const n = Math.max(3, Math.ceil((s1 - s0) / 2));
      for (let i = 0; i <= n; i++) {
        const y = w(Math.max(0, Math.min(e.length, s0 + ((s1 - s0) * i) / n)), d, 0).y;
        hi = Math.max(hi, y);
        lo = Math.min(lo, y);
      }
      return { hi, lo };
    };

    for (const side of [-1, 1] as const) {
      const outer = outerOf(side);
      const streets: [number, number][] = [];
      for (const [a, b] of themeRuns(tags, e.length, side, 'blocks')) {
        // The paving: a sidewalk past the verge, and the lot behind it out to the land's edge.
        for (let s = a; s < b; s += 6) {
          const s1 = Math.min(b, s + 6);
          const r = offLanes(side, outer, [s, (s + s1) / 2, s1], Math.min(reach(side, s), reach(side, s1)));
          if (r < 1) continue;
          paving.push({ edge: e.index, side, s0: s, s1, reach: r });
        }
        // A food-cart pod is a lot: the carts stand in it (below), and no building does.
        const inPod = (s0: number, s1: number) =>
          pods.find(
            (p) =>
              (p.d0 + p.d1 < 0 ? -1 : 1) === side &&
              s0 < Math.max(p.s0, p.s1) + 2 &&
              s1 > Math.min(p.s0, p.s1) - 2,
          );
        // The cross streets this side's features ask for (playtest 4, B7: Old Town's Chinatown gate is a
        // landmark that says `params.crossStreet`, and stands over a street's mouth): a street opens centred
        // on each, PDX_STREET_M wide, and no building takes a lot across it.
        const gates = all
          .filter(
            (f) =>
              f.kind === 'landmark' &&
              f.params?.['crossStreet'] === true &&
              (f.d0 + f.d1 < 0 ? -1 : 1) === side,
          )
          .map((f): [number, number] => {
            const mid = (f.s0 + f.s1) / 2;
            return [mid - PDX_STREET_M / 2, mid + PDX_STREET_M / 2];
          })
          .filter(([g0, g1]) => g0 >= a && g1 <= b)
          .sort((x, y) => x[0] - y[0]);
        /** Where the front row goes on from `from` towards `to`: not past the start of a gate's street. */
        const advance = (from: number, to: number) => {
          const g = gates.find(([g0]) => g0 >= from - 0.3 && g0 < to);
          return g ? Math.max(from, g[0]) : to;
        };
        /** A gate's street that a lot over [s0, s1] would cross. */
        const gateAcross = (s0: number, s1: number) =>
          gates.find(([g0, g1]) => s0 < g1 - 0.3 && s1 > g0 - 0.3);
        /**
         * The lot a building of `variant` would take at `at` along the road (its front standing at least
         * `minBack` past the verge), and whether it stands on ground: null where it does not fit.
         */
        const lotFor = (variant: number, at: number, minBack: number) => {
          const [width, depth] = size(variant);
          if (!(width > 0) || at + width > b || inPod(at, at + width) || gateAcross(at, at + width))
            return null;
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
          const turn = facing(road, e.index, p, s);
          const rect = rectOf(p, turn, width, depth);
          // Not over a road (the inside of a bend, a junction, a branch or a shortcut's connector beside
          // this one) and not over another building.
          if (
            !clearOfRoads(rect, e.index) ||
            cuts.crosses(rect) ||
            footprints.some((o) => rectsOverlap(rect, o))
          )
            return null;
          return { width, depth, back, s0, s1, s, d, p, turn, rect };
        };
        /** A building on its lot: its front's middle at the highest ground along it, its foot under the lowest. */
        const build = (
          lot: NonNullable<ReturnType<typeof lotFor>>,
          what: Pick<DowntownLot, 'model' | 'variant' | 'rule' | 'mids' | 'targetM'>,
        ) => {
          footprints.push(lot.rect);
          const ground = groundOver(lot.s0, lot.s1, lot.d);
          place({
            ...what,
            p: { x: lot.p.x, y: ground.hi + LOT_LAND_TOP_M, z: lot.p.z },
            turn: lot.turn,
            sy: 1,
            foot: ground.lo + LOT_LAND_TOP_M - PDX_SINK_M,
            edge: e.index,
            s: lot.s,
            d: lot.d,
          });
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
          // A cross street: its asphalt from the verge out across the land.
          const openStreet = (s0: number, s1: number) => {
            const r = offLanes(
              side,
              outer,
              [s0, (s0 + s1) / 2, s1],
              Math.min(reach(side, s0), reach(side, s1)),
            );
            if (r >= 1) streetsOut.push({ edge: e.index, side, s0, s1, reach: r });
            streets.push([s0, s1]);
            cursor = s1;
            block = 0;
          };
          // The street a gate asks for opens where the front row reaches it (the lots before it end short of it).
          const gate = gates.find(([g0, g1]) => cursor < g1 && cursor >= g0 - 0.3);
          if (gate) {
            openStreet(Math.max(cursor, gate[0]), gate[1]);
            continue;
          }
          // The block's own cross street, unless a gate's street is about to open close ahead.
          const gateAhead = gates.find(([g0]) => g0 > cursor && g0 - cursor < PDX_BLOCK_M / 2);
          if (block >= PDX_BLOCK_M && !gateAhead) {
            openStreet(cursor, Math.min(b, cursor + PDX_STREET_M));
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
            const before = cursor;
            cursor = advance(cursor, cursor + 6);
            block += cursor - before;
            continue;
          }
          if (variant === PDX.towerBase) {
            const targetM = 40 + 70 * h(k + Math.round(a), side, 3);
            build(chosen, { model: 'tower', variant, rule: 'pdx-tower', mids: midsFor(targetM), targetM });
          } else build(chosen, { model: 'kit', variant, rule: 'pdx-front' });
          cursor = advance(cursor, cursor + chosen.width + (h(k + Math.round(a), side, 2) < 0.15 ? 5 : 0.4));
          block += chosen.width;
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
            if (pick === PDX.towerBase) {
              const targetM =
                PDX_BACK_TOWER_M[0] + (PDX_BACK_TOWER_M[1] - PDX_BACK_TOWER_M[0]) * h(k, side, 22);
              build(chosen, {
                model: 'tower',
                variant: pick,
                rule: 'pdx-back-tower',
                mids: midsFor(targetM),
                targetM,
              });
            } else build(chosen, { model: 'kit', variant: pick, rule: 'pdx-back' });
            at += chosen.width + (h(k, side, 23) < 0.2 ? 4 : 0.6);
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
            build(lot, { model: 'kit', variant: PDX.castIron, rule: 'pdx-end' });
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
          const turn = facing(road, e.index, p, s);
          // A connector's sidewalk can lie over a sibling road's lanes at a split or a join: no rack there.
          const [rackW, rackD] = size(PDX.bikeRack);
          if (laneCuts.crosses(rectOf(p, turn, rackW, Math.max(rackD, 0.5)))) continue;
          place({
            model: 'kit',
            variant: PDX.bikeRack,
            rule: 'pdx-rack',
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

    // The cart pods: each cart stands in the lot behind its pedestrian zone, serving side to the road.
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
        const turn = facing(road, e.index, p, s);
        // A cart stands clear of every building (its body, and the table beside it).
        const rect = rectOf(p, turn, PDX_CART_WIDTH_M, PDX_CART_DEPTH_M);
        const shifted = {
          ...rect,
          cx: rect.cx + rect.ux * PDX_CART_MID_X_M,
          cz: rect.cz + rect.uz * PDX_CART_MID_X_M,
        };
        if (footprints.some((o) => rectsOverlap(shifted, o)) || laneCuts.crosses(shifted)) continue;
        footprints.push(shifted);
        place({ model: 'kit', variant, rule: 'pdx-cart', p, turn, sy: 1, foot: null, edge: e.index, s, d });
      }
    }
  }
  for (const job of later) job();
  const out: PdxDowntownLots = { lots, paving, streets: streetsOut };
  if (landOverride) return out;
  let bySeed = keptPdx.get(road);
  if (!bySeed) keptPdx.set(road, (bySeed = new Map<number, PdxDowntownLots>()));
  bySeed.set(seed, out);
  return out;
}

/** San Francisco's downtown as a structure layer: every building of `planSfDowntown`, at its drawn shape. */
export const SF_DOWNTOWN_STRUCTURES: StructurePlanner = {
  plan(road, seed, out) {
    for (const lot of planSfDowntown(road, seed).lots) out.add(lot.solid);
  },
};

/** Downtown Portland as a structure layer: every building, cart and rack of `planPdxDowntown`. */
export const PDX_DOWNTOWN_STRUCTURES: StructurePlanner = {
  plan(road, seed, out) {
    for (const lot of planPdxDowntown(road, seed).lots) out.add(lot.solid);
  },
};
