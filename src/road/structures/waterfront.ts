// San Francisco's waterfront as solid structures (the maintainer, 2026-10-06, [decided]: "consistent physics and
// gameplay is important here so players know what to expect and how to interact with the world"; the physical
// world, docs/architecture.md "Physical world"). This module is where the waterfront's buildings are PLACED: the
// pier sheds and the ferry hall on the seawall, the front blocks on the sidewalk, the plaza's and the lot's
// blocks, the towers behind, and the blocks lining each side street. They were render/waterfront.ts's own
// rules (run W-U: "low waterfront blocks shoulder to shoulder behind the sidewalk, with taller towers behind
// them"); they are moved here UNCHANGED (the same seeded hash, the same spacing, the same keep-clear rules, the
// same heights), so the waterfront looks as it did, and each building now also carries its solids (`specs`: the
// footprint, base and roof of each of its parts as DRAWN) for the sim to meet. Render draws the layout this
// module returns (render/waterfront.ts builds each building's boxes from its kind, width and seeded `u`), and
// the structure registry plans the same specs (`waterfrontPlanner`), so what is drawn is what is hit.
// scripts/hitboxes.test.ts holds the drawn boxes to the specs.
//
// What is a solid here (the hitbox audit's rule, scripts/hitboxes.test.ts): a body, a roof, a deck, a tower tier,
// and a thing standing on a roof that a rider could meet (the crab house's sign board and its post, a water tank
// and its stilt). Left out, as trim or overhead: cornices, pilasters, trims and window panels (at most 0.7 m proud
// of a wall), awnings, blade signs and eaves (their underside is 2.9 m or more over the pavement), the crab
// house's fish (2.3 m or more over its roof), the clock tower's flagpole, corner piers and clock faces, and what
// is wire-thin. Under the decks, the piles and the seawall's face are under the course, not solids.
//
// A pier shed's and the hall's deck is a `pier`: a flat top at the promenade's level over the water behind the
// facade. The ferry moored at the hall's slip is solid too (its hull, house, bridge and funnel).
//
// Inputs: the network and the seed only (the road files' `tags` and `features`, which a network's edges carry).
// It reads nothing render has loaded (the palms, the boats and the car kit stay render's) and nothing of the
// drawn land, so the plan is the same before and after any model loads. Pure + - * / and core math, like the
// rest of road/: ascending iteration, no Math.random. A lazy chunk: it loads with the region (`STRUCTURE_LAYERS`,
// `loadWaterfrontPlan`), never in the first load.
import { atan2 } from '../../core';
import type { RoadNetwork } from '../network';
import { modelFoot, type StructureClass, type StructurePlanner, type StructureSpec } from '../structures';
import { onSide, scatterHash, type SideTag } from '../themes';

/** The layer's name in `STRUCTURE_LAYERS`. */
export const WATERFRONT_LAYER = 'sf-waterfront';
/** The waterfront's tags (tools/road/tracks/sf-waterfront.ts). */
export const WATERFRONT_BAY_TAGS = ['promenade', 'pier-shed', 'ferry-hall', 'sea-lions'] as const;
export const WATERFRONT_CITY_TAGS = ['wharf', 'wharf-street', 'ferry-plaza', 'wharf-lot'] as const;

/** The verge past the drawn shoulder (render/road-mesh.ts VERGE_M), m. */
const VERGE_M = 0.6;
/** The road scene's land strip past the verge on the city side (render/road-mesh.ts SCENERY_LAND_M), m. */
const LAND_STRIP_M = 24;
/** Where the layer's land stands over the road's surface (render/scenery.ts LAND_TOP_M), m. */
export const LAND_TOP_M = -0.09;
/** How deep a pier shed reaches out over the water, and the ferry hall, m. [default] */
export const SHED_DEPTH_M = 70;
export const HALL_DEPTH_M = 42;
/** A waterfront block's depth back from its front, m: past the land strip's edge, so none shows behind it. */
export const BLOCK_DEPTH_M = 22;
/** Building walls reach this far under their base, so none shows a gap on a slope (the drawn walls, m). */
export const FOOT_M = 4;
/** The taller towers behind the blocks: past the front this far (plus a seeded spread), every so often. */
const BACK_ROW_M = 40;
const BACK_ROW_EVERY_M = 36;
/** The back towers' `u` (their seeded height and width), one per variant. */
export const BACK_TOWER_U: readonly number[] = [0.1, 0.3, 0.5, 0.7, 0.9];
/** A side street's reach inland and its roadway's half width, m. */
export const STREET_REACH_M = 170;
/** A side street drops this much per metre past the land strip, down to the floor. */
const STREET_DROP = 0.05;
/** The city floor under the blocks (render draws it): its height, and where the towers' feet stand, m. */
export const CITY_FLOOR_Y = 0.45;
/** Behind the plaza and the lot, buildings stand this far past the verge, m: where their paving ends. */
const OPEN_BACK_M = 17.4;
/** Features nothing of this layer stands in, with room round them (render/road-mesh.ts KEEP_CLEAR). */
const KEEP_CLEAR: ReadonlySet<string> = new Set([
  'billboard',
  'boostPad',
  'rampTruck',
  'roadsideZone',
  'copSpawn',
]);
const FEATURE_CLEAR_M = 2;

/**
 * The pier numbers [default], nearest the ferry hall first: even on the hall's near side, odd past
 * it, as the city numbers its piers (with gaps, as its numbers have).
 */
export const EVEN_PIERS: readonly number[] = [14, 20, 22, 24, 26, 28, 30, 32, 36, 38, 40];
export const ODD_PIERS: readonly number[] = [1, 3, 5, 7, 9, 15, 17, 19, 23, 27, 29, 31, 33, 35, 39];

/** What a waterfront block is. */
export type BlockKind = 'loft' | 'arcade' | 'crab' | 'startup' | 'hotel' | 'garage';
/** The front's width each kind takes, m (a building is packed to fill its frontage). */
export const BLOCK_WIDTH: Readonly<Record<BlockKind, readonly [number, number]>> = {
  loft: [20, 28],
  arcade: [24, 34],
  crab: [14, 18],
  startup: [18, 24],
  hotel: [16, 20],
  garage: [26, 32],
};
/** The front row's mix [default]: mostly brick lofts and arcades, now and then the odd ones. */
const BLOCK_MIX: readonly BlockKind[] = [
  'loft',
  'loft',
  'arcade',
  'arcade',
  'loft',
  'crab',
  'startup',
  'hotel',
  'garage',
];

/** A block's wall height over its base for a kind and its seeded `u` (0..1), m: the drawn building's. */
export function blockHeight(kind: BlockKind, u: number): number {
  switch (kind) {
    case 'loft':
      return (3 + Math.floor(u * 2)) * 3.6 + 0.8;
    case 'startup':
      return 3 * 3.6 + 0.8;
    case 'arcade':
      return 9 + u * 2;
    case 'crab':
      return 6.5;
    case 'hotel':
      return (5 + Math.floor(u * 2)) * 3.3 + 1;
    case 'garage':
      return 4 * 3 + 0.6;
  }
}

/** A back tower's width and wall height for its seeded `u`, m (before its size). */
export const backTowerWidth = (u: number): number => 20 + u * 10;
export const backTowerHeight = (u: number): number => 40 + u * 70;

// ---- the layout ------------------------------------------------------------------------------------

type P3 = { x: number; y: number; z: number };

/** A building as placed: its origin (the middle of its front, at its base), its turn about up, its size. */
export interface WfPlaced {
  rule: string;
  edge: number;
  s: number;
  d: number;
  p: P3;
  /** The turn that points its front (+Z) at the road's centre line (or at the street, for a street's block). */
  turn: number;
  size: number;
  /** Its solids: the footprint, base and roof of each drawn part, in the plan's order. */
  specs: readonly StructureSpec[];
}

/** A pier shed or the ferry hall as placed: its front's span on the seawall. */
export interface Frontage {
  kind: 'shed' | 'hall';
  edge: number;
  s0: number;
  s1: number;
  /** The front's d (the verge band's outer edge), and the pier number (0 for the hall). */
  d: number;
  pier: number;
}

export interface WfFront extends WfPlaced {
  kind: 'shed' | 'hall';
  width: number;
  pier: number;
  /** How far the piles reach down from the deck (render's piles; under the course, not a solid). */
  drop: number;
}
export interface WfBlock extends WfPlaced {
  kind: BlockKind;
  width: number;
  /** The seeded 0..1 that varies its height and colours. */
  u: number;
}
export interface WfBackTower extends WfPlaced {
  /** Which of `BACK_TOWER_U` it is. */
  variant: number;
  u: number;
}
/** A side street: the road's frame at its mouth, the unit vectors across (inland) and along, the road's height. */
export interface WfStreet {
  edge: number;
  s: number;
  /** The street's tag span, s0..s1 (its width along the boulevard is s1 - s0). */
  s0: number;
  s1: number;
  centre: P3;
  across: { x: number; z: number };
  along: { x: number; z: number };
  roadY: number;
}
/** What render's flat surfaces need of an edge that carries a waterfront tag. */
export interface WfEdge {
  edge: number;
  /** The left side's outer edge (the city side), m: `-dMin + 0.6`. */
  outerL: number;
  /** The runs of s (2 m steps) along the open promenade, its water side where no shed or hall stands, and the lot. */
  promenade: readonly (readonly [number, number])[];
  bay: readonly (readonly [number, number])[];
  lot: readonly (readonly [number, number])[];
}

export interface WaterfrontLayout {
  frontages: readonly Frontage[];
  fronts: readonly WfFront[];
  /** The front rows, the plaza's and the lot's blocks, then each side street's blocks. */
  blocks: readonly WfBlock[];
  towers: readonly WfBackTower[];
  streets: readonly WfStreet[];
  edges: readonly WfEdge[];
}

// ---- the solids ------------------------------------------------------------------------------------

/** A box in a building's own frame (+Z toward the road, +X across its front, y up from its base), m. */
interface LocalBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** A box `hx` either side of `cx`, from y0 to y1, with its z from `z - depth / 2` to `z + depth / 2`. */
const part = (hx: number, y0: number, y1: number, z: number, depth: number, cx = 0): LocalBox => ({
  x0: cx - hx,
  x1: cx + hx,
  y0,
  y1,
  z0: z - depth / 2,
  z1: z + depth / 2,
});

/** One drawn solid of a building. */
export interface SolidDef {
  /** The rule's suffix after the building's own rule ('' for the building itself). */
  name: string;
  cls: StructureClass;
  box: LocalBox;
  /** Its base is the building's ground (the drawn body goes `FOOT_M` below it, to hide a slope). */
  grounded?: boolean;
}

/** The structure of one solid at a placed building. */
function specOf(at: Omit<WfPlaced, 'specs'>, def: SolidDef): StructureSpec {
  const foot = modelFoot(
    { ...def.box, what: at.rule },
    { x: at.p.x, z: at.p.z, yaw: at.turn, scale: at.size },
  );
  const base = def.grounded === true ? 0 : def.box.y0;
  return {
    rule: def.name === '' ? at.rule : `${at.rule}:${def.name}`,
    cls: def.cls,
    model: null,
    edge: at.edge,
    s: at.s,
    d: at.d,
    foot,
    baseY: at.p.y + base * at.size,
    roof: { kind: 'flat', topM: (def.box.y1 - base) * at.size },
  };
}

/** A pier shed's solids (its width `w`): the deck over the water, the facade, its raised middle, the shed, its clerestory. */
export function shedSolids(w: number): SolidDef[] {
  return [
    { name: '', cls: 'shed', box: part(w / 2, 0, 10, -0.6, 1.2) },
    { name: 'middle', cls: 'shed', box: part(w * 0.2, 10, 13, -0.6, 1.2) },
    { name: 'deck', cls: 'pier', box: part((w + 4) / 2, -0.6, 0, -SHED_DEPTH_M / 2 - 1, SHED_DEPTH_M + 2) },
    { name: 'body', cls: 'shed', box: part((w - 2) / 2, 0, 7.5, -SHED_DEPTH_M / 2 - 1.5, SHED_DEPTH_M - 3) },
    {
      name: 'clerestory',
      cls: 'shed',
      box: part(w * 0.175, 7.5, 9.5, -SHED_DEPTH_M / 2 - 2.5, SHED_DEPTH_M - 6),
    },
  ];
}

/** The ferry hall's tower: its width, and the stack of tiers (each a box on the last, from the hall's roofline up). */
const TOWER_W = 11;
const TOWER_Z = -TOWER_W / 2 - 1;
const HALL_H = 13;
const TOWER_SHAFT_H = 28;

/** The ferry hall's solids (its width `w`): deck, hall, roof, entrance, the tower's tiers, and the ferry at its slip. */
export function hallSolids(w: number): SolidDef[] {
  const out: SolidDef[] = [
    { name: '', cls: 'building', box: part(w / 2, 0, HALL_H, -HALL_DEPTH_M / 2, HALL_DEPTH_M) },
    { name: 'deck', cls: 'pier', box: part((w + 6) / 2, -0.6, 0, -HALL_DEPTH_M / 2 - 1, HALL_DEPTH_M + 2) },
    {
      name: 'roof',
      cls: 'building',
      box: part((w - 4) / 2, HALL_H, HALL_H + 2.2, -HALL_DEPTH_M / 2, HALL_DEPTH_M - 6),
    },
    { name: 'entrance', cls: 'building', box: part(5, HALL_H, HALL_H + 4, 0, 1.2) },
  ];
  // The tower: the shaft, the clock stage (wider), the belfry, then the stepped cap.
  const stage = HALL_H + TOWER_SHAFT_H;
  const belfry = stage + 10;
  out.push({
    name: 'tower',
    cls: 'building',
    box: part(TOWER_W / 2, HALL_H, stage, TOWER_Z, TOWER_W),
  });
  out.push({
    name: 'tower-stage',
    cls: 'building',
    box: part((TOWER_W + 1.6) / 2, stage, stage + 10, TOWER_Z, TOWER_W + 1.6),
  });
  out.push({
    name: 'tower-belfry',
    cls: 'building',
    box: part(TOWER_W / 2, belfry, belfry + 9, TOWER_Z, TOWER_W),
  });
  let y = belfry + 9;
  for (const [i, [size, h]] of (
    [
      [TOWER_W + 1, 1],
      [TOWER_W * 0.7, 3],
      [TOWER_W * 0.45, 3],
      [TOWER_W * 0.22, 3.5],
    ] as const
  ).entries()) {
    out.push({
      name: `tower-cap${i + 1}`,
      cls: 'building',
      box: part(size / 2, y, y + h, TOWER_Z, size),
    });
    y += h;
  }
  // The ferry at its slip, past the hall's far end (the hall faces the road: its -x is up the road).
  const fx = -(w / 2 + 10);
  out.push({ name: 'ferry', cls: 'building', box: part(4.5, -0.8, 2.6, -24, 34, fx) });
  out.push({ name: 'ferry-house', cls: 'building', box: part(3.5, 2.6, 5.2, -24, 22, fx) });
  out.push({ name: 'ferry-bridge', cls: 'building', box: part(2, 5.2, 7.2, -24, 8, fx) });
  out.push({ name: 'ferry-funnel', cls: 'building', box: part(0.6, 7.2, 9.6, -24, 1.2, fx) });
  return out;
}

/** A block's solids (its kind, width and seeded `u`): the body, and what stands on its roof a rider could meet. */
export function blockSolids(kind: BlockKind, width: number, u: number): SolidDef[] {
  const h = blockHeight(kind, u);
  const d = BLOCK_DEPTH_M;
  const out: SolidDef[] = [
    { name: '', cls: 'building', box: part(width / 2, -FOOT_M, h, -d / 2, d), grounded: true },
  ];
  if (kind === 'loft' && u > 0.55) {
    // A wooden water tank on its stilt.
    out.push({ name: 'tank', cls: 'building', box: part(1.3, h + 1.1, h + 4.1, -d / 2, 2.6, width / 4) });
    out.push({ name: 'tank-pole', cls: 'building', box: part(0.1, h, h + 1.2, -d / 2, 0.2, width / 4) });
  }
  if (kind === 'crab') {
    // The crab sign's board and its post (the fish above is 2.3 m or more over the roof: overhead).
    out.push({ name: 'board', cls: 'building', box: part(3.2, h + 0.4, h + 2, -0.8, 0.2) });
    out.push({ name: 'pole', cls: 'building', box: part(0.15, h + 0.6, h + 2.2, -1, 0.3) });
  }
  return out;
}

/** A back tower's solids (its seeded `u`): the body, and the stepped crown on it. */
export function backTowerSolids(u: number): SolidDef[] {
  const w = backTowerWidth(u);
  const h = backTowerHeight(u);
  return [
    { name: '', cls: 'building', box: part(w / 2, -FOOT_M, h, -w * 0.4, w * 0.8), grounded: true },
    { name: 'crown', cls: 'building', box: part(w * 0.35, h, h + 4, -w * 0.4, w * 0.55) },
  ];
}

/** A placed building with its solids made. */
function placed<T extends Omit<WfPlaced, 'specs'>>(
  at: T,
  defs: readonly SolidDef[],
): T & { specs: readonly StructureSpec[] } {
  return { ...at, specs: defs.map((def) => specOf(at, def)) };
}

// ---- the plan --------------------------------------------------------------------------------------

const BAY: readonly string[] = WATERFRONT_BAY_TAGS;
const CITY: readonly string[] = WATERFRONT_CITY_TAGS;

const sqrt = (v: number) => Math.sqrt(v);

const layouts = new WeakMap<RoadNetwork, Map<number, WaterfrontLayout>>();

/** Plans the waterfront of a network for a seed, once. Pure placement: same input, same layout. */
export function waterfrontLayout(road: RoadNetwork, seed: number): WaterfrontLayout {
  const known = layouts.get(road)?.get(seed);
  if (known) return known;
  const made = planLayout(road, seed);
  let bySeed = layouts.get(road);
  if (!bySeed) layouts.set(road, (bySeed = new Map<number, WaterfrontLayout>()));
  bySeed.set(seed, made);
  return made;
}

function planLayout(road: RoadNetwork, seed: number): WaterfrontLayout {
  const frontages: Frontage[] = [];
  const fronts: WfFront[] = [];
  const blocks: WfBlock[] = [];
  const towers: WfBackTower[] = [];
  const streets: WfStreet[] = [];
  const edges: WfEdge[] = [];

  // Pier numbers run outward from the ferry hall: collect every frontage first.
  const raw: { kind: 'shed' | 'hall'; edge: number; s0: number; s1: number }[] = [];
  for (const e of road.edges) {
    for (const t of e.tags as readonly SideTag[]) {
      if (!onSide(t, 'right')) continue;
      if (t.tag === 'pier-shed' || t.tag === 'ferry-hall')
        raw.push({
          kind: t.tag === 'pier-shed' ? 'shed' : 'hall',
          edge: e.index,
          s0: t.s0,
          s1: Math.min(t.s1, e.length),
        });
    }
  }
  raw.sort((a, b) => a.edge - b.edge || a.s0 - b.s0);
  const hallAt = raw.findIndex((r) => r.kind === 'hall');
  raw.forEach((r, i) => {
    let pier = 0;
    if (r.kind === 'shed') {
      if (hallAt < 0 || i > hallAt) {
        const k = raw.slice(hallAt < 0 ? 0 : hallAt + 1, i).filter((q) => q.kind === 'shed').length;
        pier = ODD_PIERS[k] ?? 41 + 2 * k;
      } else {
        const k = raw.slice(i + 1, hallAt).filter((q) => q.kind === 'shed').length;
        pier = EVEN_PIERS[k] ?? 42 + 2 * k;
      }
    }
    const mid = (r.s0 + r.s1) / 2;
    frontages.push({ ...r, d: road.vergeAt(r.edge, mid, 'right').dOuter, pier });
  });

  for (const e of road.edges) {
    const tags = e.tags as readonly SideTag[];
    if (!tags.some((t) => BAY.includes(t.tag) || CITY.includes(t.tag))) continue;
    const features = e.features.filter((f) => KEEP_CLEAR.has(f.kind));
    const h = (k: number, side: number, salt: number) =>
      scatterHash(seed, 7211 + e.index * 977, k, side * 41 + salt);
    const has = (side: 'left' | 'right', s: number, tag: string) =>
      tags.some((t) => t.tag === tag && onSide(t, side) && s >= t.s0 && s <= t.s1);
    const w = (s: number, d: number, hgt: number) => road.toWorld(e.index, s, d, hgt);
    const faceRoad = (p: P3, s: number) => {
      const c = w(s, 0, 0);
      return atan2(c.x - p.x, c.z - p.z);
    };
    /** Whether nothing kept clear lies over s0..s1 at |d| a0..a1 on a side, with `margin` round it. */
    const clear = (side: -1 | 1, s0: number, s1: number, a0: number, a1: number, margin = FEATURE_CLEAR_M) =>
      !features.some((f) => {
        const lo = Math.min(f.d0 * side, f.d1 * side);
        const hi = Math.max(f.d0 * side, f.d1 * side);
        return (
          Math.min(f.s0, f.s1) - margin < s1 &&
          Math.max(f.s0, f.s1) + margin > s0 &&
          lo - margin < a1 &&
          hi + margin > a0
        );
      });
    /** The runs of s (2 m steps) where `want` holds: [start, end] pairs. */
    const runs = (want: (s: number) => boolean): [number, number][] => {
      const out: [number, number][] = [];
      let start = -1;
      for (let s = 0; s <= e.length + 1e-6; s += 2) {
        const here = want(Math.min(s, e.length));
        if (here && start < 0) start = s;
        if ((!here || s + 2 > e.length + 1e-6) && start >= 0) {
          out.push([start, here ? e.length : s - 2]);
          start = -1;
        }
      }
      return out;
    };
    const vL = (s: number) => road.vergeAt(e.index, s, 'left');
    const outerL = -e.dMin + VERGE_M;
    const bayOpen = (s: number) =>
      has('right', s, 'promenade') && !has('right', s, 'pier-shed') && !has('right', s, 'ferry-hall');
    const hasCity = tags.some((t) => CITY.includes(t.tag));
    edges.push({
      edge: e.index,
      outerL,
      promenade: tags.some((t) => t.tag === 'promenade') ? runs((s) => has('right', s, 'promenade')) : [],
      bay: tags.some((t) => t.tag === 'promenade') ? runs(bayOpen) : [],
      lot: hasCity ? runs((s) => has('left', s, 'wharf-lot')) : [],
    });

    // ---- the bay side: the sheds and the hall on this edge ------------------------------------------
    for (const f of frontages.filter((q) => q.edge === e.index)) {
      const s = (f.s0 + f.s1) / 2;
      const p = w(s, f.d, LAND_TOP_M);
      const width = f.s1 - f.s0;
      const drop = Math.max(0.5, p.y + 0.6);
      const at = {
        rule: f.kind === 'shed' ? 'pier-shed' : 'ferry-hall',
        edge: e.index,
        s,
        d: f.d,
        p,
        turn: faceRoad(p, s),
        size: 1,
      };
      fronts.push({
        ...placed(at, f.kind === 'shed' ? shedSolids(width) : hallSolids(width)),
        kind: f.kind,
        width,
        pier: f.pier,
        drop,
      });
    }

    // ---- the city side ------------------------------------------------------------------------------
    if (!hasCity) continue;
    const front = (s: number) => has('left', s, 'wharf') && vL(s).edge === 'hard';
    const open = (s: number) => has('left', s, 'ferry-plaza') || has('left', s, 'wharf-lot');
    // The front row of blocks along each run of frontage, packed shoulder to shoulder.
    const blockRow = (a: number, b: number, back: number, salt: number) => {
      let cursor = a + 0.5;
      for (let k = 0; ; k++) {
        let kind = BLOCK_MIX[Math.floor(h(k + Math.round(a), -1, salt) * BLOCK_MIX.length)] ?? 'loft';
        const [lo, hi] = BLOCK_WIDTH[kind];
        let width = lo + (hi - lo) * h(k + Math.round(a), -1, salt + 1);
        if (cursor + width > b - 0.5) {
          const narrow = (['crab', 'hotel', 'loft'] as const).find(
            (q) => cursor + BLOCK_WIDTH[q][0] <= b - 0.5,
          );
          if (!narrow) break;
          kind = narrow;
          width = Math.min(BLOCK_WIDTH[kind][1], b - 0.5 - cursor);
        }
        const s = cursor + width / 2;
        cursor += width + 0.3;
        if (!clear(-1, s - width / 2, s + width / 2, back, back + BLOCK_DEPTH_M, 0.3)) continue;
        const d = -back;
        const p = w(s, d, 0);
        // The base sits at the lower front corner, so neither floats on a slope.
        const y = Math.min(p.y, w(s - width / 2, d, 0).y, w(s + width / 2, d, 0).y) + LAND_TOP_M;
        const u = h(k + Math.round(a), -1, salt + 2);
        const at = {
          rule: `block-${kind}`,
          edge: e.index,
          s,
          d,
          p: { x: p.x, y, z: p.z },
          turn: faceRoad(p, s),
          size: 1,
        };
        blocks.push({ ...placed(at, blockSolids(kind, width, u)), kind, width, u });
      }
    };
    // Fronts on the sidewalk's hard edge (the sim's), behind the lot and the plaza further back.
    for (const [a, b] of runs(front)) blockRow(a, b, -vL(Math.min(e.length, a + 1)).dOuter, 10);
    for (const [a, b] of runs(open)) blockRow(a, b, outerL + OPEN_BACK_M, 20);
    // The taller towers behind, away from the side streets.
    for (const [a, b] of runs((s) => has('left', s, 'wharf') || open(s))) {
      for (let k = 0; ; k++) {
        const s = a + (k + 0.5) * BACK_ROW_EVERY_M;
        if (s + 12 > b) break;
        if (h(k + Math.round(a), -1, 30) < 0.3) continue;
        // Clear of a side street and the blocks lining it.
        if (tags.some((t) => t.tag === 'wharf-street' && Math.abs((t.s0 + t.s1) / 2 - s) < 44)) continue;
        const d = -(outerL + BACK_ROW_M + 30 * h(k, -1, 31));
        const p = w(s, d, 0);
        const variant = Math.min(
          BACK_TOWER_U.length - 1,
          Math.floor(h(k + Math.round(a), -1, 32) * BACK_TOWER_U.length),
        );
        const at = {
          rule: 'back-tower',
          edge: e.index,
          s,
          d,
          p: { x: p.x, y: CITY_FLOOR_Y - 0.2, z: p.z },
          turn: faceRoad(p, s),
          size: 0.85 + 0.3 * h(k, -1, 33),
        };
        const u = BACK_TOWER_U[variant] ?? 0.1;
        towers.push({ ...placed(at, backTowerSolids(u)), variant, u });
      }
    }
    // Side streets: the roadway and its sidewalks running inland, buildings lining both sides.
    for (const t of tags.filter((x) => x.tag === 'wharf-street' && onSide(x, 'left'))) {
      const s = (t.s0 + t.s1) / 2;
      const centre = w(s, 0, 0);
      const r1 = w(s, -1, 0);
      const ax = r1.x - centre.x;
      const az = r1.z - centre.z;
      const al = sqrt(ax * ax + az * az) || 1;
      const f = w(Math.min(e.length, s + 1), 0, 0);
      const bk = w(Math.max(0, s - 1), 0, 0);
      const fx = f.x - bk.x;
      const fz = f.z - bk.z;
      const fl = sqrt(fx * fx + fz * fz) || 1;
      const across = { x: ax / al, z: az / al };
      const along = { x: fx / fl, z: fz / fl };
      // At the road's own height at its mouth (over the verge band), then down to the floor.
      const roadY = centre.y;
      const half = (t.s1 - t.s0) / 2;
      streets.push({
        edge: e.index,
        s,
        s0: t.s0,
        s1: t.s1,
        centre: { x: centre.x, y: centre.y, z: centre.z },
        across,
        along,
        roadY,
      });
      const yAt = (u: number) =>
        Math.max(CITY_FLOOR_Y + 0.05, roadY - STREET_DROP * Math.max(0, u - outerL - LAND_STRIP_M));
      const at = (u: number, v: number): P3 => ({
        x: centre.x + across.x * u + along.x * v,
        y: yAt(u),
        z: centre.z + across.z * u + along.z * v,
      });
      for (const vs of [-1, 1] as const) {
        // Behind the corner blocks on the boulevard (their backs at the sidewalk's edge + their depth).
        let cursor = outerL + 3.4 + BLOCK_DEPTH_M + 1;
        for (let k = 0; cursor < outerL + STREET_REACH_M - 30; k++) {
          const kind: BlockKind =
            scatterHash(seed, 9001 + e.index * 131 + Math.round(s), k, vs) < 0.6 ? 'loft' : 'garage';
          const width = BLOCK_WIDTH[kind][0] + 4 * scatterHash(seed, 9011 + e.index, k, vs);
          const u = cursor + width / 2;
          cursor += width + 1;
          const base = at(u, vs * half);
          const toStreet = at(u, 0);
          const hue = scatterHash(seed, 9021 + e.index, k, vs);
          const spot = {
            rule: 'street-block',
            edge: e.index,
            s,
            d: -u,
            p: { x: base.x, y: base.y - 0.05, z: base.z },
            turn: atan2(toStreet.x - base.x, toStreet.z - base.z),
            size: 1,
          };
          blocks.push({ ...placed(spot, blockSolids(kind, width, hue)), kind, width, u: hue });
        }
      }
    }
  }
  return { frontages, fronts, blocks, towers, streets, edges };
}

/** The waterfront's planner: every solid of its layout, for the structure registry (`STRUCTURE_LAYERS`). */
export const waterfrontPlanner: StructurePlanner = {
  plan(road, seed, out) {
    const layout = waterfrontLayout(road, seed);
    for (const f of layout.fronts) for (const spec of f.specs) out.add(spec);
    for (const b of layout.blocks) for (const spec of b.specs) out.add(spec);
    for (const t of layout.towers) for (const spec of t.specs) out.add(spec);
  },
};
