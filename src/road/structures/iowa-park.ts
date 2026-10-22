// Original park facilities, not mapped landmarks. The layout owns both the drawn boxes and every
// solid/support: the ordinary recovery strip stays open, and riding onto a facility meets it.
// Authored terrain is unchanged. A short foundation follows the ground below a level floor.
import { atan2 } from '../../core';
import type { RoadNetwork } from '../network';
import type { StructurePlanner, StructureSpec } from '../structures';
import { terrainAt } from '../terrain';
import { scatterHash } from '../themes';
import { landmarkPlaces } from './landmark-places';

export const IOWA_PARK_TAG = 'iowa-park';
/** Clear land between the full drawn road/verge and any facility footprint, metres. */
export const IOWA_PARK_RECOVERY_M = 6;
type V3 = readonly [number, number, number];
export interface IowaParkPart {
  name: string;
  box: V3;
  at: V3;
  colour: string;
  far: true;
}
export interface IowaParkSign {
  text: string;
  at: V3;
  size: readonly [number, number];
  bg: string;
  fg: string;
  posts: 0;
}
export interface IowaParkFacility {
  id: string;
  edge: number;
  s: number;
  d: number;
  x: number;
  y: number;
  z: number;
  turn: number;
  /** Local +x axis; +z is its quarter turn (-uz, ux), facing the road. */
  ux: number;
  uz: number;
  radiusM: number;
  parts: readonly IowaParkPart[];
  sign: IowaParkSign;
  specs: readonly StructureSpec[];
}
export interface IowaParkLayout {
  facilities: readonly IowaParkFacility[];
}
const part = (name: string, box: V3, at: V3, colour: string): IowaParkPart => ({
  name,
  box,
  at,
  colour,
  far: true,
});
const C = { timber: '#795e42', roof: '#4c6856', stone: '#b1ac99', dark: '#35493e', bench: '#a17b4d' };
function table(x: number, z: number): IowaParkPart[] {
  const parts = [part('table-top', [2.6, 0.12, 0.85], [x, 0.82, z], C.bench)];
  for (const side of [-1, 1]) {
    parts.push(part('bench-seat', [2.6, 0.12, 0.3], [x, 0.47, z + side * 0.75], C.bench));
    for (const end of [-1, 1])
      parts.push(part('table-leg', [0.15, 0.78, 0.15], [x + end * 0.85, 0.39, z + side * 0.28], C.dark));
    for (const end of [-1, 1])
      parts.push(part('bench-leg', [0.15, 0.41, 0.3], [x + end * 0.85, 0.205, z + side * 0.75], C.dark));
  }
  return parts;
}
function figures(kind: number): {
  id: string;
  width: number;
  depth: number;
  parts: IowaParkPart[];
  sign: IowaParkSign;
} {
  if (kind === 0) {
    const parts = [part('shelter-roof', [7, 0.22, 4.6], [0, 3.05, 0], C.roof), ...table(0, 0)];
    for (const x of [-3, 3])
      for (const z of [-1.8, 1.8])
        parts.push(part('shelter-post', [0.22, 2.94, 0.22], [x, 1.47, z], C.timber));
    parts.push(part('shelter-header', [6.2, 0.28, 0.22], [0, 2.76, 1.8], C.timber));
    return {
      id: 'park-picnic-shelter',
      width: 7.2,
      depth: 4.8,
      parts,
      sign: {
        text: 'PICNIC SHELTER',
        at: [0, 2.68, 1.94],
        size: [2.7, 0.46],
        bg: C.dark,
        fg: '#efe8d4',
        posts: 0,
      },
    };
  }
  if (kind === 1) {
    return {
      id: 'park-maintenance',
      width: 5.6,
      depth: 3.8,
      parts: [
        part('maintenance-shed', [4, 2.3, 2.8], [-0.5, 1.15, -0.2], '#b29e76'),
        part('maintenance-roof', [4.5, 0.2, 3.3], [-0.5, 2.4, -0.2], C.roof),
        part('double-door', [2.2, 1.95, 0.08], [-0.5, 0.975, 1.24], C.dark),
        part('door-seam', [0.04, 1.95, 0.04], [-0.5, 0.975, 1.3], C.timber),
        part('tool-locker', [0.7, 1.2, 0.85], [2.1, 0.6, -0.1], '#586d60'),
      ],
      sign: {
        text: 'PARK MAINTENANCE',
        at: [-0.5, 2.05, 1.33],
        size: [2.8, 0.4],
        bg: C.dark,
        fg: '#efe8d4',
        posts: 0,
      },
    };
  }
  return {
    id: 'park-picnic-tables',
    width: 6.8,
    depth: 5.2,
    parts: [
      ...table(-1.6, -0.8),
      ...table(1.6, 0.8),
      part('notice-post', [0.16, 1.9, 0.16], [0, 0.95, 2.3], C.timber),
    ],
    sign: { text: 'PICNIC AREA', at: [0, 1.65, 2.39], size: [2.1, 0.5], bg: C.dark, fg: '#efe8d4', posts: 0 },
  };
}

/** Whole footprint disc clears every sampled road segment, including the far side of hairpins. */
function clearRoads(road: RoadNetwork, x: number, z: number, radius: number): boolean {
  for (const e of road.edges) {
    const reach = Math.max(-e.dMin, e.dMax) + 0.6 + IOWA_PARK_RECOVERY_M + radius;
    for (let i = 1; i < e.count; i++) {
      const ax = e.x[i - 1]!;
      const az = e.z[i - 1]!;
      const dx = e.x[i]! - ax;
      const dz = e.z[i]! - az;
      const h = dx * dx + dz * dz;
      const t = h > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / h)) : 0;
      const nearX = x - ax - t * dx;
      const nearZ = z - az - t * dz;
      if (nearX * nearX + nearZ * nearZ < reach * reach) return false;
    }
  }
  return true;
}
const layouts = new WeakMap<RoadNetwork, Map<number, IowaParkLayout>>();

export function iowaParkLayout(road: RoadNetwork, seed: number): IowaParkLayout {
  let bySeed = layouts.get(road);
  if (!bySeed) layouts.set(road, (bySeed = new Map<number, IowaParkLayout>()));
  const old = bySeed.get(seed);
  if (old) return old;
  const facilities: IowaParkFacility[] = [];
  const towers = landmarkPlaces(road).filter((p) => p.foundation);
  if (road.terrain)
    for (let kind = 0; kind < 3; kind++) {
      const def = figures(kind);
      const radius = Math.sqrt((def.width * def.width + def.depth * def.depth) / 4);
      const candidates: { edge: number; s: number; side: -1 | 1; across: number; order: number }[] = [];
      for (const e of road.edges)
        for (let s = 45; s < e.length - 45; s += 35)
          for (const side of [-1, 1] as const) {
            if (
              !e.tags.some(
                (t) =>
                  t.tag === IOWA_PARK_TAG &&
                  (t.side === 'both' || t.side === (side < 0 ? 'left' : 'right')) &&
                  t.s0 <= s - radius &&
                  t.s1 >= s + radius,
              )
            )
              continue;
            for (const across of [12, 18, 25])
              candidates.push({
                edge: e.index,
                s,
                side,
                across,
                order: scatterHash(seed, 8153 + kind * 53 + e.index, s, side * across),
              });
          }
      candidates.sort((a, b) => a.order - b.order);
      for (const c of candidates) {
        const e = road.edges[c.edge]!;
        const d = c.side * (Math.max(-e.dMin, e.dMax) + c.across);
        const p = road.toWorld(c.edge, c.s, d, 0);
        if (!clearRoads(road, p.x, p.z, radius)) continue;
        if (
          facilities.some((f) => {
            const dx = f.x - p.x;
            const dz = f.z - p.z;
            return dx * dx + dz * dz < 120 * 120;
          })
        )
          continue;
        const frame = road.frameAt(c.edge, c.s);
        const ux = -c.side * frame.tx;
        const uz = -c.side * frame.tz;
        // Separating axes of the world-aligned tower pad and this rotated facility pad. Reserve only
        // a real footprint overlap; the facilities' ordinary 120 m mutual spacing remains separate.
        if (
          towers.some((t) => {
            const h = t.foundation!.halfM,
              dx = p.x - t.x,
              dz = p.z - t.z;
            const a = def.width / 2,
              b = def.depth / 2;
            return (
              Math.abs(dx) < h + Math.abs(ux) * a + Math.abs(uz) * b &&
              Math.abs(dz) < h + Math.abs(uz) * a + Math.abs(ux) * b &&
              Math.abs(dx * ux + dz * uz) < a + h * (Math.abs(ux) + Math.abs(uz)) &&
              Math.abs(-dx * uz + dz * ux) < b + h * (Math.abs(ux) + Math.abs(uz))
            );
          })
        )
          continue;
        let low = Infinity;
        let high = -Infinity;
        // At half-metre spacing, across the full pad, including its perimeter and interior.
        const nx = Math.ceil(def.width / 0.5);
        const nz = Math.ceil(def.depth / 0.5);
        for (let ix = 0; ix <= nx; ix++)
          for (let iz = 0; iz <= nz; iz++) {
            const x = (ix / nx - 0.5) * def.width;
            const z = (iz / nz - 0.5) * def.depth;
            const ground = terrainAt(road.terrain, p.x + ux * x - uz * z, p.z + uz * x + ux * z);
            if (!ground || ground.surface === 'water') {
              low = -Infinity;
              continue;
            }
            low = Math.min(low, ground.y);
            high = Math.max(high, ground.y);
          }
        if (!Number.isFinite(low) || high - low > 0.65) continue;
        const y = high + 0.08;
        const foundationHeight = y - low + 0.05;
        const parts = [
          part(
            'foundation',
            [def.width, foundationHeight, def.depth],
            [0, -foundationHeight / 2, 0],
            C.stone,
          ),
          ...def.parts,
        ];
        const solidParts = [
          ...parts,
          part('sign', [def.sign.size[0], def.sign.size[1], 0.08], def.sign.at, def.sign.bg),
        ];
        const specs = solidParts.map((b): StructureSpec => ({
          rule: `${def.id}:${b.name}`,
          cls: 'shed',
          model: null,
          edge: c.edge,
          s: c.s,
          d,
          foot: {
            x: p.x + ux * b.at[0] - uz * b.at[2],
            z: p.z + uz * b.at[0] + ux * b.at[2],
            ux,
            uz,
            hu: b.box[0] / 2,
            hv: b.box[2] / 2,
          },
          baseY: y + b.at[1] - b.box[1] / 2,
          roof: { kind: 'flat', topM: b.box[1] },
        }));
        facilities.push({
          id: def.id,
          edge: c.edge,
          s: c.s,
          d,
          x: p.x,
          y,
          z: p.z,
          turn: atan2(-uz, ux),
          ux,
          uz,
          radiusM: radius,
          parts,
          sign: def.sign,
          specs,
        });
        break;
      }
    }
  const layout = { facilities };
  bySeed.set(seed, layout);
  return layout;
}
export const iowaParkPlanner: StructurePlanner = {
  plan(road, seed, out) {
    for (const facility of iowaParkLayout(road, seed).facilities)
      for (const spec of facility.specs) out.add(spec);
  },
};
