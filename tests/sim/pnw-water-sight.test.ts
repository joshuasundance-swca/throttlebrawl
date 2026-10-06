// The Pacific Northwest's water from the chase camera (the maintainer's playtest 4 answers, 2026-10-06, and run C's
// fix check). It lives in tests/ because the camera and the render module may not import each other.
// - Chuckanut Drive: "Thin it on Chuckanut: a longer, lighter haze on that drive only, so the sea below the cliff
//   shows. The rest of the region keeps its misty mood." From the bluff the bay first shows a few hundred metres out,
//   and with the region's haze full at 480 m most of what shows of it was the haze's colour. Asked: along the bay
//   side, of the bay the chase camera shows, a good share is less than half hazed with the haze the road's data
//   gives it; with the region's 480 m (the control) it is not.
// - Lake Samish (run C's fix check, punch item 5: "From the default chase camera, the lake is still a pale band beyond
//   the cabins, in rain, at s 938 to 2638"). The lake is a backdrop floor above the sea, and the backdrop hazed it by
//   straight distance from the camera, from 0 m, while three's fog on the land round it starts at 220 m and goes by
//   view depth: at 150 m the lake was 0.23 haze and the bank beside it clear. Asked: along East Shore Drive, most
//   of the lake the chase camera shows is less than half hazed now; with the old law and the region's haze (the
//   control) it was not; and the water round each nearer dock is clear, where the old law hazed it.
// The drizzle is a screen overlay over everything alike (rain.ts); it is not modelled here.
import { InstancedMesh, Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../../src/road';
import { createFlatLook } from '../../src/render';
import type { BackdropNetworkFile, BackdropRegionFile, FloorPiece } from '../../src/render/backdrop/data';
import { buildBackdrop, roadPointsOf } from '../../src/render/backdrop/builder';
import { geoFrame } from '../../src/render/backdrop/geo';
import { insideRing, waterAtOf, waterFloors } from '../../src/render/backdrop/water';
import { hazeFarAt, thinHazeSpans } from '../../src/render/haze';
import { bakeRepoModel } from '../../src/render/model-files.test-util';
import { modelKindsFor, type SceneryModels } from '../../src/render/models';
import { buildRoadScene, networkTags, type RoadDressing } from '../../src/render/road-mesh';
import { PNW_KIT, scatterRoadside } from '../../src/render/roadside';
import { defaultRenderParams } from '../../src/render/tuning';
import { PHONE } from './chase-sight.test-util';
import {
  chaseCamera,
  FOG_NEAR_M,
  floorsOf,
  shoot,
  waterHaze,
  type Floors,
  type LakeLaw,
  type Shot,
} from './water-sight.test-util';

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
const regionFiles = import.meta.glob<BackdropRegionFile>(
  '../../packs/region-pnw/assets/backdrop/*/region.json',
  {
    eager: true,
    import: 'default',
  },
);
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const params = defaultRenderParams();
const region = Object.values(regionFiles)[0]!;
const look = createFlatLook();
/** The bot's speed, and where it rides: the lane nearer the water (the right-hand side of these roads). */
const SPEED_MPS = 38;
const LANE_D = 1.7;
/** A ray every this many px of the phone's 915 x 412 screen. */
const STEP_PX = 14;

function track(id: string) {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = network.roads.map((r) => Object.values(roadFiles).find((f) => f.id === r)!);
  const road: RoadNetwork = createRoadNetwork({ network, roads });
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  const file = Object.values(backdropFiles).find((f) => f.network === id);
  if (!file) throw new Error(`no backdrop for ${id}`);
  const floors = waterFloors(file);
  const waterAt = floors.length ? waterAtOf(floors) : undefined;
  return { road, dressing, file, waterAt };
}

/** The road scene a race on `seed` builds, and its meshes (the land, the road, the sea). */
function roadScene(t: ReturnType<typeof track>, seed: number, models: SceneryModels = {}) {
  const scene = buildRoadScene(t.road, look, t.dressing, {
    seed,
    models,
    roadsideDensity: 1,
    ...(t.waterAt ? { waterAt: t.waterAt } : {}),
  });
  scene.group.updateMatrixWorld(true);
  const near: Object3D[] = [];
  scene.group.traverse((o) => {
    if (o instanceof Mesh && !(o instanceof InstancedMesh)) near.push(o);
  });
  return { scene, near };
}

/** The road scene (seed 3) and the backdrop's floors. */
function world(t: ReturnType<typeof track>, models: SceneryModels = {}) {
  const built = buildBackdrop(region, t.file, roadPointsOf(t.road.edges), 3);
  return { ...roadScene(t, 3, models), floors: floorsOf(built) };
}

interface Tally {
  px: number;
  clear: number;
}
const share = (t: Tally) => (t.px ? t.clear / t.px : 0);

describe("Chuckanut's bay from the chase camera: the haze thins on that drive (the maintainer, 2026-10-06)", () => {
  const t = track('osm-pnw-chuckanut');
  const w = world(t);
  const geo = geoFrame(t.file.originLatDeg, t.file.originLonDeg);
  const bay = region.pieces.find((p) => p.id === 'bellingham-bay') as FloorPiece | undefined;
  if (!bay) throw new Error('no bellingham-bay');
  const bayRing = bay.area.map(([a, b]) => geo.toWorld(a, b));
  const isBay = (p: Vector3, flag: number) => flag < 1.5 && insideRing(bayRing, p.x, p.z);
  const spans = thinHazeSpans(t.road);

  /** Every 150 m along the bay side's drop (the `bay-bluff` runs, on the right), from 40 m into each run. */
  const stations: { edge: number; s: number; id: string }[] = [];
  for (const e of t.road.edges)
    for (const tag of e.tags)
      if (tag.tag === 'bay-bluff')
        for (let s = tag.s0 + 40; s < tag.s1; s += 150) stations.push({ edge: e.index, s, id: e.id });
  const shots: Shot[] = stations.map((st) =>
    shoot(t.road, st.edge, st.s, LANE_D, SPEED_MPS, w.near, w.floors, STEP_PX),
  );

  it('the bay reads as water along the drop: with the road’s haze, a good share of it under half hazed; with the region’s 480 m, not', () => {
    const thin: Tally = { px: 0, clear: 0 };
    const control: Tally = { px: 0, clear: 0 };
    const firsts: string[] = [];
    let firstUnderStart = 0;
    let worse = 0;
    stations.forEach((st, k) => {
      const far = hazeFarAt(spans, st.edge, st.s, params);
      expect(far, `${st.id} s ${st.s}: the road's data thins the haze here`).toBe(params.thinHazeFarM);
      const tally = (fogFar: number, into: Tally) => {
        const water = shots[k]!.pixels.map((p) =>
          waterHaze(p, shots[k]!, w.floors, region, fogFar, 'now', isBay),
        ).filter((x) => x !== null);
        into.px += water.length;
        const clear = water.filter((x) => x.haze < 0.5).length;
        into.clear += clear;
        return { water, clear };
      };
      const a = tally(far, thin);
      const b = tally(params.regionFogFarM, control);
      if (a.clear < b.clear) worse++;
      const first = [...a.water].sort((x, y) => x.depth - y.depth)[0];
      if (first) {
        if (first.depth < FOG_NEAR_M) firstUnderStart++;
        firsts.push(`${first.depth.toFixed(0)}`);
      }
    });
    print(
      `${stations.length} stations along Chuckanut's bay-bluff runs, a ray every ${STEP_PX} px: of ${thin.px} bay pixels, ${thin.clear} (${(100 * share(thin)).toFixed(0)} %) under half haze with the road's ${params.thinHazeFarM} m; ${control.clear} of ${control.px} (${(100 * share(control)).toFixed(0)} %) with the region's ${params.regionFogFarM} m (the control)`,
    );
    print(
      `the nearest bay pixel's view depth per station (m): ${firsts.join(', ')}; ${firstUnderStart} of ${firsts.length} nearer than the fog's start (${FOG_NEAR_M} m), so not hazed at all with either haze`,
    );
    expect(thin.px).toBeGreaterThan(stations.length * 50);
    expect(share(control)).toBeLessThan(0.29);
    expect(share(thin)).toBeGreaterThan(0.34);
    expect(worse).toBe(0);
  });
});

describe('Lake Samish from the chase camera: the lake takes the fog the land beside it takes (run C fix check, punch 5)', async () => {
  const t = track('osm-pnw-samish');
  const shore = t.road.edges.find((e) => e.id === 'osm-samish-east-shore')!;
  const { tropical, tags } = networkTags(t.road, t.dressing);
  const models: SceneryModels = {};
  for (const k of modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] }))
    models[k] = await bakeRepoModel(k);
  const w = world(t, models);
  const spans = thinHazeSpans(t.road);
  const isLake = (_p: Vector3, flag: number) => flag > 1.5;

  /** Run C's check saw the pale band from s 938 to 2638: every 150 m from 900 to 2700. */
  const stations: number[] = [];
  for (let s = 900; s <= 2700; s += 150) stations.push(s);
  const shots = stations.map((s) =>
    shoot(t.road, shore.index, s, LANE_D, SPEED_MPS, w.near, w.floors, STEP_PX),
  );

  it('most of the lake the chase camera shows is under half hazed; with the old lake law and the region’s 480 m (the control), little is', () => {
    const variants: { name: string; law: LakeLaw; far: (s: number) => number }[] = [
      { name: 'old law, 480 m (the control)', law: 'then', far: () => params.regionFogFarM },
      { name: 'old law, the road’s haze', law: 'then', far: (s) => hazeFarAt(spans, shore.index, s, params) },
      { name: 'new law, 480 m', law: 'now', far: () => params.regionFogFarM },
      {
        name: 'new law, the road’s haze (as built)',
        law: 'now',
        far: (s) => hazeFarAt(spans, shore.index, s, params),
      },
    ];
    const out = variants.map((v) => {
      const tally: Tally = { px: 0, clear: 0 };
      stations.forEach((s, k) => {
        const water = shots[k]!.pixels.map((p) =>
          waterHaze(p, shots[k]!, w.floors, region, v.far(s), v.law, isLake),
        ).filter((x) => x !== null);
        tally.px += water.length;
        tally.clear += water.filter((x) => x.haze < 0.5).length;
      });
      return { ...v, tally };
    });
    print(
      `${stations.length} stations on East Shore Drive s 900 to 2700, a ray every ${STEP_PX} px; lake pixels under half haze: ${out.map((o) => `${o.name}: ${o.tally.clear} of ${o.tally.px} (${(100 * share(o.tally)).toFixed(0)} %)`).join('; ')}`,
    );
    expect(hazeFarAt(spans, shore.index, 1200, params)).toBe(params.thinHazeFarM);
    expect(out[0]!.tally.px).toBeGreaterThan(stations.length * 30);
    expect(share(out[0]!.tally)).toBeLessThan(0.5);
    expect(share(out[3]!.tally)).toBeGreaterThan(0.75);
  });

  it('the nearer docks read as the rider comes up to them: in frame, in sight over the bank, wide, against clear water (the old law hazed it)', () => {
    let docks = 0;
    let read = 0;
    let hazedThen = 0;
    const rows: string[] = [];
    for (const seed of [2, 3, 4]) {
      const { scene, near } = seed === 3 ? w : roadScene(t, seed, models);
      const ground = near.filter((o) => /^road-land/.test(o.name)) as Mesh[];
      const items = scatterRoadside({
        road: t.road,
        dressing: t.dressing,
        seed,
        density: 1,
        kit: PNW_KIT,
        landReach: (e, side, s) => scene.landReach(e, side, s),
        landTop: (e, side, s, a) => scene.landTop(e, side, s, a),
        spots: scene.spots,
        models,
        ...(t.waterAt ? { waterAt: t.waterAt } : {}),
      });
      for (const d of items.filter((i) => i.rule === 'lake-dock' && i.edge === shore.index)) {
        docks++;
        // The dock runs 14 m out from its root at the shore, along its -Z; its deck stands 0.55 m over the water.
        const dir = { x: Math.sin(d.turn + Math.PI), z: Math.cos(d.turn + Math.PI) };
        const level = t.waterAt?.(d.p.x, d.p.z) ?? d.p.y;
        const at = (m: number, up: number) => new Vector3(d.p.x + dir.x * m, level + up, d.p.z + dir.z * m);
        const deck = [2, 6, 10, 13].map((m) => at(m, 0.55));
        // The water it is seen against: the lake 4 m past its end.
        const water = at(18, -0.5);
        let best: string | null = null;
        let then: number | null = null;
        // As the rider comes up to it: the chase camera from 50 m before it to 20 m before it.
        for (let back = 50; back >= 20; back -= 5) {
          const camera = chaseCamera(t.road, d.edge, Math.max(0, d.s - back), LANE_D, SPEED_MPS);
          const shot: Shot = { camera, pixels: [] };
          if (back === 30) then = lakeHazeAt(w.floors, shot, water, params.regionFogFarM, 'then');
          if (best) continue;
          const ndc = deck.map((p) => p.clone().project(camera));
          const inFrame = ndc.every((n) => Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && n.z < 1);
          const widthPx =
            ((Math.max(...ndc.map((n) => n.x)) - Math.min(...ndc.map((n) => n.x))) / 2) * PHONE.width;
          const seen = deck.filter((p) => clearOf(ground, camera.position, p)).length;
          const now = lakeHazeAt(w.floors, shot, water, hazeFarAt(spans, d.edge, d.s, params), 'now');
          if (inFrame && seen >= 2 && widthPx >= 40 && now !== null && now < 0.1)
            best = `${back} m before, ${seen}/4 in sight, ${widthPx.toFixed(0)} px, water ${now.toFixed(2)}`;
        }
        if (best) read++;
        if (then !== null && then >= 0.2) hazedThen++;
        rows.push(`seed ${seed} s ${d.s.toFixed(0)}: ${best ?? 'NOT READ'} (old law ${then?.toFixed(2)})`);
      }
    }
    print(`East Shore Drive's docks from the chase camera, 50 to 20 m before each: ${rows.join('; ')}`);
    print(
      `${read} of ${docks} docks on 3 seeds read; the water behind ${hazedThen} of them was 0.2 haze or more with the old lake law and 480 m (the control)`,
    );
    expect(docks).toBeGreaterThan(30);
    expect(read / docks).toBeGreaterThan(0.9);
    expect(hazedThen / docks).toBeGreaterThan(0.6);
  });
});

/** Whether the line from the camera to p clears the drawn land (a ray toward p meets no land before it). */
function clearOf(ground: readonly Mesh[], from: Vector3, p: Vector3): boolean {
  const dir = p.clone().sub(from);
  const ray = new Raycaster(from, dir.clone().normalize(), 0.05, dir.length() - 0.05);
  return ray.intersectObjects(ground as Mesh[], false).length === 0;
}

/** The lake's haze at a world point seen from the shot's camera, under a law (null: no lake there). */
function lakeHazeAt(floors: Floors, shot: Shot, p: Vector3, fogFar: number, law: LakeLaw): number | null {
  const down = new Raycaster(new Vector3(p.x, p.y + 50, p.z), new Vector3(0, -1, 0));
  const hit = down.intersectObject(floors.mesh, false).find((h) => floors.at(h.face!.a).flag > 1.5);
  if (!hit || !hit.face || !hit.barycoord) return null;
  const depth = -hit.point.clone().applyMatrix4(shot.camera.matrixWorldInverse).z;
  const r = waterHaze(
    {
      near: null,
      floor: {
        depth,
        point: hit.point,
        face: [hit.face.a, hit.face.b, hit.face.c],
        w: [hit.barycoord.x, hit.barycoord.y, hit.barycoord.z],
      },
    },
    shot,
    floors,
    region,
    fogFar,
    law,
    () => true,
  );
  return r?.haze ?? null;
}
