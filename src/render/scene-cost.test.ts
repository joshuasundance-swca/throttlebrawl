// The still scene's cost along every route, as the renderer would draw it (run W-S: the perf
// re-baseline found up to 108 of 120 draw calls and 133k of 150k triangles; the off-road ground band
// took the Keys frame from about 68k to 116k triangles, and the old instanced scenery cost 21 to 41
// draw calls a view). Each route's real road scene, roadside, ground band and (San Francisco)
// downtown, Chinatown and North Beach and (run W-U) waterfront are built with the real Blender models; a chase camera rides the route's main path every
// 25 m, and every mesh the renderer would draw from there (visible, and inside the camera's
// frustum, as three.js culls) is counted. The still scene must leave the riders, the traffic, the
// cops and the effects their share of the frame budget (tests/perf/budget.json).
// Playtest 3 (T11.3): the camera also rides every branch (a road the route allows off its main path:
// a shortcut, a junction's other arm, the Seven Mile Bridge's old road), because a rider, a rival or
// a cop who takes one sees that scene too, and a new real route (Duval, Seven Mile, Lombard, the
// Golden Gate, Portland) is covered the moment its route file lands, with no list to edit here.
import {
  Frustum,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { BlocksLayer, hasBlocks } from './chinatown-northbeach';
import { DowntownLayer, hasDowntown } from './downtown';
import { hasMission, MissionLayer } from './mission';
import { CAMERA_FAR_M } from './index';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { modelKindsFor, type ModelKind, type SceneryModels } from './models';
import { hasPnwPlaces, PnwPlacesLayer } from './pnw-places';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import { KITS, kitFor, RoadsideLayer } from './roadside';
import { SCENERY_LOD_M } from './scenery-merge';
import { RENDER_TUNING } from './tuning';
import { VergeLayer } from './verge';
import { hasWaterfront, WaterfrontLayer } from './waterfront';

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
interface Route {
  id: string;
  network: string;
  mainPath: string[];
  allowedRoads: string[];
}
const routeFiles = import.meta.glob<Route>('../../packs/*/regions/*/routes/*.json', {
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

async function modelsFor(road: RoadNetwork, dressing: RoadDressing): Promise<SceneryModels> {
  const { tropical, tags } = networkTags(road, dressing);
  const kinds = modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
  const out: SceneryModels = {};
  for (const k of kinds) {
    // As the game loads it: from the pack that carries it, with its region atlas (T12.4: the downtown's
    // stacked towers draw with San Francisco's).
    out[k] = await bakeRepoModel(k);
  }
  return out;
}

interface Load {
  draws: number;
  tris: number;
}

function drawn(root: Object3D, frustum: Frustum, into: Map<string, Load>): void {
  root.updateMatrixWorld(true);
  const walk = (o: Object3D, label: string) => {
    if (!o.visible) return;
    if (o instanceof Mesh) {
      const g = (o as Mesh<BufferGeometry>).geometry;
      const range = g.drawRange.count;
      const full = g.index ? g.index.count : g.getAttribute('position').count;
      const n = Math.min(full, Number.isFinite(range) ? range : full);
      const inst = o instanceof InstancedMesh ? o.count : 1;
      if (inst > 0 && n > 0) {
        if (o instanceof InstancedMesh && o.boundingSphere === null) o.computeBoundingSphere();
        if (!o.frustumCulled || frustum.intersectsObject(o)) {
          const key = `${label}/${o.name}`;
          const l = into.get(key) ?? { draws: 0, tris: 0 };
          l.draws++;
          l.tris += (n / 3) * inst;
          into.set(key, l);
        }
      }
    }
    for (const c of o.children) walk(c, label);
  };
  walk(root, root.name);
}

/** The roads the camera rides for a route: the main path, then each allowed road off it. */
function legsOf(route: Route): { id: string; main: boolean }[] {
  const onMain = new Set(route.mainPath);
  return [
    ...route.mainPath.map((id) => ({ id, main: true })),
    ...route.allowedRoads.filter((id) => !onMain.has(id)).map((id) => ({ id, main: false })),
  ];
}

const ROUTES = Object.values(routeFiles);
const DRAW_M = RENDER_TUNING.find((d) => d.id === 'render.sceneryDrawM')?.default ?? 360;
const LOD_M = RENDER_TUNING.find((d) => d.id === 'render.sceneryLodM')?.default ?? SCENERY_LOD_M;
/**
 * The still scene's share of the frame (tests/perf/budget.json: 120 draw calls, 150k triangles).
 * [default] It leaves 40 draw calls and 40k triangles for what moves: the perf probe's busiest
 * checkpoint before run W-S drew 90 calls and 116k triangles with 49 movers on screen.
 */
const STILL_DRAWS_MAX = 80;
const STILL_TRIS_MAX = 110_000;

describe('the still scene along every route', () => {
  for (const route of ROUTES) {
    it(`${route.id}: inside its share of the draw-call and triangle budget`, async () => {
      const { road, dressing } = track(route.network);
      const models = await modelsFor(road, dressing);
      const seed = 1;
      const rs = buildRoadScene(road, look, dressing, { seed, models, roadsideDensity: 1 });
      const { tropical, tags } = networkTags(road, dressing);
      const needed = modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
      const kind = kitFor(needed, models) as ModelKind | null;
      const kitModel = kind ? models[kind] : undefined;
      const kit = kind ? KITS[kind] : undefined;
      const roadside =
        kitModel && kit
          ? new RoadsideLayer(kitModel, look, {
              road,
              dressing,
              seed,
              density: 1,
              kit,
              landReach: (e, side, s) => rs.landReach(e, side, s),
              spots: rs.spots,
              // The kits a rule draws from besides its own (Key West's Old Town, playtest 3).
              models,
            })
          : null;
      if (roadside) for (let i = 0; i < 2000 && !roadside.ready; i++) roadside.update(1e9, 1e9, 360);
      const verge = new VergeLayer(road, look, { tags });
      const dt =
        models.sfDowntown && hasDowntown(tags)
          ? new DowntownLayer(
              models.sfDowntown,
              models.sfRoadside,
              models.cableCar,
              look,
              { road, dressing, seed },
              // The stacked towers (playtest 3, T12.4), as the renderer passes them.
              models.sfTowerModules,
            )
          : null;
      // Run W-U: San Francisco's waterfront.
      const wf = hasWaterfront(tags) ? new WaterfrontLayer(models, look, { road, dressing, seed }) : null;
      // Run W-U: the Pacific Northwest's places (the ferry, the clear-cut, the Stump Social).
      const places = hasPnwPlaces(tags)
        ? new PnwPlacesLayer(look, { road, seed, landReach: (e, side, s) => rs.landReach(e, side, s) })
        : null;
      // Run W-U: San Francisco's Chinatown and North Beach (a code-made kit, no models).
      const blocks = hasBlocks(tags) ? new BlocksLayer(look, { road, dressing, seed }) : null;
      // Run W-U: San Francisco's mural alleys, the crew halfway through the race.
      const mission = hasMission(tags)
        ? new MissionLayer(models.sfRoadside, look, { road, dressing, seed })
        : null;
      const cam = new PerspectiveCamera(70, 915 / 412, 0.3, CAMERA_FAR_M);
      let worst: { at: string; total: Load; parts: Map<string, Load> } | null = null;
      let maxDraws = 0;
      let sumDraws = 0;
      let sumTris = 0;
      let poses = 0;
      let prev: { x: number; z: number } | null = null;
      // The main path first, each road ridden the way the route runs; then each branch road, once,
      // in its own direction (the roads' order in the route file).
      const legs = legsOf(route);
      let branchPoses = 0;
      for (const { id, main } of legs) {
        const e = road.edgeIndex(id);
        const edge = road.edges[e]!;
        const a = road.toWorld(e, 0, 0, 0);
        const b = road.toWorld(e, edge.length, 0, 0);
        const fwd: boolean =
          !main || !prev || Math.hypot(a.x - prev.x, a.z - prev.z) <= Math.hypot(b.x - prev.x, b.z - prev.z);
        for (let u = 10; u < edge.length - 10; u += 25) {
          const s = fwd ? u : edge.length - u;
          const dir = fwd ? 1 : -1;
          const rider = road.toWorld(e, s, 0, 0);
          const eye = road.toWorld(e, Math.max(0, Math.min(edge.length, s - 7 * dir)), 0, 2.6);
          const aim = road.toWorld(e, Math.max(0, Math.min(edge.length, s + 18 * dir)), 0, 0.9);
          eye.y = Math.max(eye.y, rider.y + 2.6);
          cam.position.set(eye.x, eye.y, eye.z);
          cam.lookAt(aim.x, aim.y, aim.z);
          cam.updateMatrixWorld(true);
          cam.updateProjectionMatrix();
          rs.update(eye.x, eye.z, 0, DRAW_M, LOD_M, Infinity);
          if (roadside) for (let i = 0; i < 12; i++) roadside.update(eye.x, eye.z, DRAW_M);
          verge.update(eye.x, eye.z, null, 0, aim.x, aim.z);
          dt?.update(eye.x, eye.z, 0, []);
          // Everything near enough is built at once here (the renderer builds one a frame).
          wf?.update(eye.x, eye.z, LOD_M, undefined, 1000);
          places?.update(eye.x, eye.z, DRAW_M, LOD_M, Infinity);
          // The blocks build one mesh a frame: as many frames as a ride to here would have had.
          if (blocks) for (let i = 0; i < 30; i++) blocks.update(eye.x, eye.z);
          if (mission) for (let i = 0; i < 8; i++) mission.update(eye.x, eye.z, 0, 0.5);
          const frustum = new Frustum().setFromProjectionMatrix(
            new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
          );
          const parts = new Map<string, Load>();
          drawn(rs.group, frustum, parts);
          if (roadside) drawn(roadside.group, frustum, parts);
          drawn(verge.group, frustum, parts);
          if (dt) drawn(dt.group, frustum, parts);
          if (wf) drawn(wf.group, frustum, parts);
          if (places) drawn(places.group, frustum, parts);
          if (blocks) drawn(blocks.group, frustum, parts);
          if (mission) drawn(mission.group, frustum, parts);
          const total = [...parts.values()].reduce(
            (t, l) => ({ draws: t.draws + l.draws, tris: t.tris + l.tris }),
            {
              draws: 0,
              tris: 0,
            },
          );
          if (!worst || total.tris > worst.total.tris) worst = { at: `${id}@${s.toFixed(0)}`, total, parts };
          maxDraws = Math.max(maxDraws, total.draws);
          sumDraws += total.draws;
          sumTris += total.tris;
          poses++;
          if (!main) branchPoses++;
        }
        if (main) prev = fwd ? b : a;
      }
      if (!worst) throw new Error('no poses');
      const byPart = [...worst.parts.entries()]
        .sort((x, y) => y[1].tris - x[1].tris)
        .slice(0, 8)
        .map(([k, l]) => `${k.split('/')[1]}:${l.draws}d/${Math.round(l.tris)}t`)
        .join(' ');
      print(
        `[examined] ${route.id}: ${poses} views; ${branchPoses} on branches; draw calls max ${maxDraws} mean ${(sumDraws / poses).toFixed(1)}; triangles max ${Math.round(worst.total.tris)} mean ${Math.round(sumTris / poses)} | the most at ${worst.at}: ${byPart}`,
      );
      expect(poses).toBeGreaterThan(20);
      expect(maxDraws).toBeLessThanOrEqual(STILL_DRAWS_MAX);
      expect(worst.total.tris).toBeLessThanOrEqual(STILL_TRIS_MAX);
    }, 120_000);
  }
});

describe('the branch checkpoints', () => {
  it('cover every road each route allows, each one a road of the route network', () => {
    let branches = 0;
    let ridable = 0;
    for (const route of ROUTES) {
      const { road } = track(route.network);
      for (const { id, main } of legsOf(route)) {
        const edge = road.edges[road.edgeIndex(id)];
        expect(edge, `${route.id}: ${id} is not a road of ${route.network}`).toBeDefined();
        if (!main) {
          branches++;
          if ((edge?.length ?? 0) >= 45) ridable++;
        }
      }
    }
    print(
      `[examined] branch checkpoints: ${branches} branch roads over ${ROUTES.length} routes, ${ridable} long enough to ride`,
    );
    // The Key West Boulevard shortcut and its like: if this reads zero, the legs are not being built.
    expect(ridable).toBeGreaterThan(0);
  });
});
