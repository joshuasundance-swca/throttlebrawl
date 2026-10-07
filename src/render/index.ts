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
// Run W-R (interview, 2026-10-02: "SF first = downtown towers") adds San Francisco's downtown
// (downtown.ts): towers, plazas, cross streets with their traffic, and the cable cars, which run
// only on its steep cable-car streets.
// Run W-R (off-road; interview, 2026-10-02: "Anywhere with ground") adds the verge layer (verge.ts):
// the ridable ground band beside the road and what ends it, with its dust, splashes and fence boards.
// Run W-R (interview, 2026-10-02: "Real models now") draws each rider as a real model on a real
// bike (riders/, a lazy chunk): `setRiderLooks` names the race's riders and their models, which load
// from the asset manifest; until a rider's two models arrive, its box rider draws.
// Run W-T (pitch 6, "the horizon comes alive") adds the staged roadside scenes (scenes/, a lazy
// chunk with each region's scenes file): a few seeded scenes a race, each one mesh with one dry sign.
// Run W-U (the pitch deck's #8) adds San Francisco's waterfront (waterfront.ts, a lazy chunk): the
// promenade, the numbered pier sheds, the clock-tower ferry hall, the sea lions and the city blocks.
// Run W-U (the pitch deck after playtest 2, #8: "the Mission's mural alleys") adds San Francisco's
// mural district (mission.ts, a lazy chunk): shopfronts, painted alleys, and the streaming outfit's
// mascot on two corner walls, painted over by a crew as the race's leader goes round.
import { Fog, Frustum, PerspectiveCamera, Scene, WebGLRenderer, type Object3D } from 'three';
import type { AssetManifest } from '../assets';
import { Backdrop, backdropFilesFor, loadNetworkWater, type BackdropStats } from './backdrop';
import type {
  EntitySnapshot,
  RendererStats,
  RoadNetwork,
  SimEvent,
  SimSnapshot,
  SimTrafficTypeDef,
} from '../sim/api';
import { loadChunk } from '../content';
import { loadPnwPlacesLayout, loadWaterfrontLayout } from '../road';
import { AirPays } from './air-pays';
import { Boards, type BoardCatalog, type BoardSlot, type VisibleContent } from './boards';
import type { FeelCounts, FeelEffects } from './effects';
import type { EventProps } from './event-props';
import type { Smashables } from './smashables';
import { createFlatLook, isLitTime, type LookEnv, type LookStyle } from './look';
import { createLookSet } from './looks';
import type { LookPost } from './looks/post';
import {
  QUALITY_TIERS,
  renderPixelRatio,
  sceneryReach,
  type QualityTier,
  type QualityTierId,
} from './quality';
import type { ModelKind, ModelLoadReport, SceneryModels } from './models';
import type { RoadsideCounts, RoadsideLayer } from './roadside';
import type { ScenesFile } from './scenes/data';
import type { ScenesCounts, ScenesLayer } from './scenes/layer';
import type { DowntownCounts, DowntownLayer } from './downtown';
import type { WaterfrontCounts, WaterfrontLayer } from './waterfront';
import type { BlocksCounts, BlocksLayer } from './chinatown-northbeach';
import type { MissionCounts, MissionLayer } from './mission';
import type { VergeCounts, VergeLayer } from './verge';
import type { LandmarkCounts, LandmarkLayer } from './landmarks';
import type { LandmarkKit, LandmarkKitId } from './models';
import type { TextSurfaceCounts, TextSurfaceLayer } from './text-surfaces';
import type { AirboatCounts, AirboatLayer } from './airboats';
import type { PartyLights, PartyLightsCounts } from './party-lights';
import type { PnwPlacesCounts, PnwPlacesLayer } from './pnw-places';
import type { Rain } from './rain';
import { easeHaze, hazeFarAt, thinHazeSpans, type ThinHazeSpans } from './haze';
import { roofCover, roofSpans, type RoofSpan } from './roofs';
import type { RiderLook } from './rider-looks';
import type { RiderRigCounts, RiderRigs } from './riders';
import {
  buildRoadScene,
  networkTags,
  type RoadDressing,
  type RoadScene,
  type RoadSceneStats,
} from './road-mesh';
import type { SpeedLineCounts, SpeedLines } from './speed-lines';
import { applyRenderParam, defaultRenderParams } from './tuning';
import { frustumOf } from './view-frustum';
import { EntityViews, entityById, type EntityViewCounts, type EntityViewOptions } from './views';

export type { LookEnv, LookStyle, MaterialKind, MaterialParams } from './look';
export { MIN_THREAT_DRAW_M, createFlatLook } from './look';
export type { BarrierSpan, EdgeDressing, FeatureSpan, RoadDressing, TagSpan } from './road-mesh';
export type { EntityViewCounts, RiderProportions } from './views';
export type { BoardCatalog, BoardItem, BoardKind, SignStyle, VisibleContent } from './boards';
export { signStyleOf } from './boards';
export type { FeelCounts } from './effects';
export type { SpeedLineCounts } from './speed-lines';
export type { RenderParams } from './tuning';
export type { ModelLoadReport } from './models';
export type { RiderLook, RiderLookSource } from './rider-looks';
export { BIKE_CLASS_MODELS, riderLookOf } from './rider-looks';
export type { RiderRigCounts } from './riders';
export type { RoadSceneStats } from './road-mesh';
export { RENDER_TUNING } from './tuning';
export { DEFAULT_LOOK, isLookId, LOOK_IDS } from './looks';
export type { LookId } from './looks';

export { createQualityGovernor, loadAutoTier, MAX_PIXEL_RATIO, saveAutoTier } from './quality';
export type { QualityGovernor, QualitySetting, QualityState, QualityTierId } from './quality';
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
  /**
   * The quality tier and resolution scale app/'s governor picked (quality.ts, roadmap M5): the scene
   * draws at the capped device pixel ratio times the scale, never under the readable floor, and the
   * tier trims how far the still scenery reaches. Render only; threats are never trimmed.
   */
  setQuality(tier: QualityTierId, scale: number): void;
  stats(): RendererStats;
  /** Entities drawn by the last frame, by kind. */
  viewCounts(): EntityViewCounts;
  /** Called with true when the WebGL context is lost and false when it comes back (app/ pauses). */
  onContextChange(listener: (lost: boolean) => void): void;
  readonly contextLost: boolean;
  /** Applies a `render.*` tuning value at once; other ids are ignored. */
  setParam(id: string, value: number): void;
  /**
   * The player's Reduce motion setting (M5's a11y-1), at once: no white hit flash, half the
   * slow-motion tint and the speed lines, a slower cops' light bar and steady road-event lights.
   * Presentation only; the sim never sees it.
   */
  setReduceMotion(on: boolean): void;
  /**
   * The veto's picker: the content reference of the sign or billboard under a pointer position in
   * client (CSS) pixels, as the last frame drew it, or null (docs/architecture.md, "In-game veto").
   */
  pickContentAt(clientX: number, clientY: number): string | null;
  /**
   * The signs, billboards, cones and landing lines in view as the last frame drew them, once per
   * item, each with its kind and its words on one line. app/ polls it every 30 frames in a race and
   * notes each new ref as seen ("recently seen", the veto's list).
   */
  visibleContent(): VisibleContent[];
  /** The content references of `visibleContent()`. */
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
  /**
   * The race's riders and the models each draws with (`riderLookOf`), at race start: their rider and
   * bike models load now, and each rider draws as its models once both are in.
   */
  setRiderLooks(looks: readonly RiderLook[]): void;
  /**
   * The career's paint on the player's bike (`#rrggbb`), or null to restore the bike's own colours
   * from the player's `look`. Applies at once (the player's rig is rebuilt), before or after
   * `setRiderLooks`; render only.
   */
  setPlayerPaint(hex: string | null): void;
  /** The real riders as the last frame drew them, or null before their code has loaded. */
  riders(): RiderRigCounts | null;
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
  /**
   * A downtown (San Francisco's, run W-R, or Portland's blocks, playtest 3, T12.6), or null before its
   * models load or on any other road.
   */
  downtown: DowntownCounts | null;
  /** San Francisco's Chinatown and North Beach (run W-U), or null while its chunk loads or on any other road. */
  blocks: BlocksCounts | null;
  /** San Francisco's mural alleys (run W-U), or null while its chunk loads or on any other road. */
  mission: MissionCounts | null;
  /** The ground band beside the road and its edges (run W-R), or null while its chunk loads. */
  verge: VergeCounts | null;
  /** The real landmarks beside or over the road (playtest 3), or null on a road with none or while their kit loads. */
  landmarks?: LandmarkCounts | null;
  /**
   * The words painted on models' blank boards (playtest 3, T12.6: the roof sign, the food carts' names), or
   * null on a road with none or while their chunk loads.
   */
  textSurfaces?: TextSurfaceCounts | null;
  /** The staged roadside scenes (run W-T), or null while they load or for a region with none. */
  scenes: ScenesCounts | null;
  /** San Francisco's waterfront (run W-U), or null while its chunk loads or on any other road. */
  waterfront: WaterfrontCounts | null;
  /** The airboats beside a road tagged for them (run W-U), or null on a road without any. */
  airboats?: AirboatCounts | null;
  /** The Pacific Northwest's ferry, clear-cut and the Stump Social (run W-U), or null on a road without them. */
  places?: PnwPlacesCounts | null;
  /** A party street's string lights (playtest 4, P4-16), or null by day, on a road without one, or while their chunk loads. */
  partyLights?: PartyLightsCounts | null;
}

export interface RendererOptions extends EntityViewOptions {
  look?: LookStyle;
  /** The asset manifest: the Blender models load through it (without one, stand-ins are drawn). */
  assets?: AssetManifest;
}

export function createRenderer(canvas: HTMLCanvasElement, opts: RendererOptions = {}): GameRenderer {
  const look = createLookSet(opts.look ?? createFlatLook());
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  // The quality tier and resolution scale (quality.ts): `high` at full resolution until app/'s
  // governor says otherwise, which is the game as it drew before tiers.
  let quality: Readonly<QualityTier> = QUALITY_TIERS.high;
  let qualityScale = 1;
  renderer.setPixelRatio(renderPixelRatio(window.devicePixelRatio || 1, qualityScale));
  // A look with a film pass draws twice a frame: count the whole frame, not only the last draw.
  renderer.info.autoReset = false;
  // The film pass (looks/post.ts) and the model reader (models.ts, glb.ts) are lazy chunks: the
  // classic look and the first frame need neither (the JavaScript budget counts the first load).
  // Polish batch F's check, punch item 4 (a deploy mid-race: the landmark chunk's 404 left two
  // uncaught errors): every lazy chunk here loads through content/'s `loadChunk`, caught, tried once
  // more and said once. One that failed both tries is not asked for again until the next road
  // (setRoad), so a build whose files are gone is never asked for frame after frame; the stale-build
  // watch (platform/) offers the reload at the race's end.
  const gaveUp = new Set<string>();
  const chunk = async <T>(name: string, load: () => Promise<T>): Promise<T | null> => {
    if (gaveUp.has(name)) return null;
    const m = await loadChunk(name, load);
    if (m === null) gaveUp.add(name);
    return m;
  };
  let post: LookPost | null = null;
  let postLoading = false;
  const loadPost = () => {
    if (post || postLoading) return;
    postLoading = true;
    void chunk('film pass', () => import('./looks/post')).then((m) => {
      if (m) post = new m.LookPost();
      else postLoading = false; // asked for again at the next road
    });
  };
  const scene = new Scene();
  // The far plane sits just past the fog's end (look.ts: fully fogged at 700 m, so nothing beyond
  // it shows): the road chunks past it are culled, and the depth buffer is finer up close.
  const camera = new PerspectiveCamera(62, 16 / 9, 0.3, CAMERA_FAR_M);
  const params = defaultRenderParams();
  const views = new EntityViews(look, { ...opts, params });
  const boards = new Boards(look);
  // Air that pays (the pitch deck's #13): the chalk mark and the newspaper.
  const airPays = new AirPays();
  // The race's moving parts, one lazy chunk off the first-load JavaScript (race-parts.ts: the menu's
  // grid needs none of them). It is fetched as the renderer starts, so it is in long before a race
  // can start (it waits for the base pack's real roads); until then none is drawn.
  // - The feel effects (effects.ts: sparks, the splash, the slow-motion tint), the speed lines and
  //   the drizzle a region's palette asks for (rain.ts). The tint, the speed lines and the drizzle
  //   ride on the camera, so the camera joins the scene graph.
  // - W-P: the road events' props (cones, flares, signs, the people working them), from the snapshot.
  // - Run W-T: the roadside smashables, standing or in pieces, from the snapshot. The standing ones
  //   share the road events' still batch: one draw call for both (the draw-call headroom).
  let race: {
    effects: FeelEffects;
    speedLines: SpeedLines;
    rain: Rain;
    rainColourOf: (env: LookEnv) => string | null;
    eventProps: EventProps;
    smashables: Smashables;
  } | null = null;
  let raceLoading = false;
  const loadRace = () => {
    if (race || raceLoading) return;
    raceLoading = true;
    void chunk('race parts', () => import('./race-parts')).then((m) => {
      if (!m) {
        raceLoading = false; // asked for again at the next road
        return;
      }
      const effects = new m.FeelEffects(look, params);
      const speedLines = new m.SpeedLines(look, params);
      const rain = new m.Rain(look, params);
      if (rainEnv) rain.set(m.rainColourOf(rainEnv));
      const eventProps = new m.EventProps(look);
      const smashables = new m.Smashables(look, Math.random, eventProps.batches().still);
      views.setEffects(effects);
      camera.add(effects.tint, speedLines.root, rain.root);
      for (const o of [effects.root, eventProps.root, smashables.root]) {
        persistent.add(o);
        scene.add(o);
      }
      race = { effects, speedLines, rain, rainColourOf: m.rainColourOf, eventProps, smashables };
    });
  };
  const noFeel: FeelCounts = { sparks: 0, drops: 0, paper: 0, rings: 0, reactors: 0, tint: 0 };
  const noLines: SpeedLineCounts = { level: 0, lines: 0 };
  /** The last road's look environment: the drizzle's colour comes from it once rain.ts is in. */
  let rainEnv: LookEnv | null = null;
  const backdrop = new Backdrop();
  const persistent = new Set<Object3D>([views.root, boards.root, airPays.root, camera, backdrop.root]);
  for (const o of persistent) scene.add(o);
  loadRace();
  let roadScene: RoadScene | null = null;
  /** The last setRoad's inputs, so a roadside-density change can rebuild the road meshes. */
  let roadArgs: { road: RoadNetwork; dressing: RoadDressing | undefined; density: number } | null = null;
  /** The roofs over the current road (roofs.ts): the drizzle stops under them. */
  let roofs: readonly RoofSpan[] = [];
  let sceneSeed = 1;
  /** Whether the race's region names a fog colour: its haze then closes in (render.regionFogFarM). */
  let regionFog = false;
  // Playtest 4 answers (the maintainer, 2026-10-06: "Thin it on Chuckanut"): the haze per stretch (haze.ts). The
  // race road's `thin-haze` runs, and where the fog's end is now, easing toward the player's stretch's reach.
  let thinHaze: ThinHazeSpans = new Map();
  let hazeFar = params.regionFogFarM;
  /** The next frame with a player takes its stretch's reach at once (a new road, a new slider value). */
  let hazeSnap = true;
  const applyRegionFog = () => {
    if (regionFog && scene.fog instanceof Fog) scene.fog.far = Math.max(scene.fog.near + 10, hazeFar);
  };
  /** The models as loaded, and as the race's palette repaints them (what the road scene draws). */
  const loadedModels: SceneryModels = {};
  let models: SceneryModels = {};
  let modelReport: ModelLoadReport | null = null;
  let modelsModule: typeof import('./models') | null = null;
  const requested = new Set<ModelKind>();
  let palette: Readonly<Record<string, string>> | undefined;
  // Playtest 3 (T12.6): the words on models' blank boards (text-surfaces.ts), painted from the region's
  // signs. They are vetoable like a board, so they join its poll, its picker and its cuts.
  let textSurfacesModule: typeof import('./text-surfaces') | null = null;
  let textSurfaces: TextSurfaceLayer | null = null;
  let roadCatalog: BoardCatalog | undefined;
  /** The race's time of day: dusk and night light Duval's neon names and its string lights (playtest 4, P4-16). */
  let roadTime: string | undefined;
  /** Whether the roadside layer's name boards (Duval's shop names) are in the text layer yet (they place over the first frames). */
  let roadsideWords = false;
  const visibleContent = (): VisibleContent[] => [
    ...boards.visibleContent(camera),
    ...(textSurfaces?.visibleContent(camera) ?? []),
  ];
  let trafficIds: string[] = [];
  let sceneryVisible = 0;
  let lastFrameAt = -1;
  // Run W-R: the rider rigs, a lazy chunk that loads with the first race's looks.
  let rigs: RiderRigs | null = null;
  /** What the camera sees through this frame, handed to the rigs (render). */
  const viewFrustum = new Frustum();
  let rigsLoading = false;
  let riderLooks: readonly RiderLook[] = [];
  let playerPaint: string | null = null;
  const loadRigs = () => {
    if (rigs || rigsLoading) return;
    rigsLoading = true;
    void chunk('rider rigs', () => import('./riders')).then((m) => {
      if (!m) {
        rigsLoading = false; // tried again at the next race start
        return;
      }
      rigs = new m.RiderRigs(look, opts.assets ?? null, params);
      views.setRigs(rigs);
      rigs.setPlayerPaint(playerPaint);
      rigs.setLooks(riderLooks);
    });
  };
  // Run W-P: the region's roadside props (roadside.ts), a lazy chunk that arrives with the kit.
  let roadsideModule: typeof import('./roadside') | null = null;
  let roadside: RoadsideLayer | null = null;
  /** The race network's own water above the sea, once its backdrop file is in (`requestWater`). */
  let water: { road: RoadNetwork; at: (x: number, z: number) => number | null } | null = null;
  const buildRoadside = () => {
    roadside?.dispose();
    roadside = null;
    roadsideWords = false;
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
      landTop: (e, side, s, across) => rs.landTop(e, side, s, across),
      spots: rs.spots,
      reserved: [
        ...(scenes?.reserved() ?? []),
        ...(landmarksModule ? landmarksModule.landmarkFootprints(roadArgs.road) : []),
      ],
      // Playtest 3 (T12.1): rules that draw from another kit (Key West's Old Town, the Duval kit,
      // with its region atlas loaded alongside it in models.ts).
      models,
      // Playtest 4 (P4-19, C4): the network's own water (Lake Samish), where a dock stands at its level.
      ...(water && water.road === roadArgs.road ? { waterAt: water.at } : {}),
    });
    scene.add(roadside.group);
  };
  // Playtest 4 (P4-19, C4): the network's own water above the sea, from its backdrop file (Lake Samish);
  // the road is built again once it is in (playtest 4 run C, punch item 6: the lake's land is a bank down to the
  // shore, which needs the water's level), and its roadside with it, so the docks stand at the lake's level.
  const requestWater = (road: RoadNetwork) => {
    water = null;
    void loadNetworkWater(road.id)
      .then((at) => {
        if (!at || roadArgs?.road !== road) return;
        water = { road, at };
        buildRoad();
      })
      .catch(() => {
        // No water floor: no docks; the race goes on.
      });
  };
  // Run W-T: the staged roadside scenes (scenes/), a lazy chunk with the region's scenes file. They
  // are placed on the road scene's land before the roadside props, which keep off their ground.
  let scenesModule: typeof import('./scenes/layer') | null = null;
  let scenesData: { road: RoadNetwork; region: string; pack: string; file: ScenesFile } | null = null;
  let scenes: ScenesLayer | null = null;
  const hiddenRefs = new Set<string>();
  const buildScenes = () => {
    scenes?.dispose();
    scenes = null;
    const m = scenesModule;
    const rs = roadScene;
    const data = scenesData;
    if (!m || !rs || !roadArgs || !data || data.road !== roadArgs.road) return;
    scenes = new m.ScenesLayer(look, {
      road: roadArgs.road,
      seed: sceneSeed,
      pack: data.pack,
      file: data.file,
      landReach: (e, side, s) => rs.landReach(e, side, s),
      spots: rs.spots,
    });
    scenes.hide(hiddenRefs);
    scene.add(scenes.group);
  };
  /** Fetches the scenes of the road's region (none for a road without a backdrop region). */
  const requestScenes = (road: RoadNetwork) => {
    const files = backdropFilesFor(road.id);
    const region = files?.region.split('/').at(-2);
    if (!region) return;
    void chunk('roadside scenes', () => import('./scenes/layer')).then(async (m) => {
      if (!m) return;
      scenesModule = m;
      const found = await m.loadScenes(region);
      if (!found || roadArgs?.road !== road) return;
      scenesData = { road, region, ...found };
      buildScenes();
      buildRoadside();
      buildWaterfront();
    });
  };
  // Run W-R: San Francisco's downtown (downtown.ts), a lazy chunk that arrives with its models.
  let downtownModule: typeof import('./downtown') | null = null;
  let downtown: DowntownLayer | null = null;
  /** The sim tick the downtown's cross traffic last moved on, and how long it has stood still, s. */
  let downtownTick = -1;
  let downtownStill = 0;
  const buildDowntown = () => {
    downtown?.dispose();
    downtown = null;
    const m = downtownModule;
    if (!m || !roadArgs) return;
    const { tags } = networkTags(roadArgs.road, roadArgs.dressing);
    if (m.hasPortland(tags)) {
      // Playtest 3 (T12.6): downtown Portland's blocks, from CX4's kit, where the road's plan stands them
      // (road/structures/downtown.ts, on the land the road scene draws).
      const pdx = models.pdxDowntown;
      if (!pdx) return;
      downtown = new m.DowntownLayer(pdx, undefined, undefined, look, {
        road: roadArgs.road,
        dressing: roadArgs.dressing,
        seed: sceneSeed,
        portland: true,
      });
    } else {
      const kit = models.sfDowntown;
      if (!kit || !m.hasDowntown(tags)) return;
      downtown = new m.DowntownLayer(
        kit,
        models.sfRoadside,
        models.cableCar,
        look,
        { road: roadArgs.road, dressing: roadArgs.dressing, seed: sceneSeed },
        // Playtest 3 (T12.4): the towers stack these when they have loaded (else the stretched kit).
        models.sfTowerModules,
      );
    }
    scene.add(downtown.group);
    buildTextSurfaces();
  };
  /** Paints the pack signs' words on the blank boards the landmarks and the downtown placed (T12.6). */
  const buildTextSurfaces = () => {
    textSurfaces?.dispose();
    textSurfaces = null;
    const placed = [
      ...(landmarks?.surfaces() ?? []),
      ...(downtown?.surfaces() ?? []),
      // Playtest 4 (P4-16): the Old Town's shop names, once the street fronts are placed.
      ...(roadside?.ready ? roadside.surfaces() : []),
    ];
    // Playtest 4 (P4-19, R3): the shop signs of the corner buildings the scatter stood in the terraces.
    const apartments = models.sfApartments;
    const corners =
      !!roadScene &&
      !!apartments?.surfaces &&
      roadScene.spots.some(
        (s) => s.kind === 'apartment' && (apartments.surfaces?.[s.variant]?.length ?? 0) > 0,
      );
    if (placed.length === 0 && !corners) return;
    const m = textSurfacesModule;
    if (!m) {
      void chunk('text surfaces', () => import('./text-surfaces')).then((loaded) => {
        if (!loaded) return;
        textSurfacesModule = loaded;
        buildTextSurfaces();
      });
      return;
    }
    if (corners && roadScene) placed.push(...m.apartmentSurfaces(roadScene.spots, apartments, sceneSeed));
    textSurfaces = new m.TextSurfaceLayer(look, placed, {
      catalog: roadCatalog,
      hidden: hiddenRefs,
      lit: isLitTime(roadTime),
    });
    scene.add(textSurfaces.group);
  };
  // Run W-U: San Francisco's waterfront (waterfront.ts), a lazy chunk fetched for a waterfront road.
  // It is rebuilt with the road (a new seed, the palms arriving) and keeps off the staged scenes.
  let waterfrontModule: typeof import('./waterfront') | null = null;
  // Where its buildings stand is the road's plan (road/structures/waterfront.ts, a lazy chunk of its own).
  let waterfrontPlan: Awaited<ReturnType<typeof loadWaterfrontLayout>> | null = null;
  let waterfrontLoading = false;
  let waterfront: WaterfrontLayer | null = null;
  const buildWaterfront = () => {
    waterfront?.dispose();
    waterfront = null;
    if (!roadArgs) return;
    const { tags } = networkTags(roadArgs.road, roadArgs.dressing);
    const m = waterfrontModule;
    if (!m) {
      if (waterfrontLoading || !['promenade', 'wharf'].some((t) => tags.has(t))) return;
      waterfrontLoading = true;
      void Promise.all([
        chunk('waterfront', () => import('./waterfront')),
        chunk('waterfront layout', loadWaterfrontLayout),
      ]).then(([w, plan]) => {
        if (!w || !plan) {
          waterfrontLoading = false; // tried again at the next road build
          return;
        }
        waterfrontModule = w;
        waterfrontPlan = plan;
        buildWaterfront();
      });
      return;
    }
    if (!m.hasWaterfront(tags) || !waterfrontPlan) return;
    waterfront = new m.WaterfrontLayer(models, look, {
      road: roadArgs.road,
      seed: sceneSeed,
      layout: waterfrontPlan.waterfrontLayout(roadArgs.road, sceneSeed),
      reserved: scenes?.reserved() ?? [],
    });
    scene.add(waterfront.group);
  };
  // Run W-U: San Francisco's Chinatown and North Beach (chinatown-northbeach.ts), a lazy chunk with a
  // code-made kit (no model file), loaded only for a network that carries its tags.
  let blocksModule: typeof import('./chinatown-northbeach') | null = null;
  let blocksLoading = false;
  let blocks: BlocksLayer | null = null;
  const buildBlocks = () => {
    blocks?.dispose();
    blocks = null;
    if (!roadArgs) return;
    const { tags } = networkTags(roadArgs.road, roadArgs.dressing);
    if (!['lanterns', 'cafes', 'side-street', 'hill-park'].some((t) => tags.has(t))) return;
    const m = blocksModule;
    if (!m) {
      if (!blocksLoading) {
        blocksLoading = true;
        void chunk('Chinatown and North Beach', () => import('./chinatown-northbeach')).then((b) => {
          if (!b) {
            blocksLoading = false; // tried again at the next road build
            return;
          }
          blocksModule = b;
          buildBlocks();
        });
      }
      return;
    }
    // The districts stand where the road's own plan puts them (road/structures/): no dressing, the road data alone.
    blocks = new m.BlocksLayer(look, { road: roadArgs.road, seed: sceneSeed });
    scene.add(blocks.group);
  };
  // Run W-U: San Francisco's mural alleys (mission.ts), a lazy chunk fetched once a road has them.
  let missionModule: typeof import('./mission') | null = null;
  let mission: MissionLayer | null = null;
  let missionTick = -1;
  let missionStill = 0;
  const buildMission = () => {
    mission?.dispose();
    mission = null;
    if (!roadArgs) return;
    const { tags } = networkTags(roadArgs.road, roadArgs.dressing);
    if (!['shopfronts', 'murals', 'mascot-mural'].some((t) => tags.has(t))) return;
    const m = missionModule;
    if (!m) {
      void chunk('mural alleys', () => import('./mission')).then((loaded) => {
        if (!loaded) return;
        missionModule = loaded;
        buildMission();
      });
      return;
    }
    // The walls stand where the road's own plan puts them (road/structures/): no dressing, the road data alone.
    mission = new m.MissionLayer(models.sfRoadside, look, { road: roadArgs.road, seed: sceneSeed });
    scene.add(mission.group);
  };
  // Run W-R: the ground band beside the road (verge.ts), a lazy chunk that arrives with the road. It
  // is built once per setRoad (a new seed or the models arriving rebuild the road, not the band), so
  // a fence smashed in this race stays smashed.
  let vergeModule: typeof import('./verge') | null = null;
  let verge: VergeLayer | null = null;
  const buildVerge = () => {
    verge?.dispose();
    verge = null;
    if (!vergeModule || !roadArgs) return;
    const { tags } = networkTags(roadArgs.road, roadArgs.dressing);
    verge = new vergeModule.VergeLayer(roadArgs.road, look, {
      tags,
      railingColour: palette?.['bridgePaint'],
    });
    scene.add(verge.group);
  };
  // Playtest 3: the real landmarks (landmarks.ts), one lazy chunk and one mesh for the whole network,
  // fetched only for a road that has a `landmark` feature. Their kits load through the asset manifest;
  // a landmark whose kit fails draws nothing. Their footprints keep the roadside props off.
  let landmarksModule: typeof import('./landmarks') | null = null;
  let landmarks: LandmarkLayer | null = null;
  let landmarkKits: ReadonlyMap<LandmarkKitId, LandmarkKit> | null = null;
  const buildLandmarks = () => {
    landmarks?.dispose();
    landmarks = null;
    if (!landmarksModule || !landmarkKits || !roadArgs) return;
    landmarks = new landmarksModule.LandmarkLayer(landmarkKits, look, { road: roadArgs.road, palette });
    scene.add(landmarks.group);
    buildTextSurfaces();
  };
  const requestLandmarks = (road: RoadNetwork) => {
    landmarks?.dispose();
    landmarks = null;
    landmarkKits = null;
    if (!road.edges.some((e) => e.features.some((f) => f.kind === 'landmark'))) return;
    void chunk('landmarks', () => import('./landmarks')).then(async (m) => {
      if (!m) return;
      landmarksModule = m;
      const assets = opts.assets;
      const kits = assets ? await m.loadLandmarkKits(assets, m.landmarkKitsFor(road)) : new Map();
      if (roadArgs?.road !== road) return;
      landmarkKits = kits;
      buildLandmarks();
      buildRoadside(); // now keeps off the landmarks' ground
    });
  };
  // Run W-U: the airboats beside a road side tagged `airboats` (the Keys' Mangrove Boardwalk), a lazy
  // chunk loaded only for a road that has the tag. Built once per setRoad, like the verge.
  let airboatsModule: typeof import('./airboats') | null = null;
  let airboats: AirboatLayer | null = null;
  const buildAirboats = () => {
    airboats?.dispose();
    airboats = null;
    if (!airboatsModule || !roadArgs) return;
    const runs = airboatsModule.airboatRuns(roadArgs.road, roadArgs.dressing);
    if (runs.length === 0) return;
    airboats = new airboatsModule.AirboatLayer(roadArgs.road, look, runs);
    scene.add(airboats.group);
  };
  // Run W-U: the Pacific Northwest's places (pnw-places.ts: the ferry, the clear-cut, the Stump Social), a
  // lazy chunk loaded only for a road with their tags. Built with the road scene, whose land it stands on.
  let placesModule: typeof import('./pnw-places') | null = null;
  // Where its shops and its ferry stand is the road's plan (road/structures/pnw-places.ts, a lazy chunk of its own).
  let placesPlan: Awaited<ReturnType<typeof loadPnwPlacesLayout>> | null = null;
  let places: PnwPlacesLayer | null = null;
  const buildPlaces = () => {
    places?.dispose();
    places = null;
    const rs = roadScene;
    if (!placesModule || !placesPlan || !roadArgs || !rs) return;
    if (!placesModule.hasPnwPlaces(networkTags(roadArgs.road, roadArgs.dressing).tags)) return;
    places = new placesModule.PnwPlacesLayer(look, {
      road: roadArgs.road,
      seed: sceneSeed,
      layout: placesPlan.pnwPlacesLayout(roadArgs.road, sceneSeed),
      landReach: (e, side, s) => rs.landReach(e, side, s),
    });
    scene.add(places.group);
  };
  // Playtest 4 (P4-16): a party street's string lights (party-lights.ts), a lazy chunk loaded only for a road
  // with a party zone, and hung only at dusk and after. Built with the road scene, whose land it stands on.
  // The crowd on its balconies (run A's check, item 7) is there by day too, once the street fronts are placed.
  let partyModule: typeof import('./party-lights') | null = null;
  let party: PartyLights | null = null;
  const buildParty = () => {
    party?.dispose();
    party = null;
    const rs = roadScene;
    if (!partyModule || !roadArgs || !rs) return;
    party = new partyModule.PartyLights(look, {
      road: roadArgs.road,
      dressing: roadArgs.dressing,
      seed: sceneSeed,
      lit: isLitTime(roadTime),
      landReach: (e, side, s) => rs.landReach(e, side, s),
    });
    scene.add(party.group);
    if (roadside?.ready) party.setFronts(roadside.surfaces());
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
      ...(water && water.road === roadArgs.road ? { waterAt: water.at } : {}),
    });
    scene.add(roadScene.group);
    buildScenes();
    buildRoadside();
    buildDowntown();
    buildWaterfront();
    buildPlaces();
    buildBlocks();
    buildMission();
    buildParty();
    buildTextSurfaces();
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
    void chunk('models', () => import('./models')).then(async (m) => {
      if (!m) return;
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
        void chunk('roadside', () => import('./roadside')).then((r) => {
          if (!r) return;
          roadsideModule = r;
          buildRoadside();
        });
      if ((report.loaded.includes('sfDowntown') || report.loaded.includes('pdxDowntown')) && !downtownModule)
        void chunk('downtown', () => import('./downtown')).then((d) => {
          if (!d) return;
          downtownModule = d;
          buildDowntown();
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
      // A new road asks again for any chunk that failed both tries on the last one.
      gaveUp.clear();
      if (roadScene) {
        scene.remove(roadScene.group);
        roadScene.dispose();
      }
      roadScene = null;
      // The last road's words and landmarks go first: the downtown (built just below) paints its own over
      // the new road's, and must not find the old road's landmark boards among them.
      textSurfaces?.dispose();
      textSurfaces = null;
      landmarks?.dispose();
      landmarks = null;
      roadCatalog = catalog;
      for (const child of [...scene.children]) if (!persistent.has(child)) scene.remove(child);
      look.setupScene(scene, env);
      regionFog = env.palette?.['fog'] !== undefined;
      thinHaze = thinHazeSpans(road);
      hazeFar = params.regionFogFarM;
      hazeSnap = true;
      applyRegionFog();
      rainEnv = env;
      race?.rain.set(race.rainColourOf(env));
      const nextPalette = env.palette;
      if (JSON.stringify(nextPalette ?? {}) !== JSON.stringify(palette ?? {})) {
        palette = nextPalette;
        repaint();
      }
      roadTime = env.timeOfDay;
      roadArgs = { road, dressing, density: params.roadsideDensity };
      roofs = roofSpans(road);
      buildRoad();
      if (vergeModule) buildVerge();
      else
        void chunk('verge', () => import('./verge')).then((m) => {
          if (!m) return;
          vergeModule = m;
          buildVerge();
        });
      airboats?.dispose();
      airboats = null;
      if (networkTags(road, dressing).tags.has('airboats')) {
        if (airboatsModule) buildAirboats();
        else
          void chunk('airboats', () => import('./airboats')).then((m) => {
            if (!m) return;
            airboatsModule = m;
            buildAirboats();
          });
      }
      party?.dispose();
      party = null;
      const hasParty = road.edges.some((e) =>
        (dressing?.[e.id]?.features ?? e.features).some(
          // A roadside zone whose `dressing` is `party` (party-lights.ts `PARTY_DRESSING`).
          (f) => f.kind === 'roadsideZone' && f.params?.['dressing'] === 'party',
        ),
      );
      if (hasParty) {
        if (partyModule) buildParty();
        else
          void chunk('party lights', () => import('./party-lights')).then((m) => {
            if (!m) return;
            partyModule = m;
            buildParty();
          });
      }
      const placeTags = networkTags(road, dressing).tags;
      if (!placesModule && ['ferry', 'clearcut', 'festival'].some((t) => placeTags.has(t)))
        void Promise.all([
          chunk('Pacific Northwest places', () => import('./pnw-places')),
          chunk('Pacific Northwest places layout', loadPnwPlacesLayout),
        ]).then(([m, plan]) => {
          if (!m || !plan) return;
          placesModule = m;
          placesPlan = plan;
          buildPlaces();
        });
      backdrop.setRoad(road);
      requestLandmarks(road);
      requestScenes(road);
      requestWater(road);
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
      airPays.pushEvents(events);
      verge?.pushEvents(events);
      rigs?.pushEvents(events);
    },
    render(prev, curr, alpha, pose) {
      if (lost) return;
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
      camera.position.set(pose.x, pose.y, pose.z);
      camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
      if (pose.roll) camera.rotateZ(pose.roll);
      // The riders are placed through the view the camera has this frame: a rig it cannot see is not drawn (polish J3).
      rigs?.setCamera(pose.x, pose.y, pose.z);
      rigs?.setView(frustumOf(camera, viewFrustum));
      if (curr) views.sync(prev, curr, alpha, now(), pose);
      race?.effects.fitTint(camera);
      // Speed lines follow the player's speed (the entity in slot 0), over real frame time.
      const t = now();
      const dt = lastFrameAt < 0 ? 0 : Math.min(0.1, t - lastFrameAt);
      // The haze reaches as far as the player's stretch says (haze.ts), before the backdrop reads the fog's end.
      const lead = regionFog ? curr?.entities.find((e) => e.slot === 0) : undefined;
      if (lead) {
        const target = hazeFarAt(thinHaze, lead.road.edge, lead.road.s, params);
        hazeFar = hazeSnap ? target : easeHaze(hazeFar, target, dt);
        hazeSnap = false;
        applyRegionFog();
      }
      backdrop.update(camera.position, scene, t);
      if (race) {
        race.eventProps.calm = params.reduceMotion === true;
        race.eventProps.sync(curr, t);
        race.smashables.sync(curr, t);
      } else loadRace();
      airPays.update(prev, curr, alpha, t);
      // The tier's reach for the still scenery (quality.ts). Boards keep the slider's own: their words
      // are content, and threats are never trimmed (they are not scenery).
      const reach = sceneryReach(params, quality);
      sceneryVisible = roadScene ? roadScene.update(pose.x, pose.z, t, reach.drawM, reach.lodM, 1, reach) : 0;
      if (roadside) sceneryVisible += roadside.update(pose.x, pose.z, reach.drawM, reach.propDetail);
      // The street fronts are placed over the first frames of a race; their shop names follow.
      if (roadside?.ready && !roadsideWords) {
        roadsideWords = true;
        buildTextSurfaces();
        party?.setFronts(roadside.surfaces());
      }
      party?.update(pose.x, pose.z);
      if (places) sceneryVisible += places.update(pose.x, pose.z, reach.drawM, reach.lodM);
      boards.update(pose.x, pose.z, params.sceneryDrawM);
      scenes?.update(pose.x, pose.z, reach.drawM, reach.lodM);
      if (downtown) {
        // The cross traffic moves with the race: it stands still while the race does (paused).
        const tick = curr?.tick ?? -1;
        downtownStill = tick === downtownTick ? downtownStill + dt : 0;
        downtownTick = tick;
        const moving = downtownStill < 0.25 ? dt * (curr?.timeScale ?? 1) : 0;
        // The tier's share of its draw distance in full detail (quality.ts `cityDetail`; all of it on `high`).
        const nearM = (downtownModule?.DOWNTOWN_DRAW_M ?? Infinity) * reach.cityDetail;
        sceneryVisible += downtown.update(pose.x, pose.z, moving, curr?.entities ?? [], nearM);
      }
      if (waterfront) sceneryVisible += waterfront.update(pose.x, pose.z, reach.lodM);
      if (blocks && blocksModule)
        sceneryVisible += blocks.update(pose.x, pose.z, blocksModule.NEAR_M * reach.cityDetail);
      if (mission && missionModule) {
        // The crew paints with the race: the leader's share of it, and stands still while it is paused.
        const tick = curr?.tick ?? -1;
        missionStill = tick === missionTick ? missionStill + dt : 0;
        missionTick = tick;
        const moving = missionStill < 0.25 ? dt * (curr?.timeScale ?? 1) : 0;
        sceneryVisible += mission.update(pose.x, pose.z, moving, missionModule.raceShare(curr));
      }
      lastFrameAt = t;
      landmarks?.update(pose.x, pose.z);
      textSurfaces?.update(pose.x, pose.z);
      // The camera's aim: fences and ferns behind it are left out (main-green-4).
      verge?.setTreeShare(reach.treeShare);
      verge?.update(pose.x, pose.z, curr, dt * (curr?.timeScale ?? 1), pose.lookX, pose.lookZ);
      airboats?.update(curr, t, dt * (curr?.timeScale ?? 1));
      const me = curr?.entities.find((e) => e.slot === 0);
      const riding = me && me.mode !== 'Tumble' && me.mode !== 'OnFoot';
      race?.speedLines.update(riding ? me.speed : 0, dt * (curr?.timeScale ?? 1), camera);
      // No drizzle under a roof (the ferry's passenger deck): the rain is a screen overlay, so how far
      // under a roof the camera stands is what thins it out (roofs.ts), read from where it is.
      const cover =
        roadArgs !== null && roofs.length > 0
          ? roofCover(roadArgs.road, roofs, pose.x, pose.y, pose.z, me?.road.edge)
          : 0;
      race?.rain.update(riding ? me.speed : 0, dt * (curr?.timeScale ?? 1), cover);
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
        // Left out until the race parts' chunk is in (a renderer that draws none may leave it out), so
        // a spec sees whether that lazy chunk arrived (tests/e2e/app-chunk-retry.spec.ts).
        ...(race ? { eventProps: race.eventProps.counts() } : {}),
      };
    },
    setQuality(tier, scale) {
      quality = QUALITY_TIERS[tier] ?? QUALITY_TIERS.high;
      qualityScale = Number.isFinite(scale) ? Math.min(1, Math.max(0, scale)) : 1;
      // A new pixel ratio resizes the drawing buffer (the browser upscales it to the canvas); the
      // film pass's target follows the buffer on its next frame.
      const ratio = renderPixelRatio(window.devicePixelRatio || 1, qualityScale);
      if (ratio !== renderer.getPixelRatio()) renderer.setPixelRatio(ratio);
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
      if (id === 'render.regionFogFarM' || id === 'render.thinHazeFarM') {
        hazeFar = params.regionFogFarM;
        hazeSnap = true;
        applyRegionFog();
      }
      // The scenery is part of the road scene: a new density rebuilds it.
      if (roadArgs && params.roadsideDensity !== roadArgs.density) {
        roadArgs.density = params.roadsideDensity;
        buildRoad();
      }
    },
    setReduceMotion(on) {
      params.reduceMotion = on === true;
    },
    pickContentAt(clientX, clientY) {
      const ndc = clientToNdc(clientX, clientY, canvas.getBoundingClientRect());
      return boards.pick(ndc.x, ndc.y, camera) ?? textSurfaces?.pick(ndc.x, ndc.y, camera) ?? null;
    },
    visibleContent: () => visibleContent(),
    visibleContentRefs: () => visibleContent().map((c) => c.ref),
    hideContent(refs) {
      const list = [...refs];
      boards.hide(list);
      for (const r of list) hiddenRefs.add(r);
      scenes?.hide(list);
      textSurfaces?.hide(list);
    },
    feelCounts: () => race?.effects.counts() ?? noFeel,
    speedLineCounts: () => race?.speedLines.counts() ?? noLines,
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
    setRiderLooks(looks) {
      riderLooks = looks;
      if (rigs) rigs.setLooks(looks);
      else loadRigs();
    },
    setPlayerPaint(hex) {
      playerPaint = hex;
      rigs?.setPlayerPaint(hex);
    },
    riders: () => rigs?.counts() ?? null,
    scenery: () => ({
      seed: sceneSeed,
      road: roadScene?.stats ?? null,
      models: modelReport,
      visible: sceneryVisible,
      rain: race?.rain.count() ?? 0,
      roadside: roadside?.counts() ?? null,
      backdrop: backdrop.status().stats,
      downtown: downtown?.counts() ?? null,
      blocks: blocks?.counts() ?? null,
      mission: mission?.counts() ?? null,
      verge: verge?.counts() ?? null,
      landmarks: landmarks?.counts() ?? null,
      textSurfaces: textSurfaces?.counts() ?? null,
      scenes: scenes?.counts() ?? null,
      waterfront: waterfront?.counts() ?? null,
      airboats: airboats?.counts() ?? null,
      places: places?.counts() ?? null,
      partyLights: party?.counts() ?? null,
    }),
  };
}
