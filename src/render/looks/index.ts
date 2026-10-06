// render/looks: the playable looks, switchable at any time (playtest 1b item 6: "Styles as settings"
// is [decided]). `classic` is the M1 flat low-poly look, unchanged and the default. The ink looks
// share one pipeline with dials (recipes.ts):
// - `kodak`, "Ink + 1960s film" (playtest 1b item 6, the maintainer's favourite from scratch/styles2):
//   ink outlines, world-space hatched shadows, inked waves, a warm Kodachrome grade, grain, vignette;
// - `wasteland`, "Sun-bleached wasteland" (playtest 1c item 5, the curator's top pick in
//   scratch/styles4): a flat burnt-orange sky, deep teal sea, charcoal road, heavier ink and hatching,
//   a sun-bleach grade instead of film;
// - `brush`, "Kodachrome brush" (playtest 1c item 5): thick brush outlines, flat colour with solid
//   black shadows, under the Kodachrome grade.
//
// The look set wraps the classic look and hands out the SAME material objects in every look, so a
// switch needs nothing from the views: it recolours the palette materials, turns the ink shader
// patch on or off (a recompile of the lit materials, once, at the switch), sets the shared ink
// uniforms, restyles the sky and fog, and says whether (and how) the renderer runs the final pass.
// The look is render-only: nothing here reaches the sim, its config or a replay.
//
// Region palettes (playtest 1c integration: the Pacific Northwest grey-green and foggy, San
// Francisco's fog, the Keys unchanged). A region's colours are written against the classic look:
// a palette colour that differs from the classic colour of its kind (or from the classic sky at
// that time of day, for `sky`) replaces that colour in every look, and the ink looks still ink,
// hatch and grade it. A palette colour equal to the classic one means "the look's own", which is
// how the Keys, whose palette is the classic look's, stay exactly as they were in every look.
import { Color, MeshBasicMaterial, MeshLambertMaterial, type Fog, type Material, type Scene } from 'three';
import {
  CLASSIC_PALETTE,
  type LookEnv,
  type LookStyle,
  type MaterialKind,
  type MaterialParams,
} from '../look';
import {
  inkModeOf,
  NO_INK_KINDS,
  patchInkShader,
  patchNoInkShader,
  type InkMode,
  type InkUniforms,
} from './ink';
import type { PostSettings } from './post';
import { BRUSH, KODAK, skyOf, WASTELAND, type InkRecipe } from './recipes';

export { kodachromeGrade, bleachGrade, neutralGrade, buildGradeLut, GRADES, LUT_SIZE } from './grade';
export type { GradeId } from './grade';
export { patchInkShader, patchNoInkShader, NO_INK_KINDS, VERTEX_ANCHORS, FRAGMENT_ANCHORS } from './ink';
export type { InkUniforms, ShaderParts } from './ink';
// LookPost is not re-exported: render/index.ts loads post.ts as a lazy chunk (the film pass).
export type { PostSettings } from './post';
export { KODAK, WASTELAND, BRUSH } from './recipes';
export type { InkRecipe, ShadowStyle, SkyColours } from './recipes';

/** The playable looks, in the order the settings row lists them. Ids are saved: never rename one. */
export const LOOK_IDS = ['classic', 'kodak', 'wasteland', 'brush'] as const;
export type LookId = (typeof LOOK_IDS)[number];
export const DEFAULT_LOOK: LookId = 'classic';

/** Each ink look's recipe; `classic` has none (it is the M1 look, untouched). */
export const INK_RECIPES: Readonly<Record<Exclude<LookId, 'classic'>, InkRecipe>> = {
  kodak: KODAK,
  wasteland: WASTELAND,
  brush: BRUSH,
};

export function isLookId(v: unknown): v is LookId {
  return typeof v === 'string' && (LOOK_IDS as readonly string[]).includes(v);
}

/** The Kodachrome palette (display sRGB) of the `kodak` look; kept as a name for older callers. */
export const KODAK_PALETTE = KODAK.palette;

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
  /** The final pass's settings this frame, or null when the look draws straight to the screen. */
  post(p: LookPostParams): PostSettings | null;
}

interface Tracked {
  material: Material;
  /** The palette colour this material follows, or null when its colour is its own. */
  classic: Color | null;
  kind: MaterialKind;
  /** The ink patch mode, for lit materials; null for unlit ones. */
  mode: InkMode | null;
  /** An unlit material left out of the brightness ink (ink.ts, NO_INK_KINDS): patched while inked. */
  noInk: boolean;
}

const linear = (hex: string): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

const toArray = (c: Color): [number, number, number] => [c.r, c.g, c.b];

const isKind = (k: string): k is MaterialKind =>
  k !== 'sky' && Object.prototype.hasOwnProperty.call(CLASSIC_PALETTE, k);

/** How far an ink look's sky top leans toward a region's sky (the horizon takes it fully). [default] */
export const REGION_SKY_TOP = 0.7;

export function createLookSet(base: LookStyle): LookSet {
  let current: LookId = DEFAULT_LOOK;
  const tracked = new Map<Material, Tracked>();
  const n = Math.hypot(...SUN);
  const uniforms: InkUniforms = {
    uInkSun: { value: [SUN[0] / n, SUN[1] / n, SUN[2] / n] },
    uInkHatch: { value: 5 },
    uInkExposure: { value: 1 },
    uInkColor: { value: linear(KODAK.ink) },
    uInkTime: { value: 0 },
    uInkWaves: { value: 1 },
    uInkSolid: { value: 0 },
    uInkLitHatch: { value: 0 },
  };
  let scene: Scene | null = null;
  let env: LookEnv | null = null;
  let classicSky: { background: Color | null; fog: Color | null } = { background: null, fog: null };
  /** The race region's own colours: per material kind, the sky and the haze (null: the look's). */
  let overrides = new Map<MaterialKind, Color>();
  let skyOverride: Color | null = null;
  let fogOverride: Color | null = null;

  const regionColours = (e: LookEnv) => {
    overrides = new Map();
    const palette = e.palette ?? {};
    const differs = (hex: string, classic: string | Color) =>
      new Color(hex).getHex() !== (classic instanceof Color ? classic.getHex() : new Color(classic).getHex());
    for (const [k, hex] of Object.entries(palette)) {
      if (isKind(k) && differs(hex, CLASSIC_PALETTE[k])) overrides.set(k, new Color(hex));
    }
    const sky = palette['sky'];
    skyOverride = sky && classicSky.background && differs(sky, classicSky.background) ? new Color(sky) : null;
    const fog = palette['fog'];
    fogOverride = fog ? new Color(fog) : skyOverride;
  };

  const recipe = (): InkRecipe | null => (current === 'classic' ? null : INK_RECIPES[current]);
  const inked = () => current !== 'classic';

  const applyMaterial = (t: Tracked, recompile = true) => {
    const m = t.material as Material & { color?: Color };
    if (t.classic && m.color) {
      const hex = recipe()?.palette[t.kind];
      const own = overrides.get(t.kind);
      if (own) m.color.copy(own);
      else if (hex) m.color.set(hex);
      else m.color.copy(t.classic);
    }
    // The ink patch changes the lit program: recompile once, now.
    if ((t.mode || t.noInk) && recompile) m.needsUpdate = true;
  };

  const applyUniforms = () => {
    const r = recipe();
    if (!r) return;
    uniforms.uInkColor.value = linear(r.ink);
    uniforms.uInkSolid.value = r.shadow === 'solid' ? 1 : 0;
    uniforms.uInkLitHatch.value = r.litHatch;
    uniforms.uInkExposure.value = skyOf(r, env?.timeOfDay).exposure;
  };

  const applyScene = () => {
    if (!scene) return;
    const fog = scene.fog as Fog | null;
    const r = recipe();
    if (r) {
      const sky = skyOf(r, env?.timeOfDay);
      scene.background = skyOverride ? skyOverride.clone() : new Color(sky.horizon);
      if (fog) {
        if (fogOverride) fog.color.copy(fogOverride);
        else fog.color.set(sky.horizon);
      }
    } else {
      scene.background = skyOverride?.clone() ?? classicSky.background?.clone() ?? null;
      if (fog && (fogOverride ?? classicSky.fog)) fog.color.copy((fogOverride ?? classicSky.fog) as Color);
    }
  };

  const track = (m: Material, kind: MaterialKind, params: MaterialParams | undefined): Material => {
    if (tracked.has(m)) return m;
    const withColor = m as Material & { color?: Color };
    // The palette decides this colour only when the caller gave none and no vertex colours override it.
    // A `paletteBase` material multiplies the palette's colour by its vertex colours: the palette still decides.
    const ownColour =
      params?.color !== undefined ||
      (params?.vertexColors === true && !params?.overlay && params?.paletteBase !== true);
    const t: Tracked = {
      material: m,
      classic: !ownColour && withColor.color ? withColor.color.clone() : null,
      kind,
      mode: m instanceof MeshLambertMaterial ? inkModeOf(kind) : null,
      noInk: m instanceof MeshBasicMaterial && !m.transparent && NO_INK_KINDS.has(kind),
    };
    if (t.mode) {
      const mode = t.mode;
      m.onBeforeCompile = (shader) => {
        if (inked()) patchInkShader(shader, mode, uniforms);
      };
      // Every ink look shares one program per mode: their differences are uniforms and colours.
      m.customProgramCacheKey = () => (inked() ? `ink-${mode}` : 'classic');
    }
    if (t.noInk) {
      m.onBeforeCompile = (shader) => {
        if (inked()) patchNoInkShader(shader);
      };
      m.customProgramCacheKey = () => (inked() ? 'ink-no-ink' : 'classic');
    }
    tracked.set(m, t);
    if (current !== DEFAULT_LOOK || overrides.size > 0) applyMaterial(t, current !== DEFAULT_LOOK);
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
      // A new region recolours every material it has handed out (colours only: no recompile).
      regionColours(e);
      for (const t of tracked.values()) applyMaterial(t, false);
      applyUniforms();
      applyScene();
    },
    select(id) {
      if (!isLookId(id) || id === current) return false;
      const wasInked = inked();
      current = id;
      // Between two ink looks the program is the same: only colours and uniforms change.
      const recompile = wasInked !== inked();
      for (const t of tracked.values()) applyMaterial(t, recompile);
      applyUniforms();
      applyScene();
      return true;
    },
    frame(timeS, p) {
      const r = recipe();
      uniforms.uInkTime.value = timeS;
      uniforms.uInkHatch.value = p.hatchPerM * (r?.hatchScale ?? 1);
      uniforms.uInkWaves.value = p.seaInk * (r?.seaInk ?? 1);
    },
    post(p) {
      const r = recipe();
      if (!r) return null;
      const sky = skyOf(r, env?.timeOfDay);
      return {
        ink: p.inkLines,
        inkWidthPx: p.inkWidthPx * r.lineWeight,
        inkFarM: 350,
        inkColor: uniforms.uInkColor.value,
        skyTop: skyOverride ? toArray(new Color(sky.top).lerp(skyOverride, REGION_SKY_TOP)) : linear(sky.top),
        skyHorizon: skyOverride ? toArray(skyOverride) : linear(sky.horizon),
        grade: Math.min(1, p.filmGrade * r.gradeAmount),
        lut: r.grade,
        brush: r.brush,
        vignette: p.vignette * r.vignette,
        grain: p.filmGrain * r.grain,
      };
    },
  };
}
