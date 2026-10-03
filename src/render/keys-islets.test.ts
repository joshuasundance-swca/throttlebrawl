// Islands off every Keys bridge (run W-Q, distinct keys; playtest 2: "Maybe islands in the Keys";
// the brief: "islands are visible off every bridge"). The checks build the real networks from their
// road files with the real islet GLB: from anywhere on any Keys bridge an islet is in draw range,
// every islet floats on open water clear of every road and its land, the scatter follows the seed,
// and no islet floats off a road that is not tropical.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { readGlb } from './glb';
import { createFlatLook } from './look';
import { bakeModel, MODEL_ASSETS, modelKindsFor } from './models';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import { ISLET_SINK_M, type SideTag, type ScenerySpot } from './scenery';
import { RENDER_TUNING } from './tuning';

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

async function islets() {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const buf = fs.readFileSync(`packs/base/assets/${MODEL_ASSETS.keysIslets}.glb`);
  return bakeModel(
    'keysIslets',
    readGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer),
  );
}
const model = await islets();
const look = createFlatLook();
const DRAW_M = RENDER_TUNING.find((d) => d.id === 'render.sceneryDrawM')?.default ?? 360;

const KEYS = ['keys-m1', 'osm-keys-bahia-honda'];

describe('islets off every Keys bridge', () => {
  it('bakes four islets, each sunk to its waterline, with an island and something on it', () => {
    expect(model.variants.length).toBe(4);
    for (const g of model.variants) {
      g.computeBoundingBox();
      const box = g.boundingBox!;
      expect(box.min.y).toBeCloseTo(0, 2);
      expect(box.max.y - ISLET_SINK_M).toBeGreaterThan(4);
    }
  });

  for (const id of KEYS) {
    it(`${id}: an islet is in draw range from every point of every bridge, on open water`, () => {
      const { road, dressing } = track(id);
      const tagsOf = (edge: number) => (dressing[road.edges[edge]!.id]?.tags ?? []) as readonly SideTag[];
      const bridges = road.edges.filter((e) => tagsOf(e.index).some((t) => t.tag === 'bridge'));
      expect(bridges.length).toBeGreaterThan(0);
      for (const seed of [1, 7, 42]) {
        const scene = buildRoadScene(road, look, dressing, { seed, models: { keysIslets: model } });
        const mine = scene.spots.filter((s) => s.kind === 'islet');
        // From every 25 m of every bridge, an islet within the scenery's draw distance.
        let worst = 0;
        let samples = 0;
        let draws = 0;
        for (const e of bridges)
          for (let s = 0; s <= e.length; s += 25) {
            const c = road.toWorld(e.index, s, 0, 0);
            const near = Math.min(...mine.map((m) => Math.hypot(m.p.x - c.x, m.p.z - c.z)));
            worst = Math.max(worst, near);
            samples++;
            // What it costs: the islets merge into the still scenery's blocks (run W-S), so they
            // add no draw call of their own; the blocks the scene shows from here, islets or not.
            scene.update(c.x, c.z, 0, DRAW_M, undefined, Infinity);
            let own = 0;
            scene.group.traverse((o) => {
              if (o.name === 'road-islets') own++;
            });
            expect(own).toBe(0);
            draws = Math.max(draws, scene.merged().meshes);
          }
        // On open water: clear of every road (this one's other stretches too) by its half width, the
        // land it draws on the islet's side there (its strip plus the 4 m shelf), and the islet's own
        // sand (11 m at most, times its size).
        let closest = Infinity;
        for (const m of mine) {
          for (const e of road.edges)
            for (let i = 0; i < e.count; i++) {
              const s = i * e.spacing;
              const f = road.frameAt(e.index, Math.min(e.length, s));
              const d = -(m.p.x - f.x) * f.tz + (m.p.z - f.z) * f.tx;
              const reach = scene.landReach(e.index, d < 0 ? -1 : 1, s);
              const dist = Math.hypot((e.x[i] ?? 0) - m.p.x, (e.z[i] ?? 0) - m.p.z);
              const need = Math.max(-e.dMin, e.dMax) + 0.6 + (reach > 0 ? reach + 4 : 0) + 11 * m.size;
              closest = Math.min(closest, dist - need);
            }
          expect(m.p.y).toBeCloseTo(-ISLET_SINK_M, 5);
        }
        print(
          `[examined] ${id} seed ${seed}: ${mine.length} islets (${variantsOf(mine)}); ${samples} bridge points, ` +
            `farthest from an islet ${worst.toFixed(0)} m (draw ${DRAW_M} m), at most ${draws} merged scenery blocks in range (islets ride in them); closest islet ${closest.toFixed(1)} m clear of any road's land`,
        );
        expect(worst).toBeLessThan(DRAW_M);
        expect(closest).toBeGreaterThan(0);
        // In range, not in view: the camera's frustum culls about half of these again.
        expect(draws).toBeLessThanOrEqual(12);
        scene.dispose();
      }
    });
  }

  it('scatters by the seed, and floats no islet off a road that is not tropical', () => {
    const { road, dressing } = track('keys-m1');
    const at = (seed: number) =>
      buildRoadScene(road, look, dressing, { seed })
        .spots.filter((s) => s.kind === 'islet')
        .map((s) => `${s.edge}:${s.s.toFixed(1)}:${s.d.toFixed(1)}:${s.variant}`);
    expect(at(7)).toEqual(at(7));
    expect(at(7)).not.toEqual(at(8));
    for (const id of ['pnw-c1', 'sf-hills', 'osm-pnw-gorge', 'osm-sf-russian-hill']) {
      const t = track(id);
      const { tropical, tags } = networkTags(t.road, t.dressing);
      expect(modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] }), id).not.toContain(
        'keysIslets',
      );
      const scene = buildRoadScene(t.road, look, t.dressing, { seed: 7 });
      expect(scene.spots.filter((s) => s.kind === 'islet').length, id).toBe(0);
      scene.dispose();
    }
  });
});

function variantsOf(spots: readonly ScenerySpot[]): string {
  const n = [0, 0, 0, 0];
  for (const s of spots) n[s.variant] = (n[s.variant] ?? 0) + 1;
  return `shack ${n[0]}, wreck ${n[1]}, mangrove ${n[2]}, stilts ${n[3]}`;
}
