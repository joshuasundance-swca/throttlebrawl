// render: the Three.js scene (docs/architecture.md, "Rendering"; M1 render-1). The road is merged
// meshes from the road profiles (road-mesh.ts); entities are pooled primitive views updated from
// interpolated snapshots (views.ts); the look is swappable (look.ts). WebGL2 straight to the
// canvas with a device-pixel-ratio cap of 1.5, and a crude handler for a lost WebGL context.
// M2 render-2 adds the feel visuals (effects.ts: sparks, the splash, the slow-motion tint), the
// placeholder signs and billboards with the veto's picking (boards.ts), and RENDER_TUNING.
import { PerspectiveCamera, Scene, WebGLRenderer, type Object3D } from 'three';
import type {
  EntitySnapshot,
  RendererStats,
  RoadNetwork,
  SimEvent,
  SimSnapshot,
  SimTrafficTypeDef,
} from '../sim/api';
import { Boards, type BoardCatalog, type BoardSlot } from './boards';
import { FeelEffects, type FeelCounts } from './effects';
import { createFlatLook, type LookEnv, type LookStyle } from './look';
import { buildRoadScene, type RoadDressing, type RoadScene } from './road-mesh';
import { applyRenderParam, defaultRenderParams } from './tuning';
import { EntityViews, entityById, type EntityViewCounts, type EntityViewOptions } from './views';

export type { LookEnv, LookStyle, MaterialKind, MaterialParams } from './look';
export { MIN_THREAT_DRAW_M, createFlatLook } from './look';
export type { BarrierSpan, EdgeDressing, FeatureSpan, RoadDressing, TagSpan } from './road-mesh';
export type { EntityViewCounts, RiderProportions } from './views';
export type { BoardCatalog, BoardItem, BoardKind } from './boards';
export type { FeelCounts } from './effects';
export type { RenderParams } from './tuning';
export { RENDER_TUNING } from './tuning';

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
  /** Camera roll about its view axis, radians (optional). */
  roll?: number;
}

export type InterpolatedEntity = Pick<EntitySnapshot, 'id' | 'x' | 'y' | 'z' | 'heading' | 'speed' | 'lean'>;

/** Linear interpolation between two snapshots of one entity (never extrapolates past `curr`). */
export function interpolateEntity(
  prev: SimSnapshot | null,
  curr: SimSnapshot,
  alpha: number,
  id: number,
): InterpolatedEntity | null {
  const b = entityById(curr, id);
  if (!b) return null;
  const a = (prev && entityById(prev, id)) ?? b;
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

/** A pointer position in client (CSS) pixels to normalized device coordinates over a rect. */
export function clientToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  return { x: ((clientX - rect.left) / w) * 2 - 1, y: 1 - ((clientY - rect.top) / h) * 2 };
}

export interface GameRenderer {
  /**
   * Builds the road meshes for a network (once per region). Dressing: barriers, features, tags.
   * `boards` resolves the road's `billboard` slots to vetoable items (none: no boards are drawn).
   */
  setRoad(road: RoadNetwork, env: LookEnv, dressing?: RoadDressing, boards?: BoardCatalog): void;
  /** The traffic catalog, so cars and trucks get their sizes (from `SimConfig.trafficTypes`). */
  setTrafficTypes(defs: readonly SimTrafficTypeDef[]): void;
  /** Sim events for visual cues: hit wobble, the kick pose, pedestrian dives. */
  pushEvents(events: readonly SimEvent[]): void;
  render(prev: SimSnapshot | null, curr: SimSnapshot | null, alpha: number, pose: ViewPose): void;
  resize(): void;
  stats(): RendererStats;
  /** Entities drawn by the last frame, by kind. */
  viewCounts(): EntityViewCounts;
  /** Called with true when the WebGL context is lost and false when it comes back (app/ pauses). */
  onContextChange(listener: (lost: boolean) => void): void;
  readonly contextLost: boolean;
  /** Applies a `render.*` tuning value at once; other ids are ignored. */
  setParam(id: string, value: number): void;
  /**
   * The veto's picker: the content reference of the sign or billboard under a pointer position in
   * client (CSS) pixels, as the last frame drew it, or null (docs/architecture.md, "In-game veto").
   */
  pickContentAt(clientX: number, clientY: number): string | null;
  /** Content references of the signs and billboards in view in the last frame (for "recently seen"). */
  visibleContentRefs(): string[];
  /** Stops drawing these items at once (a veto on this device; presentation only). */
  hideContent(refs: Iterable<string>): void;
  /** Live feel effects, for tests and the debug overlay. */
  feelCounts(): FeelCounts;
}

export interface RendererOptions extends EntityViewOptions {
  look?: LookStyle;
}

export function createRenderer(canvas: HTMLCanvasElement, opts: RendererOptions = {}): GameRenderer {
  const look = opts.look ?? createFlatLook();
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  const scene = new Scene();
  const camera = new PerspectiveCamera(62, 16 / 9, 0.3, 1500);
  const params = defaultRenderParams();
  const effects = new FeelEffects(look, params);
  const views = new EntityViews(look, { ...opts, effects, params });
  const boards = new Boards(look);
  // The tint rides on the camera, so the camera joins the scene graph.
  camera.add(effects.tint);
  const persistent = new Set<Object3D>([views.root, effects.root, boards.root, camera]);
  for (const o of persistent) scene.add(o);
  let roadScene: RoadScene | null = null;
  let lost = false;
  let rendererName = '';
  const contextListeners: ((lost: boolean) => void)[] = [];

  // three.js also listens: it calls preventDefault (so the browser may restore the context) and, on
  // restore, rebuilds its GL state, so every geometry, material and instance buffer re-uploads from
  // the scene graph on the next frame. The sim and audio are untouched.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    for (const l of contextListeners) l(true);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    rendererName = '';
    resize();
    for (const l of contextListeners) l(false);
  });

  const resize = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  const now = () => performance.now() / 1000;

  return {
    setRoad(road, env, dressing, catalog) {
      if (roadScene) {
        scene.remove(roadScene.group);
        roadScene.dispose();
      }
      for (const child of [...scene.children]) if (!persistent.has(child)) scene.remove(child);
      look.setupScene(scene, env);
      roadScene = buildRoadScene(road, look, dressing);
      scene.add(roadScene.group);
      boards.build(road, (id) => dressing?.[id]?.features as readonly BoardSlot[] | undefined, catalog);
    },
    setTrafficTypes(defs) {
      views.setTrafficTypes(defs);
    },
    pushEvents(events) {
      views.pushEvents(events);
    },
    render(prev, curr, alpha, pose) {
      if (lost) return;
      if (curr) views.sync(prev, curr, alpha, now());
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
      camera.position.set(pose.x, pose.y, pose.z);
      camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
      if (pose.roll) camera.rotateZ(pose.roll);
      effects.fitTint(camera);
      renderer.render(scene, camera);
    },
    resize,
    stats() {
      if (!rendererName && !lost) {
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
    viewCounts: () => views.viewCounts(),
    onContextChange(listener) {
      contextListeners.push(listener);
    },
    get contextLost() {
      return lost;
    },
    setParam(id, value) {
      applyRenderParam(params, id, value);
    },
    pickContentAt(clientX, clientY) {
      const ndc = clientToNdc(clientX, clientY, canvas.getBoundingClientRect());
      return boards.pick(ndc.x, ndc.y, camera);
    },
    visibleContentRefs: () => boards.visibleRefs(camera),
    hideContent(refs) {
      boards.hide(refs);
    },
    feelCounts: () => effects.counts(),
  };
}
