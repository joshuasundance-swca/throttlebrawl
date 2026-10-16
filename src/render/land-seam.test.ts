// The land strip and its slope meet with no gap (run W-S: "the 1 to 2 px land seam at the Twin
// Peaks junction"; PR #304 left "a 1 to 2 px light seam line ... between the bank and the hill",
// cause unverified, because rays that went through it met ground further down). The cause: the
// terrain skirt's slope kept every third row, its top edge too, so on a bend its chords cut inside
// the strip's edge and opened a sliver between the strip and the slope, through which the flat
// ground far below (or the sky) showed. The checks walk across the strip's edge on every terrain
// network, in 2 cm steps between the land's own rows (where a chord strays furthest), reading the
// drawn land straight down: the ground there never drops into a hole and comes back up.
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import { GroundTris, openLandEnds } from './land-probe.test-util';
import { createFlatLook } from './look';
import { buildRoadScene, GROUND_Y, type RoadDressing } from './road-mesh';
import { trafficClearanceOf } from './scene-cost.test-util';
import { LAND_TOP_M } from './scenery';

const look = createFlatLook();
/** The examined lines, printed even when the tests pass (console.log is not). */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

/** The networks with a terrain skirt (not tropical): Twin Peaks first. */
const TERRAIN = [
  'osm-sf-twin-peaks',
  'osm-sf-russian-hill',
  'sf-hills',
  'pnw-c1',
  'osm-pnw-gorge',
  'osm-pnw-chuckanut',
];
/** A hole: the ground under a step drops this far below both neighbours (a slope never does). */
const HOLE_M = 2;
const STEP_M = 0.02;
/** The land's rows are about 2 m apart; the walk crosses between them. */
const ROW_M = 2;

describe("the land strip's edge", () => {
  it('follows a changing slope top above straight feet and coalesces a fully straight slope', () => {
    let flatTriangles = 0;
    for (const curved of [false, true]) {
      const bundle = fixtureNetwork([{ id: 'r', lengthM: 128, kappa: 0 }]);
      const file = bundle.roads[0]!;
      const ys = file.samples.data['y'] as number[];
      ys.forEach((_, i) => {
        ys[i] = 60 + (curved ? 10 * Math.sin((Math.PI * i * file.sampleSpacingM) / file.lengthM) ** 2 : 0);
      });
      const tags = [{ s0: 0, s1: file.lengthM, side: 'both' as const, tag: 'forest' }];
      file.tags = tags;
      const road = createRoadNetwork(bundle);
      const scene = buildRoadScene(road, look, { r: { tags, barriers: [] } }, { roadsideDensity: 0 });
      const ground = new GroundTris(scene.group, /^road-land/);
      const edge = road.edges[0]!;
      const outer = edge.dMax + 0.6;
      let miss = 0;
      for (const s of [16, 32, 48, 64, 80, 96, 112]) {
        const reach = scene.landReach(edge.index, 1, s);
        expect(reach).toBe(24);
        const top = road.toWorld(edge.index, s, outer + reach, LAND_TOP_M).y;
        // Above 60 m the skirt's 90 m run is capped, so its feet form a straight, level line.
        for (const t of [0.25, 0.5, 0.75]) {
          const p = road.toWorld(edge.index, s, outer + reach + 90 * t, 0);
          const hit = ground.heightAt(p.x, p.z, p.y + 1);
          expect(hit?.name).toBe('road-land');
          miss = Math.max(miss, Math.abs(hit!.y - (top * (1 - t) + GROUND_Y * t)));
        }
      }
      print(
        `[examined] ${curved ? 'curved' : 'straight'} terrain top, straight feet: ${ground.count} triangles, ${miss} m slope-profile error`,
      );
      expect(miss).toBeLessThan(0.05);
      if (curved) expect(ground.count).toBeGreaterThan(flatTriangles);
      else flatTriangles = ground.count;
      scene.dispose();
    }
  });
  it('keeps Russian Hill terrain ends closed with the active traffic clearance', () => {
    const id = 'osm-sf-russian-hill';
    const { road, dressing } = track(id);
    const scene = buildRoadScene(road, look, dressing, { trafficClearanceM: trafficClearanceOf(id) });
    const { probes, drops, open } = openLandEnds(road, new GroundTris(scene.group));
    print(`[examined] ${id}: ${probes} land walks, ${drops} drops looked under, ${open.length} open`);
    scene.dispose();
    expect(probes).toBeGreaterThan(1000);
    expect(drops).toBeGreaterThan(0);
    expect(open).toEqual([]);
  });
  for (const id of TERRAIN) {
    it(`${id}: the strip and its slope meet with no sliver between them`, () => {
      const { road, dressing } = track(id);
      const scene = buildRoadScene(road, look, dressing, { seed: 1 });
      const ground = new GroundTris(scene.group, /^road-land/);
      let walks = 0;
      let steps = 0;
      const holes: string[] = [];
      for (const e of road.edges) {
        const n = Math.max(1, Math.round(e.length / ROW_M));
        for (const side of [-1, 1] as const) {
          const outer = side < 0 ? -e.dMin + 0.6 : e.dMax + 0.6;
          for (let i = 0; i < n; i++) {
            for (const f of [0.3, 0.5, 0.7]) {
              const s = (e.length * (i + f)) / n;
              const r = scene.landReach(e.index, side, s);
              if (r <= 0) continue;
              walks++;
              let a: number | null = null;
              let b: number | null = null;
              // Off the rows' own lines by a few mm, so no ray lands exactly on a shared edge.
              for (let d = outer + Math.max(0, r - 1) + 0.0073; d <= outer + r + 1; d += STEP_M) {
                const p = road.toWorld(e.index, s, side * d, 0);
                const h = ground.heightAt(p.x, p.z, p.y + 60)?.y ?? -Infinity;
                steps++;
                if (a !== null && b !== null && b < Math.min(a, h) - HOLE_M) {
                  holes.push(`${e.id} s ${s.toFixed(1)} side ${side} d ${d.toFixed(2)}`);
                  break;
                }
                a = b;
                b = h;
              }
            }
          }
        }
      }
      print(
        `[examined] ${id}: ${walks} walks across the strip's edge, ${steps} rays down, ${holes.length} holes${holes.length ? ` (first: ${holes.slice(0, 3).join('; ')})` : ''}`,
      );
      expect(walks).toBeGreaterThan(1000);
      expect(holes).toEqual([]);
      scene.dispose();
    });
  }
});
