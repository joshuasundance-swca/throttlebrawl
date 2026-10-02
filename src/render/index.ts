// render: the Three.js scene (docs/architecture.md, "Rendering"; M1 render-1). The road is merged
// meshes from the road profiles (road-mesh.ts); entities are pooled primitive views updated from
// interpolated snapshots (views.ts); the look is swappable (look.ts). WebGL2 straight to the
// canvas with a device-pixel-ratio cap of 1.5, and a crude handler for a lost WebGL context.
// M2 render-2 adds the feel visuals (effects.ts: sparks, the splash, the slow-motion tint), the
// placeholder signs and billboards with the veto's picking (boards.ts), and RENDER_TUNING.
// Playtest 1b item 6 adds the playable looks (looks/): `classic` (the default) and `kodak`, the ink +
// 1960s film look, switched at any time with `setLook`; `kodak` draws through one final film pass.
// Playtest 1c: the Blender models (models.ts, glb.ts) load through the asset manifest and replace
// the code-made stand-ins once they arrive; roadside scenery stands on tagged land, scatters by the
// race's seed (`setSceneSeed`) and is hidden past `render.sceneryDrawM` (scenery.ts, road-mesh.ts).
// The region build-out (W-O, the maintainer, 2026-10-01) loads a region's models only when a race
// there starts (`modelKindsFor`), repaints them with its palette, draws the cable car as the region's
// cable-car traffic, and adds the drizzle (rain.ts) a region's palette asks for.
// W-P "fill the world" (the maintainer, 2026-10-01b) adds the backdrop (backdrop/): each region's
// mountains, skylines, bridges, ships and clouds past the fog, one lazy-loaded draw call.
import { Fog, PerspectiveCamera, Scene, WebGLRenderer, type Object3D } from 'three';
import type { AssetManifest } from '../assets';
import { Backdrop, type BackdropStats } from './backdrop';
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
import { EventProps } from './event-props';
import { createFlatLook, type LookEnv, type LookStyle } from './look';
import { createLookSet } from './looks';
import type { LookPost } from './looks/post';
import type { ModelKind, ModelLoadReport, SceneryModels } from './models';
import type { RoadsideCounts, RoadsideLayer } from './roadside';
import { Rain, rainColourOf } from './rain';
import {
  buildRoadScene,
  networkTags,
  type RoadDressing,
  type RoadScene,
  type RoadSceneStats,
} from './road-mesh';
import { SpeedLines, type SpeedLineCounts } from './speed-lines';
import { applyRenderParam, defaultRenderParams } from './tuning';
import { EntityViews, entityById, type EntityViewCounts, type EntityViewOptions } from './views';

export type { LookEnv, LookStyle, MaterialKind, MaterialParams } from './look';
export { MIN_THREAT_DRAW_M, createFlatLook } from './look';
export type { BarrierSpan, EdgeDressing, FeatureSpan, RoadDressing, TagSpan } from './road-mesh';
export type { EntityViewCounts, RiderProportions } from './views';
export type { BoardCatalog, BoardItem, BoardKind } from './boards';
export type { FeelCounts } from './effects';
export type { SpeedLineCounts } from './speed-lines';
export type { RenderParams } from './tuning';
export type { ModelLoadReport } from './models';
export type { RoadSceneStats } from './road-mesh';
export { RENDER_TUNING } from './tuning';
export { DEFAULT_LOOK, isLookId, LOOK_IDS } from './looks';
export type { LookId } from './looks';

export const MAX_PIXEL_RATIO = 1.5;
/** The render camera's far plane, metres: just past the placeholder look's fog end (700 m). */
export const CAMERA_FAR_M = 760;

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
  /** The speed lines as the last frame drew them (playtest 1 item 10). */
  speedLineCounts(): SpeedLineCounts;
  /** The canvas's width over its height, for the camera's phone-shape adaptation. */
  readonly aspect: number;
  /**
   * Switches the look (`LOOK_IDS`: `classic`, `kodak`) at once; an unknown id is ignored. Render
   * only: it never reaches the sim. The first frame after a switch recompiles the lit materials.
   */
  setLook(id: string): void;
  /** The current look's id. */
  readonly look: string;
  /**
   * The race's seed (playtest 1c item 2): the roadside scenery scatter derives from it, so each
   * race's scenery differs and a fixed seed repeats it. A new seed rebuilds the road scene.
   */
  setSceneSeed(seed: number): void;
  /** The scenery as built and drawn: what was placed, which models loaded, what the last frame showed. */
  scenery(): SceneryStatus;
}

export interface SceneryStatus {
  seed: number;
  /** The road scene's numbers, or null before setRoad. */
  road: RoadSceneStats | null;
  /** Which Blender models loaded and which fell back, or null while they load (or with no manifest). */
  models: ModelLoadReport | null;
  /** Scenery instances inside the draw distance in the last frame. */
  visible: number;
  /** Rain streaks drawn in the last frame (0 = a dry race). */
  rain: number;
  /** The region's roadside props (run W-P), or null before its kit has loaded or with none. */
  roadside: RoadsideCounts | null;
  /** The far backdrop as built (null while it loads, or for a road without one). */
  backdrop: BackdropStats | null;
}

export interface RendererOptions extends EntityViewOptions {
  look?: LookStyle;
  /** The asset manifest: the Blender models load through it (without one, stand-ins are drawn). */
  assets?: AssetManifest;
}

export function createRenderer(canvas: HTMLCanvasElement, opts: RendererOptions = {}): GameRenderer {
  const look = createLookSet(opts.look ?? createFlatLook());
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  // A look with a film pass draws twice a frame: count the whole frame, not only the last draw.
  renderer.info.autoReset = false;
  // The film pass (looks/post.ts) and the model reader (models.ts, glb.ts) are lazy chunks: the
  // classic look and the first frame need neither (the JavaScript budget counts the first load).
  let post: LookPost | null = null;
  let postLoading = false;
  const loadPost = () => {
    if (post || postLoading) return;
    postLoading = true;
    void import('./looks/post')
      .then((m) => {
        post = new m.LookPost();
      })
      .catch(() => {
        postLoading = false; // tried again on the next frame that wants the film pass
      });
  };
  const scene = new Scene();
  // The far plane sits just past the fog's end (look.ts: fully fogged at 700 m, so nothing beyond
  // it shows): the road chunks past it are culled, and the depth buffer is finer up close.
  const camera = new PerspectiveCamera(62, 16 / 9, 0.3, CAMERA_FAR_M);
  const params = defaultRenderParams();
  const effects = new FeelEffects(look, params);
  const views = new EntityViews(look, { ...opts, effects, params });
  const boards = new Boards(look);
  // W-P: the road events' props (cones, flares, signs, the people working them), from the snapshot.
  const eventProps = new EventProps(look);
  // The tint and the speed lines ride on the camera, so the camera joins the scene graph.
  const speedLines = new SpeedLines(look, params);
  // The drizzle rides on the camera too (rain.ts).
  const rain = new Rain(look, params);
  camera.add(effects.tint, speedLines.root, rain.root);
  const backdrop = new Backdrop();
  const persistent = new Set<Object3D>([
    views.root,
    effects.root,
    boards.root,
    eventProps.root,
    camera,
    backdrop.root,
  ]);
  for (const o of persistent) scene.add(o);
  let roadScene: RoadScene | null = null;
  /** The last setRoad's inputs, so a roadside-density change can rebuild the road meshes. */
  let roadArgs: { road: RoadNetwork; dressing: RoadDressing | undefined; density: number } | null = null;
  let sceneSeed = 1;
  /** Whether the race's region names a fog colour: its haze then closes in (render.regionFogFarM). */
  let regionFog = false;
  const applyRegionFog = () => {
    if (regionFog && scene.fog instanceof Fog)
      scene.fog.far = Math.max(scene.fog.near + 10, params.regionFogFarM);
  };
  /** The models as loaded, and as the race's palette repaints them (what the road scene draws). */
  const loadedModels: SceneryModels = {};
  let models: SceneryModels = {};
  let modelReport: ModelLoadReport | null = null;
  let modelsModule: typeof import('./models') | null = null;
  const requested = new Set<ModelKind>();
  let palette: Readonly<Record<string, string>> | undefined;
  let trafficIds: string[] = [];
  let sceneryVisible = 0;
  let lastFrameAt = -1;
  // Run W-P: the region's roadside props (roadside.ts), a lazy chunk that arrives with the kit.
  let roadsideModule: typeof import('./roadside') | null = null;
  let roadside: RoadsideLayer | null = null;
  const buildRoadside = () => {
    roadside?.dispose();
    roadside = null;
    const m = roadsideModule;
    const rs = roadScene;
    const mm = modelsModule;
    if (!m || !rs || !roadArgs || !mm) return;
    // This race's own region's kit: models stay loaded across regions (the menu loads the Keys kit).
    const { tropical, tags } = networkTags(roadArgs.road, roadArgs.dressing);
    const needed = mm.modelKindsFor({
      tropical,
      tags,
      palette: new Set(Object.keys(palette ?? {})),
      traffic: trafficIds,
    });
    const kind = m.kitFor(needed, models) as ModelKind | null;
    const model = kind && models[kind];
    const kit = kind && m.KITS[kind];
    if (!model || !kit) return;
    roadside = new m.RoadsideLayer(model, look, {
      road: roadArgs.road,
      dressing: roadArgs.dressing,
      seed: sceneSeed,
      density: roadArgs.density,
      kit,
      landReach: (e, side, s) => rs.landReach(e, side, s),
      spots: rs.spots,
    });
    scene.add(roadside.group);
  };
  const buildRoad = () => {
    if (!roadArgs) return;
    if (roadScene) {
      scene.remove(roadScene.group);
      roadScene.dispose();
    }
    roadScene = buildRoadScene(roadArgs.road, look, roadArgs.dressing, {
      roadsideDensity: roadArgs.density,
      seed: sceneSeed,
      models,
      palette,
    });
    scene.add(roadScene.group);
    buildRoadside();
  };
  /** Repaints the loaded models with the race's palette (their old painted copies are freed). */
  const repaint = () => {
    const m = modelsModule;
    if (!m) return;
    const next: SceneryModels = {};
    for (const kind of Object.keys(loadedModels) as ModelKind[]) {
      const base = loadedModels[kind];
      if (base) next[kind] = m.paintModel(base, palette);
    }
    for (const kind of Object.keys(models) as ModelKind[]) {
      const old = models[kind];
      if (old && old !== loadedModels[kind] && old !== next[kind]) for (const g of old.variants) g.dispose();
    }
    models = next;
    const car = models.cableCar?.variants[0];
    if (car) views.setFigureModel('cableCar', car);
  };
  // The Blender models (playtest 1c item 4) load in the background, only the ones the race's network
  // and traffic need (W-O: a region's models load when a race there starts); the road draws
  // stand-ins until they arrive, then rebuilds once with the models.
  const requestModels = () => {
    const assets = opts.assets;
    const args = roadArgs;
    if (!assets || !args) return;
    void import('./models').then(async (m) => {
      modelsModule = m;
      const { tropical, tags } = networkTags(args.road, args.dressing);
      const kinds = m
        .modelKindsFor({ tropical, tags, palette: new Set(Object.keys(palette ?? {})), traffic: trafficIds })
        .filter((k) => !requested.has(k));
      if (!kinds.length) return;
      for (const k of kinds) requested.add(k);
      const { models: loaded, report } = await m.loadSceneryModels(assets, kinds);
      Object.assign(loadedModels, loaded);
      modelReport = {
        loaded: [...(modelReport?.loaded ?? []), ...report.loaded],
        fellBack: [...(modelReport?.fellBack ?? []), ...report.fellBack],
      };
      repaint();
      if (report.loaded.length) buildRoad();
      if (report.loaded.some((k) => k.endsWith('Roadside')) && !roadsideModule)
        void import('./roadside').then((r) => {
          roadsideModule = r;
          buildRoadside();
        });
    });
  };
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
      roadScene = null;
      for (const child of [...scene.children]) if (!persistent.has(child)) scene.remove(child);
      look.setupScene(scene, env);
      regionFog = env.palette?.['fog'] !== undefined;
      applyRegionFog();
      rain.set(rainColourOf(env));
      const nextPalette = env.palette;
      if (JSON.stringify(nextPalette ?? {}) !== JSON.stringify(palette ?? {})) {
        palette = nextPalette;
        repaint();
      }
      roadArgs = { road, dressing, density: params.roadsideDensity };
      buildRoad();
      backdrop.setRoad(road);
      requestModels();
      boards.build(road, (id) => dressing?.[id]?.features as readonly BoardSlot[] | undefined, catalog);
    },
    setTrafficTypes(defs) {
      views.setTrafficTypes(defs);
      trafficIds = defs.map((d) => d.contentId);
      requestModels();
    },
    pushEvents(events) {
      views.pushEvents(events);
    },
    render(prev, curr, alpha, pose) {
      if (lost) return;
      if (curr) views.sync(prev, curr, alpha, now(), pose);
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
      camera.position.set(pose.x, pose.y, pose.z);
      camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
      if (pose.roll) camera.rotateZ(pose.roll);
      effects.fitTint(camera);
      // Speed lines follow the player's speed (the entity in slot 0), over real frame time.
      const t = now();
      backdrop.update(camera.position, scene, t);
      eventProps.sync(curr, t);
      sceneryVisible = roadScene ? roadScene.update(pose.x, pose.z, t, params.sceneryDrawM) : 0;
      if (roadside) sceneryVisible += roadside.update(pose.x, pose.z, params.sceneryDrawM);
      boards.update(pose.x, pose.z, params.sceneryDrawM);
      const dt = lastFrameAt < 0 ? 0 : Math.min(0.1, t - lastFrameAt);
      lastFrameAt = t;
      const me = curr?.entities.find((e) => e.slot === 0);
      const riding = me && me.mode !== 'Tumble' && me.mode !== 'OnFoot';
      speedLines.update(riding ? me.speed : 0, dt * (curr?.timeScale ?? 1), camera);
      rain.update(riding ? me.speed : 0, dt * (curr?.timeScale ?? 1));
      renderer.info.reset();
      look.frame(t, params);
      const film = look.post(params);
      // Until the film pass's chunk arrives, an ink look's first frames draw without it.
      if (film && post) post.render(renderer, scene, camera, film, t);
      else {
        if (film) loadPost();
        renderer.render(scene, camera);
      }
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
        setPieces: roadScene?.stats.setPieces ?? [],
        eventProps: eventProps.counts(),
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
      if (id === 'render.regionFogFarM') applyRegionFog();
      // The scenery is part of the road scene: a new density rebuilds it.
      if (roadArgs && params.roadsideDensity !== roadArgs.density) {
        roadArgs.density = params.roadsideDensity;
        buildRoad();
      }
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
    speedLineCounts: () => speedLines.counts(),
    get aspect() {
      return camera.aspect;
    },
    setLook(id) {
      look.select(id);
      if (look.id !== 'classic') loadPost();
    },
    get look() {
      return look.id;
    },
    setSceneSeed(seed) {
      const next = seed >>> 0;
      if (next === sceneSeed) return;
      sceneSeed = next;
      buildRoad();
      backdrop.setSeed(next);
    },
    scenery: () => ({
      seed: sceneSeed,
      road: roadScene?.stats ?? null,
      models: modelReport,
      visible: sceneryVisible,
      rain: rain.count(),
      roadside: roadside?.counts() ?? null,
      backdrop: backdrop.status().stats,
    }),
  };
}
