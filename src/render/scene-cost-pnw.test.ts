// The still scene along every Pacific Northwest route, at its peak view (scene-cost.test.ts says how and why; the
// sweep is scene-cost.test-util.ts, split by pack so CI runs the three files side by side).
import { Frustum, Matrix4, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA_FAR_M } from './index';
import {
  CINEMATIC_CAMERA,
  cameraParams,
  checkRoute,
  print,
  ROUTES,
  routesOf,
  stillSceneOf,
  sweep,
} from './scene-cost.test-util';

describe('the still scene along every Pacific Northwest route, at its peak view', () => {
  for (const route of routesOf('region-pnw')) {
    it(
      `${route.id}: inside its share of the draw-call and triangle budget`,
      () => checkRoute(route),
      300_000,
    );
  }
});

describe("the sweep covers the frame that cost Bridge City 112 of its 120 draw calls (polish G's check)", () => {
  // Historical camera before the 2026-10-10 forward change, seed 3, Broadway South, tick 5472:
  // the takedown framing three seconds after the player's takedown, standing 9 m
  // behind the rider and aimed down a side street. The pose is what a headless replay of that seed gives the camera
  // rig (the live frame's camera stood at x -568.18, y 28.74, z 237.10); the world is the pack's own road data.
  const EYE = { x: -568.2, y: 28.8, z: 237.0 };
  const AIM = { x: -563.9, y: 25.9, z: 236.0 };
  const FOV = 61;

  it('draws more from that historical pose than the road-facing views, and the retained safety envelope reaches it', async () => {
    const c = await cameraParams();
    const { road, scene } = await stillSceneOf('osm-pnw-portland', 3);
    const e = road.edgeIndex('osm-pnw-pdx-broadway-south');
    // Ride up to it, as the renderer did (the layers build a stretch a frame).
    for (let s = 150; s <= 234; s += 4) {
      const p = road.toWorld(e, s, 2, 2.6);
      scene.update(p.x, p.z);
    }
    scene.update(EYE.x, EYE.z, AIM.x, AIM.z);
    const cam = new PerspectiveCamera(FOV, 915 / 412, 0.3, CAMERA_FAR_M);
    cam.position.set(EYE.x, EYE.y, EYE.z);
    cam.lookAt(AIM.x, AIM.y, AIM.z);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
    let pose = 0;
    for (const l of scene.count(frustum).values()) pose += l.draws;

    const base = ROUTES.find((r) => r.id === 'osm-bridge-city-run');
    if (!base) throw new Error('no Bridge City route');
    const road1 = {
      ...base,
      mainPath: ['osm-pnw-pdx-broadway-south'],
      allowedRoads: ['osm-pnw-pdx-broadway-south'],
    };
    const r = sweep(road, scene, road1, c, { step: 2, bothWays: true, cinematic: true });
    const old = Math.max(...[...r.drawsByCamera].filter(([k]) => k !== CINEMATIC_CAMERA).map(([, v]) => v));
    const aimed = r.drawsByCamera.get(CINEMATIC_CAMERA) ?? 0;
    print(
      `[examined] Bridge City, Broadway South, both ways every 2 m: the frame's pose draws ${pose} still calls; ` +
        `the normal and current forward takedown views peak ${old}; the historical all-around safety envelope peaks ${aimed}`,
    );
    // Road-facing views do not cover this hazard; retaining the historical envelope is an extra safety check.
    expect(pose - old).toBeGreaterThanOrEqual(5);
    // The aims are eight bearings apart and the poses every 2 m: close, not exact.
    expect(aimed).toBeGreaterThanOrEqual(pose - 4);
  }, 300_000);
});
