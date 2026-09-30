// Per-chunk road meshes (M2: the road lane's longer road, draft #109, waits on this). The road used
// to be one merged mesh per material spanning the whole network, which the renderer can never
// cull: every triangle of a 7 km road was drawn every frame. Now the static road is merged per
// square chunk of the world (docs/architecture.md, "Performance budgets": merged static geometry
// per chunk), so what the camera cannot see is culled, and the cost of a frame stops growing with
// the length of the road. Checked the way three.js culls: each mesh's bounding sphere against the
// camera's frustum.
import {
  Fog,
  Frustum,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Scene,
  type BufferGeometry,
  type Group,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import { CAMERA_FAR_M } from './index';
import { createFlatLook, MIN_THREAT_DRAW_M } from './look';
import { buildRoadScene, ROAD_CHUNK_M } from './road-mesh';

const look = createFlatLook();

/** A long wandering road of `n` 400 m edges, gentle alternating bends. */
function longRoad(n: number): RoadNetwork {
  return createRoadNetwork(
    fixtureNetwork(
      Array.from({ length: n }, (_, i) => ({ id: `e${i}`, lengthM: 400, kappa: i % 2 ? 0.0015 : -0.001 })),
    ),
  );
}

/** The chase camera near the start of edge 0, as render builds it (fov 62, far 1500 or less). */
function startCamera(road: RoadNetwork, far: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(62, 915 / 412, 0.3, far);
  const eye = road.toWorld(0, 20, 2, 2.6);
  const at = road.toWorld(0, 45, 2, 1);
  cam.position.set(eye.x, eye.y, eye.z);
  cam.lookAt(at.x, at.y, at.z);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

interface Load {
  meshes: number;
  triangles: number;
}

/** What three.js would draw of the road group from this camera (frustum-culled), and the whole. */
function drawn(group: Group, cam: PerspectiveCamera): { seen: Load; all: Load } {
  group.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
  );
  const seen = { meshes: 0, triangles: 0 };
  const all = { meshes: 0, triangles: 0 };
  group.traverse((o: Object3D) => {
    if (!(o instanceof Mesh)) return;
    const g = (o as Mesh<BufferGeometry>).geometry;
    const tris =
      ((g.index ? g.index.count : g.getAttribute('position').count) / 3) *
      (o instanceof InstancedMesh ? o.count : 1);
    all.meshes++;
    all.triangles += tris;
    if (!o.frustumCulled || frustum.intersectsObject(o)) {
      seen.meshes++;
      seen.triangles += tris;
    }
  });
  return { seen, all };
}

describe('per-chunk road meshes', () => {
  it("keeps a frame's road cost flat however long the road is", () => {
    const short = buildRoadScene(longRoad(9), look).group; // 3.6 km
    const long = buildRoadScene(longRoad(30), look).group; // 12 km
    const a = drawn(short, startCamera(longRoad(9), 1500));
    const b = drawn(long, startCamera(longRoad(30), 1500));
    console.log(
      `[examined] 3.6 km road: ${a.seen.triangles} of ${a.all.triangles} triangles in view (${a.seen.meshes} meshes); ` +
        `12 km road: ${b.seen.triangles} of ${b.all.triangles} (${b.seen.meshes} meshes)`,
    );
    expect(b.all.triangles).toBeGreaterThan(a.all.triangles * 3);
    expect(b.seen.triangles).toBeLessThanOrEqual(a.seen.triangles * 1.1);
    expect(b.seen.triangles).toBeLessThan(b.all.triangles * 0.4);
  });

  it('culls most of the real track from the start line', () => {
    const roads = Object.values(roadFiles);
    const network = Object.values(networkFiles).find((n) =>
      n.roads.every((id) => roads.some((r) => r.id === id)),
    );
    if (!network) throw new Error('no baked network');
    const road = createRoadNetwork({ network, roads: roads.filter((r) => network.roads.includes(r.id)) });
    const { seen, all } = drawn(buildRoadScene(road, look).group, startCamera(road, 1500));
    console.log(
      `[examined] real track from the start: ${seen.triangles} of ${all.triangles} triangles in view`,
    );
    expect(seen.triangles).toBeLessThan(all.triangles * 0.8);
  });

  it("sets the camera's far plane past the fog's end, so culling there hides nothing visible", () => {
    for (const timeOfDay of ['dawn', 'noon', 'golden-hour', 'dusk', 'night']) {
      const scene = new Scene();
      look.setupScene(scene, { timeOfDay });
      const fog = scene.fog as Fog;
      expect(CAMERA_FAR_M, timeOfDay).toBeGreaterThanOrEqual(fog.far);
    }
    expect(CAMERA_FAR_M).toBeGreaterThan(MIN_THREAT_DRAW_M);
  });

  it('merges each chunk separately: no static road mesh spans much more than one chunk', () => {
    const { group } = buildRoadScene(longRoad(30), look);
    let worst = 0;
    group.traverse((o) => {
      if (!(o instanceof Mesh) || o.name === 'road-water') return;
      const g = (o as Mesh<BufferGeometry>).geometry;
      g.computeBoundingSphere();
      if (o instanceof InstancedMesh) o.computeBoundingSphere();
      const r =
        o instanceof InstancedMesh ? (o.boundingSphere?.radius ?? 0) : (g.boundingSphere?.radius ?? 0);
      worst = Math.max(worst, r);
    });
    // A chunk's half-diagonal, plus a little for strips that end just past the line.
    expect(worst).toBeLessThan(ROAD_CHUNK_M * Math.SQRT1_2 + 30);
  });
});

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
