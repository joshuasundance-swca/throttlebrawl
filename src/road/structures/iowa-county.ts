// Original agricultural facilities: drawing and contact consume these same boxes.
import { atan2 } from '../../core';
import { roadBandHeight } from '../course';
import type { RoadNetwork } from '../network';
import type { StructurePlanner, StructureSpec } from '../structures';

export const IOWA_COUNTY_TAG = 'iowa-county-farmstead';
export const IOWA_COUNTY_RECOVERY_M = 6;
type V3 = readonly [number, number, number];
export interface IowaCountyPart {
  name: string;
  box: V3;
  at: V3;
  colour: string;
  far: true;
}
export interface IowaCountyFacility {
  id: string;
  edge: number;
  s: number;
  d: number;
  x: number;
  y: number;
  z: number;
  ux: number;
  uz: number;
  turn: number;
  radiusM: number;
  parts: readonly IowaCountyPart[];
  sign: { text: string; at: V3; size: readonly [number, number]; bg: string; fg: string; posts: 0 };
  specs: readonly StructureSpec[];
}
export interface IowaCountyLayout {
  facilities: readonly IowaCountyFacility[];
}
const box = (name: string, size: V3, at: V3, colour: string): IowaCountyPart => ({
  name,
  box: size,
  at,
  colour,
  far: true,
});
const sites = [
  { id: 'county-loading-shed', s: 660, shed: true },
  { id: 'county-corn-crib', s: 1940, shed: false },
] as const;
const cache = new WeakMap<RoadNetwork, IowaCountyLayout>();

export function iowaCountyLayout(road: RoadNetwork, _seed: number): IowaCountyLayout {
  const old = cache.get(road);
  if (old) return old;
  const facilities: IowaCountyFacility[] = [];
  const edge = road.edges.find((e) => e.id === 'osm-clinton-county-180th');
  if (edge && !road.terrain)
    for (const site of sites) {
      const { s } = site;
      if (
        !edge.tags.some(
          (t) => t.tag === IOWA_COUNTY_TAG && t.side !== 'left' && t.s0 <= s - 5 && t.s1 >= s + 5,
        )
      )
        continue;
      const verge = road.vergeAt(edge.index, s, 'right');
      const d = verge.dOuter + IOWA_COUNTY_RECOVERY_M + 4;
      const p = road.toWorld(edge.index, s, d, 0);
      const f = road.frameAt(edge.index, s);
      const ux = -f.tx,
        uz = -f.tz; // Local +z faces the road.
      const near = verge.dOuter - 0.25,
        far = d + 3.5;
      let supported = true,
        low = Infinity,
        high = -Infinity;
      // Full approach, footprint and exit at <=0.5m, including boundary and interior.
      const nz = Math.ceil((far - near) / 0.5);
      for (let ix = 0; ix <= 20; ix++)
        for (let iz = 0; iz <= nz; iz++) {
          const atS = s - 5 + ix * 0.5,
            atD = near + ((far - near) * iz) / nz;
          const y = roadBandHeight(road, edge.index, atS, atD);
          if (y === null) supported = false;
          else if (atD > verge.dOuter) {
            low = Math.min(low, y);
            high = Math.max(high, y);
          }
          const q = road.toWorld(edge.index, atS, atD, 0);
          for (const other of road.edges) {
            if (other.index === edge.index) continue;
            for (let k = 1; k < other.count; k++) {
              const ax = other.x[k - 1]!,
                az = other.z[k - 1]!;
              const dx = other.x[k]! - ax,
                dz = other.z[k]! - az;
              const h = dx * dx + dz * dz;
              const t = h > 0 ? Math.max(0, Math.min(1, ((q.x - ax) * dx + (q.z - az) * dz) / h)) : 0;
              const rx = q.x - ax - t * dx,
                rz = q.z - az - t * dz;
              const reach = Math.max(-other.dMin, other.dMax) + 3 + IOWA_COUNTY_RECOVERY_M;
              if (rx * rx + rz * rz < reach * reach) supported = false;
            }
          }
        }
      if (!supported || !Number.isFinite(low) || high - low > 0.025) continue;
      // Legacy rural land is drawn 9cm below its reference road plane. A shallow concrete
      // pad meets the lowest existing riding plane, rather than burying the wheels in it.
      const y = low + 0.09;
      const parts: IowaCountyPart[] = [];
      if (site.shed) {
        parts.push(box('loading-apron', [10, 0.16, far - near], [0, -0.08, d - (near + far) / 2], '#b1a68c'));
        parts.push(box('shed-roof', [8.8, 0.24, 6.6], [0, 4.1, 0], '#7d4337'));
        for (const x of [-3.8, 3.8])
          for (const z of [-2.8, 2.8])
            parts.push(box('shed-post', [0.24, 3.98, 0.24], [x, 1.99, z], '#665440'));
        for (const z of [-2.8, 2.8])
          parts.push(box('shed-header', [7.84, 0.26, 0.24], [0, 3.85, z], '#665440'));
      } else {
        parts.push(box('crib-pad', [5.6, 0.16, 4.4], [0, -0.08, 0], '#b1a68c'));
        parts.push(box('stored-corn', [4.5, 2.3, 3.2], [0, 1.15, 0], '#c3953e'));
        parts.push(box('crib-roof', [5.8, 0.22, 4.6], [0, 3.2, 0], '#818b81'));
        for (const x of [-2.5, 2.5])
          for (const z of [-1.9, 1.9])
            parts.push(box('crib-post', [0.2, 3.09, 0.2], [x, 1.545, z], '#665440'));
        for (let x = -2.25; x <= 2.25; x += 0.5)
          for (const z of [-1.9, 1.9])
            parts.push(box('crib-slat', [0.12, 2.85, 0.12], [x, 1.425, z], '#9c8c67'));
        for (let z = -1.5; z <= 1.5; z += 0.5)
          for (const x of [-2.5, 2.5])
            parts.push(box('crib-slat', [0.12, 2.85, 0.12], [x, 1.425, z], '#9c8c67'));
      }
      const sign = {
        text: site.shed ? 'COUNTY LOADING' : 'CORN STORAGE',
        at: [0, site.shed ? 3.65 : 2.85, site.shed ? 2.97 : 2.01] as V3,
        size: [3.1, 0.48] as const,
        bg: '#665440',
        fg: '#eee1bd',
        posts: 0 as const,
      };
      const specs = [...parts, box('sign', [sign.size[0], sign.size[1], 0.08], sign.at, sign.bg)].map(
        (b): StructureSpec => ({
          rule: `${site.id}:${b.name}`,
          cls: 'shed',
          model: null,
          edge: edge.index,
          s,
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
        }),
      );
      facilities.push({
        id: site.id,
        edge: edge.index,
        s,
        d,
        x: p.x,
        y,
        z: p.z,
        ux,
        uz,
        turn: atan2(-uz, ux),
        radiusM: site.shed ? 12 : 4,
        parts,
        sign,
        specs,
      });
    }
  const layout = { facilities };
  cache.set(road, layout);
  return layout;
}
export const iowaCountyPlanner: StructurePlanner = {
  plan(road, seed, out) {
    for (const facility of iowaCountyLayout(road, seed).facilities)
      for (const spec of facility.specs) out.add(spec);
  },
};
