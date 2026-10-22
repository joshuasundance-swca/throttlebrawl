import type { RoadNetwork } from '../network';
import { lanesUnderOf, LANES_UNDER_Y_M } from '../lanes-under';
import { terrainAt } from '../terrain';
import { scatterHash, themeAt } from '../themes';
import { cos, sin, TAU } from '../../core';
import { iowaParkLayout, IOWA_PARK_TAG } from './iowa-park';
/** Verified against real rendered trunk rays; kept lazy with the physics planner. */
export const RURAL_TRUNK = Object.freeze({ baseRadiusM: 0.38, topRadiusM: 0.22, heightM: 6 });
/** Conservative silhouette bounds, used to keep foliage clear of road/shoulder space. */
const CROWN_RADIUS_M = 4.8;
const CROWN_TOP_M = 11.2;
const RECOVERY_M = 8;
const SPACING_M = 75;
const CELL_M = 16;

/** One geometry per network: partial/mixed districts retain their ordinary rural cohort. */
export function isParkTreeNetwork(road: RoadNetwork): boolean {
  return (
    !!road.terrain?.patches.some((p) => p.surface !== 'water') &&
    road.edges.length > 0 &&
    road.edges.every((edge) =>
      [IOWA_PARK_TAG, 'rural'].every((tag) =>
        (['left', 'right'] as const).every((side) =>
          edge.tags.some(
            (t) =>
              t.tag === tag && (t.side === 'both' || t.side === side) && t.s0 <= 0 && t.s1 >= edge.length,
          ),
        ),
      ),
    )
  );
}

type Point = { x: number; z: number };
function segmentDistanceSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq)) : 0;
  const nearX = p.x - a.x - t * dx;
  const nearZ = p.z - a.z - t * dz;
  return nearX * nearX + nearZ * nearZ;
}
/** Full canopy clearance from the triangular, road-facing opening, including its boundary. */
function clearsOpening(p: Point, radius: number, a: Point, b: Point, c: Point): boolean {
  const cross = (u: Point, v: Point) => (v.x - u.x) * (p.z - u.z) - (v.z - u.z) * (p.x - u.x);
  const ab = cross(a, b),
    bc = cross(b, c),
    ca = cross(c, a);
  if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) return false;
  return (
    Math.min(segmentDistanceSq(p, a, b), segmentDistanceSq(p, b, c), segmentDistanceSq(p, c, a)) >=
    radius * radius
  );
}

/** One shared world-space broadleaf placement; central trunk only is solid. */
export interface TerrainTree {
  readonly id: number;
  /** Placement provenance only; physical discovery is in world space. */
  readonly edge: number;
  readonly s: number;
  readonly d: number;
  readonly x: number;
  readonly z: number;
  readonly baseY: number;
  readonly topY: number;
  readonly scale: number;
  readonly turn: number;
}

export interface TerrainTreePlan {
  readonly items: readonly TerrainTree[];
  /** Possible trunk contacts; consumers can reuse their own output storage. */
  near(x: number, z: number, radius: number, out?: TerrainTree[]): readonly TerrainTree[];
}

/** Trunk radius at a world height, including the visible taper. */
export function trunkRadiusAt(tree: TerrainTree, y: number): number {
  const t = Math.max(0, Math.min(1, (y - tree.baseY) / (tree.topY - tree.baseY)));
  return tree.scale * (RURAL_TRUNK.baseRadiusM + t * (RURAL_TRUNK.topRadiusM - RURAL_TRUNK.baseRadiusM));
}

const plans = new WeakMap<RoadNetwork, { seed: number; plan: TerrainTreePlan }>();

/** Shared deterministic placements. Keep only the latest seed per live network. */
export function planTerrainTrees(road: RoadNetwork, seed: number): TerrainTreePlan {
  const cached = plans.get(road);
  if (cached?.seed === seed) return cached.plan;
  const items: TerrainTree[] = [];
  const cells = new Map<string, TerrainTree[]>();
  let maxRadius = 0;
  const near: TerrainTreePlan['near'] = (x, z, radius, out = []) => {
    out.length = 0;
    const reach = Math.max(0, radius) + maxRadius;
    for (let i = Math.floor((x - reach) / CELL_M); i <= Math.floor((x + reach) / CELL_M); i++) {
      for (let j = Math.floor((z - reach) / CELL_M); j <= Math.floor((z + reach) / CELL_M); j++) {
        for (const tree of cells.get(`${i},${j}`) ?? []) {
          const r = Math.max(0, radius) + tree.scale * RURAL_TRUNK.baseRadiusM;
          const dx = tree.x - x;
          const dz = tree.z - z;
          if (dx * dx + dz * dz <= r * r) out.push(tree);
        }
      }
    }
    return out.sort((a, b) => a.id - b.id);
  };
  if (road.terrain) {
    const terrain = road.terrain;
    const lanes = lanesUnderOf(road);
    const park = isParkTreeNetwork(road);
    // Facilities are authoritative: one-way reservation keeps their seed/layout independent of trees.
    const clearings = park
      ? iowaParkLayout(road, seed).facilities.map((facility) => ({
          facility,
          before: road.toWorld(facility.edge, Math.max(0, facility.s - 35), 0, 0),
          after: road.toWorld(
            facility.edge,
            Math.min(road.edges[facility.edge]!.length, facility.s + 35),
            0,
            0,
          ),
        }))
      : [];
    const spacing = park ? 60 : SPACING_M;
    const occupied: TerrainTree[] = [];
    for (const edge of road.edges) {
      for (const side of [-1, 1] as const) {
        const hash = (k: number, salt: number) => scatterHash(seed, edge.index * 977 + side, k, salt);
        for (let k = 0; k * spacing < edge.length; k++) {
          const station = (k + 0.2 + hash(k, 1) * 0.6) * spacing;
          if (hash(k, 2) > 0.7) continue;
          const count = 2 + Math.floor(hash(k, 3) * 3);
          for (let n = 0; n < count; n++) {
            const s = station + (hash(k, 10 + n * 5) - 0.5) * (park ? 22 : 9);
            if (s < 0 || s > edge.length || themeAt(edge.tags, side < 0 ? 'left' : 'right', s) !== 'rural')
              continue;
            const outer = side < 0 ? -edge.dMin : edge.dMax;
            const d = side * (outer + 14 + hash(k, 11 + n * 5) * 14);
            const p = road.toWorld(edge.index, s, d, 0);
            const scale = 0.8 + hash(k, 12 + n * 5) * 0.3;
            const radius = RURAL_TRUNK.baseRadiusM * scale;
            const crownRadius = CROWN_RADIUS_M * scale;
            if (
              clearings.some(({ facility, before, after }) => {
                const dx = p.x - facility.x,
                  dz = p.z - facility.z;
                const reach = facility.radiusM + crownRadius;
                return (
                  dx * dx + dz * dz < reach * reach || !clearsOpening(p, crownRadius, facility, before, after)
                );
              })
            )
              continue;
            let low = Infinity;
            let high = -Infinity;
            let supported = true;
            // A bounded footprint sample, not a claim of exact polygon coverage.
            for (let i = -1; i < 8; i++) {
              const x = p.x + (i < 0 ? 0 : cos((i * TAU) / 8) * radius);
              const z = p.z + (i < 0 ? 0 : sin((i * TAU) / 8) * radius);
              const ground = terrainAt(terrain, x, z);
              if (!ground || ground.surface === 'water') {
                supported = false;
                break;
              }
              low = Math.min(low, ground.y);
              high = Math.max(high, ground.y);
            }
            if (!supported || high - low > 0.6 * scale) continue;
            // Test the full vertical silhouette against all nearby lane/shoulder bands.
            const crownTop = low + CROWN_TOP_M * scale;
            let clear = true;
            const steps = Math.ceil((crownTop - low) / LANES_UNDER_Y_M);
            for (let i = 0; i <= steps; i++) {
              if (
                lanes.at(p.x, low + ((crownTop - low) * i) / steps, p.z, CROWN_RADIUS_M * scale + RECOVERY_M)
              ) {
                clear = false;
                break;
              }
            }
            if (!clear || near(p.x, p.z, radius + 0.5, occupied).length) continue;
            const tree: TerrainTree = Object.freeze({
              id: items.length,
              edge: edge.index,
              s,
              d,
              x: p.x,
              z: p.z,
              baseY: low,
              topY: low + RURAL_TRUNK.heightM * scale,
              scale,
              turn: hash(k, 13 + n * 5) * TAU,
            });
            items.push(tree);
            maxRadius = Math.max(maxRadius, radius);
            const key = `${Math.floor(p.x / CELL_M)},${Math.floor(p.z / CELL_M)}`;
            const list = cells.get(key);
            if (list) list.push(tree);
            else cells.set(key, [tree]);
          }
        }
      }
    }
  }
  const plan = Object.freeze({ items: Object.freeze(items), near });
  plans.set(road, { seed, plan });
  return plan;
}
