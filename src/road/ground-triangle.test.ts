import { expect, it } from 'vitest';
import {
  prepareGroundTriangle,
  groundTriangleHit,
  groundTriangleS,
  type GroundTriangle,
} from './ground-triangle';
import { createRoadNetwork } from './network';
import { fixtureNetwork } from './fixture';
import { groundUnderOf, sectionGroundOf, landReachOf } from './drawn-ground';
import { DRAWN_VERGE_M } from './furniture-constants';

// Literal published terrainUnder arithmetic, including division/tolerance/NaN behavior.
function original([a, b, c]: GroundTriangle, x: number, z: number) {
  const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(det) < 1e-9) return null;
  const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
  const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
  if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) return null;
  return { y: u * a.y + v * b.y + (1 - u - v) * c.y, s: u * a.s + v * b.s + (1 - u - v) * c.s };
}
const triangle: GroundTriangle = [
  { x: 0, y: 3, z: 0, s: 2 },
  { x: 4, y: 5, z: 0, s: 6 },
  { x: 0, y: 4, z: 4, s: 10 },
];
function prepared(t: ReturnType<typeof prepareGroundTriangle>, x: number, z: number) {
  const hit = { u: 0, v: 0, y: 0 };
  return groundTriangleHit(t, x, z, hit) ? { y: hit.y, s: groundTriangleS(t, hit.u, hit.v) } : null;
}
it('exactly retains the original triangle answers at interiors, edges, tolerance, outside and degenerate/nonfinite inputs', () => {
  const variants: GroundTriangle[] = [
    triangle,
    [triangle[2], triangle[1], triangle[0]],
    triangle.map((p) => ({ ...p, y: 3 })) as unknown as GroundTriangle,
    triangle.map((p) => ({ ...p, z: 0 })) as unknown as GroundTriangle,
    triangle.map((p) => ({ ...p, x: p.x * 1e-12 })) as unknown as GroundTriangle,
    triangle.map((p) => ({
      ...p,
      x: Math.fround(p.x + 823456.75),
      z: Math.fround(p.z - 234567.125),
    })) as unknown as GroundTriangle,
    [{ ...triangle[0], x: NaN }, triangle[1], triangle[2]],
  ];
  for (const t of variants) {
    const cached = prepareGroundTriangle(t);
    for (const [x, z] of [
      [0, 0],
      [1, 1],
      [4, 0],
      [0, 4],
      [-1e-9, 1],
      [-1, 1],
      [4, 4],
      [823457, -234566],
      [NaN, 1],
      [Infinity, 1],
    ])
      expect(prepared(cached, x!, z!)).toEqual(original(t, x!, z!));
  }
  expect(original(triangle, 1, 1)).not.toBeNull();
  expect(original(triangle, 4, 4)).toBeNull();
});
it('repeated real triangle queries stop rereading immutable vertex fields', () => {
  let reads = 0;
  const watched = triangle.map((p) => ({
    get x() {
      reads++;
      return p.x;
    },
    get y() {
      reads++;
      return p.y;
    },
    get z() {
      reads++;
      return p.z;
    },
    get s() {
      reads++;
      return p.s;
    },
  })) as unknown as GroundTriangle;
  const answers = Array.from({ length: 100 }, (_, i) => original(watched, (i % 10) / 10, (i % 7) / 10));
  const originalReads = reads;
  expect(originalReads).toBeGreaterThan(0);
  const cached = prepareGroundTriangle(watched);
  reads = 0;
  for (let i = 0; i < answers.length; i++)
    expect(prepared(cached, (i % 10) / 10, (i % 7) / 10)).toEqual(answers[i]);
  expect(reads).toBe(0);
  console.log(`[examined] 100 exact triangle hits: ${originalReads} to ${reads} repeated vertex reads`);
});

it('retains first-winner s through equal-height and degenerate candidate triangles', () => {
  const flat = triangle.map((p) => ({ ...p, y: 3 })) as unknown as GroundTriangle;
  const tied = flat.map((p) => ({ ...p, s: p.s + 100 })) as unknown as GroundTriangle;
  const degenerate = flat.map((p) => ({ ...p, z: 0 })) as unknown as GroundTriangle;
  const select = (triangles: GroundTriangle[], optimized: boolean) => {
    let best: { y: number; s: number } | null = null;
    for (const t of triangles) {
      const hit = optimized ? prepared(prepareGroundTriangle(t), 1, 1) : original(t, 1, 1);
      if (hit && (best === null || hit.y > best.y)) best = hit;
    }
    return best;
  };
  expect(select([degenerate, flat, tied], true)).toEqual(select([degenerate, flat, tied], false));
  expect(select([flat, tied], true)).not.toEqual(select([tied, flat], true));
});

it('matches original Float32 legacy-zone triangles through real straight/curved/banked full ground top/own queries', () => {
  for (const curve of [false, true]) {
    const bundle = fixtureNetwork([
      { id: 'a', lengthM: 120, kappa: curve ? 1 / 200 : 0, grade: curve ? 0.01 : 0 },
    ]);
    const road = createRoadNetwork({
      ...bundle,
      roads: bundle.roads.map((r) => ({
        ...r,
        samples: {
          ...r.samples,
          data: { ...r.samples.data, bankRad: r.samples.data['bankRad']!.map(() => (curve ? 0.04 : 0)) },
        },
        features: [{ kind: 'roadsideZone', id: 'zone', s0: 20, s1: 40, d0: 6, d1: 12 }],
        tags: [],
        barriers: [],
      })),
    });
    // Published legacy-zone row geometry: Float32 vertices, two triangles per 2 m quad,
    // including the degenerate end row. No terrain helper is used to build this oracle.
    const triangles: GroundTriangle[] = [];
    let last: GroundTriangle[0][] | null = null;
    const outer = road.edges[0]!.dMax + DRAWN_VERGE_M;
    for (let s = 12; s <= 48; s += 2) {
      const outside = s < 20 ? 20 - s : s > 40 ? s - 40 : 0;
      const width = outer + (16.5 - outer) * Math.max(0, 1 - outside / 8);
      const row = [outer, width].map((d) => {
        const p = road.toWorld(0, s, d, -0.06);
        return { x: Math.fround(p.x), y: Math.fround(p.y), z: Math.fround(p.z), s };
      });
      if (last) triangles.push([last[0]!, last[1]!, row[0]!], [last[1]!, row[1]!, row[0]!]);
      last = row;
    }
    last = null;
    const reach = landReachOf(road);
    for (let s = 0; s <= 120; s += 2) {
      const row = [outer, outer + reach(0, 1, s)].map((d) => {
        const p = road.toWorld(0, s, d, -0.09);
        return { x: Math.fround(p.x), y: Math.fround(p.y), z: Math.fround(p.z), s };
      });
      if (last) triangles.push([last[0]!, last[1]!, row[0]!], [last[1]!, row[1]!, row[0]!]);
      last = row;
    }
    const under = groundUnderOf(road),
      section = sectionGroundOf(road),
      edge = road.edges[0]!;
    for (const s0 of [13, 20, 25.125, 32, 39.75, 47])
      for (const d0 of [8, 10, 15, 20]) {
        const p = road.toWorld(0, s0, d0, 0);
        let face: { y: number; s: number } | null = null;
        for (const t of triangles) {
          const cx = Math.floor(p.x / 16),
            cz = Math.floor(p.z / 16);
          if (
            cx < Math.floor(Math.min(...t.map((a) => a.x)) / 16) ||
            cx > Math.floor(Math.max(...t.map((a) => a.x)) / 16) ||
            cz < Math.floor(Math.min(...t.map((a) => a.z)) / 16) ||
            cz > Math.floor(Math.max(...t.map((a) => a.z)) / 16)
          )
            continue;
          const hit = original(t, p.x, p.z);
          if (hit && (face === null || hit.y > face.y)) face = hit;
        }
        let nearest = 0,
          distance = Infinity;
        for (let i = 0; i < edge.count; i++) {
          const x = p.x - edge.x[i]!,
            z = p.z - edge.z[i]!,
            d2 = x * x + z * z;
          if (d2 < distance) {
            nearest = i;
            distance = d2;
          }
        }
        let s = nearest * edge.spacing,
          d = 0;
        for (let i = 0; i < 3; i++) {
          const clamped = Math.min(edge.length, Math.max(0, s)),
            f = road.frameAt(0, clamped);
          const x = p.x - f.x,
            z = p.z - f.z;
          d = -x * f.tz + z * f.tx;
          s = clamped + x * f.tx + z * f.tz;
        }
        s = Math.min(edge.length, Math.max(0, s));
        const sectionY = section(0, s, d, { x: p.x, z: p.z });
        const isFace = face !== null && (sectionY === null || face.y > sectionY);
        const y = isFace ? face!.y : sectionY;
        for (const top of [-Infinity, -1, 0, Infinity])
          for (const own of [undefined, { edge: 0, s }, { edge: 0, s: s + 3 }]) {
            const expected = y !== null && y <= top && (!own || isFace || Math.abs(s - own.s) > 2) ? y : null;
            expect(
              under(p.x, p.z, top, own),
              JSON.stringify({ curve, s0, d0, s, d, face, sectionY, top, own }),
            ).toBe(expected);
            expect(under(p.x, p.z, top, own)).toBe(expected); // Warm result/ceiling changes preserve the same geometry.
          }
      }
  }
});
