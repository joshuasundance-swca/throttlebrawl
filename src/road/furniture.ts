// The street furniture that stands where a rider can ride (playtest 4, the maintainer, 2026-10-05:
// street furniture is "solid but maybe forgiving to sides, brushes, etc"; "I'd like all hitboxes on
// everything to make sense"). A city sidewalk is a ridable band (road/cross-section.ts: kerb and
// shoulder bands, `ridableBandPast` is 0 there), and render used to stand its hydrants, lamps, trees,
// meters, benches and planters on it with nothing in the sim behind them: a rider rode through them.
// This module is the one place that decides where each of them stands. Render draws them from it
// (render/roadside.ts, downtown.ts, waterfront.ts, mission.ts) and the sim meets them from it
// (sim/riders/furniture.ts), so what is drawn is what is hit. Everything else render scatters keeps off
// the ridable bands (render/scenery.ts `ridableBandPast`).
//
// The placements are the render layers' own rules, moved here unchanged: the same seeded hash, the same
// spacing, the same offsets and the same keep-clear rules, so the street looks as it did:
// - the San Francisco roadside kit's kerb props (render/roadside.ts SF_KIT: street trees, A-frame
//   boards, lamps, parking meters, bins, hydrants and rental scooters), and Key West's Old Town
//   sidewalk (KEYS_KIT: the palm planters, the scooter racks and the frangipanis);
// - San Francisco's downtown (render/downtown.ts): the lamps, the planter, hydrant, scooter or board
//   between each two, the plaza benches and planters, the orb, and the signals at the cross streets;
// - San Francisco's waterfront (render/waterfront.ts): the promenade's palms, lamps and benches, the
//   city side's lamps, the ferry plaza's palms and benches, and the cars in the lot by the bridge;
// - San Francisco's mural district (render/mission.ts): the shopfront sidewalks' kerb lamps and bins.
// What render could not tell the plan (the drawn land's reach, the scenery and the staged scenes it had
// placed first) no longer matters on a ridable band: those keep off it now. Two render rules the plan
// reads and render does not: a kerb piece stands only on a paved band (the sidewalk itself), and 8 m
// clear of a barrier's or a bridge's span (render draws no land there).
//
// Each piece has a contact class (docs/content-packs.md, "Contact outcomes"): `solid` (a hydrant, a
// lamp or a signal post, a tree's trunk, a bench, a planter, the orb, a parked car: heavy and fixed, met
// by the closing speed along the contact's normal) or `light` (a meter, a bin, a board, a scooter on its
// stand: knocked aside with a wobble, never a crash). Its footprint is the drawn model's, measured below
// a rider's head (scripts/hitboxes.test.ts holds the two together within 0.15 m).
//
// Pure + - * / and core math, like the rest of road/: the same network and seed give the same plan.
import { atan2, cos, sin } from '../core';
import type { RoadNetwork } from './network';
import type { BakedFeature } from './types';
import { onSide, scatterHash, themeAt, type LandTheme, type SideTag } from './themes';

/** What a rider meeting it does (docs/content-packs.md, "Contact outcomes"). */
export type FurnitureClass = 'solid' | 'light';
/** Which render layer draws it (and so which model its `variant` indexes). */
export type FurnitureLayer = 'kit' | 'downtown' | 'waterfront' | 'mission';

/**
 * A footprint in the model's own frame (+Z its front, +X its right), m, before its size: a circle of
 * radius `r`, or a box of half sizes `hx` and `hz`, round a centre `cx`, `cz` off the model's origin.
 */
export interface FurnitureFoot {
  r?: number;
  hx?: number;
  hz?: number;
  cx?: number;
  cz?: number;
}

export interface FurnitureSpec {
  cls: FurnitureClass;
  /** How tall it stands, m: a rider in the air above it clears it. */
  heightM: number;
  /** Its footprint, one for every variant (the last one serves any further variant). */
  foot: readonly FurnitureFoot[];
  /** What it is, in plain words (the docs' table and the audit). */
  what: string;
}

/**
 * The pieces, their classes and their footprints [default]. Each footprint is the drawn model's
 * cross-section from 0.1 m up to its solid top or 1.95 m, whichever is lower (a lamp's arm, a tree's
 * crown and a palm's fronds are over a rider's head, a tree pit's grate is under its wheels, a planter's
 * palm is leaves over its box),
 * measured on the models (tools/blender/props/sf_roadside.py, sf_downtown.py, the Duval and Keys
 * identity kits, render/waterfront.ts's own lamp and bench) and held to them by scripts/hitboxes.test.ts.
 */
export const FURNITURE = {
  // San Francisco's roadside kit (models.ts `sfRoadside`).
  'street-tree': {
    cls: 'solid',
    heightM: 5.5,
    foot: [{ r: 0.12, cx: 0.03 }],
    what: 'a street tree (its trunk)',
  },
  board: { cls: 'light', heightM: 1.05, foot: [{ hx: 0.62, hz: 0.22 }], what: 'an A-frame board' },
  lamp: { cls: 'solid', heightM: 4.6, foot: [{ r: 0.08 }], what: 'a street lamp' },
  meter: { cls: 'light', heightM: 1.4, foot: [{ r: 0.1 }], what: 'a parking meter' },
  bins: {
    cls: 'light',
    heightM: 1.04,
    foot: [{ hx: 0.9, hz: 0.33 }],
    what: 'the bins out on collection day',
  },
  hydrant: { cls: 'solid', heightM: 0.82, foot: [{ r: 0.18, cz: 0.05 }], what: 'a fire hydrant' },
  scooter: {
    cls: 'light',
    heightM: 0.2,
    foot: [{ hx: 0.26, hz: 1.03, cz: 0.33 }],
    what: 'a rental scooter dropped on the pavement',
  },
  // Key West's Old Town (models.ts `duvalKit` and `keysIdentity`).
  'planter-palm': {
    cls: 'solid',
    heightM: 0.46,
    foot: [{ hx: 0.6, hz: 0.6 }],
    what: 'a palm in its planter',
  },
  'scooter-rack': {
    cls: 'light',
    heightM: 1,
    foot: [{ hx: 1.6, hz: 0.73, cx: 0.04, cz: 0.05 }],
    what: 'a rack of rental scooters',
  },
  frangipani: { cls: 'solid', heightM: 4.6, foot: [{ r: 0.21, cz: 0.05 }], what: 'a frangipani (its trunk)' },
  // San Francisco's downtown (models.ts `sfDowntown`; the kit's hydrant, scooter and boards as above).
  'dt-lamp': { cls: 'solid', heightM: 8, foot: [{ r: 0.1 }], what: 'a downtown lamp' },
  'dt-signal': { cls: 'solid', heightM: 6.4, foot: [{ r: 0.14 }], what: 'a traffic signal post' },
  'dt-planter': { cls: 'solid', heightM: 0.7, foot: [{ hx: 0.9, hz: 0.9 }], what: 'a planter' },
  'dt-bench': { cls: 'solid', heightM: 0.95, foot: [{ hx: 1, hz: 0.31 }], what: 'a bench' },
  'dt-orb': { cls: 'solid', heightM: 4.5, foot: [{ r: 1.4 }], what: "the plaza's orb sculpture" },
  // San Francisco's waterfront (render/waterfront.ts: its own lamp and bench, the Keys' palms, the kit's cars).
  palm: {
    cls: 'solid',
    heightM: 7.3,
    foot: [
      { hx: 0.28, hz: 0.24, cx: -0.04, cz: -0.02 },
      { hx: 0.28, hz: 0.28, cz: 0.04 },
      // The third palm's trunk leans out over 1.2 m before its crown.
      { hx: 0.7, hz: 0.54, cx: 0.49, cz: -0.34 },
    ],
    what: 'a palm (its trunk)',
  },
  'wf-lamp': { cls: 'solid', heightM: 5.2, foot: [{ r: 0.11 }], what: 'a promenade lamp' },
  'wf-bench': { cls: 'solid', heightM: 1.1, foot: [{ hx: 1, hz: 0.29 }], what: 'a bench' },
  'parked-car': {
    cls: 'solid',
    heightM: 1.5,
    foot: [
      { hx: 0.9, hz: 2.17 },
      { hx: 0.88, hz: 1.85 },
      { hx: 0.9, hz: 2.17 },
    ],
    what: 'a parked car',
  },
} as const satisfies Record<string, FurnitureSpec>;

export type FurnitureKind = keyof typeof FURNITURE;
export const FURNITURE_KINDS = Object.keys(FURNITURE) as FurnitureKind[];

/**
 * How a piece is turned, for render: `face` turns its front (+Z) toward the road's centre line and then
 * by `face` radians more; `yaw` is a world turn (a seeded one, or one render works out the same way);
 * `along` turns its front to face the riders coming along the road the `along` way (a signal).
 */
export type FurnitureTurn = { face: number } | { yaw: number } | { along: 1 | -1 };

/** Its footprint in the road frame (s, d): a circle, or a box with its own axes. */
export interface FurnitureShape {
  /** The centre, m. */
  s: number;
  d: number;
  /** A circle's radius, m; 0 for a box. */
  r: number;
  /** A box's half sizes along its axes `u` (the model's +X) and `v` (its +Z), m. */
  hu: number;
  hv: number;
  /** The box's `u` axis in the road frame, a unit vector (`v` is it turned a quarter: (−ud, us)). */
  us: number;
  ud: number;
  /** How far the footprint reaches from its centre along s and across d (its bounding box), m. */
  reachS: number;
  reachD: number;
}

/** One placed piece. */
export interface StreetFurniture {
  /** Its index in the plan. */
  id: number;
  kind: FurnitureKind;
  cls: FurnitureClass;
  layer: FurnitureLayer;
  /** The render layer's rule (render/roadside.ts, downtown.ts, waterfront.ts names), and its model variant. */
  rule: string;
  variant: number;
  edge: number;
  s: number;
  d: number;
  turn: FurnitureTurn;
  size: number;
  /** Its footprint in the road frame, at its size and turn. */
  shape: FurnitureShape;
  heightM: number;
}

/** The plan: every piece, and each edge's pieces in the order of their footprint's low s. */
export interface FurniturePlan {
  readonly items: readonly StreetFurniture[];
  readonly byEdge: readonly (readonly StreetFurniture[])[];
  /** The longest reach along s of any piece, m (a query widens its window by it). */
  readonly reachS: number;
}

// ---- the shared rules -----------------------------------------------------------------------------

/** The drawn verge past the drawn shoulder (render/road-mesh.ts VERGE_M), m. */
export const DRAWN_VERGE_M = 0.6;
/** Bands a rider rides on loose ground (render/scenery.ts): the kit pushes its props past them. */
const LOOSE_BAND: ReadonlySet<string> = new Set(['dirt', 'gravel', 'sand', 'grass']);
/** Features nothing of the street's furniture stands in (render's KEEP_CLEAR). */
const KEEP_CLEAR: ReadonlySet<string> = new Set([
  'billboard',
  'boostPad',
  'rampTruck',
  'roadsideZone',
  'copSpawn',
]);

const sqrt = (v: number) => Math.sqrt(v);

/** The tags of an edge, as the scatter reads them. */
const tagsOf = (road: RoadNetwork, edge: number): readonly SideTag[] => road.edges[edge]?.tags ?? [];

/** Whether one of these tags covers that side of the road at s (render/roadside.ts `inDistrict`). */
function inDistrict(tags: readonly SideTag[], side: 'left' | 'right', s: number, names: readonly string[]) {
  return tags.some((t) => names.includes(t.tag) && s >= t.s0 && s <= t.s1 && onSide(t, side));
}

/**
 * How far past `outer` the loose ground band reaches at (edge, s) on a side, m: the kit stood its props
 * clear of it (render/scenery.ts `ridableBandPast` before this plan, which counted loose bands only).
 */
function looseBandPast(road: RoadNetwork, edge: number, side: -1 | 1, s: number, outer: number): number {
  const v = road.vergeAt(edge, s, side < 0 ? 'left' : 'right');
  if (v.widthM <= 0 || !LOOSE_BAND.has(v.surface)) return 0;
  return Math.max(0, side * v.dOuter - outer);
}

/** Whether a barrier (a wall, a rail) or a bridge tag covers that side within `m` of s. */
function nearBarrier(
  barriers: readonly { s0: number; s1: number; side: string }[],
  tags: readonly SideTag[],
  side: 'left' | 'right',
  s: number,
  m: number,
): boolean {
  const near = (r: { s0: number; s1: number; side?: string }) =>
    s >= r.s0 - m && s <= r.s1 + m && (r.side === undefined || r.side === 'both' || r.side === side);
  return barriers.some(near) || tags.some((t) => (t.tag === 'bridge' || t.tag === 'causeway') && near(t));
}

/** The road's yaw at s: the turn that points a model's +Z along increasing s. */
function roadYaw(road: RoadNetwork, edge: number, s: number): number {
  const f = road.frameAt(edge, s);
  return atan2(f.tx, f.tz);
}

/** The turn that points a model at (edge, s, d) toward the road's centre line at s (render's `faceRoad`). */
function faceRoadYaw(road: RoadNetwork, edge: number, s: number, d: number): number {
  const p = road.toWorld(edge, s, d, 0);
  const c = road.toWorld(edge, s, 0, 0);
  return atan2(c.x - p.x, c.z - p.z);
}

/** A piece's footprint in the road frame, from its world turn (`yaw`), its size and its spec. */
function shapeOf(
  road: RoadNetwork,
  kind: FurnitureKind,
  variant: number,
  edge: number,
  s: number,
  d: number,
  yaw: number,
  size: number,
): FurnitureShape {
  const feet: readonly FurnitureFoot[] = FURNITURE[kind].foot;
  const foot = feet[Math.min(variant, feet.length - 1)] ?? feet[0] ?? {};
  const f = road.frameAt(edge, s);
  // The model's +X and +Z in the world (three.js turns about +Y: x' = x cos + z sin, z' = −x sin + z cos),
  // then on the road's axes (+s along (tx, tz), +d to its right, (−tz, tx)).
  const cy = cos(yaw);
  const sy = sin(yaw);
  const us = cy * f.tx - sy * f.tz;
  const ud = -cy * f.tz - sy * f.tx;
  const vs = sy * f.tx + cy * f.tz;
  const vd = -sy * f.tz + cy * f.tx;
  const cx = (foot.cx ?? 0) * size;
  const cz = (foot.cz ?? 0) * size;
  const cs = s + cx * us + cz * vs;
  const cd = d + cx * ud + cz * vd;
  if (foot.r !== undefined) {
    const r = foot.r * size;
    return { s: cs, d: cd, r, hu: 0, hv: 0, us: 1, ud: 0, reachS: r, reachD: r };
  }
  const hu = (foot.hx ?? 0) * size;
  const hv = (foot.hz ?? 0) * size;
  const reachS = Math.abs(us) * hu + Math.abs(vs) * hv;
  const reachD = Math.abs(ud) * hu + Math.abs(vd) * hv;
  return { s: cs, d: cd, r: 0, hu, hv, us, ud, reachS, reachD };
}

/** A grid of discs for keeping pieces apart (render/roadside.ts `Discs`, the same test). */
class Discs {
  private readonly cells = new Map<string, { x: number; z: number; r: number; under: boolean }[]>();
  private static readonly CELL = 8;
  add(x: number, z: number, r: number, under = false) {
    const k = `${Math.floor(x / Discs.CELL)},${Math.floor(z / Discs.CELL)}`;
    const list = this.cells.get(k);
    const disc = { x, z, r, under };
    if (list) list.push(disc);
    else this.cells.set(k, [disc]);
  }
  hits(x: number, z: number, r: number, understory: boolean): boolean {
    const hit = (q: { x: number; z: number; r: number; under: boolean }) =>
      !(understory && q.under) && (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < (q.r + r) * (q.r + r);
    const reach = Math.ceil((r + Discs.CELL) / Discs.CELL);
    const ci = Math.floor(x / Discs.CELL);
    const cj = Math.floor(z / Discs.CELL);
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++) if (this.cells.get(`${i},${j}`)?.some(hit)) return true;
    return false;
  }
}

/** How far past its verge another road's land may reach over a prop, and its land strip and skirt (render/roadside.ts). */
const HIGHER_LAND_M = 40;
const LAND_STRIP_M = 24;
const SKIRT_RUN_PER_M = 2.2;

interface RoadPoint {
  edge: number;
  s: number;
  x: number;
  z: number;
  y: number;
  half: number;
}

/**
 * Every road's centre line in a grid (render/roadside.ts `RoadGrid`, the same two questions): does
 * another road (or this one further on, round a loop) lie under a spot, and does a higher road's land
 * lie over it.
 */
class RoadGrid {
  private readonly cells = new Map<string, RoadPoint[]>();
  private readonly stacked: { step: number; near: boolean[] }[] = [];
  private static readonly CELL = 16;
  private static readonly STACK_STEP_M = 8;

  constructor(private readonly road: RoadNetwork) {
    for (const e of road.edges) {
      const half = Math.max(-e.dMin, e.dMax) + DRAWN_VERGE_M;
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

  roadUnder(edge: number, s: number, x: number, z: number, r: number): boolean {
    return this.some(x, z, 12, (p) => {
      if (this.same(p, edge, s, 40)) return false;
      const lim = p.half + r + 1;
      return (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < lim * lim;
    });
  }

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

  get network(): RoadNetwork {
    return this.road;
  }
}

/** Whether nothing kept clear lies over s0..s1 and |d| a0..a1 on a side, with `margin` round it. */
function featuresClear(
  features: readonly Pick<BakedFeature, 's0' | 's1' | 'd0' | 'd1'>[],
  side: -1 | 1,
  s0: number,
  s1: number,
  a0: number,
  a1: number,
  margin: number,
): boolean {
  return !features.some((f) => {
    const lo = Math.min(f.d0 * side, f.d1 * side);
    const hi = Math.max(f.d0 * side, f.d1 * side);
    return (
      Math.min(f.s0, f.s1) - margin < s1 &&
      Math.max(f.s0, f.s1) + margin > s0 &&
      lo - margin < a1 &&
      hi + margin > a0
    );
  });
}

/** The runs of s (2 m steps, render's) where `want` holds: [start, end] pairs. */
function runsOf(length: number, want: (s: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let s = 0; s <= length + 1e-6; s += 2) {
    const here = want(Math.min(s, length));
    if (here && start < 0) start = s;
    if ((!here || s + 2 > length + 1e-6) && start >= 0) {
      out.push([start, here ? length : s - 2]);
      start = -1;
    }
  }
  return out;
}

/** Collects the pieces as they are placed. */
class Collector {
  readonly items: StreetFurniture[] = [];
  constructor(private readonly road: RoadNetwork) {}
  add(
    kind: FurnitureKind,
    layer: FurnitureLayer,
    rule: string,
    variant: number,
    edge: number,
    s: number,
    d: number,
    turn: FurnitureTurn,
    size: number,
  ): void {
    const road = this.road;
    const yaw =
      'yaw' in turn
        ? turn.yaw
        : 'face' in turn
          ? faceRoadYaw(road, edge, s, d) + turn.face
          : roadYaw(road, edge, s) + (turn.along > 0 ? Math.PI : 0);
    const spec: FurnitureSpec = FURNITURE[kind];
    this.items.push({
      id: this.items.length,
      kind,
      cls: spec.cls,
      layer,
      rule,
      variant,
      edge,
      s,
      d,
      turn,
      size,
      shape: shapeOf(road, kind, variant, edge, s, d, yaw, size),
      heightM: spec.heightM * size,
    });
  }
}

// ---- the roadside kits' sidewalk rules (render/roadside.ts) -------------------------------------

/** One of the kits' rules this plan places (its fields as render/roadside.ts `RoadsideRule` has them). */
interface KitRule {
  id: string;
  kind: FurnitureKind;
  /** Its place in its kit's list: the seeded stream it draws on (render's `ri`). */
  index: number;
  v: readonly number[];
  on: readonly LandTheme[];
  every: number;
  rate: number;
  across: readonly [number, number];
  r: number;
  face?: boolean;
  align?: boolean;
  along?: number;
  size?: readonly [number, number];
  canopy?: boolean;
  understory?: boolean;
  district?: readonly string[];
}

const CITY: readonly LandTheme[] = ['urban'];
const CITY_AND_DOCKS: readonly LandTheme[] = ['urban', 'industrial'];
const OLDTOWN_LAND: readonly LandTheme[] = ['oldtown'];
const OLDTOWN = ['key-oldtown'];

/**
 * San Francisco's kerb props (render/roadside.ts SF_KIT, indices 2 to 8; 0 and 1, the corner store and
 * the parked cars, stand past the sidewalk and stay render's).
 */
export const SF_SIDEWALK_RULES: readonly KitRule[] = [
  {
    id: 'street-tree',
    kind: 'street-tree',
    index: 2,
    v: [3],
    on: CITY,
    every: 13,
    rate: 0.75,
    across: [0.55, 0.2],
    r: 0.45,
    canopy: true,
  },
  {
    id: 'board',
    kind: 'board',
    index: 3,
    v: [6, 7, 8],
    on: CITY,
    every: 110,
    rate: 0.65,
    across: [0.6, 0.5],
    r: 0.7,
    face: true,
  },
  {
    id: 'lamp',
    kind: 'lamp',
    index: 4,
    v: [12],
    on: CITY_AND_DOCKS,
    every: 32,
    rate: 0.85,
    across: [0.25, 0],
    r: 0.4,
    face: true,
  },
  {
    id: 'meter',
    kind: 'meter',
    index: 5,
    v: [10],
    on: CITY,
    every: 7,
    rate: 0.6,
    across: [0.3, 0],
    r: 0.25,
    face: true,
    align: true,
  },
  {
    id: 'bins',
    kind: 'bins',
    index: 6,
    v: [11],
    on: CITY,
    every: 40,
    rate: 0.5,
    across: [0.7, 0.3],
    r: 1.0,
    face: true,
  },
  {
    id: 'hydrant',
    kind: 'hydrant',
    index: 7,
    v: [4],
    on: CITY_AND_DOCKS,
    every: 55,
    rate: 0.7,
    across: [0.35, 0.2],
    r: 0.35,
  },
  {
    id: 'scooter',
    kind: 'scooter',
    index: 8,
    v: [5],
    on: CITY_AND_DOCKS,
    every: 30,
    rate: 0.55,
    across: [0.4, 0.8],
    r: 0.75,
  },
];

/** Key West's Old Town sidewalk (render/roadside.ts KEYS_KIT, indices 1, 2 and 29). */
export const OLDTOWN_SIDEWALK_RULES: readonly KitRule[] = [
  {
    id: 'oldtown-planter',
    kind: 'planter-palm',
    index: 1,
    v: [7],
    on: OLDTOWN_LAND,
    every: 22,
    rate: 0.55,
    across: [1.4, 0.8],
    r: 1.3,
    district: OLDTOWN,
  },
  {
    id: 'oldtown-scooters',
    kind: 'scooter-rack',
    index: 2,
    v: [6],
    on: OLDTOWN_LAND,
    every: 40,
    rate: 0.5,
    across: [1.2, 0.6],
    r: 0.9,
    district: OLDTOWN,
    face: true,
    along: 2.1,
  },
  {
    id: 'oldtown-frangipani',
    kind: 'frangipani',
    index: 29,
    v: [5],
    on: OLDTOWN_LAND,
    every: 26,
    rate: 0.6,
    across: [1.1, 0.5],
    r: 1.1,
    district: OLDTOWN,
    size: [0.85, 1.15],
    canopy: true,
  },
];

/** Which roadside kit a network's render draws (render/models.ts `modelKindsFor` and roadside.ts `kitFor`). */
export function kitOfNetwork(road: RoadNetwork): 'keys' | 'sf' | 'pnw' | null {
  const tags = new Set<string>();
  let any = false;
  let tropical = false;
  for (const e of road.edges)
    for (const t of e.tags) {
      any = true;
      tags.add(t.tag);
      if (t.tag === 'palms' || t.tag === 'beach' || t.tag === 'mangrove' || t.tag === 'swamp')
        tropical = true;
    }
  if (tropical || !any) return 'keys';
  if (['row-houses', 'painted-houses', 'gardens'].some((t) => tags.has(t))) return 'sf';
  if (tags.has('forest') || tags.has('sawmill')) return 'pnw';
  const city = [
    'towers',
    'plaza',
    'cross-street',
    'cable-crossing',
    'promenade',
    'pier-shed',
    'ferry-hall',
    'sea-lions',
    'wharf',
    'wharf-street',
    'ferry-plaza',
    'wharf-lot',
    'shopfronts',
    'murals',
    'mascot-mural',
  ];
  return city.some((t) => tags.has(t)) ? 'sf' : null;
}

/** The kit's sidewalk rules on every edge, in render's order (edge by edge, each rule left then right). */
function placeKitRules(grid: RoadGrid, out: Collector, seed: number, rules: readonly KitRule[]): void {
  const road = grid.network;
  const taken = new Discs();
  const zonesOf = new Map<number, { s0: number; s1: number; lo: number; hi: number }[]>();
  for (const z of road.splitZones()) {
    const list = zonesOf.get(z.edge) ?? [];
    list.push({ s0: z.s0, s1: z.s1, lo: Math.min(z.d0, z.d1), hi: Math.max(z.d0, z.d1) });
    zonesOf.set(z.edge, list);
  }
  for (const e of road.edges) {
    const tags = tagsOf(road, e.index);
    const features = e.features.filter((f) => KEEP_CLEAR.has(f.kind));
    const zones = zonesOf.get(e.index) ?? [];
    const outer = (side: -1 | 1) => (side < 0 ? -e.dMin : e.dMax) + DRAWN_VERGE_M;
    for (const rule of rules)
      for (const side of [-1, 1] as const) {
        const h = (k: number, sd: number, salt: number) =>
          scatterHash(seed, 7919 + e.index * 977 + rule.index * 131, k, sd * 17 + salt + 40);
        const sideName = side < 0 ? 'left' : 'right';
        const spacing = rule.every;
        for (let k = 0; ; k++) {
          const s0 = (k + 0.15 + (rule.align ? 0 : 0.7 * h(k, side, 0))) * spacing;
          if (s0 > e.length) break;
          if (h(k, side, 1) >= rule.rate) continue;
          const clearOf = rule.understory ? 0 : looseBandPast(road, e.index, side, s0, outer(side)) + rule.r;
          const across = Math.max(rule.across[0] + rule.across[1] * h(k, side, 2), clearOf);
          const along = rule.along ?? rule.r;
          const variant = rule.v[Math.floor(h(k, side, 4) * rule.v.length) % rule.v.length] ?? 0;
          const s = s0;
          if (s - along < 0 || s + along > e.length) continue;
          if (!(rule.on as readonly string[]).includes(themeAt(tags, sideName, s))) continue;
          if (rule.district && !inDistrict(tags, sideName, s, rule.district)) continue;
          const d = side * (outer(side) + across);
          // On the sidewalk, or nowhere: the plan is the ridable band's furniture (the kit drew a piece past a
          // loose band, or where no band is drawn, only by reading the drawn land, which the sim cannot).
          const band = road.vergeAt(e.index, s, sideName);
          if (band.widthM <= 0 || LOOSE_BAND.has(band.surface) || Math.abs(d) >= Math.abs(band.dOuter))
            continue;
          // Render draws no land within 5 m of a barrier's or a bridge's span on that side (render/road-mesh.ts,
          // sampled every 2 m), so a piece keeps 8 m off one.
          if (nearBarrier(e.barriers, tags, sideName, s, 8)) continue;
          const p = road.toWorld(e.index, s, d, -0.09);
          const r = rule.r * (rule.size?.[1] ?? 1);
          const m = Math.max(r, 3);
          const featureHit = features.some(
            (f) =>
              s >= Math.min(f.s0, f.s1) - m &&
              s <= Math.max(f.s0, f.s1) + m &&
              d >= Math.min(f.d0, f.d1) - m &&
              d <= Math.max(f.d0, f.d1) + m,
          );
          const zoneHit = zones.some((z) => s >= z.s0 - r && s <= z.s1 + r && d >= z.lo - r && d <= z.hi + r);
          if (featureHit || zoneHit) continue;
          if (taken.hits(p.x, p.z, r, !!rule.understory)) continue;
          if (grid.roadUnder(e.index, s, p.x, p.z, r) || grid.landOver(e.index, s, p.x, p.z, p.y)) continue;
          if (
            along > r &&
            [-along, along].some((u) => {
              const q = road.toWorld(e.index, s + u, d, -0.09);
              return grid.landOver(e.index, s + u, q.x, q.z, q.y);
            })
          )
            continue;
          const turn: FurnitureTurn = rule.face ? { face: 0 } : { yaw: h(k * 31, side, 5) * Math.PI * 2 };
          const size = rule.size ? rule.size[0] + (rule.size[1] - rule.size[0]) * h(k * 31, side, 6) : 1;
          if (rule.canopy) taken.add(p.x, p.z, r, true);
          else taken.add(p.x, p.z, rule.understory ? r * 0.6 : r);
          out.add(rule.kind, 'kit', rule.id, variant, e.index, s, d, turn, size);
        }
      }
  }
}

// ---- San Francisco's downtown (render/downtown.ts) --------------------------------------------

/** Downtown's lamps and planters along a sidewalk, and its features' margin (render/downtown.ts). */
const DT_LAMP_EVERY_M = 30;
const DT_FEATURE_CLEAR_M = 2.5;
/** The borrowed kit's variants (render/downtown.ts SF_PROPS), and the downtown kit's (DT). */
const SF_HYDRANT = 4;
const SF_SCOOTER = 5;
const SF_BOARDS = [6, 7, 8] as const;
const DT_LAMP = 7;
const DT_SIGNAL = 8;
const DT_PLANTER = 9;
const DT_BENCH = 10;
const DT_ORB = 11;

function placeDowntown(road: RoadNetwork, out: Collector, seed: number): void {
  const crossings: { edge: number; s: number; half: number; outer: number }[] = [];
  for (const e of road.edges) {
    const tags = tagsOf(road, e.index);
    if (!tags.some((t) => ['towers', 'plaza', 'cross-street', 'cable-crossing'].includes(t.tag))) continue;
    const features = e.features.filter((f) => KEEP_CLEAR.has(f.kind));
    // A branch's split zone is kept clear too, as the kit's rules keep it (placeKitRules): it is where a rider
    // leaves the road, and the Plaza Cut's flight off its ramp truck crosses it (a lamp stood in it at s 660).
    const zones = road
      .splitZones()
      .filter((z) => z.edge === e.index)
      .map((z) => ({ s0: z.s0, s1: z.s1, d0: z.d0, d1: z.d1 }));
    const h = (k: number, side: number, salt: number) =>
      scatterHash(seed, 4111 + e.index * 977, k, side * 37 + salt);
    const outerOf = (side: -1 | 1) => (side < 0 ? -e.dMin : e.dMax) + DRAWN_VERGE_M;
    const clear = (
      side: -1 | 1,
      s0: number,
      s1: number,
      a0: number,
      a1: number,
      margin = DT_FEATURE_CLEAR_M,
    ) =>
      featuresClear(features, side, s0, s1, a0, a1, margin) && featuresClear(zones, side, s0, s1, a0, a1, 0);
    const runs = (side: -1 | 1, want: string) =>
      runsOf(e.length, (s) => themeAt(tags, side < 0 ? 'left' : 'right', s) === want);
    const seen = new Set<string>();
    for (const t of tags) {
      if (t.tag !== 'cross-street' && t.tag !== 'cable-crossing') continue;
      const s = (t.s0 + t.s1) / 2;
      const id = `${t.tag}:${s}`;
      if (seen.has(id)) continue;
      seen.add(id);
      crossings.push({ edge: e.index, s, half: (t.s1 - t.s0) / 2, outer: Math.max(outerOf(-1), outerOf(1)) });
    }
    for (const side of [-1, 1] as const) {
      const outer = outerOf(side);
      // Lamps on the sidewalks and the plazas, a planter (or a hydrant, a scooter, a board) between each two.
      for (const want of ['downtown', 'plaza'] as const) {
        for (const [a, b] of runs(side, want)) {
          for (let k = 0; ; k++) {
            const s = a + 6 + k * DT_LAMP_EVERY_M + (side > 0 ? DT_LAMP_EVERY_M / 2 : 0);
            if (s > b - 4) break;
            if (clear(side, s - 1, s + 1, outer, outer + 1.6))
              out.add(
                'dt-lamp',
                'downtown',
                'lamp',
                DT_LAMP,
                e.index,
                s,
                side * (outer + 0.6),
                { face: 0 },
                1,
              );
            const sp = s + DT_LAMP_EVERY_M / 2;
            if (sp < b - 4 && clear(side, sp - 1.5, sp + 1.5, outer + 0.8, outer + 3.4)) {
              const pick = h(k + Math.round(a), side, 8);
              const d = side * (outer + 2.3);
              if (pick < 0.45)
                out.add('dt-planter', 'downtown', 'planter', DT_PLANTER, e.index, sp, d, { yaw: 0 }, 1);
              else if (pick < 0.6)
                out.add('hydrant', 'downtown', 'hydrant', SF_HYDRANT, e.index, sp, d, { face: 0 }, 1);
              else if (pick < 0.8)
                out.add('scooter', 'downtown', 'scooter', SF_SCOOTER, e.index, sp, d, { yaw: pick * 40 }, 1);
              else {
                const v = SF_BOARDS[Math.floor(h(k, side, 9) * 3) % 3] ?? 6;
                out.add('board', 'downtown', 'board', v, e.index, sp, d, { face: 0 }, 1);
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
            const bench = across === 7;
            out.add(
              bench ? 'dt-bench' : 'dt-planter',
              'downtown',
              bench ? 'bench' : 'plaza-planter',
              bench ? DT_BENCH : DT_PLANTER,
              e.index,
              s,
              side * (outer + across),
              { face: 0 },
              1,
            );
          }
        }
        for (const off of [0, -40, 40, -80, 80, -120, 120]) {
          const at = mid + off;
          if (at < a + 8 || at > b - 8 || !clear(side, at - 4, at + 4, outer + 6, outer + 14, 1)) continue;
          out.add('dt-orb', 'downtown', 'orb', DT_ORB, e.index, at, side * (outer + 10), { yaw: 0 }, 1);
          break;
        }
      }
    }
  }
  // The signals: on the far right corner for each way along the avenue, the arm over its lanes.
  for (const c of crossings) {
    const e = road.edges[c.edge];
    if (!e) continue;
    for (const way of [1, -1] as const) {
      const s = Math.max(0, Math.min(e.length, c.s + way * (c.half + 1.5)));
      out.add(
        'dt-signal',
        'downtown',
        'signal',
        DT_SIGNAL,
        c.edge,
        s,
        way * (c.outer + 0.5),
        { along: way },
        1,
      );
    }
  }
}

// ---- San Francisco's waterfront (render/waterfront.ts) ----------------------------------------

const WF_BAY_TAGS = ['promenade', 'pier-shed', 'ferry-hall', 'sea-lions'];
const WF_CITY_TAGS = ['wharf', 'wharf-street', 'ferry-plaza', 'wharf-lot'];
const WF_PALM_EVERY_M = 24;
const WF_LAMP_EVERY_M = 32;
const WF_BENCH_EVERY_M = 48;
const WF_FEATURE_CLEAR_M = 2;

function placeWaterfront(road: RoadNetwork, out: Collector, seed: number): void {
  for (const e of road.edges) {
    const tags = tagsOf(road, e.index);
    if (!tags.some((t) => WF_BAY_TAGS.includes(t.tag) || WF_CITY_TAGS.includes(t.tag))) continue;
    const features = e.features.filter((f) => KEEP_CLEAR.has(f.kind));
    const h = (k: number, side: number, salt: number) =>
      scatterHash(seed, 7211 + e.index * 977, k, side * 41 + salt);
    const has = (side: 'left' | 'right', s: number, tag: string) =>
      tags.some((t) => t.tag === tag && onSide(t, side) && s >= t.s0 && s <= t.s1);
    const clear = (
      side: -1 | 1,
      s0: number,
      s1: number,
      a0: number,
      a1: number,
      margin = WF_FEATURE_CLEAR_M,
    ) => featuresClear(features, side, s0, s1, a0, a1, margin);
    const runs = (want: (s: number) => boolean) => runsOf(e.length, want);
    const vR = (s: number) => road.vergeAt(e.index, s, 'right');
    const vL = (s: number) => road.vergeAt(e.index, s, 'left');
    const outerL = -e.dMin + DRAWN_VERGE_M;
    const bayOpen = (s: number) =>
      has('right', s, 'promenade') && !has('right', s, 'pier-shed') && !has('right', s, 'ferry-hall');
    if (tags.some((t) => t.tag === 'promenade')) {
      // Palms, lamps and benches along the seawall's edge (palms and lamps on the paving a little in
      // from it, benches at it, facing the bay), never in front of a shed's door or the hall.
      for (const [a, b] of runs((s) => has('right', s, 'promenade'))) {
        for (let k = 0; ; k++) {
          const s = a + 8 + k * WF_PALM_EVERY_M + 6 * (h(k, 1, 1) - 0.5);
          if (s > b - 4) break;
          const d = vR(s).dOuter - 1.6;
          if (!clear(1, s - 2, s + 2, d - 2, d + 2)) continue;
          const variant = Math.floor(h(k, 1, 2) * 3);
          out.add(
            'palm',
            'waterfront',
            'palm',
            variant,
            e.index,
            s,
            d,
            { yaw: h(k, 1, 3) * Math.PI * 2 },
            1.05 + 0.3 * h(k, 1, 4),
          );
        }
        for (let k = 0; ; k++) {
          const s = a + 20 + k * WF_LAMP_EVERY_M;
          if (s > b - 4) break;
          const d = vR(s).dOuter - 0.9;
          if (!clear(1, s - 1, s + 1, d - 1, d + 1)) continue;
          out.add('wf-lamp', 'waterfront', 'lamp', 0, e.index, s, d, { face: Math.PI / 2 }, 1);
        }
        for (let k = 0; ; k++) {
          const s = a + 32 + k * WF_BENCH_EVERY_M;
          if (s > b - 4) break;
          if (!bayOpen(s)) continue;
          const d = vR(s).dOuter - 0.7;
          if (!clear(1, s - 2, s + 2, d - 1, d + 1)) continue;
          out.add('wf-bench', 'waterfront', 'bench', 0, e.index, s, d, { face: Math.PI }, 1);
        }
      }
    }
    if (!tags.some((t) => WF_CITY_TAGS.includes(t.tag))) continue;
    const front = (s: number) => has('left', s, 'wharf') && vL(s).edge === 'hard';
    // Lamps along the sidewalk, and palms and benches on the plaza.
    for (const [a, b] of runs(front)) {
      for (let k = 0; ; k++) {
        const s = a + 10 + k * WF_LAMP_EVERY_M;
        if (s > b - 4) break;
        const d = -(outerL + 0.5);
        if (!clear(-1, s - 1, s + 1, -d - 1, -d + 1)) continue;
        out.add('wf-lamp', 'waterfront', 'sidewalk-lamp', 0, e.index, s, d, { face: Math.PI / 2 }, 0.9);
      }
    }
    for (const [a, b] of runs((s) => has('left', s, 'ferry-plaza'))) {
      for (let s = a + 8; s < b - 6; s += 15) {
        for (const across of [5, 13]) {
          const d = -(outerL + across);
          if (!clear(-1, s - 2, s + 2, -d - 2, -d + 2)) continue;
          const k = Math.round(s) + across;
          out.add(
            'palm',
            'waterfront',
            'plaza-palm',
            k % 3,
            e.index,
            s,
            d,
            { yaw: h(k, -1, 40) * Math.PI * 2 },
            1.1 + 0.25 * h(k, -1, 41),
          );
        }
        const d = -(outerL + 9);
        if (clear(-1, s + 5, s + 9, -d - 1, -d + 1))
          out.add('wf-bench', 'waterfront', 'plaza-bench', 0, e.index, s + 7, d, { face: 0 }, 1);
      }
    }
    // The lot: parked cars in two rows, nose to the road (the far row turned round).
    for (const [a, b] of runs((s) => has('left', s, 'wharf-lot'))) {
      for (let k = 0; ; k++) {
        const s = a + 5.5 + k * 3;
        if (s > b - 3) break;
        for (const [across, row] of [
          [6.8, 0],
          [14.3, 1],
        ] as const) {
          if (h(k, -1, 50 + row) < 0.35) continue;
          const d = -(outerL + across);
          if (!clear(-1, s - 1.5, s + 1.5, -d - 3, -d + 3, 0.5)) continue;
          const variant = [0, 1, 2][Math.floor(h(k, -1, 52 + row) * 3)] ?? 0;
          out.add(
            'parked-car',
            'waterfront',
            'parked-car',
            variant,
            e.index,
            s,
            d,
            { face: row ? Math.PI : 0 },
            1,
          );
        }
      }
    }
  }
}

// ---- San Francisco's mural district (render/mission.ts) ----------------------------------------

/** The district's wall kinds by tag, the first winning where two meet, and its walls' spacing (render/mission.ts). */
const MS_KIND_OF: Readonly<Record<string, 'mascot' | 'murals' | 'shopfronts'>> = {
  'mascot-mural': 'mascot',
  murals: 'murals',
  shopfronts: 'shopfronts',
};
const MS_RANK = { mascot: 0, murals: 1, shopfronts: 2 } as const;
const MS_STEP_M = 2;
const MS_WALL_GAP_M = 0.05;
const MS_SCAFFOLD_M = 1.6;
const MS_LANDMARK_GAP_M = 1;
const MS_LAMP_EVERY_M = 34;
const SF_LAMP = 12;
const SF_BINS = 11;

interface MsLine {
  kind: 'mascot' | 'murals' | 'shopfronts';
  side: -1 | 1;
  edges: number[];
  ss: number[];
  ds: number[];
  us: number[];
  x: number[];
  z: number[];
}

/** The district's wall lines, as render/mission.ts `wallLines` walks them (the same order, so the same seeds). */
function missionLines(road: RoadNetwork): MsLine[] {
  const out: MsLine[] = [];
  for (const e of road.edges) {
    const tags = tagsOf(road, e.index);
    if (!tags.some((t) => MS_KIND_OF[t.tag])) continue;
    const landmarks = e.features.filter((f) => f.kind === 'landmark');
    for (const side of [-1, 1] as const) {
      const name = side < 0 ? 'left' : 'right';
      const kindAt = (s: number) => {
        if (
          landmarks.some(
            (f) =>
              Math.min(f.d0, f.d1) * side > 0 &&
              s > Math.min(f.s0, f.s1) - MS_LANDMARK_GAP_M &&
              s < Math.max(f.s0, f.s1) + MS_LANDMARK_GAP_M,
          )
        )
          return null;
        let best: MsLine['kind'] | null = null;
        for (const t of tags) {
          if (s < t.s0 || s > t.s1 || !onSide(t, name)) continue;
          const k = MS_KIND_OF[t.tag];
          if (k && (best === null || MS_RANK[k] < MS_RANK[best])) best = k;
        }
        return best;
      };
      const n = Math.max(1, Math.round(e.length / MS_STEP_M));
      let line: MsLine | null = null;
      for (let k = 0; k <= n; k++) {
        const s = (e.length * k) / n;
        const kind = kindAt(s === e.length ? s - 1e-6 : s);
        if (!kind || (line && line.kind !== kind)) {
          if (line && line.x.length > 1) out.push(line);
          line = null;
        }
        if (!kind) continue;
        if (!line) line = { kind, side, edges: [], ss: [], ds: [], us: [], x: [], z: [] };
        const verge = road.vergeAt(e.index, s, name);
        const d = side * (Math.abs(verge.dOuter) + (kind === 'mascot' ? MS_SCAFFOLD_M : MS_WALL_GAP_M));
        const p = road.toWorld(e.index, s, d, 0);
        const last = line.x.length - 1;
        const lx = line.x[last];
        const lz = line.z[last];
        line.us.push(
          lx === undefined || lz === undefined
            ? 0
            : (line.us[last] ?? 0) + sqrt((p.x - lx) * (p.x - lx) + (p.z - lz) * (p.z - lz)),
        );
        line.x.push(p.x);
        line.z.push(p.z);
        line.edges.push(e.index);
        line.ss.push(s);
        line.ds.push(d);
      }
      if (line && line.x.length > 1) out.push(line);
    }
  }
  // A mascot wall that runs round a corner onto the next road is one wall (render joins it the same way).
  const joined: MsLine[] = [];
  for (const l of out) {
    const prev =
      l.kind === 'mascot' && (l.ss[0] ?? 1) <= 1e-6
        ? joined.find((j) => {
            const last = road.edges[j.edges[j.edges.length - 1] ?? -1];
            return (
              j.kind === 'mascot' &&
              j.side === l.side &&
              !!last &&
              l.edges[0] === last.index + 1 &&
              (j.ss[j.ss.length - 1] ?? 0) >= last.length - 1e-6
            );
          })
        : undefined;
    if (prev) {
      const base = prev.us[prev.us.length - 1] ?? 0;
      for (let i = 1; i < l.x.length; i++) {
        prev.x.push(l.x[i] ?? 0);
        prev.z.push(l.z[i] ?? 0);
        prev.us.push(base + (l.us[i] ?? 0));
        prev.edges.push(l.edges[i] ?? 0);
        prev.ss.push(l.ss[i] ?? 0);
        prev.ds.push(l.ds[i] ?? 0);
      }
      continue;
    }
    joined.push(l);
  }
  return joined;
}

/** The shopfront sidewalks' lamps at the kerb, and bins by some doors (render/mission.ts). */
function placeMission(road: RoadNetwork, out: Collector, seed: number): void {
  missionLines(road).forEach((line, li) => {
    if (line.kind !== 'shopfronts') return;
    const total = line.us[line.us.length - 1] ?? 0;
    const indexAt = (u: number) => {
      let i = 0;
      while (i + 1 < line.us.length && (line.us[i + 1] ?? 0) <= u) i++;
      return i;
    };
    for (let s = MS_LAMP_EVERY_M / 2; s < total; s += MS_LAMP_EVERY_M) {
      const i = Math.min(line.x.length - 1, indexAt(s));
      const e = line.edges[i] ?? 0;
      const ss = line.ss[i] ?? 0;
      const edge = road.edges[e];
      if (!edge) continue;
      const kerb = line.side * (Math.abs(line.ds[i] ?? 0) - 3.6);
      const features = edge.features.filter((f) =>
        ['billboard', 'copSpawn', 'roadsideZone'].includes(f.kind),
      );
      const blocked = features.some(
        (f) =>
          Math.min(f.s0, f.s1) - 3 < ss &&
          Math.max(f.s0, f.s1) + 3 > ss &&
          Math.min(f.d0, f.d1) - 1 <= kerb &&
          Math.max(f.d0, f.d1) + 1 >= kerb,
      );
      if (blocked) continue;
      out.add('lamp', 'mission', 'lamp', SF_LAMP, e, ss, kerb, { face: 0 }, 1);
      if (scatterHash(seed, 5023 + li, s, 9) < 0.35) {
        const bd = line.side * (Math.abs(line.ds[i] ?? 0) - 0.6);
        out.add('bins', 'mission', 'bins', SF_BINS, e, ss + 4, bd, { face: 0 }, 1);
      }
    }
  });
}

// ---- the plan ----------------------------------------------------------------------------------

const plans = new WeakMap<RoadNetwork, Map<number, FurniturePlan>>();

/**
 * The street furniture of a network for a seed (the race's: render's scenery seed is the race seed),
 * worked out once and kept. Every piece the kits and the city layers stand where a rider can ride, and
 * the rest of those layers' kerb pieces with them (one plan, so no two of them stand in each other).
 */
export function planStreetFurniture(road: RoadNetwork, seed: number): FurniturePlan {
  let bySeed = plans.get(road);
  if (!bySeed) plans.set(road, (bySeed = new Map<number, FurniturePlan>()));
  const known = bySeed.get(seed);
  if (known) return known;
  const out = new Collector(road);
  const kit = kitOfNetwork(road);
  const grid = kit === 'sf' || kit === 'keys' ? new RoadGrid(road) : null;
  if (grid && kit === 'sf') placeKitRules(grid, out, seed, SF_SIDEWALK_RULES);
  if (grid && kit === 'keys' && road.edges.some((e) => e.tags.some((t) => t.tag === 'key-oldtown')))
    placeKitRules(grid, out, seed, OLDTOWN_SIDEWALK_RULES);
  placeDowntown(road, out, seed);
  placeWaterfront(road, out, seed);
  placeMission(road, out, seed);
  const byEdge: StreetFurniture[][] = road.edges.map(() => []);
  let reachS = 0;
  for (const it of out.items) {
    byEdge[it.edge]?.push(it);
    if (it.shape.reachS > reachS) reachS = it.shape.reachS;
  }
  for (const list of byEdge)
    list.sort((p, q) => p.shape.s - p.shape.reachS - (q.shape.s - q.shape.reachS) || p.id - q.id);
  const plan: FurniturePlan = { items: out.items, byEdge, reachS };
  bySeed.set(seed, plan);
  return plan;
}

/** Whether a piece's footprint lies on a ridable band (any of it inside the band's outer edge). */
export function onRidableBand(road: RoadNetwork, it: StreetFurniture): boolean {
  const side = it.shape.d < 0 ? 'left' : 'right';
  const v = road.vergeAt(it.edge, it.s, side);
  const near = Math.abs(it.shape.d) - it.shape.reachD;
  return v.widthM > 0 && near < Math.abs(v.dOuter);
}
