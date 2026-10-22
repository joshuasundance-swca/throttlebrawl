// Original agricultural facilities: drawing and contact consume these same boxes.
import { atan2 } from '../../core';
import { roadBandHeight, roadsideGroundHeight } from '../course';
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
  /** Soft low rows only: never registered as physical structures or supporting ground. */
  crops?: readonly IowaCountyCrops[];
}
export interface IowaCountyCrops {
  id: string;
  edge: number;
  s0: number;
  s1: number;
  x: number;
  z: number;
  radiusM: number;
  /** World-space triangles, each corner sampled on the existing drawn/ridable strip. */
  vertices: readonly V3[];
}

/** A short site tag stays a facility: rows need room for a readable run after the end headlands. */
const FIELD_MIN_M = 24;
const FIELD_END_M = 4;
const ROW_STEP_M = 2;
const ROW_HALF_M = 0.32;
const ROW_HEIGHT_M = 0.18;
const ROW_COUNT = 8;
const ROW_SPACING_M = 1.4;
const ROW_INSET_M = 0.4;

function cropFields(road: RoadNetwork): IowaCountyCrops[] {
  const fields: IowaCountyCrops[] = [];
  if (road.terrain) return fields; // The county layer follows its existing legacy-land boundary.
  for (const edge of road.edges)
    for (const tag of edge.tags) {
      if (tag.tag !== IOWA_COUNTY_TAG || tag.s1 - tag.s0 < FIELD_MIN_M) continue;
      // Keep the full facility/encounter approach, exit and reaction corridor free, on both sides.
      if (edge.features.some((f) => f.s0 - 24 < tag.s1 && f.s1 + 24 > tag.s0)) continue;
      if (edge.tags.some((t) => /^(bridge|causeway|water-)/.test(t.tag) && t.s0 < tag.s1 && t.s1 > tag.s0))
        continue;
      const s0 = Math.max(0, tag.s0 + FIELD_END_M),
        s1 = Math.min(edge.length, tag.s1 - FIELD_END_M);
      for (const side of tag.side === 'both'
        ? ([-1, 1] as const)
        : ([tag.side === 'left' ? -1 : 1] as const)) {
        const sideName = side < 0 ? 'left' : 'right';
        const center = road.toWorld(edge.index, (s0 + s1) / 2, side * 20, 0);
        const vertices: V3[] = [];
        // One field's broad box bounds the only other-road segments worth examining below.
        let x0 = Infinity,
          x1 = -Infinity,
          z0 = Infinity,
          z1 = -Infinity;
        for (let s = s0; s <= s1 + ROW_STEP_M; s += ROW_STEP_M) {
          const atS = Math.min(s, s1);
          const inner =
            side * road.vergeAt(edge.index, atS, sideName).dOuter + IOWA_COUNTY_RECOVERY_M + ROW_INSET_M;
          for (const d of [
            side * (inner - ROW_HALF_M),
            side * (inner + (ROW_COUNT - 1) * ROW_SPACING_M + ROW_HALF_M),
          ]) {
            const p = road.toWorld(edge.index, atS, d, 0);
            x0 = Math.min(x0, p.x - 1);
            x1 = Math.max(x1, p.x + 1);
            z0 = Math.min(z0, p.z - 1);
            z1 = Math.max(z1, p.z + 1);
          }
        }
        const near = road.edges.flatMap((other) => {
          if (other.index === edge.index) return [];
          const segments: { ax: number; az: number; dx: number; dz: number; reach: number }[] = [];
          let outer = Math.max(-other.dMin, other.dMax);
          for (const section of other.sections)
            outer = Math.max(
              outer,
              Math.abs(road.vergeAt(other.index, section.s0, 'left').dOuter),
              Math.abs(road.vergeAt(other.index, section.s0, 'right').dOuter),
            );
          const reach = outer + IOWA_COUNTY_RECOVERY_M;
          for (let k = 1; k < other.count; k++) {
            const ax = other.x[k - 1]!,
              az = other.z[k - 1]!,
              bx = other.x[k]!,
              bz = other.z[k]!;
            if (
              Math.max(ax, bx) + reach < x0 ||
              Math.min(ax, bx) - reach > x1 ||
              Math.max(az, bz) + reach < z0 ||
              Math.min(az, bz) - reach > z1
            )
              continue;
            segments.push({ ax, az, dx: bx - ax, dz: bz - az, reach });
          }
          return segments;
        });
        const point = (s: number, d: number): V3 | null => {
          const y = roadsideGroundHeight(road, edge.index, s, d);
          if (y === null) return null;
          const p = road.toWorld(edge.index, s, d, 0);
          for (const segment of near) {
            const { ax, az, dx, dz, reach } = segment,
              length = dx * dx + dz * dz;
            const u = length > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / length)) : 0;
            const rx = p.x - ax - u * dx,
              rz = p.z - az - u * dz;
            if (rx * rx + rz * rz < reach * reach) return null;
          }
          return [p.x, y, p.z];
        };
        for (let row = 0; row < ROW_COUNT; row++)
          for (let s = s0; s < s1; s += ROW_STEP_M) {
            const end = Math.min(s + ROW_STEP_M, s1);
            const across = (atS: number) =>
              side *
              (side * road.vergeAt(edge.index, atS, sideName).dOuter +
                IOWA_COUNTY_RECOVERY_M +
                ROW_INSET_M +
                row * ROW_SPACING_M);
            let supported = true,
              low = Infinity,
              high = -Infinity;
            // Corners, row crest and interior: no strip may bridge a missing/wet patch or a step.
            for (let atS = s; atS <= end + 1e-6; atS += 0.5)
              for (let dd = -ROW_HALF_M; dd <= ROW_HALF_M + 1e-6; dd += ROW_HALF_M / 2) {
                const p = point(atS, across(atS) + dd);
                if (!p) supported = false;
                else {
                  low = Math.min(low, p[1]);
                  high = Math.max(high, p[1]);
                }
              }
            if (!supported || high - low > 0.15) continue;
            const corners: V3[] = [];
            for (const atS of [s, end])
              for (const dd of [-ROW_HALF_M, 0, ROW_HALF_M]) {
                const p = point(atS, across(atS) + dd);
                if (!p) {
                  supported = false;
                  break;
                }
                corners.push([p[0], p[1] + (dd === 0 ? ROW_HEIGHT_M : 0.015), p[2]]);
              }
            if (!supported) continue;
            for (const [a, b, c] of [
              [0, 3, 1],
              [1, 3, 4],
              [1, 4, 2],
              [2, 4, 5],
            ])
              vertices.push(corners[a!]!, corners[b!]!, corners[c!]!);
          }
        if (vertices.length === 0) continue;
        let radiusM = 0;
        for (const p of vertices) {
          const dx = p[0] - center.x,
            dz = p[2] - center.z;
          radiusM = Math.max(radiusM, Math.sqrt(dx * dx + dz * dz));
        }
        fields.push({
          id: `county-crops:${edge.id}:${tag.side}:${tag.s0}-${tag.s1}:${side}`,
          edge: edge.index,
          s0,
          s1,
          x: center.x,
          z: center.z,
          radiusM,
          vertices,
        });
      }
    }
  return fields;
}
const box = (name: string, size: V3, at: V3, colour: string): IowaCountyPart => ({
  name,
  box: size,
  at,
  colour,
  far: true,
});
const cache = new WeakMap<RoadNetwork, IowaCountyLayout>();

export function iowaCountyLayout(road: RoadNetwork, _seed: number): IowaCountyLayout {
  const old = cache.get(road);
  if (old) return old;
  const facilities: IowaCountyFacility[] = [];
  if (!road.terrain)
    for (const edge of road.edges)
      for (const feature of edge.features) {
        const kind = feature.params?.['place'];
        if (
          feature.kind !== 'roadsideZone' ||
          (kind !== 'county-loading-shed' && kind !== 'county-corn-crib')
        )
          continue;
        const site = { id: feature.id, shed: kind === 'county-loading-shed' };
        const s = (feature.s0 + feature.s1) / 2;
        if (
          !edge.tags.some(
            (t) => t.tag === IOWA_COUNTY_TAG && t.side !== 'left' && t.s0 <= s - 5 && t.s1 >= s + 5,
          )
        )
          continue;
        const verge = road.vergeAt(edge.index, s, 'right');
        const d = (feature.d0 + feature.d1) / 2;
        if (d - 3.5 < verge.dOuter + IOWA_COUNTY_RECOVERY_M) continue;
        const p = road.toWorld(edge.index, s, d, 0);
        const f = road.frameAt(edge.index, s);
        const ux = -f.tx,
          uz = -f.tz; // Local +z faces the road.
        const near = verge.dOuter - 0.25,
          far = d + 3.5;
        let supported = true,
          low = Infinity,
          high = -Infinity,
          ridingLow = Infinity;
        // Full approach, footprint and exit at <=0.5m, including boundary and interior.
        const nz = Math.ceil((far - near) / 0.5);
        for (let ix = 0; ix <= 20; ix++)
          for (let iz = 0; iz <= nz; iz++) {
            const atS = s - 5 + ix * 0.5,
              atD = near + ((far - near) * iz) / nz;
            const y = roadBandHeight(road, edge.index, atS, atD);
            ridingLow = Math.min(ridingLow, road.surfaceHeight(edge.index, atS, atD));
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
        // The existing roadside-zone drawing remains under this physical slab. Meet the
        // lowest nominal riding height, with no dependence on its decorative ground lift.
        const y = ridingLow;
        if (y < high || y - low > 0.15) continue;
        const parts: IowaCountyPart[] = [];
        if (site.shed) {
          parts.push(
            box('loading-apron', [10, 0.16, far - near], [0, -0.08, d - (near + far) / 2], '#b1a68c'),
          );
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
  const layout = { facilities, crops: cropFields(road) };
  cache.set(road, layout);
  return layout;
}
export const iowaCountyPlanner: StructurePlanner = {
  plan(road, seed, out) {
    for (const facility of iowaCountyLayout(road, seed).facilities)
      for (const spec of facility.specs) out.add(spec);
  },
};
