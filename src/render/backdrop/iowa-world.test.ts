// Iowa's new horizons are original context, not surveyed properties. Build the actual pack
// geometry against every shipped road, including county branches. The coordinator checks the
// rendered chase views; these tests establish angular opportunity and full-face road clearance.
import { describe, expect, it } from 'vitest';
import { Ray, Vector3 } from 'three';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../../road';
import { buildSoup, roadPointsOf } from './builder';
import {
  backdropProblems,
  type BackdropNetworkFile,
  type BackdropRegionFile,
  type Piece,
  type SkylinePiece,
} from './data';
import type { Soup } from './soup';

const networks = Object.values(
  import.meta.glob<BakedNetwork & { crs: { originLatDeg: number; originLonDeg: number } }>(
    '../../../packs/region-clinton/regions/clinton-iowa/networks/*.json',
    { eager: true, import: 'default' },
  ),
);
const roads = Object.values(
  import.meta.glob<BakedRoad>('../../../packs/region-clinton/regions/clinton-iowa/roads/*.json', {
    eager: true,
    import: 'default',
  }),
);
const backdrops = Object.values(
  import.meta.glob<BackdropNetworkFile>(
    '../../../packs/region-clinton/assets/backdrop/clinton-iowa/networks/*.json',
    { eager: true, import: 'default' },
  ),
);
const region = Object.values(
  import.meta.glob<BackdropRegionFile>(
    '../../../packs/region-clinton/assets/backdrop/clinton-iowa/region.json',
    { eager: true, import: 'default' },
  ),
)[0]!;
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
type Vertex = { x: number; y: number; z: number };

function standing(soup: Soup): Vertex[] {
  const out: Vertex[] = [];
  for (let i = 0; i < soup.pos.length / 3; i++)
    if (soup.info[i * 4 + 1]! < 0.5)
      out.push({ x: soup.pos[i * 3]!, y: soup.pos[i * 3 + 1]!, z: soup.pos[i * 3 + 2]! });
  return out;
}

/** Projected triangle-to-road clearance: vertices alone miss a broad face crossing the road. */
function encroaches(
  vertices: readonly Vertex[],
  points: readonly (readonly [number, number])[],
  radius: number,
) {
  const segment = (x: number, z: number, a: Vertex, b: Vertex) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
  };
  for (let i = 0; i < vertices.length; i += 3) {
    const a = vertices[i]!;
    const b = vertices[i + 1]!;
    const c = vertices[i + 2]!;
    const minX = Math.min(a.x, b.x, c.x) - radius;
    const maxX = Math.max(a.x, b.x, c.x) + radius;
    const minZ = Math.min(a.z, b.z, c.z) - radius;
    const maxZ = Math.max(a.z, b.z, c.z) + radius;
    const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    for (const [x, z] of points) {
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const u = ((x - a.x) * (c.z - a.z) - (z - a.z) * (c.x - a.x)) / area;
      const v = ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x)) / area;
      if (Math.abs(area) > 1e-9 && u >= 0 && v >= 0 && u + v <= 1) return true;
      if (Math.min(segment(x, z, a, b), segment(x, z, b, c), segment(x, z, c, a)) < radius) return true;
    }
  }
  return false;
}

describe.each(networks)('Iowa world context on $id', (network) => {
  const backdrop = backdrops.find((b) => b.network === network.id)!;
  const road = createRoadNetwork({ network, roads: roads.filter((r) => network.roads.includes(r.id)) });
  const points = roadPointsOf(road.edges, 1);
  const pieces = backdrop.pieces ?? [];
  const build = (selected: readonly Piece[] = pieces) =>
    buildSoup({ ...region, pieces: [] }, { ...backdrop, pieces: selected }, points, 7);

  it('builds local relief and low human forms without replacing physical ground or water', () => {
    expect(backdropProblems(backdrop, 'network')).toEqual([]);
    expect([backdrop.originLatDeg, backdrop.originLonDeg]).toEqual([
      network.crs.originLatDeg,
      network.crs.originLonDeg,
    ]);
    for (const select of [
      (p: Piece) => p.kind === 'ridge',
      (p: Piece) => p.kind === 'skyline' || p.kind === 'blocks',
    ])
      expect(standing(build(pieces.filter(select)).soup).length).toBeGreaterThan(0);
    for (const p of pieces) {
      expect(p.kind, p.id).not.toBe('floor');
      expect(p.kind, p.id).not.toBe('vessels');
      expect(p.frame, p.id).toBe('local');
      expect(p.networks, p.id).toEqual([network.id]);
      expect(p.keepOutM ?? 0, p.id).toBeGreaterThanOrEqual(800);
      expect(p.nearFadeM, p.id).toBeUndefined();
      expect(standing(build([p]).soup).length, p.id).toBeGreaterThan(0);
    }
    // The pieces cannot appear on another network even when passed the wrong file.
    const wrong = buildSoup({ ...region, pieces: [] }, { ...backdrop, network: 'control' }, points, 7);
    expect(standing(wrong.soup)).toEqual([]);
    expect(wrong.stats.skipped).toBe(pieces.length);
  });

  it('keeps entire built faces clear of riding and recovery ground, within the existing backdrop budget', () => {
    const vertices = standing(build().soup);
    expect(vertices.length).toBeGreaterThan(0);
    expect(encroaches(vertices, points, 800)).toBe(false);
    const [x, z] = points[0]!;
    const unsafe: SkylinePiece = {
      id: 'unsafe-road-control',
      kind: 'skyline',
      frame: 'local',
      centre: [x, z],
      radiusM: 1,
      count: 0,
      heightM: [10, 20],
      widthM: [10, 20],
      colours: ['#555555'],
      keepOutM: 0,
      towers: [{ at: [x, z], heightM: 40, widthM: 20, colour: '#555555' }],
    };
    expect(encroaches(standing(build([unsafe]).soup), points, 800)).toBe(true);
    // A broad triangle whose vertices are outside the radius still crosses the road.
    expect(
      encroaches(
        [
          { x: x - 1000, y: 20, z: z - 1000 },
          { x: x + 1000, y: 20, z: z - 1000 },
          { x, y: 40, z: z + 1500 },
        ],
        [[x, z]],
        800,
      ),
    ).toBe(true);
    const full = buildSoup(region, backdrop, points, 7);
    expect(full.stats.triangles).toBeLessThan(20_000);
    stdout.write(
      `[examined] ${network.id}: ${vertices.length} new standing vertices; whole faces clear of 800 m; ${full.stats.triangles}/20000 full-backdrop triangles\n`,
    );
  });

  it('offers forward road views of both wooded relief and human context, with removed-group controls', () => {
    const views = (selected: readonly Piece[], minElevationDeg: number) => {
      const vertices = standing(build(selected).soup);
      const seen: { road: string; s: number; x: number; y: number; z: number; spanDeg: number }[] = [];
      let samples = 0;
      for (const edge of road.edges)
        for (let s = 0; s < edge.length; s += 50) {
          samples++;
          const eye = road.toWorld(edge.index, s, 0, 3.2);
          const frame = road.frameAt(edge.index, s);
          const heading = Math.atan2(frame.tx, -frame.tz);
          const azimuths: number[] = [];
          for (const v of vertices) {
            const dx = v.x - eye.x;
            const dz = v.z - eye.z;
            const raw = Math.atan2(dx, -dz) - heading;
            const a = (Math.atan2(Math.sin(raw), Math.cos(raw)) * 180) / Math.PI;
            const elevation = (Math.atan2(v.y - eye.y, Math.hypot(dx, dz)) * 180) / Math.PI;
            if (Math.abs(a) < 35 && elevation > minElevationDeg) azimuths.push(a);
          }
          const spanDeg = azimuths.length ? Math.max(...azimuths) - Math.min(...azimuths) : 0;
          if (spanDeg > 1) seen.push({ road: edge.id, s, ...eye, spanDeg });
        }
      return { samples, seen };
    };
    const groups = [
      { name: 'relief', select: (p: Piece) => p.kind === 'ridge', elevation: 0.5 },
      { name: 'town', select: (p: Piece) => p.kind === 'skyline' || p.kind === 'blocks', elevation: -0.3 },
    ];
    for (const group of groups) {
      const observed = views(pieces.filter(group.select), group.elevation);
      const removed = views([], group.elevation);
      // At least a short stretch on one road, rather than isolated samples on tiny connectors.
      expect(
        observed.seen.some((a) => observed.seen.some((b) => a.road === b.road && b.s - a.s >= 100)),
        group.name,
      ).toBe(true);
      expect(removed.seen, group.name).toEqual([]);
      const representative = observed.seen.sort((a, b) => b.spanDeg - a.spanDeg)[0];
      stdout.write(
        `[examined] ${network.id} ${group.name}: ${observed.seen.length}/${observed.samples} forward angular opportunities; removed-group ${removed.seen.length}; representative ${JSON.stringify(representative)}\n`,
      );
    }
  });

  it('masks the elevated building skirts with distant land instead of showing tall floating walls', () => {
    const relief = standing(build(pieces.filter((p) => p.kind === 'ridge')).soup);
    const obscured = (eye: Vertex, target: Vertex, vertices: readonly Vertex[]) => {
      const origin = new Vector3(eye.x, eye.y, eye.z);
      const end = new Vector3(target.x, target.y, target.z);
      const direction = end.clone().sub(origin);
      const distance = direction.length();
      const ray = new Ray(origin, direction.normalize());
      const hit = new Vector3();
      for (let i = 0; i < vertices.length; i += 3) {
        const asVector = (v: Vertex) => new Vector3(v.x, v.y, v.z);
        if (
          ray.intersectTriangle(
            asVector(vertices[i]!),
            asVector(vertices[i + 1]!),
            asVector(vertices[i + 2]!),
            false,
            hit,
          ) &&
          hit.distanceTo(origin) < distance
        )
          return true;
      }
      return false;
    };
    let checked = 0;
    for (const p of pieces) {
      if (p.kind !== 'blocks' && p.kind !== 'skyline') continue;
      const anchors =
        p.kind === 'blocks'
          ? [
              ...p.area,
              [
                p.area.reduce((sum, a) => sum + a[0], 0) / p.area.length,
                p.area.reduce((sum, a) => sum + a[1], 0) / p.area.length,
              ] as const,
            ]
          : [p.centre, ...(p.towers ?? []).map((t) => t.at)];
      for (const [x, z] of anchors) {
        const target = { x, y: (p.baseM ?? 0) - 10, z };
        for (const edge of road.edges)
          for (let s = 0; s < edge.length; s += 100) {
            const eye = road.toWorld(edge.index, s, 0, 3.2);
            expect(obscured(eye, target, relief), `${p.id} base from ${edge.id}:${s}`).toBe(true);
            expect(obscured(eye, target, []), 'removed relief exposes the skirt').toBe(false);
            checked++;
          }
      }
      // The mask must leave an actual roof vertex above it in a forward road view. Angular span
      // alone would pass even if a newly added ridge swallowed the whole town.
      const roofs = standing(build([p]).soup).filter((v) => v.y >= (p.baseM ?? 0) + p.heightM[0]);
      let visibleRoof = false;
      for (const edge of road.edges)
        for (let s = 0; s < edge.length && !visibleRoof; s += 100) {
          const eye = road.toWorld(edge.index, s, 0, 3.2);
          const frame = road.frameAt(edge.index, s);
          visibleRoof = roofs.some((top) => {
            const dx = top.x - eye.x;
            const dz = top.z - eye.z;
            const forward = dx * frame.tx + dz * frame.tz;
            const across = Math.abs(dx * frame.tz - dz * frame.tx);
            return (
              forward > 0 && across / forward < Math.tan((35 * Math.PI) / 180) && !obscured(eye, top, relief)
            );
          });
        }
      expect(visibleRoof, `${p.id} roof must survive the terrain mask`).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
    stdout.write(
      `[examined] ${network.id}: ${checked} cluster-base sightlines masked by relief; removed-relief exposes them\n`,
    );
  });
});
