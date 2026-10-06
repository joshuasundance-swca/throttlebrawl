import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFollowCamera, type CameraPose, type CameraTarget } from './index';
import {
  nearestFocus,
  shotFociOf,
  shotPose,
  SHOT_EASE_TICKS,
  SHOT_REACH_M,
  type ShotFocus,
} from './finish-shot';

// Playtest 4, run C's live check: "Coit Tower is never seen whole: the Lombard finish comes before the tower, so
// only its base shows at the top of the frame". The tower stands at its real place, 25 m from the finish and 64 m
// tall; no chase camera that follows the road can fit it (its top is 57 degrees up), so the finish is a shot: when
// the player crosses the line near a landmark that asks for it (`params.frameHeightM`), the camera holds where it
// is and turns up to the landmark for the two seconds before the results (the shot is the camera's, not the
// sim's: nothing in a replay or a hash reads it).
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<{ id: string; finish: { road: string; s: number } }>(
  '../../packs/region-sf/regions/*/routes/*.json',
  { eager: true, import: 'default' },
);

function track(id: string): RoadNetwork {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  return createRoadNetwork({ network, roads });
}

const PHONE = 915 / 412;
const WIDE = 16 / 9;
const DT = 1 / 60;
const SPEED = 38; // m/s, a fast finish (the FOV kick is full from 38)

/** Where a point lands in a render camera built from a pose, as render builds it: NDC x and y, and whether it is ahead. */
function ndc(pose: CameraPose, aspect: number, p: { x: number; y: number; z: number }) {
  const cam = new PerspectiveCamera(pose.fov, aspect, 0.3, 1500);
  cam.position.set(pose.x, pose.y, pose.z);
  cam.up.set(pose.upX, pose.upY, pose.upZ);
  cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  cam.updateMatrixWorld(true);
  const local = new Vector3(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
  const n = new Vector3(p.x, p.y, p.z).project(cam);
  return { x: n.x, y: n.y, ahead: local.z < 0 };
}

/** The tower as the player sees it: the base, the top, and the top's two sides. */
function seen(pose: CameraPose, aspect: number, f: ShotFocus) {
  const pts = [
    ndc(pose, aspect, { x: f.x, y: f.y, z: f.z }),
    ndc(pose, aspect, { x: f.x, y: f.y + f.heightM, z: f.z }),
  ];
  const worst = Math.max(...pts.flatMap((q) => [Math.abs(q.x), Math.abs(q.y)]));
  return { worst, ahead: pts.every((q) => q.ahead), top: pts[1]!, base: pts[0]! };
}

/** The Lombard finish as the race has it: the route's own finish point, the camera settled on the approach. */
function atTheLine(aspect: number) {
  const road = track('osm-sf-lombard');
  const route = Object.values(routeFiles).find((r) => r.id === 'osm-sf-lombard-run');
  if (!route) throw new Error('no Lombard route');
  const edge = road.edgeIndex(route.finish.road);
  const foci = shotFociOf(road);
  const cam = createFollowCamera({ road });
  cam.setShakeAmount(0);
  const target = (s: number): CameraTarget => {
    const w = road.toWorld(edge, s, 1.7, 0);
    const f = road.frameAt(edge, s);
    return {
      id: 4,
      x: w.x,
      y: w.y,
      z: w.z,
      heading: Math.atan2(-f.tx, -f.tz),
      speed: SPEED,
      lean: 0,
      road: { edge },
    };
  };
  const s0 = route.finish.s - 120;
  cam.snap(target(s0), { aspect });
  let live = cam.update(target(s0), DT, { aspect });
  // The ride in: the rider covers 120 m at 38 m/s; the first frame after the line holds the shot's start.
  const frames = Math.ceil((120 / SPEED) * 60) + 1;
  for (let n = 1; n <= frames; n++) live = cam.update(target(s0 + (SPEED * n) / 60), DT, { aspect });
  return { road, foci, live, finishM: road.toWorld(edge, route.finish.s, 1.7, 0) };
}

describe("the finish shot: the player's finish near a landmark that asks for it frames the whole landmark", () => {
  it('finds exactly one landmark that asks for it in San Francisco, Coit Tower, on the Lombard network', () => {
    const found: string[] = [];
    for (const n of Object.values(networkFiles)) {
      for (const f of shotFociOf(track(n.id))) found.push(`${n.id} ${f.heightM}`);
    }
    expect(found).toEqual(['osm-sf-lombard 64']);
  });

  it.each([
    ['a phone held sideways', PHONE],
    ['a 16:9 screen', WIDE],
  ])(
    'control: the chase camera at the line, on %s, cuts the tower off (the run C finding)',
    (_name, aspect) => {
      const { foci, live } = atTheLine(aspect);
      const view = seen(live, aspect, foci[0]!);
      stdout.write(
        `[examined] chase camera at the Lombard line, aspect ${aspect.toFixed(2)}: the tower's top at NDC y ${view.top.y.toFixed(2)} (the frame ends at 1)\n`,
      );
      expect(view.top.y).toBeGreaterThan(1);
    },
  );

  it.each([
    ['a phone held sideways', PHONE],
    ['a 16:9 screen', WIDE],
  ])(
    'on %s the whole tower, base to top, stands inside the frame from the end of the ease to the results',
    (_name, aspect) => {
      const { foci, live, finishM } = atTheLine(aspect);
      const focus = nearestFocus(foci, finishM.x, finishM.z, SHOT_REACH_M);
      expect(focus, 'the finish is within reach of the tower').not.toBeNull();
      if (!focus) return;
      let worstOverall = 0;
      // The shot's own ticks: 0 is the first frame after the line, the beat is 2 s (120 ticks) to the results.
      for (let tick = SHOT_EASE_TICKS; tick <= 120; tick += 8) {
        const pose = shotPose(live, focus, aspect, tick / SHOT_EASE_TICKS);
        const view = seen(pose, aspect, focus);
        worstOverall = Math.max(worstOverall, view.worst);
        expect(view.ahead, `tick ${tick}: ahead of the camera`).toBe(true);
        expect(
          view.worst,
          `tick ${tick}: the farthest of the tower's top and base from the frame's middle`,
        ).toBeLessThan(0.95);
      }
      stdout.write(
        `[examined] finish shot, aspect ${aspect.toFixed(2)}: the tower's base and top within ${worstOverall.toFixed(2)} of the frame's middle (1 is its edge) over the beat, FOV ${shotPose(live, focus, aspect, 1).fov.toFixed(0)} from ${live.fov.toFixed(0)}\n`,
      );
    },
  );

  it('starts as the chase camera is (no jump) and eases to the shot, never moving the camera itself', () => {
    const { foci, live, finishM } = atTheLine(PHONE);
    const focus = nearestFocus(foci, finishM.x, finishM.z, SHOT_REACH_M)!;
    const start = shotPose(live, focus, PHONE, 0);
    expect(start).toEqual(live);
    for (const w of [0.25, 0.5, 1, 4]) {
      const p = shotPose(live, focus, PHONE, w);
      expect([p.x, p.y, p.z]).toEqual([live.x, live.y, live.z]);
    }
    // Between the two the frame moves steadily toward the shot: the top climbs into the frame without overshooting.
    const tops = [0, 0.25, 0.5, 0.75, 1].map(
      (w) => seen(shotPose(live, focus, PHONE, w), PHONE, focus).top.y,
    );
    for (let i = 1; i < tops.length; i++) expect(tops[i]!).toBeLessThanOrEqual(tops[i - 1]! + 1e-9);
  });

  it('is for a finish near the landmark only: the reach is 90 m, and a finish farther off has no shot', () => {
    const { foci, finishM } = atTheLine(PHONE);
    expect(nearestFocus(foci, finishM.x, finishM.z, SHOT_REACH_M)).not.toBeNull();
    // A finish at the start of the boulevard (about 150 m away) or on the flats (1 km) gets none.
    const far = { x: foci[0]!.x + 400, z: foci[0]!.z };
    expect(nearestFocus(foci, far.x, far.z, SHOT_REACH_M)).toBeNull();
    expect(nearestFocus([], finishM.x, finishM.z, SHOT_REACH_M)).toBeNull();
  });
});
