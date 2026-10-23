import {
  BoxGeometry,
  Frustum,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  loadReplayCamera,
  type CameraPose,
  type CameraTarget,
  type ReplayCameraMode,
} from '../../src/camera';
import { groundUnderOf, raceStructures, type RoadNetwork } from '../../src/road';
import { CAMERA_FAR_M } from '../../src/render';
import {
  describeParts,
  legsOf,
  print,
  ROUTES,
  ROUTE_PACK,
  STILL_DRAWS_MAX,
  STILL_TRIS_MAX,
  stillSceneOf,
  type StillScene,
} from '../../src/render/scene-cost.test-util';

const SEED = 1;
const ASPECTS = [915 / 412, 0.5];
const SHOTS: { mode: ReplayCameraMode; seconds: number[] }[] = [
  { mode: 'trackside', seconds: [0] },
  // Representative absolute playback times, not a full-phase or continuous-bearing sweep.
  { mode: 'orbit', seconds: [0, 10, 20] },
];

interface Cohort {
  network: string;
  pack: string;
  routes: string[];
  edges: Set<string>;
}
const cohorts = new Map<string, Cohort>();
for (const route of ROUTES) {
  const pack = ROUTE_PACK.get(route.id);
  if (!pack) throw new Error(`route ${route.id} has no pack`);
  const key = `${pack}:${route.network}`;
  const cohort: Cohort = cohorts.get(key) ?? {
    network: route.network,
    pack,
    routes: [],
    edges: new Set<string>(),
  };
  cohort.routes.push(route.id);
  for (const leg of legsOf(route)) cohort.edges.add(leg.id);
  cohorts.set(key, cohort);
}
const COHORTS = [...cohorts.values()].sort((a, b) =>
  `${a.pack}:${a.network}`.localeCompare(`${b.pack}:${b.network}`),
);

/** Finite content-derived stations: every edge's ends/middle/tightest bend and actual scenery boundaries. */
function positionsOf(road: RoadNetwork, e: number): number[] {
  const edge = road.edges[e];
  if (!edge) throw new Error(`no edge ${e}`);
  let tightest = 0;
  for (let i = 1; i < edge.kappa.length; i++) {
    if (Math.abs(edge.kappa[i] ?? 0) > Math.abs(edge.kappa[tightest] ?? 0)) tightest = i;
  }
  const stations = [0, edge.length / 2, edge.length, tightest * edge.spacing];
  for (const tag of edge.tags) stations.push(tag.s0, tag.s1);
  for (const feature of edge.features) {
    if (feature.kind === 'landmark' || feature.kind === 'ramp') stations.push(feature.s0, feature.s1);
  }
  return [...new Set(stations.map((s) => Math.max(0, Math.min(edge.length, s))))].sort((a, b) => a - b);
}

function targetAt(road: RoadNetwork, e: number, s: number, dir: 1 | -1): CameraTarget {
  const p = road.toWorld(e, s, 0, 0);
  const f = road.frameAt(e, s);
  return { ...p, heading: Math.atan2(-f.tx * dir, -f.tz * dir), speed: 18, mode: 'Road', road: { edge: e } };
}

function frustumOf(pose: CameraPose, aspect: number): Frustum {
  expect(Object.values(pose).every(Number.isFinite), 'finite returned replay pose').toBe(true);
  const camera = new PerspectiveCamera(pose.fov, aspect, 0.3, CAMERA_FAR_M);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.up.set(pose.upX, pose.upY, pose.upZ);
  camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

/** Uses the existing real-mesh counter, including its visibility, draw ranges and instancing rules. */
function countPose(scene: StillScene, pose: CameraPose, aspect: number, extra?: Object3D) {
  scene.update(pose.x, pose.z, pose.lookX, pose.lookZ);
  const root = scene.roots()[0];
  if (extra && !root) throw new Error('no real scene root for the load control');
  // Attach only after scene update, so incremental builders cannot remove the control. The existing
  // counter sees it through the same mesh/frustum path as every other child, then it is removed.
  if (extra) root?.attach(extra);
  try {
    const parts = scene.count(frustumOf(pose, aspect));
    const total = [...parts.values()].reduce(
      (sum, load) => ({ draws: sum.draws + load.draws, tris: sum.tris + load.tris }),
      { draws: 0, tris: 0 },
    );
    return { parts, total };
  } finally {
    if (extra) root?.remove(extra);
  }
}

describe('actual replay poses in real still scenes, at finite representative road stations', () => {
  it('covers every route-derived network and allowed edge without a fixed content inventory', () => {
    expect(COHORTS.length).toBeGreaterThan(0);
    expect(COHORTS.flatMap((c) => c.routes).sort()).toEqual(ROUTES.map((r) => r.id).sort());
    // stillSceneOf's network-id lookup must never silently select another pack's same-named network.
    expect(new Set(COHORTS.map((c) => c.network)).size).toBe(COHORTS.length);
    for (const c of COHORTS) {
      const expected = new Set(
        ROUTES.filter((r) => r.network === c.network && ROUTE_PACK.get(r.id) === c.pack).flatMap((r) => [
          ...r.mainPath,
          ...r.allowedRoads,
        ]),
      );
      expect([...c.edges].sort()).toEqual([...expected].sort());
    }
  });

  for (const cohort of COHORTS) {
    it(`${cohort.pack}:${cohort.network}: returned trackside/orbit poses stay within the existing still share`, async () => {
      const { createReplayCamera } = await loadReplayCamera();
      const { road, scene } = await stillSceneOf(cohort.network, SEED);
      const structures = raceStructures(road, SEED);
      const under = groundUnderOf(road);
      // Same conservative highest-known-land/road query as the app. An overhead deck can force follow.
      const groundHeightAt = (x: number, z: number) => under(x, z, Infinity);
      const rig = createReplayCamera({ road });
      const peaks = new Map<
        string,
        {
          draws: ReturnType<typeof countPose> & { at: string };
          tris: ReturnType<typeof countPose> & { at: string };
          views: number;
        }
      >();
      const visited = new Set<string>();
      let positions = 0;
      let views = 0;
      for (const id of [...cohort.edges].sort()) {
        const e = road.edgeIndex(id);
        const stations = positionsOf(road, e);
        visited.add(id);
        positions += stations.length;
        for (const s of stations)
          for (const dir of [1, -1] as const)
            for (const aspect of ASPECTS) {
              const target = targetAt(road, e, s, dir);
              for (const { mode, seconds } of SHOTS)
                for (const time of seconds) {
                  const pose = rig.pose(target, time, mode, { structures, groundHeightAt, aspect });
                  const count = countPose(scene, pose, aspect);
                  const at = `${id}@${s.toFixed(2)} dir=${dir} ${mode} time=${time}s aspect=${aspect.toFixed(3)}`;
                  const key = `${mode}/${aspect}`;
                  const peak = peaks.get(key);
                  const shot = { ...count, at };
                  peaks.set(key, {
                    draws: !peak || count.total.draws > peak.draws.total.draws ? shot : peak.draws,
                    tris: !peak || count.total.tris > peak.tris.total.tris ? shot : peak.tris,
                    views: (peak?.views ?? 0) + 1,
                  });
                  views++;
                }
            }
      }
      expect([...visited].sort()).toEqual([...cohort.edges].sort());
      print(
        `[examined] replay ${cohort.pack}:${cohort.network}: ${visited.size} allowed edges, ${positions} finite stations, ${views} actual poses; centre line, both directions; representative times/aspects, not all positions/phases`,
      );
      for (const { mode } of SHOTS)
        for (const aspect of ASPECTS) {
          const peak = peaks.get(`${mode}/${aspect}`);
          expect(peak, `${cohort.network}: missing ${mode}/${aspect}`).toBeDefined();
          if (!peak) throw new Error('missing replay cost group');
          const drawsAt = `${cohort.network} ${peak.draws.at}: ${describeParts(peak.draws.parts, 'draws')}`;
          const trisAt = `${cohort.network} ${peak.tris.at}: ${describeParts(peak.tris.parts, 'tris')}`;
          print(
            `[examined] replay ${mode} aspect=${aspect.toFixed(3)}: ${peak.views} poses; draw peak ${peak.draws.total.draws} (${STILL_DRAWS_MAX - peak.draws.total.draws} headroom) at ${drawsAt}; triangle peak ${Math.round(peak.tris.total.tris)} (${STILL_TRIS_MAX - Math.round(peak.tris.total.tris)} headroom) at ${trisAt}`,
          );
          expect(peak.draws.total.draws, drawsAt).toBeLessThanOrEqual(STILL_DRAWS_MAX);
          expect(peak.tris.total.tris, trisAt).toBeLessThanOrEqual(STILL_TRIS_MAX);
        }
    });
  }

  it('heavy-load control: actual generated replay frusta count an over-budget mesh on-axis and miss it behind the eye', async () => {
    const first = COHORTS[0];
    if (!first) throw new Error('no route-derived scene');
    const { createReplayCamera } = await loadReplayCamera();
    const { road, scene } = await stillSceneOf(first.network, SEED);
    const id = [...first.edges].sort()[0];
    if (!id) throw new Error('no route-derived edge');
    const e = road.edgeIndex(id);
    const edge = road.edges[e];
    if (!edge) throw new Error('no physical edge');
    const structures = raceStructures(road, SEED);
    const under = groundUnderOf(road);
    const rig = createReplayCamera({ road });
    const geometry = new BoxGeometry(4, 4, 4, 250, 150, 1);
    const material = new MeshBasicMaterial();
    const heavy = new Mesh(geometry, material);
    heavy.name = 'replay-heavy-control';
    const triangles = (geometry.index?.count ?? 0) / 3;
    expect(triangles).toBeGreaterThan(STILL_TRIS_MAX);
    try {
      for (const { mode } of SHOTS)
        for (const aspect of ASPECTS) {
          const pose = rig.pose(targetAt(road, e, edge.length / 2, 1), 10, mode, {
            structures,
            aspect,
            groundHeightAt: (x, z) => under(x, z, Infinity),
          });
          const eye = new Vector3(pose.x, pose.y, pose.z);
          const axis = new Vector3(pose.lookX, pose.lookY, pose.lookZ).sub(eye).normalize();
          heavy.position.copy(eye).addScaledVector(axis, 20);
          heavy.updateMatrixWorld(true);
          expect(frustumOf(pose, aspect).intersectsObject(heavy)).toBe(true);
          const hit = countPose(scene, pose, aspect, heavy);
          expect([...hit.parts.keys()].some((key) => key.endsWith(`/${heavy.name}`))).toBe(true);
          expect(hit.total.tris).toBeGreaterThan(STILL_TRIS_MAX);
          heavy.position.copy(eye).addScaledVector(axis, -20);
          heavy.updateMatrixWorld(true);
          expect(frustumOf(pose, aspect).intersectsObject(heavy)).toBe(false);
          const miss = countPose(scene, pose, aspect, heavy);
          expect([...miss.parts.keys()].some((key) => key.endsWith(`/${heavy.name}`))).toBe(false);
          expect(hit.total.tris - miss.total.tris).toBe(triangles);
          print(
            `[examined] replay control ${mode} aspect=${aspect.toFixed(3)}: ${triangles} injected triangles; on-axis ${Math.round(hit.total.tris)}, behind-eye ${Math.round(miss.total.tris)}`,
          );
        }
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });
});
