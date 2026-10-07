// The Pacific Northwest's places as solid structures (the maintainer, 2026-10-06, [decided]: "consistent physics
// and gameplay is important here so players know what to expect and how to interact with the world"; the physical
// world, docs/architecture.md "Physical world"). This module is where the places' solids are PLACED: the car
// ferry across its slip (the bulwarks and the posts that hold the passenger deck up, the deck and its cabin over
// the road, the funnel, the wheelhouses), and the Stump Social's false-front shops, its side streets' barricades
// and tents, and the banners over the closed main street. They were render/pnw-places.ts's own rules (run W-U:
// "Ride up the ramp onto a car ferry, weave across the deck, and roll off the far side"; "a closed main street on
// logging-festival day"); they are moved here UNCHANGED (the same seeded hash, the same gaps between the bears,
// the same shop widths and heights), so the places look as they did, and each carries its solids (`specs`: the
// footprint, base and roof of each drawn part) for the sim to meet. Render draws the layout this module returns
// and the structure registry plans the same specs (`pnwPlacesPlanner`), so what is drawn is what is hit.
// scripts/hitboxes.test.ts holds the drawn boxes to the specs.
//
// Not here: the solid hazards (a pickup, a coffee cart, a stair tower, a stump, a log pile, a bear, a barricade:
// road features, which the sim already meets at their boxes), the clear-cut's dressing (stumps, slash, snags and
// earth stand past the ridable dirt, on drawn land: beyond the course, scenery), the hull below the car deck (the
// hull, its aprons and its piles are under the road: reached only by falling), and what hangs overhead (the
// bunting's cords and flags 6.8 m up, awnings 2.8 m up, the ferry's window band and life rings, the name).
//
// What is a solid here (the hitbox audit's rule): a wall, a post, a deck, a roof, a tent, a rail, and a funnel
// or a wheelhouse on the cabin's roof. The passenger deck's underside is `FERRY_ROOF.heightM` over the car deck:
// a rider rides under it (a lintel over the road), and lands on it from above.
//
// Inputs: the network and the seed only (the road files' `tags` and `features`). The side streets' reach inland
// was the drawn land's (`RoadScene.landReach`, which render passed in); it is `LAND_REACH_M` here, the road scene's
// 24 m land strip, which is what the scene draws at every gap of the baked track (render/pnw-places.test.ts holds
// the two together). Pure + - * / and core math, like the rest of road/: ascending iteration, no Math.random. A lazy
// chunk: it loads with the region (`STRUCTURE_LAYERS`, `loadPnwPlacesPlan`), never in the first load.
import { atan2 } from '../../core';
import { FERRY_DIM, ferrySections } from '../ferry';
import type { RoadNetwork } from '../network';
import { modelFoot, type StructureClass, type StructurePlanner, type StructureSpec } from '../structures';
import { scatterHash } from '../themes';
import type { BakedFeature } from '../types';

/** The layer's name in `STRUCTURE_LAYERS`, and the tags that ask for it (the clear-cut's dressing has no solids). */
export const PNW_PLACES_LAYER = 'pnw-places';
export const PNW_PLACES_TAGS = ['ferry', 'festival'] as const;

/** Where the layer's land stands over the road's surface (render/scenery.ts LAND_TOP_M), m. */
export const LAND_TOP_M = -0.09;
/** The road scene's verge strip past the lanes, and its land strip past that on a street's side, m. */
const VERGE_M = 0.6;
export const LAND_REACH_M = 24;
/** A shop's depth back from its front, and the side street's tents' spacing, m. */
export const SHOP_DEPTH_M = 10;

type P3 = { x: number; y: number; z: number };

/** A box in a place's own frame (+Z along the road, +X to the road's left, y up from its base), m. */
interface LocalBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}
/** A box `hx` either side of `cx` across, `hz` either side of `cz` along, from y0 to y1. */
const box = (cx: number, hx: number, y0: number, y1: number, cz: number, hz: number): LocalBox => ({
  x0: cx - hx,
  x1: cx + hx,
  y0,
  y1,
  z0: cz - hz,
  z1: cz + hz,
});

/** One drawn solid of a place. */
export interface PnwSolidDef {
  name: string;
  cls: StructureClass;
  box: LocalBox;
}

/** Where a place stands: the road's position, its world point at its base, and its turn about up. */
interface Spot {
  rule: string;
  edge: number;
  s: number;
  d: number;
  p: P3;
  turn: number;
}

function specOf(at: Spot, def: PnwSolidDef): StructureSpec {
  const foot = modelFoot({ ...def.box, what: at.rule }, { x: at.p.x, z: at.p.z, yaw: at.turn, scale: 1 });
  return {
    rule: def.name === '' ? at.rule : `${at.rule}:${def.name}`,
    cls: def.cls,
    model: null,
    edge: at.edge,
    s: at.s,
    d: at.d,
    foot,
    baseY: at.p.y + def.box.y0,
    roof: { kind: 'flat', topM: def.box.y1 - def.box.y0 },
  };
}

/** The turn that points a place's +Z along the road at s (render/pnw-places.ts `spotAt`: the road's heading, d = 0). */
export function roadHeading(road: RoadNetwork, edge: number, s: number): number {
  const len = road.edges[edge]?.length ?? 0;
  const a = road.toWorld(edge, Math.max(0, s - 1), 0, 0);
  const b = road.toWorld(edge, Math.min(len, s + 1), 0, 0);
  return atan2(b.x - a.x, b.z - a.z);
}

function spotAt(road: RoadNetwork, rule: string, edge: number, s: number, d: number, h: number): Spot {
  const p = road.toWorld(edge, s, d, h);
  return { rule, edge, s, d, p: { x: p.x, y: p.y, z: p.z }, turn: roadHeading(road, edge, s) };
}

// ---- the solids ------------------------------------------------------------------------------------

/** One hull section's solids (its length, and whether it carries the passenger deck). */
export function ferryHullSolids(len: number, cabin: boolean): PnwSolidDef[] {
  const D = FERRY_DIM;
  const out: PnwSolidDef[] = [];
  for (const side of [-1, 1] as const) {
    // The car deck's walls (in d: side * (wallD + wallW / 2); the model's x is -d), and the hull's ledge past them.
    const wd = side * (D.wallD + D.wallW / 2);
    out.push({ name: 'bulwark', cls: 'wall', box: box(-wd, D.wallW / 2, 0, D.bulwarkH, 0, len / 2) });
    out.push({
      name: 'ledge',
      cls: 'wall',
      box: box(
        -(side * (D.hullHalfW + D.wallD + D.wallW)) / 2,
        (D.hullHalfW - D.wallD - D.wallW) / 2,
        -0.35,
        -0.15,
        0,
        len / 2,
      ),
    });
    if (cabin)
      // The posts that hold the passenger deck up, from the bulwark's top to its underside.
      for (const at of [-len / 2 + 0.3, 0])
        out.push({ name: 'post', cls: 'wall', box: box(-wd, 0.25, D.bulwarkH, D.ceilingY, at, 0.25) });
  }
  if (cabin) {
    // The passenger deck over the road: its floor slab, the cabin, and the roof plate on it.
    out.push({
      name: 'deck',
      cls: 'building',
      box: box(0, D.hullHalfW, D.ceilingY, D.ceilingY + 0.4, 0, len / 2),
    });
    out.push({
      name: 'cabin',
      cls: 'building',
      box: box(0, D.hullHalfW - 1, D.ceilingY + 0.4, D.cabinTopY, 0, len / 2),
    });
    out.push({
      name: 'roof',
      cls: 'building',
      box: box(0, D.hullHalfW - 0.6, D.cabinTopY, D.cabinTopY + 0.3, 0, len / 2),
    });
  }
  return out;
}

/** The funnel and its cap, on the cabin's roof. */
export function ferryFunnelSolids(): PnwSolidDef[] {
  const y = FERRY_DIM.cabinTopY + 0.3;
  return [
    { name: '', cls: 'building', box: box(0, 1.6, y, y + 5, 0, 1.6) },
    { name: 'cap', cls: 'building', box: box(0, 1.65, y + 5, y + 5.8, 0, 1.65) },
  ];
}

/** A wheelhouse on the cabin's roof, and its roof plate. */
export function ferryWheelhouseSolids(): PnwSolidDef[] {
  const y = FERRY_DIM.cabinTopY + 0.3;
  return [
    { name: '', cls: 'building', box: box(0, 4.5, y, y + 2.6, 0, 2) },
    { name: 'roof', cls: 'building', box: box(0, 5, y + 2.6 - 0.025, y + 2.6 + 0.225, 0, 2.3) },
  ];
}

/** A false-front shop's solids: its body, and its false front standing the full height. `side` is the road side. */
export function shopSolids(width: number, height: number, side: 1 | -1): PnwSolidDef[] {
  return [
    // x is -d: the body runs back from the front (x 0) away from the road, the false front is its first 0.3 m.
    {
      name: '',
      cls: 'building',
      box: box(-side * (SHOP_DEPTH_M / 2), SHOP_DEPTH_M / 2, 0, height * 0.8, 0, width / 2),
    },
    { name: 'front', cls: 'wall', box: box(-side * 0.15, 0.15, 0, height, 0, width / 2) },
  ];
}

/** A side street's mouth: its barricade (a rail across, a post at each end) and the two tents down it. */
export function sideStreetSolids(width: number, side: 1 | -1, run: number): PnwSolidDef[] {
  const out: PnwSolidDef[] = [
    { name: 'barricade', cls: 'wall', box: box(-side * 0.3, 0.03, 0.8, 1, 0, width / 2) },
  ];
  for (const sd of [-1, 1] as const)
    out.push({
      name: 'barricade-post',
      cls: 'wall',
      box: box(-side * 0.3, 0.05, 0, 1, sd * (width / 2 - 0.3), 0.05),
    });
  for (const [k, at] of [10, 20].entries()) {
    if (at + 2 > run) break;
    const sAt = (k % 2 ? 1 : -1) * (width / 2 - 2);
    out.push({ name: 'tent', cls: 'building', box: box(-side * at, 1.5, 0, 2.2, sAt, 1.5) });
    out.push({ name: 'tent-roof', cls: 'building', box: box(-side * at, 1.7, 2.2, 2.7, sAt, 1.7) });
  }
  return out;
}

/** A banner over the street (half its width `half`): the board across it, and a post at each end. */
export function bannerSolids(half: number): PnwSolidDef[] {
  const y = 5.4;
  return [
    { name: '', cls: 'building', box: box(0, half, y - 0.2, y + 1.4, 0, 0.05) },
    { name: 'post', cls: 'wall', box: box(half, 0.075, 0, y + 1.5, 0, 0.075) },
    { name: 'post', cls: 'wall', box: box(-half, 0.075, 0, y + 1.5, 0, 0.075) },
  ];
}

// ---- the layout ------------------------------------------------------------------------------------

/** A ferry part as placed: a hull section, an end apron, the funnel, a wheelhouse or the name. */
export interface PnwFerryPart {
  kind: 'ferry-hull' | 'ferry-end' | 'ferry-funnel' | 'ferry-wheelhouse' | 'ferry-name';
  edge: number;
  s: number;
  /** A hull section's length, whether it carries the passenger deck, whether it has a life ring; an apron's end. */
  len: number;
  cabin: boolean;
  ring: boolean;
  /** The apron's end: -1 at the stretch's start, +1 at its end. */
  end: -1 | 1;
  /** The hull section's index. */
  i: number;
  specs: readonly StructureSpec[];
}
export interface PnwShop {
  edge: number;
  /** The shop's middle along the road, and its front's d (the sidewalk's edge). */
  s: number;
  d: number;
  width: number;
  height: number;
  /** Its index along the street (picks its paint and awning), and its side of the road. */
  k: number;
  side: 1 | -1;
  specs: readonly StructureSpec[];
}
export interface PnwSideStreet {
  edge: number;
  /** The gap's middle along the road, and the sidewalk's edge. */
  s: number;
  d: number;
  /** The gap's width (g1 - g0), its index among the side's gaps, its side, and how far it runs inland, m. */
  width: number;
  k: number;
  side: 1 | -1;
  run: number;
  specs: readonly StructureSpec[];
}
/** A string of bunting across the street (cords and flags, overhead: not solid). */
export interface PnwBunting {
  edge: number;
  s: number;
  i: number;
  d0: number;
  d1: number;
}
export interface PnwBanner {
  edge: number;
  s: number;
  half: number;
  specs: readonly StructureSpec[];
}

export interface PnwPlacesLayout {
  ferry: readonly PnwFerryPart[];
  shops: readonly PnwShop[];
  streets: readonly PnwSideStreet[];
  bunting: readonly PnwBunting[];
  banners: readonly PnwBanner[];
}

const objectOf = (f: BakedFeature) => (typeof f.params?.['object'] === 'string' ? f.params['object'] : '');

const layouts = new WeakMap<RoadNetwork, Map<number, PnwPlacesLayout>>();

/** Plans the places of a network for a seed, once. Pure placement: same input, same layout. */
export function pnwPlacesLayout(road: RoadNetwork, seed: number): PnwPlacesLayout {
  const known = layouts.get(road)?.get(seed);
  if (known) return known;
  const made = planLayout(road, seed);
  let bySeed = layouts.get(road);
  if (!bySeed) layouts.set(road, (bySeed = new Map<number, PnwPlacesLayout>()));
  bySeed.set(seed, made);
  return made;
}

function planLayout(road: RoadNetwork, seed: number): PnwPlacesLayout {
  const ferry: PnwFerryPart[] = [];
  const shops: PnwShop[] = [];
  const streets: PnwSideStreet[] = [];
  const bunting: PnwBunting[] = [];
  const banners: PnwBanner[] = [];
  const made = (spot: Spot, defs: readonly PnwSolidDef[]) => defs.map((def) => specOf(spot, def));

  for (const e of road.edges) {
    // The ferry.
    for (const t of e.tags) {
      if (t.tag !== 'ferry') continue;
      const { n, len, cabin: hasDeck } = ferrySections(t.s0, t.s1);
      for (let i = 0; i < n; i++) {
        const s = t.s0 + (i + 0.5) * len;
        const cabin = hasDeck(i);
        const spot = spotAt(road, 'ferry-hull', e.index, s, 0, 0);
        ferry.push({
          kind: 'ferry-hull',
          edge: e.index,
          s,
          len,
          cabin,
          ring: i % 2 === 0,
          end: 1,
          i,
          specs: made(spot, ferryHullSolids(len, cabin)),
        });
      }
      for (const [s, end] of [
        [t.s0, -1],
        [t.s1, 1],
      ] as const)
        ferry.push({
          kind: 'ferry-end',
          edge: e.index,
          s,
          len: 0,
          cabin: false,
          ring: false,
          end,
          i: 0,
          specs: [],
        });
      const middle = (t.s0 + t.s1) / 2;
      ferry.push({
        kind: 'ferry-funnel',
        edge: e.index,
        s: middle,
        len: 0,
        cabin: false,
        ring: false,
        end: 1,
        i: 0,
        specs: made(spotAt(road, 'ferry-funnel', e.index, middle, 0, 0), ferryFunnelSolids()),
      });
      for (const at of [t.s0 + FERRY_DIM.cabinInsetM + 4, t.s1 - FERRY_DIM.cabinInsetM - 4])
        ferry.push({
          kind: 'ferry-wheelhouse',
          edge: e.index,
          s: at,
          len: 0,
          cabin: false,
          ring: false,
          end: 1,
          i: 0,
          specs: made(spotAt(road, 'ferry-wheelhouse', e.index, at, 0, 0), ferryWheelhouseSolids()),
        });
      ferry.push({
        kind: 'ferry-name',
        edge: e.index,
        s: middle,
        len: 0,
        cabin: false,
        ring: false,
        end: 1,
        i: 0,
        specs: [],
      });
    }

    // The Stump Social.
    for (const t of e.tags) {
      if (t.tag !== 'festival') continue;
      const bears = e.features
        .filter((f) => f.kind === 'hazard' && objectOf(f) === 'bear' && f.s0 >= t.s0 && f.s1 <= t.s1)
        .sort((a, b) => a.s0 - b.s0);
      for (const side of [-1, 1] as const) {
        const own = bears.filter((b) => Math.sign(b.d0 + b.d1) === side);
        // A side street is the gap between two bears 8 to 20 m apart.
        const gaps: [number, number][] = [];
        for (let i = 0; i + 1 < own.length; i++) {
          const a = own[i];
          const b = own[i + 1];
          if (a && b && b.s0 - a.s1 >= 8 && b.s0 - a.s1 <= 20) gaps.push([a.s1, b.s0]);
        }
        const v = road.vergeAt(e.index, (t.s0 + t.s1) / 2, side < 0 ? 'left' : 'right');
        const front = side * Math.abs(v.dOuter);
        const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
        for (const [k, [g0, g1]] of gaps.entries()) {
          const c = (g0 + g1) / 2;
          const reach = outer + LAND_REACH_M;
          const run = Math.max(6, Math.min(40, Math.floor(reach - Math.abs(front) - 1)));
          const spot = spotAt(road, 'side-street', e.index, c, front, LAND_TOP_M + 0.02);
          streets.push({
            edge: e.index,
            s: c,
            d: front,
            width: g1 - g0,
            k,
            side,
            run,
            specs: made(spot, sideStreetSolids(g1 - g0, side, run)),
          });
        }
        // Shops between the gaps.
        let s = t.s0 + 1;
        let k = 0;
        while (s < t.s1 - 4) {
          const gap = gaps.find(([g0, g1]) => s < g1 + 0.5 && s + 4 > g0 - 0.5);
          if (gap) {
            s = gap[1] + 0.5;
            continue;
          }
          const next = gaps.find(([g0]) => g0 > s)?.[0] ?? t.s1 - 1;
          const want = 9 + Math.round(scatterHash(seed, e.index, s, 21 + side) * 6);
          const width = Math.min(want, next - 0.5 - s);
          if (width < 4) {
            s = next + 0.5;
            continue;
          }
          const height = 6.5 + Math.round(scatterHash(seed, e.index, s, 23) * 5) * 0.6;
          const mid = s + width / 2;
          const spot = spotAt(road, 'shop', e.index, mid, front, LAND_TOP_M);
          shops.push({
            edge: e.index,
            s: mid,
            d: front,
            width,
            height,
            k,
            side,
            specs: made(spot, shopSolids(width, height, side)),
          });
          s += width + 0.3;
          k++;
        }
      }
      // Bunting across the street, and the banner at each end of the closure.
      const vR = road.vergeAt(e.index, (t.s0 + t.s1) / 2, 'right');
      const vL = road.vergeAt(e.index, (t.s0 + t.s1) / 2, 'left');
      for (let s = t.s0 + 24, i = 0; s < t.s1 - 16; s += 32, i++)
        bunting.push({ edge: e.index, s, i, d0: vL.dOuter, d1: vR.dOuter });
      const half = Math.min(Math.abs(vL.dOuter), Math.abs(vR.dOuter)) - 0.3;
      for (const s of [t.s0 + 10, t.s1 - 10])
        banners.push({
          edge: e.index,
          s,
          half,
          specs: made(spotAt(road, 'banner', e.index, s, 0, 0), bannerSolids(half)),
        });
    }
  }
  return { ferry, shops, streets, bunting, banners };
}

/** The places' planner: every solid of its layout, for the structure registry (`STRUCTURE_LAYERS`). */
export const pnwPlacesPlanner: StructurePlanner = {
  plan(road, seed, out) {
    const layout = pnwPlacesLayout(road, seed);
    for (const f of layout.ferry) for (const spec of f.specs) out.add(spec);
    for (const x of layout.shops) for (const spec of x.specs) out.add(spec);
    for (const x of layout.streets) for (const spec of x.specs) out.add(spec);
    for (const x of layout.banners) for (const spec of x.specs) out.add(spec);
  },
};
