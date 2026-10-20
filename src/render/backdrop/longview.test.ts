// Longview's authored inland composite: low industrial and civic silhouettes inside wooded valley
// horizons. These are contextual shapes, not mapped properties. Build the actual pack pieces on the
// actual baked roads; the coordinator's chase-camera check owns the final visual acceptance.
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  readConnector,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../road';
import { buildSoup, roadIndex, roadPointsOf } from './builder';
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
    '../../../packs/region-pnw/regions/pacific-northwest/networks/osm-pnw-longview*.json',
    { eager: true, import: 'default' },
  ),
);
const roads = Object.values(
  import.meta.glob<BakedRoad>('../../../packs/region-pnw/regions/pacific-northwest/roads/*longview*.json', {
    eager: true,
    import: 'default',
  }),
);
const routes = Object.values(
  import.meta.glob<BakedRoute>(
    '../../../packs/region-pnw/regions/pacific-northwest/routes/osm-longview-*.json',
    { eager: true, import: 'default' },
  ),
);
const backdrops = Object.values(
  import.meta.glob<BackdropNetworkFile>(
    '../../../packs/region-pnw/assets/backdrop/pacific-northwest/networks/osm-pnw-longview*.json',
    { eager: true, import: 'default' },
  ),
);
const region = Object.values(
  import.meta.glob<BackdropRegionFile>(
    '../../../packs/region-pnw/assets/backdrop/pacific-northwest/region.json',
    { eager: true, import: 'default' },
  ),
)[0]!;
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;

/** Standing geometry only: exclude the builder's far ground ring. */
function standing(soup: Soup) {
  const out: { x: number; y: number; z: number }[] = [];
  for (let v = 0; v < soup.pos.length / 3; v++)
    if (soup.info[v * 4 + 1]! < 0.5)
      out.push({ x: soup.pos[v * 3]!, y: soup.pos[v * 3 + 1]!, z: soup.pos[v * 3 + 2]! });
  return out;
}

/** Exact horizontal triangle clearance, including long faces whose vertices alone may miss a road. */
function encroaches(soup: Soup, points: readonly (readonly [number, number])[], radius: number) {
  const vertices = standing(soup);
  const segmentDistance = (x: number, z: number, a: (typeof vertices)[number], b: typeof a) => {
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
      if (
        Math.min(segmentDistance(x, z, a, b), segmentDistance(x, z, b, c), segmentDistance(x, z, c, a)) <
        radius
      )
        return true;
    }
  }
  return false;
}

describe.each(networks)("Longview's inland backdrop on $id", (network) => {
  const backdrop = backdrops.find((b) => b.network === network.id)!;
  const road = createRoadNetwork({ network, roads: roads.filter((r) => network.roads.includes(r.id)) });
  const points = roadPointsOf(road.edges, 1);
  const pieces = (backdrop.pieces ?? []).filter((p) => p.kind !== 'floor');
  const build = (selected: readonly Piece[] = pieces) =>
    buildSoup({ ...region, pieces: [] }, { ...backdrop, pieces: selected }, points, 7);

  const route = routes.find((r) => r.network === network.id)!;
  if (route.branches?.length)
    it('frames distinct civic and mill groups at the approach and shared rejoin, with woods behind the choices', () => {
      const branchRoads = route.branches!.flatMap((b) => b.roads);
      const connectors = network.junctions
        .flatMap((j) => j.connectors.map(readConnector))
        .filter((c) => c !== null && !c.trafficOnly);
      const rejoin = connectors.find(
        (c) => branchRoads.includes(c.from.road) && route.mainPath.includes(c.to.road),
      )!;
      const split = connectors.find(
        (c) => c.splitZone && route.mainPath.includes(c.from.road) && branchRoads.includes(c.to.road),
      )!;
      const connectorRoads = new Set(connectors.map((c) => c.road));
      const inner = route.mainPath[route.mainPath.indexOf(split.from.road) + 1]!;
      const outer = branchRoads.find((id) => !connectorRoads.has(id))!;
      const views = [
        // These are the two authored viewing scenarios, not a rule that an alternate enters industry:
        // the diamond faces north into civic roofs; the triangle approaches the southern mill forms.
        {
          stage: 'approach',
          id: route.start.road,
          s: route.start.s,
          group: network.id === 'osm-pnw-longview-diamond' ? 'civic' : 'mill',
          minimumDeg: 0.7,
        },
        { stage: 'inner choice', id: inner, group: 'woods', minimumDeg: 2 },
        { stage: 'outer choice', id: outer, group: 'woods', minimumDeg: 2 },
        { stage: 'rejoin', id: rejoin.to.road, s: 40, group: 'civic', minimumDeg: 0.7 },
        { stage: 'rejoin', id: rejoin.to.road, s: 40, group: 'mill', minimumDeg: 0.7 },
      ];
      const span = (selected: readonly Piece[], view: (typeof views)[number]) => {
        const edge = road.edges.find((e) => e.id === view.id)!;
        const s = Math.min(view.s ?? edge.length / 2, edge.length);
        const cam = road.toWorld(edge.index, s, 0, 3.2);
        const f = road.frameAt(edge.index, s);
        const heading = Math.atan2(f.tx, -f.tz);
        const azimuths = standing(build(selected).soup).flatMap((v) => {
          const dx = v.x - cam.x;
          const dz = v.z - cam.z;
          const raw = Math.atan2(dx, -dz) - heading;
          const a = (Math.atan2(Math.sin(raw), Math.cos(raw)) * 180) / Math.PI;
          const elevation = (Math.atan2(v.y - cam.y, Math.hypot(dx, dz)) * 180) / Math.PI;
          return Math.abs(a) < 35 && elevation > view.minimumDeg ? [a] : [];
        });
        return azimuths.length ? Math.max(...azimuths) - Math.min(...azimuths) : 0;
      };
      for (const view of views) {
        const selected = pieces.filter((p) =>
          view.group === 'woods' ? p.kind === 'ridge' : p.kind === 'skyline' && p.id.includes(view.group),
        );
        const visibleSpan = span(selected, view);
        stdout.write(
          `[examined] ${network.id} ${view.stage} ${view.id}: ${view.group} spans ${visibleSpan.toFixed(2)} degrees above ${view.minimumDeg} degrees; removed-group ${span([], view)}\n`,
        );
        expect(visibleSpan, `${view.stage}: ${view.group}`).toBeGreaterThan(0.5);
        expect(span([], view), `${view.stage}: removed ${view.group}`).toBe(0);
      }
    });

  it('adds network-local, schema-valid human and wooded silhouettes in the baked origin', () => {
    expect(backdropProblems(backdrop, 'network')).toEqual([]);
    expect([backdrop.originLatDeg, backdrop.originLonDeg]).toEqual([
      network.crs.originLatDeg,
      network.crs.originLonDeg,
    ]);
    expect(pieces.some((p) => p.kind === 'ridge')).toBe(true);
    // Require built human forms without freezing today's dimensions or roof treatment. Their
    // recognizable civic/industrial character is accepted with the actual chase camera.
    const human = pieces.filter((p) => p.kind === 'skyline' || p.kind === 'blocks');
    expect(standing(build(human).soup).length).toBeGreaterThan(0);
    for (const p of pieces) {
      expect(p.frame, p.id).toBe('local');
      expect(p.networks, p.id).toEqual([network.id]);
      expect(p.keepOutM ?? 0, p.id).toBeGreaterThanOrEqual(800);
      expect(p.nearFadeM, p.id).toBeUndefined();
    }
    // Even if the wrong network file is passed, its extra shapes cannot leak onto another ride.
    const wrong = buildSoup(
      { ...region, pieces: [] },
      { ...backdrop, network: 'another-network', pieces },
      points,
      7,
    );
    expect(standing(wrong.soup)).toEqual([]);
    expect(wrong.stats.skipped).toBe(pieces.length);
  });

  it('keeps built standing surfaces beyond the recoverable roadside ground', () => {
    const soup = build().soup;
    const vertices = standing(soup);
    expect(vertices.length).toBeGreaterThan(0);
    const near = roadIndex(points);
    expect(vertices.filter((v) => near(v.x, v.z, 800))).toEqual([]);
    expect(encroaches(soup, points, 800)).toBe(false);
    // Control: the same check catches an unprotected solid authored directly on the road.
    const [x, z] = points[0]!;
    const unsafe: SkylinePiece = {
      id: 'unsafe-control',
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
    expect(standing(build([unsafe]).soup).some((v) => near(v.x, v.z, 800))).toBe(true);
    expect(encroaches(build([unsafe]).soup, points, 800)).toBe(true);
    const full = buildSoup(region, backdrop, points, 7);
    expect(full.stats.triangles).toBeLessThan(20_000);
    stdout.write(
      `[examined] ${network.id}: ${vertices.length} new standing vertices and their projected triangles clear of 800 m roadside ground; ${full.stats.triangles} full-backdrop triangles\n`,
    );
  });

  it('puts human silhouettes and wooded relief in forward views from the actual streets', () => {
    // Sample by road distance, not wall time or frames. This is an angular geometry check, not a
    // claim about occlusion by near-world dressing or final chase-camera composition.
    const seen = (selected: readonly Piece[], minimumDeg: number) => {
      const vertices = standing(build(selected).soup);
      let cameras = 0;
      let useful = 0;
      for (const edge of road.edges)
        for (let s = 0; s < edge.length; s += 100) {
          cameras++;
          const cam = road.toWorld(edge.index, s, 0, 3.2);
          const frame = road.frameAt(edge.index, s);
          const heading = Math.atan2(frame.tx, -frame.tz);
          const azimuths: number[] = [];
          for (const v of vertices) {
            const dx = v.x - cam.x;
            const dz = v.z - cam.z;
            const raw = Math.atan2(dx, -dz) - heading;
            const a = (Math.atan2(Math.sin(raw), Math.cos(raw)) * 180) / Math.PI;
            const elevation = (Math.atan2(v.y - cam.y, Math.hypot(dx, dz)) * 180) / Math.PI;
            if (Math.abs(a) < 35 && elevation > minimumDeg) azimuths.push(a);
          }
          if (azimuths.length && Math.max(...azimuths) - Math.min(...azimuths) > 0.5) useful++;
        }
      return { cameras, useful };
    };
    const human = seen(
      pieces.filter((p) => p.kind === 'skyline' || p.kind === 'blocks'),
      0.7,
    );
    const hills = seen(
      pieces.filter((p) => p.kind === 'ridge'),
      2,
    );
    const control = seen([], 0.7);
    expect(control.useful).toBe(0);
    expect(human.useful / human.cameras).toBeGreaterThan(0.2);
    expect(hills.useful / hills.cameras).toBeGreaterThan(0.4);
    stdout.write(
      `[examined] ${network.id}: human silhouette in ${human.useful}/${human.cameras} forward road views; wooded relief in ${hills.useful}/${hills.cameras}; removed-piece control ${control.useful}\n`,
    );
  });
});
