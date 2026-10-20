// World-rooted rural trunks. The upright bike capsule is the existing rider-contact model;
// foliage and branch tips are forgiving. Vertical clipping and a convex sweep protect thin
// trunks even when both endpoints of a fast tick are clear.
import { cos, sin } from '../../core';
import type { FurnitureShape, RoadPos } from '../../road';
import { planTerrainTrees, trunkRadiusAt, type TerrainTree } from '../../road/structures/terrain-trees';
import type { SimConfig } from '../types';
import { systemState, type World } from '../world';
import { RIDER_BODY_HEIGHT_M } from './contact';
import { BIKE_RADIUS_M, BIKE_SPINE_HALF_M, type FurnitureHit } from './furniture';

interface TreePiece {
  tree: TerrainTree;
  shape: FurnitureShape;
}
export interface TrunkHit extends FurnitureHit<TreePiece> {
  cap: boolean;
}
export interface TreeMove {
  s0: number;
  d0: number;
  s1: number;
  d1: number;
}

/** First trunk touched in the rider's local metric frame, including the body's absolute height. */
export function trunkTouch(
  config: SimConfig,
  pos: RoadPos,
  yaw: number,
  move: TreeMove,
  feet0: number,
  feet1: number,
): TrunkHit | null {
  const plan = planTerrainTrees(config.road, config.seed);
  if (!plan.items.length) return null;
  const p = config.road.toWorld(pos.edge, pos.s, pos.d, 0);
  const f = config.road.frameAt(pos.edge, pos.s);
  const ds = move.s1 - move.s0;
  const dd = move.d1 - move.d0;
  const travel = Math.sqrt(ds * ds + dd * dd);
  const hs = pos.dir * cos(yaw);
  const hd = pos.dir * sin(yaw);
  let best: TrunkHit | null = null;
  for (const tree of plan.near(p.x, p.z, travel + BIKE_SPINE_HALF_M + BIKE_RADIUS_M)) {
    const rx = tree.x - p.x;
    const rz = tree.z - p.z;
    const s = pos.s + rx * f.tx + rz * f.tz;
    const d = pos.d - rx * f.tz + rz * f.tx;
    const dy = feet1 - feet0;
    let lo = 0;
    let hi = 1;
    // Open vertical span: feet below top and head above base. The time interval is linear.
    if (dy === 0) {
      if (feet0 >= tree.topY || feet0 + RIDER_BODY_HEIGHT_M <= tree.baseY) continue;
    } else {
      const a = (tree.baseY - RIDER_BODY_HEIGHT_M - feet0) / dy;
      const b = (tree.topY - feet0) / dy;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
      if (hi <= lo) continue;
    }
    const gap = (t: number) => {
      const cs = move.s0 + ds * t;
      const cd = move.d0 + dd * t;
      const along = Math.max(-BIKE_SPINE_HALF_M, Math.min(BIKE_SPINE_HALF_M, (s - cs) * hs + (d - cd) * hd));
      const ns = cs + hs * along - s;
      const nd = cd + hd * along - d;
      const len = Math.sqrt(ns * ns + nd * nd);
      const r = trunkRadiusAt(tree, Math.max(tree.baseY, feet0 + dy * t));
      return {
        dist: len - r - BIKE_RADIUS_M,
        ns: len > 1e-9 ? ns / len : -hs,
        nd: len > 1e-9 ? nd / len : -hd,
        r,
      };
    };
    const start = gap(lo);
    let at = lo;
    if (start.dist >= 0) {
      // Distance to a translated segment minus a linearly tapered radius is convex
      // within this clipped height interval. Find its minimum before bisecting entry.
      let a = lo;
      let b = hi;
      const g = 0.6180339887498949;
      let c = b - g * (b - a);
      let d0 = a + g * (b - a);
      let gc = gap(c).dist;
      let gd = gap(d0).dist;
      for (let i = 0; i < 28; i++) {
        if (gc < gd) {
          b = d0;
          d0 = c;
          gd = gc;
          c = b - g * (b - a);
          gc = gap(c).dist;
        } else {
          a = c;
          c = d0;
          gc = gd;
          d0 = a + g * (b - a);
          gd = gap(d0).dist;
        }
      }
      const mid = (a + b) / 2;
      let inside = gap(hi).dist < gap(mid).dist ? hi : mid;
      if (gap(inside).dist >= 0) continue;
      let outside = lo;
      for (let i = 0; i < 20; i++) {
        const t = (outside + inside) / 2;
        if (gap(t).dist < 0) inside = t;
        else outside = t;
      }
      at = outside;
    }
    if (best && at >= best.t) continue;
    const hit = gap(at);
    const shape: FurnitureShape = {
      s,
      d,
      r: hit.r,
      hu: 0,
      hv: 0,
      us: 1,
      ud: 0,
      reachS: hit.r,
      reachD: hit.r,
    };
    best = {
      piece: { tree, shape },
      t: at,
      ns: hit.ns,
      nd: hit.nd,
      held: at === 0 && start.dist < 0 && feet0 < tree.topY && feet0 + RIDER_BODY_HEIGHT_M > tree.baseY,
      cap: at === lo && start.dist < 0 && (feet0 >= tree.topY || feet0 + RIDER_BODY_HEIGHT_M <= tree.baseY),
    };
  }
  return best;
}

interface TreeTouches {
  touch: number[];
}
const KEY = 'terrainTrees';
/** State is absent until a contact; deterministic hashing/replay includes it with other systems. */
export function noteTreeTouch(world: World, rider: number, tree: number): boolean {
  const prev = (world.systems[KEY] as TreeTouches | undefined)?.touch[rider] ?? 0;
  if (tree !== prev) systemState<TreeTouches>(world, KEY, () => ({ touch: [] })).touch[rider] = tree;
  return tree !== prev;
}
