// The still scene's cost along every route, as the renderer would draw it (run W-S: the perf
// re-baseline found up to 108 of 120 draw calls and 133k of 150k triangles; the off-road ground band
// took the Keys frame from about 68k to 116k triangles, and the old instanced scenery cost 21 to 41
// draw calls a view). Each route's real road scene, roadside, ground band and (San Francisco)
// downtown, Chinatown and North Beach and (run W-U) waterfront are built with the real Blender models,
// and every mesh the renderer would draw from a camera (visible, and inside the camera's frustum, as
// three.js culls) is counted. The still scene must leave the riders, the traffic, the cops and the
// effects their share of the frame budget (tests/perf/budget.json).
// Playtest 3 (T11.3): the camera also rides every branch (a road the route allows off its main path:
// a shortcut, a junction's other arm, the Seven Mile Bridge's old road), because a rider, a rival or
// a cop who takes one sees that scene too, and a new real route (Duval, Seven Mile, Lombard, the
// Golden Gate, Portland) is covered the moment its route file lands, with no list to edit here.
//
// Playtest 4 run B's live check (mustFix 1): two real routes drew frames over the 150,000-triangle
// budget (Russian Hill seed 3 at Hyde Street's crest, 155,074 and 157,058; I-5 by Lake Samish seed 4
// on the lake branch, 153,696 and 158,360), and CI missed it because it looked only at fixed
// checkpoints: a seeded race's three ticks, and here a chase camera every 25 m one way. So this is now
// a sweep for each route's PEAK view:
// - every 5 m of every road the route allows (its main path and each branch), in BOTH directions,
//   because a rider can ride a road either way (a U-turn, a branch taken back, a respawn facing back);
// - from every camera the game frames a rider with, at its widest: the phone-shaped low chase and far
//   chase at the top-speed field of view, the helmet view, the takedown framing swung to either side,
//   and the look-back (camera/index.ts CAMERA_TUNING's defaults, read from that file below);
// - counting the whole still frame: the backdrop (one mesh the renderer never culls), the region's
//   staged scenes, the boards, and the roadside as the renderer builds it (keeping off the scenes'
//   and the landmarks' ground, with a lake's docks at its level).
// The negative control at the end proves the sweep sees an over-budget view that the old checkpoints
// could not. The sweep is shared (scene-cost.test-util.ts) by three files, one per pack's routes, so CI
// runs them side by side: this one (the Keys), scene-cost-sf.test.ts and scene-cost-pnw.test.ts.
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CINEMATIC_CAMERA,
  cameraParams,
  checkRoute,
  legsOf,
  print,
  ROUTE_PACK,
  ROUTES,
  routesOf,
  SAMPLE_M,
  STILL_TRIS_MAX,
  stillSceneOf,
  sweep,
  SWEPT_PACKS,
  track,
} from './scene-cost.test-util';

describe('the still scene along every Keys route, at its peak view', () => {
  for (const route of routesOf('base')) {
    it(
      `${route.id}: inside its share of the draw-call and triangle budget`,
      () => checkRoute(route),
      300_000,
    );
  }
});

describe('the branch checkpoints', () => {
  it('ride every route, in one of the three files', () => {
    const lost = ROUTES.filter(
      (r) => !(SWEPT_PACKS as readonly string[]).includes(ROUTE_PACK.get(r.id) ?? ''),
    );
    expect(lost.map((r) => r.id)).toEqual([]);
    expect(SWEPT_PACKS.map((p) => routesOf(p).length).reduce((a, b) => a + b, 0)).toBe(ROUTES.length);
  });

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

describe('the sweep finds a peak the old checkpoints could not (negative control)', () => {
  it('sees a heavy block standing behind the riders, which only a view back down the road shows', async () => {
    const c = await cameraParams();
    const full = ROUTES.find((r) => r.id === 'osm-seven-mile-run') ?? ROUTES[0]!;
    // Its first road alone, both ways round: the old checkpoints and the sweep each ride it.
    const first = full.mainPath[0]!;
    const route = { ...full, mainPath: [first], allowedRoads: [first] };
    const { road, scene } = await stillSceneOf(route.network, 1);
    // A 150,000-triangle block 40 m behind the start of the main path's first road, seen only by a camera
    // looking back down it: past the frame budget on its own.
    const e = road.edgeIndex(first);
    const p = road.toWorld(e, 0, 0, 0);
    const f = road.frameAt(e, 0);
    const heavy = new Group();
    heavy.name = 'control';
    const box = new BoxGeometry(4, 4, 4, 250, 150, 1);
    const mesh = new Mesh(box, new MeshBasicMaterial());
    mesh.name = 'heavy';
    mesh.position.set(p.x - f.tx * 40, p.y + 2, p.z - f.tz * 40);
    heavy.add(mesh);
    const boxTris = (box.index?.count ?? 0) / 3;
    const before = sweep(road, scene, route, c, {
      step: 25,
      bothWays: false,
      cameras: ['chase'],
      extra: heavy,
    });
    const after = sweep(road, scene, route, c, { step: SAMPLE_M, bothWays: true, extra: heavy });
    print(
      `[examined] control: a ${boxTris}-triangle block 40 m behind ${first}@0; ` +
        `old checkpoints (every 25 m, forward, chase) peak ${Math.round(before.tris.total.tris)} at ${before.tris.at}; ` +
        `the sweep peaks ${Math.round(after.tris.total.tris)} at ${after.tris.at}`,
    );
    expect(boxTris).toBeGreaterThan(STILL_TRIS_MAX);
    // The old checkpoints never look back, so they stay under the share; the sweep sees the block.
    expect(before.tris.total.tris).toBeLessThanOrEqual(STILL_TRIS_MAX);
    expect(after.tris.total.tris).toBeGreaterThan(STILL_TRIS_MAX);
    expect(after.tris.parts.has('control/heavy')).toBe(true);
  }, 300_000);
});

describe('the sweep sees the takedown framing, which no chase view faces (negative control)', () => {
  it('sees a heavy block standing beside the road, which only a takedown aimed across the road shows', async () => {
    const c = await cameraParams();
    const full = ROUTES.find((r) => r.id === 'osm-seven-mile-run') ?? ROUTES[0]!;
    const first = full.mainPath[0]!;
    const route = { ...full, mainPath: [first], allowedRoads: [first] };
    const { road, scene } = await stillSceneOf(route.network, 1);
    // A 150,000-triangle block 70 m to the side of the road and 30 m behind its start, level with the rider: every
    // chase, helmet and look-back view looks along the road and the takedown views look at the rider, so it stands
    // outside their frames; a takedown aimed behind and across the road faces it.
    const e = road.edgeIndex(first);
    const p = road.toWorld(e, 0, 0, 0);
    const f = road.frameAt(e, 0);
    const heavy = new Group();
    heavy.name = 'control';
    const box = new BoxGeometry(4, 4, 4, 250, 150, 1);
    const mesh = new Mesh(box, new MeshBasicMaterial());
    mesh.name = 'heavy';
    mesh.position.set(p.x - f.tx * 30 - f.tz * 70, p.y + 2, p.z - f.tz * 30 + f.tx * 70);
    mesh.lookAt(p.x, p.y + 2, p.z);
    heavy.add(mesh);
    const boxTris = (box.index?.count ?? 0) / 3;
    // From the start line only (a step past the road's length), forward: from further along, the look-back views
    // see the block down the road, as any camera that looks along a road sees what stands near it.
    const without = sweep(road, scene, route, c, { step: 1e6, bothWays: false, extra: heavy });
    const withShots = sweep(road, scene, route, c, {
      step: 1e6,
      bothWays: false,
      cinematic: true,
      extra: heavy,
    });
    print(
      `[examined] control: a ${boxTris}-triangle block 70 m beside and 30 m behind ${first}@0; ` +
        `at the start line the chase, helmet, look-back and takedown views peak ${Math.round(without.tris.total.tris)} at ${without.tris.at}; ` +
        `with the takedown aimed anywhere round the rider the sweep peaks ${Math.round(withShots.tris.total.tris)} at ${withShots.tris.at}`,
    );
    expect(boxTris).toBeGreaterThan(STILL_TRIS_MAX);
    expect(without.tris.total.tris).toBeLessThanOrEqual(STILL_TRIS_MAX);
    expect(withShots.tris.total.tris).toBeGreaterThan(STILL_TRIS_MAX);
    expect(withShots.tris.at).toContain(CINEMATIC_CAMERA);
    expect(withShots.tris.parts.has('control/heavy')).toBe(true);
  }, 300_000);
});
