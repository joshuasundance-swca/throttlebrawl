// Lake Samish's water and docks can be seen from the road (playtest 4 run C's live check, punch item 6: "no dock
// showed in 7 frames along the lake stretches of East Shore Drive"; the lake "barely reads"). The cause is the
// drop: the lake's land was a 20 m plateau at the road's height with a sheer drop at its edge, and the water lies
// 3.7 to 9.6 m below East Shore Drive (3DEP: the lake's surface at 82.85 m). A camera 3.2 m (the low chase) or
// 4.8 m (the far chase) over the road looks over the edge of a plateau 20 m out and sees the water only from 40 to
// 70 m past it: no water and no dock on it showed. The lake's land is now a bank to the water: the verge's own
// 4.2 m at the road's height (the sim's soft grass is ridable there), a short wall, then a flat shore at the water's
// level where the cabins stand and the docks run out (road-mesh.ts, `waterAt`).
//
// The checks are lines of sight, from the cameras the game frames a rider with (camera/index.ts: the low chase 7 m
// behind and 2.6 + 0.6 m up on a phone, the far chase 11 m behind and 4.2 + 0.6 m up), against the land the scene
// draws, with the plateau (the same road built without its water: the control) read the same way.
import { Mesh, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import type { BackdropNetworkFile } from './backdrop/data';
import { waterAtOf, waterFloors } from './backdrop/water';
import { GroundTris, openLandEnds } from './land-probe.test-util';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { modelKindsFor, type SceneryModels } from './models';
import { buildRoadScene, networkTags, type RoadDressing, type RoadScene } from './road-mesh';
import { PNW_KIT, scatterRoadside, type RoadsideItem } from './roadside';
import { LAKE_BANK_M, LAKE_LAND_M, LAKE_SHORE_OVER_M, LAND_TOP_M } from './scenery';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const backdropFiles = import.meta.glob<BackdropNetworkFile>(
  '../../packs/region-pnw/assets/backdrop/*/networks/*.json',
  { eager: true, import: 'default' },
);

const VERGE_M = 0.6;
/** The cameras' pose behind the rider and over the road, the phone's (camera/index.ts defaults + the wide view's lift). */
const CAMERAS = [
  { name: 'low chase', back: 7, up: 3.2 },
  { name: 'far chase', back: 11, up: 4.8 },
] as const;
const SEEDS = [2, 3, 4];

const network = Object.values(networkFiles).find((n) => n.id === 'osm-pnw-samish')!;
const roads: BakedRoad[] = network.roads.map((r) => Object.values(roadFiles).find((f) => f.id === r)!);
const road: RoadNetwork = createRoadNetwork({ network, roads });
const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
const file = Object.values(backdropFiles).find((f) => f.network === 'osm-pnw-samish')!;
const waterAt = waterAtOf(waterFloors(file));
const shore = road.edges.find((e) => e.id === 'osm-samish-east-shore')!;
/** East Shore Drive's lake spans (the baked `lake` tags, on its right). */
const lakeSpans = shore.tags.filter((t) => t.tag === 'lake');

async function models(): Promise<SceneryModels> {
  const { tropical, tags } = networkTags(road, dressing);
  const out: SceneryModels = {};
  for (const k of modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] }))
    out[k] = await bakeRepoModel(k);
  return out;
}

interface Built {
  scene: RoadScene;
  ground: GroundTris;
  items: RoadsideItem[];
}
/** The race as the game builds it: the road scene (with the lake's water, or without it: the control) and its roadside. */
function build(seed: number, withWater: boolean, kit: SceneryModels): Built {
  const scene = buildRoadScene(road, look, dressing, {
    seed,
    models: kit,
    roadsideDensity: 1,
    ...(withWater ? { waterAt } : {}),
  });
  const items = scatterRoadside({
    road,
    dressing,
    seed,
    density: 1,
    kit: PNW_KIT,
    landReach: (e, side, s) => scene.landReach(e, side, s),
    ...(withWater
      ? { landTop: (e: number, side: -1 | 1, s: number, a: number) => scene.landTop(e, side, s, a) }
      : {}),
    spots: scene.spots,
    models: kit,
    waterAt,
  });
  return { scene, ground: new GroundTris(scene.group, /^road-land/), items };
}

/** Whether the line from `from` to `to` clears the drawn land (the ground under the line, below 6 m over it, is under it). */
function clear(
  ground: GroundTris,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): boolean {
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const n = Math.ceil(len / 0.5);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const p = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t,
    };
    const h = ground.heightAt(p.x, p.z, p.y + 6);
    if (h && h.y > p.y + 0.02) return false;
  }
  return true;
}

/** The camera's position when the rider is at s (in the lake side's lane), and the world point `across` m past the verge. */
const eyeAt = (s: number, cam: (typeof CAMERAS)[number]) => {
  const p = road.toWorld(shore.index, Math.max(0, s - cam.back), shore.dMax * 0.5, 0);
  return { x: p.x, y: p.y + cam.up, z: p.z };
};
const outerOf = shore.dMax + VERGE_M;
const waterPoint = (s: number, across: number) => {
  const p = road.toWorld(shore.index, s, outerOf + across, 0);
  const y = waterAt(p.x, p.z);
  return y === null ? null : { x: p.x, y, z: p.z };
};

/**
 * The roadside zones of East Shore Drive (the sim stands pedestrians on a patch of land at the road's height there:
 * road-mesh.ts, the land under the zones), with their taper: the patch lies over the bank, so the bank is read away from them.
 */
const zones = (
  (dressing[shore.id] as unknown as { features?: { kind: string; s0: number; s1: number }[] }).features ?? []
)
  .filter((f) => f.kind === 'roadsideZone')
  .map((f) => [f.s0 - 15, f.s1 + 15] as const);
/** Stations well inside the lake spans, every `step` m, off the pedestrian zones. */
function stations(step: number): number[] {
  const out: number[] = [];
  for (const t of lakeSpans)
    for (let s = t.s0 + 30; s <= t.s1 - 40; s += step)
      if (!zones.some(([a, b]) => s >= a && s <= b)) out.push(s);
  return out;
}

describe('the lake from the road: the bank, the water and the docks (playtest 4 run C, punch item 6)', async () => {
  const kit = await models();
  const wet = build(3, true, kit);
  const control = build(3, false, kit);

  it('the lake spans are East Shore Drive s 890 to 1595 and 2590 to 2940, on its right (the bake)', () => {
    expect(lakeSpans.map((t) => [Math.round(t.s0), Math.round(t.s1), t.side])).toEqual([
      [890, 1595, 'right'],
      [2590, 2940, 'right'],
    ]);
  });

  it('the water is in sight from the road: from either chase camera, 28 and 38 m past the verge, not only from 40 to 70 m out', () => {
    const seen = (b: Built) => {
      let ok = 0;
      let all = 0;
      for (const cam of CAMERAS)
        for (const s of stations(20))
          // The water 8 and 18 m past the shore (the shore is 20 m past the verge), a little ahead of the rider. The
          // deepest bank (9 m) hides the first metres from the low camera, as any wall does.
          for (const across of [LAKE_LAND_M + 8, LAKE_LAND_M + 18]) {
            const w = waterPoint(s + 15, across);
            if (!w) continue;
            all++;
            if (clear(b.ground, eyeAt(s, cam), w)) ok++;
          }
      return { ok, all };
    };
    const a = seen(wet);
    const c = seen(control);
    print(
      `[examined] lines of sight from the low and far chase cameras to the water 28 and 38 m past the verge, ${a.all} of them along East Shore Drive's lake spans: ${a.ok} clear with the bank, ${c.ok} of ${c.all} over the old plateau`,
    );
    // The control: the plateau hides it (the probe can see a hidden shore).
    expect(c.ok / c.all).toBeLessThan(0.1);
    expect(a.ok / a.all).toBeGreaterThan(0.9);
  });

  it('every dock can be seen from the far chase view some way before it, and the plateau hid them', () => {
    const seen = (b: Built) => {
      const docks = b.items.filter((i) => i.rule === 'lake-dock');
      let ok = 0;
      for (const d of docks) {
        // The dock runs out from its root (at the shore) along its -Z: 14 m. Its deck stands 0.55 m over the water.
        const out = { x: Math.sin(d.turn + Math.PI), z: Math.cos(d.turn + Math.PI) };
        const water = waterAt(d.p.x, d.p.z) ?? d.p.y;
        const at = (m: number) => ({ x: d.p.x + out.x * m, y: water + 0.55, z: d.p.z + out.z * m });
        const cam = CAMERAS[1];
        let found = false;
        for (let back = 8; back <= 70 && !found; back += 4)
          found = [4, 12].every((m) => clear(b.ground, eyeAt(d.s - back + cam.back, cam), at(m)));
        if (found) ok++;
      }
      return { ok, docks: docks.length };
    };
    const a = seen(wet);
    const c = seen(control);
    print(
      `[examined] seed 3: ${a.docks} docks with the bank, ${a.ok} seen (4 and 12 m out along the dock) from the far chase view within 70 m before them; ${c.docks} docks over the old plateau, ${c.ok} seen`,
    );
    expect(a.docks).toBeGreaterThan(6);
    expect(a.ok).toBe(a.docks);
    expect(c.ok).toBeLessThan(c.docks * 0.5);
  });

  it('a dock stands on every stretch of the lake: no gap of more than 170 m (the pedestrian zone is 110), on either span, on any of three seeds', () => {
    const gaps: string[] = [];
    let counted = 0;
    for (const seed of SEEDS) {
      const { items } = build(seed, true, kit);
      const docks = items.filter((i) => i.rule === 'lake-dock' && i.edge === shore.index).map((i) => i.s);
      for (const t of lakeSpans) {
        const at = [t.s0, ...docks.filter((s) => s >= t.s0 && s <= t.s1).sort((a, b) => a - b), t.s1];
        counted += at.length - 2;
        for (let k = 1; k < at.length; k++)
          if (at[k]! - at[k - 1]! > 170)
            gaps.push(
              `seed ${seed}: ${at[k - 1]!.toFixed(0)}..${at[k]!.toFixed(0)} (${(at[k]! - at[k - 1]!).toFixed(0)} m)`,
            );
      }
    }
    print(
      `[examined] ${counted} docks on 2 lake spans over 3 seeds; gaps over 170 m: ${gaps.length ? gaps.join('; ') : 'none'}`,
    );
    expect(gaps).toEqual([]);
  });

  it("the bank: the verge's 4.2 m at the road's height, then a flat shore at the water's level, wall between, no hole", () => {
    let rows = 0;
    const bad: string[] = [];
    for (const s of stations(10)) {
      const road0 = road.toWorld(shore.index, s, 0, 0).y;
      const w = waterPoint(s, LAKE_LAND_M - 2);
      if (!w) continue;
      rows++;
      for (let a = 0.5; a <= LAKE_LAND_M - 0.5; a += 1) {
        const p = road.toWorld(shore.index, s, outerOf + a, 0);
        const h = wet.ground.heightAt(p.x, p.z, road0 + 6);
        if (!h) {
          bad.push(`s ${s} across ${a}: no ground`);
          continue;
        }
        if (a <= LAKE_BANK_M - 0.3) {
          if (Math.abs(h.y - (road0 + LAND_TOP_M)) > 0.05)
            bad.push(`s ${s} across ${a}: ${h.y.toFixed(2)} not the road's`);
        } else if (a >= LAKE_BANK_M + 0.5) {
          // The shore: the same flat level all along, a hand over the water.
          if (Math.abs(h.y - (w.y + LAKE_SHORE_OVER_M)) > 0.05)
            bad.push(
              `s ${s} across ${a}: ${h.y.toFixed(2)} not the shore's ${(w.y + LAKE_SHORE_OVER_M).toFixed(2)}`,
            );
        }
      }
    }
    print(
      `[examined] ${rows} stations along the lake spans, the land read 0.5 to 19.5 m past the verge every metre: ${bad.length ? bad.slice(0, 4).join('; ') : 'the road level to 3.9 m, the shore level from 4.7 m'}`,
    );
    expect(rows).toBeGreaterThan(60);
    expect(bad).toEqual([]);
    // The plateau (control): the road's height all the way out.
    const s = stations(10)[10]!;
    const p = road.toWorld(shore.index, s, outerOf + 12, 0);
    expect(control.ground.heightAt(p.x, p.z, p.y + 6)!.y).toBeCloseTo(p.y + LAND_TOP_M, 1);
  });

  it("the land closes: no plate ends in mid-air along any road of the network (the land probes' own controls fire on broken land: tests/sim/geometry-land.test.ts)", () => {
    const bank = openLandEnds(road, new GroundTris(wet.scene.group));
    print(
      `[examined] ${bank.probes} land walks (2 to 60 m past the verge, every 2 m of every road of the network): ${bank.open.length} plates end in the air`,
    );
    expect(bank.probes).toBeGreaterThan(60_000);
    expect(bank.open).toEqual([]);
  });

  it('the wall is there: from the shore, a line toward the road at half the wall comes to ground, and with the wall taken out it does not', () => {
    const closed = (ground: GroundTris) => {
      let probes = 0;
      let open = 0;
      for (const s of stations(10)) {
        const w = waterPoint(s, LAKE_LAND_M - 2);
        const plateau = road.toWorld(shore.index, s, outerOf + LAKE_BANK_M, LAND_TOP_M).y;
        if (!w || plateau - (w.y + LAKE_SHORE_OVER_M) < 1) continue;
        const mid = (plateau + w.y + LAKE_SHORE_OVER_M) / 2;
        const from = road.toWorld(shore.index, s, outerOf + LAKE_BANK_M + 6, 0);
        const to = road.toWorld(shore.index, s, outerOf + LAKE_BANK_M, 0);
        probes++;
        const hit = ground.firstHit(
          new Vector3(from.x, mid, from.z),
          new Vector3(to.x - from.x, 0, to.z - from.z),
          8,
        );
        if (hit === null || hit > 7) open++;
      }
      return { probes, open };
    };
    const a = closed(wet.ground);
    // The control: the same scene with every near-vertical face on the wall's line taken out.
    const broken = build(3, true, kit).scene;
    const at = stations(5).map((s) => road.toWorld(shore.index, s, outerOf + LAKE_BANK_M, 0));
    broken.group.updateMatrixWorld(true);
    let removed = 0;
    broken.group.traverse((o) => {
      if (!(o instanceof Mesh) || !/^road-land/.test(o.name)) return;
      const geo = o.geometry as BufferGeometry;
      const pos = geo.getAttribute('position');
      const index = geo.getIndex();
      const keep: number[] = [];
      const v = [new Vector3(), new Vector3(), new Vector3()];
      const tris = index ? index.count / 3 : pos.count / 3;
      for (let t = 0; t < tris; t++) {
        const ids = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
        ids.forEach((id, k) => v[k]!.fromBufferAttribute(pos, id).applyMatrix4(o.matrixWorld));
        const n = v[1]!.clone().sub(v[0]!).cross(v[2]!.clone().sub(v[0]!)).normalize();
        const cx = (v[0]!.x + v[1]!.x + v[2]!.x) / 3;
        const cz = (v[0]!.z + v[1]!.z + v[2]!.z) / 3;
        if (Math.abs(n.y) < 0.2 && at.some((p) => Math.hypot(p.x - cx, p.z - cz) < 1.6)) removed++;
        else keep.push(...ids);
      }
      const next = geo.clone();
      next.setIndex(keep);
      o.geometry = next;
    });
    const b = closed(new GroundTris(broken.group, /^road-land/));
    broken.dispose();
    print(
      `[examined] ${a.probes} lines from the shore toward the road, at half the wall's height, where it stands over 1 m: ${a.open} pass through the wall; with its ${removed} faces taken out, ${b.open} of ${b.probes}`,
    );
    expect(a.probes).toBeGreaterThan(40);
    expect(a.open).toBe(0);
    expect(b.open).toBe(b.probes);
  });

  it("the wall faces the shore: seen from the cabins and the docks, not from the road, and stands at the verge land's end", () => {
    const tris = wet.ground.triangles().filter((t) => {
      const n = t.b.clone().sub(t.a).cross(t.c.clone().sub(t.a)).normalize();
      return Math.abs(n.y) < 0.2;
    });
    let walls = 0;
    const wrong: string[] = [];
    for (const s of stations(30)) {
      const centre = road.toWorld(shore.index, s, 0, 0);
      const out = road.toWorld(shore.index, s, 1, 0);
      const toLake = { x: out.x - centre.x, z: out.z - centre.z };
      const at = road.toWorld(shore.index, s, outerOf + LAKE_BANK_M, 0);
      const mine = tris.filter(
        (t) => Math.hypot((t.a.x + t.b.x + t.c.x) / 3 - at.x, (t.a.z + t.b.z + t.c.z) / 3 - at.z) < 1.6,
      );
      for (const t of mine) {
        walls++;
        const n = t.b.clone().sub(t.a).cross(t.c.clone().sub(t.a)).normalize();
        if (n.x * toLake.x + n.z * toLake.z <= 0) wrong.push(`s ${s}`);
      }
    }
    print(
      `[examined] ${walls} wall faces at the verge land's end along the lake spans: ${wrong.length} face the road`,
    );
    expect(walls).toBeGreaterThan(30);
    expect(wrong).toEqual([]);
  });

  it('the cabins stand on the shore, at its level, wholly past the wall', () => {
    const cabins = wet.items.filter((i) => i.rule === 'lake-cabin');
    expect(cabins.length).toBeGreaterThan(3);
    for (const c of cabins) {
      const side = c.d < 0 ? -1 : 1;
      const across = Math.abs(c.d) - outerOf;
      // The porch is 1.5 m before the anchor: it is past the wall too.
      expect(across - 1.5).toBeGreaterThan(LAKE_BANK_M);
      const water = waterAt(c.p.x, c.p.z);
      expect(water).not.toBeNull();
      expect(c.p.y).toBeCloseTo(water! + LAKE_SHORE_OVER_M, 2);
      expect(wet.scene.landTop(c.edge, side, c.s, across)).toBeCloseTo(water! + LAKE_SHORE_OVER_M, 2);
    }
  });
});
