// Key West's Old Town street fronts as structures (the physical world, the maintainer, 2026-10-06: "consistent
// physics and gameplay is important here so players know what to expect and how to interact with the world";
// buildings are walls up to the roofline, roofs a rider lands on and rides, a row of roofs to run along,
// pitched roofs as slopes). Duval and Whitehead Streets stand Codex CX2's Duval kit end to end along both
// sidewalks (render/roadside.ts KEYS_KIT `oldtown-front`), CX5's open bars among them (`oldtown-bar`) and a
// second row of conch houses behind (`oldtown-back`). This module is where each of them stands: render's
// street-front rule (`Frontage`), moved here unchanged (the same seeded hash, gaps, lots, fit tests and
// order), so render draws the plan and the sim meets it.
//
// What render read that a plan may not, and what the plan reads instead (2026-10-06):
// - the loaded model's bounding box (a lot's width and depth): the committed file's box, `STRUCTURE_MODELS`
//   (scripts/hitboxes.test.ts holds the rows to the files);
// - the drawn land's reach (`RoadScene.landReach`): the same strip rule, land.ts, held equal to render's;
// - the landmarks' ground: from the road (landmark-places.ts `landmarkGround`), not once the landmark kits
//   have loaded (render added it when they arrived, so the fronts could move then);
// - the scenery and the staged scenes already standing, and every other roadside prop: not read. On the
//   seeds the tests use none of them ever stood in a front's way; render's scatter now keeps off the fronts
//   instead (render/roadside.ts). The street furniture the plan has (road/furniture.ts) still counts, in
//   render's order;
// - the roadside density slider: not read (render skipped the fronts at density 0; they stand at any density
//   now, as the street furniture does).
//
// Each building is its solid parts at its drawn shape (`OLDTOWN_PARTS`, from the kits' Blender scripts,
// tools/blender/props/duval_kit.py and keys_identity.py, held to the committed files by
// scripts/structure-parts.test.ts): the body to its roof (pitched roofs as slopes, a hipped end as a few
// slices), the balcony and its posts over the sidewalk, a porch, an open bar's walls, roof, counter and
// tables, so the sidewalk under a balcony stays open.
//
// Pure + - * / and core math, like the rest of road/.
import { atan2, cos, sin } from '../../core';
import { OLDTOWN_SIDEWALK_RULES, planStreetFurniture } from '../furniture';
import type { RoadNetwork } from '../network';
import {
  STRUCTURE_MODELS,
  type StructureModel,
  type StructurePlanner,
  type StructureSpec,
} from '../structures';
import { scatterHash, themeAt, type LandTheme, type SideTag } from '../themes';
import { landmarkGround } from './landmark-places';
import { landReachOf, type LandReach } from './land';

/** A street front's layout (render/roadside.ts `Frontage`). */
export interface FrontageRule {
  /** The gap between neighbours, [min, max] m. */
  gap: readonly [number, number];
  /** The share of plots left as an empty lot, and the lot's length, m. */
  lotRate: number;
  lotM: number;
}

/** One of Old Town's street-front rules: render/roadside.ts KEYS_KIT's, field for field. */
export interface OldTownRule {
  id: string;
  /** Its place in the Keys kit's list: the seeded stream it draws on (render's `ri`). */
  index: number;
  /** The variants it stands, by the seed. */
  v: readonly number[];
  /** The model file the variants are in (`STRUCTURE_MODELS` ids are `<asset>#<variant>`). */
  asset: string;
  on: readonly LandTheme[];
  /** Its facade this far past the verge band's outer edge (and render's unused spread), m. */
  across: readonly [number, number];
  frontage: FrontageRule;
  district: readonly string[];
  /** Runs before the kit's other rules (render's `first`). */
  first?: boolean;
  /** Stands only where these rules leave a gap (render's `behind`, `behindOpenM`). */
  behind?: readonly string[];
  behindOpenM?: number;
}

const OLDTOWN: readonly string[] = ['key-oldtown'];
const OLDTOWN_LAND: readonly LandTheme[] = ['oldtown'];
/** render/roadside.ts OLDTOWN_BACK_M: the second row's facade this far past the sidewalk, m. */
export const OLDTOWN_BACK_M = 22;
const DUVAL_KIT = 'models/scenery/duval-kit';
const KEYS_IDENTITY = 'models/scenery/keys-identity';

/** The street-front rules, in the kit's order (render/roadside.ts KEYS_KIT; roadside.test.ts holds them equal). */
export const OLDTOWN_RULES: readonly OldTownRule[] = [
  {
    id: 'oldtown-front',
    index: 0,
    v: [0, 0, 1, 1, 2, 2, 3, 4, 5],
    asset: DUVAL_KIT,
    on: OLDTOWN_LAND,
    across: [0.3, 0],
    frontage: { gap: [0.6, 3], lotRate: 0.08, lotM: 9 },
    district: OLDTOWN,
  },
  {
    id: 'oldtown-bar',
    index: 28,
    v: [6, 7],
    asset: KEYS_IDENTITY,
    on: OLDTOWN_LAND,
    across: [0.3, 0],
    frontage: { gap: [70, 150], lotRate: 0, lotM: 0 },
    district: OLDTOWN,
    first: true,
  },
  {
    id: 'oldtown-back',
    index: 35,
    v: [3, 4],
    asset: DUVAL_KIT,
    on: OLDTOWN_LAND,
    across: [OLDTOWN_BACK_M, 0],
    frontage: { gap: [-0.6, 0], lotRate: 0, lotM: 0 },
    district: OLDTOWN,
    behind: ['oldtown-front', 'oldtown-bar'],
    behindOpenM: 0,
  },
];

/** A street front tries the next building this far on when one does not fit (render's FRONTAGE_STEP_M), m. */
const FRONTAGE_STEP_M = 3;
/** Features no building stands in (render's KEEP_CLEAR), and a landmark that takes ground. */
const KEEP_CLEAR: ReadonlySet<string> = new Set([
  'billboard',
  'boostPad',
  'rampTruck',
  'roadsideZone',
  'copSpawn',
]);
/** The drawn verge past the drawn shoulder (render/road-mesh.ts VERGE_M), m. */
const VERGE_M = 0.6;
/** Land scenery stands this far under the road (render/scenery.ts LAND_TOP_M), m. */
export const LAND_TOP_M = -0.09;
/** How far past its verge another road's land may reach over a building, its strip and skirt (render's), m. */
const HIGHER_LAND_M = 40;
const LAND_STRIP_M = 24;
const SKIRT_RUN_PER_M = 2.2;

const sqrt = (v: number) => Math.sqrt(v);

/** Whether one of these tags covers that side of the road at s (render/roadside.ts `inDistrict`). */
function inDistrict(tags: readonly SideTag[], side: 'left' | 'right', s: number, names: readonly string[]) {
  return tags.some(
    (t) =>
      names.includes(t.tag) &&
      s >= t.s0 &&
      s <= t.s1 &&
      (t.side === undefined || t.side === 'both' || t.side === side),
  );
}

/** A grid of discs for keeping things apart (render/roadside.ts `Discs`, the same test). */
class Discs {
  private readonly cells = new Map<string, { x: number; z: number; r: number; under: boolean }[]>();
  private readonly big: { x: number; z: number; r: number; under: boolean }[] = [];
  private static readonly CELL = 8;

  add(x: number, z: number, r: number, under = false) {
    const disc = { x, z, r, under };
    if (r > Discs.CELL) {
      this.big.push(disc);
      return;
    }
    const k = `${Math.floor(x / Discs.CELL)},${Math.floor(z / Discs.CELL)}`;
    const list = this.cells.get(k);
    if (list) list.push(disc);
    else this.cells.set(k, [disc]);
  }

  hits(x: number, z: number, r: number): boolean {
    const hit = (d: { x: number; z: number; r: number }) =>
      (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z) < (d.r + r) * (d.r + r);
    if (this.big.some(hit)) return true;
    const reach = Math.ceil((r + Discs.CELL) / Discs.CELL);
    const ci = Math.floor(x / Discs.CELL);
    const cj = Math.floor(z / Discs.CELL);
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++) if (this.cells.get(`${i},${j}`)?.some(hit)) return true;
    return false;
  }
}

interface RoadPoint {
  edge: number;
  s: number;
  x: number;
  z: number;
  y: number;
  half: number;
}

/**
 * Every road's centre line in a grid (render/roadside.ts `RoadGrid`, the same two questions): does another road
 * (or this one further on, round a loop) lie under a spot, and does a higher road's land lie over it.
 */
class RoadGrid {
  private readonly cells = new Map<string, RoadPoint[]>();
  private readonly stacked: { step: number; near: boolean[] }[] = [];
  private static readonly CELL = 16;
  private static readonly STACK_STEP_M = 8;

  constructor(road: RoadNetwork) {
    for (const e of road.edges) {
      const half = Math.max(-e.dMin, e.dMax) + VERGE_M;
      for (let i = 0; i < e.count; i++) {
        const pt = { edge: e.index, s: i * e.spacing, x: e.x[i] ?? 0, z: e.z[i] ?? 0, y: e.y[i] ?? 0, half };
        const key = `${Math.floor(pt.x / RoadGrid.CELL)},${Math.floor(pt.z / RoadGrid.CELL)}`;
        const list = this.cells.get(key);
        if (list) list.push(pt);
        else this.cells.set(key, [pt]);
      }
    }
    for (const e of road.edges) {
      const near: boolean[] = [];
      for (let s = 0; s <= e.length + RoadGrid.STACK_STEP_M; s += RoadGrid.STACK_STEP_M) {
        const c = road.toWorld(e.index, Math.min(s, e.length), 0, 0);
        near.push(
          this.some(c.x, c.z, HIGHER_LAND_M + 40, (p) => !this.same(p, e.index, s, 60) && p.y > c.y - 30),
        );
      }
      this.stacked[e.index] = { step: RoadGrid.STACK_STEP_M, near };
    }
  }

  private same(p: RoadPoint, edge: number, s: number, m: number) {
    return p.edge === edge && Math.abs(p.s - s) < m;
  }

  private some(x: number, z: number, reachM: number, test: (p: RoadPoint) => boolean): boolean {
    const reach = Math.ceil(reachM / RoadGrid.CELL);
    const ci = Math.floor(x / RoadGrid.CELL);
    const cj = Math.floor(z / RoadGrid.CELL);
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++) if (this.cells.get(`${i},${j}`)?.some(test)) return true;
    return false;
  }

  /** Whether another road's surface or verges lie within r of (x, z) (this road's own loops too). */
  roadUnder(edge: number, s: number, x: number, z: number, r: number): boolean {
    return this.some(
      x,
      z,
      12,
      (p) =>
        !this.same(p, edge, s, 40) && sqrt((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z)) < p.half + r + 1,
    );
  }

  /** Whether some road's land lies above (x, y, z): another road, or this one further along. */
  landOver(edge: number, s: number, x: number, z: number, y: number): boolean {
    const st = this.stacked[edge];
    const i = st ? Math.round(s / st.step) : 0;
    if (st && !st.near[i] && !st.near[i - 1] && !st.near[i + 1]) return false;
    return this.some(x, z, HIGHER_LAND_M + 8, (p) => {
      if (this.same(p, edge, s, HIGHER_LAND_M + 20)) return false;
      const past = sqrt((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z)) - p.half;
      if (past > HIGHER_LAND_M + 8) return false;
      return p.y - Math.max(0, past - LAND_STRIP_M) / SKIRT_RUN_PER_M > y + 0.25;
    });
  }
}

/** One street-front building as the plan stands it (render draws it: render/roadside.ts `RoadsideItem`). */
export interface OldTownFront {
  rule: string;
  variant: number;
  /** Its model, `<asset>#<variant>` (a `STRUCTURE_MODELS` and `OLDTOWN_PARTS` id). */
  model: string;
  edge: number;
  /** Its middle along the road, and its facade's offset (the model's origin), m. */
  s: number;
  d: number;
  /** Where its origin stands in the world (on the land, LAND_TOP_M under the road). */
  p: { x: number; y: number; z: number };
  /** Turn about the vertical: its +Z (its front) faces the road's centre line. */
  turn: number;
  /** Half its width along the road, and how far it reaches toward the road (its balcony) and back, m. */
  foot: { half: number; front: number; back: number };
  /** The ground it takes, as discs of radius `r` along its body (other props keep off them). */
  discs: readonly { x: number; z: number }[];
  r: number;
}

/** The plan of a network for a seed: every front, in render's order. */
export interface OldTownPlan {
  readonly fronts: readonly OldTownFront[];
}

const kept = new WeakMap<RoadNetwork, Map<number, OldTownPlan>>();

/** Whether a network has Old Town on it (any road tagged `key-oldtown`). */
export const hasOldTown = (road: RoadNetwork): boolean =>
  road.edges.some((e) => e.tags.some((t) => OLDTOWN.includes(t.tag)));

/**
 * Where Old Town's street fronts stand on a network for a seed (the race's: render's scenery seed is the race
 * seed): render/roadside.ts `RoadsideScatter`'s street-front rule, unchanged, in its order (edge by edge, the
 * kit's rules `first` ones first, each left side then right). `rules` replaces the kit's (tests only; such a
 * plan is not kept).
 */
export function planOldTown(
  road: RoadNetwork,
  seed: number,
  rules: readonly OldTownRule[] = OLDTOWN_RULES,
): OldTownPlan {
  const own = rules === OLDTOWN_RULES;
  if (own) {
    const known = kept.get(road)?.get(seed);
    if (known) return known;
  }
  const fronts: OldTownFront[] = [];
  if (hasOldTown(road)) placeFronts(road, seed, rules, landReachOf(road), fronts);
  const plan: OldTownPlan = { fronts };
  if (own) {
    let bySeed = kept.get(road);
    if (!bySeed) kept.set(road, (bySeed = new Map<number, OldTownPlan>()));
    bySeed.set(seed, plan);
  }
  return plan;
}

/** A step in render's order: a street front's rule, or a sidewalk rule whose pieces (road/furniture.ts) take ground. */
type Step =
  { kind: 'front'; rule: OldTownRule } | { kind: 'kerb'; rule: (typeof OLDTOWN_SIDEWALK_RULES)[number] };

function placeFronts(
  road: RoadNetwork,
  seed: number,
  rules: readonly OldTownRule[],
  landReach: LandReach,
  out: OldTownFront[],
): void {
  const steps: (Step & { index: number; first: boolean })[] = [
    ...rules.map((rule) => ({ kind: 'front' as const, rule, index: rule.index, first: !!rule.first })),
    ...OLDTOWN_SIDEWALK_RULES.map((rule) => ({
      kind: 'kerb' as const,
      rule,
      index: rule.index,
      first: false,
    })),
  ].sort((a, b) => Number(b.first) - Number(a.first) || a.index - b.index);
  const roads = new RoadGrid(road);
  const taken = new Discs();
  // The landmarks' ground, from the road (render's `reserved`).
  for (const q of landmarkGround(road)) taken.add(q.x, q.z, q.r);
  const zonesOf = new Map<number, { s0: number; s1: number; lo: number; hi: number }[]>();
  for (const z of road.splitZones()) {
    const list = zonesOf.get(z.edge) ?? [];
    list.push({ s0: z.s0, s1: z.s1, lo: Math.min(z.d0, z.d1), hi: Math.max(z.d0, z.d1) });
    zonesOf.set(z.edge, list);
  }
  // The sidewalk's pieces (road/furniture.ts) by edge, rule and side, as render stands them.
  const kerb = new Map<string, { s: number; d: number; size: number }[]>();
  for (const it of planStreetFurniture(road, seed).items) {
    if (it.layer !== 'kit') continue;
    const key = `${it.edge}:${it.rule}:${it.d < 0 ? -1 : 1}`;
    const list = kerb.get(key);
    if (list) list.push(it);
    else kerb.set(key, [it]);
  }
  for (const e of road.edges) {
    const tags = e.tags;
    const zones = zonesOf.get(e.index) ?? [];
    // A building keeps off the landmarks' footprints too (the buoy, the Mile 0 marker).
    const blocks = e.features.filter(
      (f) => KEEP_CLEAR.has(f.kind) || (f.kind === 'landmark' && f.params?.['overRoad'] !== true),
    );
    for (const step of steps)
      for (const side of [-1, 1] as const) {
        if (step.kind === 'kerb') {
          // Render stands the plan's sidewalk pieces in their rule's turn; they take their ground then.
          const r = step.rule.r * (step.rule.size?.[1] ?? 1);
          for (const it of kerb.get(`${e.index}:${step.rule.id}:${side}`) ?? []) {
            const p = road.toWorld(e.index, it.s, it.d, LAND_TOP_M);
            taken.add(p.x, p.z, r, !!step.rule.canopy);
          }
          continue;
        }
        const rule = step.rule;
        const ri = rule.index;
        const h = (k: number, sd: number, salt: number) =>
          scatterHash(seed, 7919 + e.index * 977 + ri * 131, k, sd * 17 + salt + 40);
        const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
        const fr = rule.frontage;
        const sideName = side < 0 ? 'left' : 'right';
        const onLand = (u: number) =>
          (rule.on as readonly string[]).includes(themeAt(tags, sideName, u)) &&
          inDistrict(tags, sideName, u, rule.district);
        let s = h(0, side, 0) * fr.gap[1];
        for (let k = 0; s < e.length; k++) {
          const variant = rule.v[Math.floor(h(k, side, 4) * rule.v.length) % rule.v.length] ?? 0;
          const model = `${rule.asset}#${variant}`;
          const box: StructureModel | undefined = (
            STRUCTURE_MODELS as Readonly<Record<string, StructureModel>>
          )[model];
          if (!box) break;
          if (h(k, side, 7) < fr.lotRate) {
            s += fr.lotM;
            continue;
          }
          const half = Math.max(-box.x0, box.x1);
          const front = Math.max(0, box.z1);
          const back = Math.max(0, -box.z0);
          const depth = front + back;
          const sc = s + half;
          if (sc + half > e.length) break;
          const ends = [sc - half, sc, sc + half];
          // Its facade `across[0]` past the verge band's outer edge, whatever the band is made of, so the front
          // stands on the street's edge and the balcony, `front` further out, hangs over the pavement; its whole
          // depth on the drawn land.
          const bandPast = Math.max(
            ...ends.map((u) => Math.max(0, Math.abs(road.vergeAt(e.index, u, sideName).dOuter) - outer)),
          );
          const across = bandPast + rule.across[0] - front;
          let fits = ends.every(onLand) && ends.every((u) => across + depth <= landReach(e.index, side, u));
          const dFront = side * (outer + across);
          const dFacade = side * (outer + across + front);
          const dBack = side * (outer + across + depth);
          const overlaps = (s0: number, s1: number, d0: number, d1: number, from: number, to: number) =>
            sc + half > Math.min(s0, s1) - 1 &&
            sc - half < Math.max(s0, s1) + 1 &&
            Math.max(from, to) > Math.min(d0, d1) - 1 &&
            Math.min(from, to) < Math.max(d0, d1) + 1;
          // A crowd stands on the pavement, under the balcony: only the building's body is in its way.
          if (fits)
            fits = !blocks.some((f) =>
              f.kind === 'roadsideZone'
                ? overlaps(f.s0, f.s1, f.d0, f.d1, dFacade, dBack)
                : overlaps(f.s0, f.s1, f.d0, f.d1, dFront, dBack),
            );
          if (fits) fits = !zones.some((z) => overlaps(z.s0, z.s1, z.lo, z.hi, dFront, dBack));
          // A row behind another stands only where that one has a gap.
          if (fits && rule.behind) {
            const spans = out
              .filter(
                (o) =>
                  o.edge === e.index &&
                  Math.sign(o.d) === side &&
                  rule.behind?.includes(o.rule) &&
                  o.s + o.foot.half > sc - half &&
                  o.s - o.foot.half < sc + half,
              )
              .map(
                (o) =>
                  [Math.max(sc - half, o.s - o.foot.half), Math.min(sc + half, o.s + o.foot.half)] as const,
              )
              .sort((a, b) => a[0] - b[0]);
            let covered = 0;
            let upto = sc - half;
            for (const [a, b] of spans) {
              if (b <= upto) continue;
              covered += b - Math.max(a, upto);
              upto = b;
            }
            fits = rule.behindOpenM === undefined ? covered < half : 2 * half - covered >= rule.behindOpenM;
          }
          // Its ground as discs along its body (facade to back): clear of the landmarks and what stands already.
          const r = Math.min(back, 2 * half) / 2;
          const discs: { x: number; z: number }[] = [];
          if (fits) {
            const mid = side * (outer + across + front + back / 2);
            if (2 * half >= back) {
              for (let u = -half + r; u < half - r + r / 2; u += r)
                discs.push(road.toWorld(e.index, sc + u, mid, 0));
              discs.push(road.toWorld(e.index, sc + half - r, mid, 0));
            } else {
              for (let t = r; t < back - r + r / 2; t += r)
                discs.push(road.toWorld(e.index, sc, side * (outer + across + front + t), 0));
              discs.push(road.toWorld(e.index, sc, side * (outer + across + front + back - r), 0));
            }
            fits = !discs.some((c) => taken.hits(c.x, c.z, r));
          }
          // No other road under any corner, and no higher road's land over it.
          if (fits)
            fits = ends.every((u) =>
              [dFront, dBack].every((dd) => {
                const q = road.toWorld(e.index, u, dd, LAND_TOP_M);
                return (
                  !roads.roadUnder(e.index, u, q.x, q.z, 1) && !roads.landOver(e.index, u, q.x, q.z, q.y)
                );
              }),
            );
          if (!fits) {
            s += FRONTAGE_STEP_M;
            continue;
          }
          const d = side * (outer + across + front);
          const p = road.toWorld(e.index, sc, d, LAND_TOP_M);
          const toRoad = road.toWorld(e.index, sc, 0, 0);
          for (const c of discs) taken.add(c.x, c.z, r);
          out.push({
            rule: rule.id,
            variant,
            model,
            edge: e.index,
            s: sc,
            d,
            p: { x: p.x, y: p.y, z: p.z },
            turn: atan2(toRoad.x - p.x, toRoad.z - p.z),
            foot: { half, front, back },
            discs: discs.map((c) => ({ x: c.x, z: c.z })),
            r,
          });
          s = sc + half + fr.gap[0] + (fr.gap[1] - fr.gap[0]) * h(k, side, 8);
        }
      }
  }
}

// ---- each building's solid parts --------------------------------------------------------------------------

/**
 * One solid part of a model, in its own frame at scale 1 (+Z its front, +X its right, +Y up): a box from
 * x0..x1 and z0..z1, from `y0` up to a flat top, or to a pitched roof that rises from `eave` along its two
 * sides parallel to the ridge to `ridge` over its middle (the ridge along the model's z, `v`, or x, `u`).
 */
export interface Part {
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  roof: { kind: 'flat'; top: number } | { kind: 'pitched'; eave: number; ridge: number; along: 'u' | 'v' };
}

const flat = (
  name: string,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  top: number,
): Part => ({
  name,
  x0,
  x1,
  z0,
  z1,
  y0,
  roof: { kind: 'flat', top },
});

/**
 * A body whose roof is pitched with its ridge along z (the gable runs front to back): `hip` gives the ridge's
 * ends (zr0 at the back, zr1 at the front) and the roof falls to the eave at the front and back too. A hip's end
 * is cut into `slices` lengths along z, each a gable whose ridge is the hip's height at its inner edge, so the
 * slope steps down to the eave (it stands over the drawn roof by at most a slice's fall, and the slice's sides
 * under it by at most a quarter of the rise: scripts/structure-parts.test.ts holds both within its tolerance).
 */
function pitchedBody(
  name: string,
  x: number,
  z0: number,
  z1: number,
  eave: number,
  ridge: number,
  hip?: { zr0: number; zr1: number; slices: number },
): Part[] {
  const gable = (n: string, a: number, b: number, r: number): Part => ({
    name: n,
    x0: -x,
    x1: x,
    z0: a,
    z1: b,
    y0: 0,
    roof: { kind: 'pitched', eave, ridge: r, along: 'v' },
  });
  if (!hip) return [gable(name, z0, z1, ridge)];
  const parts: Part[] = [gable(`${name}-middle`, hip.zr0, hip.zr1, ridge)];
  const n = hip.slices;
  for (let i = 0; i < n; i++) {
    // The front end: from the ridge's front end out to the front eave; the inner edge of each slice is its highest.
    const fa = hip.zr1 + ((z1 - hip.zr1) * i) / n;
    const fb = hip.zr1 + ((z1 - hip.zr1) * (i + 1)) / n;
    parts.push(gable(`${name}-front-${i}`, fa, fb, eave + ((ridge - eave) * (z1 - fa)) / (z1 - hip.zr1)));
    // The back end: from the ridge's back end out to the back eave.
    const ba = hip.zr0 - ((hip.zr0 - z0) * (i + 1)) / n;
    const bb = hip.zr0 - ((hip.zr0 - z0) * i) / n;
    parts.push(gable(`${name}-back-${i}`, ba, bb, eave + ((ridge - eave) * (bb - z0)) / (hip.zr0 - z0)));
  }
  return parts;
}

/** A balconied shopfront (duval_kit.py `balcony`): `width` m wide, `style` its roof. */
function balconyFront(width: number, style: 'hip' | 'gable' | 'parapet'): Part[] {
  const w = width / 2;
  const depth = 8;
  const eave = 7.5;
  const parts: Part[] = [];
  if (style === 'parapet') {
    // A flat roof at the eave (its tin at +0.025) inside a parapet: 1.4 m over the front, 0.65 m along the sides.
    parts.push(flat('body', -w, w, -depth, -0.15, 0, eave + 0.03));
    parts.push(flat('parapet-front', -w - 0.08, w + 0.08, -0.15, 0.22, 0, eave + 1.4));
    parts.push(flat('parapet-left', -w - 0.08, -w + 0.08, -depth, -0.15, 0, eave + 0.65));
    parts.push(flat('parapet-right', w - 0.08, w + 0.08, -depth, -0.15, 0, eave + 0.65));
  } else {
    parts.push(
      ...pitchedBody(
        'body',
        w + 0.25,
        -depth - 0.25,
        0.25,
        eave,
        eave + 1.5,
        style === 'hip' ? { zr0: -depth * 0.75, zr1: -depth * 0.25, slices: 3 } : undefined,
      ),
    );
  }
  // The balcony over the sidewalk: its deck at 3.35 to 3.55, its rails to 4.69, out to 2.13 m.
  parts.push(flat('balcony', -w, w, 0, 2.13, 3.35, 4.69));
  // Its four posts, from the pavement to the eave.
  for (const [i, x] of [-w + 0.15, -w / 3, w / 3, w - 0.15].entries())
    parts.push(flat(`post-${i}`, x - 0.09, x + 0.09, 1.87, 2.07, 0, 7.4));
  return parts;
}

/** A conch house (duval_kit.py `cottage`): on piers, a porch with its own roof and steps. */
function conchHouse(style: 'hip' | 'gable'): Part[] {
  const eave = 5.5;
  return [
    // The house stands on piers 0.65 m high: its body from there up, the back piers under it.
    ...pitchedBody(
      'body',
      3.75,
      -7.25,
      0.25,
      eave,
      eave + 1.5,
      style === 'hip' ? { zr0: -7 * 0.75, zr1: -7 * 0.25, slices: 3 } : undefined,
    ).map((p) => ({ ...p, y0: 0.65 })),
    flat('pier-left', -2.95, -2.65, -6.05, -5.75, 0, 0.65),
    flat('pier-right', 2.65, 2.95, -6.05, -5.75, 0, 0.65),
    // The porch's deck on its piers, and its front step.
    flat('porch', -3.5, 3.5, 0, 1.85, 0, 0.72),
    flat('steps', -0.65, 0.65, 1.85, 2.25, 0, 0.48),
    // Its posts (on the deck's trim, 0.55 up) and side rails.
    flat('post-left', -3.34, -3.16, 1.53, 1.73, 0.55, 3.55),
    flat('post-right', 3.16, 3.34, 1.53, 1.73, 0.55, 3.55),
    flat('rail-left', -3.3, -3.2, 0, 1.7, 1.4, 1.5),
    flat('rail-right', 3.2, 3.3, 0, 1.7, 1.4, 1.5),
    // The porch roof, falling from 3.77 at the wall to 3.22 at its edge (underside 3.65 to 3.1): two slices.
    flat('porch-roof-in', -3.6, 3.6, 0, 0.975, 3.375, 3.77),
    flat('porch-roof-out', -3.6, 3.6, 0.975, 1.95, 3.1, 3.495),
  ];
}

/** The corner bar (duval_kit.py `bar`): open to the street and on its right, under a hipped roof. */
function cornerBar(): Part[] {
  return [
    flat('floor', -7, 7, -14, 0, 0, 0.2),
    flat('back-wall', -7, 7, -14, -13.7, 0, 4.55),
    flat('side-wall', -7, -6.7, -14, 0, 0, 4.55),
    flat('post-front-left', -6.82, -6.58, -0.12, 0.12, 0, 4.7),
    flat('post-front-mid', -0.12, 0.12, -0.12, 0.12, 0, 4.7),
    flat('post-front-right', 6.58, 6.82, -0.12, 0.12, 0, 4.7),
    flat('post-back-right', 6.58, 6.82, -13.82, -13.58, 0, 4.7),
    // The header over the open front, with its roll-up shutter and the bar's name board under it.
    flat('header', -6.7, 6.7, -0.12, 0.25, 2.82, 4.55),
    // The roof: its slab (4.6 to 4.8) and the hip over it (ridge 6 m), above the walls.
    ...pitchedBody('roof', 7.3, -14.3, 0.4, 4.8, 6, { zr0: -10.5, zr1: -3.5, slices: 3 }).map((p) => ({
      ...p,
      y0: 4.55,
    })),
    flat('counter', -5.8, 4.8, -4.65, -3.8, 0, 1.32),
    flat('table', 3, 6.5, -13.1, -9.3, 0, 0.8),
    flat('fan-front', -0.9, 0.9, -4.3, -2.5, 3.65, 4.6),
    flat('fan-back', -0.9, 0.9, -10.4, -8.6, 3.65, 4.6),
  ];
}

/** keys_identity.py `furniture`: the counter, the shelves on the back wall and the stools. */
function barFurniture(): Part[] {
  return [
    flat('counter', -4.6, 3.5, -3.9, -3.3, 0, 1.1),
    flat('shelves', -4.5, 3.5, -6.7, -6.3, 1.9, 2.82),
    flat('stools', -3.25, 3.25, -2.75, -2.25, 0, 0.95),
  ];
}

/** An open-fronted bar with a veranda (keys_identity.py `bar`, a = true). */
function verandaBar(): Part[] {
  return [
    flat('floor', -7, 7, -7, 0, 0, 0.1),
    flat('back-wall', -7, 7, -7, -6.7, 0, 7.3),
    flat('side-left', -7.1, -6.9, -7, 0, 0, 7.3),
    flat('side-right', 6.9, 7.1, -7, 0, 0, 7.3),
    // The upper storey over the open ground floor, its shutters at 3.15.
    flat('upper', -7, 7, -6.7, 0.1, 3.15, 7.3),
    // The veranda over the sidewalk: its deck at 3.35, its rails to 4.59, out to 2.46 m; four posts to 7.2.
    flat('veranda', -7, 7, 0.1, 2.46, 3.35, 4.59),
    ...[-6.8, -2.3, 2.3, 6.8].map((x, i) => flat(`post-${i}`, x - 0.07, x + 0.07, 2.25, 2.4, 0, 7.2)),
    // The roof over both, its ridge along z.
    {
      name: 'roof',
      x0: -7.2,
      x1: 7.2,
      z0: -7.2,
      z1: 2.6,
      y0: 7.2,
      roof: { kind: 'pitched', eave: 7.3, ridge: 8, along: 'v' },
    },
    ...barFurniture(),
    flat('fans', -3.5, 3.5, -3.95, -3.05, 2.74, 3.4),
    // The band's corner: the crates, the drum, the speakers and the lamp.
    flat('corner', 4.27, 6.6, -6.2, -4.2, 0, 1.6),
  ];
}

/** An open bar under arches, with café tables on the sidewalk (keys_identity.py `bar`, a = false). */
function archBar(): Part[] {
  const parts: Part[] = [
    flat('floor', -6, 6, -7, 0, 0, 0.1),
    flat('back-wall', -6, 6, -7, -6.7, 0, 5.5),
    flat('side-left', -6.1, -5.9, -7, 0, 0, 5.5),
    flat('side-right', 5.9, 6.1, -7, 0, 0, 5.5),
    // The flat roof inside the walls' parapet.
    flat('roof', -5.9, 5.9, -6.7, -0.18, 4.55, 4.7),
    // The pillars between the three arches, and the wall over each arch: its underside 3.2 at the pillars,
    // 3.9 a little in, 4.25 at the crown (three slices an arch).
    ...[-6, -2, 2, 6].map((x, i) => flat(`pillar-${i}`, x - 0.18, x + 0.18, -0.18, 0.18, 0, 4.1)),
    ...barFurniture(),
  ];
  for (const [i, x] of [-4, 0, 4].entries()) {
    parts.push(flat(`arch-${i}-left`, x - 1.82, x - 1.25, -0.18, 0.18, 3.2, 5.5));
    parts.push(flat(`arch-${i}-crown`, x - 1.25, x + 1.25, -0.18, 0.18, 3.9, 5.5));
    parts.push(flat(`arch-${i}-right`, x + 1.25, x + 1.82, -0.18, 0.18, 3.2, 5.5));
  }
  // Two café tables on the sidewalk, each under an umbrella on a pole.
  for (const [i, x] of [-3, 3].entries()) {
    parts.push(flat(`table-${i}`, x - 0.55, x + 0.55, 1.45, 2.55, 0, 1.2));
    parts.push(flat(`pole-${i}`, x - 0.06, x + 0.06, 1.94, 2.06, 0, 2.85));
    parts.push(flat(`umbrella-${i}`, x - 1.1, x + 1.1, 0.9, 3.1, 2.5, 2.85));
  }
  return parts;
}

/** Each Old Town model's solid parts, by `<asset>#<variant>` (the `STRUCTURE_MODELS` ids). */
export const OLDTOWN_PARTS: Readonly<Record<string, readonly Part[]>> = {
  [`${DUVAL_KIT}#0`]: balconyFront(8, 'hip'),
  [`${DUVAL_KIT}#1`]: balconyFront(11, 'gable'),
  [`${DUVAL_KIT}#2`]: balconyFront(14, 'parapet'),
  [`${DUVAL_KIT}#3`]: conchHouse('gable'),
  [`${DUVAL_KIT}#4`]: conchHouse('hip'),
  [`${DUVAL_KIT}#5`]: cornerBar(),
  [`${KEYS_IDENTITY}#6`]: verandaBar(),
  [`${KEYS_IDENTITY}#7`]: archBar(),
};

/**
 * A part as a structure where render places its model: at `p`, turned by `turn` (three.js turns the model's
 * +Z to (sin turn, cos turn) and its +X to (cos turn, -sin turn)), at scale 1.
 */
export function partSolid(
  part: Part,
  at: { x: number; y: number; z: number; turn: number },
): Pick<StructureSpec, 'foot' | 'baseY' | 'roof'> {
  const sy = sin(at.turn);
  const cy = cos(at.turn);
  const mx = (part.x0 + part.x1) / 2;
  const mz = (part.z0 + part.z1) / 2;
  const r = part.roof;
  return {
    foot: {
      x: at.x + mx * cy + mz * sy,
      z: at.z - mx * sy + mz * cy,
      ux: cy,
      uz: -sy,
      hu: (part.x1 - part.x0) / 2,
      hv: (part.z1 - part.z0) / 2,
    },
    baseY: at.y + part.y0,
    roof:
      r.kind === 'flat'
        ? { kind: 'flat', topM: r.top - part.y0 }
        : { kind: 'pitched', eaveM: r.eave - part.y0, ridgeM: r.ridge - part.y0, ridge: r.along },
  };
}

/** The structures of one front: each of its model's parts where render draws it. */
export function frontStructures(f: OldTownFront): StructureSpec[] {
  const parts = OLDTOWN_PARTS[f.model];
  if (!parts) throw new Error(`structures: no parts for the Old Town model ${f.model}`);
  return parts.map((part) => ({
    rule: `${f.rule}#${part.name}`,
    cls: 'building' as const,
    model: f.model,
    edge: f.edge,
    s: f.s,
    d: f.d,
    ...partSolid(part, { x: f.p.x, y: f.p.y, z: f.p.z, turn: f.turn }),
  }));
}

/** The `oldtown` layer's planner (road/structures.ts `STRUCTURE_LAYERS`): every front's parts, in plan order. */
export const planner: StructurePlanner = {
  plan(road, seed, out) {
    for (const f of planOldTown(road, seed).fronts) for (const spec of frontStructures(f)) out.add(spec);
  },
};
