// render/looks: the playable looks, switchable at any time (playtest 1b item 6: "Styles as settings"
// is [decided]). `classic` is the M1 flat low-poly look, unchanged and the default. `kodak` is the
// maintainer's favourite from scratch/styles2, "Ink + 1960s film grade": ink outlines, world-space
// hatched shadows, inked waves on the sea, a warm Kodachrome grade, film grain and a vignette.
//
// The look set wraps the classic look and hands out the SAME material objects in every look, so a
// switch needs nothing from the views: it recolours the palette materials, turns the ink shader
// patch on or off (a recompile of the lit materials, once, at the switch), restyles the sky and fog,
// and says whether the renderer runs the final film pass. The look is render-only: nothing here
// reaches the sim, its config or a replay.
import { Color, MeshLambertMaterial, type Fog, type Material, type Scene } from 'three';
import type { LookEnv, LookStyle, MaterialKind, MaterialParams } from '../look';
import { inkModeOf, patchInkShader, type InkMode, type InkUniforms } from './ink';
import type { PostSettings } from './post';

export { kodachromeGrade, buildGradeLut, LUT_SIZE } from './grade';
export { patchInkShader, VERTEX_ANCHORS, FRAGMENT_ANCHORS } from './ink';
export type { InkUniforms, ShaderParts } from './ink';
export { LookPost } from './post';
export type { PostSettings } from './post';

/** The playable looks, in the order the settings row lists them. */
export const LOOK_IDS = ['classic', 'kodak'] as const;
export type LookId = (typeof LOOK_IDS)[number];
export const DEFAULT_LOOK: LookId = 'classic';

export function isLookId(v: unknown): v is LookId {
  return typeof v === 'string' && (LOOK_IDS as readonly string[]).includes(v);
}

/**
 * The Kodachrome palette (display sRGB), picked from the reference frames: peach-cream sky, deep
 * teal sea, warm brown-grey asphalt, sand shoulders, wooden rails. Kinds not listed keep the
 * classic colour; vertex-coloured bodies (riders, bikes, cars, palms) keep their own colours and
 * get the grade. [default]
 */
export const KODAK_PALETTE: Partial<Record<MaterialKind, string>> = {
  road: '#4d443d',
  shoulder: '#cfa86a',
  shortcut: '#c08e55',
  marking: '#f3e6c8',
  markingCenter: '#e8ae36',
  post: '#efe0bf',
  rail: '#b8864f',
  deck: '#b9a283',
  land: '#d7b273',
  water: '#1e8e98',
};

/** The sky: cream at the horizon (also the haze colour) to peach overhead. By time of day. */
const KODAK_SKY: Record<string, { top: string; horizon: string; exposure: number }> = {
  dawn: { top: '#e9b49a', horizon: '#f4dcc0', exposure: 0.95 },
  noon: { top: '#9fc9cf', horizon: '#efe3c6', exposure: 1.05 },
  'golden-hour': { top: '#eda57f', horizon: '#f7e6c9', exposure: 1 },
  dusk: { top: '#b9687a', horizon: '#e8b48f', exposure: 0.8 },
  night: { top: '#141a33', horizon: '#2a2f4a', exposure: 0.45 },
};
const INK = '#1b140f';
/** Toward the sun, world space: low from the left-front, so the far sides of things hatch. */
const SUN: [number, number, number] = [-0.75, 0.9, 0.35];

/** The film pass's feel numbers, read from the render sliders (render/tuning.ts). */
export interface LookPostParams {
  inkLines: number;
  inkWidthPx: number;
  filmGrade: number;
  vignette: number;
  filmGrain: number;
  hatchPerM: number;
  seaInk: number;
}

export interface LookSet extends LookStyle {
  /** The current look. */
  readonly id: LookId;
  /** Switches the look; an unknown id is ignored. Returns whether anything changed. */
  select(id: string): boolean;
  /** Per frame: the time for the grain and the drifting waves, and the sliders. */
  frame(timeS: number, p: LookPostParams): void;
  /** The film pass's settings this frame, or null when the look draws straight to the screen. */
  post(p: LookPostParams): PostSettings | null;
}

interface Tracked {
  material: Material;
  /** The palette colour this material follows, or null when its colour is its own. */
  classic: Color | null;
  kind: MaterialKind;
  /** The ink patch mode, for lit materials; null for unlit ones. */
  mode: InkMode | null;
}

const linear = (hex: string): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

export function createLookSet(base: LookStyle): LookSet {
  let current: LookId = DEFAULT_LOOK;
  const tracked = new Map<Material, Tracked>();
  const n = Math.hypot(...SUN);
  const uniforms: InkUniforms = {
    uInkSun: { value: [SUN[0] / n, SUN[1] / n, SUN[2] / n] },
    uInkHatch: { value: 5 },
    uInkExposure: { value: 1 },
    uInkColor: { value: linear(INK) },
    uInkTime: { value: 0 },
    uInkWaves: { value: 1 },
  };
  let scene: Scene | null = null;
  let env: LookEnv | null = null;
  let classicSky: { background: Color | null; fog: Color | null } = { background: null, fog: null };

  const kodakSky = () => KODAK_SKY[env?.timeOfDay ?? ''] ?? KODAK_SKY['golden-hour']!;

  const applyMaterial = (t: Tracked) => {
    const m = t.material as Material & { color?: Color };
    if (t.classic && m.color) {
      const hex = current === 'kodak' ? KODAK_PALETTE[t.kind] : undefined;
      if (hex) m.color.set(hex);
      else m.color.copy(t.classic);
    }
    // The ink patch changes the lit program: recompile once, now.
    if (t.mode) m.needsUpdate = true;
  };

  const applyScene = () => {
    if (!scene) return;
    const fog = scene.fog as Fog | null;
    if (current === 'kodak') {
      const sky = kodakSky();
      scene.background = new Color(sky.horizon);
      if (fog) fog.color.set(sky.horizon);
      uniforms.uInkExposure.value = sky.exposure;
    } else {
      scene.background = classicSky.background ? classicSky.background.clone() : null;
      if (fog && classicSky.fog) fog.color.copy(classicSky.fog);
    }
  };

  const track = (m: Material, kind: MaterialKind, params: MaterialParams | undefined): Material => {
    if (tracked.has(m)) return m;
    const withColor = m as Material & { color?: Color };
    // The palette decides this colour only when the caller gave none and no vertex colours override it.
    const ownColour = params?.color !== undefined || (params?.vertexColors === true && !params?.overlay);
    const t: Tracked = {
      material: m,
      classic: !ownColour && withColor.color ? withColor.color.clone() : null,
      kind,
      mode: m instanceof MeshLambertMaterial ? inkModeOf(kind) : null,
    };
    if (t.mode) {
      const mode = t.mode;
      m.onBeforeCompile = (shader) => {
        if (current === 'kodak') patchInkShader(shader, mode, uniforms);
      };
      m.customProgramCacheKey = () => (current === 'kodak' ? `ink-${mode}` : 'classic');
    }
    tracked.set(m, t);
    if (current !== DEFAULT_LOOK) applyMaterial(t);
    return m;
  };

  return {
    get id() {
      return current;
    },
    material(kind, params) {
      return track(base.material(kind, params), kind, params);
    },
    setupScene(s, e) {
      base.setupScene(s, e);
      scene = s;
      env = e;
      const fog = s.fog as Fog | null;
      classicSky = {
        background: s.background instanceof Color ? s.background.clone() : null,
        fog: fog ? fog.color.clone() : null,
      };
      applyScene();
    },
    select(id) {
      if (!isLookId(id) || id === current) return false;
      current = id;
      for (const t of tracked.values()) applyMaterial(t);
      applyScene();
      return true;
    },
    frame(timeS, p) {
      uniforms.uInkTime.value = timeS;
      uniforms.uInkHatch.value = p.hatchPerM;
      uniforms.uInkWaves.value = p.seaInk;
    },
    post(p) {
      if (current !== 'kodak') return null;
      const sky = kodakSky();
      return {
        ink: p.inkLines,
        inkWidthPx: p.inkWidthPx,
        inkFarM: 350,
        inkColor: uniforms.uInkColor.value,
        skyTop: linear(sky.top),
        skyHorizon: linear(sky.horizon),
        grade: p.filmGrade,
        vignette: p.vignette,
        grain: p.filmGrain,
      };
    },
  };
}
