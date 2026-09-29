// render: the Three.js scene (docs/architecture.md, "Rendering"). The skeleton draws the road as
// ribbons from the road profiles, dashes and posts for a sense of speed, a water plane, and every
// rider as two boxes, interpolated between snapshots. WebGL2 straight to the canvas with a
// device-pixel-ratio cap of 1.5. render-1 owns this folder after app-1.
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import type { EntitySnapshot, RendererStats, RoadNetwork, SimSnapshot } from '../sim/api';
import { createFlatLook, type LookEnv, type LookStyle } from './look';

export type { LookEnv, LookStyle, MaterialKind } from './look';

export const MAX_PIXEL_RATIO = 1.5;

/** A camera pose (the camera module's output, structurally). */
export interface ViewPose {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov: number;
}

export type InterpolatedEntity = Pick<EntitySnapshot, 'id' | 'x' | 'y' | 'z' | 'heading' | 'speed' | 'lean'>;

/** Linear interpolation between two snapshots of one entity (never extrapolates past `curr`). */
export function interpolateEntity(
  prev: SimSnapshot | null,
  curr: SimSnapshot,
  alpha: number,
  id: number,
): InterpolatedEntity | null {
  const b = curr.entities[id];
  if (!b) return null;
  const a = prev?.entities[id] ?? b;
  const t = Math.min(1, Math.max(0, alpha));
  let dh = b.heading - a.heading;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  return {
    id,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    heading: a.heading + dh * t,
    speed: a.speed + (b.speed - a.speed) * t,
    lean: a.lean + (b.lean - a.lean) * t,
  };
}

export interface GameRenderer {
  /** Builds the road meshes for a network (once per region). */
  setRoad(road: RoadNetwork, env: LookEnv): void;
  render(prev: SimSnapshot | null, curr: SimSnapshot | null, alpha: number, pose: ViewPose): void;
  resize(): void;
  stats(): RendererStats;
  readonly contextLost: boolean;
}

/** The player is always yellow; rivals take the other colours in id order. */
const PLAYER_COLOR = '#f2c14e';
const RIDER_COLORS = ['#e0543a', '#7fd1c7', '#b98ce0', '#f28f8f', '#9cc56b'];

function ribbon(
  road: RoadNetwork,
  edge: number,
  d0: number,
  d1: number,
  lift: number,
  step = 2,
): BufferGeometry {
  const e = road.edges[edge];
  const positions: number[] = [];
  const indices: number[] = [];
  if (!e) return new BufferGeometry();
  const n = Math.max(1, Math.round(e.length / step));
  for (let i = 0; i <= n; i++) {
    const s = (e.length * i) / n;
    const a = road.toWorld(edge, s, d0, lift);
    const b = road.toWorld(edge, s, d1, lift);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    if (i < n) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Centre-line dashes for every edge, merged into one geometry (one draw call). */
function dashes(road: RoadNetwork): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const e of road.edges) {
    for (let s = 2; s + 3 < e.length; s += 12) {
      const k = positions.length / 3;
      for (const [ds, dd] of [
        [0, -0.08],
        [0, 0.08],
        [3, -0.08],
        [3, 0.08],
      ] as const) {
        const p = road.toWorld(e.index, s + ds, dd, 0.03);
        positions.push(p.x, p.y, p.z);
      }
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function createRenderer(canvas: HTMLCanvasElement, look: LookStyle = createFlatLook()): GameRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  const scene = new Scene();
  const camera = new PerspectiveCamera(62, 16 / 9, 0.3, 1500);
  const views = new Map<number, Group>();
  const world = new Group();
  scene.add(world);
  let lost = false;
  let rendererName = '';

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // allow a restore; three.js re-uploads resources when it comes back
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
  });

  const bikeGeo = new BoxGeometry(0.5, 0.7, 1.9);
  const riderGeo = new BoxGeometry(0.55, 0.8, 0.45);

  const viewFor = (e: EntitySnapshot): Group => {
    let v = views.get(e.id);
    if (!v) {
      v = new Group();
      v.rotation.order = 'YXZ';
      const bike = new Mesh(bikeGeo, look.material('bike'));
      bike.position.y = 0.55;
      const rider = new Mesh(
        riderGeo,
        look.material('rider', {
          color: e.slot === 0 ? PLAYER_COLOR : (RIDER_COLORS[e.id % RIDER_COLORS.length] ?? '#fff'),
        }),
      );
      rider.position.set(0, 1.3, 0.15);
      v.add(bike, rider);
      world.add(v);
      views.set(e.id, v);
    }
    return v;
  };

  const resize = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  return {
    setRoad(road, env) {
      look.setupScene(scene, env);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const e of road.edges) {
        const lanes = road.lanesAt(e.index, 0);
        const drive = lanes.filter((l) => l.kind !== 'shoulder');
        const inner0 = Math.min(...drive.map((l) => l.dCenterM - l.widthM / 2));
        const inner1 = Math.max(...drive.map((l) => l.dCenterM + l.widthM / 2));
        world.add(new Mesh(ribbon(road, e.index, inner0, inner1, 0), look.material('road')));
        world.add(new Mesh(ribbon(road, e.index, e.dMin - 0.6, inner0, -0.02), look.material('shoulder')));
        world.add(new Mesh(ribbon(road, e.index, inner1, e.dMax + 0.6, -0.02), look.material('shoulder')));
        for (let i = 0; i < e.count; i++) {
          minX = Math.min(minX, e.x[i] ?? 0);
          maxX = Math.max(maxX, e.x[i] ?? 0);
          minZ = Math.min(minZ, e.z[i] ?? 0);
          maxZ = Math.max(maxZ, e.z[i] ?? 0);
        }
      }
      world.add(new Mesh(dashes(road), look.material('marking')));
      // Roadside posts every 25 m on both sides: one instanced draw call.
      const spots: [number, number][] = [];
      for (const e of road.edges) for (let s = 0; s < e.length; s += 25) spots.push([e.index, s]);
      const posts = new InstancedMesh(
        new BoxGeometry(0.15, 1.1, 0.15),
        look.material('post'),
        spots.length * 2,
      );
      const m = new Matrix4();
      let n = 0;
      for (const [edge, s] of spots) {
        const e = road.edges[edge];
        if (!e) continue;
        for (const d of [e.dMin - 0.9, e.dMax + 0.9]) {
          const p = road.toWorld(edge, s, d, 0.55);
          posts.setMatrixAt(n++, m.makeTranslation(p.x, p.y, p.z));
        }
      }
      posts.count = n;
      world.add(posts);
      // The sea, at world y = 0 (sea level in the network frame).
      const water = new Mesh(
        new PlaneGeometry(maxX - minX + 3000, maxZ - minZ + 3000),
        look.material('water'),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
      world.add(water);
    },
    render(prev, curr, alpha, pose) {
      if (lost) return;
      if (curr) {
        const seen = new Set<number>();
        for (const e of curr.entities) {
          if (e.kind !== 'rider') continue;
          const p = interpolateEntity(prev, curr, alpha, e.id);
          if (!p) continue;
          const v = viewFor(e);
          v.position.set(p.x, p.y, p.z);
          v.rotation.y = p.heading;
          v.rotation.z = -p.lean;
          seen.add(e.id);
        }
        for (const [id, v] of views) v.visible = seen.has(id);
      }
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
      camera.position.set(pose.x, pose.y, pose.z);
      camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
      renderer.render(scene, camera);
    },
    resize,
    stats() {
      if (!rendererName) {
        const gl = renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        rendererName = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      }
      return {
        renderer: rendererName,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        pixelRatio: renderer.getPixelRatio(),
        width: canvas.width,
        height: canvas.height,
      };
    },
    get contextLost() {
      return lost;
    },
  };
}
