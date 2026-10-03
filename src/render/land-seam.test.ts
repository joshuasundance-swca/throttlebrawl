// The land strip and its slope meet with no gap (run W-S: "the 1 to 2 px land seam at the Twin
// Peaks junction"; PR #304 left "a 1 to 2 px light seam line ... between the bank and the hill",
// cause unverified, because rays that went through it met ground further down). The cause: the
// terrain skirt's slope kept every third row, its top edge too, so on a bend its chords cut inside
// the strip's edge and opened a sliver between the strip and the slope, through which the flat
// ground far below (or the sky) showed. The checks walk across the strip's edge on every terrain
// network, in 2 cm steps between the land's own rows (where a chord strays furthest), reading the
// drawn land straight down: the ground there never drops into a hole and comes back up.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { GroundTris } from './land-probe.test-util';
import { createFlatLook } from './look';
import { buildRoadScene, type RoadDressing } from './road-mesh';

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
