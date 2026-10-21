// The four solid or brushable pieces on San Francisco's natural grass. One seeded plan supplies
// both the road's contact plan and the rendered spots; a visual-density setting cannot hide a
// contact. Their feet stay on the legacy drawn land strip, including around folds and rail gaps.
import { atan2 } from '../core';
import { landEdgeOf, landReachOf, sectionGroundOf } from './drawn-ground';
import { lanesUnderOf } from './lanes-under';
import type { RoadNetwork } from './network';
import { scatterHash, themeAt } from './themes';

export type SfSceneryKind = 'battery' | 'brush' | 'outcrop' | 'coastTree';

export interface SfSceneryPlace {
  kind: SfSceneryKind;
  edge: number;
  s: number;
  d: number;
  turn: number;
  size: number;
  variant: number;
  p: { x: number; y: number; z: number };
}

const RULES = [
  {
    kind: 'coastTree',
    index: 13,
    theme: 'presidio',
    spacing: 13,
    rate: 0.85,
    near: 5.5,
    spread: 13,
    radius: 2.4,
    along: 2.4,
    depth: 2.4,
  },
  {
    kind: 'battery',
    index: 15,
    theme: 'headlands',
    spacing: 140,
    rate: 0.5,
    near: 8,
    spread: 6,
    radius: 9,
    along: 22.8,
    depth: 9.3,
  },
  {
    kind: 'brush',
    index: 16,
    theme: 'headlands',
    spacing: 22,
    rate: 0.55,
    near: 3.5,
    spread: 14,
    radius: 1.2,
    along: 1.2,
    depth: 1.2,
  },
  {
    kind: 'outcrop',
    index: 17,
    theme: 'headlands',
    spacing: 24,
    rate: 0.8,
    near: 4,
    spread: 12,
    radius: 3.6,
    along: 3.6,
    depth: 3.6,
  },
] as const;

const variants: Record<SfSceneryKind, number> = { coastTree: 2, battery: 0, brush: 1, outcrop: 2 };
const kept = new WeakMap<RoadNetwork, Map<number, readonly SfSceneryPlace[]>>();

/** The centre of the water this network crosses, as the headlands view uses it. */
function waterCentre(road: RoadNetwork): { x: number; z: number } | null {
  let x = 0,
    z = 0,
    n = 0;
  for (const e of road.edges)
    for (const tag of e.tags) {
      if (!tag.tag.startsWith('water')) continue;
      for (let s = Math.max(0, tag.s0); s <= Math.min(e.length, tag.s1); s += 25) {
        const p = road.toWorld(e.index, s, 0, 0);
        x += p.x;
        z += p.z;
        n++;
      }
    }
  return n > 0 ? { x: x / n, z: z / n } : null;
}

function facesWater(
  road: RoadNetwork,
  edge: number,
  side: -1 | 1,
  s: number,
  centre: { x: number; z: number } | null,
): boolean {
  if (!centre) return false;
  const f = road.frameAt(edge, s);
  const qx = centre.x - f.x,
    qz = centre.z - f.z;
  const far = Math.sqrt(qx * qx + qz * qz);
  if (far < 1) return false;
  return ((side > 0 ? -f.tz : f.tz) * qx + (side > 0 ? f.tx : -f.tx) * qz) / far > 0.4;
}

/** SF natural props, placed once per network and race seed. */
export function planSfScenery(road: RoadNetwork, seed: number): readonly SfSceneryPlace[] {
  let bySeed = kept.get(road);
  if (!bySeed) kept.set(road, (bySeed = new Map<number, readonly SfSceneryPlace[]>()));
  const cached = bySeed.get(seed);
  if (cached) return cached;
  const out: SfSceneryPlace[] = [];
  if (road.terrain) {
    bySeed.set(seed, out);
    return out;
  }
  const landReach = landReachOf(road);
  const landEdge = landEdgeOf(road);
  const ground = sectionGroundOf(road);
  const water = waterCentre(road);
  const lanes = lanesUnderOf(road);
  for (const e of road.edges) {
    if (e.isTrafficOnly) continue;
    for (const side of [-1, 1] as const) {
      const name = side < 0 ? 'left' : 'right';
      const outer = side < 0 ? -e.dMin + 0.6 : e.dMax + 0.6;
      for (const rule of RULES) {
        for (let k = 0; ; k++) {
          const h = (salt: number) => scatterHash(seed, e.index * 977 + rule.index * 31 + salt, k, side + 3);
          const s = (k + 0.15 + 0.7 * h(0)) * rule.spacing;
          if (s > e.length) break;
          if (themeAt(e.tags, name, s) !== rule.theme || h(1) >= rule.rate) continue;
          if (rule.kind === 'battery' && !facesWater(road, e.index, side, s, water)) continue;
          if (rule.kind === 'outcrop' && (e.nextLinks.length > 0 || s < e.length - 450)) continue;
          if (
            e.barriers.some((b) => (b.side === 'both' || b.side === name) && s >= b.s0 - 5 && s <= b.s1 + 5)
          )
            continue;
          const across = rule.near + rule.spread * h(2);
          const d = side * (outer + across);
          const reach = Math.min(
            landReach(e.index, side, s),
            landReach(e.index, side, s - rule.along),
            landReach(e.index, side, s + rule.along),
            landEdge(e.index, side, s),
            landEdge(e.index, side, s - rule.along),
            landEdge(e.index, side, s + rule.along),
          );
          if (s < rule.along || s + rule.along > e.length || across + rule.depth > reach) continue;
          if (
            [s - rule.along, s, s + rule.along].some(
              (u) => ground(e.index, u, side * (outer + across + rule.depth)) === null,
            )
          )
            continue;
          const p = road.toWorld(e.index, s, d, 0);
          if (lanes.at(p.x, p.y, p.z, rule.radius, (edge) => edge === e.index)) continue;
          if (
            e.features.some(
              (f) =>
                s >= Math.min(f.s0, f.s1) - rule.radius &&
                s <= Math.max(f.s0, f.s1) + rule.radius &&
                d >= Math.min(f.d0, f.d1) - rule.radius &&
                d <= Math.max(f.d0, f.d1) + rule.radius,
            )
          )
            continue;
          const size =
            rule.kind === 'battery'
              ? 1.5
              : rule.kind === 'coastTree'
                ? 0.8 + 0.4 * h(6)
                : rule.kind === 'brush'
                  ? 0.8 + 0.6 * h(6)
                  : 0.8 + 0.45 * h(6);
          const turn =
            rule.kind === 'battery'
              ? atan2(road.toWorld(e.index, s, 0, 0).x - p.x, road.toWorld(e.index, s, 0, 0).z - p.z)
              : h(3) * Math.PI * 2;
          const variant = rule.kind === 'coastTree' ? Math.floor(h(5) * 2) % 2 : variants[rule.kind];
          let y = -0.09;
          if (rule.kind === 'battery') {
            const low = Math.min(
              p.y,
              road.toWorld(e.index, s + rule.along, d, 0).y,
              road.toWorld(e.index, s - rule.along, d, 0).y,
            );
            y -= p.y - low + 0.15;
          }
          out.push({
            kind: rule.kind,
            edge: e.index,
            s,
            d,
            turn,
            size,
            variant,
            p: road.toWorld(e.index, s, d, y),
          });
        }
      }
    }
  }
  bySeed.set(seed, out);
  return out;
}
